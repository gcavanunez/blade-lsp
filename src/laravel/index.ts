/**
 * Laravel project integration module
 *
 * Provides dynamic extraction of views, components, and directives
 * from a Laravel project via PHP script execution.
 */

import z from 'zod';
import { NamedError } from '../utils/error';
import { Log } from '../utils/log';

import { Project } from './project';
import { PhpEnvironment } from './php-environment';
import { LaravelContext } from './context';
import { Views } from './views';
import { Components } from './components';
import { Directives } from './directives';
import { MutableRef } from 'effect';
import { FormatErrorForLog } from '../utils/format-error';
import { Container } from '../runtime/container';

export namespace Laravel {
    export const NotDetectedError = NamedError.create(
        'LaravelNotDetectedError',
        z.object({
            workspaceRoot: z.string(),
        }),
    );

    export const ValidationError = NamedError.create(
        'LaravelValidationError',
        z.object({
            projectRoot: z.string(),
            message: z.string().optional(),
        }),
    );

    export const NotAvailableError = NamedError.create(
        'LaravelNotAvailableError',
        z.object({
            message: z.string().optional(),
        }),
    );

    const log = Log.create({ service: 'laravel' });

    /**
     * Options for Laravel initialization
     */
    export interface Options {
        phpCommand?: string[];
        phpEnvironment?: PhpEnvironment.Name;
        onProgress?: (message: string, percentage?: number) => void;
    }

    /**
     * Result of a refreshAll operation.
     */
    export interface RefreshResult {
        views: 'ok' | 'failed';
        components: 'ok' | 'failed';
        directives: 'ok' | 'failed';
        /** Formatted error messages for any failed refreshes */
        errors: string[];
    }

    /**
     * Initialize the Laravel integration for a workspace.
     * Returns true if initialization succeeded, false otherwise.
     */
    export async function initialize(workspaceRoot: string, options: Options = {}): Promise<boolean> {
        // Reuse the in-flight initialization promise to avoid concurrent boots.
        const ref = Container.get().laravelInitPromise;
        const existing = MutableRef.get(ref);
        if (existing) {
            return existing;
        }

        const promise = doInitialize(workspaceRoot, options);
        MutableRef.set(ref, promise);
        const result = await promise;
        // Allow future calls to initialize again after this run completes.
        MutableRef.set(ref, null);
        return result;
    }

    export function isAvailable(): boolean {
        return LaravelContext.isAvailable();
    }

    export function hasLoadedViews(): boolean {
        const state = LaravelContext.get();
        return !!state && state.views.lastUpdated > 0;
    }

    export function hasLoadedComponents(): boolean {
        const state = LaravelContext.get();
        return !!state && state.components.lastUpdated > 0;
    }

    export function hasLoadedDirectives(): boolean {
        const state = LaravelContext.get();
        return !!state && state.directives.lastUpdated > 0;
    }

    /**
     * Get the result of the last refreshAll operation.
     * Returns null if no refresh has been performed yet.
     */
    export function getLastRefreshResult(): RefreshResult | null {
        return MutableRef.get(Container.get().laravelRefreshResult);
    }

    export function getProject(): Project.AnyProject | null {
        const state = LaravelContext.get();
        return state?.project ?? null;
    }

    /**
     * Refresh all data (views, components, directives).
     * Runs all refreshes in parallel. Individual failures don't stop others.
     *
     * @param onProgress  Optional callback for reporting progress to the client.
     * @returns Summary of what succeeded and what failed, including error messages.
     */
    export async function refreshAll(
        onProgress?: (message: string, percentage?: number) => void,
    ): Promise<RefreshResult> {
        const result: RefreshResult = { views: 'ok', components: 'ok', directives: 'ok', errors: [] };

        if (!LaravelContext.isAvailable()) {
            return result;
        }

        const report = onProgress ?? (() => {});
        using _timer = log.time('Refreshing all');

        report('Loading views, components, directives...');

        let completed = 0;
        const total = 3;
        const trackProgress = (label: string) => {
            completed++;
            const pct = Math.round((completed / total) * 100);
            report(`${label} (${completed}/${total})`, pct);
        };

        const results = await Promise.allSettled([
            Views.refresh().then(() => {
                trackProgress('Views loaded');
            }),
            Components.refresh().then(() => {
                trackProgress('Components loaded');
            }),
            Directives.refresh().then(() => {
                trackProgress('Directives loaded');
            }),
        ]);

        const [viewResult, componentResult, directiveResult] = results;

        if (viewResult.status === 'rejected') {
            log.error('Views refresh failed', { error: viewResult.reason });
            result.views = 'failed';
            result.errors.push(FormatErrorForLog(viewResult.reason));
        }
        if (componentResult.status === 'rejected') {
            log.error('Components refresh failed', { error: componentResult.reason });
            result.components = 'failed';
            result.errors.push(FormatErrorForLog(componentResult.reason));
        }
        if (directiveResult.status === 'rejected') {
            log.error('Directives refresh failed', { error: directiveResult.reason });
            result.directives = 'failed';
            result.errors.push(FormatErrorForLog(directiveResult.reason));
        }

        log.info('Refresh complete', {
            views: result.views,
            components: result.components,
            directives: result.directives,
        });

        return result;
    }

    /**
     * Dispose of resources.
     */
    export function dispose(): void {
        if (LaravelContext.isAvailable()) {
            Views.clear();
            Components.clear();
            Directives.clear();
        }
        LaravelContext.set(null);
        if (Container.isReady()) {
            MutableRef.set(Container.get().laravelRefreshResult, null);
        }
        log.info('Disposed');
    }

    async function doInitialize(workspaceRoot: string, options: Options): Promise<boolean> {
        const report = options.onProgress ?? (() => {});

        log.info('Initializing', { workspaceRoot });

        report('Detecting project...');

        const projectOptions = {
            phpCommand: options.phpCommand,
            phpEnvironment: options.phpEnvironment,
        };

        const project = Project.detectAny(workspaceRoot, projectOptions);

        if (!project) {
            log.info('No Laravel or Jigsaw project detected');
            return false;
        }

        log.info(`${project.type} project detected`, {
            root: project.root,
            phpCommand: project.phpCommand.join(' '),
        });

        report(`Validating ${project.type} project...`);

        const valid = await Project.validateAny(project);
        if (!valid) {
            log.warn(`${project.type} project validation failed`);
            return false;
        }

        const state = LaravelContext.createState(project);
        LaravelContext.set(state);

        log.info('Initialization complete');

        const result = await refreshAll(report).catch((err) => {
            log.error('Initial refresh failed', { error: err });
            return {
                views: 'failed',
                components: 'failed',
                directives: 'failed',
                errors: [String(err)],
            } as RefreshResult;
        });
        MutableRef.set(Container.get().laravelRefreshResult, result);

        return true;
    }
}

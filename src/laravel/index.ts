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
import { FormatErrorForLog } from '../utils/format-error';

export namespace Laravel {
    // ─── Errors ────────────────────────────────────────────────────────────────

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

    // ─── Logger ────────────────────────────────────────────────────────────────

    const log = Log.create({ service: 'laravel' });

    // ─── Types ─────────────────────────────────────────────────────────────────

    /**
     * Options for Laravel initialization
     */
    export interface Options {
        // Command array to execute PHP (defaults to auto-detect if not provided)
        // Examples:
        //   - Local: ['php'] or ['/usr/bin/php']
        //   - Docker: ['docker', 'compose', 'exec', 'app', 'php']
        //   - Sail: ['./vendor/bin/sail', 'php']
        phpCommand?: string[];
        // Preferred PHP environment to try (e.g., 'sail', 'herd', 'lando').
        // If set, skips auto-detection order and tries only this environment.
        // Ignored if phpCommand is explicitly provided.
        phpEnvironment?: PhpEnvironment.Name;
        // Callback for reporting progress during initialization.
        // Called with a human-readable message and optional percentage (0-100).
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

    // ─── State ─────────────────────────────────────────────────────────────────

    let initPromise: Promise<boolean> | null = null;
    let lastRefreshResult: RefreshResult | null = null;

    // ─── Public Functions ──────────────────────────────────────────────────────

    /**
     * Initialize the Laravel integration for a workspace.
     * Returns true if initialization succeeded, false otherwise.
     */
    export async function initialize(workspaceRoot: string, options: Options = {}): Promise<boolean> {
        if (initPromise) {
            return initPromise;
        }

        initPromise = doInitialize(workspaceRoot, options);
        const result = await initPromise;
        initPromise = null;
        return result;
    }

    /**
     * Check if Laravel integration is available.
     */
    export function isAvailable(): boolean {
        return LaravelContext.isAvailable();
    }

    /**
     * Get the result of the last refreshAll operation.
     * Returns null if no refresh has been performed yet.
     */
    export function getLastRefreshResult(): RefreshResult | null {
        return lastRefreshResult;
    }

    /**
     * Get the current Laravel project.
     */
    export function getProject(): Project.LaravelProject | null {
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

        return LaravelContext.provide(async () => {
            const report = onProgress ?? (() => {});
            using _timer = log.time('Refreshing all');

            report('Loading views, components, directives...');

            // Track completion of parallel tasks for incremental progress
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

            // Log individual failures and collect error messages
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
        });
    }

    /**
     * Dispose of resources.
     */
    export function dispose(): void {
        if (LaravelContext.isAvailable()) {
            LaravelContext.provide(() => {
                Views.clear();
                Components.clear();
                Directives.clear();
            });
        }
        LaravelContext.set(null);
        lastRefreshResult = null;
        log.info('Disposed');
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    async function doInitialize(workspaceRoot: string, options: Options): Promise<boolean> {
        const report = options.onProgress ?? (() => {});

        log.info('Initializing', { workspaceRoot });

        report('Detecting Laravel project...');

        const project = Project.detect(workspaceRoot, {
            phpCommand: options.phpCommand,
            phpEnvironment: options.phpEnvironment,
        });

        if (!project) {
            log.info('No Laravel project detected');
            return false;
        }

        log.info('Laravel project detected', {
            root: project.root,
            phpCommand: project.phpCommand.join(' '),
        });

        report('Validating Laravel project...');

        const valid = await Project.validate(project);
        if (!valid) {
            log.warn('Laravel project validation failed');
            return false;
        }

        // Create and set the global context state
        const state = LaravelContext.createState(project);
        LaravelContext.set(state);

        log.info('Initialization complete');

        // Trigger initial refresh with progress reporting
        lastRefreshResult = await refreshAll(report).catch((err) => {
            log.error('Initial refresh failed', { error: err });
            return {
                views: 'failed',
                components: 'failed',
                directives: 'failed',
                errors: [String(err)],
            } as RefreshResult;
        });

        return true;
    }
}

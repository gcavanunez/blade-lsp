/**
 * Laravel project integration module
 *
 * Provides dynamic extraction of views, components, and directives
 * from a Laravel project via PHP script execution.
 */

import z from 'zod';
import { NamedError } from '../utils/error';
import { Log } from '../utils/log';

export { LaravelProject, detectLaravelProject, validateLaravelProject, getLaravelVersion } from './project';
export { PhpRunner } from './php-runner';
export { LaravelContext } from './context';
export { Views } from './views';
export { Components } from './components';
export { Directives } from './directives';
export * from './types';

import { LaravelProject, detectLaravelProject, validateLaravelProject } from './project';
import { LaravelContext } from './context';
import { Views } from './views';
import { Components } from './components';
import { Directives } from './directives';

export namespace Laravel {
  // ─── Errors ────────────────────────────────────────────────────────────────

  export const NotDetectedError = NamedError.create(
    'LaravelNotDetectedError',
    z.object({
      workspaceRoot: z.string(),
    })
  );

  export const ValidationError = NamedError.create(
    'LaravelValidationError',
    z.object({
      projectRoot: z.string(),
      message: z.string().optional(),
    })
  );

  export const NotAvailableError = NamedError.create(
    'LaravelNotAvailableError',
    z.object({
      message: z.string().optional(),
    })
  );

  // ─── Logger ────────────────────────────────────────────────────────────────

  const log = Log.create({ service: 'laravel' });

  // ─── Types ─────────────────────────────────────────────────────────────────

  /**
   * Options for Laravel initialization
   */
  export interface Options {
    // Command array to execute PHP (defaults to ['php'] if not provided)
    // Examples:
    //   - Local: ['php'] or ['/usr/bin/php']
    //   - Docker: ['docker', 'compose', 'exec', 'app', 'php']
    //   - Sail: ['./vendor/bin/sail', 'php']
    phpCommand?: string[];
  }

  let initPromise: Promise<boolean> | null = null;

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

  async function doInitialize(workspaceRoot: string, options: Options): Promise<boolean> {
    log.info('Initializing', { workspaceRoot });

    const project = detectLaravelProject(workspaceRoot, {
      phpCommand: options.phpCommand,
    });

    if (!project) {
      log.info('No Laravel project detected');
      return false;
    }

    log.info('Laravel project detected', {
      root: project.root,
      phpCommand: project.phpCommand.join(' '),
    });

    const valid = await validateLaravelProject(project);
    if (!valid) {
      log.warn('Laravel project validation failed');
      return false;
    }

    // Create and set the global context state
    const state = LaravelContext.createState(project);
    LaravelContext.setGlobal(state);

    log.info('Initialization complete');

    // Trigger initial refresh in background
    refreshAll().catch((err) => {
      log.error('Initial refresh failed', { error: err });
    });

    return true;
  }

  /**
   * Refresh all data (views, components, directives).
   * Runs all refreshes in parallel. Individual failures don't stop others.
   */
  export async function refreshAll(): Promise<void> {
    if (!LaravelContext.isAvailable()) {
      return;
    }

    using timer = log.time('Refreshing all');

    const results = await Promise.allSettled([
      Views.refresh(),
      Components.refresh(),
      Directives.refresh(),
    ]);

    const [viewResult, componentResult, directiveResult] = results;

    // Log individual failures
    if (viewResult.status === 'rejected') {
      log.error('Views refresh failed', { error: viewResult.reason });
    }
    if (componentResult.status === 'rejected') {
      log.error('Components refresh failed', { error: componentResult.reason });
    }
    if (directiveResult.status === 'rejected') {
      log.error('Directives refresh failed', { error: directiveResult.reason });
    }

    log.info('Refresh complete', {
      views: viewResult.status === 'fulfilled' ? 'ok' : 'failed',
      components: componentResult.status === 'fulfilled' ? 'ok' : 'failed',
      directives: directiveResult.status === 'fulfilled' ? 'ok' : 'failed',
    });
  }

  /**
   * Check if Laravel integration is available.
   */
  export function isAvailable(): boolean {
    return LaravelContext.isAvailable();
  }

  /**
   * Get the current Laravel project.
   */
  export function getProject(): LaravelProject | null {
    try {
      return LaravelContext.use().project;
    } catch {
      return null;
    }
  }

  /**
   * Dispose of resources.
   */
  export function dispose(): void {
    Views.clear();
    Components.clear();
    Directives.clear();
    LaravelContext.setGlobal(null);
    log.info('Disposed');
  }
}

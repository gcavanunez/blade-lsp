import z from 'zod';
import { NamedError } from '../utils/error';
import { Lock } from '../utils/lock';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { CustomDirective } from './types';

export namespace Directives {
  // ─── Errors ────────────────────────────────────────────────────────────────

  export const RefreshError = NamedError.create(
    'DirectivesRefreshError',
    z.object({
      message: z.string(),
      cause: z.string().optional(),
    })
  );

  export const NotFoundError = NamedError.create(
    'DirectivesNotFoundError',
    z.object({
      name: z.string(),
    })
  );

  // ─── Lock Key ──────────────────────────────────────────────────────────────

  const REFRESH_LOCK = 'directives-refresh';

  // ─── Functions ─────────────────────────────────────────────────────────────

  /**
   * Refresh directives from Laravel.
   * Uses a write lock to prevent concurrent refreshes.
   *
   * @throws RefreshError if refresh fails
   */
  export async function refresh(): Promise<void> {
    using _ = await Lock.write(REFRESH_LOCK);

    const state = LaravelContext.use();

    try {
      const data = await PhpRunner.runScript<CustomDirective[]>({
        project: state.project,
        scriptName: 'extract-directives',
        timeout: 30000,
        retry: { attempts: 2, delay: 1000 },
      });

      state.directives.items = data;
      state.directives.lastUpdated = Date.now();
    } catch (error) {
      throw new RefreshError(
        {
          message: 'Failed to refresh directives',
          cause: error instanceof Error ? error.message : String(error),
        },
        { cause: error }
      );
    }
  }

  /**
   * Get all directive items.
   */
  export function getItems(): CustomDirective[] {
    return LaravelContext.use().directives.items;
  }

  /**
   * Find a directive by name.
   */
  export function find(name: string): CustomDirective | undefined {
    return getItems().find((d) => d.name === name);
  }

  /**
   * Get a directive by name.
   * @throws NotFoundError if directive doesn't exist
   */
  export function get(name: string): CustomDirective {
    const item = find(name);
    if (!item) {
      throw new NotFoundError({ name });
    }
    return item;
  }

  /**
   * Check if a directive exists.
   */
  export function has(name: string): boolean {
    return getItems().some((d) => d.name === name);
  }

  /**
   * Search directives by query (case-insensitive).
   */
  export function search(query: string): CustomDirective[] {
    const lowerQuery = query.toLowerCase();
    return getItems().filter((d) => d.name.toLowerCase().includes(lowerQuery));
  }

  /**
   * Get directives that accept parameters.
   */
  export function getWithParams(): CustomDirective[] {
    return getItems().filter((d) => d.hasParams);
  }

  /**
   * Get directives that don't accept parameters.
   */
  export function getWithoutParams(): CustomDirective[] {
    return getItems().filter((d) => !d.hasParams);
  }

  /**
   * Check if cached data is stale.
   */
  export function isStale(maxAgeMs: number = 60000): boolean {
    return Date.now() - LaravelContext.use().directives.lastUpdated > maxAgeMs;
  }

  /**
   * Get last update timestamp.
   */
  export function getLastUpdated(): number {
    return LaravelContext.use().directives.lastUpdated;
  }

  /**
   * Clear cached data.
   */
  export function clear(): void {
    const state = LaravelContext.use();
    state.directives.items = [];
    state.directives.lastUpdated = 0;
  }
}

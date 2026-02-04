import z from 'zod';
import { NamedError } from '../utils/error';
import { Lock } from '../utils/lock';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { ViewItem } from './types';

export namespace Views {
  // ─── Errors ────────────────────────────────────────────────────────────────

  export const RefreshError = NamedError.create(
    'ViewsRefreshError',
    z.object({
      message: z.string(),
      cause: z.string().optional(),
    })
  );

  export const NotFoundError = NamedError.create(
    'ViewsNotFoundError',
    z.object({
      key: z.string(),
    })
  );

  // ─── Lock Key ──────────────────────────────────────────────────────────────

  const REFRESH_LOCK = 'views-refresh';

  // ─── Functions ─────────────────────────────────────────────────────────────

  /**
   * Refresh views from Laravel.
   * Uses a write lock to prevent concurrent refreshes.
   *
   * @throws RefreshError if refresh fails
   */
  export async function refresh(): Promise<void> {
    using _ = await Lock.write(REFRESH_LOCK);

    const state = LaravelContext.use();

    try {
      const data = await PhpRunner.runScript<ViewItem[]>({
        project: state.project,
        scriptName: 'extract-views',
        timeout: 30000,
        retry: { attempts: 2, delay: 1000 },
      });

      state.views.items = data;
      state.views.lastUpdated = Date.now();
    } catch (error) {
      throw new RefreshError(
        {
          message: 'Failed to refresh views',
          cause: error instanceof Error ? error.message : String(error),
        },
        { cause: error }
      );
    }
  }

  /**
   * Get all view items.
   */
  export function getItems(): ViewItem[] {
    return LaravelContext.use().views.items;
  }

  /**
   * Get local (non-vendor) view items.
   */
  export function getLocalItems(): ViewItem[] {
    return getItems().filter((v) => !v.isVendor);
  }

  /**
   * Get vendor view items.
   */
  export function getVendorItems(): ViewItem[] {
    return getItems().filter((v) => v.isVendor);
  }

  /**
   * Find a view by key.
   */
  export function find(key: string): ViewItem | undefined {
    return getItems().find((v) => v.key === key);
  }

  /**
   * Get a view by key.
   * @throws NotFoundError if view doesn't exist
   */
  export function get(key: string): ViewItem {
    const item = find(key);
    if (!item) {
      throw new NotFoundError({ key });
    }
    return item;
  }

  /**
   * Search views by query (case-insensitive).
   */
  export function search(query: string): ViewItem[] {
    const lowerQuery = query.toLowerCase();
    return getItems().filter((v) => v.key.toLowerCase().includes(lowerQuery));
  }

  /**
   * Get views by key prefix.
   */
  export function getByPrefix(prefix: string): ViewItem[] {
    return getItems().filter((v) => v.key.startsWith(prefix));
  }

  /**
   * Get views by namespace.
   */
  export function getByNamespace(namespace: string): ViewItem[] {
    return getItems().filter((v) => v.namespace === namespace);
  }

  /**
   * Get all unique namespaces.
   */
  export function getNamespaces(): string[] {
    const namespaces = new Set<string>();
    for (const item of getItems()) {
      if (item.namespace) {
        namespaces.add(item.namespace);
      }
    }
    return Array.from(namespaces).sort();
  }

  /**
   * Check if cached data is stale.
   */
  export function isStale(maxAgeMs: number = 60000): boolean {
    return Date.now() - LaravelContext.use().views.lastUpdated > maxAgeMs;
  }

  /**
   * Get last update timestamp.
   */
  export function getLastUpdated(): number {
    return LaravelContext.use().views.lastUpdated;
  }

  /**
   * Clear cached data.
   */
  export function clear(): void {
    const state = LaravelContext.use();
    state.views.items = [];
    state.views.lastUpdated = 0;
  }
}

import z from 'zod';
import { NamedError } from '../utils/error';
import { Lock } from '../utils/lock';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { ComponentItem, ComponentsResult } from './types';

export namespace Components {
  // ─── Errors ────────────────────────────────────────────────────────────────

  export const RefreshError = NamedError.create(
    'ComponentsRefreshError',
    z.object({
      message: z.string(),
      cause: z.string().optional(),
    })
  );

  export const NotFoundError = NamedError.create(
    'ComponentsNotFoundError',
    z.object({
      key: z.string(),
    })
  );

  // ─── Lock Key ──────────────────────────────────────────────────────────────

  const REFRESH_LOCK = 'components-refresh';

  // ─── Functions ─────────────────────────────────────────────────────────────

  /**
   * Refresh components from Laravel.
   * Uses a write lock to prevent concurrent refreshes.
   *
   * @throws RefreshError if refresh fails
   */
  export async function refresh(): Promise<void> {
    using _ = await Lock.write(REFRESH_LOCK);

    const state = LaravelContext.use();

    try {
      const data = await PhpRunner.runScript<ComponentsResult>({
        project: state.project,
        scriptName: 'extract-components',
        timeout: 30000,
        retry: { attempts: 2, delay: 1000 },
      });

      state.components.items = data.components;
      state.components.prefixes = data.prefixes;
      state.components.lastUpdated = Date.now();
    } catch (error) {
      throw new RefreshError(
        {
          message: 'Failed to refresh components',
          cause: error instanceof Error ? error.message : String(error),
        },
        { cause: error }
      );
    }
  }

  /**
   * Get all component items.
   */
  export function getItems(): ComponentItem[] {
    return LaravelContext.use().components.items;
  }

  /**
   * Get all component prefixes.
   */
  export function getPrefixes(): string[] {
    return LaravelContext.use().components.prefixes;
  }

  /**
   * Get local (non-vendor) component items.
   */
  export function getLocalItems(): ComponentItem[] {
    return getItems().filter((c) => !c.isVendor);
  }

  /**
   * Get vendor component items.
   */
  export function getVendorItems(): ComponentItem[] {
    return getItems().filter((c) => c.isVendor);
  }

  /**
   * Find a component by key.
   */
  export function find(key: string): ComponentItem | undefined {
    return getItems().find((c) => c.key === key);
  }

  /**
   * Get a component by key.
   * @throws NotFoundError if component doesn't exist
   */
  export function get(key: string): ComponentItem {
    const item = find(key);
    if (!item) {
      throw new NotFoundError({ key });
    }
    return item;
  }

  /**
   * Find a component by tag.
   */
  export function findByTag(tag: string): ComponentItem | undefined {
    return getItems().find((c) => c.fullTag === tag);
  }

  /**
   * Search components by query (case-insensitive).
   */
  export function search(query: string): ComponentItem[] {
    const lowerQuery = query.toLowerCase();
    return getItems().filter(
      (c) => c.key.toLowerCase().includes(lowerQuery) || c.fullTag.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get components by type.
   */
  export function getByType(type: ComponentItem['type']): ComponentItem[] {
    return getItems().filter((c) => c.type === type);
  }

  /**
   * Get components by key prefix.
   */
  export function getByPrefix(prefix: string): ComponentItem[] {
    return getItems().filter((c) => c.key.startsWith(prefix));
  }

  /**
   * Get standard components (x- prefix).
   */
  export function getStandardComponents(): ComponentItem[] {
    return getItems().filter((c) => c.fullTag.startsWith('x-'));
  }

  /**
   * Check if cached data is stale.
   */
  export function isStale(maxAgeMs: number = 60000): boolean {
    return Date.now() - LaravelContext.use().components.lastUpdated > maxAgeMs;
  }

  /**
   * Get last update timestamp.
   */
  export function getLastUpdated(): number {
    return LaravelContext.use().components.lastUpdated;
  }

  /**
   * Clear cached data.
   */
  export function clear(): void {
    const state = LaravelContext.use();
    state.components.items = [];
    state.components.prefixes = [];
    state.components.lastUpdated = 0;
  }
}

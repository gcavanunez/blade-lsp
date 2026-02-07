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
        }),
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
                { cause: error },
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
     * Find a component by key.
     */
    export function find(key: string): ComponentItem | undefined {
        return getItems().find((c) => c.key === key);
    }

    /**
     * Find a component by tag.
     */
    export function findByTag(tag: string): ComponentItem | undefined {
        return getItems().find((c) => c.fullTag === tag);
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

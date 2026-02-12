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
        }),
    );

    const REFRESH_LOCK = 'directives-refresh';

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
                scriptName: 'blade-directives',
            });

            state.directives.items = data;
            state.directives.lastUpdated = Date.now();
        } catch (error) {
            throw new RefreshError(
                {
                    message: 'Failed to refresh directives',
                    cause: error instanceof Error ? error.message : String(error),
                },
                { cause: error },
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
     * Search directives by query (case-insensitive).
     */
    export function search(query: string): CustomDirective[] {
        const lowerQuery = query.toLowerCase();
        return getItems().filter((d) => d.name.toLowerCase().includes(lowerQuery));
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

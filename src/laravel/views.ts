import z from 'zod';
import { NamedError } from '../utils/error';
import { Lock } from '../utils/lock';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { ViewItem } from './types';

export namespace Views {
    export const RefreshError = NamedError.create(
        'ViewsRefreshError',
        z.object({
            message: z.string(),
            cause: z.string().optional(),
        }),
    );

    const REFRESH_LOCK = 'views-refresh';

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
                scriptName: 'views',
            });

            state.views.items = data;
            state.views.lastUpdated = Date.now();
        } catch (error) {
            throw new RefreshError(
                {
                    message: 'Failed to refresh views',
                    cause: error instanceof Error ? error.message : String(error),
                },
                { cause: error },
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
     * Find a view by key.
     */
    export function find(key: string): ViewItem | undefined {
        return getItems().find((v) => v.key === key);
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

import z from 'zod';
import { Effect } from 'effect';
import { NamedError } from '../utils/error';
import { Lock } from '../utils/lock';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { CustomDirective } from './types';

export namespace Directives {
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
     * Error channel: `RefreshError` (the failed load state is recorded
     * before failing).
     */
    export function refresh(): Effect.Effect<void, InstanceType<typeof RefreshError>> {
        return Effect.acquireUseRelease(
            Effect.promise(() => Lock.write(REFRESH_LOCK)),
            () =>
                Effect.gen(function* () {
                    const state = LaravelContext.use();
                    state.directives.loadState = LaravelContext.createLoadingLoadState();

                    const data = yield* PhpRunner.runScript<CustomDirective[]>({
                        project: state.project,
                        scriptName: 'blade-directives',
                    }).pipe(
                        Effect.tapError((error) =>
                            Effect.sync(() => {
                                state.directives.loadState = LaravelContext.createFailedLoadState(error.message);
                            }),
                        ),
                        Effect.mapError(
                            (error) =>
                                new RefreshError(
                                    { message: 'Failed to refresh directives', cause: error.message },
                                    { cause: error },
                                ),
                        ),
                    );

                    state.directives.items = data;
                    state.directives.loadState = LaravelContext.createReadyLoadState();
                }),
            (guard) => Effect.sync(() => guard[Symbol.dispose]()),
        );
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
        state.directives.loadState = LaravelContext.createIdleLoadState();
    }
}

import { Effect, Schema, Semaphore } from 'effect';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { CustomDirective } from './types';

export namespace Directives {
    export class RefreshError extends Schema.TaggedErrorClass<RefreshError>()('DirectivesRefreshError', {
        message: Schema.String,
        // Schema.Defect is preferred, but it crashes class construction in
        // effect 4.0.0-beta.93 — revisit on the next beta bump.
        cause: Schema.optional(Schema.Unknown),
    }) {}

    /** Serializes refreshes so concurrent calls queue instead of overlapping. */
    const refreshLock = Semaphore.makeUnsafe(1);

    /**
     * Refresh directives from Laravel.
     * Holds a single-permit semaphore to prevent concurrent refreshes.
     *
     * Error channel: `RefreshError` (the failed load state is recorded
     * before failing).
     */
    export function refresh(): Effect.Effect<void, InstanceType<typeof RefreshError>> {
        return Semaphore.withPermit(
            refreshLock,
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
                        (error) => new RefreshError({ message: 'Failed to refresh directives', cause: error }),
                    ),
                );

                state.directives.items = data;
                state.directives.loadState = LaravelContext.createReadyLoadState();
            }),
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

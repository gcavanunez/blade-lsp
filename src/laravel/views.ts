import { Effect, Schema, Semaphore } from 'effect';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { ViewItem } from './types';

export namespace Views {
    export class RefreshError extends Schema.TaggedErrorClass<RefreshError>()('ViewsRefreshError', {
        message: Schema.String,
        // Schema.Defect is preferred, but it crashes class construction in
        // effect 4.0.0-beta.93 — revisit on the next beta bump.
        cause: Schema.optional(Schema.Unknown),
    }) {}

    /** Serializes refreshes so concurrent calls queue instead of overlapping. */
    const refreshLock = Semaphore.makeUnsafe(1);

    /**
     * Refresh views from Laravel.
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
                state.views.loadState = LaravelContext.createLoadingLoadState();

                const data = yield* PhpRunner.runScript<ViewItem[]>({
                    project: state.project,
                    scriptName: 'views',
                }).pipe(
                    Effect.tapError((error) =>
                        Effect.sync(() => {
                            state.views.loadState = LaravelContext.createFailedLoadState(error.message);
                        }),
                    ),
                    Effect.mapError((error) => new RefreshError({ message: 'Failed to refresh views', cause: error })),
                );

                state.views.items = data;
                state.views.loadState = LaravelContext.createReadyLoadState();
            }),
        );
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
     * Find a livewire view by component name (the part after `livewire:` in the tag).
     *
     * Handles both Livewire 3 (view key = `livewire.{name}`) and
     * Livewire 4 namespaced components (view key = `{namespace}::{name}`,
     * e.g. `pages::settings.delete-user-form`).
     */
    export function findLivewire(componentName: string): ViewItem | undefined {
        // Livewire 3: view key is 'livewire.{componentName}'
        const standardView = find(`livewire.${componentName}`);
        if (standardView) return standardView;

        // Livewire 4 namespaced: view key matches componentName directly
        // (e.g., 'pages::settings.delete-user-form')
        const directView = find(componentName);
        if (directView?.livewire) return directView;

        return undefined;
    }

    /**
     * Livewire view paired with its tag-form component name.
     */
    export interface LivewireViewEntry {
        view: ViewItem;
        /** The component name used in `<livewire:{componentName}>` tags. */
        componentName: string;
    }

    /**
     * Get all views that are livewire components, with their tag-form names.
     *
     * Handles both Livewire 3 (key prefix `livewire.`) and Livewire 4
     * namespaced components (views with `livewire` property set but no
     * `livewire.` key prefix).
     */
    export function getLivewireItems(): LivewireViewEntry[] {
        const views = getItems();
        const results: LivewireViewEntry[] = [];

        for (const view of views) {
            if (view.key.startsWith('livewire.')) {
                // Standard: livewire.counter -> componentName 'counter'
                results.push({
                    view,
                    componentName: view.key.slice('livewire.'.length),
                });
            } else if (view.livewire) {
                // Livewire 4 namespaced: pages::settings.foo -> componentName 'pages::settings.foo'
                results.push({
                    view,
                    componentName: view.key,
                });
            }
        }

        return results;
    }

    /**
     * Clear cached data.
     */
    export function clear(): void {
        const state = LaravelContext.use();
        state.views.items = [];
        state.views.loadState = LaravelContext.createIdleLoadState();
    }
}

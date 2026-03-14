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
        state.views.loadState = LaravelContext.createLoadingLoadState();

        try {
            const data = await PhpRunner.runScript<ViewItem[]>({
                project: state.project,
                scriptName: 'views',
            });

            state.views.items = data;
            state.views.loadState = LaravelContext.createReadyLoadState();
        } catch (error) {
            const cause = error instanceof Error ? error.message : String(error);
            state.views.loadState = LaravelContext.createFailedLoadState(cause);

            throw new RefreshError(
                {
                    message: 'Failed to refresh views',
                    cause,
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

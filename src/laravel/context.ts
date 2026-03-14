/**
 * Laravel context — delegates to the Effect service container.
 *
 * State lives in the container's `laravelState` MutableRef, managed by
 * Effect layers.
 *
 * Exposes a small API surface used across the codebase:
 * `set`, `get`, `use`, `isAvailable`, and `createState`.
 */

import { MutableRef } from 'effect';
import { Container } from '../runtime/container';
import { Project } from './project';
import { ViewItem, ComponentItem, CustomDirective } from './types';

export namespace LaravelContext {
    export type LoadState =
        | { status: 'idle' }
        | { status: 'loading' }
        | { status: 'ready'; loadedAt: number }
        | { status: 'failed'; error: string };

    interface DatasetState<T> {
        items: T[];
        loadState: LoadState;
    }

    export interface State {
        project: Project.AnyProject;
        views: DatasetState<ViewItem>;
        components: DatasetState<ComponentItem> & {
            prefixes: string[];
        };
        directives: DatasetState<CustomDirective>;
    }

    export function createIdleLoadState(): LoadState {
        return { status: 'idle' };
    }

    export function createLoadingLoadState(): LoadState {
        return { status: 'loading' };
    }

    export function createReadyLoadState(loadedAt: number = Date.now()): LoadState {
        return { status: 'ready', loadedAt };
    }

    export function createFailedLoadState(error: string): LoadState {
        return { status: 'failed', error };
    }

    export function isReady(loadState: LoadState): boolean {
        return loadState.status === 'ready';
    }

    /**
     * Set the current state.
     * Writes to the container's laravelState MutableRef.
     */
    export function set(state: State | null): void {
        if (Container.isReady()) {
            MutableRef.set(Container.get().laravelState, state);
        }
    }

    /**
     * Get the stored state reference.
     */
    export function get(): State | null {
        if (!Container.isReady()) return null;
        return MutableRef.get(Container.get().laravelState);
    }

    /**
     * Get the current state.
     * @throws if no state is available.
     */
    export function use(): State {
        const state = get();
        if (!state) {
            throw new Error('Laravel context not available');
        }
        return state;
    }

    /**
     * Check if Laravel state is available.
     */
    export function isAvailable(): boolean {
        return get() !== null;
    }

    /**
     * Create a fresh state object for a detected project.
     */
    export function createState(project: Project.AnyProject): State {
        return {
            project,
            views: {
                items: [],
                loadState: createIdleLoadState(),
            },
            components: {
                items: [],
                prefixes: [],
                loadState: createIdleLoadState(),
            },
            directives: {
                items: [],
                loadState: createIdleLoadState(),
            },
        };
    }
}

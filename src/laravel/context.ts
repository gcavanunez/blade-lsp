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
    export interface State {
        project: Project.AnyProject;
        views: {
            items: ViewItem[];
            lastUpdated: number;
        };
        components: {
            items: ComponentItem[];
            prefixes: string[];
            lastUpdated: number;
        };
        directives: {
            items: CustomDirective[];
            lastUpdated: number;
        };
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
     * Create a fresh state object for a detected Laravel project.
     */
    export function createState(project: Project.AnyProject): State {
        return {
            project,
            views: {
                items: [],
                lastUpdated: 0,
            },
            components: {
                items: [],
                prefixes: [],
                lastUpdated: 0,
            },
            directives: {
                items: [],
                lastUpdated: 0,
            },
        };
    }
}

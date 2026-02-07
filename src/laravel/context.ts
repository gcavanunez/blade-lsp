import { Context } from '../utils/context';
import { Project } from './project';
import { ViewItem, ComponentItem, CustomDirective } from './types';

export namespace LaravelContext {
    export interface State {
        project: Project.LaravelProject;
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

    // AsyncLocalStorage context — the single source of truth
    const ctx = Context.create<State>('Laravel');

    // Internal reference to the current state (used by provide())
    let current: State | null = null;

    /**
     * Set the current state (called during initialization).
     * This does NOT make the state available to `use()` — you must
     * call `provide(fn)` to scope it for handler execution.
     */
    export function set(state: State | null): void {
        current = state;
    }

    /**
     * Get the stored state reference (for inspection/disposal).
     * Prefer `use()` inside request handlers.
     */
    export function get(): State | null {
        return current;
    }

    /**
     * Run `fn` within the Laravel context scope.
     * All calls to `use()` inside `fn` (and its async descendants)
     * will resolve to the current state.
     */
    export function provide<R>(fn: () => R): R {
        if (!current) {
            throw new Context.NotFound('Laravel');
        }
        return ctx.provide(current, fn);
    }

    /**
     * Get the current Laravel context from AsyncLocalStorage.
     * Must be called inside a `provide()` scope.
     */
    export const use = ctx.use;

    export function isAvailable(): boolean {
        return current !== null;
    }

    export function createState(project: Project.LaravelProject): State {
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

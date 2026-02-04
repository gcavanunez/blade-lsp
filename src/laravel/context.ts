import { Context } from '../utils/context';
import { LaravelProject } from './project';
import { ViewItem, ComponentItem, CustomDirective } from './types';

export namespace LaravelContext {
  export interface State {
    project: LaravelProject;
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

  // Global state for long-running processes (like LSP server)
  let globalState: State | null = null;

  // AsyncLocalStorage context for explicit scoping
  const ctx = Context.create<State>('Laravel');

  /**
   * Set the global state (used during initialization)
   */
  export function setGlobal(state: State | null): void {
    globalState = state;
  }

  /**
   * Get the current Laravel context.
   * Checks AsyncLocalStorage first, then falls back to global state.
   * Throws if not available.
   */
  export function use(): State {
    try {
      return ctx.use();
    } catch {
      if (globalState) return globalState;
      throw new Context.NotFound('Laravel');
    }
  }

  /**
   * Run a function within an explicit Laravel context.
   */
  export function provide<R>(state: State, fn: () => R): R {
    return ctx.provide(state, fn);
  }

  /**
   * Check if we're currently in a Laravel context.
   */
  export function isAvailable(): boolean {
    try {
      use();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new state object for a Laravel project.
   */
  export function createState(project: LaravelProject): State {
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

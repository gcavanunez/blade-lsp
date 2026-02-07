/**
 * File watching module for the Blade LSP.
 *
 * Defines glob patterns to watch and maps file change events
 * to the appropriate refresh actions (views, components, directives, or all).
 *
 * Uses the LSP client's `workspace/didChangeWatchedFiles` capability
 * so no extra native dependencies are needed -- the editor handles
 * the actual file system watching.
 */

import {
    FileSystemWatcher,
    WatchKind,
    DidChangeWatchedFilesParams,
    FileChangeType,
    FileEvent,
} from 'vscode-languageserver/node';
import { Log } from './utils/log';

export namespace Watcher {
    // ─── Logger ────────────────────────────────────────────────────────────────

    const log = Log.create({ service: 'watcher' });

    // ─── Glob Patterns ────────────────────────────────────────────────────────
    // These patterns are registered with the LSP client via
    // `workspace/didChangeWatchedFiles` dynamic registration.

    /** Blade view files */
    const BLADE_GLOB = '**/*.blade.php';

    /** Class-based component files */
    const VIEW_COMPONENTS_GLOB = '**/app/View/Components/**/*.php';

    /** Livewire component files */
    const LIVEWIRE_GLOB = '**/app/Livewire/**/*.php';

    /** Service providers (where directives and components are often registered) */
    const PROVIDERS_GLOB = '**/app/Providers/**/*.php';

    /** Composer files (dependency changes can add/remove packages with views, components, directives) */
    const COMPOSER_GLOB = 'composer.{json,lock}';

    /** Route files (not currently used for refresh, but useful for future features) */
    const ROUTES_GLOB = '**/routes/**/*.php';

    /** Config files */
    const CONFIG_GLOB = '**/config/**/*.php';

    // ─── Refresh Targets ──────────────────────────────────────────────────────

    type RefreshTarget = 'views' | 'components' | 'directives';

    // ─── Watchers ─────────────────────────────────────────────────────────────

    /**
     * Build the list of FileSystemWatchers to register with the client.
     * The client will notify us via `workspace/didChangeWatchedFiles`
     * whenever a matching file is created, changed, or deleted.
     */
    export function getWatchers(): FileSystemWatcher[] {
        const watchAll = WatchKind.Create | WatchKind.Change | WatchKind.Delete;

        return [
            { globPattern: BLADE_GLOB, kind: watchAll },
            { globPattern: VIEW_COMPONENTS_GLOB, kind: watchAll },
            { globPattern: LIVEWIRE_GLOB, kind: watchAll },
            { globPattern: PROVIDERS_GLOB, kind: watchAll },
            { globPattern: COMPOSER_GLOB, kind: watchAll },
            { globPattern: ROUTES_GLOB, kind: watchAll },
            { globPattern: CONFIG_GLOB, kind: watchAll },
        ];
    }

    // ─── Event Classification ─────────────────────────────────────────────────

    /**
     * Given a file URI, determine which refresh targets are affected.
     * Returns a Set of targets so duplicate events collapse naturally.
     */
    function classifyChange(uri: string): Set<RefreshTarget> {
        const targets = new Set<RefreshTarget>();

        // Normalise to forward-slash path for matching
        const filePath = uri.replace('file://', '');

        if (filePath.endsWith('.blade.php')) {
            // Blade files can be views or anonymous components
            targets.add('views');
            targets.add('components');
        }

        if (/\/app\/View\/Components\//i.test(filePath)) {
            targets.add('components');
        }

        if (/\/app\/Livewire\//i.test(filePath)) {
            targets.add('views'); // Livewire components appear as views
            targets.add('components');
        }

        if (/\/app\/Providers\//i.test(filePath)) {
            // Service providers may register components, directives, or view namespaces
            targets.add('views');
            targets.add('components');
            targets.add('directives');
        }

        if (/composer\.(json|lock)$/.test(filePath)) {
            // Dependency changes can affect everything
            targets.add('views');
            targets.add('components');
            targets.add('directives');
        }

        if (/\/config\//i.test(filePath)) {
            // Config changes (e.g., view.php paths) can affect view/component resolution
            targets.add('views');
            targets.add('components');
        }

        return targets;
    }

    /**
     * Aggregate all file change events into a single set of refresh targets.
     */
    export function classifyChanges(params: DidChangeWatchedFilesParams): Set<RefreshTarget> {
        const targets = new Set<RefreshTarget>();

        for (const event of params.changes) {
            for (const target of classifyChange(event.uri)) {
                targets.add(target);
            }
        }

        return targets;
    }

    /**
     * Format file change events for logging.
     */
    export function describeChanges(events: FileEvent[]): string {
        const typeLabels: Record<number, string> = {
            [FileChangeType.Created]: 'created',
            [FileChangeType.Changed]: 'changed',
            [FileChangeType.Deleted]: 'deleted',
        };

        return events
            .map((e) => {
                const shortPath = e.uri.replace('file://', '').split('/').slice(-3).join('/');
                return `${typeLabels[e.type] ?? 'unknown'}:${shortPath}`;
            })
            .join(', ');
    }

    // ─── Debounce ─────────────────────────────────────────────────────────────

    /**
     * Creates a debounced function that accumulates RefreshTargets
     * and fires once after `delayMs` of inactivity.
     */
    export function createDebouncedRefresh(
        callback: (targets: Set<RefreshTarget>) => void,
        delayMs: number = 500,
    ): (targets: Set<RefreshTarget>) => void {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let pending = new Set<RefreshTarget>();

        return (targets: Set<RefreshTarget>) => {
            for (const t of targets) {
                pending.add(t);
            }

            if (timer) {
                clearTimeout(timer);
            }

            timer = setTimeout(() => {
                timer = null;
                const batch = pending;
                pending = new Set<RefreshTarget>();
                callback(batch);
            }, delayMs);
        };
    }
}

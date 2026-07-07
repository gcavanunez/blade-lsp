import { Effect, Schema, Semaphore } from 'effect';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { ComponentItem, ComponentsRawResult } from './types';

export namespace Components {
    export class RefreshError extends Schema.TaggedErrorClass<RefreshError>()('ComponentsRefreshError', {
        message: Schema.String,
        // Schema.Defect is preferred, but it crashes class construction in
        // effect 4.0.0-beta.93 — revisit on the next beta bump.
        cause: Schema.optional(Schema.Unknown),
    }) {}

    /** Serializes refreshes so concurrent calls queue instead of overlapping. */
    const refreshLock = Semaphore.makeUnsafe(1);

    /**
     * Refresh components from Laravel.
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
                state.components.loadState = LaravelContext.createLoadingLoadState();

                const raw = yield* PhpRunner.runScript<ComponentsRawResult>({
                    project: state.project,
                    scriptName: 'blade-components',
                }).pipe(
                    Effect.tapError((error) =>
                        Effect.sync(() => {
                            state.components.loadState = LaravelContext.createFailedLoadState(error.message);
                        }),
                    ),
                    Effect.mapError(
                        (error) => new RefreshError({ message: 'Failed to refresh components', cause: error }),
                    ),
                );

                const items: ComponentItem[] = Object.entries(raw.components).map(([key, data]) => ({
                    key,
                    path: data.paths[0] ?? '',
                    paths: data.paths,
                    isVendor: data.isVendor,
                    props: data.props,
                }));

                state.components.items = items;
                state.components.prefixes = raw.prefixes;
                state.components.loadState = LaravelContext.createReadyLoadState();
            }),
        );
    }

    export function getItems(): ComponentItem[] {
        return LaravelContext.use().components.items;
    }

    /**
     * Resolve a component from a tag name (e.g., 'x-button', 'flux:button').
     * Derives the key from the tag and looks it up.
     */
    export function resolve(tag: string): ComponentItem | undefined {
        const key = tagToKey(tag);
        return getItems().find((c) => c.key === key);
    }

    /**
     * Convert a tag name to a component key.
     * 'x-button' -> 'button'
     * 'x-turbo::frame' -> 'turbo::frame'
     * 'flux:button' -> 'flux::button' (single colon tags map to double colon keys)
     */
    function tagToKey(tag: string): string {
        if (tag.startsWith('x-')) {
            return tag.slice(2);
        }
        const colonIndex = tag.indexOf(':');
        if (colonIndex !== -1 && tag[colonIndex + 1] !== ':') {
            return tag.slice(0, colonIndex) + '::' + tag.slice(colonIndex + 1);
        }
        return tag;
    }

    /**
     * Derive a display tag from a component key.
     * 'button' -> 'x-button'
     * 'turbo::frame' -> 'x-turbo::frame'
     */
    export function keyToTag(key: string): string {
        return `x-${key}`;
    }

    /**
     * Derive the short-form namespaced tag from a component key.
     * Only applies to keys with '::' (vendor-namespaced components).
     *
     * 'flux::button' -> 'flux:button'
     * 'turbo::frame' -> 'turbo:frame'
     * 'button'       -> null  (no namespace)
     */
    export function keyToShortTag(key: string): string | null {
        const colonIndex = key.indexOf('::');
        if (colonIndex === -1) return null;
        return key.slice(0, colonIndex) + ':' + key.slice(colonIndex + 2);
    }

    export function clear(): void {
        const state = LaravelContext.use();
        state.components.items = [];
        state.components.prefixes = [];
        state.components.loadState = LaravelContext.createIdleLoadState();
    }
}

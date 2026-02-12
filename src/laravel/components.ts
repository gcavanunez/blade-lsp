import z from 'zod';
import { NamedError } from '../utils/error';
import { Lock } from '../utils/lock';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { ComponentItem, ComponentsRawResult } from './types';

export namespace Components {
    // ─── Errors ────────────────────────────────────────────────────────────────

    export const RefreshError = NamedError.create(
        'ComponentsRefreshError',
        z.object({
            message: z.string(),
            cause: z.string().optional(),
        }),
    );

    // ─── Lock Key ──────────────────────────────────────────────────────────────

    const REFRESH_LOCK = 'components-refresh';

    // ─── Functions ─────────────────────────────────────────────────────────────

    /**
     * Refresh components from Laravel.
     * Uses a write lock to prevent concurrent refreshes.
     *
     * @throws RefreshError if refresh fails
     */
    export async function refresh(): Promise<void> {
        using _ = await Lock.write(REFRESH_LOCK);

        const state = LaravelContext.use();

        try {
            const raw = await PhpRunner.runScript<ComponentsRawResult>({
                project: state.project,
                scriptName: 'blade-components',
            });

            // Normalize keyed object into flat array
            const items: ComponentItem[] = Object.entries(raw.components).map(([key, data]) => ({
                key,
                path: data.paths[0] ?? '',
                paths: data.paths,
                isVendor: data.isVendor,
                props: data.props,
            }));

            state.components.items = items;
            state.components.prefixes = raw.prefixes;
            state.components.lastUpdated = Date.now();
        } catch (error) {
            throw new RefreshError(
                {
                    message: 'Failed to refresh components',
                    cause: error instanceof Error ? error.message : String(error),
                },
                { cause: error },
            );
        }
    }

    /**
     * Get all component items.
     */
    export function getItems(): ComponentItem[] {
        return LaravelContext.use().components.items;
    }

    /**
     * Find a component by key.
     */
    export function find(key: string): ComponentItem | undefined {
        return getItems().find((c) => c.key === key);
    }

    /**
     * Find a component by tag name (e.g., 'x-button', 'flux:button').
     * Derives the key from the tag and looks it up.
     */
    export function findByTag(tag: string): ComponentItem | undefined {
        const key = tagToKey(tag);
        return find(key);
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
        // flux:button -> flux::button
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
     * Keys with '::' that have flux prefix also get 'flux:' form.
     */
    export function keyToTag(key: string): string {
        // Keys with :: keep it: 'turbo::frame' -> 'x-turbo::frame'
        return `x-${key}`;
    }

    /**
     * Clear cached data.
     */
    export function clear(): void {
        const state = LaravelContext.use();
        state.components.items = [];
        state.components.prefixes = [];
        state.components.lastUpdated = 0;
    }
}

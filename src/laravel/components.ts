import z from 'zod';
import { NamedError } from '../utils/error';
import { Lock } from '../utils/lock';
import { PhpRunner } from './php-runner';
import { LaravelContext } from './context';
import { ComponentItem, ComponentsRawResult } from './types';

export namespace Components {
    export const RefreshError = NamedError.create(
        'ComponentsRefreshError',
        z.object({
            message: z.string(),
            cause: z.string().optional(),
        }),
    );

    const REFRESH_LOCK = 'components-refresh';

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

    export function getItems(): ComponentItem[] {
        return LaravelContext.use().components.items;
    }

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
     * Resolve a component from a tag-like identifier.
     * Supports x- tags and namespaced tags.
     */
    export function resolve(tag: string): ComponentItem | undefined {
        return findByTag(tag);
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
     * Keys with '::' that have flux prefix also get 'flux:' form.
     */
    export function keyToTag(key: string): string {
        return `x-${key}`;
    }

    export function clear(): void {
        const state = LaravelContext.use();
        state.components.items = [];
        state.components.prefixes = [];
        state.components.lastUpdated = 0;
    }
}

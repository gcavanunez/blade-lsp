/**
 * Mock Laravel data for testing.
 *
 * Provides factory functions to pre-populate LaravelContext with fixture
 * data so tests can exercise Laravel-dependent features (views, components,
 * directives) without running PHP.
 *
 * State is stored in the service container's laravelState MutableRef.
 * `installMockLaravel()` writes directly and all provider code reads from
 * the same container.
 */

import { LaravelContext } from '../../src/laravel/context';
import { Laravel } from '../../src/laravel/index';
import type { ViewItem, ComponentItem, CustomDirective, ComponentProp, LivewireProp } from '../../src/laravel/types';
import { Project } from '../../src/laravel/project';
import { PhpEnvironment } from '../../src/laravel/php-environment';
import { Container } from '../../src/runtime/container';
import { MutableRef } from 'effect';

// ─── Default Fixture Data ───────────────────────────────────────────────────

export const DEFAULT_VIEWS: ViewItem[] = [
    {
        key: 'layouts.app',
        path: 'resources/views/layouts/app.blade.php',
        isVendor: false,
    },
    {
        key: 'partials.header',
        path: 'resources/views/partials/header.blade.php',
        isVendor: false,
    },
    {
        key: 'partials.footer',
        path: 'resources/views/partials/footer.blade.php',
        isVendor: false,
    },
    {
        key: 'components.alert',
        path: 'resources/views/components/alert.blade.php',
        isVendor: false,
    },
    {
        key: 'mail::message',
        path: 'vendor/laravel/framework/src/Illuminate/Mail/resources/views/markdown/message.blade.php',
        isVendor: true,
    },
];

export const DEFAULT_COMPONENT_PROPS: ComponentProp[] = [
    { name: 'type', type: 'string', default: 'button' },
    { name: 'variant', type: 'string', default: 'primary' },
    { name: 'disabled', type: 'bool', default: false },
];

export const DEFAULT_COMPONENTS: ComponentItem[] = [
    {
        key: 'button',
        path: 'resources/views/components/button.blade.php',
        paths: ['resources/views/components/button.blade.php'],
        isVendor: false,
        props: DEFAULT_COMPONENT_PROPS,
    },
    {
        key: 'alert',
        path: 'app/View/Components/Alert.php',
        paths: ['app/View/Components/Alert.php'],
        isVendor: false,
        props: [
            { name: 'type', type: 'string', default: null },
            { name: 'message', type: 'string', default: null },
            { name: 'dismissible', type: 'bool', default: true },
        ],
    },
    {
        key: 'flux::button',
        path: 'vendor/livewire/flux/resources/views/components/button.blade.php',
        paths: ['vendor/livewire/flux/resources/views/components/button.blade.php'],
        isVendor: true,
        props: [
            { name: 'variant', type: 'string', default: 'primary' },
            { name: 'size', type: 'string', default: 'md' },
        ],
    },
];

export const DEFAULT_LIVEWIRE_VIEWS: ViewItem[] = [
    {
        key: 'livewire.counter',
        path: 'resources/views/livewire/counter.blade.php',
        isVendor: false,
        livewire: {
            props: [
                { name: 'count', type: 'int', hasDefaultValue: true, defaultValue: 0 },
                { name: 'label', type: 'string', hasDefaultValue: false, defaultValue: null },
            ],
            files: ['app/Livewire/Counter.php', 'resources/views/livewire/counter.blade.php'],
        },
    },
    {
        key: 'livewire.search-bar',
        path: 'resources/views/livewire/search-bar.blade.php',
        isVendor: false,
        livewire: {
            props: [],
            files: ['app/Livewire/SearchBar.php'],
        },
    },
];

export const DEFAULT_COMPONENT_PREFIXES: string[] = ['flux'];

export const DEFAULT_DIRECTIVES: CustomDirective[] = [
    {
        name: 'datetime',
        hasParams: true,
    },
    {
        name: 'money',
        hasParams: true,
    },
    {
        name: 'admin',
        hasParams: false,
    },
];

// ─── Factory ────────────────────────────────────────────────────────────────

export interface MockLaravelOverrides {
    project?: Partial<Project.LaravelProject>;
    views?: ViewItem[];
    components?: ComponentItem[];
    prefixes?: string[];
    directives?: CustomDirective[];
}

/**
 * Create a mock LaravelContext.State with sensible defaults.
 */
export function createMockLaravelState(overrides?: MockLaravelOverrides): LaravelContext.State {
    const defaultPhpEnv: PhpEnvironment.Result = {
        name: 'local',
        label: 'Local',
        phpCommand: ['php'],
        useRelativePaths: false,
    };

    const project: Project.LaravelProject = {
        root: overrides?.project?.root ?? '/test/project',
        phpCommand: overrides?.project?.phpCommand ?? ['php'],
        phpEnvironment: overrides?.project?.phpEnvironment ?? defaultPhpEnv,
        ...(overrides?.project ?? {}),
    } as Project.LaravelProject;

    return {
        project,
        views: {
            items: overrides?.views ?? [...DEFAULT_VIEWS, ...DEFAULT_LIVEWIRE_VIEWS],
            lastUpdated: Date.now(),
        },
        components: {
            items: overrides?.components ?? DEFAULT_COMPONENTS,
            prefixes: overrides?.prefixes ?? DEFAULT_COMPONENT_PREFIXES,
            lastUpdated: Date.now(),
        },
        directives: {
            items: overrides?.directives ?? DEFAULT_DIRECTIVES,
            lastUpdated: Date.now(),
        },
    };
}

/**
 * Ensure the service container is initialized.
 *
 * Unit tests that call provider functions directly (outside the LSP
 * server pipeline) need a container so that `LaravelContext.set/get`
 * have somewhere to write. This creates a minimal stub container
 * with no-op implementations for services that unit tests don't invoke.
 */
export function ensureContainer(): void {
    if (Container.isReady()) return;

    // Minimal stub container for unit tests.
    // Integration tests go through Server.start() which calls buildRuntime().
    const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };
    const noopProgress = { begin: () => ({ report: () => {}, done: () => {} }) };

    Container.init({
        connection: {} as any,
        documents: {} as any,
        parser: {
            initialize: async () => {},
            parse: () => ({ rootNode: { children: [] } }) as any,
        },
        logger: noopLogger as any,
        progress: noopProgress as any,
        settings: MutableRef.make({}),
        workspaceRoot: MutableRef.make<string | null>('/test/project'),
        treeCache: new Map(),
        laravelState: MutableRef.make<LaravelContext.State | null>(null),
        watchCapability: MutableRef.make(false),
        parserBackend: MutableRef.make(null),
        laravelInitPromise: MutableRef.make(null),
        laravelRefreshResult: MutableRef.make(null),
    });
}

/**
 * Install mock Laravel data into the context.
 * Call this in `beforeAll` or `beforeEach`.
 */
export function installMockLaravel(overrides?: MockLaravelOverrides): void {
    ensureContainer();
    const state = createMockLaravelState(overrides);
    LaravelContext.set(state);
}

/**
 * Clear mock Laravel data from the context.
 * Call this in `afterAll` or `afterEach`.
 */
export function clearMockLaravel(): void {
    try {
        Laravel.dispose();
    } catch {
        LaravelContext.set(null);
    }
}

import type { Hover, MarkupContent } from 'vscode-languageserver/node';

/**
 * Extract the string value from a Hover's contents.
 *
 * Handles the three possible shapes:
 *   - string
 *   - MarkupContent  ({ kind, value })
 *   - MarkedString   ({ language, value })
 */
export function getHoverValue(hover: Hover): string {
    const contents = hover.contents;
    if (typeof contents === 'string') return contents;
    if ('value' in contents) return (contents as MarkupContent).value;
    return '';
}

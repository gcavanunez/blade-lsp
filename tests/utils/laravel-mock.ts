/**
 * Mock Laravel data for testing.
 *
 * Provides factory functions to pre-populate LaravelContext with fixture
 * data so tests can exercise Laravel-dependent features (views, components,
 * directives) without running PHP.
 */

import { LaravelContext } from '../../src/laravel/context';
import { Laravel } from '../../src/laravel/index';
import type { ViewItem, ComponentItem, CustomDirective, ComponentProp } from '../../src/laravel/types';
import { Project } from '../../src/laravel/project';
import { PhpEnvironment } from '../../src/laravel/php-environment';

// ─── Default Fixture Data ───────────────────────────────────────────────────

export const DEFAULT_VIEWS: ViewItem[] = [
    {
        key: 'layouts.app',
        path: 'resources/views/layouts/app.blade.php',
        isVendor: false,
        namespace: null,
    },
    {
        key: 'partials.header',
        path: 'resources/views/partials/header.blade.php',
        isVendor: false,
        namespace: null,
    },
    {
        key: 'partials.footer',
        path: 'resources/views/partials/footer.blade.php',
        isVendor: false,
        namespace: null,
    },
    {
        key: 'components.alert',
        path: 'resources/views/components/alert.blade.php',
        isVendor: false,
        namespace: null,
    },
    {
        key: 'mail::message',
        path: 'vendor/laravel/framework/src/Illuminate/Mail/resources/views/markdown/message.blade.php',
        isVendor: true,
        namespace: 'mail',
    },
];

export const DEFAULT_COMPONENT_PROPS: ComponentProp[] = [
    { name: 'type', type: 'string', required: false, default: 'button' },
    { name: 'variant', type: 'string', required: false, default: 'primary' },
    { name: 'disabled', type: 'bool', required: false, default: false },
];

export const DEFAULT_COMPONENTS: ComponentItem[] = [
    {
        key: 'button',
        fullTag: 'x-button',
        path: 'resources/views/components/button.blade.php',
        isVendor: false,
        type: 'anonymous',
        props: DEFAULT_COMPONENT_PROPS,
    },
    {
        key: 'alert',
        fullTag: 'x-alert',
        path: 'app/View/Components/Alert.php',
        isVendor: false,
        type: 'class',
        class: 'App\\View\\Components\\Alert',
        props: [
            { name: 'type', type: 'string', required: true, default: undefined },
            { name: 'message', type: 'string', required: true, default: undefined },
            { name: 'dismissible', type: 'bool', required: false, default: true },
        ],
    },
    {
        key: 'flux::button',
        fullTag: 'flux:button',
        path: 'vendor/livewire/flux/resources/views/components/button.blade.php',
        isVendor: true,
        type: 'vendor',
        props: [
            { name: 'variant', type: 'string', required: false, default: 'primary' },
            { name: 'size', type: 'string', required: false, default: 'md' },
        ],
    },
];

export const DEFAULT_COMPONENT_PREFIXES: string[] = ['flux'];

export const DEFAULT_DIRECTIVES: CustomDirective[] = [
    {
        name: 'datetime',
        hasParams: true,
        file: 'app/Providers/AppServiceProvider.php',
        line: 25,
    },
    {
        name: 'money',
        hasParams: true,
        file: 'app/Providers/AppServiceProvider.php',
        line: 30,
    },
    {
        name: 'admin',
        hasParams: false,
        file: 'app/Providers/AppServiceProvider.php',
        line: 35,
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
            items: overrides?.views ?? DEFAULT_VIEWS,
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
 * Install mock Laravel data into the context.
 * Call this in `beforeAll` or `beforeEach`.
 */
export function installMockLaravel(overrides?: MockLaravelOverrides): void {
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
        // Context may already be cleared — safe to ignore
        LaravelContext.set(null);
    }
}

/**
 * Run `fn` within a scoped Laravel context (AsyncLocalStorage).
 * Use this in unit tests that call provider functions directly
 * (outside the LSP handler pipeline).
 */
export function withMockLaravel<R>(fn: () => R): R {
    return LaravelContext.provide(fn);
}

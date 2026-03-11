/**
 * E2E tests for Blade component completions (<flux:...> and <livewire:...>).
 *
 * These tests create a real Laravel project, register fake Flux-style vendor
 * components, and verify that the blade-lsp completion engine surfaces them
 * correctly when typing `<flux:` or `<livewire:nested.path`.
 *
 * Run with:
 *   BLADE_COMPONENT_RUN_E2E=true npx vitest run tests/e2e/blade-component-completions.test.ts
 *
 * Optionally set KEEP_BLADE_COMPONENT_E2E_APP=true to preserve the temporary
 * Laravel project for inspection after the test.
 */

import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Client } from '../utils/client';

const execFileAsync = promisify(execFile);
const runE2E = process.env.BLADE_COMPONENT_RUN_E2E === 'true';
const keepApp = process.env.KEEP_BLADE_COMPONENT_E2E_APP === 'true';
const laravelInstaller = process.env.LARAVEL_INSTALLER_PATH ?? 'laravel';

/**
 * Maximum time (ms) to wait for the Laravel integration to finish discovering
 * views and components via PHP scripts. The discovery runs asynchronously after
 * the LSP `initialized` notification.
 */
const laravelDiscoveryTimeoutMs = Number(process.env.BLADE_COMPONENT_DISCOVERY_TIMEOUT_MS ?? '60000');

/**
 * Number of retries for completion requests while waiting for the Laravel
 * discovery to populate views/components.
 */
const completionRetryAttempts = Number(process.env.BLADE_COMPONENT_COMPLETION_RETRY_ATTEMPTS ?? '20');
const completionRetryDelayMs = Number(process.env.BLADE_COMPONENT_COMPLETION_RETRY_DELAY_MS ?? '1000');

const describeIfConfigured = runE2E ? describe : describe.skip;

describeIfConfigured('Blade component completions E2E', () => {
    let sandboxRoot = '';
    let workspaceRoot = '';
    let client: Client;
    const logs: string[] = [];

    beforeAll(async () => {
        sandboxRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-component-e2e-'));
        workspaceRoot = path.join(sandboxRoot, 'component-test-app');
        logs.push(`WORKSPACE_ROOT ${workspaceRoot}`);

        // ── Create Laravel project ──────────────────────────────────────
        await execFileAsync(
            laravelInstaller,
            ['new', 'component-test-app', '--livewire', '--no-interaction', '--no-ansi', '--quiet'],
            {
                cwd: sandboxRoot,
                env: process.env,
                maxBuffer: 10 * 1024 * 1024,
            },
        );

        // ── Set up fake Flux vendor components ──────────────────────────
        // Create component blade files that the PHP discovery script will
        // find once the FakeFluxServiceProvider registers the path.
        const fluxComponentsDir = path.join(workspaceRoot, 'resources', 'views', 'vendor', 'flux', 'components');
        await mkdir(fluxComponentsDir, { recursive: true });

        await writeFile(
            path.join(fluxComponentsDir, 'button.blade.php'),
            `@props(['variant' => 'primary', 'size' => 'md'])
<button {{ $attributes->merge(['class' => 'flux-btn']) }}>
    {{ $slot }}
</button>
`,
            'utf-8',
        );

        await writeFile(
            path.join(fluxComponentsDir, 'input.blade.php'),
            `@props(['label' => null, 'type' => 'text'])
<div>
    @if($label)<label>{{ $label }}</label>@endif
    <input type="{{ $type }}" {{ $attributes }} />
</div>
`,
            'utf-8',
        );

        await writeFile(
            path.join(fluxComponentsDir, 'modal.blade.php'),
            `@props(['name' => null])
<div x-data="{ open: false }" {{ $attributes }}>
    {{ $slot }}
</div>
`,
            'utf-8',
        );

        // Create a service provider that registers the flux component path.
        // In Laravel, Flux does this via Blade::anonymousComponentPath().
        const providersDir = path.join(workspaceRoot, 'app', 'Providers');
        await mkdir(providersDir, { recursive: true });

        await writeFile(
            path.join(providersDir, 'FakeFluxServiceProvider.php'),
            `<?php

namespace App\\Providers;

use Illuminate\\Support\\Facades\\Blade;
use Illuminate\\Support\\ServiceProvider;

class FakeFluxServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Blade::anonymousComponentPath(
            resource_path('views/vendor/flux/components'),
            'flux'
        );
    }
}
`,
            'utf-8',
        );

        // Register the provider in bootstrap/providers.php (Laravel 11+).
        const providersFile = path.join(workspaceRoot, 'bootstrap', 'providers.php');
        await writeFile(
            providersFile,
            `<?php

return [
    App\\Providers\\AppServiceProvider::class,
    App\\Providers\\FakeFluxServiceProvider::class,
];
`,
            'utf-8',
        );

        // ── Set up nested Livewire component ────────────────────────────
        // Create a Livewire component class and view at a nested path.
        const livewireClassDir = path.join(workspaceRoot, 'app', 'Livewire', 'Pages', 'Settings');
        const livewireViewDir = path.join(workspaceRoot, 'resources', 'views', 'livewire', 'pages', 'settings');
        await mkdir(livewireClassDir, { recursive: true });
        await mkdir(livewireViewDir, { recursive: true });

        await writeFile(
            path.join(livewireClassDir, 'DeleteUserForm.php'),
            `<?php

namespace App\\Livewire\\Pages\\Settings;

use Livewire\\Component;

class DeleteUserForm extends Component
{
    public string $password = '';

    public function deleteUser(): void
    {
        // ...
    }

    public function render()
    {
        return view('livewire.pages.settings.delete-user-form');
    }
}
`,
            'utf-8',
        );

        await writeFile(
            path.join(livewireViewDir, 'delete-user-form.blade.php'),
            `<section>
    <form wire:submit="deleteUser">
        <input wire:model="password" type="password" />
        <button type="submit">Delete Account</button>
    </form>
</section>
`,
            'utf-8',
        );

        // ── Start the blade-lsp client ──────────────────────────────────
        client = await createClient({
            rootUri: `file://${workspaceRoot}`,
            settings: {
                enableLaravelIntegration: true,
                phpEnvironment: 'local',
            },
        });

        client.connection.onNotification('window/logMessage', (params) => {
            const raw = JSON.stringify(params);
            logs.push(raw);
        });

        // Wait for Laravel integration to finish discovering components/views.
        // The discovery runs asynchronously after `initialized` and we need
        // to poll until it completes.
        const start = Date.now();
        while (Date.now() - start < laravelDiscoveryTimeoutMs) {
            await delay(1000);
            // Try a test completion to see if discovery has populated components
            const testDoc = await client.open({
                text: '<div>\n<x-\n</div>',
                name: 'resources/views/probe.blade.php',
            });
            const items = await testDoc.completions(1, 3);
            await testDoc.close();

            if (items.length > 0) {
                logs.push(
                    `Laravel discovery completed after ${Date.now() - start}ms, found ${items.length} components`,
                );
                break;
            }
        }
    }, 300000);

    afterAll(async () => {
        if (client) {
            await client.shutdown();
        }
        if (sandboxRoot && !keepApp) {
            await rm(sandboxRoot, { recursive: true, force: true });
        }
    });

    // ─── Flux completions ───────────────────────────────────────────────

    it('provides <flux: completions for registered anonymous component paths', async () => {
        const doc = await client.open({
            text: '<div>\n<flux:\n</div>',
            name: 'resources/views/test-flux.blade.php',
        });

        let items = await doc.completions(1, 6);
        let labels = items.map((i) => i.label);

        for (let attempt = 0; attempt < completionRetryAttempts && !labels.includes('flux:button'); attempt++) {
            await delay(completionRetryDelayMs);
            items = await doc.completions(1, 6);
            labels = items.map((i) => i.label);
            logs.push(`FLUX_COMPLETION_RETRY_${attempt + 1} ${labels.slice(0, 10).join(', ')}`);
        }

        expect(labels, logs.join('\n')).toContain('flux:button');
        expect(labels).toContain('flux:input');
        expect(labels).toContain('flux:modal');

        await doc.close();
    }, 120000);

    it('filters <flux: completions by partial name', async () => {
        const doc = await client.open({
            text: '<div>\n<flux:but\n</div>',
            name: 'resources/views/test-flux-filter.blade.php',
        });

        let items = await doc.completions(1, 9);
        let labels = items.map((i) => i.label);

        for (let attempt = 0; attempt < completionRetryAttempts && !labels.includes('flux:button'); attempt++) {
            await delay(completionRetryDelayMs);
            items = await doc.completions(1, 9);
            labels = items.map((i) => i.label);
        }

        expect(labels, logs.join('\n')).toContain('flux:button');
        expect(labels).not.toContain('flux:input');
        expect(labels).not.toContain('flux:modal');

        await doc.close();
    }, 120000);

    // ─── Livewire completions ───────────────────────────────────────────

    it('provides <livewire: completions for nested livewire components', async () => {
        const doc = await client.open({
            text: '<div>\n<livewire:pages.\n</div>',
            name: 'resources/views/test-livewire.blade.php',
        });

        let items = await doc.completions(1, 17);
        let labels = items.map((i) => i.label);

        for (
            let attempt = 0;
            attempt < completionRetryAttempts && !labels.includes('livewire:pages.settings.delete-user-form');
            attempt++
        ) {
            await delay(completionRetryDelayMs);
            items = await doc.completions(1, 17);
            labels = items.map((i) => i.label);
            logs.push(`LIVEWIRE_COMPLETION_RETRY_${attempt + 1} ${labels.slice(0, 10).join(', ')}`);
        }

        expect(labels, logs.join('\n')).toContain('livewire:pages.settings.delete-user-form');

        await doc.close();
    }, 120000);

    it('filters <livewire: completions by partial nested path', async () => {
        const doc = await client.open({
            text: '<div>\n<livewire:pages.settings.del\n</div>',
            name: 'resources/views/test-livewire-filter.blade.php',
        });

        let items = await doc.completions(1, 31);
        let labels = items.map((i) => i.label);

        for (
            let attempt = 0;
            attempt < completionRetryAttempts && !labels.includes('livewire:pages.settings.delete-user-form');
            attempt++
        ) {
            await delay(completionRetryDelayMs);
            items = await doc.completions(1, 31);
            labels = items.map((i) => i.label);
        }

        expect(labels, logs.join('\n')).toContain('livewire:pages.settings.delete-user-form');

        await doc.close();
    }, 120000);
});

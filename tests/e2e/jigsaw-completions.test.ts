/**
 * E2E tests for Jigsaw project support.
 *
 * These tests create a real Jigsaw (tightenco/jigsaw) project, set up views,
 * components, layouts and partials in the `source/` directory, and verify that
 * blade-lsp's completion engine, diagnostics, and go-to-definition work
 * correctly for Jigsaw projects.
 *
 * Run with:
 *   JIGSAW_RUN_E2E=true npx vitest run tests/e2e/jigsaw-completions.test.ts
 *
 * Optionally set KEEP_JIGSAW_E2E_APP=true to preserve the temporary
 * Jigsaw project for inspection after the test.
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
const runE2E = process.env.JIGSAW_RUN_E2E === 'true';
const keepApp = process.env.KEEP_JIGSAW_E2E_APP === 'true';

/**
 * Maximum time (ms) to wait for the Jigsaw integration to finish discovering
 * views and components via PHP scripts. The discovery runs asynchronously after
 * the LSP `initialized` notification.
 */
const discoveryTimeoutMs = Number(process.env.JIGSAW_DISCOVERY_TIMEOUT_MS ?? '60000');

/**
 * Number of retries for completion/diagnostic requests while waiting for the
 * Jigsaw discovery to populate views/components.
 */
const retryAttempts = Number(process.env.JIGSAW_RETRY_ATTEMPTS ?? '20');
const retryDelayMs = Number(process.env.JIGSAW_RETRY_DELAY_MS ?? '1000');

const describeIfConfigured = runE2E ? describe : describe.skip;

describeIfConfigured('Jigsaw project E2E', () => {
    let sandboxRoot = '';
    let workspaceRoot = '';
    let client: Client;
    const logs: string[] = [];

    beforeAll(async () => {
        sandboxRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-jigsaw-e2e-'));
        workspaceRoot = path.join(sandboxRoot, 'jigsaw-test-app');
        logs.push(`WORKSPACE_ROOT ${workspaceRoot}`);

        // ── Create Jigsaw project ───────────────────────────────────────
        await mkdir(workspaceRoot, { recursive: true });

        await writeFile(
            path.join(workspaceRoot, 'composer.json'),
            JSON.stringify(
                {
                    name: 'test/jigsaw-e2e',
                    description: 'Blade LSP Jigsaw E2E test fixture',
                    require: {
                        'tightenco/jigsaw': '^1.3',
                    },
                },
                null,
                2,
            ),
            'utf-8',
        );

        await execFileAsync('composer', ['install', '--no-interaction', '--no-ansi', '--quiet'], {
            cwd: workspaceRoot,
            env: process.env,
            maxBuffer: 10 * 1024 * 1024,
        });

        // ── Create Jigsaw config ────────────────────────────────────────
        await writeFile(
            path.join(workspaceRoot, 'config.php'),
            `<?php

return [
    'production' => false,
    'baseUrl' => '',
    'title' => 'Blade LSP E2E Test',
];
`,
            'utf-8',
        );

        // ── Create source directory structure ───────────────────────────
        const sourcePath = path.join(workspaceRoot, 'source');
        await mkdir(path.join(sourcePath, '_layouts'), { recursive: true });
        await mkdir(path.join(sourcePath, '_components'), { recursive: true });
        await mkdir(path.join(sourcePath, '_partials'), { recursive: true });

        // ── Layout ──────────────────────────────────────────────────────
        await writeFile(
            path.join(sourcePath, '_layouts', 'main.blade.php'),
            `<!DOCTYPE html>
<html>
<head><title>@yield('title')</title></head>
<body>
    @include('_partials.nav')
    @yield('content')
    @include('_partials.footer')
</body>
</html>
`,
            'utf-8',
        );

        // ── Components ──────────────────────────────────────────────────
        await writeFile(
            path.join(sourcePath, '_components', 'alert.blade.php'),
            `@props(['type' => 'info', 'message' => ''])
<div class="alert alert-{{ $type }}">
    {{ $message ?? $slot }}
</div>
`,
            'utf-8',
        );

        await writeFile(
            path.join(sourcePath, '_components', 'button.blade.php'),
            `@props(['variant' => 'primary', 'size' => 'md'])
<button class="btn btn-{{ $variant }} btn-{{ $size }}">
    {{ $slot }}
</button>
`,
            'utf-8',
        );

        // ── Partials ────────────────────────────────────────────────────
        await writeFile(
            path.join(sourcePath, '_partials', 'nav.blade.php'),
            `<nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
</nav>
`,
            'utf-8',
        );

        await writeFile(
            path.join(sourcePath, '_partials', 'footer.blade.php'),
            `<footer>
    <p>&copy; {{ date('Y') }} Test Site</p>
</footer>
`,
            'utf-8',
        );

        // ── Pages ───────────────────────────────────────────────────────
        await writeFile(
            path.join(sourcePath, 'about.blade.php'),
            `@extends('_layouts.main')

@section('title', 'About')

@section('content')
    <h1>About Page</h1>
    @include('_partials.nav')
@endsection
`,
            'utf-8',
        );

        await writeFile(
            path.join(sourcePath, 'contact.blade.php'),
            `@extends('_layouts.main')

@section('content')
    <h1>Contact</h1>
@endsection
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

        // Wait for Jigsaw integration to finish discovering views/components.
        // The discovery runs asynchronously after `initialized` and we need
        // to poll until it completes.
        const start = Date.now();
        while (Date.now() - start < discoveryTimeoutMs) {
            await delay(1000);
            const testDoc = await client.open({
                text: '<div>\n<x-\n</div>',
                name: 'source/probe.blade.php',
            });
            const items = await testDoc.completions(1, 3);
            await testDoc.close();

            if (items.length > 0) {
                logs.push(`Jigsaw discovery completed after ${Date.now() - start}ms, found ${items.length} components`);
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

    // ─── View completions ───────────────────────────────────────────────

    it('provides view completions for @include', async () => {
        const doc = await client.open({
            text: "@include('')",
            name: 'source/test-include.blade.php',
        });

        let items = await doc.completions(0, 10);
        let labels = items.map((i) => i.label);

        for (let attempt = 0; attempt < retryAttempts && !labels.includes('_partials.nav'); attempt++) {
            await delay(retryDelayMs);
            items = await doc.completions(0, 10);
            labels = items.map((i) => i.label);
            logs.push(`VIEW_COMPLETION_RETRY_${attempt + 1} ${labels.slice(0, 15).join(', ')}`);
        }

        expect(labels, logs.join('\n')).toContain('_partials.nav');
        expect(labels).toContain('_partials.footer');
        expect(labels).toContain('_layouts.main');

        await doc.close();
    }, 120000);

    it('provides layout completions for @extends', async () => {
        const doc = await client.open({
            text: "@extends('')",
            name: 'source/test-extends.blade.php',
        });

        let items = await doc.completions(0, 10);
        let labels = items.map((i) => i.label);

        for (let attempt = 0; attempt < retryAttempts && !labels.includes('_layouts.main'); attempt++) {
            await delay(retryDelayMs);
            items = await doc.completions(0, 10);
            labels = items.map((i) => i.label);
            logs.push(`EXTENDS_COMPLETION_RETRY_${attempt + 1} ${labels.slice(0, 15).join(', ')}`);
        }

        expect(labels, logs.join('\n')).toContain('_layouts.main');

        await doc.close();
    }, 120000);

    // ─── Component completions ──────────────────────────────────────────

    it('provides <x- completions for Jigsaw anonymous components', async () => {
        const doc = await client.open({
            text: '<div>\n<x-\n</div>',
            name: 'source/test-components.blade.php',
        });

        let items = await doc.completions(1, 3);
        let labels = items.map((i) => i.label);

        for (let attempt = 0; attempt < retryAttempts && !labels.includes('x-alert'); attempt++) {
            await delay(retryDelayMs);
            items = await doc.completions(1, 3);
            labels = items.map((i) => i.label);
            logs.push(`COMPONENT_COMPLETION_RETRY_${attempt + 1} ${labels.slice(0, 15).join(', ')}`);
        }

        expect(labels, logs.join('\n')).toContain('x-alert');
        expect(labels).toContain('x-button');

        await doc.close();
    }, 120000);

    it('filters <x- completions by partial name', async () => {
        const doc = await client.open({
            text: '<div>\n<x-ale\n</div>',
            name: 'source/test-component-filter.blade.php',
        });

        let items = await doc.completions(1, 6);
        let labels = items.map((i) => i.label);

        for (let attempt = 0; attempt < retryAttempts && !labels.includes('x-alert'); attempt++) {
            await delay(retryDelayMs);
            items = await doc.completions(1, 6);
            labels = items.map((i) => i.label);
        }

        expect(labels, logs.join('\n')).toContain('x-alert');
        expect(labels).not.toContain('x-button');

        await doc.close();
    }, 120000);

    // ─── Diagnostics ────────────────────────────────────────────────────

    it('reports undefined view reference', async () => {
        const doc = await client.open({
            text: "@include('nonexistent.view')",
            name: 'source/test-diag-undef-view.blade.php',
        });

        await delay(2000);
        let diags = await doc.diagnostics();
        let undefinedViews = diags.filter((d) => d.code === 'blade/undefined-view');

        for (let attempt = 0; attempt < retryAttempts && undefinedViews.length === 0; attempt++) {
            await delay(retryDelayMs);
            await doc.update("@include('nonexistent.view')");
            diags = await doc.diagnostics();
            undefinedViews = diags.filter((d) => d.code === 'blade/undefined-view');
            logs.push(`DIAG_VIEW_RETRY_${attempt + 1} total=${diags.length} undefined=${undefinedViews.length}`);
        }

        expect(undefinedViews.length, logs.join('\n')).toBeGreaterThan(0);
        expect(undefinedViews[0].message).toContain('nonexistent.view');

        await doc.close();
    }, 120000);

    it('does not report diagnostic for known views', async () => {
        const doc = await client.open({
            text: "@include('_partials.nav')",
            name: 'source/test-diag-known-view.blade.php',
        });

        await delay(3000);
        let diags = await doc.diagnostics();
        let undefinedViews = diags.filter((d) => d.code === 'blade/undefined-view');

        // If discovery hasn't completed, we might get false positives — retry
        if (undefinedViews.length > 0) {
            for (let attempt = 0; attempt < retryAttempts; attempt++) {
                await delay(retryDelayMs);
                await doc.update("@include('_partials.nav')");
                diags = await doc.diagnostics();
                undefinedViews = diags.filter((d) => d.code === 'blade/undefined-view');
                if (undefinedViews.length === 0) break;
                logs.push(
                    `DIAG_KNOWN_VIEW_RETRY_${attempt + 1} total=${diags.length} undefined=${undefinedViews.length}`,
                );
            }
        }

        expect(undefinedViews, logs.join('\n')).toEqual([]);

        await doc.close();
    }, 120000);

    it('reports undefined component', async () => {
        const doc = await client.open({
            text: '<x-nonexistent />',
            name: 'source/test-diag-undef-comp.blade.php',
        });

        await delay(2000);
        let diags = await doc.diagnostics();
        let undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');

        for (let attempt = 0; attempt < retryAttempts && undefinedComponents.length === 0; attempt++) {
            await delay(retryDelayMs);
            await doc.update('<x-nonexistent />');
            diags = await doc.diagnostics();
            undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
            logs.push(`DIAG_COMP_RETRY_${attempt + 1} total=${diags.length} undefined=${undefinedComponents.length}`);
        }

        expect(undefinedComponents.length, logs.join('\n')).toBeGreaterThan(0);

        await doc.close();
    }, 120000);

    it('does not report diagnostic for known components', async () => {
        const doc = await client.open({
            text: '<x-alert type="info">Hello</x-alert>',
            name: 'source/test-diag-known-comp.blade.php',
        });

        await delay(3000);
        let diags = await doc.diagnostics();
        let undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');

        if (undefinedComponents.length > 0) {
            for (let attempt = 0; attempt < retryAttempts; attempt++) {
                await delay(retryDelayMs);
                await doc.update('<x-alert type="info">Hello</x-alert>');
                diags = await doc.diagnostics();
                undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
                if (undefinedComponents.length === 0) break;
                logs.push(
                    `DIAG_KNOWN_COMP_RETRY_${attempt + 1} total=${diags.length} undefined=${undefinedComponents.length}`,
                );
            }
        }

        expect(undefinedComponents, logs.join('\n')).toEqual([]);

        await doc.close();
    }, 120000);

    // ─── Definitions ────────────────────────────────────────────────────

    it('resolves @include view reference to source file', async () => {
        const doc = await client.open({
            text: "@include('_partials.nav')",
            name: 'source/test-def-view.blade.php',
        });

        await delay(2000);

        // Position cursor inside the view name string
        let def = await doc.definition(0, 14);

        for (let attempt = 0; attempt < retryAttempts && !def; attempt++) {
            await delay(retryDelayMs);
            def = await doc.definition(0, 14);
            logs.push(`DEF_VIEW_RETRY_${attempt + 1} ${JSON.stringify(def)}`);
        }

        expect(def, logs.join('\n')).not.toBeNull();
        if (def && !Array.isArray(def)) {
            expect(def.uri).toContain('source/_partials/nav.blade.php');
        }

        await doc.close();
    }, 120000);

    it('resolves <x-alert> component tag to source file', async () => {
        const doc = await client.open({
            text: '<x-alert type="info">Hello</x-alert>',
            name: 'source/test-def-component.blade.php',
        });

        await delay(2000);

        // Position cursor on the component tag name
        let def = await doc.definition(0, 4);

        for (let attempt = 0; attempt < retryAttempts && !def; attempt++) {
            await delay(retryDelayMs);
            def = await doc.definition(0, 4);
            logs.push(`DEF_COMP_RETRY_${attempt + 1} ${JSON.stringify(def)}`);
        }

        expect(def, logs.join('\n')).not.toBeNull();
        if (def && !Array.isArray(def)) {
            expect(def.uri).toContain('source/_components/alert.blade.php');
        }

        await doc.close();
    }, 120000);
});

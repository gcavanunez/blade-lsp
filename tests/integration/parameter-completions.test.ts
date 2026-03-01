import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Parameter Completions (Integration)', () => {
    let client: Client;
    let workspaceRoot = '';

    beforeAll(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-parameter-completions-'));

        client = await createClient({
            rootUri: `file://${workspaceRoot}`,
            settings: {
                enableLaravelIntegration: false,
            },
        });
        installMockLaravel();
    });

    afterAll(async () => {
        await client.shutdown();
        clearMockLaravel();
        if (workspaceRoot) {
            await rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    describe('parameter completions', () => {
        const cases = [
            {
                name: 'provides view names for @extends',
                text: "@extends('",
                character: 10,
                expectedLabels: ['layouts.app', 'partials.header'],
            },
            {
                name: 'provides view names for @extends before opening quote',
                text: '@extends(',
                character: 9,
                expectedLabels: ['layouts.app', 'partials.header'],
            },
            {
                name: 'provides view names for @includeIf',
                text: "@includeIf('",
                character: 12,
                expectedLabels: ['layouts.app'],
            },
            {
                name: 'provides HTTP method suggestions before opening quote',
                text: '@method(',
                character: 8,
                expectedLabels: ['PUT', 'PATCH', 'DELETE'],
            },
            {
                name: 'provides view names for @includeFirst',
                text: "@includeFirst('",
                character: 15,
                expectedLabels: ['layouts.app'],
            },
            {
                name: 'provides section name suggestions',
                text: "@section('",
                character: 10,
                expectedLabels: ['content', 'title', 'scripts', 'styles'],
            },
            {
                name: 'provides yield name suggestions',
                text: "@yield('",
                character: 8,
                expectedLabels: ['content', 'title'],
            },
            {
                name: 'provides permission suggestions for @can',
                text: "@can('",
                character: 6,
                expectedLabels: ['view', 'create', 'update', 'delete'],
            },
            {
                name: 'provides permission suggestions for @cannot',
                text: "@cannot('",
                character: 9,
                expectedLabels: ['view', 'delete'],
            },
            {
                name: 'provides permission suggestions for @canany',
                text: "@canany('",
                character: 9,
                expectedLabels: ['view'],
            },
            {
                name: 'provides environment name suggestions',
                text: "@env('",
                character: 6,
                expectedLabels: ['local', 'production', 'staging'],
            },
            {
                name: 'provides HTTP method suggestions',
                text: "@method('",
                character: 9,
                expectedLabels: ['PUT', 'PATCH', 'DELETE'],
            },
            {
                name: 'provides stack name suggestions for @push',
                text: "@push('",
                character: 7,
                expectedLabels: ['scripts', 'styles'],
            },
            {
                name: 'provides stack name suggestions for @stack',
                text: "@stack('",
                character: 8,
                expectedLabels: ['scripts', 'styles'],
            },
            {
                name: 'provides common slot name suggestions',
                text: "@slot('",
                character: 7,
                expectedLabels: ['header', 'footer', 'title'],
            },
            {
                name: 'provides livewire component name suggestions',
                text: "@livewire('",
                character: 11,
                expectedLabels: ['counter', 'search-bar'],
            },
        ] as const;

        it.each(cases)('$name', async ({ text, character, expectedLabels }) => {
            const doc = await client.open({ text });
            const items = await doc.completions(0, character);
            const labels = items.map((i) => i.label);

            for (const expectedLabel of expectedLabels) {
                expect(labels).toContain(expectedLabel);
            }

            await doc.close();
        });
    });

    describe('parameter completions inside block directives', () => {
        const nestedCases = [
            {
                name: '@include inside @section block',
                text: "@extends('_layouts.main')\n\n@section('body')\n    @include('\n@endsection",
                line: 3,
                character: 14,
                expectedLabels: ['layouts.app'],
            },
            {
                name: '@include after @props',
                text: "@props(['title'])\n\n@include('",
                line: 2,
                character: 10,
                expectedLabels: ['layouts.app'],
            },
            {
                name: '@include after @props inside section',
                text: "@props(['title'])\n\n@section('body')\n    @include('\n@endsection",
                line: 3,
                character: 14,
                expectedLabels: ['layouts.app'],
            },
        ] as const;

        it.each(nestedCases)('$name', async ({ text, line, character, expectedLabels }) => {
            const doc = await client.open({ text });
            const items = await doc.completions(line, character);
            const labels = items.map((i) => i.label);

            for (const expectedLabel of expectedLabels) {
                expect(labels, `Got labels: [${labels.join(', ')}]`).toContain(expectedLabel);
            }

            await doc.close();
        });
    });

    describe('layout-aware section and stack completions', () => {
        beforeAll(async () => {
            const layoutPath = path.join(workspaceRoot, 'resources', 'views', 'layouts');
            await mkdir(layoutPath, { recursive: true });
            await writeFile(
                path.join(layoutPath, 'app.blade.php'),
                `<html>\n<body>\n@yield('hero')\n@yield('content')\n@yield("sidebar")\n@stack('head')\n@stack("scripts")\n</body>\n</html>\n`,
                'utf-8',
            );

            installMockLaravel({
                project: {
                    root: workspaceRoot,
                },
                views: [
                    {
                        key: 'layouts.app',
                        path: 'resources/views/layouts/app.blade.php',
                        isVendor: false,
                    },
                ],
            });
        });

        it('offers section names from the parent layout', async () => {
            const doc = await client.open({
                name: 'resources/views/users/index.blade.php',
                text: "@extends('layouts.app')\n@section('",
            });

            const items = await doc.completions(1, 10);
            const labels = items.map((item) => item.label);

            expect(labels).toContain('hero');
            expect(labels).toContain('content');
            expect(labels).toContain('sidebar');

            await doc.close();
        });

        it('offers stack names from the parent layout', async () => {
            const doc = await client.open({
                name: 'resources/views/users/index.blade.php',
                text: "@extends('layouts.app')\n@push('",
            });

            const items = await doc.completions(1, 7);
            const labels = items.map((item) => item.label);

            expect(labels).toContain('head');
            expect(labels).toContain('scripts');

            await doc.close();
        });
    });
});

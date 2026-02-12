import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Parameter Completions (Integration)', () => {
    let client: Client;

    beforeAll(async () => {
        client = await createClient({
            settings: {
                parserBackend: 'wasm',
                enableLaravelIntegration: false,
            },
        });
        installMockLaravel();
    });

    afterAll(async () => {
        await client.shutdown();
        clearMockLaravel();
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
                name: 'provides view names for @includeIf',
                text: "@includeIf('",
                character: 12,
                expectedLabels: ['layouts.app'],
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
});

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

    // ─── View-based parameter completions ───────────────────────────────────

    describe('view reference directives', () => {
        it('provides view names for @extends', async () => {
            const doc = await client.open({
                text: "@extends('",
            });

            const items = await doc.completions(0, 10);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('layouts.app');
            expect(labels).toContain('partials.header');

            await doc.close();
        });

        it('provides view names for @includeIf', async () => {
            const doc = await client.open({
                text: "@includeIf('",
            });

            const items = await doc.completions(0, 12);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('layouts.app');

            await doc.close();
        });

        it('provides view names for @includeFirst', async () => {
            const doc = await client.open({
                text: "@includeFirst('",
            });

            const items = await doc.completions(0, 15);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('layouts.app');

            await doc.close();
        });
    });

    // ─── Static parameter completions ───────────────────────────────────────

    describe('@section parameter completions', () => {
        it('provides section name suggestions', async () => {
            const doc = await client.open({
                text: "@section('",
            });

            const items = await doc.completions(0, 10);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('content');
            expect(labels).toContain('title');
            expect(labels).toContain('scripts');
            expect(labels).toContain('styles');

            await doc.close();
        });
    });

    describe('@yield parameter completions', () => {
        it('provides yield name suggestions', async () => {
            const doc = await client.open({
                text: "@yield('",
            });

            const items = await doc.completions(0, 8);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('content');
            expect(labels).toContain('title');

            await doc.close();
        });
    });

    describe('@can parameter completions', () => {
        it('provides permission suggestions for @can', async () => {
            const doc = await client.open({
                text: "@can('",
            });

            const items = await doc.completions(0, 6);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('view');
            expect(labels).toContain('create');
            expect(labels).toContain('update');
            expect(labels).toContain('delete');

            await doc.close();
        });

        it('provides permission suggestions for @cannot', async () => {
            const doc = await client.open({
                text: "@cannot('",
            });

            const items = await doc.completions(0, 9);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('view');
            expect(labels).toContain('delete');

            await doc.close();
        });

        it('provides permission suggestions for @canany', async () => {
            const doc = await client.open({
                text: "@canany('",
            });

            const items = await doc.completions(0, 9);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('view');

            await doc.close();
        });
    });

    describe('@env parameter completions', () => {
        it('provides environment name suggestions', async () => {
            const doc = await client.open({
                text: "@env('",
            });

            const items = await doc.completions(0, 6);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('local');
            expect(labels).toContain('production');
            expect(labels).toContain('staging');

            await doc.close();
        });
    });

    describe('@method parameter completions', () => {
        it('provides HTTP method suggestions', async () => {
            const doc = await client.open({
                text: "@method('",
            });

            const items = await doc.completions(0, 9);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('PUT');
            expect(labels).toContain('PATCH');
            expect(labels).toContain('DELETE');

            await doc.close();
        });
    });

    describe('@push / @stack parameter completions', () => {
        it('provides stack name suggestions for @push', async () => {
            const doc = await client.open({
                text: "@push('",
            });

            const items = await doc.completions(0, 7);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('scripts');
            expect(labels).toContain('styles');

            await doc.close();
        });

        it('provides stack name suggestions for @stack', async () => {
            const doc = await client.open({
                text: "@stack('",
            });

            const items = await doc.completions(0, 8);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('scripts');
            expect(labels).toContain('styles');

            await doc.close();
        });
    });

    describe('@slot parameter completions', () => {
        it('provides common slot name suggestions', async () => {
            const doc = await client.open({
                text: "@slot('",
            });

            const items = await doc.completions(0, 7);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('header');
            expect(labels).toContain('footer');
            expect(labels).toContain('title');

            await doc.close();
        });
    });

    describe('@livewire parameter completions', () => {
        it('provides livewire component name suggestions', async () => {
            const doc = await client.open({
                text: "@livewire('",
            });

            const items = await doc.completions(0, 11);
            const labels = items.map((i) => i.label);
            expect(labels).toContain('counter');
            expect(labels).toContain('search-bar');

            await doc.close();
        });
    });
});

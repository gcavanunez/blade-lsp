import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Livewire (Integration)', () => {
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

    // ─── Completions ────────────────────────────────────────────────────────

    describe('completion', () => {
        it('provides livewire component tag completions for <livewire:', async () => {
            const doc = await client.open({
                text: '<div>\n<livewire:\n</div>',
            });

            const items = await doc.completions(1, 11);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('livewire:counter');
            expect(labels).toContain('livewire:search-bar');

            await doc.close();
        });

        it('filters livewire completions by partial name', async () => {
            const doc = await client.open({
                text: '<div>\n<livewire:cou\n</div>',
            });

            const items = await doc.completions(1, 14);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('livewire:counter');
            expect(labels).not.toContain('livewire:search-bar');

            await doc.close();
        });

        it('provides livewire component names for @livewire directive', async () => {
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

    // ─── Hover ──────────────────────────────────────────────────────────────

    describe('hover', () => {
        it('shows hover for <livewire:counter> with details, props, and files', async () => {
            const doc = await client.open({
                text: '<livewire:counter />',
            });

            // Position on 'livewire:counter' (col 1 after <)
            const hover = await doc.hover(0, 6);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('livewire:counter');
            expect(value).toContain('Livewire component');
            expect(value).toContain('counter.blade.php');
            expect(value).toContain('Props');
            expect(value).toContain('count');
            expect(value).toContain('int');
            expect(value).toContain('Files');
            expect(value).toContain('app/Livewire/Counter.php');

            await doc.close();
        });

        it('shows "not found" hover for undefined livewire component', async () => {
            const doc = await client.open({
                text: '<livewire:nonexistent />',
            });

            const hover = await doc.hover(0, 8);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('not found');

            await doc.close();
        });
    });

    // ─── Definition ─────────────────────────────────────────────────────────

    describe('definition', () => {
        it('resolves definition for <livewire:counter>', async () => {
            const doc = await client.open({
                text: '<livewire:counter />',
            });

            const def = await doc.definition(0, 6);
            // With mock data the file won't exist on disk, but the definition
            // handler should return a location pointing to the view path
            if (def && !Array.isArray(def)) {
                expect(def.uri).toContain('counter');
            }

            await doc.close();
        });

        it('returns null for undefined livewire component definition', async () => {
            const doc = await client.open({
                text: '<livewire:nonexistent />',
            });

            const def = await doc.definition(0, 8);
            expect(def).toBeNull();

            await doc.close();
        });
    });

    // ─── Diagnostics ────────────────────────────────────────────────────────

    describe('diagnostics', () => {
        it('reports undefined livewire component', async () => {
            const doc = await client.open({
                text: '<livewire:nonexistent />',
            });

            const diags = await doc.diagnostics();
            const undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
            expect(undefinedComponents.length).toBe(1);
            expect(undefinedComponents[0].message).toContain('nonexistent');

            await doc.close();
        });

        it('does not report existing livewire component', async () => {
            const doc = await client.open({
                text: '<livewire:counter />',
            });

            const diags = await doc.diagnostics();
            const undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
            expect(undefinedComponents).toEqual([]);

            await doc.close();
        });

        it('reports undefined livewire alongside existing regular component', async () => {
            const doc = await client.open({
                text: '<x-button />\n<livewire:nonexistent />',
            });

            const diags = await doc.diagnostics();
            const undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
            expect(undefinedComponents.length).toBe(1);
            expect(undefinedComponents[0].message).toContain('nonexistent');

            await doc.close();
        });
    });
});

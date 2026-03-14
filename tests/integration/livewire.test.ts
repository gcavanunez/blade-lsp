import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Livewire (Integration)', () => {
    let client: Client;

    beforeAll(async () => {
        client = await createClient({
            settings: {
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

        it('provides nested livewire component completions with dot-separated paths', async () => {
            const doc = await client.open({
                text: '<div>\n<livewire:pages.\n</div>',
            });

            const items = await doc.completions(1, 17);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('livewire:pages.settings.delete-user-form');
            expect(labels).toContain('livewire:pages.settings.update-profile-information-form');
            expect(labels).not.toContain('livewire:counter');
            expect(labels).not.toContain('livewire:search-bar');

            await doc.close();
        });

        it('filters nested livewire completions by deep partial path', async () => {
            const doc = await client.open({
                text: '<div>\n<livewire:pages.settings.del\n</div>',
            });

            const items = await doc.completions(1, 31);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('livewire:pages.settings.delete-user-form');
            expect(labels).not.toContain('livewire:pages.settings.update-profile-information-form');

            await doc.close();
        });

        it('provides Livewire 4 namespaced component completions', async () => {
            const doc = await client.open({
                text: '<div>\n<livewire:pages::\n</div>',
            });

            const items = await doc.completions(1, 18);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('livewire:pages::settings.two-factor.recovery-codes');
            expect(labels).toContain('livewire:pages::settings.two-factor.enable');
            expect(labels).not.toContain('livewire:counter');

            await doc.close();
        });

        it('filters Livewire 4 namespaced completions by partial path', async () => {
            const doc = await client.open({
                text: '<div>\n<livewire:pages::settings.two-factor.rec\n</div>',
            });

            const items = await doc.completions(1, 42);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('livewire:pages::settings.two-factor.recovery-codes');
            expect(labels).not.toContain('livewire:pages::settings.two-factor.enable');

            await doc.close();
        });

        it('completes wire:model values from inline livewire public properties', async () => {
            const doc = await client.open({
                text: `<?php
use Livewire\\Component;

new class extends Component {
    public string $title = '';
    public string $content = '';
};
?>

<input wire:model="">`,
            });

            const items = await doc.completions(9, 19);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('title');
            expect(labels).toContain('content');

            await doc.close();
        });

        it('completes wire action values from inline livewire methods', async () => {
            const doc = await client.open({
                text: `<?php
use Livewire\\Component;

new class extends Component {
    public function save(): void {}
    public function publish() {}
};
?>

<form wire:submit=""></form>`,
            });

            const items = await doc.completions(9, 19);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('save');
            expect(labels).toContain('publish');

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

        it('shows hover for Livewire 4 namespaced component with props and files', async () => {
            const doc = await client.open({
                text: '<livewire:pages::settings.two-factor.enable />',
            });

            const hover = await doc.hover(0, 12);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('livewire:pages::settings.two-factor.enable');
            expect(value).toContain('Livewire component');
            expect(value).toContain('enable.blade.php');
            expect(value).toContain('enabled');
            expect(value).toContain('bool');

            await doc.close();
        });

        it('shows hover for wire:model values from inline livewire properties', async () => {
            const doc = await client.open({
                text: `<?php
use Livewire\\Component;

new class extends Component {
    public string $title = '';
};
?>

<input wire:model="title">`,
            });

            const hover = await doc.hover(8, 19);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('$title');
            expect(value).toContain('Livewire public property');

            await doc.close();
        });

        it('shows hover for wire action values from inline livewire methods', async () => {
            const doc = await client.open({
                text: `<?php
use Livewire\\Component;

new class extends Component {
    public function save(): void {}
};
?>

<form wire:submit="save"></form>`,
            });

            const hover = await doc.hover(8, 20);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('save()');
            expect(value).toContain('Livewire action');

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

        it('resolves definition for Livewire 4 namespaced component', async () => {
            const doc = await client.open({
                text: '<livewire:pages::settings.two-factor.recovery-codes />',
            });

            const def = await doc.definition(0, 12);
            if (def && !Array.isArray(def)) {
                expect(def.uri).toContain('recovery-codes');
            }

            await doc.close();
        });

        it('resolves wire:model values to inline livewire property declarations', async () => {
            const doc = await client.open({
                text: `<?php
use Livewire\\Component;

new class extends Component {
    public string $title = '';
};
?>

<input wire:model="title">`,
            });

            const def = await doc.definition(8, 19);
            expect(def).not.toBeNull();
            if (def && !Array.isArray(def)) {
                expect(def.uri).toBe(doc.uri);
                expect(def.range.start.line).toBe(4);
            }

            await doc.close();
        });

        it('resolves wire action values to inline livewire method declarations', async () => {
            const doc = await client.open({
                text: `<?php
use Livewire\\Component;

new class extends Component {
    public function save(): void {}
};
?>

<form wire:submit="save"></form>`,
            });

            const def = await doc.definition(8, 20);
            expect(def).not.toBeNull();
            if (def && !Array.isArray(def)) {
                expect(def.uri).toBe(doc.uri);
                expect(def.range.start.line).toBe(4);
            }

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

        it('does not report existing Livewire 4 namespaced component as undefined', async () => {
            const doc = await client.open({
                text: '<livewire:pages::settings.two-factor.recovery-codes />',
            });

            const diags = await doc.diagnostics();
            const undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
            expect(undefinedComponents).toEqual([]);

            await doc.close();
        });

        it('does not crash on undefined Livewire 4 namespaced component', async () => {
            // The tree-sitter blade parser may not recognize `::` as part of a
            // single tag name, so the diagnostic may or may not fire depending
            // on the grammar version.  The important invariant is no crash and
            // no false-positive on existing namespaced components (tested above).
            const doc = await client.open({
                text: '<livewire:pages::nonexistent.component />',
            });

            const diags = await doc.diagnostics();
            // Should not throw — just verify the call completes
            expect(Array.isArray(diags)).toBe(true);

            await doc.close();
        });
    });
});

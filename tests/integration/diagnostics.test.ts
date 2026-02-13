import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Diagnostics (Integration)', () => {
    let client: Client;

    beforeAll(async () => {
        client = await createClient({
            settings: {
                parserBackend: 'wasm',
                enableLaravelIntegration: false,
            },
        });
    });

    afterAll(async () => {
        await client.shutdown();
    });

    describe('unclosed directives', () => {
        it('reports unclosed @if', async () => {
            const doc = await client.open({
                text: '@if($show)\n  <p>test</p>',
            });

            const diags = await doc.diagnostics();
            const unclosed = diags.filter((d) => d.code === 'blade/unclosed-directive');
            expect(unclosed.length).toBeGreaterThan(0);
            expect(unclosed[0].message).toContain('@if');

            await doc.close();
        });

        it('reports no diagnostics for properly closed directives', async () => {
            const doc = await client.open({
                text: '@if($show)\n  <p>test</p>\n@endif',
            });

            const diags = await doc.diagnostics();
            const unclosed = diags.filter((d) => d.code === 'blade/unclosed-directive');
            expect(unclosed).toEqual([]);

            await doc.close();
        });
    });

    describe('invalid @method', () => {
        it('reports invalid HTTP method', async () => {
            const doc = await client.open({
                text: "<form>\n@method('INVALID')\n</form>",
            });

            const diags = await doc.diagnostics();
            const invalid = diags.filter((d) => d.code === 'blade/invalid-method');
            expect(invalid.length).toBe(1);

            await doc.close();
        });

        it('accepts valid HTTP methods', async () => {
            const doc = await client.open({
                text: "<form>\n@method('PUT')\n</form>",
            });

            const diags = await doc.diagnostics();
            const invalid = diags.filter((d) => d.code === 'blade/invalid-method');
            expect(invalid).toEqual([]);

            await doc.close();
        });
    });

    describe('undefined views with Laravel mock', () => {
        beforeAll(() => {
            installMockLaravel();
        });

        afterAll(() => {
            clearMockLaravel();
        });

        it('reports undefined view in @include', async () => {
            const doc = await client.open({
                text: "@include('nonexistent.view')",
            });

            const diags = await doc.diagnostics();
            const undefinedViews = diags.filter((d) => d.code === 'blade/undefined-view');
            expect(undefinedViews.length).toBe(1);

            await doc.close();
        });

        it('accepts existing view in @include', async () => {
            const doc = await client.open({
                text: "@include('layouts.app')",
            });

            const diags = await doc.diagnostics();
            const undefinedViews = diags.filter((d) => d.code === 'blade/undefined-view');
            expect(undefinedViews).toEqual([]);

            await doc.close();
        });

        it('reports undefined component', async () => {
            const doc = await client.open({
                text: '<x-nonexistent />',
            });

            const diags = await doc.diagnostics();
            const undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
            expect(undefinedComponents.length).toBe(1);

            await doc.close();
        });

        it('accepts existing component', async () => {
            const doc = await client.open({
                text: '<x-button />',
            });

            const diags = await doc.diagnostics();
            const undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
            expect(undefinedComponents).toEqual([]);

            await doc.close();
        });
    });

    describe('document updates', () => {
        it('updates diagnostics when document content changes', async () => {
            const doc = await client.open({
                text: '@if($show)\n  <p>test</p>\n@endif',
            });

            let diags = await doc.diagnostics();
            let unclosed = diags.filter((d) => d.code === 'blade/unclosed-directive');
            expect(unclosed).toEqual([]);

            await doc.update('@if($show)\n  <p>test</p>');
            diags = await doc.diagnostics();
            unclosed = diags.filter((d) => d.code === 'blade/unclosed-directive');
            expect(unclosed.length).toBeGreaterThan(0);

            await doc.close();
        });

        it('does not report syntax errors for @ in email placeholder text', async () => {
            const doc = await client.open({
                text: '<input type="email" placeholder="name@example.com" />',
            });

            const diags = await doc.diagnostics();
            const syntaxErrors = diags.filter((d) => d.message === 'Syntax error');
            expect(syntaxErrors).toEqual([]);

            await doc.close();
        });

        it('does not report syntax errors for component email placeholder before :value', async () => {
            const doc = await client.open({
                text: '<flux:input name="email" placeholder="you@example.com" :value="old(\'email\')" />',
            });

            const diags = await doc.diagnostics();
            const syntaxErrors = diags.filter((d) => d.message === 'Syntax error');
            expect(syntaxErrors).toEqual([]);

            await doc.close();
        });

        it('does not report syntax errors for @ in quoted data-action values', async () => {
            const doc = await client.open({
                text: '<button data-action="password-reveal#toggle turbo:before-cache@document->password-reveal#reset"></button>',
            });

            const diags = await doc.diagnostics();
            const syntaxErrors = diags.filter((d) => d.message === 'Syntax error');
            expect(syntaxErrors).toEqual([]);

            await doc.close();
        });

        it('does not report syntax errors for inline @if attribute directives', async () => {
            const doc = await client.open({
                text: "<html @if (session('theme')) data-theme=\"{{ session('theme') }}\" @endif>",
            });

            const diags = await doc.diagnostics();
            const syntaxErrors = diags.filter((d) => d.message === 'Syntax error');
            expect(syntaxErrors).toEqual([]);

            await doc.close();
        });

        it('does not report syntax errors for plain email text in a footer', async () => {
            const doc = await client.open({
                text: '<footer><p>Contact: support@example.com</p></footer>',
            });

            const diags = await doc.diagnostics();
            const syntaxErrors = diags.filter((d) => d.message === 'Syntax error');
            expect(syntaxErrors).toEqual([]);

            await doc.close();
        });
    });
});

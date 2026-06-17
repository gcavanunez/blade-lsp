/**
 * Laravel Context Integration Tests
 *
 * These tests verify that LaravelContext state is correctly available
 * to every LSP handler through the Effect service container.
 *
 * Each test sends a real LSP request through the protocol and asserts that
 * the response contains data that is ONLY reachable via LaravelContext.use()
 * reading from the container's laravelState MutableRef. If the container
 * is not properly initialized or the mock state is not installed, these
 * tests will fail because use() throws without available state.
 *
 * The chain for each handler:
 *   LSP request → server.ts handler → provider function
 *     → LaravelContext.use() → container.laravelState → mock state
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('LaravelContext container pipeline', () => {
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

    // ─── Completions ─────────────────────────────────────────────────────
    // Completion handler → Directives.search() → use() → container

    it('onCompletion: custom directives from context', async () => {
        const doc = await client.open({ text: '<div>\n@\n</div>' });
        const items = await doc.completions(1, 1);
        const labels = items.map((i) => i.label);

        // @datetime only exists in mock LaravelContext.State.directives
        // Reaching it requires: use() → container.laravelState → state.directives.items
        expect(labels).toContain('@datetime');
        expect(labels).toContain('@money');

        await doc.close();
    });

    it('onCompletion: view names from context', async () => {
        const doc = await client.open({ text: "@include('" });
        const items = await doc.completions(0, 10);
        const labels = items.map((i) => i.label);

        // These view keys only exist in mock state
        expect(labels).toContain('layouts.app');
        expect(labels).toContain('partials.header');

        await doc.close();
    });

    it('onCompletion: component names from context', async () => {
        const doc = await client.open({ text: '<div>\n<x-\n</div>' });
        const items = await doc.completions(1, 3);
        const labels = items.map((i) => i.label);

        // Component tags from mock state
        expect(labels.some((l) => l.includes('button'))).toBe(true);
        expect(labels.some((l) => l.includes('alert'))).toBe(true);

        await doc.close();
    });

    it('onCompletion: component props from context', async () => {
        const doc = await client.open({ text: '<x-alert  />' });
        // Cursor inside the tag after the space (col 9)
        const items = await doc.completions(0, 9);
        const labels = items.map((i) => i.label);

        // Props from the mock alert component: type, message, dismissible
        expect(labels.some((l) => l.includes('message'))).toBe(true);

        await doc.close();
    });

    // ─── Hover ───────────────────────────────────────────────────────────
    // Hover handler → Components.findByTag() → use() → container

    it('onHover: component hover returns data from context', async () => {
        const doc = await client.open({ text: '<x-alert type="error" />' });
        const hover = await doc.hover(0, 4);

        expect(hover).not.toBeNull();
        const value =
            typeof hover!.contents === 'string'
                ? hover!.contents
                : 'value' in hover!.contents
                  ? hover!.contents.value
                  : '';

        // Component details only reachable via use() → container.laravelState
        expect(value).toContain('alert');
        expect(value).toContain('app/View/Components/Alert.php');

        await doc.close();
    });

    it('onHover: prop hover returns type info from context', async () => {
        const doc = await client.open({ text: '<x-button type="primary" />' });
        // 'type' starts at col 10
        const hover = await doc.hover(0, 12);

        expect(hover).not.toBeNull();
        const value =
            typeof hover!.contents === 'string'
                ? hover!.contents
                : 'value' in hover!.contents
                  ? hover!.contents.value
                  : '';

        // Prop type+default from mock state — requires use() → container.laravelState
        expect(value).toContain('type');
        expect(value).toContain('string');
        expect(value).toContain('button');

        await doc.close();
    });

    it('onHover: view hover returns path from context', async () => {
        const doc = await client.open({ text: "@include('layouts.app')" });
        const hover = await doc.hover(0, 14);

        expect(hover).not.toBeNull();
        const value =
            typeof hover!.contents === 'string'
                ? hover!.contents
                : 'value' in hover!.contents
                  ? hover!.contents.value
                  : '';

        // View path from mock state
        expect(value).toContain('layouts.app');
        expect(value).toContain('resources/views');

        await doc.close();
    });

    // ─── Diagnostics ─────────────────────────────────────────────────────
    // onDidChangeContent → Views.find() / Components.findByTag() → use() → container

    it('onDidChangeContent: detects undefined view via context', async () => {
        const doc = await client.open({ text: "@include('nonexistent.view')" });
        const diags = await doc.diagnostics();

        // Diagnostic requires use() → container.laravelState → state.views.items lookup
        const undefinedViews = diags.filter((d) => d.code === 'blade/undefined-view');
        expect(undefinedViews.length).toBe(1);

        await doc.close();
    });

    it('onDidChangeContent: recognizes existing view via context', async () => {
        const doc = await client.open({ text: "@include('layouts.app')" });
        const diags = await doc.diagnostics();

        // No undefined-view diagnostic because layouts.app exists in mock state
        const undefinedViews = diags.filter((d) => d.code === 'blade/undefined-view');
        expect(undefinedViews).toEqual([]);

        await doc.close();
    });

    it('onDidChangeContent: detects undefined component via context', async () => {
        const doc = await client.open({ text: '<x-nonexistent />' });
        const diags = await doc.diagnostics();

        const undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
        expect(undefinedComponents.length).toBe(1);

        await doc.close();
    });

    it('onDidChangeContent: recognizes existing component via context', async () => {
        const doc = await client.open({ text: '<x-button />' });
        const diags = await doc.diagnostics();

        // No diagnostic because x-button exists in mock state
        const undefinedComponents = diags.filter((d) => d.code === 'blade/undefined-component');
        expect(undefinedComponents).toEqual([]);

        await doc.close();
    });
});

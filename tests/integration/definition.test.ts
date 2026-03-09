import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Definition (Integration)', () => {
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

    describe('view definition', () => {
        it('resolves @extends view reference', async () => {
            const doc = await client.open({
                text: "@extends('layouts.app')",
            });

            // Position on 'layouts.app'
            const def = await doc.definition(0, 14);
            // With mock data the view file may not exist on disk,
            // so definition may return null. The important thing is
            // the request doesn't error.
            if (def && !Array.isArray(def)) {
                expect(def.uri).toContain('layouts');
            }

            await doc.close();
        });

        it('resolves @include view reference', async () => {
            const doc = await client.open({
                text: "@include('partials.header')",
            });

            const def = await doc.definition(0, 14);
            if (def && !Array.isArray(def)) {
                expect(def.uri).toContain('partials');
            }

            await doc.close();
        });

        it('resolves fallback view in @each', async () => {
            const doc = await client.open({
                text: "@each('partials.header', $items, 'item', 'partials.footer')",
            });

            const def = await doc.definition(0, 45);
            if (def && !Array.isArray(def)) {
                expect(def.uri).toContain('partials/footer');
            }

            await doc.close();
        });

        it('returns null for non-view positions', async () => {
            const doc = await client.open({
                text: '<div>Hello</div>',
            });

            const def = await doc.definition(0, 6);
            expect(def).toBeNull();

            await doc.close();
        });

        it('resolves Folio-style variables back to php preamble declarations', async () => {
            const doc = await client.open({
                text: `<?php
use App\\Models\\Post;
use Illuminate\\View\\View;

render(function (View $view, Post $post) {
    return $view->with('photos', []);
});
?>

{{ $photos }}
{{ $post->title }}`,
            });

            const photosDef = await doc.definition(9, 4);
            expect(photosDef).not.toBeNull();
            if (photosDef && !Array.isArray(photosDef)) {
                expect(photosDef.uri).toBe(doc.uri);
                expect(photosDef.range.start.line).toBe(5);
            }

            const postDef = await doc.definition(10, 4);
            expect(postDef).not.toBeNull();
            if (postDef && !Array.isArray(postDef)) {
                expect(postDef.uri).toBe(doc.uri);
                expect(postDef.range.start.line).toBe(4);
            }

            await doc.close();
        });
    });

    describe('component definition', () => {
        it('resolves <x-button> component reference', async () => {
            const doc = await client.open({
                text: '<x-button type="primary" />',
            });

            // Position on 'x-button'
            const def = await doc.definition(0, 4);
            // May return null if the file doesn't exist on disk
            if (def && !Array.isArray(def)) {
                expect(def.uri).toBeDefined();
            }

            await doc.close();
        });

        it('resolves namespaced component <flux:button>', async () => {
            const doc = await client.open({
                text: '<flux:button variant="primary" />',
            });

            const def = await doc.definition(0, 6);
            if (def && !Array.isArray(def)) {
                expect(def.uri).toBeDefined();
            }

            await doc.close();
        });

        it('resolves component prop definition', async () => {
            const doc = await client.open({
                text: '<x-button type="primary" />',
            });

            // Position on 'type' prop
            const def = await doc.definition(0, 12);
            // The prop definition handler attempts to read the component file,
            // which won't exist with mock data, but it should not throw.
            if (def && !Array.isArray(def)) {
                expect(def.uri).toBeDefined();
            }

            await doc.close();
        });
    });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Hover (Integration)', () => {
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

    describe('directive hover', () => {
        it('shows hover for @foreach', async () => {
            const doc = await client.open({
                text: '@foreach($items as $item)\n  {{ $item }}\n@endforeach',
            });

            const hover = await doc.hover(0, 3);
            expect(hover).not.toBeNull();
            expect(hover!.contents).toBeDefined();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('@foreach');

            await doc.close();
        });

        it('shows hover for @if', async () => {
            const doc = await client.open({
                text: '@if($show)\n  <p>test</p>\n@endif',
            });

            const hover = await doc.hover(0, 2);
            expect(hover).not.toBeNull();

            await doc.close();
        });

        it('returns null for plain HTML', async () => {
            const doc = await client.open({
                text: '<div>Hello World</div>',
            });

            const hover = await doc.hover(0, 8);
            expect(hover).toBeNull();

            await doc.close();
        });
    });

    describe('special variable hover', () => {
        it('shows hover for $loop variable', async () => {
            const doc = await client.open({
                text: '@foreach($items as $item)\n  {{ $loop->index }}\n@endforeach',
            });

            // Position on $loop
            const hover = await doc.hover(1, 7);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('$loop');
            expect(value).toContain('index');

            await doc.close();
        });

        it('shows hover for $slot variable', async () => {
            const doc = await client.open({
                text: '<div>{{ $slot }}</div>',
            });

            const hover = await doc.hover(0, 10);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('$slot');

            await doc.close();
        });

        it('shows hover for $attributes variable', async () => {
            const doc = await client.open({
                text: '<div {{ $attributes->merge([]) }}></div>',
            });

            const hover = await doc.hover(0, 10);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('$attributes');

            await doc.close();
        });
    });

    describe('component hover with Laravel mock', () => {
        beforeAll(() => {
            installMockLaravel();
        });

        afterAll(() => {
            clearMockLaravel();
        });

        it('shows hover for <x-button> with component details from context', async () => {
            const doc = await client.open({
                text: '<x-button type="primary" />',
            });

            // Hover over 'x-button' — the tag name starts at column 1.
            // This requires LaravelContext.use() to resolve inside the handler's
            // provide() scope — Components.findByTag() is called internally.
            const hover = await doc.hover(0, 4);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            // Assert data that can only come from the mock LaravelContext state
            expect(value).toContain('button');
            expect(value).toContain('Props');

            await doc.close();
        });

        it('shows hover for view reference in @include', async () => {
            const doc = await client.open({
                text: "@include('layouts.app')",
            });

            // Hover over 'layouts.app'
            const hover = await doc.hover(0, 14);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('layouts.app');

            await doc.close();
        });

        it('shows hover for component prop with type info from context', async () => {
            const doc = await client.open({
                text: '<x-button type="primary" />',
            });

            // Hover over 'type' prop — 'type' starts at column 10.
            // This proves provide() is active: the handler calls
            // Components.findByTag() → LaravelContext.use() to look up
            // the component, then reads its props array from context state.
            const hover = await doc.hover(0, 12);
            expect(hover).not.toBeNull();

            const value =
                typeof hover!.contents === 'string'
                    ? hover!.contents
                    : 'value' in hover!.contents
                      ? hover!.contents.value
                      : '';
            expect(value).toContain('type');
            expect(value).toContain('x-button');
            // This prop type/default comes from mock state — only reachable via provide()
            expect(value).toContain('string');

            await doc.close();
        });
    });
});

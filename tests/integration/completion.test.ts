import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type Client } from '../utils/client';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Completion (Integration)', () => {
    let client: Client;

    beforeAll(async () => {
        client = await createClient({
            settings: {
                enableLaravelIntegration: false,
            },
        });
    });

    afterAll(async () => {
        await client.shutdown();
    });

    describe('directive completions', () => {
        it('returns directive completions when typing @', async () => {
            const doc = await client.open({
                text: '<div>\n@\n</div>',
            });

            // Position right after the @
            const items = await doc.completions(1, 1);
            expect(items.length).toBeGreaterThan(0);

            const labels = items.map((i) => i.label);
            expect(labels).toContain('@if');
            expect(labels).toContain('@foreach');
            expect(labels).toContain('@extends');
            expect(labels).toContain('@include');

            await doc.close();
        });

        it('filters directives by prefix', async () => {
            const doc = await client.open({
                text: '<div>\n@for\n</div>',
            });

            // Position at end of @for
            const items = await doc.completions(1, 4);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('@for');
            expect(labels).toContain('@foreach');
            expect(labels).toContain('@forelse');
            // Should not contain unrelated directives
            expect(labels).not.toContain('@if');

            await doc.close();
        });

        it('returns echo context completions inside {{ }}', async () => {
            const doc = await client.open({
                text: '{{ r }}',
            });

            const items = await doc.completions(0, 4);
            // These are static helpers that don't require Laravel context
            const labels = items.map((i) => i.label);
            expect(labels).toContain('route');

            await doc.close();
        });
    });

    describe('directive completions with Laravel mock', () => {
        beforeAll(() => {
            installMockLaravel();
        });

        afterAll(() => {
            clearMockLaravel();
        });

        it('includes custom directives when Laravel is available', async () => {
            const doc = await client.open({
                text: '<div>\n@\n</div>',
            });

            const items = await doc.completions(1, 1);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('@if');
            expect(labels).toContain('@datetime');
            expect(labels).toContain('@money');
            expect(labels).toContain('@admin');

            await doc.close();
        });

        it('provides view name completions for @include', async () => {
            const doc = await client.open({
                text: "@include('",
            });

            const items = await doc.completions(0, 10);
            const labels = items.map((i) => i.label);

            expect(labels).toContain('layouts.app');
            expect(labels).toContain('partials.header');
            expect(labels).toContain('partials.footer');

            await doc.close();
        });

        it('provides component completions for <x-', async () => {
            const doc = await client.open({
                text: '<div>\n<x-\n</div>',
            });

            const items = await doc.completions(1, 3);
            const labels = items.map((i) => i.label);

            expect(labels.some((l) => l.includes('button'))).toBe(true);
            expect(labels.some((l) => l.includes('alert'))).toBe(true);

            await doc.close();
        });
    });
});

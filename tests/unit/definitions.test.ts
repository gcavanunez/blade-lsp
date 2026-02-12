import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Definitions } from '../../src/providers/definitions';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

vi.mock('../../src/server', () => ({
    Server: {
        getWorkspaceRoot: () => '/test/project',
    },
}));

describe('Definitions', () => {
    describe('getViewDefinition', () => {
        beforeEach(() => {
            installMockLaravel();
        });

        afterEach(() => {
            clearMockLaravel();
        });

        for (const directive of [
            'extends',
            'include',
            'includeIf',
            'includeWhen',
            'includeUnless',
            'includeFirst',
            'each',
            'component',
        ]) {
            it(`resolves view name for @${directive}`, () => {
                const line = `@${directive}('layouts.app')`;
                const viewStart = line.indexOf('layouts.app');
                const result = Definitions.getViewDefinition(line, viewStart + 1, '', 0);

                expect(result).not.toBeNull();
                expect(result!.uri).toContain('layouts/app.blade.php');
            });
        }

        it('resolves view name in view() helper', () => {
            const line = "{{ view('layouts.app') }}";
            const viewStart = line.indexOf('layouts.app');
            const result = Definitions.getViewDefinition(line, viewStart + 1, '', 0);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain('layouts/app.blade.php');
        });

        it('returns null when cursor is outside view name', () => {
            const line = "@include('layouts.app')";
            // Cursor at column 0, not on the view name
            const result = Definitions.getViewDefinition(line, 0, '', 0);
            expect(result).toBeNull();
        });

        it('returns null for a non-matching line', () => {
            const line = '<div class="test">Hello</div>';
            const result = Definitions.getViewDefinition(line, 5, '', 0);
            expect(result).toBeNull();
        });

        it('returns null for unknown view', () => {
            const line = "@include('nonexistent.view')";
            const viewStart = line.indexOf('nonexistent.view');
            const result = Definitions.getViewDefinition(line, viewStart + 1, '', 0);
            expect(result).toBeNull();
        });
    });

    // ─── resolveViewLocation ─────────────────────────────────────────────────

    describe('resolveViewLocation', () => {
        beforeEach(() => {
            installMockLaravel();
        });

        afterEach(() => {
            clearMockLaravel();
        });

        it('returns Location for a known view', () => {
            const result = Definitions.resolveViewLocation('layouts.app');
            expect(result).not.toBeNull();
            expect(result!.uri).toBe('file:///test/project/resources/views/layouts/app.blade.php');
            expect(result!.range.start.line).toBe(0);
        });

        it('returns null for an unknown view', () => {
            const result = Definitions.resolveViewLocation('nonexistent.view');
            expect(result).toBeNull();
        });

        it('returns null when Laravel is not available', () => {
            clearMockLaravel();
            const result = Definitions.resolveViewLocation('layouts.app');
            expect(result).toBeNull();
        });
    });

    // ─── getComponentDefinition ──────────────────────────────────────────────

    describe('getComponentDefinition', () => {
        beforeEach(() => {
            installMockLaravel();
        });

        afterEach(() => {
            clearMockLaravel();
        });

        it('matches <x-button and resolves when cursor is on tag name', () => {
            const line = '<x-button type="primary">';
            const tagStart = line.indexOf('x-button');
            const result = Definitions.getComponentDefinition(line, tagStart + 1);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain('button.blade.php');
        });

        it('matches namespaced <flux:button tag', () => {
            const line = '<flux:button variant="primary" />';
            const tagStart = line.indexOf('flux:button');
            const result = Definitions.getComponentDefinition(line, tagStart + 1);

            // flux::button component exists in mock
            expect(result).not.toBeNull();
        });

        it('returns null when cursor is outside the tag name', () => {
            const line = '<x-button type="primary">';
            // Cursor on the attribute, past the tag name
            const result = Definitions.getComponentDefinition(line, 20);
            expect(result).toBeNull();
        });

        it('returns null for non-component tags', () => {
            const line = '<div class="test">';
            const result = Definitions.getComponentDefinition(line, 3);
            expect(result).toBeNull();
        });

        it('returns null for unknown component', () => {
            const line = '<x-nonexistent />';
            const tagStart = line.indexOf('x-nonexistent');
            const result = Definitions.getComponentDefinition(line, tagStart + 1);
            expect(result).toBeNull();
        });
    });

    // ─── resolveComponentLocation ────────────────────────────────────────────

    describe('resolveComponentLocation', () => {
        beforeEach(() => {
            installMockLaravel();
        });

        afterEach(() => {
            clearMockLaravel();
        });

        it('resolves standard x- component', () => {
            const result = Definitions.resolveComponentLocation('x-button');
            expect(result).not.toBeNull();
            expect(result!.uri).toContain('button.blade.php');
        });

        it('resolves Livewire component via view lookup', () => {
            const result = Definitions.resolveComponentLocation('livewire:counter');
            expect(result).not.toBeNull();
            expect(result!.uri).toContain('livewire/counter.blade.php');
        });

        it('returns null for unknown Livewire component', () => {
            const result = Definitions.resolveComponentLocation('livewire:nonexistent');
            expect(result).toBeNull();
        });

        it('returns null for unknown component', () => {
            const result = Definitions.resolveComponentLocation('x-nonexistent');
            expect(result).toBeNull();
        });

        it('returns null when Laravel is not available', () => {
            clearMockLaravel();
            const result = Definitions.resolveComponentLocation('x-button');
            expect(result).toBeNull();
        });
    });
});

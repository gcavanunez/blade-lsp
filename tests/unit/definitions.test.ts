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

        it('matches Livewire 4 namespaced <livewire:pages::settings.two-factor.recovery-codes> tag', () => {
            const line = '<livewire:pages::settings.two-factor.recovery-codes />';
            const tagStart = line.indexOf('livewire:pages::settings.two-factor.recovery-codes');
            const result = Definitions.getComponentDefinition(line, tagStart + 1);

            expect(result).not.toBeNull();
            expect(result!.uri).toContain('recovery-codes.blade.php');
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

        it('resolves Livewire 4 namespaced component via view lookup', () => {
            const result = Definitions.resolveComponentLocation('livewire:pages::settings.two-factor.recovery-codes');
            expect(result).not.toBeNull();
            expect(result!.uri).toContain('recovery-codes.blade.php');
        });

        it('resolves Livewire 4 namespaced component with props via view lookup', () => {
            const result = Definitions.resolveComponentLocation('livewire:pages::settings.two-factor.enable');
            expect(result).not.toBeNull();
            expect(result!.uri).toContain('enable.blade.php');
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

    describe('PHP preamble definitions', () => {
        it('resolves extracted preamble variables to same-file declarations', () => {
            const source = `<?php
use App\\Models\\Post;
use Illuminate\\View\\View;

render(function (View $view, Post $post) {
    return $view->with('photos', []);
});
?>

{{ $photos }}
{{ $post->title }}`;

            const photosLine = '{{ $photos }}';
            const photosResult = Definitions.getPhpSymbolDefinition(
                photosLine,
                4,
                source,
                'file:///test/project/test.blade.php',
            );
            expect(photosResult).not.toBeNull();
            expect(photosResult!.range.start.line).toBe(5);

            const postLine = '{{ $post->title }}';
            const postResult = Definitions.getPhpSymbolDefinition(
                postLine,
                4,
                source,
                'file:///test/project/test.blade.php',
            );
            expect(postResult).not.toBeNull();
            expect(postResult!.range.start.line).toBe(4);
        });

        it('resolves wire:model and wire action values to inline livewire members', () => {
            const source = `<?php
use Livewire\\Component;

new class extends Component {
    public string $title = '';
    public function save(): void {}
};
?>

<input wire:model="title">
<form wire:submit="save"></form>`;

            const modelResult = Definitions.getWireAttributeDefinition(
                '<input wire:model="title">',
                19,
                source,
                'file:///test/project/test.blade.php',
            );
            expect(modelResult).not.toBeNull();
            expect(modelResult!.range.start.line).toBe(4);

            const actionResult = Definitions.getWireAttributeDefinition(
                '<form wire:submit="save"></form>',
                20,
                source,
                'file:///test/project/test.blade.php',
            );
            expect(actionResult).not.toBeNull();
            expect(actionResult!.range.start.line).toBe(5);
        });
    });
});

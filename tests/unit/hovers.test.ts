import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hovers } from '../../src/providers/hovers';
import { BladeDirectives } from '../../src/directives';
import { installMockLaravel, clearMockLaravel, getHoverValue } from '../utils/laravel-mock';

describe('Hovers', () => {
    describe('formatDirective', () => {
        it('formats @if directive with all sections', () => {
            const directive = BladeDirectives.map.get('@if')!;
            const result = Hovers.formatDirective(directive);

            expect(result).toContain('## @if');
            expect(result).toContain(directive.description);
            expect(result).toContain('**Parameters:**');
            expect(result).toContain('**End tag:**');
            expect(result).toContain('@endif');
            expect(result).toContain('**Example:**');
        });

        it('formats @else directive without parameters or end tag', () => {
            const directive = BladeDirectives.map.get('@else')!;
            const result = Hovers.formatDirective(directive);

            expect(result).toContain('## @else');
            expect(result).toContain(directive.description);
            expect(result).not.toContain('**Parameters:**');
            expect(result).not.toContain('**End tag:**');
        });

        it('formats @foreach directive', () => {
            const directive = BladeDirectives.map.get('@foreach')!;
            const result = Hovers.formatDirective(directive);

            expect(result).toContain('## @foreach');
            expect(result).toContain('@endforeach');
        });
    });

    describe('formatLoopVariable', () => {
        it('returns markdown with all $loop properties', () => {
            const result = Hovers.formatLoopVariable();

            expect(result).toContain('$loop');
            expect(result).toContain('$loop->index');
            expect(result).toContain('$loop->iteration');
            expect(result).toContain('$loop->remaining');
            expect(result).toContain('$loop->count');
            expect(result).toContain('$loop->first');
            expect(result).toContain('$loop->last');
            expect(result).toContain('$loop->even');
            expect(result).toContain('$loop->odd');
            expect(result).toContain('$loop->depth');
            expect(result).toContain('$loop->parent');
        });
    });

    describe('formatSlotVariable', () => {
        it('returns markdown with slot description', () => {
            const result = Hovers.formatSlotVariable();

            expect(result).toContain('$slot');
            expect(result).toContain('component');
        });
    });

    describe('formatAttributesVariable', () => {
        it('returns markdown with attributes methods', () => {
            const result = Hovers.formatAttributesVariable();

            expect(result).toContain('$attributes');
            expect(result).toContain('merge()');
            expect(result).toContain('class()');
            expect(result).toContain('only()');
            expect(result).toContain('except()');
        });
    });

    describe('getWordAtPosition', () => {
        it('extracts $loop from a line', () => {
            const result = Hovers.getWordAtPosition('{{ $loop->index }}', 5);
            expect(result).toMatch(/^\$loop/);
        });

        it('extracts $slot from a line', () => {
            const result = Hovers.getWordAtPosition('{{ $slot }}', 5);
            expect(result).toBe('$slot');
        });

        it('extracts $attributes from a line', () => {
            const result = Hovers.getWordAtPosition('{{ $attributes->merge([]) }}', 5);
            expect(result).toMatch(/^\$attributes/);
        });

        it('returns empty string for non-word position', () => {
            const result = Hovers.getWordAtPosition('   ', 1);
            expect(result).toBe('');
        });
    });

    // ─── getComponentHover ───────────────────────────────────────────────────

    describe('getComponentHover', () => {
        describe('without Laravel', () => {
            it('returns fallback hover with just the tag name', () => {
                const line = '<x-button type="primary">';
                const tagStart = line.indexOf('x-button');
                const hover = Hovers.getComponentHover(line, tagStart + 1);

                expect(hover).not.toBeNull();
                const value = getHoverValue(hover!);
                expect(value).toContain('x-button');
                expect(value).toContain('Blade component');
            });
        });

        describe('with Laravel mock', () => {
            beforeEach(() => {
                installMockLaravel();
            });

            afterEach(() => {
                clearMockLaravel();
            });

            it('returns hover with path and props table for known component', () => {
                const line = '<x-button type="primary">';
                const tagStart = line.indexOf('x-button');
                const hover = Hovers.getComponentHover(line, tagStart + 1);

                expect(hover).not.toBeNull();
                const value = getHoverValue(hover!);
                expect(value).toContain('x-button');
                expect(value).toContain('button.blade.php');
                expect(value).toContain('type');
                expect(value).toContain('variant');
                expect(value).toContain('disabled');
            });

            it('shows "not found in project" for unknown component', () => {
                const line = '<x-nonexistent />';
                const tagStart = line.indexOf('x-nonexistent');
                const hover = Hovers.getComponentHover(line, tagStart + 1);

                expect(hover).not.toBeNull();
                const value = getHoverValue(hover!);
                expect(value).toContain('not found in project');
            });

            it('returns Livewire component hover with type and props', () => {
                const line = '<livewire:counter />';
                const tagStart = line.indexOf('livewire:counter');
                const hover = Hovers.getComponentHover(line, tagStart + 1);

                expect(hover).not.toBeNull();
                const value = getHoverValue(hover!);
                expect(value).toContain('livewire:counter');
                expect(value).toContain('Livewire component');
                expect(value).toContain('counter.blade.php');
                expect(value).toContain('count');
                expect(value).toContain('int');
                expect(value).toContain('Counter.php');
            });

            it('shows Livewire "not found" for unknown Livewire component', () => {
                const line = '<livewire:nonexistent />';
                const tagStart = line.indexOf('livewire:nonexistent');
                const hover = Hovers.getComponentHover(line, tagStart + 1);

                expect(hover).not.toBeNull();
                const value = getHoverValue(hover!);
                expect(value).toContain('not found in project');
            });

            it('handles component with string props', () => {
                clearMockLaravel();
                installMockLaravel({
                    components: [
                        {
                            key: 'card',
                            path: 'resources/views/components/card.blade.php',
                            paths: ['resources/views/components/card.blade.php'],
                            isVendor: false,
                            props: "@props(['title', 'subtitle' => null])",
                        },
                    ],
                });
                const line = '<x-card>';
                const tagStart = line.indexOf('x-card');
                const hover = Hovers.getComponentHover(line, tagStart + 1);

                expect(hover).not.toBeNull();
                const value = getHoverValue(hover!);
                expect(value).toContain('```php');
                expect(value).toContain("@props(['title'");
            });
        });

        it('returns null when cursor is outside the tag name', () => {
            const line = '<x-button type="primary">';
            // Cursor on the attribute, past the tag name
            const hover = Hovers.getComponentHover(line, 20);
            expect(hover).toBeNull();
        });

        it('returns null for non-component tags', () => {
            const line = '<div class="test">';
            const hover = Hovers.getComponentHover(line, 3);
            expect(hover).toBeNull();
        });
    });

    // ─── getViewHover ────────────────────────────────────────────────────────

    describe('getViewHover', () => {
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
            it(`returns hover for @${directive} view reference`, () => {
                const line = `@${directive}('layouts.app')`;
                const viewStart = line.indexOf('layouts.app');
                const hover = Hovers.getViewHover(line, viewStart + 1);

                expect(hover).not.toBeNull();
                const value = getHoverValue(hover!);
                expect(value).toContain('layouts.app');
            });
        }

        it('returns hover for view() helper', () => {
            const line = "{{ view('layouts.app') }}";
            const viewStart = line.indexOf('layouts.app');
            const hover = Hovers.getViewHover(line, viewStart + 1);

            expect(hover).not.toBeNull();
            const value = getHoverValue(hover!);
            expect(value).toContain('layouts.app');
        });

        it('returns null when cursor is outside the view name', () => {
            const line = "@include('layouts.app')";
            const hover = Hovers.getViewHover(line, 0);
            expect(hover).toBeNull();
        });

        it('returns null for non-matching lines', () => {
            const line = '<div class="test">Hello</div>';
            const hover = Hovers.getViewHover(line, 5);
            expect(hover).toBeNull();
        });
    });

    // ─── getViewHoverContent ─────────────────────────────────────────────────

    describe('getViewHoverContent', () => {
        describe('with Laravel mock', () => {
            beforeEach(() => {
                installMockLaravel();
            });

            afterEach(() => {
                clearMockLaravel();
            });

            it('returns path for a known view', () => {
                const hover = Hovers.getViewHoverContent('layouts.app');
                const value = getHoverValue(hover);
                expect(value).toContain('layouts.app');
                expect(value).toContain('resources/views/layouts/app.blade.php');
            });

            it('shows "View not found" for unknown view', () => {
                const hover = Hovers.getViewHoverContent('nonexistent.view');
                const value = getHoverValue(hover);
                expect(value).toContain('View not found in project');
            });

            it('shows vendor tag and namespace for namespaced vendor views', () => {
                const hover = Hovers.getViewHoverContent('mail::message');
                const value = getHoverValue(hover);
                expect(value).toContain('Vendor package view');
                expect(value).toContain('**Namespace:** `mail`');
            });
        });

        describe('without Laravel', () => {
            it('returns basic fallback hover', () => {
                const hover = Hovers.getViewHoverContent('layouts.app');
                const value = getHoverValue(hover);
                expect(value).toContain('layouts.app');
                expect(value).toContain('Blade view');
            });
        });
    });
});

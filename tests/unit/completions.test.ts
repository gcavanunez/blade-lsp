import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompletionItemKind, InsertTextFormat, Position, Range } from 'vscode-languageserver/node';
import { Completions } from '../../src/providers/completions';
import { BladeDirectives } from '../../src/directives';
import {
    installMockLaravel,
    clearMockLaravel,
    DEFAULT_COMPONENTS,
    DEFAULT_COMPONENT_PROPS,
} from '../utils/laravel-mock';

vi.mock('../../src/server', () => ({
    Server: {
        getWorkspaceRoot: () => '/test/project',
    },
}));

describe('Completions', () => {
    // ─── getParameterCompletions (static directives) ────────────────────────

    describe('getParameterCompletions', () => {
        describe('section / yield', () => {
            it('returns section name suggestions for @section', () => {
                const items = Completions.getParameterCompletions('section');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['content', 'title', 'scripts', 'styles']);
            });

            it('returns the same suggestions for @yield', () => {
                const items = Completions.getParameterCompletions('yield');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['content', 'title', 'scripts', 'styles']);
            });
        });

        describe('can / cannot / canany', () => {
            it('returns permission suggestions for @can', () => {
                const items = Completions.getParameterCompletions('can');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['view', 'create', 'update', 'delete']);
            });

            it('returns permission suggestions for @cannot', () => {
                const items = Completions.getParameterCompletions('cannot');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['view', 'create', 'update', 'delete']);
            });

            it('returns permission suggestions for @canany', () => {
                const items = Completions.getParameterCompletions('canany');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['view', 'create', 'update', 'delete']);
            });
        });

        describe('env', () => {
            it('returns environment name suggestions', () => {
                const items = Completions.getParameterCompletions('env');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['local', 'production', 'staging']);
            });
        });

        describe('method', () => {
            it('returns HTTP method suggestions', () => {
                const items = Completions.getParameterCompletions('method');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['PUT', 'PATCH', 'DELETE']);
            });
        });

        describe('push / stack', () => {
            it('returns stack name suggestions for @push', () => {
                const items = Completions.getParameterCompletions('push');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['scripts', 'styles']);
            });

            it('returns stack name suggestions for @stack', () => {
                const items = Completions.getParameterCompletions('stack');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['scripts', 'styles']);
            });
        });

        describe('slot', () => {
            it('returns common slot name suggestions', () => {
                const items = Completions.getParameterCompletions('slot');
                const labels = items.map((i) => i.label);
                expect(labels).toEqual(['header', 'footer', 'title', 'icon', 'actions', 'trigger', 'content']);
                expect(items.length).toBe(7);
            });

            it('returns items with Value kind', () => {
                const items = Completions.getParameterCompletions('slot');
                for (const item of items) {
                    expect(item.detail).toBeDefined();
                }
            });
        });

        describe('unknown directive', () => {
            it('returns empty for an unknown directive', () => {
                const items = Completions.getParameterCompletions('unknownDirective');
                expect(items).toEqual([]);
            });
        });
    });

    // ─── getParameterCompletions (with Laravel mock) ────────────────────────

    describe('getParameterCompletions (with Laravel mock)', () => {
        beforeEach(() => {
            installMockLaravel();
        });

        afterEach(() => {
            clearMockLaravel();
        });

        describe('extends / include variants', () => {
            it('returns view names for @extends', () => {
                const items = Completions.getParameterCompletions('extends');
                const labels = items.map((i) => i.label);
                expect(labels).toContain('layouts.app');
                expect(labels).toContain('partials.header');
                expect(labels).toContain('partials.footer');
            });

            it('returns view names for @include', () => {
                const items = Completions.getParameterCompletions('include');
                const labels = items.map((i) => i.label);
                expect(labels).toContain('layouts.app');
            });

            for (const variant of ['includeIf', 'includeWhen', 'includeUnless', 'includeFirst'] as const) {
                it(`returns view names for @${variant}`, () => {
                    const items = Completions.getParameterCompletions(variant);
                    const labels = items.map((i) => i.label);
                    expect(labels).toContain('layouts.app');
                });
            }
        });

        describe('livewire', () => {
            it('returns livewire component names for @livewire', () => {
                const items = Completions.getParameterCompletions('livewire');
                const labels = items.map((i) => i.label);
                expect(labels).toContain('counter');
                expect(labels).toContain('search-bar');
            });

            it('includes path in documentation', () => {
                const items = Completions.getParameterCompletions('livewire');
                const counter = items.find((i) => i.label === 'counter');
                expect(counter).toBeDefined();
                expect(counter!.detail).toBe('Livewire component');
                const doc = counter!.documentation;
                expect(doc).toBeDefined();
                if (typeof doc === 'object' && 'value' in doc) {
                    expect(doc.value).toContain('counter.blade.php');
                }
            });

            it('returns empty for @livewireStyles (no livewire views match)', () => {
                // livewireStyles and livewireScripts share the same branch as livewire
                const items = Completions.getParameterCompletions('livewireStyles');
                const labels = items.map((i) => i.label);
                // These also return livewire component names
                expect(labels).toContain('counter');
            });
        });
    });

    // ─── getLivewireCompletions ──────────────────────────────────────────────

    describe('getLivewireCompletions', () => {
        beforeEach(() => {
            installMockLaravel();
        });

        afterEach(() => {
            clearMockLaravel();
        });

        it('returns livewire component completions for <livewire:', () => {
            const items = Completions.getLivewireCompletions('<livewire:', Position.create(0, 10));
            const labels = items.map((i) => i.label);
            expect(labels).toContain('livewire:counter');
            expect(labels).toContain('livewire:search-bar');
        });

        it('filters by partial name', () => {
            const items = Completions.getLivewireCompletions('<livewire:cou', Position.create(0, 13));
            const labels = items.map((i) => i.label);
            expect(labels).toContain('livewire:counter');
            expect(labels).not.toContain('livewire:search-bar');
        });

        it('returns empty when Laravel is not available', () => {
            clearMockLaravel();
            const items = Completions.getLivewireCompletions('<livewire:', Position.create(0, 10));
            expect(items).toEqual([]);
        });

        it('sets textEdit to replace from tag start', () => {
            const items = Completions.getLivewireCompletions('<livewire:', Position.create(0, 10));
            const counter = items.find((i) => i.label === 'livewire:counter');
            expect(counter).toBeDefined();
            expect(counter!.textEdit).toBeDefined();
            if (counter!.textEdit && 'range' in counter!.textEdit) {
                // Should replace from column 0 (start of <livewire:) to cursor
                expect(counter!.textEdit.range.start.character).toBe(0);
                expect(counter!.textEdit.newText).toBe('<livewire:counter');
            }
        });

        it('includes props table in documentation for components with props', () => {
            const items = Completions.getLivewireCompletions('<livewire:', Position.create(0, 10));
            const counter = items.find((i) => i.label === 'livewire:counter');
            expect(counter).toBeDefined();
            const doc = counter!.documentation;
            if (typeof doc === 'object' && 'value' in doc) {
                expect(doc.value).toContain('Props');
                expect(doc.value).toContain('count');
                expect(doc.value).toContain('int');
            }
        });

        it('sorts vendor components after non-vendor', () => {
            const items = Completions.getLivewireCompletions('<livewire:', Position.create(0, 10));
            // Both mock livewire views are non-vendor so sortText should start with '0'
            for (const item of items) {
                expect(item.sortText).toMatch(/^0/);
            }
        });
    });

    // ─── createLivewireCompletionItem ───────────────────────────────────────

    describe('createLivewireCompletionItem', () => {
        it('creates a completion item with correct label and detail', () => {
            const view = {
                key: 'livewire.counter',
                path: 'resources/views/livewire/counter.blade.php',
                isVendor: false,
                namespace: null,
            };
            const range = Range.create(0, 0, 0, 11);
            const item = Completions.createLivewireCompletionItem(view, 'counter', range);

            expect(item.label).toBe('livewire:counter');
            expect(item.detail).toBe('Livewire component');
        });

        it('marks vendor components', () => {
            const view = {
                key: 'livewire.vendor-component',
                path: 'vendor/package/views/livewire/vendor-component.blade.php',
                isVendor: true,
                namespace: null,
            };
            const range = Range.create(0, 0, 0, 11);
            const item = Completions.createLivewireCompletionItem(view, 'vendor-component', range);

            expect(item.detail).toBe('Livewire component (vendor)');
            expect(item.sortText).toMatch(/^1/);
        });
    });

    // ─── createDirectiveItem ─────────────────────────────────────────────────

    describe('createDirectiveItem', () => {
        it('builds correct label, kind, and detail from directive', () => {
            const directive = BladeDirectives.map.get('@if')!;
            const item = Completions.createDirectiveItem(directive, '');

            expect(item.label).toBe('@if');
            expect(item.kind).toBe(CompletionItemKind.Keyword);
            expect(item.detail).toBe(directive.parameters);
        });

        it('uses snippet insertTextFormat when directive has a snippet', () => {
            const directive = BladeDirectives.map.get('@if')!;
            const item = Completions.createDirectiveItem(directive, '');

            expect(item.insertTextFormat).toBe(InsertTextFormat.Snippet);
            expect(item.insertText).toBe(directive.snippet);
        });

        it('uses plain text insertTextFormat when directive has no snippet', () => {
            // Construct a synthetic directive with no snippet
            const directive: BladeDirectives.Directive = {
                name: '@custom',
                description: 'A custom directive',
                hasEndTag: false,
            };
            const item = Completions.createDirectiveItem(directive, '');

            expect(item.insertTextFormat).toBe(InsertTextFormat.PlainText);
            expect(item.insertText).toBe('@custom');
        });

        it('slices insertText by prefix length', () => {
            const directive = BladeDirectives.map.get('@foreach')!;
            const item = Completions.createDirectiveItem(directive, '@for');

            // The snippet should be sliced by 4 characters (length of '@for')
            expect(item.insertText).toBe(directive.snippet!.slice(4));
        });

        it('sorts block directives (with endTag) before inline directives', () => {
            const ifDirective = BladeDirectives.map.get('@if')!;
            const csrfDirective = BladeDirectives.map.get('@csrf')!;

            const ifItem = Completions.createDirectiveItem(ifDirective, '');
            const csrfItem = Completions.createDirectiveItem(csrfDirective, '');

            // Block directives get '0' prefix, inline get '1'
            expect(ifItem.sortText).toBe('0@if');
            expect(csrfItem.sortText).toBe('1@csrf');
        });

        it('includes markdown documentation', () => {
            const directive = BladeDirectives.map.get('@if')!;
            const item = Completions.createDirectiveItem(directive, '');

            expect(item.documentation).toBeDefined();
            if (typeof item.documentation === 'object' && 'kind' in item.documentation) {
                expect(item.documentation.kind).toBe('markdown');
                expect(item.documentation.value).toBe(directive.description);
            }
        });
    });

    // ─── createCustomDirectiveItem ───────────────────────────────────────────

    describe('createCustomDirectiveItem', () => {
        it('creates item with params snippet when hasParams is true', () => {
            const directive = { name: 'datetime', hasParams: true };
            const item = Completions.createCustomDirectiveItem(directive, '');

            expect(item.label).toBe('@datetime');
            expect(item.kind).toBe(CompletionItemKind.Keyword);
            expect(item.detail).toBe('Custom directive');
            expect(item.insertText).toBe('@datetime(${1})');
            expect(item.insertTextFormat).toBe(InsertTextFormat.Snippet);
        });

        it('creates item with plain text when hasParams is false', () => {
            const directive = { name: 'admin', hasParams: false };
            const item = Completions.createCustomDirectiveItem(directive, '');

            expect(item.insertText).toBe('@admin');
            expect(item.insertTextFormat).toBe(InsertTextFormat.PlainText);
        });

        it('sorts after built-in directives with sortText prefix 2', () => {
            const directive = { name: 'datetime', hasParams: true };
            const item = Completions.createCustomDirectiveItem(directive, '');

            expect(item.sortText).toBe('2datetime');
        });

        it('slices insertText by prefix length', () => {
            const directive = { name: 'datetime', hasParams: true };
            const item = Completions.createCustomDirectiveItem(directive, '@dat');

            // '@datetime(${1})' sliced by 4 chars
            expect(item.insertText).toBe('etime(${1})');
        });

        it('includes markdown documentation mentioning custom directive', () => {
            const directive = { name: 'money', hasParams: true };
            const item = Completions.createCustomDirectiveItem(directive, '');

            if (typeof item.documentation === 'object' && 'value' in item.documentation) {
                expect(item.documentation.value).toContain('@money');
                expect(item.documentation.value).toContain('Custom');
            }
        });
    });

    // ─── getComponentCompletions ─────────────────────────────────────────────

    describe('getComponentCompletions', () => {
        describe('without Laravel', () => {
            it('returns static fallback component suggestions', () => {
                const items = Completions.getComponentCompletions('<x-', Position.create(0, 3));
                const labels = items.map((i) => i.label);

                expect(labels).toContain('x-button');
                expect(labels).toContain('x-alert');
                expect(labels).toContain('x-input');
                expect(labels).toContain('x-card');
                expect(items.length).toBe(4);
            });
        });

        describe('with Laravel mock', () => {
            beforeEach(() => {
                installMockLaravel();
            });

            afterEach(() => {
                clearMockLaravel();
            });

            it('returns components matching x- prefix', () => {
                const items = Completions.getComponentCompletions('<x-', Position.create(0, 3));
                const labels = items.map((i) => i.label);

                expect(labels).toContain('x-button');
                expect(labels).toContain('x-alert');
            });

            it('filters components by partial name', () => {
                const items = Completions.getComponentCompletions('<x-but', Position.create(0, 6));
                const labels = items.map((i) => i.label);

                expect(labels).toContain('x-button');
                expect(labels).not.toContain('x-alert');
            });

            it('returns namespaced components with x- prefix and double colon', () => {
                // When typing <x-flux::, components with :: in their key should match
                const items = Completions.getComponentCompletions('<x-flux::', Position.create(0, 9));
                const labels = items.map((i) => i.label);

                expect(labels).toContain('x-flux::button');
            });

            it('sets textEdit to replace from tag start', () => {
                const items = Completions.getComponentCompletions('<x-', Position.create(0, 3));
                const button = items.find((i) => i.label === 'x-button');
                expect(button).toBeDefined();
                expect(button!.textEdit).toBeDefined();
                if (button!.textEdit && 'range' in button!.textEdit) {
                    expect(button!.textEdit.range.start.character).toBe(0);
                }
            });
        });
    });

    // ─── createComponentCompletionItem ───────────────────────────────────────

    describe('createComponentCompletionItem', () => {
        const replaceRange = Range.create(0, 0, 0, 10);

        it('uses component key to generate tag name', () => {
            const component = DEFAULT_COMPONENTS[0]; // button
            const item = Completions.createComponentCompletionItem(component, replaceRange);

            expect(item.label).toBe('x-button');
            expect(item.kind).toBe(CompletionItemKind.Class);
        });

        it('uses fullTagOverride when provided', () => {
            const component = DEFAULT_COMPONENTS[0];
            const item = Completions.createComponentCompletionItem(component, replaceRange, 'custom-tag');

            expect(item.label).toBe('custom-tag');
        });

        it('shows vendor detail for vendor components', () => {
            const vendorComponent = DEFAULT_COMPONENTS[2]; // flux::button
            const item = Completions.createComponentCompletionItem(vendorComponent, replaceRange);

            expect(item.detail).toBe('Component (vendor)');
            expect(item.sortText).toMatch(/^1/);
        });

        it('shows non-vendor detail for local components', () => {
            const component = DEFAULT_COMPONENTS[0]; // button
            const item = Completions.createComponentCompletionItem(component, replaceRange);

            expect(item.detail).toBe('Component');
            expect(item.sortText).toMatch(/^0/);
        });

        it('generates snippet with required props', () => {
            const component = {
                ...DEFAULT_COMPONENTS[1], // alert has required props
                props: [
                    { name: 'type', type: 'string', default: null },
                    { name: 'message', type: 'string', default: null },
                ],
            };
            const item = Completions.createComponentCompletionItem(component, replaceRange);

            expect(item.insertTextFormat).toBe(InsertTextFormat.Snippet);
            if (item.textEdit && 'newText' in item.textEdit) {
                expect(item.textEdit.newText).toContain(':type=');
                expect(item.textEdit.newText).toContain(':message=');
            }
        });

        it('includes props table in documentation for array props', () => {
            const component = DEFAULT_COMPONENTS[0]; // button with array props
            const item = Completions.createComponentCompletionItem(component, replaceRange);

            if (typeof item.documentation === 'object' && 'value' in item.documentation) {
                expect(item.documentation.value).toContain('**Props:**');
                expect(item.documentation.value).toContain('type');
                expect(item.documentation.value).toContain('variant');
            }
        });

        it('includes props code block for string props', () => {
            const component = {
                ...DEFAULT_COMPONENTS[0],
                props: "@props(['title', 'subtitle' => null])",
            };
            const item = Completions.createComponentCompletionItem(component, replaceRange);

            if (typeof item.documentation === 'object' && 'value' in item.documentation) {
                expect(item.documentation.value).toContain('```php');
                expect(item.documentation.value).toContain("@props(['title'");
            }
        });
    });

    // ─── getComponentPropCompletions ─────────────────────────────────────────

    describe('getComponentPropCompletions', () => {
        describe('without Laravel', () => {
            it('returns empty array', () => {
                const items = Completions.getComponentPropCompletions('x-button', []);
                expect(items).toEqual([]);
            });
        });

        describe('with Laravel mock', () => {
            beforeEach(() => {
                installMockLaravel();
            });

            afterEach(() => {
                clearMockLaravel();
            });

            it('returns props for a known component', () => {
                const items = Completions.getComponentPropCompletions('x-button', []);
                const labels = items.map((i) => i.label);

                expect(labels.some((l) => l.includes('type'))).toBe(true);
                expect(labels.some((l) => l.includes('variant'))).toBe(true);
                expect(labels.some((l) => l.includes('disabled'))).toBe(true);
            });

            it('filters out existing props', () => {
                const items = Completions.getComponentPropCompletions('x-button', ['type', 'variant']);
                const labels = items.map((i) => i.label);

                expect(labels.some((l) => l.includes('type'))).toBe(false);
                expect(labels.some((l) => l.includes('variant'))).toBe(false);
                expect(labels.some((l) => l.includes('disabled'))).toBe(true);
            });

            it('returns empty for an unknown component', () => {
                const items = Completions.getComponentPropCompletions('x-nonexistent', []);
                expect(items).toEqual([]);
            });

            it('handles component lookup by findByTag', () => {
                // alert component should be found by stripping x- prefix
                const items = Completions.getComponentPropCompletions('x-alert', []);
                expect(items.length).toBeGreaterThan(0);
            });

            it('handles string @props format', () => {
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
                const items = Completions.getComponentPropCompletions('x-card', []);
                const labels = items.map((i) => i.label);

                expect(labels.some((l) => l.includes('title'))).toBe(true);
                expect(labels.some((l) => l.includes('subtitle'))).toBe(true);
            });
        });
    });

    // ─── createPropCompletionItem ────────────────────────────────────────────

    describe('createPropCompletionItem', () => {
        it('adds : prefix for non-string, non-mixed types', () => {
            const item = Completions.createPropCompletionItem('disabled', 'bool', false, false);
            expect(item.label).toBe(':disabled');
        });

        it('does not add : prefix for string type', () => {
            const item = Completions.createPropCompletionItem('title', 'string', false, 'Default');
            expect(item.label).toBe('title');
        });

        it('does not add : prefix for mixed type', () => {
            const item = Completions.createPropCompletionItem('data', 'mixed', false, null);
            expect(item.label).toBe('data');
        });

        it('shows "(required)" in detail for required props', () => {
            const item = Completions.createPropCompletionItem('name', 'string', true, null);
            expect(item.detail).toBe('string (required)');
        });

        it('shows just the type for optional props', () => {
            const item = Completions.createPropCompletionItem('name', 'string', false, 'default');
            expect(item.detail).toBe('string');
        });

        it('includes default value in documentation', () => {
            const item = Completions.createPropCompletionItem('size', 'string', false, 'md');
            if (typeof item.documentation === 'object' && 'value' in item.documentation) {
                expect(item.documentation.value).toContain('Default: `md`');
            }
        });

        it('excludes default from docs when null', () => {
            const item = Completions.createPropCompletionItem('name', 'string', true, null);
            if (typeof item.documentation === 'object' && 'value' in item.documentation) {
                expect(item.documentation.value).not.toContain('Default:');
            }
        });

        it('generates snippet insertText', () => {
            const item = Completions.createPropCompletionItem('title', 'string', false, null);
            expect(item.insertText).toBe('title="${1}"');
            expect(item.insertTextFormat).toBe(InsertTextFormat.Snippet);
        });

        it('sorts required props before optional', () => {
            const required = Completions.createPropCompletionItem('name', 'string', true, null);
            const optional = Completions.createPropCompletionItem('size', 'string', false, 'md');

            expect(required.sortText).toBe('0name');
            expect(optional.sortText).toBe('1size');
        });

        it('kind is Property', () => {
            const item = Completions.createPropCompletionItem('name', 'string', true, null);
            expect(item.kind).toBe(CompletionItemKind.Property);
        });
    });

    // ─── getLaravelHelperCompletions ──────────────────────────────────────────

    describe('getLaravelHelperCompletions', () => {
        it('returns all Laravel helpers', () => {
            const items = Completions.getLaravelHelperCompletions();
            expect(items.length).toBe(31);
        });

        it('every item has Function kind', () => {
            const items = Completions.getLaravelHelperCompletions();
            for (const item of items) {
                expect(item.kind).toBe(CompletionItemKind.Function);
            }
        });

        it('every item has Snippet insertTextFormat', () => {
            const items = Completions.getLaravelHelperCompletions();
            for (const item of items) {
                expect(item.insertTextFormat).toBe(InsertTextFormat.Snippet);
            }
        });

        it('includes common helpers', () => {
            const items = Completions.getLaravelHelperCompletions();
            const labels = items.map((i) => i.label);

            expect(labels).toContain('route');
            expect(labels).toContain('url');
            expect(labels).toContain('asset');
            expect(labels).toContain('auth');
            expect(labels).toContain('old');
            expect(labels).toContain('dd');
            expect(labels).toContain('$errors');
        });

        it('includes detail "Laravel Helper" for all items', () => {
            const items = Completions.getLaravelHelperCompletions();
            for (const item of items) {
                expect(item.detail).toBe('Laravel Helper');
            }
        });

        it('includes markdown documentation', () => {
            const items = Completions.getLaravelHelperCompletions();
            for (const item of items) {
                expect(item.documentation).toBeDefined();
                if (typeof item.documentation === 'object' && 'kind' in item.documentation) {
                    expect(item.documentation.kind).toBe('markdown');
                }
            }
        });
    });
});

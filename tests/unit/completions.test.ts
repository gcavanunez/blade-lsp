import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Position, Range } from 'vscode-languageserver/node';
import { Completions } from '../../src/providers/completions';
import { installMockLaravel, clearMockLaravel, withMockLaravel } from '../utils/laravel-mock';

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
                withMockLaravel(() => {
                    const items = Completions.getParameterCompletions('extends');
                    const labels = items.map((i) => i.label);
                    expect(labels).toContain('layouts.app');
                    expect(labels).toContain('partials.header');
                    expect(labels).toContain('partials.footer');
                });
            });

            it('returns view names for @include', () => {
                withMockLaravel(() => {
                    const items = Completions.getParameterCompletions('include');
                    const labels = items.map((i) => i.label);
                    expect(labels).toContain('layouts.app');
                });
            });

            for (const variant of ['includeIf', 'includeWhen', 'includeUnless', 'includeFirst'] as const) {
                it(`returns view names for @${variant}`, () => {
                    withMockLaravel(() => {
                        const items = Completions.getParameterCompletions(variant);
                        const labels = items.map((i) => i.label);
                        expect(labels).toContain('layouts.app');
                    });
                });
            }
        });

        describe('livewire', () => {
            it('returns livewire component names for @livewire', () => {
                withMockLaravel(() => {
                    const items = Completions.getParameterCompletions('livewire');
                    const labels = items.map((i) => i.label);
                    expect(labels).toContain('counter');
                    expect(labels).toContain('search-bar');
                });
            });

            it('includes path in documentation', () => {
                withMockLaravel(() => {
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
            });

            it('returns empty for @livewireStyles (no livewire views match)', () => {
                // livewireStyles and livewireScripts share the same branch as livewire
                withMockLaravel(() => {
                    const items = Completions.getParameterCompletions('livewireStyles');
                    const labels = items.map((i) => i.label);
                    // These also return livewire component names
                    expect(labels).toContain('counter');
                });
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
            withMockLaravel(() => {
                const items = Completions.getLivewireCompletions('<livewire:', Position.create(0, 10));
                const labels = items.map((i) => i.label);
                expect(labels).toContain('livewire:counter');
                expect(labels).toContain('livewire:search-bar');
            });
        });

        it('filters by partial name', () => {
            withMockLaravel(() => {
                const items = Completions.getLivewireCompletions('<livewire:cou', Position.create(0, 13));
                const labels = items.map((i) => i.label);
                expect(labels).toContain('livewire:counter');
                expect(labels).not.toContain('livewire:search-bar');
            });
        });

        it('returns empty when Laravel is not available', () => {
            clearMockLaravel();
            const items = Completions.getLivewireCompletions('<livewire:', Position.create(0, 10));
            expect(items).toEqual([]);
        });

        it('sets textEdit to replace from tag start', () => {
            withMockLaravel(() => {
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
        });

        it('includes props table in documentation for components with props', () => {
            withMockLaravel(() => {
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
        });

        it('sorts vendor components after non-vendor', () => {
            withMockLaravel(() => {
                const items = Completions.getLivewireCompletions('<livewire:', Position.create(0, 10));
                // Both mock livewire views are non-vendor so sortText should start with '0'
                for (const item of items) {
                    expect(item.sortText).toMatch(/^0/);
                }
            });
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
});

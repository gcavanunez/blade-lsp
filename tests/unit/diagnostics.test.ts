import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Diagnostics } from '../../src/providers/diagnostics';
import { installMockLaravel, clearMockLaravel } from '../utils/laravel-mock';

describe('Diagnostics', () => {
    describe('getInvalidMethodDiagnostics', () => {
        it('detects invalid HTTP method', () => {
            const source = "@method('INVALID')";
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].code).toBe(Diagnostics.Code.invalidMethod);
        });

        it('returns empty for no @method directives', () => {
            const source = '<div>Hello</div>';
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('accepts lowercase method values (case-insensitive)', () => {
            const source = "@method('put')";
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('accepts double-quoted method values', () => {
            const source = '@method("DELETE")';
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects multiple @method directives on separate lines', () => {
            const source = "@method('INVALID1')\n@method('INVALID2')";
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags.length).toBe(2);
        });

        it('ignores @method directives inside Blade comments', () => {
            const source = "{{-- @method('INVALID') --}}";
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('ignores @method directives inside HTML comments', () => {
            const source = "<!-- @method('INVALID') -->";
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('validates all accepted HTTP methods', () => {
            for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
                const source = `@method('${method}')`;
                const diags = Diagnostics.getInvalidMethodDiagnostics(source);
                expect(diags).toEqual([]);
            }
        });
    });

    describe('getUnclosedDirectiveDiagnostics', () => {
        it('detects unclosed @if', () => {
            const source = '@if($show)\n  <p>test</p>';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].code).toBe(Diagnostics.Code.unclosedDirective);
            expect(diags[0].message).toContain('@if');
        });

        it('returns empty for properly closed directives', () => {
            const source = '@if($show)\n  <p>test</p>\n@endif';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects unclosed @foreach', () => {
            const source = '@foreach($items as $item)\n  {{ $item }}';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@foreach');
        });

        it('handles nested directives correctly', () => {
            const source = '@if($a)\n  @foreach($items as $item)\n    {{ $item }}\n  @endforeach\n@endif';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects multiple unclosed directives', () => {
            const source = '@if($a)\n@foreach($items as $item)';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(2);
        });

        it('detects unexpected closing directive without opener', () => {
            const source = '@endif';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('Unexpected');
            expect(diags[0].message).toContain('@endif');
            expect(diags[0].message).toContain('@if');
        });

        it('detects stray @endforeach without @foreach', () => {
            const source = '@endforeach';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@endforeach');
        });

        it('ignores directives inside blade comments', () => {
            const source = '{{-- @if($show) --}}\n<p>test</p>';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('ignores directives inside html comments', () => {
            const source = '<!-- @if($show) -->\n<p>test</p>';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('handles @forelse / @endforelse (without @empty clause)', () => {
            const source = '@forelse($items as $item)\n  {{ $item }}\n@endforelse';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('handles @forelse with @empty clause correctly', () => {
            // @empty inside @forelse is a clause separator, not a block opener
            const source = '@forelse($items as $item)\n  {{ $item }}\n@empty\n  No items\n@endforelse';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('still detects standalone @empty without @endempty', () => {
            // Outside of @forelse, @empty is a block directive needing @endempty
            const source = '@empty($items)\n  No items';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@empty');
            expect(diags[0].message).toContain('@endempty');
        });

        it('handles standalone @empty / @endempty correctly', () => {
            const source = '@empty($items)\n  No items\n@endempty';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects unclosed @forelse', () => {
            const source = '@forelse($items as $item)\n  {{ $item }}';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@forelse');
        });

        it('handles @while / @endwhile correctly', () => {
            const source = '@while(true)\n  loop\n@endwhile';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects unclosed @while', () => {
            const source = '@while(true)\n  loop';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@while');
        });

        it('does not flag @php(...) inline expression as unclosed', () => {
            const source = "@php($x = 'hello')";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('does not flag @php (...) with space before parens as unclosed', () => {
            const source = "@php ($x = 'hello')";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects unclosed @php block (no parens)', () => {
            const source = '@php\n  $x = 1;';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@php');
            expect(diags[0].message).toContain('@endphp');
        });

        it('handles @php block with @endphp correctly', () => {
            const source = '@php\n  $x = 1;\n@endphp';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('handles @php(...) alongside @php block in same document', () => {
            const source = '@php($y = 2)\n@php\n  $x = 1;\n@endphp';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('does not flag @section with two args (inline form)', () => {
            const source = "@section('title', 'My Page Title')";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects unclosed @section with one arg (block form)', () => {
            const source = "@section('content')\n  <p>Hello</p>";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@section');
            expect(diags[0].message).toContain('@endsection');
        });

        it('handles @section block closed with @endsection', () => {
            const source = "@section('content')\n  <p>Hello</p>\n@endsection";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('handles @section block closed with @show', () => {
            const source = "@section('sidebar')\n  <p>Default sidebar</p>\n@show";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('handles @section block closed with @stop', () => {
            const source = "@section('content')\n  <p>Hello</p>\n@stop";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('handles @section block closed with @overwrite', () => {
            const source = "@section('content')\n  <p>Overwritten</p>\n@overwrite";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('handles inline @section alongside block @section', () => {
            const source = "@section('title', 'My Page')\n@section('content')\n  <p>Hello</p>\n@endsection";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        // ─── @push, @prepend, @slot inline vs block ─────────────────────

        it('does not flag @push with two args (inline form)', () => {
            const source = "@push('scripts', '<script src=\"app.js\"></script>')";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects unclosed @push with one arg (block form)', () => {
            const source = "@push('scripts')\n  <script>alert('hello')</script>";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@push');
        });

        it('handles @push block with @endpush', () => {
            const source = "@push('scripts')\n  <script>alert('hello')</script>\n@endpush";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('does not flag @prepend with two args (inline form)', () => {
            const source = '@prepend(\'styles\', \'<link rel="stylesheet" href="app.css">\')';
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('does not flag @slot with two args (inline form)', () => {
            const source = "@slot('title', 'My Title')";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('detects unclosed @slot with one arg (block form)', () => {
            const source = "@slot('header')\n  <h1>Title</h1>";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@slot');
        });

        it('does not flag @pushOnce with two args (inline form)', () => {
            const source = "@pushOnce('scripts', '<script>init()</script>')";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('does not flag @prependOnce with two args (inline form)', () => {
            const source = "@prependOnce('styles', '<style>body{}</style>')";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        // ─── two-arg edge cases ──────────────────────────────────────────

        it('handles two args where second arg contains nested parens', () => {
            const source = "@section('title', ucfirst('hello'))";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('handles two args where second arg contains nested brackets', () => {
            const source = "@section('data', ['key' => 'value'])";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags).toEqual([]);
        });

        it('does not treat comma inside a string as two args', () => {
            const source = "@section('content, more')\n  <p>Hello</p>";
            const diags = Diagnostics.getUnclosedDirectiveDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].message).toContain('@section');
        });
    });

    describe('with mock Laravel context', () => {
        beforeEach(() => {
            installMockLaravel();
        });

        afterEach(() => {
            clearMockLaravel();
        });

        describe('getUndefinedViewDiagnostics', () => {
            const viewCases: Array<{
                name: string;
                source: string;
                expectedCount: number;
                expectedCode?: string;
            }> = [
                {
                    name: 'detects undefined view in @include',
                    source: "@include('nonexistent.view')",
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedView,
                },
                {
                    name: 'accepts existing view in @include',
                    source: "@include('layouts.app')",
                    expectedCount: 0,
                },
                {
                    name: 'detects undefined view in @extends',
                    source: "@extends('nonexistent.layout')",
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedView,
                },
                {
                    name: 'accepts existing view in @extends',
                    source: "@extends('layouts.app')",
                    expectedCount: 0,
                },
                {
                    name: 'detects undefined view in @includeWhen (second string arg)',
                    source: "@includeWhen(true, 'nonexistent.view')",
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedView,
                },
                {
                    name: 'accepts existing view in @includeWhen',
                    source: "@includeWhen(true, 'layouts.app')",
                    expectedCount: 0,
                },
                {
                    name: 'detects undefined view in @includeUnless (second string arg)',
                    source: "@includeUnless(false, 'nonexistent.view')",
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedView,
                },
                {
                    name: 'accepts existing view in @includeUnless',
                    source: "@includeUnless(false, 'layouts.app')",
                    expectedCount: 0,
                },
                {
                    name: 'detects undefined view in @each',
                    source: "@each('nonexistent.item', $items, 'item')",
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedView,
                },
                {
                    name: 'accepts existing view in @each',
                    source: "@each('layouts.app', $items, 'item')",
                    expectedCount: 0,
                },
                {
                    name: 'detects undefined view in view() helper',
                    source: "{{ view('nonexistent.view') }}",
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedView,
                },
                {
                    name: 'accepts existing view in view() helper',
                    source: "{{ view('layouts.app') }}",
                    expectedCount: 0,
                },
                {
                    name: 'detects multiple undefined views across lines',
                    source: "@include('missing.one')\n@extends('missing.two')",
                    expectedCount: 2,
                    expectedCode: Diagnostics.Code.undefinedView,
                },
            ];

            it.each(viewCases)('$name', ({ source, expectedCount, expectedCode }) => {
                const diags = Diagnostics.getUndefinedViewDiagnostics(source);
                expect(diags.length).toBe(expectedCount);
                if (expectedCode && expectedCount > 0) {
                    expect(diags[0].code).toBe(expectedCode);
                }
            });

            it('returns empty when Laravel is not available', () => {
                clearMockLaravel();
                const source = "@include('nonexistent.view')";
                const diags = Diagnostics.getUndefinedViewDiagnostics(source);
                expect(diags).toEqual([]);
            });
        });

        describe('getUndefinedComponentDiagnostics', () => {
            const componentCases: Array<{
                name: string;
                source: string;
                expectedCount: number;
                expectedCode?: string;
                expectedMessageIncludes?: string[];
            }> = [
                {
                    name: 'detects undefined x- component',
                    source: '<x-nonexistent />',
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedComponent,
                },
                {
                    name: 'accepts existing x- component',
                    source: '<x-button />',
                    expectedCount: 0,
                },
                {
                    name: 'detects undefined Livewire component',
                    source: '<livewire:nonexistent />',
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedComponent,
                    expectedMessageIncludes: ['Livewire', 'nonexistent'],
                },
                {
                    name: 'accepts existing Livewire component',
                    source: '<livewire:counter />',
                    expectedCount: 0,
                },
                {
                    name: 'detects undefined namespaced component',
                    source: '<flux:nonexistent />',
                    expectedCount: 1,
                    expectedCode: Diagnostics.Code.undefinedComponent,
                },
                {
                    name: 'does not flag x-slot as undefined',
                    source: '<x-slot name="header">Title</x-slot>',
                    expectedCount: 0,
                },
                {
                    name: 'does not flag x-slot:name as undefined',
                    source: '<x-slot:header>Title</x-slot:header>',
                    expectedCount: 0,
                },
                {
                    name: 'does not flag closing tags',
                    source: '</x-nonexistent>',
                    expectedCount: 0,
                },
                {
                    name: 'detects multiple undefined components on separate lines',
                    source: '<x-missing-one />\n<x-missing-two />',
                    expectedCount: 2,
                    expectedCode: Diagnostics.Code.undefinedComponent,
                },
            ];

            it.each(componentCases)('$name', ({ source, expectedCount, expectedCode, expectedMessageIncludes }) => {
                const diags = Diagnostics.getUndefinedComponentDiagnostics(source);
                expect(diags.length).toBe(expectedCount);
                if (expectedCode && expectedCount > 0) {
                    expect(diags[0].code).toBe(expectedCode);
                }
                if (expectedMessageIncludes && expectedCount > 0) {
                    for (const fragment of expectedMessageIncludes) {
                        expect(diags[0].message).toContain(fragment);
                    }
                }
            });

            it('returns empty when Laravel is not available', () => {
                clearMockLaravel();
                const source = '<x-nonexistent />';
                const diags = Diagnostics.getUndefinedComponentDiagnostics(source);
                expect(diags).toEqual([]);
            });
        });

        describe('analyze', () => {
            it('aggregates all diagnostic types', () => {
                const source = "@include('nonexistent')\n@method('INVALID')\n@if(true)";
                const diags = Diagnostics.analyze(source);
                // Should have at least undefined view + invalid method + unclosed if
                expect(diags.length).toBeGreaterThanOrEqual(3);
            });

            it('returns empty for a clean document', () => {
                const source = "@extends('layouts.app')\n@section('content')\n  <p>Hello</p>\n@endsection";
                const diags = Diagnostics.analyze(source);
                expect(diags).toEqual([]);
            });
        });
    });
});

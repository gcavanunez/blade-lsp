import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Diagnostics } from '../../src/providers/diagnostics';
import { installMockLaravel, clearMockLaravel, withMockLaravel } from '../utils/laravel-mock';

describe('Diagnostics', () => {
    describe('getInvalidMethodDiagnostics', () => {
        it('detects invalid HTTP method', () => {
            const source = "@method('INVALID')";
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags.length).toBe(1);
            expect(diags[0].code).toBe(Diagnostics.Code.invalidMethod);
        });

        it('accepts valid HTTP methods', () => {
            for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
                const source = `@method('${method}')`;
                const diags = Diagnostics.getInvalidMethodDiagnostics(source);
                expect(diags).toEqual([]);
            }
        });

        it('returns empty for no @method directives', () => {
            const source = '<div>Hello</div>';
            const diags = Diagnostics.getInvalidMethodDiagnostics(source);
            expect(diags).toEqual([]);
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
    });

    describe('with mock Laravel context', () => {
        beforeEach(() => {
            installMockLaravel();
        });

        afterEach(() => {
            clearMockLaravel();
        });

        describe('getUndefinedViewDiagnostics', () => {
            it('detects undefined view in @include', () => {
                withMockLaravel(() => {
                    const source = "@include('nonexistent.view')";
                    const diags = Diagnostics.getUndefinedViewDiagnostics(source);
                    expect(diags.length).toBe(1);
                    expect(diags[0].code).toBe(Diagnostics.Code.undefinedView);
                });
            });

            it('accepts existing view in @include', () => {
                withMockLaravel(() => {
                    const source = "@include('layouts.app')";
                    const diags = Diagnostics.getUndefinedViewDiagnostics(source);
                    expect(diags).toEqual([]);
                });
            });

            it('detects undefined view in @extends', () => {
                withMockLaravel(() => {
                    const source = "@extends('nonexistent.layout')";
                    const diags = Diagnostics.getUndefinedViewDiagnostics(source);
                    expect(diags.length).toBe(1);
                });
            });

            it('accepts existing view in @extends', () => {
                withMockLaravel(() => {
                    const source = "@extends('layouts.app')";
                    const diags = Diagnostics.getUndefinedViewDiagnostics(source);
                    expect(diags).toEqual([]);
                });
            });
        });

        describe('getUndefinedComponentDiagnostics', () => {
            it('detects undefined x- component', () => {
                withMockLaravel(() => {
                    const source = '<x-nonexistent />';
                    const diags = Diagnostics.getUndefinedComponentDiagnostics(source);
                    expect(diags.length).toBe(1);
                    expect(diags[0].code).toBe(Diagnostics.Code.undefinedComponent);
                });
            });

            it('accepts existing x- component', () => {
                withMockLaravel(() => {
                    const source = '<x-button />';
                    const diags = Diagnostics.getUndefinedComponentDiagnostics(source);
                    expect(diags).toEqual([]);
                });
            });
        });

        describe('analyze', () => {
            it('aggregates all diagnostic types', () => {
                withMockLaravel(() => {
                    const source = "@include('nonexistent')\n@method('INVALID')\n@if(true)";
                    const diags = Diagnostics.analyze(source);
                    // Should have at least undefined view + invalid method + unclosed if
                    expect(diags.length).toBeGreaterThanOrEqual(3);
                });
            });

            it('returns empty for a clean document', () => {
                withMockLaravel(() => {
                    const source = "@extends('layouts.app')\n@section('content')\n  <p>Hello</p>\n@endsection";
                    const diags = Diagnostics.analyze(source);
                    expect(diags).toEqual([]);
                });
            });
        });
    });
});

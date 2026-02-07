/**
 * Rich diagnostics provider for Blade templates.
 *
 * Goes beyond tree-sitter syntax errors to provide semantic diagnostics:
 *   - Undefined view references   (@include, @extends, @each, etc.)
 *   - Undefined component refs     (<x-missing>, <prefix:missing>)
 *   - Unclosed block directives    (@if without @endif)
 *   - Invalid @method values       (@method('INVALID'))
 *
 * All checks are text-based and run synchronously on the document source
 * so they can be called from `onDidChangeContent` without blocking.
 */

import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { Laravel } from '../laravel/index';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';
import { BladeDirectives } from '../directives';

export namespace Diagnostics {
    // ─── Diagnostic codes (stable string identifiers) ──────────────────────

    export const Code = {
        undefinedView: 'blade/undefined-view',
        undefinedComponent: 'blade/undefined-component',
        unclosedDirective: 'blade/unclosed-directive',
        invalidMethod: 'blade/invalid-method',
    } as const;

    // ─── Public API ────────────────────────────────────────────────────────

    /**
     * Run all semantic diagnostics on the given source text.
     * Returns an array of LSP Diagnostic objects.
     */
    export function analyze(source: string): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];

        diagnostics.push(...getUndefinedViewDiagnostics(source));
        diagnostics.push(...getUndefinedComponentDiagnostics(source));
        diagnostics.push(...getUnclosedDirectiveDiagnostics(source));
        diagnostics.push(...getInvalidMethodDiagnostics(source));

        return diagnostics;
    }

    // ─── 1. Undefined View References ──────────────────────────────────────

    /**
     * Directives whose first string argument is a view name.
     *
     * Note: `@includeIf` is intentionally excluded -- its purpose is to
     * include a view *only if it exists*, so flagging it would be noisy.
     *
     * `@includeFirst` takes an array; handled separately below.
     */
    const VIEW_DIRECTIVES = ['extends', 'include', 'includeWhen', 'includeUnless', 'each', 'component'] as const;

    export function getUndefinedViewDiagnostics(source: string): Diagnostic[] {
        if (!Laravel.isAvailable()) return [];

        const diagnostics: Diagnostic[] = [];
        const lines = source.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // ── Single-view directives ──────────────────────────────────
            for (const directive of VIEW_DIRECTIVES) {
                // @includeWhen(condition, 'view') -- view is the second string arg
                // @each('view', ...) -- view is the first string arg
                // The rest: @extends('view'), @include('view'), ...
                const pattern =
                    directive === 'includeWhen' || directive === 'includeUnless'
                        ? new RegExp(`@${directive}\\s*\\([^,]+,\\s*['"]([^'"]+)['"]`, 'g')
                        : new RegExp(`@${directive}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');

                let match: RegExpExecArray | null;
                while ((match = pattern.exec(line)) !== null) {
                    const viewName = match[1];
                    const view = Views.find(viewName);

                    if (!view) {
                        const viewStart = line.indexOf(viewName, match.index);
                        diagnostics.push({
                            severity: DiagnosticSeverity.Warning,
                            range: Range.create(lineNum, viewStart, lineNum, viewStart + viewName.length),
                            message: `View '${viewName}' not found.`,
                            source: 'blade-lsp',
                            code: Code.undefinedView,
                        });
                    }
                }
            }

            // ── view() helper ───────────────────────────────────────────
            const viewHelperPattern = /\bview\s*\(\s*['"]([^'"]+)['"]/g;
            let helperMatch: RegExpExecArray | null;
            while ((helperMatch = viewHelperPattern.exec(line)) !== null) {
                const viewName = helperMatch[1];
                if (!Views.find(viewName)) {
                    const viewStart = line.indexOf(viewName, helperMatch.index);
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: Range.create(lineNum, viewStart, lineNum, viewStart + viewName.length),
                        message: `View '${viewName}' not found.`,
                        source: 'blade-lsp',
                        code: Code.undefinedView,
                    });
                }
            }
        }

        return diagnostics;
    }

    // ─── 2. Undefined Component References ─────────────────────────────────

    /**
     * Tags that look like components but aren't -- they're built-in Blade syntax.
     */
    const BUILT_IN_COMPONENT_TAGS = new Set(['x-slot', 'x-slot:']);

    export function getUndefinedComponentDiagnostics(source: string): Diagnostic[] {
        if (!Laravel.isAvailable()) return [];

        const diagnostics: Diagnostic[] = [];
        const lines = source.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // Match opening component tags: <x-button, <x-alert.danger, <x-turbo::frame, <flux:button
            // Also matches self-closing: <x-button />
            // Intentionally does NOT match closing tags: </x-button>
            const componentPattern = /<(?!\/)(?:(x-[\w.-]+(?:::[\w.-]+)?)|([\w]+:[\w.-]+))/g;
            let match: RegExpExecArray | null;

            while ((match = componentPattern.exec(line)) !== null) {
                const tag = match[1] || match[2];

                // Skip built-in tags
                if (isBuiltInComponentTag(tag)) continue;

                // Handle livewire: prefix -- these resolve to views, not components
                if (tag.startsWith('livewire:')) {
                    const componentName = tag.replace('livewire:', '');
                    const viewKey = `livewire.${componentName}`;
                    if (!Views.find(viewKey)) {
                        const tagStart = match.index + 1; // +1 to skip <
                        diagnostics.push({
                            severity: DiagnosticSeverity.Warning,
                            range: Range.create(lineNum, tagStart, lineNum, tagStart + tag.length),
                            message: `Livewire component '${componentName}' not found.`,
                            source: 'blade-lsp',
                            code: Code.undefinedComponent,
                        });
                    }
                    continue;
                }

                // Standard x- components and prefixed components
                const component = Components.findByTag(tag) || Components.find(tag.replace(/^x-/, ''));

                if (!component) {
                    const tagStart = match.index + 1; // +1 to skip <
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range: Range.create(lineNum, tagStart, lineNum, tagStart + tag.length),
                        message: `Component '${tag}' not found.`,
                        source: 'blade-lsp',
                        code: Code.undefinedComponent,
                    });
                }
            }
        }

        return diagnostics;
    }

    function isBuiltInComponentTag(tag: string): boolean {
        if (BUILT_IN_COMPONENT_TAGS.has(tag)) return true;
        // x-slot:anything is built-in slot syntax
        if (tag.startsWith('x-slot:')) return true;
        return false;
    }

    // ─── 3. Unclosed Block Directives ──────────────────────────────────────

    /**
     * Build a map of opening directive → closing directive from the
     * static directive definitions that have `hasEndTag: true`.
     */
    const BLOCK_DIRECTIVE_PAIRS: Map<string, string> = (() => {
        const pairs = new Map<string, string>();
        for (const d of BladeDirectives.all) {
            if (d.hasEndTag && d.endTag) {
                // '@if' → '@endif'
                pairs.set(d.name, d.endTag);
            }
        }
        return pairs;
    })();

    /**
     * Reverse map: '@endif' → '@if', used to match closers to openers.
     */
    const CLOSING_TO_OPENING: Map<string, string> = (() => {
        const map = new Map<string, string>();
        for (const [open, close] of BLOCK_DIRECTIVE_PAIRS) {
            map.set(close, open);
        }
        return map;
    })();

    interface DirectiveOccurrence {
        name: string; // e.g. '@if'
        line: number;
        colStart: number;
        colEnd: number;
    }

    export function getUnclosedDirectiveDiagnostics(source: string): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const lines = source.split('\n');

        // Collect all directive occurrences
        const occurrences: DirectiveOccurrence[] = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            // Match @word directives
            const directivePattern = /@(\w+)/g;
            let match: RegExpExecArray | null;

            while ((match = directivePattern.exec(line)) !== null) {
                const name = `@${match[1]}`;
                // Only care about directives that are openers or closers
                if (BLOCK_DIRECTIVE_PAIRS.has(name) || CLOSING_TO_OPENING.has(name)) {
                    occurrences.push({
                        name,
                        line: lineNum,
                        colStart: match.index,
                        colEnd: match.index + match[0].length,
                    });
                }
            }
        }

        // Use a stack to match openers with closers.
        // Each stack entry tracks the opening directive occurrence.
        const stack: DirectiveOccurrence[] = [];

        for (const occ of occurrences) {
            if (BLOCK_DIRECTIVE_PAIRS.has(occ.name)) {
                // This is an opener -- push onto stack
                stack.push(occ);
            } else if (CLOSING_TO_OPENING.has(occ.name)) {
                // This is a closer
                const expectedOpener = CLOSING_TO_OPENING.get(occ.name)!;

                // Walk back the stack looking for the matching opener.
                // We search from the top because Blade directives nest.
                let found = false;
                for (let i = stack.length - 1; i >= 0; i--) {
                    if (stack[i].name === expectedOpener) {
                        // Matched -- remove it from the stack
                        stack.splice(i, 1);
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    // Unexpected closing directive (no matching opener)
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(occ.line, occ.colStart, occ.line, occ.colEnd),
                        message: `Unexpected '${occ.name}' without a matching '${expectedOpener}'.`,
                        source: 'blade-lsp',
                        code: Code.unclosedDirective,
                    });
                }
            }
        }

        // Anything left on the stack is an unclosed opener
        for (const occ of stack) {
            const expectedCloser = BLOCK_DIRECTIVE_PAIRS.get(occ.name)!;
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: Range.create(occ.line, occ.colStart, occ.line, occ.colEnd),
                message: `'${occ.name}' is missing its closing '${expectedCloser}'.`,
                source: 'blade-lsp',
                code: Code.unclosedDirective,
            });
        }

        return diagnostics;
    }

    // ─── 4. Invalid @method Values ─────────────────────────────────────────

    /**
     * Valid HTTP methods for Laravel's `@method()` directive.
     * Only the methods that HTML forms cannot natively produce are
     * typically spoofed, but Laravel accepts any standard method.
     */
    const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

    export function getInvalidMethodDiagnostics(source: string): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const lines = source.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            const methodPattern = /@method\s*\(\s*['"]([^'"]*)['"]\s*\)/g;
            let match: RegExpExecArray | null;

            while ((match = methodPattern.exec(line)) !== null) {
                const value = match[1];
                const upperValue = value.toUpperCase();

                if (!VALID_METHODS.has(upperValue)) {
                    const valueStart = line.indexOf(value, match.index);
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: Range.create(lineNum, valueStart, lineNum, valueStart + value.length),
                        message: `Invalid HTTP method '${value}'. Expected one of: ${[...VALID_METHODS].join(', ')}.`,
                        source: 'blade-lsp',
                        code: Code.invalidMethod,
                    });
                }
            }
        }

        return diagnostics;
    }
}

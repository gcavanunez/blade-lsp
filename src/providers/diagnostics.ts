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
import { BladeParser } from '../parser';
import { iife } from '../utils/iife';
import { Laravel } from '../laravel/index';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';
import { BladeDirectives } from '../directives';

export namespace Diagnostics {

    export const Code = {
        undefinedView: 'blade/undefined-view',
        undefinedComponent: 'blade/undefined-component',
        unclosedDirective: 'blade/unclosed-directive',
        invalidMethod: 'blade/invalid-method',
    } as const;

    interface RegexMatch {
        match: RegExpExecArray;
        captured: string; // The first capture group
    }

    /**
     * Collect all regex matches from a string into a flat array.
     * Eliminates the `while (regex.exec)` pattern inside loops.
     */
    function collectRegexMatches(line: string, pattern: RegExp): RegexMatch[] {
        const results: RegexMatch[] = [];
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            results.push({ match, captured: match[1] });
        }
        return results;
    }

    /**
     * Create an "undefined view" diagnostic.
     */
    function createUndefinedViewDiagnostic(
        lineNum: number,
        line: string,
        viewName: string,
        matchIndex: number,
    ): Diagnostic {
        const viewStart = line.indexOf(viewName, matchIndex);
        return {
            severity: DiagnosticSeverity.Warning,
            range: Range.create(lineNum, viewStart, lineNum, viewStart + viewName.length),
            message: `View '${viewName}' not found.`,
            source: 'blade-lsp',
            code: Code.undefinedView,
        };
    }

    /**
     * Create an "undefined component" diagnostic.
     */
    function createUndefinedComponentDiagnostic(
        row: number,
        colStart: number,
        tag: string,
        isLivewire: boolean,
    ): Diagnostic {
        const componentName = isLivewire ? tag.replace('livewire:', '') : tag;
        return {
            severity: DiagnosticSeverity.Warning,
            range: Range.create(row, colStart, row, colStart + tag.length),
            message: isLivewire ? `Livewire component '${componentName}' not found.` : `Component '${tag}' not found.`,
            source: 'blade-lsp',
            code: Code.undefinedComponent,
        };
    }

    /**
     * Run all semantic diagnostics on the given source text.
     * When a tree is provided, tree-sitter is used for component detection
     * instead of regex.
     */
    export function analyze(source: string, tree?: BladeParser.Tree): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];

        diagnostics.push(...getUndefinedViewDiagnostics(source));
        diagnostics.push(...getUndefinedComponentDiagnostics(source, tree));
        diagnostics.push(...getUnclosedDirectiveDiagnostics(source));
        diagnostics.push(...getInvalidMethodDiagnostics(source));

        return diagnostics;
    }

    /**
     * Directives whose first string argument is a view name.
     *
     * Note: `@includeIf` is intentionally excluded -- its purpose is to
     * include a view *only if it exists*, so flagging it would be noisy.
     *
     * `@includeFirst` takes an array; handled separately below.
     */
    const VIEW_DIRECTIVES = ['extends', 'include', 'includeWhen', 'includeUnless', 'each', 'component'] as const;

    /**
     * Build a regex pattern for a view directive.
     */
    function buildViewDirectivePattern(directive: string): RegExp {
        return directive === 'includeWhen' || directive === 'includeUnless'
            ? new RegExp(`@${directive}\\s*\\([^,]+,\\s*['"]([^'"]+)['"]`, 'g')
            : new RegExp(`@${directive}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');
    }

    /** All view-reference patterns, pre-built once. */
    const VIEW_PATTERNS: RegExp[] = [
        ...VIEW_DIRECTIVES.map(buildViewDirectivePattern),
        /\bview\s*\(\s*['"]([^'"]+)['"]/g,
    ];

    /** Collect undefined-view diagnostics from a single line against all patterns. */
    function collectUndefinedViewsOnLine(lineNum: number, line: string, diagnostics: Diagnostic[]): void {
        for (const pattern of VIEW_PATTERNS) {
            pattern.lastIndex = 0;
            for (const { match, captured: viewName } of collectRegexMatches(line, pattern)) {
                if (!Views.find(viewName)) {
                    diagnostics.push(createUndefinedViewDiagnostic(lineNum, line, viewName, match.index));
                }
            }
        }
    }

    export function getUndefinedViewDiagnostics(source: string): Diagnostic[] {
        if (!Laravel.isAvailable()) return [];

        const diagnostics: Diagnostic[] = [];
        const lines = source.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            collectUndefinedViewsOnLine(lineNum, lines[lineNum], diagnostics);
        }

        return diagnostics;
    }

    /**
     * Tags that look like components but aren't -- they're built-in Blade syntax.
     */
    const BUILT_IN_COMPONENT_TAGS = new Set(['x-slot', 'x-slot:']);

    function isBuiltInComponentTag(tag: string): boolean {
        return BUILT_IN_COMPONENT_TAGS.has(tag) || tag.startsWith('x-slot:');
    }

    /**
     * Check whether a component tag resolves to a known component/view.
     * Returns true if the tag is valid (found or built-in), false if undefined.
     */
    function isComponentDefined(tag: string): boolean {
        if (tag.startsWith('livewire:')) {
            const viewKey = `livewire.${tag.replace('livewire:', '')}`;
            return !!Views.find(viewKey);
        }
        return !!(Components.findByTag(tag) || Components.find(tag.replace(/^x-/, '')));
    }

    export function getUndefinedComponentDiagnostics(source: string, tree?: BladeParser.Tree): Diagnostic[] {
        if (!Laravel.isAvailable()) return [];

        const diagnostics: Diagnostic[] = [];

        if (tree) {
            const refs = BladeParser.getAllComponentReferences(tree);
            for (const ref of refs) {
                const tag = ref.tagName;
                if (isBuiltInComponentTag(tag)) continue;

                if (!isComponentDefined(tag)) {
                    const tagNameStart = ref.startPosition.column + 1;
                    diagnostics.push(
                        createUndefinedComponentDiagnostic(
                            ref.startPosition.row,
                            tagNameStart,
                            tag,
                            tag.startsWith('livewire:'),
                        ),
                    );
                }
            }

            return diagnostics;
        }

        const lines = source.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const componentPattern = /<(?!\/)(?:(x-[\w.-]+(?:::[\w.-]+)?)|([\w]+:[\w.-]+))/g;

            for (const { match } of collectRegexMatches(line, componentPattern)) {
                const tag = match[1] || match[2];
                if (isBuiltInComponentTag(tag)) continue;

                if (!isComponentDefined(tag)) {
                    const tagStart = match.index + 1; // +1 to skip <
                    diagnostics.push(
                        createUndefinedComponentDiagnostic(lineNum, tagStart, tag, tag.startsWith('livewire:')),
                    );
                }
            }
        }

        return diagnostics;
    }

    /**
     * Build a map of opening directive -> closing directive from the
     * static directive definitions that have `hasEndTag: true`.
     */
    const BLOCK_DIRECTIVE_PAIRS: Map<string, string> = iife(() => {
        const pairs = new Map<string, string>();
        for (const d of BladeDirectives.all) {
            if (d.hasEndTag && d.endTag) {
                // '@if' -> '@endif'
                pairs.set(d.name, d.endTag);
            }
        }
        return pairs;
    });

    /**
     * Reverse map: '@endif' -> '@if', used to match closers to openers.
     *
     * Also includes alternate closers for directives that accept multiple
     * closing tags. For example, `@section` can be closed by `@endsection`,
     * `@show`, `@stop`, or `@overwrite`.
     */
    const CLOSING_TO_OPENING: Map<string, string> = iife(() => {
        const map = new Map<string, string>();
        for (const [open, close] of BLOCK_DIRECTIVE_PAIRS) {
            map.set(close, open);
        }

        // @section can also be closed by @show, @stop, or @overwrite
        map.set('@show', '@section');
        map.set('@stop', '@section');
        map.set('@overwrite', '@section');

        return map;
    });

    /**
     * Directives that act as clause separators inside specific parent blocks.
     * When encountered inside the parent, they should be ignored (not treated
     * as block openers). Outside their parent, they behave as normal block
     * directives.
     *
     * Example: `@empty` inside `@forelse` is a clause separator, but
     * standalone `@empty($var)` is a block directive needing `@endempty`.
     */
    const CLAUSE_DIRECTIVES: Map<string, string> = new Map([['@empty', '@forelse']]);

    /**
     * Block directives that become inline when followed by parentheses.
     *
     * `@php($x = 1)` is an inline expression -- no `@endphp` needed.
     * `@php\n  ...\n@endphp` is a block -- needs closing.
     */
    const INLINE_WHEN_PARENS = new Set(['@php']);

    /**
     * Block directives that become inline when called with two arguments.
     *
     * `@section('title', 'My Page')` is inline -- no `@endsection` needed.
     * `@section('content')` with one arg is a block -- needs closing.
     *
     * Same pattern applies to @push, @pushOnce, @prepend, @prependOnce, @slot.
     */
    const INLINE_WHEN_TWO_ARGS = new Set(['@section', '@push', '@pushOnce', '@prepend', '@prependOnce', '@slot']);

    /**
     * Check if a directive invocation has two top-level arguments in its
     * parentheses. We look for a comma after the first quoted string argument
     * that sits at the top nesting level (not inside brackets, nested parens,
     * or strings).
     *
     * Examples:
     *   "@section('title', 'My Page')"  -> true  (two args)
     *   "@section('content')"           -> false (one arg)
     *   "@push('scripts', '<script>')"  -> true  (two args)
     */
    function hasTwoArgs(afterDirective: string): boolean {
        const parenMatch = afterDirective.match(/^\s*\(/);
        if (!parenMatch) return false;

        const startIndex = parenMatch[0].length;
        let depth = 0;
        let inSingleQuote = false;
        let inDoubleQuote = false;

        for (let i = startIndex; i < afterDirective.length; i++) {
            const ch = afterDirective[i];
            const prev = i > 0 ? afterDirective[i - 1] : '';

            if (inSingleQuote) {
                if (ch === "'" && prev !== '\\') inSingleQuote = false;
                continue;
            }
            if (inDoubleQuote) {
                if (ch === '"' && prev !== '\\') inDoubleQuote = false;
                continue;
            }

            if (ch === "'") {
                inSingleQuote = true;
                continue;
            }
            if (ch === '"') {
                inDoubleQuote = true;
                continue;
            }
            if (ch === '(' || ch === '[') {
                depth++;
                continue;
            }
            if (ch === ')' || ch === ']') {
                if (depth === 0) return false; // closing outer paren -- end of args
                depth--;
                continue;
            }
            if (ch === ',' && depth === 0) return true; // top-level comma -> two args
        }

        return false;
    }

    interface DirectiveOccurrence {
        name: string; // e.g. '@if'
        line: number;
        colStart: number;
        colEnd: number;
    }

    /**
     * Check if a block directive should be treated as inline at a given position.
     * Extracted to flatten nested conditionals in the scan loop.
     */
    function isInlineDirective(name: string, afterDirective: string): boolean {
        if (INLINE_WHEN_PARENS.has(name) && /^\s*\(/.test(afterDirective)) {
            return true;
        }
        if (INLINE_WHEN_TWO_ARGS.has(name) && hasTwoArgs(afterDirective)) {
            return true;
        }
        return false;
    }

    /**
     * Scan source lines and collect all block/closing directive occurrences.
     */
    function scanDirectiveOccurrences(lines: string[]): DirectiveOccurrence[] {
        const occurrences: DirectiveOccurrence[] = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const directivePattern = /@(\w+)/g;

            for (const { match } of collectRegexMatches(line, directivePattern)) {
                const name = `@${match[1]}`;

                if (!BLOCK_DIRECTIVE_PAIRS.has(name) && !CLOSING_TO_OPENING.has(name)) continue;

                const afterDirective = line.slice(match.index + match[0].length);
                if (isInlineDirective(name, afterDirective)) continue;

                occurrences.push({
                    name,
                    line: lineNum,
                    colStart: match.index,
                    colEnd: match.index + match[0].length,
                });
            }
        }

        return occurrences;
    }

    /**
     * Find and remove the matching opener from the stack.
     * Returns true if a match was found.
     */
    function findAndRemoveMatchingOpener(stack: DirectiveOccurrence[], expectedOpener: string): boolean {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].name === expectedOpener) {
                stack.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    export function getUnclosedDirectiveDiagnostics(source: string): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const lines = source.split('\n');

        const occurrences = scanDirectiveOccurrences(lines);

        const stack: DirectiveOccurrence[] = [];

        for (const occ of occurrences) {
            if (BLOCK_DIRECTIVE_PAIRS.has(occ.name)) {
                const clauseParent = CLAUSE_DIRECTIVES.get(occ.name);
                if (clauseParent && stack.length > 0 && stack[stack.length - 1].name === clauseParent) {
                    continue;
                }
                stack.push(occ);
                continue;
            }

            const expectedOpener = CLOSING_TO_OPENING.get(occ.name)!;
            if (!findAndRemoveMatchingOpener(stack, expectedOpener)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: Range.create(occ.line, occ.colStart, occ.line, occ.colEnd),
                    message: `Unexpected '${occ.name}' without a matching '${expectedOpener}'.`,
                    source: 'blade-lsp',
                    code: Code.unclosedDirective,
                });
            }
        }

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

            for (const { match, captured: value } of collectRegexMatches(line, methodPattern)) {
                if (!VALID_METHODS.has(value.toUpperCase())) {
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

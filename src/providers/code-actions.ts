import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    CodeAction,
    CodeActionKind,
    Diagnostic,
    Position,
    TextDocumentEdit,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostics } from './diagnostics';
import { ProjectFile } from './project-file';
import { VIEW_HELPER_PATTERN, VIEW_REFERENCE_DIRECTIVES, getViewReferencePattern } from './patterns';

export namespace CodeActions {
    interface ScaffoldTarget {
        diagnostic: Diagnostic;
        fullPath: string;
        title: string;
        template: string;
    }

    type ViewScaffoldKind = 'layout' | 'component' | 'partial';

    interface Context {
        document: TextDocument;
        diagnostics: Diagnostic[];
        workspaceRoot: string | null;
        only?: string[];
    }

    const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

    function getDiagnosticCode(diagnostic: Diagnostic): string | null {
        if (typeof diagnostic.code === 'string') {
            return diagnostic.code;
        }
        return null;
    }

    function extractTextInRange(document: TextDocument, diagnostic: Diagnostic): string {
        return document.getText(diagnostic.range).trim();
    }

    function sanitizeSegment(segment: string): string | null {
        const value = segment.trim();
        if (!value || value === '.' || value === '..') return null;
        if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
        return value;
    }

    function splitSegments(raw: string): string[] | null {
        const segments = raw
            .split(/[./]/)
            .map((segment) => sanitizeSegment(segment))
            .filter((segment): segment is string => !!segment);

        return segments.length > 0 ? segments : null;
    }

    function viewNameToRelativePath(viewName: string): string | null {
        const [namespace, scopedName] = viewName.split('::');

        if (scopedName !== undefined) {
            const ns = sanitizeSegment(namespace);
            const segments = splitSegments(scopedName);
            if (!ns || !segments) return null;

            return path.join('resources', 'views', 'vendor', ns, ...segments) + '.blade.php';
        }

        const segments = splitSegments(viewName);
        if (!segments) return null;
        return path.join('resources', 'views', ...segments) + '.blade.php';
    }

    function componentTagToRelativePath(tag: string): string | null {
        if (tag.startsWith('livewire:')) {
            const segments = splitSegments(tag.slice('livewire:'.length));
            if (!segments) return null;
            return path.join('resources', 'views', 'livewire', ...segments) + '.blade.php';
        }

        if (tag.startsWith('x-')) {
            const normalized = tag.slice(2).replace('::', '/');
            const segments = splitSegments(normalized);
            if (!segments) return null;
            return path.join('resources', 'views', 'components', ...segments) + '.blade.php';
        }

        const colonIndex = tag.indexOf(':');
        if (colonIndex > 0 && tag[colonIndex + 1] !== ':') {
            const prefix = sanitizeSegment(tag.slice(0, colonIndex));
            const segments = splitSegments(tag.slice(colonIndex + 1));
            if (!prefix || !segments) return null;
            return path.join('resources', 'views', 'components', prefix, ...segments) + '.blade.php';
        }

        return null;
    }

    function inferViewName(document: TextDocument, diagnostic: Diagnostic): string | null {
        const ranged = extractTextInRange(document, diagnostic);
        if (ranged) return ranged;

        const messageMatch = diagnostic.message.match(/View '([^']+)' not found\./);
        return messageMatch?.[1] ?? null;
    }

    function inferComponentTag(document: TextDocument, diagnostic: Diagnostic): string | null {
        const ranged = extractTextInRange(document, diagnostic);
        if (ranged) return ranged;

        const livewireMatch = diagnostic.message.match(/Livewire component '([^']+)' not found\./);
        if (livewireMatch) return `livewire:${livewireMatch[1]}`;

        const componentMatch = diagnostic.message.match(/Component '([^']+)' not found\./);
        return componentMatch?.[1] ?? null;
    }

    function createScaffoldEdit(uri: string, content: string): WorkspaceEdit {
        const createFile = {
            kind: 'create' as const,
            uri,
            options: { ignoreIfExists: true },
        };

        const textDocumentEdit: TextDocumentEdit = {
            textDocument: { uri, version: null },
            edits: [TextEdit.insert(Position.create(0, 0), content)],
        };

        return {
            documentChanges: [createFile, textDocumentEdit],
        };
    }

    function createActionForView(
        document: TextDocument,
        diagnostic: Diagnostic,
        fullPath: string,
        viewName: string,
    ): CodeAction {
        const target = createViewTarget(document, diagnostic, fullPath, viewName);

        return {
            title: target.title,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: createScaffoldEdit(ProjectFile.toUri(target.fullPath), target.template),
        };
    }

    function createLayoutTemplate(): string {
        return [
            '<!DOCTYPE html>',
            "<html lang=\"{{ str_replace('_', '-', app()->getLocale()) }}\">",
            '<head>',
            '    <meta charset="utf-8">',
            '    <meta name="viewport" content="width=device-width, initial-scale=1">',
            "    <title>@yield('title')</title>",
            '</head>',
            '<body>',
            "    @yield('content')",
            '</body>',
            '</html>',
            '',
        ].join('\n');
    }

    function createPartialTemplate(viewName: string): string {
        return `<div>\n    <!-- ${viewName} -->\n</div>\n`;
    }

    function createComponentViewTemplate(): string {
        return `<div>\n    {{ $slot }}\n</div>\n`;
    }

    function inferViewScaffoldKind(document: TextDocument, diagnostic: Diagnostic): ViewScaffoldKind {
        const line = document.getText({
            start: { line: diagnostic.range.start.line, character: 0 },
            end: { line: diagnostic.range.start.line + 1, character: 0 },
        });
        const lineText = line.replace(/\r?\n$/, '');
        const targetColumn = diagnostic.range.start.character;

        for (const directive of VIEW_REFERENCE_DIRECTIVES) {
            const pattern = getViewReferencePattern(directive);
            const match = lineText.match(pattern);
            if (!match || !match[1]) continue;

            const start = lineText.indexOf(match[1], match.index ?? 0);
            const end = start + match[1].length;
            if (targetColumn < start || targetColumn > end) continue;

            if (directive === 'extends') return 'layout';
            if (directive === 'component') return 'component';
            return 'partial';
        }

        const helperMatch = lineText.match(VIEW_HELPER_PATTERN);
        if (helperMatch?.[1]) {
            const start = lineText.indexOf(helperMatch[1], helperMatch.index ?? 0);
            const end = start + helperMatch[1].length;
            if (targetColumn >= start && targetColumn <= end) {
                return 'partial';
            }
        }

        return 'partial';
    }

    function createViewTarget(
        document: TextDocument,
        diagnostic: Diagnostic,
        fullPath: string,
        viewName: string,
    ): ScaffoldTarget {
        const scaffoldKind = inferViewScaffoldKind(document, diagnostic);
        const template =
            scaffoldKind === 'layout'
                ? createLayoutTemplate()
                : scaffoldKind === 'component'
                  ? createComponentViewTemplate()
                  : createPartialTemplate(viewName);

        return {
            diagnostic,
            fullPath,
            title: `Create missing view '${viewName}'`,
            template,
        };
    }

    function createActionForComponent(diagnostic: Diagnostic, fullPath: string, tag: string): CodeAction {
        const target = createComponentTarget(diagnostic, fullPath, tag);

        const uri = ProjectFile.toUri(fullPath);

        return {
            title: target.title,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: createScaffoldEdit(uri, target.template),
        };
    }

    function createComponentTarget(diagnostic: Diagnostic, fullPath: string, tag: string): ScaffoldTarget {
        return {
            diagnostic,
            fullPath,
            title: `Create missing component '${tag}'`,
            template: tag.startsWith('livewire:')
                ? `<div>\n    <!-- ${tag} -->\n</div>\n`
                : `<div>\n    {{ $slot }}\n</div>\n`,
        };
    }

    function isKindRequested(only: string[] | undefined, kind: string): boolean {
        if (!only || only.length === 0) return true;
        return only.some((requested) => kind === requested || kind.startsWith(`${requested}.`));
    }

    function getDocumentEndPosition(document: TextDocument): Position {
        return document.positionAt(document.getText().length);
    }

    function detectEol(document: TextDocument): string {
        const text = document.getText();
        return text.includes('\r\n') ? '\r\n' : '\n';
    }

    function getLineIndent(document: TextDocument, line: number): string {
        const lines = document.getText().split('\n');
        const value = lines[line] ?? '';
        const match = value.match(/^\s*/);
        return match?.[0] ?? '';
    }

    function getUnclosedDirectiveQuickFixes(document: TextDocument, diagnostic: Diagnostic): CodeAction[] {
        const missingCloserMatch = diagnostic.message.match(/^'(@\w+)' is missing its closing '(@\w+)'\.$/);
        if (missingCloserMatch) {
            const expectedCloser = missingCloserMatch[2];
            const endPosition = getDocumentEndPosition(document);
            const eol = detectEol(document);
            const source = document.getText();
            const needsLeadingBreak = source.length > 0 && !source.endsWith('\n') && !source.endsWith('\r');
            const indent = getLineIndent(document, diagnostic.range.start.line);
            const insertText = `${needsLeadingBreak ? eol : ''}${indent}${expectedCloser}`;

            return [
                {
                    title: `Insert missing '${expectedCloser}'`,
                    kind: CodeActionKind.QuickFix,
                    isPreferred: true,
                    diagnostics: [diagnostic],
                    edit: {
                        changes: {
                            [document.uri]: [TextEdit.insert(endPosition, insertText)],
                        },
                    },
                },
            ];
        }

        const unexpectedCloserMatch = diagnostic.message.match(/^Unexpected '(@\w+)' without a matching '(@\w+)'\.$/);
        if (unexpectedCloserMatch) {
            const unexpectedCloser = unexpectedCloserMatch[1];
            return [
                {
                    title: `Remove unexpected '${unexpectedCloser}'`,
                    kind: CodeActionKind.QuickFix,
                    isPreferred: true,
                    diagnostics: [diagnostic],
                    edit: {
                        changes: {
                            [document.uri]: [TextEdit.del(diagnostic.range)],
                        },
                    },
                },
            ];
        }

        return [];
    }

    function getInvalidMethodQuickFixes(document: TextDocument, diagnostic: Diagnostic): CodeAction[] {
        return VALID_METHODS.map((method) => ({
            title: `Replace with @method('${method}')`,
            kind: CodeActionKind.QuickFix,
            isPreferred: method === 'POST',
            diagnostics: [diagnostic],
            edit: {
                changes: {
                    [document.uri]: [TextEdit.replace(diagnostic.range, method)],
                },
            },
        }));
    }

    function getDiagnosticQuickFixes(document: TextDocument, diagnostic: Diagnostic): CodeAction[] {
        const code = getDiagnosticCode(diagnostic);
        if (code === Diagnostics.Code.unclosedDirective) {
            return getUnclosedDirectiveQuickFixes(document, diagnostic);
        }

        if (code === Diagnostics.Code.invalidMethod) {
            return getInvalidMethodQuickFixes(document, diagnostic);
        }

        return [];
    }

    function getScaffoldActions({ document, diagnostics, workspaceRoot }: Context): CodeAction[] {
        if (!workspaceRoot) return [];

        const targets = getScaffoldTargets(document, diagnostics, workspaceRoot);
        const actions: CodeAction[] = [];

        for (const target of targets) {
            const code = getDiagnosticCode(target.diagnostic);
            if (code === Diagnostics.Code.undefinedView) {
                const viewName = inferViewName(document, target.diagnostic);
                if (viewName) {
                    actions.push(createActionForView(document, target.diagnostic, target.fullPath, viewName));
                }
                continue;
            }

            const tag = inferComponentTag(document, target.diagnostic);
            if (tag) {
                actions.push(createActionForComponent(target.diagnostic, target.fullPath, tag));
            }
        }

        const batchAction = createBatchScaffoldAction(targets);
        if (batchAction) {
            actions.unshift(batchAction);
        }

        return actions;
    }

    function getScaffoldTargets(
        document: TextDocument,
        diagnostics: Diagnostic[],
        workspaceRoot: string,
    ): ScaffoldTarget[] {
        const targets: ScaffoldTarget[] = [];
        const seenPaths = new Set<string>();

        for (const diagnostic of diagnostics) {
            const code = getDiagnosticCode(diagnostic);

            if (code === Diagnostics.Code.undefinedView) {
                const viewName = inferViewName(document, diagnostic);
                if (!viewName) continue;

                const relativePath = viewNameToRelativePath(viewName);
                if (!relativePath) continue;

                const fullPath = path.join(workspaceRoot, relativePath);
                if (seenPaths.has(fullPath) || fs.existsSync(fullPath)) continue;

                seenPaths.add(fullPath);
                targets.push(createViewTarget(document, diagnostic, fullPath, viewName));
                continue;
            }

            if (code === Diagnostics.Code.undefinedComponent) {
                const tag = inferComponentTag(document, diagnostic);
                if (!tag) continue;

                const relativePath = componentTagToRelativePath(tag);
                if (!relativePath) continue;

                const fullPath = path.join(workspaceRoot, relativePath);
                if (seenPaths.has(fullPath) || fs.existsSync(fullPath)) continue;

                seenPaths.add(fullPath);
                targets.push(createComponentTarget(diagnostic, fullPath, tag));
            }
        }

        return targets;
    }

    function createBatchScaffoldAction(targets: ScaffoldTarget[]): CodeAction | null {
        if (targets.length < 2) return null;

        const documentChanges: WorkspaceEdit['documentChanges'] = [];
        for (const target of targets) {
            const uri = ProjectFile.toUri(target.fullPath);
            documentChanges?.push(
                {
                    kind: 'create',
                    uri,
                    options: { ignoreIfExists: true },
                },
                {
                    textDocument: { uri, version: null },
                    edits: [TextEdit.insert(Position.create(0, 0), target.template)],
                },
            );
        }

        return {
            title: 'Create all missing Blade files in this file',
            kind: CodeActionKind.QuickFix,
            diagnostics: targets.map((target) => target.diagnostic),
            edit: {
                documentChanges,
            },
        };
    }

    export function getActions(context: Context): CodeAction[] {
        if (!isKindRequested(context.only, CodeActionKind.QuickFix)) {
            return [];
        }

        const actions: CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            actions.push(...getDiagnosticQuickFixes(context.document, diagnostic));
        }

        actions.push(...getScaffoldActions(context));

        return actions;
    }
}

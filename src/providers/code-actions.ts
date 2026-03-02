import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    CodeAction,
    CodeActionKind,
    Diagnostic,
    Position,
    Range,
    TextDocumentEdit,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostics } from './diagnostics';
import { ProjectFile } from './project-file';

export namespace CodeActions {
    export const COMMAND_EXTRACT_SELECTION_TO_NAMED_PARTIAL = 'blade.extractSelectionToNamedPartial';

    export interface NamedExtractCommandArgs {
        uri: string;
        range: Range;
        partialName: string;
    }

    interface BuildExtractEditParams {
        document: TextDocument;
        workspaceRoot: string;
        range: Range;
        explicitPartialName?: string;
    }

    interface BuildExtractEditResult {
        edit: WorkspaceEdit;
        partialAbsolutePath: string;
        includeViewName: string;
    }

    interface SourceViewContext {
        workspaceRoot: string;
        sourceAbsolute: string;
        sourceDir: string;
        sourceBaseName: string;
    }

    interface Context {
        document: TextDocument;
        diagnostics: Diagnostic[];
        workspaceRoot: string | null;
        range?: Range;
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

    function createActionForView(diagnostic: Diagnostic, fullPath: string, viewName: string): CodeAction {
        const uri = ProjectFile.toUri(fullPath);
        const template = `<div>\n    <!-- ${viewName} -->\n</div>\n`;

        return {
            title: `Create missing view '${viewName}'`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: createScaffoldEdit(uri, template),
        };
    }

    function createActionForComponent(diagnostic: Diagnostic, fullPath: string, tag: string): CodeAction {
        const uri = ProjectFile.toUri(fullPath);
        const template = tag.startsWith('livewire:')
            ? `<div>\n    <!-- ${tag} -->\n</div>\n`
            : `<div>\n    {{ $slot }}\n</div>\n`;

        return {
            title: `Create missing component '${tag}'`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: createScaffoldEdit(uri, template),
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

        const actions: CodeAction[] = [];
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
                actions.push(createActionForView(diagnostic, fullPath, viewName));
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
                actions.push(createActionForComponent(diagnostic, fullPath, tag));
            }
        }

        return actions;
    }

    function isNonEmptyRange(range: Range | undefined): range is Range {
        if (!range) return false;
        return range.start.line !== range.end.line || range.start.character !== range.end.character;
    }

    function getSourcePathFromUri(uri: string): string | null {
        if (!uri.startsWith('file://')) return null;

        try {
            const parsed = new URL(uri);
            const pathname = decodeURIComponent(parsed.pathname);
            if (process.platform === 'win32') {
                return pathname.replace(/^\/(\w:)/, '$1');
            }
            return pathname;
        } catch {
            return null;
        }
    }

    function normalizeToPosix(filePath: string): string {
        return filePath.split(path.sep).join('/');
    }

    function getSelectionLineSuffix(range: Range): string {
        const startLine = range.start.line + 1;
        const endLine =
            range.end.character === 0 && range.end.line > range.start.line ? range.end.line : range.end.line + 1;
        return `${startLine}-${Math.max(startLine, endLine)}`;
    }

    function splitPartialName(raw: string): string[] | null {
        const normalized = raw
            .trim()
            .replace(/\.blade\.php$/i, '')
            .replace(/\\/g, '/')
            .replace(/\.+/g, '/');

        if (!normalized) {
            return null;
        }

        const segments = normalized
            .split('/')
            .map((segment) => sanitizeSegment(segment))
            .filter((segment): segment is string => !!segment);

        if (segments.length === 0) {
            return null;
        }

        if (segments[0] === 'partials') {
            segments.shift();
        }

        return segments.length > 0 ? segments : null;
    }

    function getUniquePartialPath(targetDir: string, baseName: string): string {
        const firstCandidate = path.join(targetDir, `${baseName}.blade.php`);
        if (!fs.existsSync(firstCandidate)) {
            return firstCandidate;
        }

        let suffix = 2;
        while (suffix < 5000) {
            const candidate = path.join(targetDir, `${baseName}-${suffix}.blade.php`);
            if (!fs.existsSync(candidate)) {
                return candidate;
            }
            suffix++;
        }

        return path.join(targetDir, `${baseName}-${Date.now()}.blade.php`);
    }

    function toBladeViewKey(relativePath: string): string | null {
        const normalized = normalizeToPosix(relativePath);
        if (!normalized.startsWith('resources/views/')) {
            return null;
        }

        const withoutPrefix = normalized.slice('resources/views/'.length);
        if (!withoutPrefix.endsWith('.blade.php')) {
            return null;
        }

        const withoutExt = withoutPrefix.slice(0, -'.blade.php'.length);
        const segments = withoutExt.split('/').map((segment) => sanitizeSegment(segment));
        if (segments.some((segment) => !segment)) {
            return null;
        }

        return (segments as string[]).join('.');
    }

    function getSourceViewContext(workspaceRoot: string, documentUri: string): SourceViewContext | null {
        const sourcePath = getSourcePathFromUri(documentUri);
        if (!sourcePath) return null;

        const resolvedRoot = path.resolve(workspaceRoot);
        const sourceAbsolute = path.resolve(sourcePath);
        const sourceRelative = path.relative(resolvedRoot, sourceAbsolute);

        if (sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative)) {
            return null;
        }

        const normalizedSourceRelative = normalizeToPosix(sourceRelative);
        if (
            !normalizedSourceRelative.startsWith('resources/views/') ||
            !normalizedSourceRelative.endsWith('.blade.php')
        ) {
            return null;
        }

        return {
            workspaceRoot: resolvedRoot,
            sourceAbsolute,
            sourceDir: path.dirname(sourceAbsolute),
            sourceBaseName: path.basename(sourceAbsolute, '.blade.php'),
        };
    }

    function resolveTargetPartialPath(
        sourceContext: SourceViewContext,
        range: Range,
        explicitPartialName?: string,
    ): string | null {
        if (explicitPartialName && explicitPartialName.trim()) {
            const segments = splitPartialName(explicitPartialName);
            if (!segments) return null;

            const fileBase = segments[segments.length - 1];
            const nestedDirs = segments.slice(0, -1);
            const targetDir = path.join(sourceContext.sourceDir, 'partials', ...nestedDirs);
            return getUniquePartialPath(targetDir, fileBase);
        }

        const lineSuffix = getSelectionLineSuffix(range);
        const partialBaseName = `${sourceContext.sourceBaseName}-${lineSuffix}`;
        return getUniquePartialPath(path.join(sourceContext.sourceDir, 'partials'), partialBaseName);
    }

    function buildExtractSelectionEdit(params: BuildExtractEditParams): BuildExtractEditResult | null {
        if (!isNonEmptyRange(params.range)) return null;

        const selection = params.document.getText(params.range);
        if (!selection) return null;

        const sourceContext = getSourceViewContext(params.workspaceRoot, params.document.uri);
        if (!sourceContext) return null;

        const partialAbsolute = resolveTargetPartialPath(sourceContext, params.range, params.explicitPartialName);
        if (!partialAbsolute) return null;

        const partialRelative = path.relative(sourceContext.workspaceRoot, partialAbsolute);
        const includeViewName = toBladeViewKey(partialRelative);
        if (!includeViewName) {
            return null;
        }

        const partialUri = ProjectFile.toUri(partialAbsolute);

        return {
            partialAbsolutePath: partialAbsolute,
            includeViewName,
            edit: {
                documentChanges: [
                    {
                        kind: 'create',
                        uri: partialUri,
                        options: { ignoreIfExists: true },
                    },
                    {
                        textDocument: { uri: partialUri, version: null },
                        edits: [TextEdit.insert(Position.create(0, 0), selection)],
                    },
                    {
                        textDocument: { uri: params.document.uri, version: null },
                        edits: [TextEdit.replace(params.range, `@include('${includeViewName}')`)],
                    },
                ],
            },
        };
    }

    export function getSuggestedPartialName(workspaceRoot: string, documentUri: string, range: Range): string | null {
        const sourceContext = getSourceViewContext(workspaceRoot, documentUri);
        if (!sourceContext) return null;
        return `${sourceContext.sourceBaseName}-${getSelectionLineSuffix(range)}`;
    }

    export function getNamedExtractWorkspaceEdit(params: BuildExtractEditParams): WorkspaceEdit | null {
        const result = buildExtractSelectionEdit(params);
        return result?.edit ?? null;
    }

    export function isNamedExtractCommandArgs(value: unknown): value is NamedExtractCommandArgs {
        if (!value || typeof value !== 'object') {
            return false;
        }

        const payload = value as Partial<NamedExtractCommandArgs>;
        const hasUri = typeof payload.uri === 'string';
        const hasPartialName = typeof payload.partialName === 'string';
        const hasRange =
            !!payload.range &&
            typeof payload.range === 'object' &&
            !!payload.range.start &&
            !!payload.range.end &&
            typeof payload.range.start.line === 'number' &&
            typeof payload.range.start.character === 'number' &&
            typeof payload.range.end.line === 'number' &&
            typeof payload.range.end.character === 'number';

        return hasUri && hasPartialName && hasRange;
    }

    function getExtractSelectionAction(context: Context): CodeAction | null {
        if (!context.workspaceRoot) return null;
        if (!isNonEmptyRange(context.range)) return null;
        if (!isKindRequested(context.only, CodeActionKind.RefactorExtract)) return null;

        const result = buildExtractSelectionEdit({
            document: context.document,
            workspaceRoot: context.workspaceRoot,
            range: context.range,
        });
        if (!result) return null;

        return {
            title: 'Extract selection to partial view',
            kind: CodeActionKind.RefactorExtract,
            isPreferred: true,
            edit: result.edit,
        };
    }

    function getRefactorActions(context: Context): CodeAction[] {
        const extractAction = getExtractSelectionAction(context);
        return extractAction ? [extractAction] : [];
    }

    export function getActions(context: Context): CodeAction[] {
        const actions: CodeAction[] = [];

        if (isKindRequested(context.only, CodeActionKind.QuickFix)) {
            for (const diagnostic of context.diagnostics) {
                actions.push(...getDiagnosticQuickFixes(context.document, diagnostic));
            }

            actions.push(...getScaffoldActions(context));
        }

        actions.push(...getRefactorActions(context));

        return actions;
    }
}

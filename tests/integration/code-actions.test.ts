import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { CodeActionKind } from 'vscode-languageserver/node';
import type { CodeAction, Diagnostic, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver/node';
import { createClient, type Client } from '../utils/client';
import { clearMockLaravel, installMockLaravel } from '../utils/laravel-mock';
import { CodeActions } from '../../src/providers/code-actions';

describe('Code Actions (Integration)', () => {
    let client: Client;
    let workspaceRoot = '';

    function fileUri(relativePath: string): string {
        return `file://${path.join(workspaceRoot, relativePath)}`;
    }

    beforeAll(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-code-actions-'));
        client = await createClient({
            rootUri: `file://${workspaceRoot}`,
            settings: {
                enableLaravelIntegration: false,
            },
        });

        installMockLaravel();
    });

    afterAll(async () => {
        clearMockLaravel();
        await client.shutdown();
        if (workspaceRoot) {
            await rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    function findDiagnosticByCode(diagnostics: Diagnostic[], code: string): Diagnostic {
        const diagnostic = diagnostics.find((item) => item.code === code);
        expect(diagnostic).toBeDefined();
        return diagnostic!;
    }

    function findAction(actions: CodeAction[], titleFragment: string): CodeAction {
        const action = actions.find((item) => item.title.includes(titleFragment));
        expect(action).toBeDefined();
        return action!;
    }

    function getActionCreatedUri(action: CodeAction): string {
        const createChange = action.edit?.documentChanges?.find(
            (change) => typeof change === 'object' && change !== null && 'kind' in change && change.kind === 'create',
        );

        expect(createChange).toBeDefined();
        return (createChange as { uri: string }).uri;
    }

    function getActionTemplate(action: CodeAction): string {
        const textEditChange = action.edit?.documentChanges?.find(
            (change) =>
                typeof change === 'object' &&
                change !== null &&
                'textDocument' in change &&
                'edits' in change &&
                Array.isArray(change.edits),
        );

        expect(textEditChange).toBeDefined();
        const edit = (textEditChange as TextDocumentEdit).edits[0];
        expect(edit).toBeDefined();
        return edit.newText;
    }

    function getInlineActionEdits(action: CodeAction, uri: string): TextEdit[] {
        const edits = action.edit?.changes?.[uri] ?? [];
        expect(edits.length).toBeGreaterThan(0);
        return edits;
    }

    function getDocumentChangeEdits(action: CodeAction, uri: string): TextEdit[] {
        const textEditChange = action.edit?.documentChanges?.find(
            (change) =>
                typeof change === 'object' &&
                change !== null &&
                'textDocument' in change &&
                !!change.textDocument &&
                change.textDocument.uri === uri &&
                'edits' in change &&
                Array.isArray(change.edits),
        );

        expect(textEditChange).toBeDefined();
        return (textEditChange as TextDocumentEdit).edits;
    }

    it('offers scaffold action for undefined views', async () => {
        const doc = await client.open({
            text: "@include('missing.page')",
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/undefined-view');

        const actions = await doc.codeActions({ diagnostics: [diagnostic] });
        const action = findAction(actions, "Create missing view 'missing.page'");

        expect(getActionCreatedUri(action)).toBe(fileUri('resources/views/missing/page.blade.php'));
        expect(getActionTemplate(action)).toContain('<!-- missing.page -->');

        await doc.close();
    });

    it('offers scaffold action for undefined components', async () => {
        const doc = await client.open({
            text: '<x-missing-widget />',
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/undefined-component');

        const actions = await doc.codeActions({ diagnostics: [diagnostic] });
        const action = findAction(actions, "Create missing component 'x-missing-widget'");

        expect(getActionCreatedUri(action)).toBe(fileUri('resources/views/components/missing-widget.blade.php'));
        expect(getActionTemplate(action)).toContain('{{ $slot }}');

        await doc.close();
    });

    it('offers quick fix to insert missing closing directive', async () => {
        const doc = await client.open({
            text: '@if($show)\n  <p>test</p>',
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/unclosed-directive');

        const actions = await doc.codeActions({ diagnostics: [diagnostic] });
        const action = findAction(actions, "Insert missing '@endif'");
        const edits = getInlineActionEdits(action, doc.uri);

        expect(edits[0].newText).toContain('@endif');

        await doc.close();
    });

    it('offers quick fix to remove unexpected closing directive', async () => {
        const doc = await client.open({
            text: '@endif',
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = diagnostics.find(
            (item) =>
                item.code === 'blade/unclosed-directive' &&
                item.message.includes("Unexpected '@endif' without a matching '@if'"),
        );

        expect(diagnostic).toBeDefined();
        const actions = await doc.codeActions({ diagnostics: [diagnostic!] });
        const action = findAction(actions, "Remove unexpected '@endif'");
        const edits = getInlineActionEdits(action, doc.uri);

        expect(edits[0].range).toEqual(diagnostic!.range);
        expect(edits[0].newText).toBe('');

        await doc.close();
    });

    it('offers quick fixes for invalid @method values', async () => {
        const doc = await client.open({
            text: "@method('INVALID')",
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/invalid-method');

        const actions = await doc.codeActions({ diagnostics: [diagnostic] });
        const postAction = findAction(actions, "Replace with @method('POST')");
        const edits = getInlineActionEdits(postAction, doc.uri);

        expect(edits[0].newText).toBe('POST');

        await doc.close();
    });

    it('respects requested code action kinds', async () => {
        const doc = await client.open({
            text: "@method('INVALID')",
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/invalid-method');

        const refactorOnly = await doc.codeActions({
            diagnostics: [diagnostic],
            only: [CodeActionKind.Refactor],
        });
        expect(refactorOnly).toEqual([]);

        const quickFixOnly = await doc.codeActions({
            diagnostics: [diagnostic],
            only: [CodeActionKind.QuickFix],
        });
        expect(quickFixOnly.length).toBeGreaterThan(0);

        await doc.close();
    });

    it('extracts selection to a partial view', async () => {
        const doc = await client.open({
            name: 'resources/views/admin/users/index.blade.php',
            text: '<div>\n    <p>{{ $user->name }}</p>\n</div>\n',
        });

        const actions = await doc.codeActions({
            diagnostics: [],
            only: [CodeActionKind.RefactorExtract],
            range: {
                start: { line: 1, character: 4 },
                end: { line: 1, character: 28 },
            },
        });

        const action = findAction(actions, 'Extract selection to partial view');
        expect(action.kind).toBe(CodeActionKind.RefactorExtract);

        expect(getActionCreatedUri(action)).toBe(fileUri('resources/views/admin/users/partials/index-2-2.blade.php'));

        const sourceEdits = getDocumentChangeEdits(action, doc.uri);
        expect(sourceEdits[0].newText).toBe("@include('admin.users.partials.index-2-2')");

        const extractedUri = fileUri('resources/views/admin/users/partials/index-2-2.blade.php');
        const extractedEdits = getDocumentChangeEdits(action, extractedUri);
        expect(extractedEdits[0].newText).toBe('<p>{{ $user->name }}</p>');

        await doc.close();
    });

    it('does not offer extract action for collapsed selection', async () => {
        const doc = await client.open({
            name: 'resources/views/admin/users/index.blade.php',
            text: '<div>\n    <p>{{ $user->name }}</p>\n</div>\n',
        });

        const actions = await doc.codeActions({
            diagnostics: [],
            only: [CodeActionKind.RefactorExtract],
            range: {
                start: { line: 1, character: 4 },
                end: { line: 1, character: 4 },
            },
        });

        const extractAction = actions.find((item) => item.title.includes('Extract selection to partial view'));
        expect(extractAction).toBeUndefined();

        await doc.close();
    });

    it('increments partial file name when target already exists', async () => {
        const partialDir = path.join(workspaceRoot, 'resources', 'views', 'admin', 'users', 'partials');
        await mkdir(partialDir, { recursive: true });
        await writeFile(path.join(partialDir, 'index-2-2.blade.php'), '<p>existing</p>\n', 'utf-8');

        const doc = await client.open({
            name: 'resources/views/admin/users/index.blade.php',
            text: '<div>\n    <p>{{ $user->name }}</p>\n</div>\n',
        });

        const actions = await doc.codeActions({
            diagnostics: [],
            only: [CodeActionKind.RefactorExtract],
            range: {
                start: { line: 1, character: 4 },
                end: { line: 1, character: 28 },
            },
        });

        const action = findAction(actions, 'Extract selection to partial view');
        expect(getActionCreatedUri(action)).toBe(fileUri('resources/views/admin/users/partials/index-2-2-2.blade.php'));

        await doc.close();
    });

    it('returns a named extraction workspace edit through executeCommand', async () => {
        const doc = await client.open({
            name: 'resources/views/admin/users/index.blade.php',
            text: '<div>\n    <p>{{ $user->name }}</p>\n</div>\n',
        });

        const commandResult = (await client.executeCommand(CodeActions.COMMAND_EXTRACT_SELECTION_TO_NAMED_PARTIAL, [
            {
                uri: doc.uri,
                range: {
                    start: { line: 1, character: 4 },
                    end: { line: 1, character: 28 },
                },
                partialName: 'user-row',
            },
        ])) as WorkspaceEdit;

        expect(commandResult).toBeDefined();
        expect(commandResult.documentChanges).toBeDefined();

        const createChange = commandResult.documentChanges?.find(
            (change) => typeof change === 'object' && 'kind' in change && change.kind === 'create',
        ) as { uri: string } | undefined;
        expect(createChange).toBeDefined();
        expect(createChange?.uri).toContain('user-row.blade.php');

        const sourceEditChange = commandResult.documentChanges?.find(
            (change) =>
                typeof change === 'object' &&
                'textDocument' in change &&
                !!change.textDocument &&
                change.textDocument.uri === doc.uri,
        ) as TextDocumentEdit | undefined;
        expect(sourceEditChange).toBeDefined();
        expect(sourceEditChange?.edits[0]?.newText).toBe("@include('admin.users.partials.user-row')");

        await doc.close();
    });
});

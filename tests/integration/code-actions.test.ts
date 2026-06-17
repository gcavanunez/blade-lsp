import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeActionKind } from 'vscode-languageserver/node';
import type { CodeAction, Diagnostic, TextDocumentEdit, TextEdit } from 'vscode-languageserver/node';
import { createClient, type Client } from '../utils/client';
import { clearMockLaravel, installMockLaravel } from '../utils/laravel-mock';

describe('Code Actions (Integration)', () => {
    let client: Client;

    beforeAll(async () => {
        client = await createClient({
            settings: {
                enableLaravelIntegration: false,
            },
        });

        installMockLaravel();
    });

    afterAll(async () => {
        clearMockLaravel();
        await client.shutdown();
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

    function getActionCreatedUris(action: CodeAction): string[] {
        const changes = action.edit?.documentChanges ?? [];
        return changes
            .filter((change): change is { kind: 'create'; uri: string } => {
                return typeof change === 'object' && change !== null && 'kind' in change && change.kind === 'create';
            })
            .map((change) => change.uri);
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

    it('offers scaffold action for undefined views', async () => {
        const doc = await client.open({
            text: "@include('missing.page')",
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/undefined-view');

        const actions = await doc.codeActions({ diagnostics: [diagnostic] });
        const action = findAction(actions, "Create missing view 'missing.page'");

        expect(getActionCreatedUri(action)).toBe('file:///test/project/resources/views/missing/page.blade.php');
        expect(getActionTemplate(action)).toContain('<!-- missing.page -->');

        await doc.close();
    });

    it('uses a layout-oriented stub for missing @extends views', async () => {
        const doc = await client.open({
            text: "@extends('layouts.missing')",
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/undefined-view');

        const actions = await doc.codeActions({ diagnostics: [diagnostic] });
        const action = findAction(actions, "Create missing view 'layouts.missing'");

        expect(getActionCreatedUri(action)).toBe('file:///test/project/resources/views/layouts/missing.blade.php');
        expect(getActionTemplate(action)).toContain("@yield('content')");
        expect(getActionTemplate(action)).toContain('<!DOCTYPE html>');

        await doc.close();
    });

    it('uses a slot-oriented stub for missing @component views', async () => {
        const doc = await client.open({
            text: "@component('mail.panel')",
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/undefined-view');

        const actions = await doc.codeActions({ diagnostics: [diagnostic] });
        const action = findAction(actions, "Create missing view 'mail.panel'");

        expect(getActionCreatedUri(action)).toBe('file:///test/project/resources/views/mail/panel.blade.php');
        expect(getActionTemplate(action)).toContain('{{ $slot }}');

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

        expect(getActionCreatedUri(action)).toBe(
            'file:///test/project/resources/views/components/missing-widget.blade.php',
        );
        expect(getActionTemplate(action)).toContain('{{ $slot }}');

        await doc.close();
    });

    it('offers a batch action to create all missing Blade files in the document', async () => {
        const doc = await client.open({
            text: "@include('missing.page')\n@include('missing.page')\n<x-missing-widget />",
        });

        const diagnostics = await doc.diagnostics();
        const actions = await doc.codeActions({ diagnostics });
        const action = findAction(actions, 'Create all missing Blade files in this file');

        expect(getActionCreatedUris(action)).toEqual([
            'file:///test/project/resources/views/missing/page.blade.php',
            'file:///test/project/resources/views/components/missing-widget.blade.php',
        ]);

        await doc.close();
    });

    it('does not offer the batch action when only one file is missing', async () => {
        const doc = await client.open({
            text: "@include('missing.page')",
        });

        const diagnostics = await doc.diagnostics();
        const actions = await doc.codeActions({ diagnostics });
        const batchAction = actions.find((item) => item.title.includes('Create all missing Blade files in this file'));

        expect(batchAction).toBeUndefined();

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
});

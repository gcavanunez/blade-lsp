import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CodeAction, Diagnostic, TextDocumentEdit } from 'vscode-languageserver/node';
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

    it('offers scaffold action for undefined views', async () => {
        const doc = await client.open({
            text: "@include('missing.page')",
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/undefined-view');

        const actions = await doc.codeActions([diagnostic]);
        const action = findAction(actions, "Create missing view 'missing.page'");

        expect(getActionCreatedUri(action)).toBe('file:///test/project/resources/views/missing/page.blade.php');
        expect(getActionTemplate(action)).toContain('<!-- missing.page -->');

        await doc.close();
    });

    it('offers scaffold action for undefined components', async () => {
        const doc = await client.open({
            text: '<x-missing-widget />',
        });

        const diagnostics = await doc.diagnostics();
        const diagnostic = findDiagnosticByCode(diagnostics, 'blade/undefined-component');

        const actions = await doc.codeActions([diagnostic]);
        const action = findAction(actions, "Create missing component 'x-missing-widget'");

        expect(getActionCreatedUri(action)).toBe(
            'file:///test/project/resources/views/components/missing-widget.blade.php',
        );
        expect(getActionTemplate(action)).toContain('{{ $slot }}');

        await doc.close();
    });
});

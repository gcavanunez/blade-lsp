import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { CompletionItem } from 'vscode-languageserver/node';
import { createClient, type Client } from '../utils/client';
import { clearMockLaravel, installMockLaravel } from '../utils/laravel-mock';

function getCompletionDocumentation(item: CompletionItem): string {
    if (!item.documentation) {
        return '';
    }

    if (typeof item.documentation === 'string') {
        return item.documentation;
    }

    if (Array.isArray(item.documentation)) {
        return item.documentation.map((entry) => (typeof entry === 'string' ? entry : entry.value)).join('\n\n');
    }

    return item.documentation.value;
}

describe('Completion Resolve (Integration)', () => {
    let client: Client;
    let workspaceRoot = '';

    beforeAll(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-completion-resolve-'));

        await mkdir(path.join(workspaceRoot, 'resources', 'views', 'layouts'), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, 'resources', 'views', 'layouts', 'app.blade.php'),
            `<div>\n    <h1>{{ $title ?? 'App' }}</h1>\n    @yield('content')\n</div>\n`,
            'utf-8',
        );

        client = await createClient({
            rootUri: `file://${workspaceRoot}`,
            settings: {
                enableLaravelIntegration: false,
            },
        });

        installMockLaravel();
    });

    afterAll(async () => {
        await client.shutdown();
        clearMockLaravel();
        if (workspaceRoot) {
            await rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('adds file preview docs when resolving view completion items', async () => {
        const doc = await client.open({
            text: "@include('",
        });

        const items = await doc.completions(0, 10);
        const target = items.find((item) => item.label === 'layouts.app');

        expect(target).toBeDefined();
        const unresolvedDocs = getCompletionDocumentation(target!);
        expect(unresolvedDocs).not.toContain('**Preview:**');

        const resolved = await doc.resolveCompletion(target!);
        const resolvedDocs = getCompletionDocumentation(resolved);

        expect(resolvedDocs).toContain('**Preview:**');
        expect(resolvedDocs).toContain("@yield('content')");

        await doc.close();
    });
});

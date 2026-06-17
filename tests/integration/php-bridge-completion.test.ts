import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompletionItem, Position } from 'vscode-languageserver/node';
import { createClient, type Client } from '../utils/client';
import { PhpBridge } from '../../src/providers/php-bridge/bridge';
import type { PhpBridgeBackend } from '../../src/providers/php-bridge/backend';

describe('Embedded PHP bridge completion (Integration)', () => {
    let client: Client;
    let workspaceRoot = '';
    const completionCalls: Array<{ uri: string; position: Position }> = [];

    beforeAll(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-completion-'));

        PhpBridge.setBackendFactoryForTests(
            (): PhpBridgeBackend.Client => ({
                start: async () => {},
                openOrUpdate: async () => {},
                hover: async () => null,
                definition: async () => null,
                completion: async (uri, position) => {
                    completionCalls.push({ uri, position });
                    return [
                        {
                            label: '$post',
                            textEdit: {
                                range: {
                                    start: { line: position.line, character: 0 },
                                    end: { line: position.line, character: position.character },
                                },
                                newText: '$post',
                            },
                            additionalTextEdits: [
                                {
                                    range: {
                                        start: { line: 1, character: 0 },
                                        end: { line: 1, character: 0 },
                                    },
                                    newText: 'use App\\Models\\Post;\n',
                                },
                            ],
                        } satisfies CompletionItem,
                    ];
                },
                shutdown: async () => {},
            }),
        );

        client = await createClient({
            rootUri: `file://${workspaceRoot}`,
            settings: {
                enableLaravelIntegration: false,
                enableEmbeddedPhpBridge: true,
                embeddedPhpBackend: 'intelephense',
            },
        });
    });

    afterAll(async () => {
        await client.shutdown();
        PhpBridge.setBackendFactoryForTests(null);
        if (workspaceRoot) {
            await rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('delegates php-region completion and remaps text edits back into Blade', async () => {
        const doc = await client.open({
            name: 'resources/views/show.blade.php',
            text: `<?php
$po
?>`,
        });

        const items = await doc.completions(1, 3);
        expect(items.map((item) => item.label)).toContain('$post');
        expect(completionCalls).toHaveLength(1);
        expect(completionCalls[0].uri).toContain('.blade-lsp/shadow/resources-views-show.php');

        const postItem = items.find((item) => item.label === '$post');
        expect(postItem?.textEdit).toBeDefined();
        if (postItem?.textEdit && 'range' in postItem.textEdit) {
            expect(postItem.textEdit.range.start.line).toBe(1);
            expect(postItem.textEdit.range.start.character).toBe(0);
            expect(postItem.textEdit.range.end.character).toBe(3);
        }
        expect(postItem?.additionalTextEdits?.[0]?.range.start.line).toBe(0);
        expect(postItem?.additionalTextEdits?.[0]?.range.start.character).toBe(5);
        expect(postItem?.additionalTextEdits?.[0]?.newText).toContain('use App\\Models\\Post;');

        await doc.close();
    });

    it('falls back outside php regions when bridge completion does not apply', async () => {
        const doc = await client.open({
            name: 'resources/views/show.blade.php',
            text: '{{ r }}',
        });

        const beforeCalls = completionCalls.length;
        const items = await doc.completions(0, 4);
        expect(items.map((item) => item.label)).toContain('route');
        expect(completionCalls.length).toBe(beforeCalls);

        await doc.close();
    });

    it('still falls back to blade-side echo completions for @php-assigned variables', async () => {
        const doc = await client.open({
            name: 'resources/views/show.blade.php',
            text: `<?php
use Livewire\\Component;

new class extends Component {
    public string $title;
};
?>

@php
    $groovy = 'chevere';
    $phrases = collect(['lets go!', $groovy]);
    $rando = $phrases->random();
@endphp

<div>{{ $ }}</div>`,
        });

        const beforeCalls = completionCalls.length;
        const items = await doc.completions(14, 8);
        const labels = items.map((item) => item.label);

        expect(labels).toContain('$rando');
        expect(labels).toContain('$groovy');
        expect(completionCalls.length).toBe(beforeCalls);

        await doc.close();
    });
});

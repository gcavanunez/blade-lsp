import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hover, Position } from 'vscode-languageserver/node';
import { createClient, type Client } from '../utils/client';
import { PhpBridge } from '../../src/providers/php-bridge/bridge';
import type { PhpBridgeBackend } from '../../src/providers/php-bridge/backend';

describe('Embedded PHP bridge hover (Integration)', () => {
    let client: Client;
    let workspaceRoot = '';
    const hoverCalls: Array<{ uri: string; position: Position }> = [];

    beforeAll(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-hover-'));

        PhpBridge.setBackendFactoryForTests(
            (): PhpBridgeBackend.Client => ({
                start: async () => {},
                openOrUpdate: async () => {},
                hover: async (uri, position) => {
                    hoverCalls.push({ uri, position });
                    return {
                        contents: {
                            kind: 'markdown',
                            value: 'Bridge hover result',
                        },
                    } satisfies Hover;
                },
                definition: async () => null,
                completion: async () => null,
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

    it('delegates hover inside php regions to the embedded bridge backend', async () => {
        const doc = await client.open({
            name: 'resources/views/show.blade.php',
            text: `<?php
$post = null;
?>

<div>{{ $post }}</div>`,
        });

        const hover = await doc.hover(1, 2);
        expect(hover).not.toBeNull();

        const value =
            typeof hover!.contents === 'string'
                ? hover!.contents
                : 'value' in hover!.contents
                  ? hover!.contents.value
                  : '';

        expect(value).toContain('Bridge hover result');
        expect(hoverCalls).toHaveLength(1);
        expect(hoverCalls[0].uri).toContain('.blade-lsp/shadow/resources-views-show.php');

        await doc.close();
    });

    it('falls back outside php regions when bridge mapping does not apply', async () => {
        const doc = await client.open({
            name: 'resources/views/show.blade.php',
            text: '<div>Hello</div>',
        });

        const hover = await doc.hover(0, 5);
        expect(hover).toBeNull();

        await doc.close();
    });
});

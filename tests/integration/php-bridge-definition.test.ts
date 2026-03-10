import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Location, Position } from 'vscode-languageserver/node';
import { createClient, type Client } from '../utils/client';
import { PhpBridge } from '../../src/providers/php-bridge/bridge';
import type { PhpBridgeBackend } from '../../src/providers/php-bridge/backend';

describe('Embedded PHP bridge definition (Integration)', () => {
    let client: Client;
    let workspaceRoot = '';
    const definitionCalls: Array<{ uri: string; position: Position }> = [];

    beforeAll(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-definition-'));

        PhpBridge.setBackendFactoryForTests(
            (): PhpBridgeBackend.Client => ({
                start: async () => {},
                openOrUpdate: async () => {},
                hover: async () => null,
                definition: async (uri, position) => {
                    definitionCalls.push({ uri, position });

                    if (definitionCalls.length === 1) {
                        return {
                            uri,
                            range: {
                                start: { line: 1, character: 0 },
                                end: { line: 1, character: 5 },
                            },
                        } satisfies Location;
                    }

                    return {
                        uri: `file://${workspaceRoot}/app/Models/Post.php`,
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 4 },
                        },
                    } satisfies Location;
                },
                completion: async () => null,
                resolveCompletion: async () => null,
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

    it('remaps same-shadow definitions back into the Blade document', async () => {
        const doc = await client.open({
            name: 'resources/views/show.blade.php',
            text: `<?php
$post = null;
?>

<div>{{ $post }}</div>`,
        });

        const result = await doc.definition(1, 2);
        expect(result).not.toBeNull();
        expect(definitionCalls).toHaveLength(1);

        if (result && !Array.isArray(result)) {
            expect(result.uri).toBe(doc.uri);
            expect(result.range.start.line).toBe(0);
            expect(result.range.start.character).toBe(5);
        }

        await doc.close();
    });

    it('passes through external php definitions unchanged', async () => {
        const doc = await client.open({
            name: 'resources/views/show.blade.php',
            text: `<?php
use App\\Models\\Post;
?>`,
        });

        const result = await doc.definition(1, 10);
        expect(result).not.toBeNull();

        if (result && !Array.isArray(result)) {
            expect(result.uri).toBe(`file://${workspaceRoot}/app/Models/Post.php`);
        }

        await doc.close();
    });
});

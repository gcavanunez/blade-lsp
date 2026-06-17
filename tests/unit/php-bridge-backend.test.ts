import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { PhpBridge } from '../../src/providers/php-bridge/bridge';
import { PhpBridgeBackend } from '../../src/providers/php-bridge/backend';

describe('PhpBridge backend skeleton', () => {
    let workspaceRoot = '';

    afterEach(async () => {
        PhpBridge.setBackendFactoryForTests(null);
        if (workspaceRoot) {
            await rm(workspaceRoot, { recursive: true, force: true });
            workspaceRoot = '';
        }
    });

    it('resolves backend config from embedded bridge settings', () => {
        const config = PhpBridge.resolveBackendConfig(
            {
                enableEmbeddedPhpBridge: true,
                embeddedPhpBackend: 'phpactor',
                embeddedPhpLspCommand: ['phpactor', 'language-server'],
            },
            '/workspace',
        );

        expect(config).toEqual({
            backendName: 'phpactor',
            command: ['phpactor', 'language-server'],
            workspaceRoot: '/workspace',
        });
    });

    it('writes and syncs a stable shadow document through the backend', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-'));
        const calls: Array<{ uri: string; version: number; text: string }> = [];

        const fakeBackend: PhpBridgeBackend.Client = {
            start: async () => {},
            openOrUpdate: async (document) => {
                calls.push(document);
            },
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            shutdown: async () => {},
        };

        PhpBridge.setBackendFactoryForTests(() => fakeBackend);

        const logs: string[] = [];
        const state = PhpBridge.createState(
            workspaceRoot,
            { enableEmbeddedPhpBridge: true },
            {
                log: (message) => logs.push(message),
                error: (message) => logs.push(message),
            },
        );

        const document = TextDocument.create(
            `file://${workspaceRoot}/resources/views/posts/show.blade.php`,
            'blade',
            1,
            '<?php\n$post = null;\n?>\n\n<div>{{ $post }}</div>\n@php\n$foo = 1;\n@endphp\n',
        );

        const entry = await PhpBridge.syncDocument(state, document);

        expect(entry.shadow.shadowPath).toBe(
            path.join(workspaceRoot, '.blade-lsp', 'shadow', 'resources-views-posts-show.php'),
        );
        expect(calls).toHaveLength(1);
        expect(calls[0].uri).toBe(entry.shadow.shadowUri);
        expect(logs.some((line) => line.includes('Embedded PHP bridge backend started'))).toBe(true);

        const written = await readFile(entry.shadow.shadowPath, 'utf-8');
        expect(written).toBe(entry.shadow.content);

        await PhpBridge.shutdown(state);
    });

    it('reuses cached sync results for the same document version', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-cache-'));
        let syncCount = 0;

        PhpBridge.setBackendFactoryForTests(() => ({
            start: async () => {},
            openOrUpdate: async () => {
                syncCount++;
            },
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            shutdown: async () => {},
        }));

        const state = PhpBridge.createState(
            workspaceRoot,
            { enableEmbeddedPhpBridge: true },
            { log: () => {}, error: () => {} },
        );
        const document = TextDocument.create(
            `file://${workspaceRoot}/resources/views/example.blade.php`,
            'blade',
            4,
            '<?php $foo = 1; ?>',
        );

        const first = await PhpBridge.syncDocument(state, document);
        const second = await PhpBridge.syncDocument(state, document);

        expect(first.shadow.shadowUri).toBe(second.shadow.shadowUri);
        expect(syncCount).toBe(1);

        await PhpBridge.shutdown(state);
    });

    it('skips backend resync when only non-php regions change', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-signature-'));
        let syncCount = 0;

        PhpBridge.setBackendFactoryForTests(() => ({
            start: async () => {},
            openOrUpdate: async () => {
                syncCount++;
            },
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            shutdown: async () => {},
        }));

        const state = PhpBridge.createState(
            workspaceRoot,
            { enableEmbeddedPhpBridge: true },
            { log: () => {}, error: () => {} },
        );

        const firstDocument = TextDocument.create(
            `file://${workspaceRoot}/resources/views/example.blade.php`,
            'blade',
            1,
            '<div class="one">Hello</div>\n<?php $foo = 1; ?>',
        );
        const secondDocument = TextDocument.create(
            firstDocument.uri,
            'blade',
            2,
            '<main>Updated</main>\n<div class="two">Hello</div>\n<?php $foo = 1; ?>',
        );

        const first = await PhpBridge.syncDocument(state, firstDocument);
        const second = await PhpBridge.syncDocument(state, secondDocument);

        expect(first.signature).toBe(second.signature);
        expect(first.shadow.shadowUri).toBe(second.shadow.shadowUri);
        expect(first.shadow.regions[0]?.bladeContentOffsetStart).not.toBe(
            second.shadow.regions[0]?.bladeContentOffsetStart,
        );
        expect(syncCount).toBe(1);

        await PhpBridge.shutdown(state);
    });
});

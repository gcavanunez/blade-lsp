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
                phpactor: {
                    initializationOptions: {
                        ['language_server_phpstan.enabled']: false,
                    },
                    settings: {
                        phpactor: {
                            diagnostics: false,
                        },
                    },
                },
            },
            '/workspace',
        );

        expect(config).toEqual({
            backendName: 'phpactor',
            command: ['phpactor', 'language-server'],
            workspaceRoot: '/workspace',
            initializationOptions: {
                ['language_server_phpstan.enabled']: false,
            },
            settings: {
                phpactor: {
                    diagnostics: false,
                },
            },
        });
    });

    it('provides default intelephense storage settings for embedded bridge backend', () => {
        const config = PhpBridge.resolveBackendConfig(
            {
                enableEmbeddedPhpBridge: true,
                embeddedPhpBackend: 'intelephense',
            },
            '/workspace',
        );

        expect(config?.initializationOptions?.globalStoragePath).toContain('.local/share/intelephense');
        expect(config?.initializationOptions?.storagePath).toContain('.local/share/intelephense');
        expect(config?.settings?.intelephense?.client?.autoCloseDocCommentDoSuggest).toBe(true);
        expect(config?.settings?.intelephense?.files?.maxSize).toBe(10_000_000);
    });

    it('allows overriding nested intelephense bridge config', () => {
        const config = PhpBridge.resolveBackendConfig(
            {
                enableEmbeddedPhpBridge: true,
                embeddedPhpBackend: 'intelephense',
                intelephense: {
                    initializationOptions: {
                        globalStoragePath: '/tmp/intelephense-global',
                    },
                    settings: {
                        intelephense: {
                            files: {
                                maxSize: 2048,
                            },
                        },
                    },
                },
            },
            '/workspace',
        );

        expect(config?.initializationOptions?.globalStoragePath).toBe('/tmp/intelephense-global');
        expect(config?.initializationOptions?.storagePath).toContain('.local/share/intelephense');
        expect(config?.settings?.intelephense?.files?.maxSize).toBe(2048);
    });

    it('writes and syncs a stable shadow document through the backend', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-'));
        const calls: Array<{ uri: string; version: number; text: string }> = [];

        const fakeBackend: PhpBridgeBackend.Client = {
            start: async () => {},
            waitForReady: async () => true,
            onReady: () => {},
            close: async () => {},
            reopen: async () => {},
            openOrUpdate: async (document) => {
                calls.push(document);
            },
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            resolveCompletion: async () => null,
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
            path.join(workspaceRoot, 'vendor', 'blade-lsp', 'shadow', 'resources-views-posts-show.php'),
        );
        expect(calls).toHaveLength(1);
        expect(calls[0].uri).toBe(entry.shadow.shadowUri);
        expect(logs.some((line) => line.includes('Embedded PHP bridge backend started'))).toBe(true);

        const written = await readFile(entry.shadow.shadowPath, 'utf-8');
        expect(written).toBe(entry.shadow.content);

        await PhpBridge.shutdown(state);
    });

    it('starts the embedded backend once across concurrent callers', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-start-'));
        let factoryCount = 0;
        let startCount = 0;

        const fakeBackend: PhpBridgeBackend.Client = {
            start: async () => {
                startCount++;
                await new Promise<void>((resolve) => setTimeout(resolve, 20));
            },
            waitForReady: async () => true,
            onReady: () => {},
            close: async () => {},
            reopen: async () => {},
            openOrUpdate: async () => {},
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            resolveCompletion: async () => null,
            shutdown: async () => {},
        };

        PhpBridge.setBackendFactoryForTests(() => {
            factoryCount++;
            return fakeBackend;
        });

        const state = PhpBridge.createState(
            workspaceRoot,
            { enableEmbeddedPhpBridge: true },
            { log: () => {}, error: () => {} },
        );

        const [first, second] = await Promise.all([PhpBridge.ensureBackend(state), PhpBridge.ensureBackend(state)]);

        expect(first).toBe(fakeBackend);
        expect(second).toBe(fakeBackend);
        expect(factoryCount).toBe(1);
        expect(startCount).toBe(1);

        await PhpBridge.shutdown(state);
    });

    it('reuses cached sync results for the same document version', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-cache-'));
        let syncCount = 0;

        PhpBridge.setBackendFactoryForTests(() => ({
            start: async () => {},
            waitForReady: async () => true,
            onReady: () => {},
            close: async () => {},
            reopen: async () => {},
            openOrUpdate: async () => {
                syncCount++;
            },
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            resolveCompletion: async () => null,
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

    it('retries backend sync for the same document after a startup failure', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-retry-'));
        let startCount = 0;
        let syncCount = 0;

        PhpBridge.setBackendFactoryForTests(() => ({
            start: async () => {
                startCount++;
                if (startCount === 1) {
                    throw new Error('backend boot failed');
                }
            },
            waitForReady: async () => true,
            onReady: () => {},
            close: async () => {},
            reopen: async () => {},
            openOrUpdate: async () => {
                syncCount++;
            },
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            resolveCompletion: async () => null,
            shutdown: async () => {},
        }));

        const state = PhpBridge.createState(
            workspaceRoot,
            { enableEmbeddedPhpBridge: true },
            { log: () => {}, error: () => {} },
        );
        const document = TextDocument.create(
            `file://${workspaceRoot}/resources/views/retry.blade.php`,
            'blade',
            1,
            '<?php $foo = 1; ?>',
        );

        const first = await PhpBridge.syncDocument(state, document);
        expect(first.backendSyncedVersion).toBeNull();

        const second = await PhpBridge.syncDocument(state, document);
        expect(second.backendSyncedVersion).not.toBeNull();
        expect(startCount).toBe(2);
        expect(syncCount).toBe(1);

        await PhpBridge.shutdown(state);
    });

    it('closes shadow documents and clears bridge state when a blade document closes', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-close-'));
        const closedUris: string[] = [];

        PhpBridge.setBackendFactoryForTests(() => ({
            start: async () => {},
            waitForReady: async () => true,
            onReady: () => {},
            close: async (uri) => {
                closedUris.push(uri);
            },
            reopen: async () => {},
            openOrUpdate: async () => {},
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            resolveCompletion: async () => null,
            shutdown: async () => {},
        }));

        const state = PhpBridge.createState(
            workspaceRoot,
            { enableEmbeddedPhpBridge: true },
            { log: () => {}, error: () => {} },
        );
        const document = TextDocument.create(
            `file://${workspaceRoot}/resources/views/close-me.blade.php`,
            'blade',
            1,
            '<?php $foo = 1; ?>',
        );

        const entry = await PhpBridge.syncDocument(state, document);
        expect(state.store.get(document.uri)).not.toBeNull();

        await PhpBridge.closeDocument(state, document.uri);

        expect(state.store.get(document.uri)).toBeNull();
        expect(closedUris).toEqual([entry.shadow.shadowUri]);

        await PhpBridge.shutdown(state);
    });

    it('skips backend resync when only non-php regions change', async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-bridge-signature-'));
        let syncCount = 0;

        PhpBridge.setBackendFactoryForTests(() => ({
            start: async () => {},
            waitForReady: async () => true,
            onReady: () => {},
            close: async () => {},
            reopen: async () => {},
            openOrUpdate: async () => {
                syncCount++;
            },
            hover: async () => null,
            definition: async () => null,
            completion: async () => null,
            resolveCompletion: async () => null,
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

        expect(first.extraction.signature).toBe(second.extraction.signature);
        expect(first.shadow.shadowUri).toBe(second.shadow.shadowUri);
        expect(first.shadow.regions[0]?.bladeContentOffsetStart).not.toBe(
            second.shadow.regions[0]?.bladeContentOffsetStart,
        );
        expect(first.backendSyncedVersion).toBe(second.backendSyncedVersion);
        expect(syncCount).toBe(1);

        await PhpBridge.shutdown(state);
    });
});

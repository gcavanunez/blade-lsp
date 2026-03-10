import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { PhpBridge } from '../../src/providers/php-bridge/bridge';
import { PhpBridgeMapping } from '../../src/providers/php-bridge/mapping';

const commandJson = process.env.EMBEDDED_PHP_LSP_COMMAND_JSON;
const backendName = (process.env.EMBEDDED_PHP_LSP_BACKEND as 'intelephense' | 'phpactor' | undefined) ?? 'intelephense';
const describeIfConfigured = commandJson ? describe : describe.skip;

function parseCommand(): string[] {
    if (!commandJson) {
        return [];
    }

    const parsed = JSON.parse(commandJson);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('EMBEDDED_PHP_LSP_COMMAND_JSON must be a JSON string array');
    }

    return parsed;
}

describeIfConfigured('Embedded PHP bridge backend viability (E2E)', () => {
    let workspaceRoot = '';
    const logs: string[] = [];

    beforeAll(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-php-bridge-e2e-'));

        await mkdir(path.join(workspaceRoot, 'app', 'Models'), { recursive: true });
        await mkdir(path.join(workspaceRoot, 'resources', 'views'), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, 'composer.json'),
            JSON.stringify(
                {
                    name: 'tests/blade-bridge',
                    autoload: {
                        'psr-4': {
                            'App\\': 'app/',
                        },
                    },
                },
                null,
                2,
            ),
            'utf-8',
        );

        await writeFile(
            path.join(workspaceRoot, 'app', 'Models', 'Post.php'),
            `<?php

namespace App\\Models;

class Post
{
    public string $title = 'Demo';
}
`,
            'utf-8',
        );
    });

    afterAll(async () => {
        if (workspaceRoot) {
            await rm(workspaceRoot, { recursive: true, force: true });
        }
    });

    it('resolves Laravel-ish project symbols from a stable shadow file across updates', async () => {
        const state = PhpBridge.createState(
            workspaceRoot,
            {
                enableEmbeddedPhpBridge: true,
                embeddedPhpBackend: backendName,
                embeddedPhpLspCommand: parseCommand(),
            },
            {
                log: (message) => logs.push(message),
                error: (message) => logs.push(`ERROR ${message}`),
            },
        );

        try {
            const sourceV1 = `<?php
use App\\Models\\Post;

$post = new Post();
?>

<div>{{ $post->title }}</div>
`;
            const documentV1 = TextDocument.create(
                `file://${workspaceRoot}/resources/views/show.blade.php`,
                'blade',
                1,
                sourceV1,
            );

            const entryV1 = await PhpBridge.syncDocument(state, documentV1);
            const backend = await PhpBridge.ensureBackend(state);
            expect(backend).not.toBeNull();
            if (backend) {
                await backend.waitForReady();
            }
            logs.push(`SHADOW_URI ${entryV1.shadow.shadowUri}`);
            logs.push(`SHADOW_CONTENT\n${entryV1.shadow.content}`);

            const classRef = PhpBridgeMapping.bladePositionToShadowPosition(
                sourceV1,
                entryV1.shadow,
                Position.create(3, 13),
            );
            expect(classRef.kind).toBe('mapped');
            logs.push(`MAPPED_CLASS_REF ${JSON.stringify(classRef)}`);

            if (backend && classRef.kind === 'mapped') {
                let definition = await backend.definition(entryV1.shadow.shadowUri, classRef.position);
                for (
                    let attempt = 0;
                    attempt < 5 && (!definition || (Array.isArray(definition) && definition.length === 0));
                    attempt++
                ) {
                    await delay(1000);
                    definition = await backend.definition(entryV1.shadow.shadowUri, classRef.position);
                    logs.push(`DEFINITION_RETRY_${attempt + 1} ${JSON.stringify(definition)}`);
                }
                expect(definition).not.toBeNull();

                const firstLocation = Array.isArray(definition) ? definition[0] : definition;
                expect(firstLocation?.uri, logs.join('\n')).toContain('/app/Models/Post.php');
            }

            const sourceV2 = sourceV1.replace('$post = new Post();', '$post = new Post(); // touch');
            const documentV2 = TextDocument.create(documentV1.uri, 'blade', 2, sourceV2);
            const entryV2 = await PhpBridge.syncDocument(state, documentV2);

            expect(entryV2.shadow.shadowUri).toBe(entryV1.shadow.shadowUri);

            const hoverTarget = PhpBridgeMapping.bladePositionToShadowPosition(
                sourceV2,
                entryV2.shadow,
                Position.create(3, 14),
            );
            expect(hoverTarget.kind).toBe('mapped');
            logs.push(`MAPPED_HOVER_REF ${JSON.stringify(hoverTarget)}`);

            if (backend && hoverTarget.kind === 'mapped') {
                const hover = await backend.hover(entryV2.shadow.shadowUri, hoverTarget.position);
                expect(hover).not.toBeNull();
            }
        } finally {
            await PhpBridge.shutdown(state);
        }
    }, 120000);
});

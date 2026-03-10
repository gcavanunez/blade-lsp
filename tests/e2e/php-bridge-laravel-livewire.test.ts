import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Lexer } from '../../src/parser/lexer';
import { PhpBridgeBackend } from '../../src/providers/php-bridge/backend';
import { PhpBridge } from '../../src/providers/php-bridge/bridge';
import { PhpBridgeRegions } from '../../src/providers/php-bridge/regions';
import { PhpBridgeShadowDocument } from '../../src/providers/php-bridge/shadow-document';
import { PhpBridgeMapping } from '../../src/providers/php-bridge/mapping';
import { createClient, type Client } from '../utils/client';

const execFileAsync = promisify(execFile);
const backendCommandJson = process.env.EMBEDDED_PHP_LSP_COMMAND_JSON;
const backendName = (process.env.EMBEDDED_PHP_LSP_BACKEND as 'intelephense' | 'phpactor' | undefined) ?? 'intelephense';
const runLaravelE2E = process.env.EMBEDDED_PHP_BRIDGE_RUN_LARAVEL_E2E === 'true';
const keepLaravelE2EApp = process.env.KEEP_PHP_BRIDGE_E2E_APP === 'true';
const laravelInstaller = process.env.LARAVEL_INSTALLER_PATH ?? 'laravel';
const completionRetryAttempts = Number(process.env.EMBEDDED_PHP_BRIDGE_COMPLETION_RETRY_ATTEMPTS ?? '12');
const completionRetryDelayMs = Number(process.env.EMBEDDED_PHP_BRIDGE_COMPLETION_RETRY_DELAY_MS ?? '1000');
const namespacedRetryAttempts = Number(process.env.EMBEDDED_PHP_BRIDGE_NAMESPACE_RETRY_ATTEMPTS ?? '4');
const describeIfConfigured = backendCommandJson && runLaravelE2E ? describe : describe.skip;

function parseBackendCommand(): string[] {
    if (!backendCommandJson) {
        return [];
    }

    const parsed = JSON.parse(backendCommandJson);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('EMBEDDED_PHP_LSP_COMMAND_JSON must be a JSON string array');
    }

    return parsed;
}

function isAppUserCandidate(item: {
    label: string;
    detail?: string;
    additionalTextEdits?: Array<{ newText: string }>;
}): boolean {
    return (
        item.label.includes('User') &&
        ((item.detail ?? '').includes('App\\Models\\User') ||
            item.additionalTextEdits?.some((edit) => edit.newText.includes('use App\\Models\\User;')) === true)
    );
}

describeIfConfigured('Embedded PHP bridge Laravel Livewire E2E', () => {
    let sandboxRoot = '';
    let workspaceRoot = '';
    let client: Client;
    const logs: string[] = [];
    let rootScratchPath = '';
    let nestedScratchPath = '';
    let rootNamespacedScratchPath = '';
    let nestedNamespacedScratchPath = '';

    const scratchContents = `<?php

use Livewire\\Component;

new class extends Component {
    public string $email;

    public function mount(): void
    {
        User
    }
};
`;

    const namespacedScratchContents = `<?php

new class {
    public function mount(): void
    {
        \App\Mode
    }
};
`;

    beforeAll(async () => {
        sandboxRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-laravel-e2e-'));
        workspaceRoot = path.join(sandboxRoot, 'laravel-livewire-app');
        logs.push(`WORKSPACE_ROOT ${workspaceRoot}`);

        await execFileAsync(
            laravelInstaller,
            ['new', workspaceRoot, '--livewire', '--no-interaction', '--no-ansi', '--quiet'],
            {
                env: process.env,
                maxBuffer: 10 * 1024 * 1024,
            },
        );

        await mkdir(path.join(workspaceRoot, 'resources', 'views', 'pages', 'bridge'), { recursive: true });
        await mkdir(path.join(workspaceRoot, 'app', 'Models'), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, 'app', 'Models', 'User.php'),
            `<?php

namespace App\\Models;

class User
{
}
`,
            'utf-8',
        );
        await writeFile(
            path.join(workspaceRoot, 'resources', 'views', 'pages', 'bridge', 'fixture.blade.php'),
            `<?php

use Livewire\\Component;

new class extends Component {
    public string $email;

    public function mount(): void
    {
        User
    }
};
?>

@php
    $groovy = 'chevere';
    $phrases = collect(['lets go!', $groovy]);
    $rando = $phrases->random();
@endphp

<div>
    <input wire:model="email" />
    {{ $rando }}
</div>
`,
            'utf-8',
        );

        rootScratchPath = path.join(workspaceRoot, 'scratch.php');
        nestedScratchPath = path.join(workspaceRoot, 'vendor', 'sample', 'scratch.php');
        rootNamespacedScratchPath = path.join(workspaceRoot, 'scratch-namespaced.php');
        nestedNamespacedScratchPath = path.join(workspaceRoot, 'vendor', 'sample', 'scratch-namespaced.php');
        await mkdir(path.dirname(nestedScratchPath), { recursive: true });
        await writeFile(rootScratchPath, scratchContents, 'utf-8');
        await writeFile(nestedScratchPath, scratchContents, 'utf-8');
        await writeFile(rootNamespacedScratchPath, namespacedScratchContents, 'utf-8');
        await writeFile(nestedNamespacedScratchPath, namespacedScratchContents, 'utf-8');

        client = await createClient({
            rootUri: `file://${workspaceRoot}`,
            settings: {
                enableLaravelIntegration: true,
                phpEnvironment: 'local',
                enableEmbeddedPhpBridge: true,
                embeddedPhpBackend: backendName,
                embeddedPhpLspCommand: parseBackendCommand(),
            },
        });

        client.connection.onNotification('window/logMessage', (params) => {
            logs.push(JSON.stringify(params));
        });
    }, 1800000);

    afterAll(async () => {
        if (client) {
            await client.shutdown();
        }
        if (sandboxRoot && !keepLaravelE2EApp) {
            await rm(sandboxRoot, { recursive: true, force: true });
        }
    });

    it('surfaces a real App\\Models\\User completion with import edits in a Volt-style Blade file', async () => {
        const text = await readFile(
            path.join(workspaceRoot, 'resources', 'views', 'pages', 'bridge', 'fixture.blade.php'),
            'utf-8',
        );

        const doc = await client.open({
            name: 'resources/views/pages/bridge/fixture.blade.php',
            text,
        });

        const extraction = PhpBridgeRegions.extract(text, Lexer.lexSource(text));
        const shadow = PhpBridgeShadowDocument.build(workspaceRoot, doc.uri, extraction);
        logs.push(`SHADOW_URI ${shadow.shadowUri}`);
        logs.push(`SHADOW_CONTENT\n${shadow.content}`);
        logs.push(
            `MAPPED_COMPLETION_REF ${JSON.stringify(PhpBridgeMapping.bladePositionToShadowPosition(text, shadow, { line: 9, character: 12 }))}`,
        );

        let items = await doc.completions(9, 12);
        for (let attempt = 0; attempt < completionRetryAttempts && !items.find(isAppUserCandidate); attempt++) {
            await delay(completionRetryDelayMs);
            items = await doc.completions(9, 12);
            logs.push(
                `COMPLETION_RETRY_${attempt + 1} ${items
                    .slice(0, 10)
                    .map((item) => `${item.label}::${item.detail ?? ''}`)
                    .join(', ')}`,
            );
        }
        const userItem = items.find(isAppUserCandidate);

        expect(userItem, logs.join('\n')).toBeDefined();
        expect(userItem?.additionalTextEdits?.some((edit) => edit.newText.includes('use App\\Models\\User;'))).toBe(
            true,
        );

        const resolved = await doc.resolveCompletion(userItem!);
        expect(resolved.additionalTextEdits?.some((edit) => edit.newText.includes('use App\\Models\\User;'))).toBe(
            true,
        );

        await doc.close();
    }, 120000);

    it('compares shadow-file, root scratch.php, and nested scratch.php completion behavior in the same Laravel app', async () => {
        const backend = PhpBridgeBackend.createLspClient({
            backendName,
            command: parseBackendCommand(),
            workspaceRoot,
            initializationOptions:
                backendName === 'intelephense'
                    ? {
                          globalStoragePath: path.join(os.homedir(), '.local', 'share', 'intelephense'),
                          storagePath: path.join(os.homedir(), '.local', 'share', 'intelephense'),
                      }
                    : undefined,
            settings:
                backendName === 'intelephense'
                    ? {
                          intelephense: {
                              client: { autoCloseDocCommentDoSuggest: true },
                              files: { maxSize: 10_000_000 },
                          },
                      }
                    : undefined,
            logger: {
                log: (message) => logs.push(`SCRATCH ${message}`),
                error: (message) => logs.push(`SCRATCH ERROR ${message}`),
            },
        });

        try {
            await backend.start();

            async function collectScratchLabels(
                kind: 'root' | 'nested',
                scratchPath: string,
            ): Promise<Array<{ label: string; detail?: string; additionalTextEdits?: Array<{ newText: string }> }>> {
                const scratchText = await readFile(scratchPath, 'utf-8');
                const scratchUri = `file://${scratchPath}`;

                await backend.openOrUpdate({
                    uri: scratchUri,
                    version: 1,
                    text: scratchText,
                });

                let scratchItems = await backend.completion(scratchUri, { line: 9, character: 12 });
                let scratchLabels = Array.isArray(scratchItems)
                    ? scratchItems.map((item) => item.label)
                    : (scratchItems?.items ?? []).map((item) => item.label);
                let items = Array.isArray(scratchItems) ? scratchItems : (scratchItems?.items ?? []);

                for (let attempt = 0; attempt < completionRetryAttempts && !items.some(isAppUserCandidate); attempt++) {
                    await delay(completionRetryDelayMs);
                    scratchItems = await backend.completion(scratchUri, { line: 9, character: 12 });
                    items = Array.isArray(scratchItems) ? scratchItems : (scratchItems?.items ?? []);
                    scratchLabels = Array.isArray(scratchItems)
                        ? scratchItems.map((item) => `${item.label}::${item.detail ?? ''}`)
                        : (scratchItems?.items ?? []).map((item) => `${item.label}::${item.detail ?? ''}`);
                    logs.push(
                        `${kind.toUpperCase()}_SCRATCH_RETRY_${attempt + 1} ${scratchLabels.slice(0, 10).join(', ')}`,
                    );
                }

                logs.push(`${kind.toUpperCase()}_SCRATCH_PATH ${scratchPath}`);
                logs.push(`${kind.toUpperCase()}_SCRATCH_LABELS ${scratchLabels.slice(0, 20).join(', ')}`);
                return items;
            }

            const rootScratchLabels = await collectScratchLabels('root', rootScratchPath);
            const nestedScratchLabels = await collectScratchLabels('nested', nestedScratchPath);

            expect(rootScratchLabels.some(isAppUserCandidate), logs.join('\n')).toBe(true);
            expect(nestedScratchLabels.some(isAppUserCandidate), logs.join('\n')).toBe(true);
        } finally {
            await backend.shutdown();
        }
    }, 120000);

    it('captures namespaced class completion behavior for root and nested scratch controls', async () => {
        const backend = PhpBridgeBackend.createLspClient({
            backendName,
            command: parseBackendCommand(),
            workspaceRoot,
            initializationOptions:
                backendName === 'intelephense'
                    ? {
                          globalStoragePath: path.join(os.homedir(), '.local', 'share', 'intelephense'),
                          storagePath: path.join(os.homedir(), '.local', 'share', 'intelephense'),
                      }
                    : undefined,
            settings:
                backendName === 'intelephense'
                    ? {
                          intelephense: {
                              client: { autoCloseDocCommentDoSuggest: true },
                              files: { maxSize: 10_000_000 },
                          },
                      }
                    : undefined,
            logger: {
                log: (message) => logs.push(`NAMESPACE ${message}`),
                error: (message) => logs.push(`NAMESPACE ERROR ${message}`),
            },
        });

        try {
            await backend.start();

            async function collectNamespacedLabels(kind: 'root' | 'nested', scratchPath: string): Promise<string[]> {
                const scratchText = await readFile(scratchPath, 'utf-8');
                const scratchUri = `file://${scratchPath}`;

                await backend.openOrUpdate({
                    uri: scratchUri,
                    version: 1,
                    text: scratchText,
                });

                let scratchItems = await backend.completion(scratchUri, { line: 5, character: 17 });
                let scratchLabels = Array.isArray(scratchItems)
                    ? scratchItems.map((item) => item.label)
                    : (scratchItems?.items ?? []).map((item) => item.label);

                for (let attempt = 0; attempt < namespacedRetryAttempts && !scratchLabels.includes('User'); attempt++) {
                    await delay(completionRetryDelayMs);
                    scratchItems = await backend.completion(scratchUri, { line: 5, character: 17 });
                    scratchLabels = Array.isArray(scratchItems)
                        ? scratchItems.map((item) => item.label)
                        : (scratchItems?.items ?? []).map((item) => item.label);
                    logs.push(
                        `${kind.toUpperCase()}_NAMESPACE_RETRY_${attempt + 1} ${scratchLabels.slice(0, 10).join(', ')}`,
                    );
                }

                logs.push(`${kind.toUpperCase()}_NAMESPACE_PATH ${scratchPath}`);
                logs.push(`${kind.toUpperCase()}_NAMESPACE_LABELS ${scratchLabels.slice(0, 20).join(', ')}`);
                return scratchLabels;
            }

            const rootLabels = await collectNamespacedLabels('root', rootNamespacedScratchPath);
            const nestedLabels = await collectNamespacedLabels('nested', nestedNamespacedScratchPath);

            expect(Array.isArray(rootLabels), logs.join('\n')).toBe(true);
            expect(Array.isArray(nestedLabels), logs.join('\n')).toBe(true);
        } finally {
            await backend.shutdown();
        }
    }, 120000);
});

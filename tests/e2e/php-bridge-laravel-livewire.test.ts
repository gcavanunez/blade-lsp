import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Client } from '../utils/client';

const execFileAsync = promisify(execFile);
const backendCommandJson = process.env.EMBEDDED_PHP_LSP_COMMAND_JSON;
const backendName = (process.env.EMBEDDED_PHP_LSP_BACKEND as 'intelephense' | 'phpactor' | undefined) ?? 'intelephense';
const runLaravelE2E = process.env.EMBEDDED_PHP_BRIDGE_RUN_LARAVEL_E2E === 'true';
const laravelInstaller = process.env.LARAVEL_INSTALLER_PATH ?? 'laravel';
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

describeIfConfigured('Embedded PHP bridge Laravel Livewire E2E', () => {
    let sandboxRoot = '';
    let workspaceRoot = '';
    let client: Client;

    beforeAll(async () => {
        sandboxRoot = await mkdtemp(path.join(os.tmpdir(), 'blade-lsp-laravel-e2e-'));
        workspaceRoot = path.join(sandboxRoot, 'laravel-livewire-app');

        await execFileAsync(
            laravelInstaller,
            ['new', workspaceRoot, '--livewire', '--no-interaction', '--no-ansi', '--quiet'],
            {
                env: process.env,
                maxBuffer: 10 * 1024 * 1024,
            },
        );

        await mkdir(path.join(workspaceRoot, 'resources', 'views', 'pages', 'bridge'), { recursive: true });
        await writeFile(
            path.join(workspaceRoot, 'resources', 'views', 'pages', 'bridge', 'fixture.blade.php'),
            `<?php

use Livewire\\Component;

new class extends Component {
    public string $email;

    public function mount(): void
    {
        Use
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
    }, 1800000);

    afterAll(async () => {
        if (client) {
            await client.shutdown();
        }
        if (sandboxRoot) {
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

        const items = await doc.completions(8, 11);
        const userItem = items.find((item) => item.label === 'User');

        expect(userItem).toBeDefined();
        expect(userItem?.additionalTextEdits?.some((edit) => edit.newText.includes('use App\\Models\\User;'))).toBe(
            true,
        );

        const resolved = await doc.resolveCompletion(userItem!);
        expect(resolved.additionalTextEdits?.some((edit) => edit.newText.includes('use App\\Models\\User;'))).toBe(
            true,
        );

        await doc.close();
    }, 120000);
});

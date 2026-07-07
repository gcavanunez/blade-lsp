import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { PhpRunner } from '../../src/laravel/php-runner';
import { Project } from '../../src/laravel/project';
import { Container } from '../../src/runtime/container';
import { ensureContainer } from '../utils/laravel-mock';
import { runTest } from '../utils/effect';

describe('PhpRunner.runScript error channel', () => {
    const project: Project.AnyProject = {
        type: 'laravel',
        root: '/tmp/blade-lsp-test-project',
        artisanPath: '/tmp/blade-lsp-test-project/artisan',
        composerPath: '/tmp/blade-lsp-test-project/composer.json',
        vendorPath: '/tmp/blade-lsp-test-project/vendor',
        viewsPath: '/tmp/blade-lsp-test-project/resources/views',
        componentsPath: '/tmp/blade-lsp-test-project/app/View/Components',
        phpCommand: ['php'],
        phpEnvironment: {
            name: 'local',
            label: 'Local',
            phpCommand: ['php'],
            useRelativePaths: false,
        },
    };

    beforeEach(async () => {
        await Container.dispose();
        ensureContainer();
    });

    afterEach(async () => {
        await Container.dispose();
    });

    it('fails with a typed ScriptNotFoundError for unknown scripts', async () => {
        const effect = PhpRunner.runScript({ project, scriptName: 'does-not-exist' });

        await expect(runTest(effect)).rejects.toBeInstanceOf(PhpRunner.ScriptNotFoundError);
    });

    it('exposes error fields at the top level', async () => {
        const effect = PhpRunner.runScript({ project, scriptName: 'does-not-exist' });

        const error = await runTest(effect).then(
            () => {
                throw new Error('expected failure');
            },
            (e: unknown) => e as InstanceType<typeof PhpRunner.ScriptNotFoundError>,
        );

        expect(error._tag).toBe('PhpRunnerScriptNotFoundError');
        expect(error.script).toBe('does-not-exist');
        expect(error.message).toContain("PHP script 'does-not-exist' not found");
    });

    it('recovers with Effect.catchTag', async () => {
        const result = await runTest(
            PhpRunner.runScript({ project, scriptName: 'does-not-exist' }).pipe(
                Effect.catchTag('PhpRunnerScriptNotFoundError', (error) => Effect.succeed(`missing:${error.script}`)),
            ),
        );

        expect(result).toBe('missing:does-not-exist');
    });
});

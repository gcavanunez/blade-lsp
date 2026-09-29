import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { PhpRunner } from '../../src/laravel/php-runner';
import { LaravelContext } from '../../src/laravel/context';
import { Views } from '../../src/laravel/views';
import { Project } from '../../src/laravel/project';
import { Container } from '../../src/runtime/container';
import { ensureContainer } from '../utils/laravel-mock';
import { runTest } from '../utils/effect';

describe('Views.refresh error channel', () => {
    const project: Project.AnyProject = {
        type: 'laravel',
        root: '/workspace',
        artisanPath: '/workspace/artisan',
        composerPath: '/workspace/composer.json',
        vendorPath: '/workspace/vendor',
        viewsPath: '/workspace/resources/views',
        componentsPath: '/workspace/app/View/Components',
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
        LaravelContext.set(LaravelContext.createState(project));
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        LaravelContext.set(null);
        await Container.dispose();
    });

    it('stores view items and marks the load state ready on success', async () => {
        const items = [{ key: 'welcome', path: 'resources/views/welcome.blade.php', uri: 'file:///welcome' }];
        vi.spyOn(PhpRunner, 'runScript').mockReturnValue(Effect.succeed(items));

        await runTest(Views.refresh());

        const state = LaravelContext.use();
        expect(state.views.items).toEqual(items);
        expect(state.views.loadState.status).toBe('ready');
    });

    it('fails with RefreshError carrying the underlying error as cause', async () => {
        const spawnError = new PhpRunner.SpawnError({ command: 'php', message: 'ENOENT' });
        vi.spyOn(PhpRunner, 'runScript').mockReturnValue(Effect.fail(spawnError));

        const error = await runTest(Views.refresh()).then(
            () => {
                throw new Error('expected failure');
            },
            (e: unknown) => e as InstanceType<typeof Views.RefreshError>,
        );

        expect(error).toBeInstanceOf(Views.RefreshError);
        expect(error.cause).toBe(spawnError);
    });

    it('records the failed load state before failing', async () => {
        const spawnError = new PhpRunner.SpawnError({ command: 'php', message: 'ENOENT' });
        vi.spyOn(PhpRunner, 'runScript').mockReturnValue(Effect.fail(spawnError));

        await expect(runTest(Views.refresh())).rejects.toBeInstanceOf(Views.RefreshError);

        const state = LaravelContext.use();
        expect(state.views.loadState.status).toBe('failed');
        expect(state.views.loadState.status === 'failed' && state.views.loadState.error).toContain('ENOENT');
    });
});

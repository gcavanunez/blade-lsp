import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { Laravel } from '../../src/laravel/index';
import { LaravelContext } from '../../src/laravel/context';
import { Project } from '../../src/laravel/project';
import { Views } from '../../src/laravel/views';
import { Components } from '../../src/laravel/components';
import { Directives } from '../../src/laravel/directives';
import { Container } from '../../src/runtime/container';
import { ensureContainer } from '../utils/laravel-mock';

describe('Laravel lifecycle', () => {
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
        Laravel.dispose();
        await Container.dispose();
        ensureContainer();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        Laravel.dispose();
        await Container.dispose();
    });

    it('releases the init lock after initialization failures so retries can run', async () => {
        vi.spyOn(Project, 'detectAny').mockReturnValue(project);
        const validateSpy = vi
            .spyOn(Project, 'validateAny')
            .mockRejectedValueOnce(new Error('validation crashed'))
            .mockResolvedValueOnce(true);
        const viewsRefreshSpy = vi.spyOn(Views, 'refresh').mockReturnValue(Effect.void);
        const componentsRefreshSpy = vi.spyOn(Components, 'refresh').mockReturnValue(Effect.void);
        const directivesRefreshSpy = vi.spyOn(Directives, 'refresh').mockReturnValue(Effect.void);

        await expect(Laravel.initialize('/workspace')).rejects.toThrow('validation crashed');

        await expect(Laravel.initialize('/workspace')).resolves.toBe(true);

        expect(validateSpy).toHaveBeenCalledTimes(2);
        expect(viewsRefreshSpy).toHaveBeenCalledTimes(1);
        expect(componentsRefreshSpy).toHaveBeenCalledTimes(1);
        expect(directivesRefreshSpy).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent initialize calls into a single boot', async () => {
        vi.spyOn(Project, 'detectAny').mockReturnValue(project);
        let resolveValidate: (value: boolean) => void;
        const validateSpy = vi.spyOn(Project, 'validateAny').mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveValidate = resolve;
                }),
        );
        vi.spyOn(Views, 'refresh').mockReturnValue(Effect.void);
        vi.spyOn(Components, 'refresh').mockReturnValue(Effect.void);
        vi.spyOn(Directives, 'refresh').mockReturnValue(Effect.void);

        const first = Laravel.initialize('/workspace');
        const second = Laravel.initialize('/workspace');

        // Let the first boot reach the validation step, then release it.
        await vi.waitFor(() => expect(validateSpy).toHaveBeenCalledTimes(1));
        resolveValidate!(true);

        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);

        // The second caller observed the initialized context; no second boot.
        expect(validateSpy).toHaveBeenCalledTimes(1);
    });

    it('re-runs initialization on a later call after dispose', async () => {
        vi.spyOn(Project, 'detectAny').mockReturnValue(project);
        const validateSpy = vi.spyOn(Project, 'validateAny').mockResolvedValue(true);
        vi.spyOn(Views, 'refresh').mockReturnValue(Effect.void);
        vi.spyOn(Components, 'refresh').mockReturnValue(Effect.void);
        vi.spyOn(Directives, 'refresh').mockReturnValue(Effect.void);

        await expect(Laravel.initialize('/workspace')).resolves.toBe(true);
        // While the context is live, initialize is idempotent.
        await expect(Laravel.initialize('/workspace')).resolves.toBe(true);
        expect(validateSpy).toHaveBeenCalledTimes(1);

        Laravel.dispose();

        await expect(Laravel.initialize('/workspace')).resolves.toBe(true);
        expect(validateSpy).toHaveBeenCalledTimes(2);
    });

    it('syncs refresh result from current dataset load states', () => {
        const state = LaravelContext.createState(project);
        state.views.loadState = LaravelContext.createReadyLoadState();
        state.components.loadState = LaravelContext.createFailedLoadState('components failed');
        state.directives.loadState = LaravelContext.createReadyLoadState();
        LaravelContext.set(state);

        const result = Laravel.syncRefreshResultFromState();

        expect(result).toEqual({
            views: 'ok',
            components: 'failed',
            directives: 'ok',
            errors: ['components failed'],
        });
        expect(Laravel.getLastRefreshResult()).toEqual(result);
    });
});

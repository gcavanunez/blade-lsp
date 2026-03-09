import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MutableRef } from 'effect';
import { Laravel } from '../../src/laravel/index';
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

    it('clears init promise after initialization failures so retries can run', async () => {
        vi.spyOn(Project, 'detectAny').mockReturnValue(project);
        const validateSpy = vi
            .spyOn(Project, 'validateAny')
            .mockRejectedValueOnce(new Error('validation crashed'))
            .mockResolvedValueOnce(true);
        const viewsRefreshSpy = vi.spyOn(Views, 'refresh').mockResolvedValue();
        const componentsRefreshSpy = vi.spyOn(Components, 'refresh').mockResolvedValue();
        const directivesRefreshSpy = vi.spyOn(Directives, 'refresh').mockResolvedValue();

        await expect(Laravel.initialize('/workspace')).rejects.toThrow('validation crashed');
        expect(MutableRef.get(Container.get().laravelInitPromise)).toBeNull();

        await expect(Laravel.initialize('/workspace')).resolves.toBe(true);

        expect(validateSpy).toHaveBeenCalledTimes(2);
        expect(viewsRefreshSpy).toHaveBeenCalledTimes(1);
        expect(componentsRefreshSpy).toHaveBeenCalledTimes(1);
        expect(directivesRefreshSpy).toHaveBeenCalledTimes(1);
        expect(MutableRef.get(Container.get().laravelInitPromise)).toBeNull();
    });
});

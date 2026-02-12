import * as fs from 'fs';
import * as path from 'path';
import { Log } from '../utils/log';
import { PhpEnvironment } from './php-environment';

export namespace Project {
    // ─── Types ────────────────────────────────────────────────────────────────

    export interface LaravelProject {
        root: string;
        artisanPath: string;
        composerPath: string;
        phpCommand: string[];
        vendorPath: string;
        viewsPath: string;
        componentsPath: string;
        phpEnvironment: PhpEnvironment.Result;
    }

    interface Options {
        phpCommand?: string[];
        phpEnvironment?: PhpEnvironment.Name;
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    const log = Log.create({ service: 'project' });

    // ─── Public Functions ─────────────────────────────────────────────────────

    /**
     * Detect if the given directory is a Laravel project.
     * @param workspaceRoot - The workspace root path
     * @param options - Optional PHP configuration (path or command)
     */
    export function detect(workspaceRoot: string, options: Options = {}): LaravelProject | null {
        const artisanPath = path.join(workspaceRoot, 'artisan');
        const composerPath = path.join(workspaceRoot, 'composer.json');
        const vendorPath = path.join(workspaceRoot, 'vendor');
        const viewsPath = path.join(workspaceRoot, 'resources', 'views');
        const componentsPath = path.join(workspaceRoot, 'app', 'View', 'Components');

        if (!fs.existsSync(artisanPath)) {
            return null;
        }

        if (!fs.existsSync(composerPath)) {
            return null;
        }

        try {
            const composerContent = fs.readFileSync(composerPath, 'utf-8');
            const composer = JSON.parse(composerContent);

            const hasLaravel =
                composer.require?.['laravel/framework'] ||
                composer.require?.['illuminate/support'] ||
                composer['require-dev']?.['laravel/framework'];

            if (!hasLaravel) {
                return null;
            }
        } catch {
            return null;
        }

        if (!fs.existsSync(vendorPath)) {
            return null;
        }

        let phpEnv: PhpEnvironment.Result;

        if (options.phpCommand && options.phpCommand.length > 0) {
            // Custom commands often run in containers; keep paths project-relative by default.
            phpEnv = {
                name: 'docker',
                label: 'Custom',
                phpCommand: options.phpCommand,
                useRelativePaths: true,
            };
        } else {
            const detected = PhpEnvironment.detect(workspaceRoot, options.phpEnvironment);
            if (!detected) {
                log.warn('No PHP environment detected');
                return null;
            }
            phpEnv = detected;
        }

        return {
            root: workspaceRoot,
            artisanPath,
            composerPath,
            phpCommand: phpEnv.phpCommand,
            vendorPath,
            viewsPath,
            componentsPath,
            phpEnvironment: phpEnv,
        };
    }

    /**
     * Validate that the Laravel project can be bootstrapped.
     */
    export async function validate(project: LaravelProject): Promise<boolean> {
        const bootstrapPath = path.join(project.root, 'bootstrap', 'app.php');
        const autoloadPath = path.join(project.vendorPath, 'autoload.php');

        return fs.existsSync(bootstrapPath) && fs.existsSync(autoloadPath);
    }
}

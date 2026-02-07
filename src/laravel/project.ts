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
        // Command array to execute PHP (e.g., ['php'], ['docker', 'compose', 'exec', 'app', 'php'])
        phpCommand: string[];
        vendorPath: string;
        viewsPath: string;
        componentsPath: string;
        // Detected PHP environment info
        phpEnvironment: PhpEnvironment.Result;
    }

    interface Options {
        // Command array to execute PHP (defaults to auto-detect if not provided)
        // Examples:
        //   - Local: ['php'] or ['/usr/bin/php']
        //   - Docker: ['docker', 'compose', 'exec', 'app', 'php']
        //   - Sail: ['./vendor/bin/sail', 'php']
        phpCommand?: string[];
        // Preferred PHP environment to try (skips auto-detection order)
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

        // Check if artisan exists
        if (!fs.existsSync(artisanPath)) {
            return null;
        }

        // Check if composer.json exists and contains laravel/framework
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

        // Check if vendor directory exists (dependencies installed)
        if (!fs.existsSync(vendorPath)) {
            return null;
        }

        // Determine PHP command via environment detection
        let phpEnv: PhpEnvironment.Result;

        if (options.phpCommand && options.phpCommand.length > 0) {
            // Explicit command provided — wrap it as a manual/docker environment
            phpEnv = {
                name: 'docker',
                label: 'Custom',
                phpCommand: options.phpCommand,
                useRelativePaths: true,
            };
        } else {
            // Auto-detect: probe Herd → Valet → Sail → Lando → DDEV → Local → Docker
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

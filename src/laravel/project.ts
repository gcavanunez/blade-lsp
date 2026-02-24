import * as fs from 'fs';
import * as path from 'path';
import { Log } from '../utils/log';
import { PhpEnvironment } from './php-environment';
import type { FrameworkType } from './types';

export namespace Project {
    // ─── Shared base for all framework projects ─────────────────────────────

    export interface BaseProject {
        type: FrameworkType;
        root: string;
        composerPath: string;
        phpCommand: string[];
        vendorPath: string;
        phpEnvironment: PhpEnvironment.Result;
    }

    // ─── Laravel ────────────────────────────────────────────────────────────

    export interface LaravelProject extends BaseProject {
        type: 'laravel';
        artisanPath: string;
        viewsPath: string;
        componentsPath: string;
    }

    // ─── Jigsaw ─────────────────────────────────────────────────────────────

    export interface JigsawProject extends BaseProject {
        type: 'jigsaw';
        configPath: string;
        sourcePath: string;
        componentsPath: string;
        layoutsPath: string;
    }

    // ─── Union ──────────────────────────────────────────────────────────────

    export type AnyProject = LaravelProject | JigsawProject;

    // ─── Options ────────────────────────────────────────────────────────────

    export interface Options {
        phpCommand?: string[];
        phpEnvironment?: PhpEnvironment.Name;
    }

    const log = Log.create({ service: 'project' });

    // ─── PHP environment resolution (shared) ────────────────────────────────

    function resolvePhpEnvironment(workspaceRoot: string, options: Options): PhpEnvironment.Result | null {
        if (options.phpCommand && options.phpCommand.length > 0) {
            return {
                name: 'docker',
                label: 'Custom',
                phpCommand: options.phpCommand,
                useRelativePaths: true,
            };
        }

        const detected = PhpEnvironment.detect(workspaceRoot, options.phpEnvironment);
        if (!detected) {
            log.warn('No PHP environment detected');
            return null;
        }
        return detected;
    }

    // ─── Laravel detection ──────────────────────────────────────────────────

    /**
     * Detect if the given directory is a Laravel project.
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

        const phpEnv = resolvePhpEnvironment(workspaceRoot, options);
        if (!phpEnv) return null;

        return {
            type: 'laravel',
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

    // ─── Jigsaw detection ───────────────────────────────────────────────────

    /**
     * Detect if the given directory is a Jigsaw project.
     * Jigsaw projects have: config.php + tightenco/jigsaw in composer + source/ directory.
     */
    export function detectJigsaw(workspaceRoot: string, options: Options = {}): JigsawProject | null {
        const configPath = path.join(workspaceRoot, 'config.php');
        const composerPath = path.join(workspaceRoot, 'composer.json');
        const vendorPath = path.join(workspaceRoot, 'vendor');
        const sourcePath = path.join(workspaceRoot, 'source');
        const componentsPath = path.join(sourcePath, '_components');
        const layoutsPath = path.join(sourcePath, '_layouts');

        if (!fs.existsSync(configPath)) {
            return null;
        }

        if (!fs.existsSync(composerPath)) {
            return null;
        }

        try {
            const composerContent = fs.readFileSync(composerPath, 'utf-8');
            const composer = JSON.parse(composerContent);

            const hasJigsaw = composer.require?.['tightenco/jigsaw'] || composer['require-dev']?.['tightenco/jigsaw'];

            if (!hasJigsaw) {
                return null;
            }
        } catch {
            return null;
        }

        if (!fs.existsSync(vendorPath)) {
            return null;
        }

        if (!fs.existsSync(sourcePath)) {
            return null;
        }

        const phpEnv = resolvePhpEnvironment(workspaceRoot, options);
        if (!phpEnv) return null;

        return {
            type: 'jigsaw',
            root: workspaceRoot,
            configPath,
            composerPath,
            phpCommand: phpEnv.phpCommand,
            vendorPath,
            sourcePath,
            componentsPath,
            layoutsPath,
            phpEnvironment: phpEnv,
        };
    }

    /**
     * Validate that the Jigsaw project can be bootstrapped.
     */
    export async function validateJigsaw(project: JigsawProject): Promise<boolean> {
        const autoloadPath = path.join(project.vendorPath, 'autoload.php');
        return fs.existsSync(project.configPath) && fs.existsSync(autoloadPath);
    }

    // ─── Universal detection ────────────────────────────────────────────────

    /**
     * Try to detect any supported framework project.
     * Tries Laravel first, then Jigsaw.
     */
    export function detectAny(workspaceRoot: string, options: Options = {}): AnyProject | null {
        return detect(workspaceRoot, options) ?? detectJigsaw(workspaceRoot, options);
    }

    /**
     * Validate any project type.
     */
    export async function validateAny(project: AnyProject): Promise<boolean> {
        switch (project.type) {
            case 'laravel':
                return validate(project);
            case 'jigsaw':
                return validateJigsaw(project);
        }
    }
}

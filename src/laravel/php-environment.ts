/**
 * PHP environment detection module
 *
 * Auto-detects the PHP runtime environment for a Laravel project.
 * Inspired by the VS Code Laravel extension's approach, this probes for
 * common PHP environments in order of specificity:
 *
 *   Herd → Valet → Sail → Lando → DDEV → Local → Docker (Compose)
 *
 * Containerized environments (Sail, Lando, DDEV, Docker) require relative
 * file paths because the container filesystem differs from the host.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Log } from '../utils/log';

export namespace PhpEnvironment {
    export type Name = 'herd' | 'valet' | 'sail' | 'lando' | 'ddev' | 'local' | 'docker';

    export interface Result {
        /** Which environment was detected */
        name: Name;
        /** Human-readable label */
        label: string;
        /** The command array to execute PHP (e.g., ['php'], ['./vendor/bin/sail', 'php']) */
        phpCommand: string[];
        /** Whether file paths passed to PHP must be relative to the project root */
        useRelativePaths: boolean;
    }

    interface Config {
        label: string;
        /**
         * One or more shell commands to run to check if this environment is available.
         * If an array, each command is run in sequence; the stdout of the previous
         * command is available as `{binaryPath}` in the next command and the final command string.
         */
        check: string | string[];
        /**
         * The command array to use when executing PHP.
         * `{binaryPath}` in any element is replaced with the output of the check command(s).
         */
        command: string[];
        /**
         * Optional validation function run against the check output.
         * Return false to reject this environment even if the check command succeeded.
         */
        test?: (output: string, projectRoot: string) => boolean;
        /**
         * Whether this environment requires relative file paths
         * (i.e., it runs inside a container with a different filesystem).
         */
        relativePath?: boolean;
        /**
         * Optional prerequisite: one or more files where at least one must exist
         * relative to the project root before we attempt the check command.
         * If a string, treated as a single file. If an array, any match suffices.
         */
        requireFile?: string | string[];
    }

    const log = Log.create({ service: 'php-environment' });

    const environments: Record<Name, Config> = {
        herd: {
            label: 'Herd',
            check: 'herd which-php',
            command: ['{binaryPath}'],
            test: (output) => !output.includes('No usable PHP version found'),
        },
        valet: {
            label: 'Valet',
            check: 'valet which-php',
            command: ['{binaryPath}'],
        },
        sail: {
            label: 'Sail',
            check: './vendor/bin/sail ps',
            command: ['./vendor/bin/sail', 'php'],
            relativePath: true,
            requireFile: 'vendor/bin/sail',
        },
        lando: {
            label: 'Lando',
            check: 'lando php -r "echo PHP_BINARY;"',
            command: ['lando', 'php'],
            relativePath: true,
        },
        ddev: {
            label: 'DDEV',
            check: 'ddev php -r "echo PHP_BINARY;"',
            command: ['ddev', 'php'],
            relativePath: true,
        },
        local: {
            label: 'Local',
            check: 'php -r "echo PHP_BINARY;"',
            command: ['{binaryPath}'],
        },
        docker: {
            label: 'Docker Compose',
            check: 'docker compose ps --status running --format json',
            command: ['docker', 'compose', 'exec', '-T', 'app', 'php'],
            relativePath: true,
            requireFile: ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
            test: (output) => {
                if (!output || output.trim().length === 0) {
                    return false;
                }
                try {
                    const parsed = JSON.parse(output);
                    return Array.isArray(parsed) && parsed.length > 0;
                } catch {
                    return false;
                }
            },
        },
    };

    /**
     * The default order in which environments are probed during auto-detection.
     * Docker Compose is last — it's a fallback when no dedicated tool (Sail, Lando, DDEV) is found
     * but a docker-compose.yml exists with running containers.
     */
    const DETECTION_ORDER: Name[] = ['herd', 'valet', 'sail', 'lando', 'ddev', 'local', 'docker'];

    /**
     * Try to detect a specific PHP environment.
     */
    function tryEnvironment(name: Name, projectRoot: string): Result | null {
        const config = environments[name];

        // Check prerequisite file(s) — at least one must exist
        if (config.requireFile) {
            const files = Array.isArray(config.requireFile) ? config.requireFile : [config.requireFile];
            const found = files.some((f) => fs.existsSync(path.join(projectRoot, f)));
            if (!found) {
                return null;
            }
        }

        try {
            const checks = Array.isArray(config.check) ? [...config.check] : [config.check];
            let binaryPath = '';

            for (const check of checks) {
                const cmd = check.replace('{binaryPath}', binaryPath);
                log.info(`Checking ${name} environment: ${cmd}`);

                binaryPath = execSync(cmd, {
                    cwd: projectRoot,
                    timeout: 5000,
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                }).trim();
            }

            // Run the optional test function
            if (config.test && !config.test(binaryPath, projectRoot)) {
                log.info(`${name} check passed but test rejected it`);
                return null;
            }

            // Build the command — substitute {binaryPath} in each element
            const phpCommand = config.command.map((part) => part.replace('{binaryPath}', binaryPath));

            log.info(`Detected ${name} environment`, { phpCommand: phpCommand.join(' ') });

            return {
                name,
                label: config.label,
                phpCommand,
                useRelativePaths: config.relativePath ?? false,
            };
        } catch (err) {
            // Check command failed — this environment isn't available
            log.info(`${name} environment not available`, {
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }

    /**
     * Auto-detect the PHP environment for a Laravel project.
     *
     * Probes environments in order: Herd → Valet → Sail → Lando → DDEV → Local → Docker Compose.
     * Returns the first one whose check command succeeds, or null if none are found.
     *
     * @param projectRoot - The Laravel project root directory
     * @param preferredEnv - If specified, try only this environment (skip auto-detection order)
     */
    export function detect(projectRoot: string, preferredEnv?: Name): Result | null {
        // If a specific environment is requested, try only that one
        if (preferredEnv) {
            log.info(`Trying preferred environment: ${preferredEnv}`);
            return tryEnvironment(preferredEnv, projectRoot);
        }

        for (const name of DETECTION_ORDER) {
            const result = tryEnvironment(name, projectRoot);
            if (result) {
                return result;
            }
        }

        log.warn('No PHP environment detected');
        return null;
    }
}

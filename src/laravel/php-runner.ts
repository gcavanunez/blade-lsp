import { spawn, type ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import z from 'zod';
import { Effect, Schedule } from 'effect';
import { NamedError } from '../utils/error';
import { Project } from './project';
import type { FrameworkType } from './types';

export namespace PhpRunner {
    export const ScriptNotFoundError = NamedError.create(
        'PhpRunnerScriptNotFoundError',
        z.object({
            script: z.string(),
            path: z.string(),
        }),
    );

    export const VendorDirError = NamedError.create(
        'PhpRunnerVendorDirError',
        z.object({
            path: z.string(),
            message: z.string(),
        }),
    );

    export const WriteError = NamedError.create(
        'PhpRunnerWriteError',
        z.object({
            path: z.string(),
            message: z.string(),
        }),
    );

    export const TimeoutError = NamedError.create(
        'PhpRunnerTimeoutError',
        z.object({
            timeoutMs: z.number(),
            scriptName: z.string(),
        }),
    );

    export const StartupError = NamedError.create(
        'PhpRunnerStartupError',
        z.object({
            message: z.string(),
        }),
    );

    export const OutputError = NamedError.create(
        'PhpRunnerOutputError',
        z.object({
            message: z.string(),
            stdout: z.string().optional(),
            stderr: z.string().optional(),
        }),
    );

    export const ParseError = NamedError.create(
        'PhpRunnerParseError',
        z.object({
            message: z.string(),
            output: z.string().optional(),
        }),
    );

    export const SpawnError = NamedError.create(
        'PhpRunnerSpawnError',
        z.object({
            command: z.string(),
            message: z.string(),
        }),
    );

    /** Union of all errors that `executePhp` can produce. */
    export type ExecuteError = InstanceType<
        typeof TimeoutError | typeof StartupError | typeof OutputError | typeof ParseError | typeof SpawnError
    >;

    /** Union of all errors that `runScript` can produce. */
    export type RunScriptError =
        | InstanceType<typeof ScriptNotFoundError | typeof VendorDirError | typeof WriteError>
        | ExecuteError;

    interface FrameworkConfig {
        scriptsSubdir: string;
        outputMarkers: {
            START: string;
            END: string;
            STARTUP_ERROR: string;
        };
        placeholder: string;
    }

    const FRAMEWORK_CONFIGS: Record<FrameworkType, FrameworkConfig> = {
        laravel: {
            scriptsSubdir: 'laravel',
            outputMarkers: {
                START: '__VSCODE_LARAVEL_START_OUTPUT__',
                END: '__VSCODE_LARAVEL_END_OUTPUT__',
                STARTUP_ERROR: '__VSCODE_LARAVEL_STARTUP_ERROR__',
            },
            placeholder: '__VSCODE_LARAVEL_OUTPUT__;',
        },
        jigsaw: {
            scriptsSubdir: 'jigsaw',
            outputMarkers: {
                START: '__BLADE_LSP_JIGSAW_START_OUTPUT__',
                END: '__BLADE_LSP_JIGSAW_END_OUTPUT__',
                STARTUP_ERROR: '__BLADE_LSP_JIGSAW_STARTUP_ERROR__',
            },
            placeholder: '__JIGSAW_LSP_OUTPUT__;',
        },
    };

    interface Options {
        project: Project.AnyProject;
        scriptName: string;
    }

    /** Default timeout for PHP script execution (ms) */
    const TIMEOUT = 30_000;

    const VENDOR_DIR = 'vendor/blade-lsp';

    const fileCache = new Map<string, string>();

    /**
     * Check if an error is retryable (transient)
     */
    function isRetryableError(error: unknown): boolean {
        if (TimeoutError.isInstance(error)) return true;
        if (SpawnError.isInstance(error)) return true;
        if (StartupError.isInstance(error)) return true;
        return false;
    }

    /**
     * Compute MD5 hash of content for file naming
     */
    function md5(content: string): string {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    /**
     * Ensure the vendor/blade-lsp directory exists
     * @throws VendorDirError if directory cannot be created
     */
    function ensureVendorDir(projectRoot: string): void {
        const vendorDir = path.join(projectRoot, VENDOR_DIR);
        try {
            if (!fs.existsSync(vendorDir)) {
                fs.mkdirSync(vendorDir, { recursive: true });
            }
        } catch (err) {
            throw new VendorDirError({
                path: vendorDir,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Write a PHP script to the vendor directory
     * @returns The relative path (for use with Docker)
     * @throws VendorDirError if directory cannot be created
     * @throws WriteError if script can't be written
     */
    function writePhpScript(projectRoot: string, content: string, scriptName: string): string {
        ensureVendorDir(projectRoot);

        const hash = md5(content);
        const fileName = `${scriptName}-${hash}.php`;
        const relativePath = `${VENDOR_DIR}/${fileName}`;
        const absolutePath = path.join(projectRoot, relativePath);

        if (fileCache.has(hash) && fs.existsSync(absolutePath)) {
            return relativePath;
        }

        try {
            fs.writeFileSync(absolutePath, content);
            fileCache.set(hash, relativePath);
            return relativePath;
        } catch (err) {
            throw new WriteError({
                path: absolutePath,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Build the PHP code by combining bootstrap and extract scripts
     */
    function buildPhpCode(bootstrapScript: string, extractScript: string, placeholder: string): string {
        const bootstrapContent = fs.readFileSync(bootstrapScript, 'utf-8');
        const extractContent = fs.readFileSync(extractScript, 'utf-8');

        const extractCode = extractContent
            .replace(/^<\?php\s*/, '') // Remove opening PHP tag
            .trim();

        // Inject script body into the bootstrap placeholder to produce one runnable file.
        return bootstrapContent.replace(placeholder, extractCode);
    }

    /**
     * Parse the raw stdout from a PHP process into a typed result.
     * Pure function — all error paths return NamedError instances.
     */
    function parseOutput<T>(stdout: string, stderr: string, markers: FrameworkConfig['outputMarkers']): T {
        if (stdout.includes(markers.STARTUP_ERROR)) {
            const errorMatch = stdout.match(new RegExp(`${markers.STARTUP_ERROR}: (.+)`));
            throw new StartupError({ message: errorMatch?.[1] || 'Unknown error' });
        }

        const startIdx = stdout.indexOf(markers.START);
        const endIdx = stdout.indexOf(markers.END);

        if (startIdx === -1 || endIdx === -1) {
            throw new OutputError({
                message: 'Output markers not found',
                stdout: stdout.substring(0, 500),
                stderr: stderr.substring(0, 500),
            });
        }

        const jsonOutput = stdout.substring(startIdx + markers.START.length, endIdx).trim();

        try {
            return JSON.parse(jsonOutput) as T;
        } catch (e) {
            throw new ParseError({
                message: e instanceof Error ? e.message : String(e),
                output: jsonOutput.substring(0, 500),
            });
        }
    }

    /**
     * Spawn a PHP child process, collect its output, and parse the result.
     *
     * Returns an `Effect` that:
     *   - Spawns the process and sets up a timeout
     *   - Collects stdout/stderr
     *   - On close, parses the output into `T`
     *   - On interruption or abort, kills the process with SIGTERM
     *
     * Error channel: `ExecuteError` (TimeoutError | StartupError | OutputError | ParseError | SpawnError)
     */
    function executePhp<T>(
        project: Project.AnyProject,
        scriptPath: string,
        scriptName: string,
        timeout: number,
        markers: FrameworkConfig['outputMarkers'],
    ): Effect.Effect<T, ExecuteError> {
        return Effect.async<T, ExecuteError>((resume, signal) => {
            let stdout = '';
            let stderr = '';
            let proc: ChildProcess;

            const command = project.phpCommand[0];
            const args = [...project.phpCommand.slice(1), scriptPath];

            try {
                proc = spawn(command, args, {
                    cwd: project.root,
                    env: {
                        ...process.env,
                        // Xdebug can write extra output that breaks marker-based JSON parsing.
                        XDEBUG_MODE: 'off',
                    },
                });
            } catch (err) {
                resume(
                    Effect.fail(
                        new SpawnError({
                            command: project.phpCommand.join(' '),
                            message: err instanceof Error ? err.message : String(err),
                        }),
                    ),
                );
                return;
            }

            // Kill on timeout
            const timeoutId = setTimeout(() => {
                proc.kill('SIGTERM');
                resume(Effect.fail(new TimeoutError({ timeoutMs: timeout, scriptName })));
            }, timeout);

            // Kill on fiber interruption
            signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                proc.kill('SIGTERM');
            });

            proc.stdout!.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr!.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', () => {
                clearTimeout(timeoutId);
                if (signal.aborted) return;

                try {
                    resume(Effect.succeed(parseOutput<T>(stdout, stderr, markers)));
                } catch (error) {
                    resume(Effect.fail(error as ExecuteError));
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timeoutId);
                resume(Effect.fail(new SpawnError({ command: project.phpCommand.join(' '), message: err.message })));
            });
        });
    }

    /**
     * Run a PHP script in the context of a Laravel or Jigsaw project.
     * Uses file-based execution for Docker compatibility.
     *
     * Internally constructs an Effect pipeline with retry
     * (1 retry, 1s exponential backoff, only for transient errors),
     * then runs it as a Promise at the boundary.
     */
    export async function runScript<T>(options: Options): Promise<T> {
        const { project, scriptName } = options;
        const config = FRAMEWORK_CONFIGS[project.type];

        const effect = Effect.gen(function* () {
            const scriptsDir = path.join(__dirname, '..', '..', 'scripts', config.scriptsSubdir);
            const bootstrapScript = path.join(scriptsDir, 'bootstrap.php');
            const extractScript = path.join(scriptsDir, `${scriptName}.php`);

            if (!fs.existsSync(bootstrapScript)) {
                return yield* Effect.fail(new ScriptNotFoundError({ script: 'bootstrap', path: bootstrapScript }));
            }

            if (!fs.existsSync(extractScript)) {
                return yield* Effect.fail(new ScriptNotFoundError({ script: scriptName, path: extractScript }));
            }

            const phpCode = buildPhpCode(bootstrapScript, extractScript, config.placeholder);

            const relativeScriptPath = yield* Effect.try({
                try: () => writePhpScript(project.root, phpCode, scriptName),
                catch: (error) => error as InstanceType<typeof VendorDirError | typeof WriteError>,
            });

            return yield* executePhp<T>(project, relativeScriptPath, scriptName, TIMEOUT, config.outputMarkers);
        });

        // Retry once on transient errors with 1s backoff
        const withRetry = effect.pipe(
            Effect.retry({
                times: 1,
                while: isRetryableError,
                schedule: Schedule.exponential('1 seconds'),
            }),
        );

        return Effect.runPromise(withRetry);
    }
}

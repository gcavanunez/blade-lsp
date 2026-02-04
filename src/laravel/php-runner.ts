import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import z from 'zod';
import { NamedError } from '../utils/error';
import { defer } from '../utils/defer';
import { retry, RetryOptions } from '../utils/retry';
import { LaravelProject } from './project';

export namespace PhpRunner {
  // ─── Errors ────────────────────────────────────────────────────────────────

  export const ScriptNotFoundError = NamedError.create(
    'PhpRunnerScriptNotFoundError',
    z.object({
      script: z.string(),
      path: z.string(),
    })
  );

  export const VendorDirError = NamedError.create(
    'PhpRunnerVendorDirError',
    z.object({
      path: z.string(),
      message: z.string(),
    })
  );

  export const WriteError = NamedError.create(
    'PhpRunnerWriteError',
    z.object({
      path: z.string(),
      message: z.string(),
    })
  );

  export const TimeoutError = NamedError.create(
    'PhpRunnerTimeoutError',
    z.object({
      timeoutMs: z.number(),
      scriptName: z.string(),
    })
  );

  export const StartupError = NamedError.create(
    'PhpRunnerStartupError',
    z.object({
      message: z.string(),
    })
  );

  export const OutputError = NamedError.create(
    'PhpRunnerOutputError',
    z.object({
      message: z.string(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
    })
  );

  export const ParseError = NamedError.create(
    'PhpRunnerParseError',
    z.object({
      message: z.string(),
      output: z.string().optional(),
    })
  );

  export const SpawnError = NamedError.create(
    'PhpRunnerSpawnError',
    z.object({
      command: z.string(),
      message: z.string(),
    })
  );

  // ─── Types ─────────────────────────────────────────────────────────────────

  export interface Options {
    project: LaravelProject;
    scriptName: string;
    timeout?: number;
    retry?: RetryOptions;
  }

  // Output markers used by bootstrap script
  const OUTPUT_MARKERS = {
    START: '__BLADE_LSP_START_OUTPUT__',
    END: '__BLADE_LSP_END_OUTPUT__',
    STARTUP_ERROR: '__BLADE_LSP_STARTUP_ERROR__',
  };

  // Directory inside vendor where we write PHP scripts
  const VENDOR_DIR = 'vendor/blade-lsp';

  // Cache of written files to avoid rewriting identical scripts
  const fileCache = new Map<string, string>();

  /**
   * Check if an error is retryable (transient)
   */
  function isRetryableError(error: unknown): boolean {
    // Timeout and spawn errors are potentially retryable
    if (TimeoutError.isInstance(error)) return true;
    if (SpawnError.isInstance(error)) return true;
    // Startup errors might be transient (Laravel bootstrapping)
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
   * @throws WriteError if script cannot be written
   */
  function writePhpScript(projectRoot: string, content: string, scriptName: string): string {
    ensureVendorDir(projectRoot);

    const hash = md5(content);
    const fileName = `${scriptName}-${hash}.php`;
    const relativePath = `${VENDOR_DIR}/${fileName}`;
    const absolutePath = path.join(projectRoot, relativePath);

    // Check cache first
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
  function buildPhpCode(bootstrapScript: string, extractScript: string): string {
    const bootstrapContent = fs.readFileSync(bootstrapScript, 'utf-8');
    const extractContent = fs.readFileSync(extractScript, 'utf-8');

    const extractCode = extractContent
      .replace(/^<\?php\s*/, '') // Remove opening PHP tag
      .trim();

    return bootstrapContent.replace('__BLADE_LSP_OUTPUT__;', extractCode);
  }

  /**
   * Execute PHP and parse the output
   * @throws TimeoutError, StartupError, OutputError, ParseError, SpawnError
   */
  function executePhp<T>(
    project: LaravelProject,
    scriptPath: string,
    scriptName: string,
    timeout: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const command = project.phpCommand[0];
      const args = [...project.phpCommand.slice(1), scriptPath];

      const proc = spawn(command, args, {
        cwd: project.root,
        env: {
          ...process.env,
          XDEBUG_MODE: 'off',
        },
      });

      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        reject(new TimeoutError({ timeoutMs: timeout, scriptName }));
      }, timeout);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', () => {
        clearTimeout(timeoutId);
        if (killed) return;

        // Check for startup error
        if (stdout.includes(OUTPUT_MARKERS.STARTUP_ERROR)) {
          const errorMatch = stdout.match(new RegExp(`${OUTPUT_MARKERS.STARTUP_ERROR}: (.+)`));
          reject(new StartupError({ message: errorMatch?.[1] || 'Unknown error' }));
          return;
        }

        // Extract output between markers
        const startIdx = stdout.indexOf(OUTPUT_MARKERS.START);
        const endIdx = stdout.indexOf(OUTPUT_MARKERS.END);

        if (startIdx === -1 || endIdx === -1) {
          reject(
            new OutputError({
              message: 'Output markers not found',
              stdout: stdout.substring(0, 500),
              stderr: stderr.substring(0, 500),
            })
          );
          return;
        }

        const jsonOutput = stdout.substring(startIdx + OUTPUT_MARKERS.START.length, endIdx).trim();

        try {
          resolve(JSON.parse(jsonOutput) as T);
        } catch (e) {
          reject(
            new ParseError({
              message: e instanceof Error ? e.message : String(e),
              output: jsonOutput.substring(0, 500),
            })
          );
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new SpawnError({ command: project.phpCommand.join(' '), message: err.message }));
      });
    });
  }

  /**
   * Run a PHP script in the context of a Laravel project.
   * Uses file-based execution for Docker compatibility.
   *
   * @throws ScriptNotFoundError if scripts don't exist
   * @throws VendorDirError if vendor dir can't be created
   * @throws WriteError if script can't be written
   * @throws TimeoutError if script times out
   * @throws StartupError if Laravel fails to bootstrap
   * @throws OutputError if output is invalid
   * @throws ParseError if JSON parsing fails
   * @throws SpawnError if process can't be spawned
   */
  export async function runScript<T>(options: Options): Promise<T> {
    const { project, scriptName, timeout = 30000, retry: retryOpts } = options;

    // Get the script paths (from the LSP's bundled scripts)
    const scriptsDir = path.join(__dirname, '..', '..', 'scripts');
    const bootstrapScript = path.join(scriptsDir, 'bootstrap-laravel.php');
    const extractScript = path.join(scriptsDir, `${scriptName}.php`);

    // Verify scripts exist
    if (!fs.existsSync(bootstrapScript)) {
      throw new ScriptNotFoundError({ script: 'bootstrap', path: bootstrapScript });
    }

    if (!fs.existsSync(extractScript)) {
      throw new ScriptNotFoundError({ script: scriptName, path: extractScript });
    }

    // Build the combined PHP code
    const phpCode = buildPhpCode(bootstrapScript, extractScript);

    // Write to vendor/blade-lsp/<hash>.php
    const relativeScriptPath = writePhpScript(project.root, phpCode, scriptName);

    // Execute with optional retry
    const execute = () => executePhp<T>(project, relativeScriptPath, scriptName, timeout);

    if (retryOpts) {
      return retry(execute, {
        ...retryOpts,
        retryIf: retryOpts.retryIf ?? isRetryableError,
      });
    }

    return execute();
  }

  /**
   * Run via artisan tinker (useful for debugging)
   *
   * @throws TimeoutError if command times out
   * @throws OutputError if no JSON found in output
   * @throws ParseError if JSON parsing fails
   * @throws SpawnError if process can't be spawned
   */
  export async function runViaTinker<T>(
    project: LaravelProject,
    code: string,
    timeout = 30000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const command = project.phpCommand[0];
      const args = [...project.phpCommand.slice(1), 'artisan', 'tinker', '--execute', code];

      const proc = spawn(command, args, {
        cwd: project.root,
        env: {
          ...process.env,
          XDEBUG_MODE: 'off',
        },
      });

      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        reject(new TimeoutError({ timeoutMs: timeout, scriptName: 'tinker' }));
      }, timeout);

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', () => {
        clearTimeout(timeoutId);
        if (killed) return;

        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (!jsonMatch) {
            reject(
              new OutputError({
                message: 'No JSON found in tinker output',
                stdout: stdout.substring(0, 500),
                stderr: stderr.substring(0, 500),
              })
            );
            return;
          }

          resolve(JSON.parse(jsonMatch[0]) as T);
        } catch (e) {
          reject(
            new ParseError({
              message: e instanceof Error ? e.message : String(e),
              output: stdout.substring(0, 500),
            })
          );
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new SpawnError({ command: project.phpCommand.join(' '), message: err.message }));
      });
    });
  }

  /**
   * Run a one-shot PHP script that is cleaned up after execution.
   * Unlike runScript, this doesn't cache the script file.
   * Useful for dynamic queries or debugging.
   *
   * @example
   * ```ts
   * const result = await PhpRunner.runOnce<string[]>({
   *   project,
   *   scriptName: 'extract-routes',
   *   cleanup: true, // delete script after execution
   * });
   * ```
   */
  export async function runOnce<T>(options: Options & { cleanup?: boolean }): Promise<T> {
    const { project, scriptName, timeout = 30000, cleanup = true } = options;

    const scriptsDir = path.join(__dirname, '..', '..', 'scripts');
    const bootstrapScript = path.join(scriptsDir, 'bootstrap-laravel.php');
    const extractScript = path.join(scriptsDir, `${scriptName}.php`);

    if (!fs.existsSync(bootstrapScript)) {
      throw new ScriptNotFoundError({ script: 'bootstrap', path: bootstrapScript });
    }

    if (!fs.existsSync(extractScript)) {
      throw new ScriptNotFoundError({ script: scriptName, path: extractScript });
    }

    const phpCode = buildPhpCode(bootstrapScript, extractScript);

    // Write with unique timestamp to avoid cache
    const timestamp = Date.now();
    const hash = md5(phpCode + timestamp);
    const fileName = `${scriptName}-${hash}.php`;
    const relativePath = `${VENDOR_DIR}/${fileName}`;
    const absolutePath = path.join(project.root, relativePath);

    ensureVendorDir(project.root);
    fs.writeFileSync(absolutePath, phpCode);

    // Clean up script file after execution (even on error)
    using _ = cleanup
      ? defer(() => {
          try {
            fs.unlinkSync(absolutePath);
          } catch {
            // Ignore cleanup errors
          }
        })
      : defer(() => {}); // No-op if cleanup disabled

    return executePhp<T>(project, relativePath, scriptName, timeout);
  }

  /**
   * Clear the file cache (useful for testing)
   */
  export function clearCache(): void {
    fileCache.clear();
  }
}

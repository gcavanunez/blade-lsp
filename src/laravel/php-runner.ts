import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { LaravelProject } from './project';

export interface PhpRunnerOptions {
  project: LaravelProject;
  scriptName: string;
  timeout?: number;
}

export interface PhpRunnerResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Output markers used by bootstrap script
const OUTPUT_MARKERS = {
  START: '__BLADE_LSP_START_OUTPUT__',
  END: '__BLADE_LSP_END_OUTPUT__',
  STARTUP_ERROR: '__BLADE_LSP_STARTUP_ERROR__',
};

/**
 * Run a PHP script in the context of a Laravel project
 */
export async function runPhpScript<T>(options: PhpRunnerOptions): Promise<PhpRunnerResult<T>> {
  const { project, scriptName, timeout = 30000 } = options;

  // Get the script path
  const scriptsDir = path.join(__dirname, '..', '..', 'scripts');
  const bootstrapScript = path.join(scriptsDir, 'bootstrap-laravel.php');
  const extractScript = path.join(scriptsDir, `${scriptName}.php`);

  // Verify scripts exist
  if (!fs.existsSync(bootstrapScript)) {
    return {
      success: false,
      error: `Bootstrap script not found: ${bootstrapScript}`,
    };
  }

  if (!fs.existsSync(extractScript)) {
    return {
      success: false,
      error: `Extract script not found: ${extractScript}`,
    };
  }

  // Build the PHP command
  // We inject the script content into the bootstrap template
  // For Docker, use the container workdir instead of host path
  const projectRoot = project.phpDockerWorkdir || project.root;
  const phpCode = buildPhpCode(bootstrapScript, extractScript, projectRoot);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    // Determine command and args based on whether we have a phpCommand array
    let command: string;
    let args: string[];
    
    if (project.phpCommand && project.phpCommand.length > 0) {
      // For Docker/custom commands: ['docker', 'compose', 'exec', 'app', 'php']
      // We need to append '-r' and the code to the command
      command = project.phpCommand[0];
      args = [...project.phpCommand.slice(1), '-r', phpCode];
    } else {
      // Standard PHP binary
      command = project.phpPath;
      args = ['-r', phpCode];
    }

    const proc = spawn(command, args, {
      cwd: project.root,
      env: {
        ...process.env,
        // Disable xdebug for performance
        XDEBUG_MODE: 'off',
      },
    });

    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      resolve({
        success: false,
        error: `PHP script timed out after ${timeout}ms`,
      });
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      if (killed) {
        return;
      }

      // Check for startup error
      if (stdout.includes(OUTPUT_MARKERS.STARTUP_ERROR)) {
        const errorMatch = stdout.match(new RegExp(`${OUTPUT_MARKERS.STARTUP_ERROR}: (.+)`));
        resolve({
          success: false,
          error: `Laravel startup error: ${errorMatch?.[1] || 'Unknown error'}`,
        });
        return;
      }

      // Extract output between markers
      const startIdx = stdout.indexOf(OUTPUT_MARKERS.START);
      const endIdx = stdout.indexOf(OUTPUT_MARKERS.END);

      if (startIdx === -1 || endIdx === -1) {
        resolve({
          success: false,
          error: `Invalid PHP output. stderr: ${stderr}. stdout: ${stdout.substring(0, 500)}`,
        });
        return;
      }

      const jsonOutput = stdout.substring(startIdx + OUTPUT_MARKERS.START.length, endIdx).trim();

      try {
        const data = JSON.parse(jsonOutput) as T;
        resolve({
          success: true,
          data,
        });
      } catch (e) {
        resolve({
          success: false,
          error: `Failed to parse JSON output: ${e}. Output: ${jsonOutput.substring(0, 500)}`,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: `Failed to spawn PHP process: ${err.message}`,
      });
    });
  });
}

/**
 * Build the PHP code to execute
 * This creates a self-contained script that bootstraps Laravel and runs the extract script
 */
function buildPhpCode(bootstrapScript: string, extractScript: string, projectRoot: string): string {
  // Read the scripts
  const bootstrapContent = fs.readFileSync(bootstrapScript, 'utf-8');
  const extractContent = fs.readFileSync(extractScript, 'utf-8');

  // The bootstrap script has a placeholder for the output code
  // We replace it with our extract script
  const extractCode = extractContent
    .replace(/^<\?php\s*/, '') // Remove opening PHP tag
    .trim();

  // Escape the project root for PHP string (handle backslashes on Windows)
  const escapedProjectRoot = projectRoot.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // Replace placeholders in bootstrap:
  // - __BLADE_LSP_PROJECT_ROOT__ -> actual project path
  // - __BLADE_LSP_OUTPUT__ -> the extraction script code
  const finalCode = bootstrapContent
    .replace(/^<\?php\s*/, '') // Remove opening PHP tag for -r execution
    .replace(/'__BLADE_LSP_PROJECT_ROOT__'/g, `'${escapedProjectRoot}'`)
    .replace('__BLADE_LSP_OUTPUT__;', extractCode);

  return finalCode;
}

/**
 * Alternative: Run via artisan tinker (useful for debugging)
 */
export async function runViaTinker<T>(
  project: LaravelProject,
  code: string,
  timeout = 30000
): Promise<PhpRunnerResult<T>> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(project.phpPath, ['artisan', 'tinker', '--execute', code], {
      cwd: project.root,
      env: {
        ...process.env,
        XDEBUG_MODE: 'off',
      },
    });

    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      resolve({
        success: false,
        error: `Tinker command timed out after ${timeout}ms`,
      });
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', () => {
      clearTimeout(timeoutId);

      if (killed) {
        return;
      }

      try {
        // Tinker may output extra info, try to find JSON
        const jsonMatch = stdout.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!jsonMatch) {
          resolve({
            success: false,
            error: `No JSON found in tinker output. stdout: ${stdout}, stderr: ${stderr}`,
          });
          return;
        }

        const data = JSON.parse(jsonMatch[0]) as T;
        resolve({
          success: true,
          data,
        });
      } catch (e) {
        resolve({
          success: false,
          error: `Failed to parse tinker output: ${e}`,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: `Failed to spawn tinker: ${err.message}`,
      });
    });
  });
}

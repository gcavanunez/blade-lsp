import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface LaravelProject {
  root: string;
  artisanPath: string;
  composerPath: string;
  phpPath: string;
  phpCommand?: string[];      // For Docker etc: ['docker', 'compose', 'exec', 'app', 'php']
  phpDockerWorkdir?: string;  // Working directory inside Docker container
  vendorPath: string;
  viewsPath: string;
  componentsPath: string;
}

export interface PhpOptions {
  phpPath?: string;
  phpCommand?: string[];
  phpDockerWorkdir?: string;
}

/**
 * Detect if the given directory is a Laravel project
 * @param workspaceRoot - The workspace root path
 * @param options - Optional PHP configuration (path or command)
 */
export function detectLaravelProject(workspaceRoot: string, options: PhpOptions = {}): LaravelProject | null {
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

  // Handle PHP command (for Docker, etc.)
  if (options.phpCommand && options.phpCommand.length > 0) {
    // Use the provided command array - first element is the binary, rest are args
    return {
      root: workspaceRoot,
      artisanPath,
      composerPath,
      phpPath: options.phpCommand[0], // First element is the command
      phpCommand: options.phpCommand,  // Full command array
      phpDockerWorkdir: options.phpDockerWorkdir, // Path inside container
      vendorPath,
      viewsPath,
      componentsPath,
    };
  }

  // Find PHP binary - use custom path if provided, otherwise auto-detect
  let phpPath: string | null = null;
  
  if (options.phpPath) {
    // Verify the custom PHP path exists
    if (fs.existsSync(options.phpPath)) {
      phpPath = options.phpPath;
    } else {
      console.error(`[Laravel] Custom PHP path does not exist: ${options.phpPath}`);
      // Fall back to auto-detection
      phpPath = findPhpPath();
    }
  } else {
    phpPath = findPhpPath();
  }
  
  if (!phpPath) {
    console.error('[Laravel] No PHP binary found');
    return null;
  }

  return {
    root: workspaceRoot,
    artisanPath,
    composerPath,
    phpPath,
    vendorPath,
    viewsPath,
    componentsPath,
  };
}

/**
 * Find the PHP binary path
 */
function findPhpPath(): string | null {
  const phpCommands = ['php', 'php8.3', 'php8.2', 'php8.1', 'php8.0'];

  for (const phpCmd of phpCommands) {
    try {
      const result = execSync(`which ${phpCmd}`, { encoding: 'utf-8' }).trim();
      if (result) {
        return result;
      }
    } catch {
      // Command not found, try next
    }
  }

  // Try common paths
  const commonPaths = [
    '/usr/bin/php',
    '/usr/local/bin/php',
    '/opt/homebrew/bin/php',
  ];

  for (const phpPath of commonPaths) {
    if (fs.existsSync(phpPath)) {
      return phpPath;
    }
  }

  return null;
}

/**
 * Validate that the Laravel project can be bootstrapped
 */
export async function validateLaravelProject(project: LaravelProject): Promise<boolean> {
  const bootstrapPath = path.join(project.root, 'bootstrap', 'app.php');
  const autoloadPath = path.join(project.vendorPath, 'autoload.php');

  return fs.existsSync(bootstrapPath) && fs.existsSync(autoloadPath);
}

/**
 * Get Laravel version from composer.lock or installed packages
 */
export function getLaravelVersion(project: LaravelProject): string | null {
  const lockPath = path.join(project.root, 'composer.lock');
  
  if (!fs.existsSync(lockPath)) {
    return null;
  }

  try {
    const lockContent = fs.readFileSync(lockPath, 'utf-8');
    const lock = JSON.parse(lockContent);
    
    const laravelPackage = lock.packages?.find(
      (pkg: { name: string }) => pkg.name === 'laravel/framework'
    );
    
    return laravelPackage?.version || null;
  } catch {
    return null;
  }
}

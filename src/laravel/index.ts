/**
 * Laravel project integration module
 * 
 * Provides dynamic extraction of views, components, and directives
 * from a Laravel project via PHP script execution.
 */

export { LaravelProject, detectLaravelProject, validateLaravelProject, getLaravelVersion } from './project';
export { runPhpScript, runViaTinker, PhpRunnerOptions, PhpRunnerResult } from './php-runner';
export { ViewRepository, viewRepository } from './repositories/views';
export { ComponentRepository, componentRepository } from './repositories/components';
export { DirectiveRepository, directiveRepository } from './repositories/directives';
export * from './types';

import { LaravelProject, detectLaravelProject, validateLaravelProject } from './project';
import { viewRepository } from './repositories/views';
import { componentRepository } from './repositories/components';
import { directiveRepository } from './repositories/directives';

/**
 * Options for Laravel manager initialization
 */
export interface LaravelManagerOptions {
  phpPath?: string;           // Path to PHP binary
  phpCommand?: string[];      // Command array for Docker etc
  phpDockerWorkdir?: string;  // Working directory inside Docker container
}

/**
 * Laravel Project Manager
 * Coordinates initialization and refreshing of all repositories
 */
export class LaravelManager {
  private project: LaravelProject | null = null;
  private initialized: boolean = false;
  private initPromise: Promise<boolean> | null = null;

  /**
   * Initialize the Laravel integration for a workspace
   */
  async initialize(workspaceRoot: string, options: LaravelManagerOptions = {}): Promise<boolean> {
    // Return existing initialization promise if in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize(workspaceRoot, options);
    const result = await this.initPromise;
    this.initPromise = null;
    return result;
  }

  private async doInitialize(workspaceRoot: string, options: LaravelManagerOptions): Promise<boolean> {
    console.log('[LaravelManager] Initializing for workspace:', workspaceRoot);

    // Detect Laravel project with optional custom PHP path/command
    this.project = detectLaravelProject(workspaceRoot, {
      phpPath: options.phpPath,
      phpCommand: options.phpCommand,
      phpDockerWorkdir: options.phpDockerWorkdir,
    });
    
    if (!this.project) {
      console.log('[LaravelManager] No Laravel project detected');
      return false;
    }

    console.log('[LaravelManager] Laravel project detected at:', this.project.root);
    if (this.project.phpCommand) {
      console.log('[LaravelManager] Using PHP command:', this.project.phpCommand.join(' '));
    } else {
      console.log('[LaravelManager] Using PHP:', this.project.phpPath);
    }

    // Validate the project can be bootstrapped
    const valid = await validateLaravelProject(this.project);
    if (!valid) {
      console.log('[LaravelManager] Laravel project validation failed');
      this.project = null;
      return false;
    }

    // Initialize repositories
    viewRepository.initialize(this.project);
    componentRepository.initialize(this.project);
    directiveRepository.initialize(this.project);

    this.initialized = true;
    console.log('[LaravelManager] Initialization complete');

    // Trigger initial refresh in background
    this.refreshAll().catch(err => {
      console.error('[LaravelManager] Initial refresh failed:', err);
    });

    return true;
  }

  /**
   * Refresh all repositories
   */
  async refreshAll(): Promise<void> {
    if (!this.initialized || !this.project) {
      return;
    }

    console.log('[LaravelManager] Refreshing all repositories...');

    // Run all refreshes in parallel
    const results = await Promise.allSettled([
      viewRepository.refresh(),
      componentRepository.refresh(),
      directiveRepository.refresh(),
    ]);

    const [viewResult, componentResult, directiveResult] = results;

    console.log('[LaravelManager] Refresh complete:', {
      views: viewResult.status === 'fulfilled' ? viewResult.value : false,
      components: componentResult.status === 'fulfilled' ? componentResult.value : false,
      directives: directiveResult.status === 'fulfilled' ? directiveResult.value : false,
    });
  }

  /**
   * Check if Laravel integration is available
   */
  isAvailable(): boolean {
    return this.initialized && this.project !== null;
  }

  /**
   * Get the current Laravel project
   */
  getProject(): LaravelProject | null {
    return this.project;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    viewRepository.clear();
    componentRepository.clear();
    directiveRepository.clear();
    this.project = null;
    this.initialized = false;
  }
}

// Singleton instance
export const laravelManager = new LaravelManager();

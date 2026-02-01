import { LaravelProject } from '../project';
import { runPhpScript } from '../php-runner';
import { CustomDirective } from '../types';

export class DirectiveRepository {
  private items: CustomDirective[] = [];
  private lastUpdated: number = 0;
  private isRefreshing: boolean = false;
  private project: LaravelProject | null = null;

  /**
   * Initialize the repository with a Laravel project
   */
  initialize(project: LaravelProject): void {
    this.project = project;
  }

  /**
   * Refresh custom directives from the Laravel project
   */
  async refresh(): Promise<boolean> {
    if (!this.project) {
      return false;
    }

    if (this.isRefreshing) {
      return false;
    }

    this.isRefreshing = true;

    try {
      const result = await runPhpScript<CustomDirective[]>({
        project: this.project,
        scriptName: 'extract-directives',
        timeout: 30000,
      });

      if (result.success && result.data) {
        this.items = result.data;
        this.lastUpdated = Date.now();
        return true;
      } else {
        console.error('[DirectiveRepository] Failed to refresh directives:', result.error);
        return false;
      }
    } catch (error) {
      console.error('[DirectiveRepository] Error refreshing directives:', error);
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Get all custom directives
   */
  getItems(): CustomDirective[] {
    return this.items;
  }

  /**
   * Find a custom directive by name
   */
  find(name: string): CustomDirective | undefined {
    return this.items.find(d => d.name === name);
  }

  /**
   * Check if a directive name exists
   */
  has(name: string): boolean {
    return this.items.some(d => d.name === name);
  }

  /**
   * Search directives by partial name match
   */
  search(query: string): CustomDirective[] {
    const lowerQuery = query.toLowerCase();
    return this.items.filter(d => d.name.toLowerCase().includes(lowerQuery));
  }

  /**
   * Get directives that accept parameters
   */
  getWithParams(): CustomDirective[] {
    return this.items.filter(d => d.hasParams);
  }

  /**
   * Get directives without parameters
   */
  getWithoutParams(): CustomDirective[] {
    return this.items.filter(d => !d.hasParams);
  }

  /**
   * Check if data is stale (older than specified ms)
   */
  isStale(maxAgeMs: number = 60000): boolean {
    return Date.now() - this.lastUpdated > maxAgeMs;
  }

  /**
   * Get last update timestamp
   */
  getLastUpdated(): number {
    return this.lastUpdated;
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.items = [];
    this.lastUpdated = 0;
  }
}

// Singleton instance
export const directiveRepository = new DirectiveRepository();

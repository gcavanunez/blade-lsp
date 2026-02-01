import { LaravelProject } from '../project';
import { runPhpScript } from '../php-runner';
import { ComponentItem, ComponentsResult } from '../types';

export class ComponentRepository {
  private items: ComponentItem[] = [];
  private prefixes: string[] = [];
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
   * Refresh components from the Laravel project
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
      const result = await runPhpScript<ComponentsResult>({
        project: this.project,
        scriptName: 'extract-components',
        timeout: 30000,
      });

      if (result.success && result.data) {
        this.items = result.data.components;
        this.prefixes = result.data.prefixes;
        this.lastUpdated = Date.now();
        return true;
      } else {
        console.error('[ComponentRepository] Failed to refresh components:', result.error);
        return false;
      }
    } catch (error) {
      console.error('[ComponentRepository] Error refreshing components:', error);
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Get all components
   */
  getItems(): ComponentItem[] {
    return this.items;
  }

  /**
   * Get all component prefixes (e.g., ['flux', 'livewire'])
   */
  getPrefixes(): string[] {
    return this.prefixes;
  }

  /**
   * Get local (non-vendor) components only
   */
  getLocalItems(): ComponentItem[] {
    return this.items.filter(c => !c.isVendor);
  }

  /**
   * Get vendor components only
   */
  getVendorItems(): ComponentItem[] {
    return this.items.filter(c => c.isVendor);
  }

  /**
   * Find a component by key
   */
  find(key: string): ComponentItem | undefined {
    return this.items.find(c => c.key === key);
  }

  /**
   * Find a component by full tag (e.g., 'x-button', 'flux:button')
   */
  findByTag(tag: string): ComponentItem | undefined {
    return this.items.find(c => c.fullTag === tag);
  }

  /**
   * Search components by partial key match
   */
  search(query: string): ComponentItem[] {
    const lowerQuery = query.toLowerCase();
    return this.items.filter(c => 
      c.key.toLowerCase().includes(lowerQuery) ||
      c.fullTag.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get components by type
   */
  getByType(type: ComponentItem['type']): ComponentItem[] {
    return this.items.filter(c => c.type === type);
  }

  /**
   * Get components that start with a prefix (e.g., 'flux::')
   */
  getByPrefix(prefix: string): ComponentItem[] {
    return this.items.filter(c => c.key.startsWith(prefix));
  }

  /**
   * Get all x-* components (standard Blade components)
   */
  getStandardComponents(): ComponentItem[] {
    return this.items.filter(c => c.fullTag.startsWith('x-'));
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
    this.prefixes = [];
    this.lastUpdated = 0;
  }
}

// Singleton instance
export const componentRepository = new ComponentRepository();

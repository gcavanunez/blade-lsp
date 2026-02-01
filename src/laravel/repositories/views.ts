import { LaravelProject } from '../project';
import { runPhpScript } from '../php-runner';
import { ViewItem } from '../types';

export class ViewRepository {
  private items: ViewItem[] = [];
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
   * Refresh views from the Laravel project
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
      const result = await runPhpScript<ViewItem[]>({
        project: this.project,
        scriptName: 'extract-views',
        timeout: 30000,
      });

      if (result.success && result.data) {
        this.items = result.data;
        this.lastUpdated = Date.now();
        return true;
      } else {
        console.error('[ViewRepository] Failed to refresh views:', result.error);
        return false;
      }
    } catch (error) {
      console.error('[ViewRepository] Error refreshing views:', error);
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Get all views
   */
  getItems(): ViewItem[] {
    return this.items;
  }

  /**
   * Get local (non-vendor) views only
   */
  getLocalItems(): ViewItem[] {
    return this.items.filter(v => !v.isVendor);
  }

  /**
   * Get vendor views only
   */
  getVendorItems(): ViewItem[] {
    return this.items.filter(v => v.isVendor);
  }

  /**
   * Find a view by key
   */
  find(key: string): ViewItem | undefined {
    return this.items.find(v => v.key === key);
  }

  /**
   * Search views by partial key match
   */
  search(query: string): ViewItem[] {
    const lowerQuery = query.toLowerCase();
    return this.items.filter(v => v.key.toLowerCase().includes(lowerQuery));
  }

  /**
   * Get views that match a prefix (e.g., 'layouts.' for layout views)
   */
  getByPrefix(prefix: string): ViewItem[] {
    return this.items.filter(v => v.key.startsWith(prefix));
  }

  /**
   * Get views by namespace
   */
  getByNamespace(namespace: string): ViewItem[] {
    return this.items.filter(v => v.namespace === namespace);
  }

  /**
   * Get all unique namespaces
   */
  getNamespaces(): string[] {
    const namespaces = new Set<string>();
    for (const item of this.items) {
      if (item.namespace) {
        namespaces.add(item.namespace);
      }
    }
    return Array.from(namespaces).sort();
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
export const viewRepository = new ViewRepository();

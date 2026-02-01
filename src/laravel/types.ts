/**
 * Types for Laravel project data extracted via PHP scripts
 */

export interface ViewItem {
  key: string;           // 'layouts.app' or 'mail::message'
  path: string;          // Relative path from project root
  isVendor: boolean;     // From vendor package
  namespace: string | null; // Package namespace if applicable
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  default: unknown;
}

export interface ComponentItem {
  key: string;           // 'button', 'alert', 'flux::button'
  fullTag: string;       // 'x-button', 'flux:button'
  path: string;          // Relative path from project root
  isVendor: boolean;     // From vendor package
  type: 'anonymous' | 'class' | 'alias' | 'anonymous-namespaced' | 'anonymous-path' | 'class-namespaced' | 'vendor';
  class?: string;        // Class name for class-based components
  props?: ComponentProp[] | string; // Array of props or @props() string
}

export interface ComponentsResult {
  components: ComponentItem[];
  prefixes: string[];    // e.g., ['flux', 'livewire']
}

export interface CustomDirective {
  name: string;          // 'datetime', 'money'
  hasParams: boolean;    // Whether it accepts parameters
  file: string | null;   // Where it's defined (relative path)
  line: number | null;   // Line number
}

export interface SectionInfo {
  yields: string[];      // @yield names in layout
  stacks: string[];      // @stack names in layout
}

/**
 * Livewire component info (attached to views)
 */
export interface LivewireInfo {
  props: LivewireProp[];
  files: string[];
}

export interface LivewireProp {
  name: string;
  type: string;
  hasDefaultValue: boolean;
  defaultValue: unknown;
}

/**
 * Extended view item that may include Livewire info
 */
export interface ExtendedViewItem extends ViewItem {
  livewire?: LivewireInfo;
}

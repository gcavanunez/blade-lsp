/**
 * Types for project data extracted via PHP scripts.
 *
 * Laravel shapes match the output of the upstream laravel/vs-code-extension
 * php-templates. Any derived fields (fullTag, namespace, etc.) are computed
 * on the TS side, not in the PHP scripts.
 */

export type FrameworkType = 'laravel' | 'jigsaw';

export interface ViewItem {
    key: string; // 'layouts.app' or 'mail::message'
    path: string; // Relative path from project root
    isVendor: boolean; // From vendor package
    type?: string; // Jigsaw: 'page' | 'component' | 'layout' | 'partial'
    livewire?: LivewireInfo; // Livewire component info if applicable
}

/**
 * Raw output from blade-components.php.
 * Components are keyed by their component key string.
 */
export interface ComponentsRawResult {
    components: Record<string, RawComponentData>;
    prefixes: string[];
}

export interface RawComponentData {
    isVendor: boolean;
    paths: string[];
    props: ComponentProp[] | string; // Array of props or @props() string
}

export interface ComponentProp {
    name: string;
    type: string;
    default: unknown;
}

/**
 * Normalized component item used throughout the TS codebase.
 * Derived from RawComponentData with key added.
 */
export interface ComponentItem {
    key: string; // 'button', 'alert', 'flux::button'
    path: string; // First path from paths array
    paths: string[]; // All paths
    isVendor: boolean;
    props: ComponentProp[] | string;
}

export interface ComponentsResult {
    components: ComponentItem[];
    prefixes: string[];
}

export interface CustomDirective {
    name: string; // 'datetime', 'money'
    hasParams: boolean; // Whether it accepts parameters
}

export interface SectionInfo {
    yields: string[]; // @yield names in layout
    stacks: string[]; // @stack names in layout
}

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

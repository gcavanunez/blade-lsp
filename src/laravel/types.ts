/**
 * Types for project data extracted via PHP scripts.
 *
 * Laravel shapes match the output of the upstream laravel/vs-code-extension
 * php-templates. Any derived fields (fullTag, namespace, etc.) are computed
 * on the TS side, not in the PHP scripts.
 */

export type FrameworkType = 'laravel' | 'jigsaw';

export type JigsawViewType = 'page' | 'component' | 'layout' | 'partial';

interface BaseViewItem {
    readonly key: string; // 'layouts.app' or 'mail::message'
    readonly path: string; // Relative path from project root
    readonly isVendor: boolean; // From vendor package
    readonly type?: JigsawViewType;
}

export interface StandardViewItem extends BaseViewItem {
    readonly livewire?: undefined;
}

export interface LivewireViewItem extends BaseViewItem {
    readonly livewire: LivewireInfo;
}

export type ViewItem = StandardViewItem | LivewireViewItem;

/**
 * Raw output from blade-components.php.
 * Components are keyed by their component key string.
 */
export interface ComponentsRawResult {
    readonly components: Record<string, RawComponentData>;
    readonly prefixes: readonly string[];
}

export interface RawComponentData {
    readonly isVendor: boolean;
    readonly paths: readonly string[];
    readonly props: readonly ComponentProp[] | string; // Array of props or @props() string
}

export interface ComponentProp {
    readonly name: string;
    readonly type: string;
    readonly default: unknown;
}

/**
 * Normalized component item used throughout the TS codebase.
 * Derived from RawComponentData with key added.
 */
export interface ComponentItem {
    readonly key: string; // 'button', 'alert', 'flux::button'
    readonly path: string; // First path from paths array
    readonly paths: readonly string[]; // All paths
    readonly isVendor: boolean;
    readonly props: readonly ComponentProp[] | string;
}

export interface ComponentsResult {
    readonly components: readonly ComponentItem[];
    readonly prefixes: readonly string[];
}

export interface CustomDirective {
    readonly name: string; // 'datetime', 'money'
    readonly hasParams: boolean; // Whether it accepts parameters
}

export interface SectionInfo {
    readonly yields: readonly string[]; // @yield names in layout
    readonly stacks: readonly string[]; // @stack names in layout
}

export interface LivewireInfo {
    readonly props: readonly LivewireProp[];
    readonly files: readonly string[];
}

interface BaseLivewireProp {
    readonly name: string;
    readonly type: string;
}

export interface DefaultedLivewireProp extends BaseLivewireProp {
    readonly hasDefaultValue: true;
    readonly defaultValue: unknown;
}

export interface RequiredLivewireProp extends BaseLivewireProp {
    readonly hasDefaultValue: false;
    readonly defaultValue?: never;
}

export type LivewireProp = DefaultedLivewireProp | RequiredLivewireProp;

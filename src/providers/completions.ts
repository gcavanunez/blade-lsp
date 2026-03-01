import {
    CompletionItem,
    CompletionItemKind,
    InsertTextFormat,
    MarkupKind,
    Position,
    Range,
    TextEdit,
} from 'vscode-languageserver/node';
import { Shared } from './shared';
import { ProjectFile } from './project-file';
import { COMPONENT_PARTIAL_MATCH_PATTERN, LIVEWIRE_PARTIAL_MATCH_PATTERN } from './patterns';
import { BladeDirectives } from '../directives';
import { BladeParser } from '../parser';
import { Laravel } from '../laravel/index';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';
import type { ViewItem, ComponentItem, CustomDirective } from '../laravel/types';
import { Components as ComponentsNs } from '../laravel/components';

export namespace Completions {
    export type ParsedProp = Shared.ParsedProp;
    export const parsePropsString = Shared.parsePropsString;

    type CompletionResolveKind = 'view' | 'component' | 'livewire';

    interface CompletionResolveData {
        kind: CompletionResolveKind;
        key: string;
        path: string;
    }

    export function createDirectiveItem(directive: BladeDirectives.Directive, prefix: string): CompletionItem {
        return {
            label: directive.name,
            kind: CompletionItemKind.Keyword,
            detail: directive.parameters || undefined,
            documentation: {
                kind: MarkupKind.Markdown,
                value: directive.description,
            },
            // Avoid duplicating the already-typed prefix in the inserted text.
            insertText: directive.snippet
                ? directive.snippet.slice(prefix.length)
                : directive.name.slice(prefix.length),
            insertTextFormat: directive.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
            sortText: directive.hasEndTag ? '0' + directive.name : '1' + directive.name,
        };
    }

    export function createCustomDirectiveItem(directive: CustomDirective, prefix: string): CompletionItem {
        const snippetText = directive.hasParams ? `@${directive.name}(\${1})` : `@${directive.name}`;

        return {
            label: `@${directive.name}`,
            kind: CompletionItemKind.Keyword,
            detail: 'Custom directive',
            documentation: {
                kind: MarkupKind.Markdown,
                value: `Custom Blade directive \`@${directive.name}\``,
            },
            insertText: snippetText.slice(prefix.length),
            insertTextFormat: directive.hasParams ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
            sortText: '2' + directive.name, // Custom directives sort after built-in
        };
    }

    export function getComponentCompletions(textBeforeCursor: string, position: Position): CompletionItem[] {
        const items: CompletionItem[] = [];

        const match = textBeforeCursor.match(COMPONENT_PARTIAL_MATCH_PATTERN);
        const partialName = match ? match[1] : 'x-';
        const matchedText = match ? match[0] : '<x-';
        const startCharacter = position.character - matchedText.length;

        const replaceRange = Range.create(Position.create(position.line, startCharacter), position);

        if (!Laravel.isAvailable()) {
            const staticComponents = ['x-button', 'x-alert', 'x-input', 'x-card'];
            return staticComponents.map((tag) => ({
                label: tag,
                kind: CompletionItemKind.Class,
                detail: 'Component',
                textEdit: TextEdit.replace(replaceRange, `<${tag}`),
            }));
        }

        const components = Components.getItems();

        for (const component of components) {
            const fullTag = ComponentsNs.keyToTag(component.key);

            if (fullTag.startsWith(partialName)) {
                items.push(createComponentCompletionItem(component, replaceRange, fullTag));
            }
        }

        return items;
    }

    export function getLivewireCompletions(textBeforeCursor: string, position: Position): CompletionItem[] {
        const items: CompletionItem[] = [];

        const match = textBeforeCursor.match(LIVEWIRE_PARTIAL_MATCH_PATTERN);
        const partialName = match ? match[1] : 'livewire:';
        const matchedText = match ? match[0] : '<livewire:';
        const startCharacter = position.character - matchedText.length;

        const replaceRange = Range.create(Position.create(position.line, startCharacter), position);

        if (!Laravel.isAvailable()) {
            return items;
        }

        const views = Views.getItems();
        const livewireViews = views.filter((v) => v.key.startsWith('livewire.'));

        for (const view of livewireViews) {
            const componentName = view.key.replace('livewire.', '').replace(/\./g, '.');
            const fullTag = `livewire:${componentName}`;

            if (fullTag.startsWith(partialName) || partialName === 'livewire:') {
                items.push(createLivewireCompletionItem(view, componentName, replaceRange));
            }
        }

        return items;
    }

    export function createLivewireCompletionItem(
        view: ViewItem,
        componentName: string,
        replaceRange: Range,
    ): CompletionItem {
        const fullTag = `livewire:${componentName}`;
        let documentation = `**${fullTag}**\n\n`;
        documentation += `**Type:** Livewire component\n\n`;
        documentation += `**Path:** \`${view.path}\`\n`;

        if (view.livewire?.props && view.livewire.props.length > 0) {
            documentation += '\n**Props:**\n\n';
            documentation += '| Name | Type |\n';
            documentation += '|------|------|\n';
            for (const prop of view.livewire.props) {
                documentation += `| \`${prop.name}\` | ${prop.type} |\n`;
            }
        }

        return {
            label: fullTag,
            kind: CompletionItemKind.Class,
            detail: view.isVendor ? 'Livewire component (vendor)' : 'Livewire component',
            documentation: {
                kind: MarkupKind.Markdown,
                value: documentation,
            },
            textEdit: TextEdit.replace(replaceRange, `<${fullTag}`),
            insertTextFormat: InsertTextFormat.PlainText,
            sortText: view.isVendor ? '1' + componentName : '0' + componentName,
            data: {
                kind: 'livewire',
                key: fullTag,
                path: view.path,
            } satisfies CompletionResolveData,
        };
    }

    export function createComponentCompletionItem(
        component: ComponentItem,
        replaceRange: Range,
        fullTagOverride?: string,
    ): CompletionItem {
        const fullTag = fullTagOverride ?? ComponentsNs.keyToTag(component.key);
        let documentation = `**${fullTag}**\n\n`;
        documentation += `Path: \`${component.path}\`\n`;

        if (component.props && typeof component.props === 'string') {
            documentation += `\n**Props:**\n\`\`\`php\n${component.props}\n\`\`\``;
        } else {
            const resolved = resolveComponentProps(component.props);
            if (resolved.length > 0) {
                documentation += '\n**Props:**\n';
                for (const prop of resolved) {
                    documentation += `- \`${prop.name}\`: ${prop.type} ${prop.required ? '(required)' : ''}\n`;
                }
            }
        }

        let snippet = `<${fullTag}`;
        if (component.props && Array.isArray(component.props)) {
            const requiredProps = component.props.filter((p) => p.default === null || p.default === undefined);
            if (requiredProps.length > 0) {
                const propsSnippet = requiredProps.map((p, i) => `:${p.name}="\${${i + 1}}"`).join(' ');
                snippet = `<${fullTag} ${propsSnippet}`;
            }
        }

        return {
            label: fullTag,
            kind: CompletionItemKind.Class,
            detail: component.isVendor ? `Component (vendor)` : `Component`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: documentation,
            },
            textEdit: TextEdit.replace(replaceRange, snippet),
            insertTextFormat: InsertTextFormat.Snippet,
            sortText: component.isVendor ? '1' + component.key : '0' + component.key,
            data: {
                kind: 'component',
                key: fullTag,
                path: component.path,
            } satisfies CompletionResolveData,
        };
    }

    export function getLaravelHelperCompletions(): CompletionItem[] {
        const helpers = [
            { name: '$errors', description: 'Validation errors bag', snippet: "\\$errors->first('${1:field}')" },
            { name: 'route', description: 'Generate URL for named route', snippet: "route('${1:name}')" },
            { name: 'url', description: 'Generate URL for path', snippet: "url('${1:path}')" },
            { name: 'asset', description: 'Generate URL for asset', snippet: "asset('${1:path}')" },
            { name: 'mix', description: 'Get versioned Mix file path', snippet: "mix('${1:path}')" },
            { name: 'config', description: 'Get configuration value', snippet: "config('${1:key}')" },
            { name: 'env', description: 'Get environment variable', snippet: "env('${1:key}')" },
            { name: 'trans', description: 'Translate the given message', snippet: "trans('${1:key}')" },
            { name: '__', description: 'Translate the given message', snippet: "__('${1:key}')" },
            { name: 'auth', description: 'Get Auth instance or user', snippet: 'auth()->user()' },
            { name: 'session', description: 'Get/set session value', snippet: "session('${1:key}')" },
            { name: 'old', description: 'Get old input value', snippet: "old('${1:key}')" },
            { name: 'request', description: 'Get request instance/input', snippet: "request('${1:key}')" },
            { name: 'csrf_token', description: 'Get CSRF token', snippet: 'csrf_token()' },
            { name: 'now', description: 'Get current datetime', snippet: 'now()' },
            { name: 'today', description: 'Get current date', snippet: 'today()' },
            { name: 'collect', description: 'Create a collection', snippet: 'collect(${1:\\$items})' },
            { name: 'optional', description: 'Optional helper for null safety', snippet: 'optional(${1:\\$value})' },
            { name: 'storage_path', description: 'Get storage path', snippet: "storage_path('${1:path}')" },
            { name: 'public_path', description: 'Get public path', snippet: "public_path('${1:path}')" },
            { name: 'base_path', description: 'Get base path', snippet: "base_path('${1:path}')" },
            { name: 'resource_path', description: 'Get resource path', snippet: "resource_path('${1:path}')" },
            { name: 'app', description: 'Get service from container', snippet: "app('${1:service}')" },
            { name: 'abort', description: 'Throw HTTP exception', snippet: 'abort(${1:404})' },
            { name: 'back', description: 'Redirect back', snippet: 'back()' },
            { name: 'redirect', description: 'Redirect to URL', snippet: "redirect('${1:url}')" },
            { name: 'view', description: 'Create view response', snippet: "view('${1:name}')" },
            { name: 'cache', description: 'Get/set cache value', snippet: "cache('${1:key}')" },
            { name: 'logger', description: 'Log a message', snippet: "logger('${1:message}')" },
            { name: 'dump', description: 'Dump variable', snippet: 'dump(${1:\\$var})' },
            { name: 'dd', description: 'Dump and die', snippet: 'dd(${1:\\$var})' },
        ];

        return helpers.map((helper) => ({
            label: helper.name,
            kind: CompletionItemKind.Function,
            detail: 'Laravel Helper',
            documentation: {
                kind: MarkupKind.Markdown,
                value: helper.description,
            },
            insertText: helper.snippet,
            insertTextFormat: InsertTextFormat.Snippet,
        }));
    }

    export function getParameterCompletions(directiveName: string): CompletionItem[] {
        const items: CompletionItem[] = [];

        switch (directiveName) {
            case 'extends':
            case 'include':
            case 'includeIf':
            case 'includeWhen':
            case 'includeUnless':
            case 'includeFirst':
                if (Laravel.isAvailable()) {
                    const views = Views.getItems();

                    for (const view of views) {
                        items.push(createViewCompletionItem(view));
                    }
                } else {
                    items.push(
                        { label: 'layouts.app', kind: CompletionItemKind.File, detail: 'Main layout' },
                        { label: 'layouts.guest', kind: CompletionItemKind.File, detail: 'Guest layout' },
                        { label: 'components.', kind: CompletionItemKind.Folder, detail: 'Components' },
                        { label: 'partials.', kind: CompletionItemKind.Folder, detail: 'Partials' },
                    );
                }
                break;

            case 'section':
            case 'yield':
                items.push(
                    { label: 'content', kind: CompletionItemKind.Value, detail: 'Main content' },
                    { label: 'title', kind: CompletionItemKind.Value, detail: 'Page title' },
                    { label: 'scripts', kind: CompletionItemKind.Value, detail: 'JavaScript' },
                    { label: 'styles', kind: CompletionItemKind.Value, detail: 'CSS styles' },
                );
                break;

            case 'can':
            case 'cannot':
            case 'canany':
                items.push(
                    { label: 'view', kind: CompletionItemKind.Value, detail: 'View permission' },
                    { label: 'create', kind: CompletionItemKind.Value, detail: 'Create permission' },
                    { label: 'update', kind: CompletionItemKind.Value, detail: 'Update permission' },
                    { label: 'delete', kind: CompletionItemKind.Value, detail: 'Delete permission' },
                );
                break;

            case 'env':
                items.push(
                    { label: 'local', kind: CompletionItemKind.Value, detail: 'Local environment' },
                    { label: 'production', kind: CompletionItemKind.Value, detail: 'Production' },
                    { label: 'staging', kind: CompletionItemKind.Value, detail: 'Staging' },
                );
                break;

            case 'method':
                items.push(
                    { label: 'PUT', kind: CompletionItemKind.Value, detail: 'HTTP PUT' },
                    { label: 'PATCH', kind: CompletionItemKind.Value, detail: 'HTTP PATCH' },
                    { label: 'DELETE', kind: CompletionItemKind.Value, detail: 'HTTP DELETE' },
                );
                break;

            case 'push':
            case 'stack':
                items.push(
                    { label: 'scripts', kind: CompletionItemKind.Value, detail: 'JavaScript stack' },
                    { label: 'styles', kind: CompletionItemKind.Value, detail: 'CSS stack' },
                );
                break;

            case 'slot':
                items.push(
                    { label: 'header', kind: CompletionItemKind.Value, detail: 'Header slot' },
                    { label: 'footer', kind: CompletionItemKind.Value, detail: 'Footer slot' },
                    { label: 'title', kind: CompletionItemKind.Value, detail: 'Title slot' },
                    { label: 'icon', kind: CompletionItemKind.Value, detail: 'Icon slot' },
                    { label: 'actions', kind: CompletionItemKind.Value, detail: 'Actions slot' },
                    { label: 'trigger', kind: CompletionItemKind.Value, detail: 'Trigger slot' },
                    { label: 'content', kind: CompletionItemKind.Value, detail: 'Content slot' },
                );
                break;

            case 'livewire':
            case 'livewireStyles':
            case 'livewireScripts':
                if (Laravel.isAvailable()) {
                    const views = Views.getItems();
                    const livewireViews = views.filter((v) => v.key.startsWith('livewire.'));
                    for (const view of livewireViews) {
                        items.push({
                            label: view.key.replace('livewire.', ''),
                            kind: CompletionItemKind.Class,
                            detail: 'Livewire component',
                            documentation: {
                                kind: MarkupKind.Markdown,
                                value: `Livewire component\n\nPath: \`${view.path}\``,
                            },
                        });
                    }
                }
                break;
        }

        return items;
    }

    export function createViewCompletionItem(view: ViewItem): CompletionItem {
        return {
            label: view.key,
            kind: CompletionItemKind.File,
            detail: view.isVendor ? `View (vendor)` : `View`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: `**${view.key}**\n\nPath: \`${view.path}\``,
            },
            sortText: view.isVendor ? '1' + view.key : '0' + view.key,
            data: {
                kind: 'view',
                key: view.key,
                path: view.path,
            } satisfies CompletionResolveData,
        };
    }

    function isCompletionResolveData(data: unknown): data is CompletionResolveData {
        if (!data || typeof data !== 'object') {
            return false;
        }

        const payload = data as Partial<CompletionResolveData>;
        return (
            (payload.kind === 'view' || payload.kind === 'component' || payload.kind === 'livewire') &&
            typeof payload.key === 'string' &&
            typeof payload.path === 'string'
        );
    }

    function getDocumentationValue(item: CompletionItem): string {
        const { documentation } = item;
        if (!documentation) {
            return '';
        }

        if (typeof documentation === 'string') {
            return documentation;
        }

        if (Array.isArray(documentation)) {
            return documentation
                .map((entry) => (typeof entry === 'string' ? entry : entry.value))
                .filter(Boolean)
                .join('\n\n');
        }

        return documentation.value;
    }

    function createBladePreview(content: string): string | null {
        const lines = content.split('\n');
        let firstNonEmpty = 0;
        while (firstNonEmpty < lines.length && lines[firstNonEmpty].trim() === '') {
            firstNonEmpty++;
        }

        if (firstNonEmpty >= lines.length) {
            return null;
        }

        const previewLines = lines.slice(firstNonEmpty, firstNonEmpty + 8);
        let preview = previewLines.join('\n').trimEnd();
        if (!preview) {
            return null;
        }

        if (firstNonEmpty + 8 < lines.length) {
            preview += '\n...';
        }

        return preview;
    }

    export function resolveCompletionItem(item: CompletionItem): CompletionItem {
        if (!isCompletionResolveData(item.data)) {
            return item;
        }

        const { key, path } = item.data;
        const existingDocumentation = getDocumentationValue(item);

        let value = existingDocumentation || `**${key}**`;
        const hasPathInDocs = existingDocumentation.includes(`Path: \`${path}\``);
        if (!hasPathInDocs) {
            value += `${value ? '\n\n' : ''}Path: \`${path}\``;
        }

        const file = ProjectFile.read(path);
        if (file) {
            const preview = createBladePreview(file.content);
            if (preview) {
                value += `\n\n**Preview:**\n\n\`\`\`blade\n${preview}\n\`\`\``;
            }
        }

        item.documentation = {
            kind: MarkupKind.Markdown,
            value,
        };

        return item;
    }

    /**
     * Normalize component props to a flat array of parsed props,
     * regardless of whether they come as a string or array.
     */
    function resolveComponentProps(props: ComponentItem['props']): Shared.ParsedProp[] {
        if (!props) return [];

        if (typeof props === 'string') {
            return Shared.parsePropsString(props);
        }

        if (Array.isArray(props)) {
            return props.map((p) => ({
                name: p.name,
                type: p.type,
                required: p.default === null || p.default === undefined,
                default: p.default,
            }));
        }

        return [];
    }

    export function getComponentPropCompletions(componentName: string, existingProps: string[]): CompletionItem[] {
        if (!Laravel.isAvailable()) return [];

        const component = Components.resolve(componentName);
        if (!component) return [];

        const resolved = resolveComponentProps(component.props);
        return resolved
            .filter((prop) => !existingProps.includes(prop.name))
            .map((prop) => createPropCompletionItem(prop.name, prop.type, prop.required, prop.default));
    }

    export function createPropCompletionItem(
        name: string,
        type: string,
        required: boolean,
        defaultValue: unknown,
    ): CompletionItem {
        const isDynamic = type !== 'string' && type !== 'mixed';
        // Non-string props are usually bound as PHP expressions (e.g. :count="$total").
        const prefix = isDynamic ? ':' : '';

        return {
            label: `${prefix}${name}`,
            kind: CompletionItemKind.Property,
            detail: required ? `${type} (required)` : type,
            documentation: {
                kind: MarkupKind.Markdown,
                value: `**${name}**\n\nType: \`${type}\`${defaultValue !== null ? `\nDefault: \`${defaultValue}\`` : ''}`,
            },
            insertText: `${prefix}${name}="\${1}"`,
            insertTextFormat: InsertTextFormat.Snippet,
            sortText: required ? '0' + name : '1' + name,
        };
    }

    function createSlotCompletion(
        slot: { name: string },
        component: ComponentItem,
        syntax: 'colon' | 'name',
    ): CompletionItem {
        const insertText =
            syntax === 'colon'
                ? `${slot.name}>$0</x-slot>` // <x-slot:name>...</x-slot>
                : `${slot.name}">$0</x-slot>`; // <x-slot name="name">...</x-slot>

        return {
            label: slot.name,
            kind: CompletionItemKind.Value,
            detail: `Named slot in ${component.key}`,
            documentation: {
                kind: MarkupKind.Markdown,
                value: `Slot \`${slot.name}\` from component \`${ComponentsNs.keyToTag(component.key)}\``,
            },
            insertText,
            insertTextFormat: InsertTextFormat.Snippet,
        };
    }

    export function getSlotCompletions(
        currentLine: number,
        syntax: 'colon' | 'name' = 'colon',
        tree: BladeParser.Tree,
    ): CompletionItem[] {
        if (!Laravel.isAvailable()) return [];

        const componentContext = BladeParser.findParentComponentFromTree(tree, currentLine, 0);
        if (!componentContext) return [];

        const component = Components.resolve(componentContext);
        if (!component) return [];

        return extractSlotsFromComponent(component).map((slot) => createSlotCompletion(slot, component, syntax));
    }

    function extractSlotsFromComponent(component: ComponentItem): { name: string }[] {
        if (!component.path.endsWith('.blade.php')) {
            return [];
        }

        const file = ProjectFile.read(component.path);
        if (!file) {
            return [];
        }

        return Shared.extractSlotsFromContent(file.content);
    }
}

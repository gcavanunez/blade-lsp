import { Hover, MarkupKind } from 'vscode-languageserver/node';
import { Shared } from './shared';
import { BladeDirectives } from '../directives';
import { BladeParser } from '../parser';
import { Laravel } from '../laravel/index';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';
import type { ComponentProp, CustomDirective } from '../laravel/types';

export namespace Hovers {
    /**
     * Look up a specific prop by name from either a raw @props string or a structured array.
     */
    function findPropInfo(
        props: import('../laravel/types').ComponentItem['props'],
        propName: string,
    ): ComponentProp | null {
        if (!props) return null;

        if (typeof props === 'string') {
            return Shared.parsePropsString(props).find((p) => p.name === propName) || null;
        }

        if (Array.isArray(props)) {
            return props.find((p) => p.name === propName) || null;
        }

        return null;
    }

    /**
     * Format a component's props into a markdown section.
     * Handles both string (@props raw) and array (structured) formats.
     */
    function formatComponentPropsSection(props: import('../laravel/types').ComponentItem['props']): string {
        if (!props) return '';

        if (typeof props === 'string') {
            return `**Props:**\n\`\`\`php\n${props}\n\`\`\`\n`;
        }

        if (Array.isArray(props) && props.length > 0) {
            let section = '**Props:**\n\n';
            section += '| Name | Type | Required |\n';
            section += '|------|------|----------|\n';
            for (const prop of props) {
                const hasDefault = prop.default !== null && prop.default !== undefined;
                section += `| \`${prop.name}\` | ${prop.type} | ${hasDefault ? 'No' : 'Yes'} |\n`;
            }
            return section;
        }

        return '';
    }

    export function formatDirective(directive: BladeDirectives.Directive): string {
        let content = `## ${directive.name}\n\n${directive.description}\n\n`;
        if (directive.parameters) content += `**Parameters:** \`${directive.parameters}\`\n\n`;
        if (directive.hasEndTag && directive.endTag) content += `**End tag:** \`${directive.endTag}\`\n\n`;
        if (directive.snippet) {
            content += '**Example:**\n```blade\n';
            // Strip snippet placeholders (${1:text}, $1) for readable docs output.
            content += directive.snippet.replace(/\$\{\d+:?([^}]*)\}/g, '$1').replace(/\$\d+/g, '');
            content += '\n```';
        }
        return content;
    }

    export function formatCustomDirective(directive: CustomDirective): string {
        let content = `## @${directive.name}\n\nCustom Blade directive\n\n`;
        content += directive.hasParams
            ? '**Usage:** `@' + directive.name + "('...')`"
            : '**Usage:** `@' + directive.name + '`';
        return content;
    }

    export function getDirectiveNameAtColumn(line: string, column: number): string | null {
        const directivePattern = /@([A-Za-z_][A-Za-z0-9_]*)/g;
        let match: RegExpExecArray | null;

        while ((match = directivePattern.exec(line)) !== null) {
            const full = match[0];
            const start = match.index;
            const end = start + full.length;
            const prev = start > 0 ? line[start - 1] : '';

            if (prev && /[A-Za-z0-9_$]/.test(prev)) {
                continue;
            }

            if (column >= start && column <= end) {
                return full;
            }
        }

        return null;
    }

    export function formatLoopVariable(): string {
        return `## $loop Variable

Available inside \`@foreach\` loops.

| Property | Description |
|----------|-------------|
| \`$loop->index\` | Current index (0-based) |
| \`$loop->iteration\` | Current iteration (1-based) |
| \`$loop->remaining\` | Iterations remaining |
| \`$loop->count\` | Total items |
| \`$loop->first\` | Is first iteration |
| \`$loop->last\` | Is last iteration |
| \`$loop->even\` | Is even iteration |
| \`$loop->odd\` | Is odd iteration |
| \`$loop->depth\` | Nesting level |
| \`$loop->parent\` | Parent loop variable |`;
    }

    export function formatSlotVariable(): string {
        return `## $slot Variable

Contains the content passed to a component.

\`\`\`blade
<div class="alert">{{ $slot }}</div>
\`\`\``;
    }

    export function formatAttributesVariable(): string {
        return `## $attributes Variable

Contains all attributes passed to a component.

| Method | Description |
|--------|-------------|
| \`$attributes->merge()\` | Merge with defaults |
| \`$attributes->class()\` | Merge classes |
| \`$attributes->only()\` | Get specified only |
| \`$attributes->except()\` | Exclude specified |

\`\`\`blade
<div {{ $attributes->merge(['class' => 'alert']) }}>
\`\`\``;
    }

    export function getComponentHover(line: string, column: number): Hover | null {
        const componentTag = Shared.getComponentTagAtColumn(line, column);
        if (!componentTag) {
            return null;
        }

        if (!Laravel.isAvailable()) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `## ${componentTag}\n\nBlade component`,
                },
            };
        }

        if (componentTag.startsWith('livewire:')) {
            const componentName = componentTag.replace('livewire:', '');
            const viewKey = `livewire.${componentName}`;
            const view = Views.find(viewKey);

            if (!view) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `## ${componentTag}\n\nLivewire component (not found in project)`,
                    },
                };
            }

            let content = `## ${componentTag}\n\n`;
            content += `**Type:** Livewire component\n\n`;
            content += `**Path:** \`${view.path}\`\n\n`;

            if (view.livewire?.files && view.livewire.files.length > 0) {
                content += '**Files:**\n';
                for (const file of view.livewire.files) {
                    content += `- \`${file}\`\n`;
                }
                content += '\n';
            }

            if (view.livewire?.props && view.livewire.props.length > 0) {
                content += '**Props:**\n\n';
                content += '| Name | Type |\n';
                content += '|------|------|\n';
                for (const prop of view.livewire.props) {
                    content += `| \`${prop.name}\` | ${prop.type} |\n`;
                }
            }

            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: content,
                },
            };
        }

        const component = Components.resolve(componentTag);

        if (!component) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `## ${componentTag}\n\nBlade component (not found in project)`,
                },
            };
        }

        const fullTag = Components.keyToTag(component.key);
        let content = `## ${fullTag}\n\n`;
        content += `**Path:** \`${component.path}\`\n\n`;

        content += formatComponentPropsSection(component.props);

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: content,
            },
        };
    }

    export function getPropHover(
        line: string,
        lineNumber: number,
        column: number,
        tree: BladeParser.Tree,
    ): Hover | null {
        const context = BladeParser.getComponentTagContext(tree, lineNumber, column);
        if (!context) {
            return null;
        }

        const propName = Shared.getAttributeNameAtColumn(line, column);

        if (!propName) {
            return null;
        }

        if (!Laravel.isAvailable()) {
            return null;
        }

        const component = Components.resolve(context.componentName);

        if (!component) {
            return null;
        }

        const propInfo = findPropInfo(component.props, propName);

        let content = `## \`${propName}\`\n\n`;
        content += `**Component:** \`${context.componentName}\`\n\n`;

        if (propInfo) {
            const hasDefault = propInfo.default !== null && propInfo.default !== undefined;
            content += `**Type:** \`${propInfo.type}\`\n\n`;
            content += `**Required:** ${hasDefault ? 'No' : 'Yes'}\n\n`;
            if (propInfo.default !== null && propInfo.default !== undefined) {
                const defaultStr =
                    typeof propInfo.default === 'string' ? propInfo.default : JSON.stringify(propInfo.default);
                content += `**Default:** \`${defaultStr}\`\n`;
            }
        } else {
            content += `*Prop not found in \`@props\` directive*\n`;
        }

        content += `\n**Path:** \`${component.path}\``;

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: content,
            },
        };
    }

    export function getViewHover(line: string, column: number): Hover | null {
        const viewName = Shared.getViewReferenceAtColumn(line, column);
        return viewName ? getViewHoverContent(viewName) : null;
    }

    export function getViewHoverContent(viewName: string): Hover {
        if (!Laravel.isAvailable()) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `## ${viewName}\n\nBlade view`,
                },
            };
        }

        const view = Views.find(viewName);

        if (!view) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `## ${viewName}\n\n**View not found in project**`,
                },
            };
        }

        let content = `## ${view.key}\n\n`;
        content += `**Path:** \`${view.path}\`\n\n`;
        const nsMatch = view.key.match(/^([^:]+)::/);
        if (nsMatch) {
            content += `**Namespace:** \`${nsMatch[1]}\`\n\n`;
        }
        if (view.isVendor) {
            content += `*Vendor package view*\n`;
        }

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: content,
            },
        };
    }

    export function getSlotHover(
        line: string,
        lineNumber: number,
        column: number,
        tree: BladeParser.Tree,
    ): Hover | null {
        const slotName = Shared.getSlotNameAtColumn(line, column);
        if (!slotName) {
            return null;
        }

        const componentContext = BladeParser.findParentComponentFromTree(tree, lineNumber, column);
        if (!componentContext) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `## Slot: \`${slotName}\`\n\n*No parent component found*`,
                },
            };
        }

        if (!Laravel.isAvailable()) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `## Slot: \`${slotName}\`\n\n**Component:** \`${componentContext}\``,
                },
            };
        }

        const component = Components.resolve(componentContext);

        if (!component) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `## Slot: \`${slotName}\`\n\n**Component:** \`${componentContext}\` (not found in project)`,
                },
            };
        }

        let content = `## Slot: \`${slotName}\`\n\n`;
        content += `**Component:** \`${Components.keyToTag(component.key)}\`\n\n`;
        content += `**Path:** \`${component.path}\`\n\n`;
        content += `*Named slot passed to the component*`;

        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: content,
            },
        };
    }

    export function getWordAtPosition(line: string, column: number): string {
        let start = column;
        let end = column;
        while (start > 0 && /[\w$>-]/.test(line[start - 1])) start--;
        while (end < line.length && /[\w$>-]/.test(line[end])) end++;
        return line.slice(start, end);
    }
}

import { Location, Range } from 'vscode-languageserver/node';
import { BladeParser } from '../parser';
import { Shared } from './shared';
import { ProjectFile } from './project-file';
import { Laravel } from '../laravel/index';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';

export namespace Definitions {
    export function getViewDefinition(
        line: string,
        column: number,
        _source: string,
        _lineNum: number,
    ): Location | null {
        const viewName = Shared.getViewReferenceAtColumn(line, column);
        return viewName ? resolveViewLocation(viewName) : null;
    }

    export function resolveViewLocation(viewName: string): Location | null {
        if (!Laravel.isAvailable()) {
            return null;
        }

        const view = Views.find(viewName);
        if (!view) {
            return null;
        }

        const file = ProjectFile.resolve(view.path);
        if (!file) {
            return null;
        }

        return {
            uri: file.uri,
            range: Range.create(0, 0, 0, 0),
        };
    }

    export function getComponentDefinition(line: string, column: number): Location | null {
        const componentTag = Shared.getComponentTagAtColumn(line, column);
        return componentTag ? resolveComponentLocation(componentTag) : null;
    }

    export function resolveComponentLocation(componentTag: string): Location | null {
        if (!Laravel.isAvailable()) {
            return null;
        }

        if (componentTag.startsWith('livewire:')) {
            const componentName = componentTag.replace('livewire:', '');
            const viewKey = `livewire.${componentName}`;
            const view = Views.find(viewKey);

            if (view) {
                const file = ProjectFile.resolve(view.path);
                if (!file) {
                    return null;
                }
                return {
                    uri: file.uri,
                    range: Range.create(0, 0, 0, 0),
                };
            }
            return null;
        }

        const component = Components.resolve(componentTag);

        if (!component) {
            return null;
        }

        const file = ProjectFile.resolve(component.path);
        if (!file) {
            return null;
        }

        return {
            uri: file.uri,
            range: Range.create(0, 0, 0, 0),
        };
    }

    /**
     * Collect the multi-line @props block starting at a given line.
     * Returns the line range (startLine..endLine inclusive).
     */
    function collectPropsBlock(lines: string[], startLine: number): { endLine: number } {
        if (lines[startLine].includes('])')) return { endLine: startLine };

        for (let j = startLine + 1; j < lines.length && j < startLine + 20; j++) {
            if (lines[j].includes('])')) return { endLine: j };
        }
        return { endLine: Math.min(startLine + 19, lines.length - 1) };
    }

    /**
     * Find a specific prop name within a component file's @props directive.
     * Returns the line and column of the prop, or null if not found.
     */
    function findPropInFile(content: string, propName: string): { line: number; col: number } | null {
        const lines = content.split('\n');
        const propNeedle = `'${propName}'`;

        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes('@props')) continue;

            const { endLine } = collectPropsBlock(lines, i);

            for (let j = i; j <= endLine; j++) {
                const col = lines[j].indexOf(propNeedle);
                if (col >= 0) return { line: j, col };
            }
        }

        return null;
    }

    export function getPropDefinition(
        line: string,
        lineNumber: number,
        column: number,
        tree: BladeParser.Tree,
    ): Location | null {
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

        const file = ProjectFile.read(component.path);
        if (!file) {
            return null;
        }

        try {
            const propLocation = findPropInFile(file.content, propName);

            if (propLocation) {
                return {
                    uri: file.uri,
                    range: Range.create(
                        propLocation.line,
                        propLocation.col,
                        propLocation.line,
                        // Include the surrounding single quotes in @props(['name' => ...]).
                        propLocation.col + propName.length + 2,
                    ),
                };
            }

            return {
                uri: file.uri,
                range: Range.create(0, 0, 0, 0),
            };
        } catch {
            return null;
        }
    }

    /**
     * Find where a named slot variable is used in a component file.
     * Searches for {{ $slotName }}, {!! $slotName !!}, @isset($slotName), etc.
     */
    function findSlotUsageInFile(
        content: string,
        slotName: string,
    ): { line: number; col: number; length: number } | null {
        const lines = content.split('\n');
        const patterns = [
            new RegExp(`\\{\\{[\\s]*\\$${slotName}[\\s]*(?:\\?\\?[^}]*)?\\}\\}`),
            new RegExp(`\\{!![\\s]*\\$${slotName}[\\s]*(?:\\?\\?[^}]*)?!!\\}`),
            new RegExp(`@isset\\s*\\(\\s*\\$${slotName}\\s*\\)`),
            new RegExp(`@if\\s*\\(\\s*\\$${slotName}`),
            new RegExp(`\\$${slotName}->(?:isNotEmpty|isEmpty)`),
        ];

        for (let i = 0; i < lines.length; i++) {
            const fileLine = lines[i];
            for (const pattern of patterns) {
                const slotMatch = fileLine.match(pattern);
                if (slotMatch) {
                    const col = fileLine.indexOf(slotMatch[0]);
                    return { line: i, col, length: slotMatch[0].length };
                }
            }
        }

        return null;
    }

    export function getSlotDefinition(
        line: string,
        lineNumber: number,
        column: number,
        tree: BladeParser.Tree,
    ): Location | null {
        const slotName = Shared.getSlotNameAtColumn(line, column);
        if (!slotName) {
            return null;
        }

        const componentContext = BladeParser.findParentComponentFromTree(tree, lineNumber, column);
        if (!componentContext || !Laravel.isAvailable()) {
            return null;
        }

        const component = Components.resolve(componentContext);

        if (!component) {
            return null;
        }

        const file = ProjectFile.read(component.path);
        if (!file) {
            return null;
        }

        try {
            const slotLocation = findSlotUsageInFile(file.content, slotName);

            if (slotLocation) {
                return {
                    uri: file.uri,
                    range: Range.create(
                        slotLocation.line,
                        slotLocation.col,
                        slotLocation.line,
                        slotLocation.col + slotLocation.length,
                    ),
                };
            }

            return {
                uri: file.uri,
                range: Range.create(0, 0, 0, 0),
            };
        } catch {
            return null;
        }
    }
}

import { Location, Range } from 'vscode-languageserver/node';
import * as path from 'path';
import * as fs from 'fs';
import { BladeParser } from '../parser';
import { Laravel } from '../laravel/index';
import { Views } from '../laravel/views';
import { Components } from '../laravel/components';
import { Server } from '../server';

export namespace Definitions {
    export function getViewDefinition(
        line: string,
        column: number,
        _source: string,
        _lineNum: number,
    ): Location | null {
        const viewDirectives = [
            'extends',
            'include',
            'includeIf',
            'includeWhen',
            'includeUnless',
            'includeFirst',
            'each',
            'component',
        ];

        for (const directive of viewDirectives) {
            const regex = new RegExp(`@${directive}\\s*\\(\\s*['"]([^'"]+)['"]`);
            const match = line.match(regex);

            if (match) {
                const viewName = match[1];
                const viewStart = line.indexOf(viewName);
                const viewEnd = viewStart + viewName.length;

                if (column >= viewStart && column <= viewEnd) {
                    return resolveViewLocation(viewName);
                }
            }
        }

        const viewHelperMatch = line.match(/view\s*\(\s*['"]([^'"]+)['"]/);
        if (viewHelperMatch) {
            const viewName = viewHelperMatch[1];
            const viewStart = line.indexOf(viewName);
            const viewEnd = viewStart + viewName.length;

            if (column >= viewStart && column <= viewEnd) {
                return resolveViewLocation(viewName);
            }
        }

        return null;
    }

    export function resolveViewLocation(viewName: string): Location | null {
        const workspaceRoot = Server.getWorkspaceRoot();
        if (!Laravel.isAvailable() || !workspaceRoot) {
            return null;
        }

        const view = Views.find(viewName);
        if (!view) {
            return null;
        }

        const fullPath = path.join(workspaceRoot, view.path);

        return {
            uri: `file://${fullPath}`,
            range: Range.create(0, 0, 0, 0),
        };
    }

    export function getComponentDefinition(line: string, column: number): Location | null {
        const componentMatch = line.match(/<(x-[\w.-]+(?:::[\w.-]+)?|[\w]+:[\w.-]+)/);

        if (!componentMatch) {
            return null;
        }

        const componentTag = componentMatch[1];
        const tagStart = line.indexOf(componentMatch[0]) + 1; // +1 to skip <
        const tagEnd = tagStart + componentTag.length;

        if (column >= tagStart && column <= tagEnd) {
            return resolveComponentLocation(componentTag);
        }

        return null;
    }

    export function resolveComponentLocation(componentTag: string): Location | null {
        const workspaceRoot = Server.getWorkspaceRoot();
        if (!Laravel.isAvailable() || !workspaceRoot) {
            return null;
        }

        if (componentTag.startsWith('livewire:')) {
            const componentName = componentTag.replace('livewire:', '');
            const viewKey = `livewire.${componentName}`;
            const view = Views.find(viewKey);

            if (view) {
                const fullPath = path.join(workspaceRoot, view.path);
                return {
                    uri: `file://${fullPath}`,
                    range: Range.create(0, 0, 0, 0),
                };
            }
            return null;
        }

        const component = Components.findByTag(componentTag) || Components.find(componentTag.replace(/^x-/, ''));

        if (!component) {
            return null;
        }

        const fullPath = path.join(workspaceRoot, component.path);

        return {
            uri: `file://${fullPath}`,
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

        const attrPattern = /(?::|)([\w-]+)(?:\s*=)?/g;
        let match;
        let propName: string | null = null;

        while ((match = attrPattern.exec(line)) !== null) {
            const attrStart = match.index;
            const attrNameStart = match[0].startsWith(':') ? attrStart + 1 : attrStart;
            const attrNameEnd = attrNameStart + match[1].length;

            if (column >= attrNameStart && column <= attrNameEnd) {
                propName = match[1];
                break;
            }
        }

        if (!propName) {
            return null;
        }

        const workspaceRoot = Server.getWorkspaceRoot();
        if (!Laravel.isAvailable() || !workspaceRoot) {
            return null;
        }

        const component =
            Components.findByTag(context.componentName) || Components.find(context.componentName.replace(/^x-/, ''));

        if (!component) {
            return null;
        }

        const fullPath = path.join(workspaceRoot, component.path);

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const propLocation = findPropInFile(content, propName);

            if (propLocation) {
                return {
                    uri: `file://${fullPath}`,
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
                uri: `file://${fullPath}`,
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
        const colonMatch = line.match(/<x-slot:([\w-]+)/);
        const nameMatch = line.match(/<x-slot\s+name=["']([\w-]+)["']/);

        const match = colonMatch || nameMatch;
        if (!match) {
            return null;
        }

        const slotName = match[1];
        const slotStart = line.indexOf(slotName, line.indexOf('x-slot'));
        const slotEnd = slotStart + slotName.length;

        if (column < slotStart || column > slotEnd) {
            return null;
        }

        const componentContext = BladeParser.findParentComponentFromTree(tree, lineNumber, column);
        if (!componentContext || !Laravel.isAvailable()) {
            return null;
        }

        const component =
            Components.findByTag(componentContext) || Components.find(componentContext.replace(/^x-/, ''));

        if (!component) {
            return null;
        }

        const workspaceRoot = Server.getWorkspaceRoot();
        if (!workspaceRoot) {
            return null;
        }

        const fullPath = path.join(workspaceRoot, component.path);

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const slotLocation = findSlotUsageInFile(content, slotName);

            if (slotLocation) {
                return {
                    uri: `file://${fullPath}`,
                    range: Range.create(
                        slotLocation.line,
                        slotLocation.col,
                        slotLocation.line,
                        slotLocation.col + slotLocation.length,
                    ),
                };
            }

            return {
                uri: `file://${fullPath}`,
                range: Range.create(0, 0, 0, 0),
            };
        } catch {
            return null;
        }
    }
}

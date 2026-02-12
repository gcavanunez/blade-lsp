/**
 * Shared utilities used across completion, hover, and definition providers.
 * Pure text analysis with no external dependencies (avoids circular imports with server.ts).
 */
export namespace Shared {
    export interface ComponentPropContext {
        componentName: string;
        existingProps: string[];
    }

    export interface ParsedProp {
        name: string;
        type: string;
        required: boolean;
        default: unknown;
    }

    /**
     * Check if a line has a closing `>` that isn't followed by a new opening `<`.
     * Used to detect tag boundaries when scanning backwards.
     */
    function hasUnpairedClosingBracket(lineText: string): boolean {
        const stripped = stripQuotedStrings(lineText);
        if (!stripped.includes('>')) return false;
        const lastClose = stripped.lastIndexOf('>');
        const afterClose = stripped.slice(lastClose + 1);
        return !afterClose.includes('<');
    }

    export function getComponentPropContext(source: string, row: number, column: number): ComponentPropContext | null {
        const lines = source.split('\n');
        const currentLine = lines[row] || '';
        const textBeforeCursor = currentLine.slice(0, column);

        let lineIndex = row;

        // Multi-line component tags are common; scan a few lines upward for the opener.
        while (lineIndex >= 0 && lineIndex >= row - 10) {
            const lineText = lineIndex === row ? textBeforeCursor : lines[lineIndex];

            if (lineIndex !== row && hasUnpairedClosingBracket(lineText)) {
                break;
            }

            const componentMatch = lineText.match(/<(x-[\w.-]+(?:::[\w.-]+)?|[\w]+:[\w.-]+)/);
            if (componentMatch) {
                const tagStart = lineText.indexOf(componentMatch[0]);
                const fullTagName = componentMatch[1];

                if (fullTagName === 'x-slot') {
                    // x-slot is a slot declaration, not the parent component we need for prop context.
                    lineIndex--;
                    continue;
                }

                const afterTag = lineIndex === row ? currentLine.slice(tagStart, column) : lineText.slice(tagStart);
                const afterTagStripped = stripQuotedStrings(afterTag);

                const closePos = afterTagStripped.indexOf('>');
                const isClosedBeforeCursor =
                    closePos >= 0 &&
                    !afterTagStripped.includes('/>') &&
                    lineIndex === row &&
                    tagStart + closePos < column;
                if (isClosedBeforeCursor) {
                    break;
                }

                const existingProps = extractExistingProps(source, lineIndex, tagStart, row, column);

                return {
                    componentName: fullTagName,
                    existingProps,
                };
            }

            lineIndex--;
        }

        return null;
    }

    /**
     * Strip the content of quoted strings (both single and double),
     * replacing characters inside quotes with spaces. This preserves
     * string positions so that index-based logic still works, while
     * hiding characters like `>` that appear inside attribute values
     * (e.g. `$user->id`).
     */
    export function stripQuotedStrings(text: string): string {
        return text.replace(/(["'])(?:(?!\1).)*\1/g, (match) => match[0] + ' '.repeat(match.length - 2) + match[0]);
    }

    export function extractExistingProps(
        source: string,
        startLine: number,
        startCol: number,
        endLine: number,
        endCol: number,
    ): string[] {
        const lines = source.split('\n');
        let text = '';

        for (let i = startLine; i <= endLine; i++) {
            if (i === startLine && i === endLine) {
                text += lines[i].slice(startCol, endCol);
            } else if (i === startLine) {
                text += lines[i].slice(startCol) + '\n';
            } else if (i === endLine) {
                text += lines[i].slice(0, endCol);
            } else {
                text += lines[i] + '\n';
            }
        }

        const propMatches = text.matchAll(/(?::|)(\w[\w-]*)(?:=)/g);
        return Array.from(propMatches, (m) => m[1]);
    }

    export function parsePropsString(propsString: string): ParsedProp[] {
        const props: ParsedProp[] = [];

        const arrayMatch = propsString.match(/@props\s*\(\s*\[([\s\S]*)\]\s*\)/);
        if (!arrayMatch) return props;

        const content = arrayMatch[1];

        const pairMatches = content.matchAll(/'([\w-]+)'\s*=>\s*([^,\]]+)/g);
        for (const match of pairMatches) {
            props.push({
                name: match[1],
                type: 'mixed',
                required: false,
                default: match[2].trim(),
            });
        }

        // Match standalone prop names ('foo') but not key/value entries ('foo' => ...).
        const simpleMatches = content.matchAll(/(?<![=>])\s*'([\w-]+)'(?!\s*=>)/g);
        for (const match of simpleMatches) {
            if (!props.some((p) => p.name === match[1])) {
                props.push({
                    name: match[1],
                    type: 'mixed',
                    required: true,
                    default: null,
                });
            }
        }

        return props;
    }

    export function findParentComponent(source: string, currentLine: number): string | null {
        const lines = source.split('\n');
        let depth = 0;

        // Self-closing component tags do not affect nesting depth for parent lookup.
        const selfClosingPattern = /<(x-(?!slot\b)[\w.-]+(?:::[\w.-]+)?|[\w]+:[\w.-]+)(?:\s[^>]*)?\s*\/>/g;

        for (let i = currentLine; i >= 0; i--) {
            const line = lines[i];

            const stripped = line.replace(selfClosingPattern, '');

            const closingTags = stripped.match(/<\/x-(?!slot\b)[\w.-]+(?:::[\w.-]+)?>/g);
            if (closingTags) depth += closingTags.length;

            const openingMatch = stripped.match(/<(x-(?!slot\b)[\w.-]+(?:::[\w.-]+)?|[\w]+:[\w.-]+)(?:\s|>)/);
            if (openingMatch) {
                if (depth === 0) {
                    return openingMatch[1];
                }
                depth--;
            }
        }

        return null;
    }

    /**
     * Extract named slots from blade content
     *
     * A variable is considered a slot if:
     * 1. It's declared in @props AND echoed as standalone content (not in attributes)
     * 2. If no @props exists, any standalone echoed variable (minus excluded) is a potential slot
     */
    export function extractSlotsFromContent(content: string): { name: string }[] {
        const excludedVars = new Set([
            'slot', // Default slot
            'attributes', // Component attributes
            'component', // Component instance
            'errors', // Validation errors
            'loop', // Foreach loop variable
            '__env', // Blade environment
            '__data', // Blade data
            'this', // Class reference
        ]);

        const declaredProps = new Set<string>();
        const propsMatch = content.match(/@props\s*\(\s*\[([\s\S]*?)\]\s*\)/);
        if (propsMatch) {
            const propsContent = propsMatch[1];
            const propPattern = /['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
            let match;
            while ((match = propPattern.exec(propsContent)) !== null) {
                declaredProps.add(match[1]);
            }
        }

        const echoedVars = new Set<string>();
        const echoPattern =
            /\{\{[\s]*\$([a-zA-Z_][a-zA-Z0-9_]*)[\s]*(?:\?\?[^}]*)?\}\}|\{!![\s]*\$([a-zA-Z_][a-zA-Z0-9_]*)[\s]*(?:\?\?[^}]*)?!!\}/g;
        let match;
        while ((match = echoPattern.exec(content)) !== null) {
            const varName = match[1] || match[2];
            if (varName && !excludedVars.has(varName)) {
                if (!isInsideHtmlAttribute(content, match.index)) {
                    echoedVars.add(varName);
                }
            }
        }

        const slots = new Set<string>();

        const candidates = declaredProps.size > 0 ? declaredProps : echoedVars;
        for (const name of candidates) {
            if (echoedVars.has(name)) {
                slots.add(name);
            }
        }

        return Array.from(slots).map((name) => ({ name }));
    }

    /**
     * Check if a position in content is inside an HTML attribute value
     * e.g., class="{{ $var }}" - the {{ $var }} is inside an attribute
     */
    function isInsideHtmlAttribute(content: string, position: number): boolean {
        let i = position - 1;
        let inDoubleQuote = false;
        let inSingleQuote = false;

        while (i >= 0) {
            const char = content[i];
            const prevChar = i > 0 ? content[i - 1] : '';

            if (char === '"' && prevChar === '=') {
                inDoubleQuote = true;
                break;
            } else if (char === "'" && prevChar === '=') {
                inSingleQuote = true;
                break;
            } else if (char === '"' && !inSingleQuote) {
                break;
            } else if (char === "'" && !inDoubleQuote) {
                break;
            } else if (char === '>' || char === '<') {
                break;
            }

            i--;
        }

        return inDoubleQuote || inSingleQuote;
    }
}

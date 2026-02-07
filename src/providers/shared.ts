// Shared utilities used across completion, hover, and definition providers.
// All functions here are pure text analysis with no external dependencies,
// which avoids circular imports with server.ts.

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
     * Detect if cursor is inside a component tag for prop completion
     */
    export function getComponentPropContext(source: string, row: number, column: number): ComponentPropContext | null {
        const lines = source.split('\n');
        const currentLine = lines[row] || '';
        const textBeforeCursor = currentLine.slice(0, column);

        // Look backwards to find the opening tag
        let lineIndex = row;

        // Search backwards through lines to find the opening tag
        while (lineIndex >= 0 && lineIndex >= row - 10) {
            const lineText = lineIndex === row ? textBeforeCursor : lines[lineIndex];

            // Check if we found a closing > that would mean we're not in a tag.
            // Strip quoted strings first so that > inside attribute values
            // (e.g. $user->id, arrow functions) is not mistaken for a tag boundary.
            if (lineIndex !== row) {
                const stripped = stripQuotedStrings(lineText);
                if (stripped.includes('>')) {
                    const lastClose = stripped.lastIndexOf('>');
                    const afterClose = stripped.slice(lastClose + 1);
                    if (!afterClose.includes('<')) {
                        break;
                    }
                }
            }

            // Look for component tag opening (including namespaced like x-turbo::frame)
            const componentMatch = lineText.match(/<(x-[\w.-]+(?:::[\w.-]+)?|[\w]+:[\w.-]+)/);
            if (componentMatch) {
                const tagStart = lineText.indexOf(componentMatch[0]);
                const fullTagName = componentMatch[1];

                // Skip x-slot - it's not a real component, it's used for named slots
                if (fullTagName === 'x-slot') {
                    lineIndex--;
                    continue;
                }

                // Check if tag is closed on this line before cursor.
                // Strip quoted strings so > inside attribute values is ignored.
                const afterTag = lineIndex === row ? currentLine.slice(tagStart, column) : lineText.slice(tagStart);
                const afterTagStripped = stripQuotedStrings(afterTag);

                if (afterTagStripped.includes('>') && !afterTagStripped.includes('/>')) {
                    const closePos = afterTagStripped.indexOf('>');
                    if (lineIndex === row && tagStart + closePos < column) {
                        break; // We're past the tag
                    }
                }

                // We're inside this component tag
                // Extract existing props
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

    /**
     * Extract props that are already defined on a component tag
     */
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

        // Match prop names (both regular and : prefixed for dynamic)
        const propMatches = text.matchAll(/(?::|)(\w[\w-]*)(?:=)/g);
        return Array.from(propMatches, (m) => m[1]);
    }

    /**
     * Parse a @props() string to extract prop definitions
     */
    export function parsePropsString(propsString: string): ParsedProp[] {
        const props: ParsedProp[] = [];

        // Match patterns like 'propName' or 'propName' => 'default'
        const arrayMatch = propsString.match(/@props\s*\(\s*\[([\s\S]*)\]\s*\)/);
        if (!arrayMatch) return props;

        const content = arrayMatch[1];

        // Match 'key' => value pairs
        const pairMatches = content.matchAll(/'([\w-]+)'\s*=>\s*([^,\]]+)/g);
        for (const match of pairMatches) {
            props.push({
                name: match[1],
                type: 'mixed',
                required: false,
                default: match[2].trim(),
            });
        }

        // Match simple 'key' entries (required props)
        const simpleMatches = content.matchAll(/(?<![=>])\s*'([\w-]+)'(?!\s*=>)/g);
        for (const match of simpleMatches) {
            // Check if this key wasn't already matched as a pair
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

    /**
     * Find the parent component tag for slot context
     */
    export function findParentComponent(source: string, currentLine: number): string | null {
        const lines = source.split('\n');
        let depth = 0;

        // Regex for self-closing component tags (excluding x-slot):
        //   <x-button />, <x-button/>, <x-card prop="val" />, <flux:button />
        const selfClosingPattern = /<(x-(?!slot\b)[\w.-]+(?:::[\w.-]+)?|[\w]+:[\w.-]+)(?:\s[^>]*)?\s*\/>/g;

        for (let i = currentLine; i >= 0; i--) {
            const line = lines[i];

            // Strip self-closing tags from the line before counting opens/closes.
            // Self-closing tags are neither opening nor closing — they don't affect depth.
            const stripped = line.replace(selfClosingPattern, '');

            // Count closing tags (excluding x-slot), including namespaced like </x-turbo::frame>
            const closingTags = stripped.match(/<\/x-(?!slot\b)[\w.-]+(?:::[\w.-]+)?>/g);
            if (closingTags) depth += closingTags.length;

            // Find opening tags (excluding x-slot), including namespaced like <x-turbo::frame
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
        // Variables to exclude (never slots)
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

        // Step 1: Parse @props to get declared prop names
        const declaredProps = new Set<string>();
        const propsMatch = content.match(/@props\s*\(\s*\[([\s\S]*?)\]\s*\)/);
        if (propsMatch) {
            const propsContent = propsMatch[1];
            // Match 'propName' or 'propName' => default patterns
            const propPattern = /['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
            let match;
            while ((match = propPattern.exec(propsContent)) !== null) {
                declaredProps.add(match[1]);
            }
        }

        // Step 2: Find all variables echoed as standalone content (not inside HTML attributes)
        // Standalone: {{ $var }} or {!! $var !!} NOT inside attribute="..."
        const echoedVars = new Set<string>();
        const echoPattern =
            /\{\{[\s]*\$([a-zA-Z_][a-zA-Z0-9_]*)[\s]*(?:\?\?[^}]*)?\}\}|\{!![\s]*\$([a-zA-Z_][a-zA-Z0-9_]*)[\s]*(?:\?\?[^}]*)?!!\}/g;
        let match;
        while ((match = echoPattern.exec(content)) !== null) {
            const varName = match[1] || match[2];
            if (varName && !excludedVars.has(varName)) {
                // Check if this echo is inside an HTML attribute
                if (!isInsideHtmlAttribute(content, match.index)) {
                    echoedVars.add(varName);
                }
            }
        }

        // Step 3: Determine slots based on whether @props exists
        const slots = new Set<string>();

        if (declaredProps.size > 0) {
            // If @props exists, only props that are echoed standalone are slots
            for (const prop of declaredProps) {
                if (echoedVars.has(prop)) {
                    slots.add(prop);
                }
            }
        } else {
            // No @props - use standalone echoed variables as potential slots (fallback)
            for (const varName of echoedVars) {
                slots.add(varName);
            }
        }

        return Array.from(slots).map((name) => ({ name }));
    }

    /**
     * Check if a position in content is inside an HTML attribute value
     * e.g., class="{{ $var }}" - the {{ $var }} is inside an attribute
     */
    function isInsideHtmlAttribute(content: string, position: number): boolean {
        // Look backwards from position to find if we're inside attribute="..."
        // We need to find if there's an unclosed =" or =' before this position

        let i = position - 1;
        let inDoubleQuote = false;
        let inSingleQuote = false;

        // Scan backwards to find the context
        while (i >= 0) {
            const char = content[i];
            const prevChar = i > 0 ? content[i - 1] : '';

            if (char === '"' && prevChar === '=') {
                // Found ="
                inDoubleQuote = true;
                break;
            } else if (char === "'" && prevChar === '=') {
                // Found ='
                inSingleQuote = true;
                break;
            } else if (char === '"' && !inSingleQuote) {
                // Found closing " - we're not in an attribute
                break;
            } else if (char === "'" && !inDoubleQuote) {
                // Found closing ' - we're not in an attribute
                break;
            } else if (char === '>' || char === '<') {
                // Found tag boundary - we're not in an attribute
                break;
            }

            i--;
        }

        return inDoubleQuote || inSingleQuote;
    }
}

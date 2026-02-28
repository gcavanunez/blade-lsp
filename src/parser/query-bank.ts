export namespace ParserQueryBank {
    export const directives = `
    (directive) @directive
    (directive_start) @directive_start
    (directive_end) @directive_end
`;

    export const componentTagNames = `
    (start_tag (tag_name) @tag_name)
    (self_closing_tag (tag_name) @tag_name)
`;

    export const parameter = '(parameter) @parameter';
    export const phpOnly = '(php_only) @php_only';
    export const phpStatement = '(php_statement) @php_statement';
    export const comment = '(comment) @comment';
    export const directiveNodes = `(directive) @directive
    (directive_start) @directive_start
`;

    export const errorNodes = '(ERROR) @error';
    export const attributeNames = '(attribute_name) @attribute_name';
    export const directiveEnd = '(directive_end) @directive_end';

    const NODE_TYPE_QUERY: Partial<Record<string, string>> = {
        directive_start: '(directive_start) @node',
        attribute_value: '(attribute_value) @node',
        tag_name: '(tag_name) @node',
        attribute: '(attribute) @node',
        attribute_name: '(attribute_name) @node',
    };

    export function getByNodeType(type: string): string | undefined {
        return NODE_TYPE_QUERY[type];
    }
}

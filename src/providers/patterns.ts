export const VIEW_REFERENCE_DIRECTIVES = [
    'extends',
    'include',
    'includeIf',
    'includeWhen',
    'includeUnless',
    'includeFirst',
    'each',
    'component',
] as const;

export type ViewReferenceDirective = (typeof VIEW_REFERENCE_DIRECTIVES)[number];

const VIEW_REFERENCE_PATTERNS = new Map<ViewReferenceDirective, RegExp>(
    VIEW_REFERENCE_DIRECTIVES.map((directive) => {
        const pattern =
            directive === 'includeWhen' || directive === 'includeUnless'
                ? new RegExp(`@${directive}\\s*\\(\\s*(?:[^,]+,\\s*)?['"]([^'"]+)['"]`)
                : new RegExp(`@${directive}\\s*\\(\\s*['"]([^'"]+)['"]`);
        return [directive, pattern] as const;
    }),
);

export const VIEW_HELPER_PATTERN = /view\s*\(\s*['"]([^'"]+)['"]/;

export const COMPONENT_TAG_AT_CURSOR_PATTERN = /<(x-[\w.-]+(?:::[\w.-]+)?|[\w]+:[\w.-]+)/;
export const COMPONENT_PARTIAL_MATCH_PATTERN = /<(x-[\w.-]*(?:::[\w.-]*)?|[\w]+:[\w.-]*)$/;
export const LIVEWIRE_PARTIAL_MATCH_PATTERN = /<(livewire:[\w.-]*)$/;

const LIVEWIRE_TRIGGER_PATTERN = /<livewire:[\w.-]*$/;
const X_COMPONENT_TRIGGER_PATTERN = /<x-[\w.-]*(?:::[\w.-]*)?$/;
const NAMESPACED_COMPONENT_TRIGGER_PATTERN = /<[\w]+:[\w.-]*$/;

const SLOT_COMPLETION_COLON_PATTERN = /<x-slot:[\w-]*$/;
const SLOT_COMPLETION_NAME_PATTERN = /<x-slot\s+name=["'][\w-]*$/;

export const SLOT_DECLARATION_COLON_PATTERN = /<x-slot:([\w-]+)/;
export const SLOT_DECLARATION_NAME_PATTERN = /<x-slot\s+name=["']([\w-]+)["']/;

const FIRST_ARGUMENT_PARAMETER_DIRECTIVES = [
    'extends',
    'include',
    'includeIf',
    'includeFirst',
    'each',
    'component',
    'section',
    'yield',
    'can',
    'cannot',
    'canany',
    'env',
    'method',
    'push',
    'stack',
    'slot',
    'livewire',
] as const;

const SECOND_ARGUMENT_PARAMETER_DIRECTIVES = ['includeWhen', 'includeUnless'] as const;

interface DirectiveParameterMatcher {
    name: string;
    pattern: RegExp;
}

const DIRECTIVE_PARAMETER_MATCHERS: DirectiveParameterMatcher[] = [
    ...FIRST_ARGUMENT_PARAMETER_DIRECTIVES.map((name) => ({
        name,
        pattern: new RegExp(`@${name}\\s*\\(\\s*['\"]?[\\w.-]*$`),
    })),
    ...SECOND_ARGUMENT_PARAMETER_DIRECTIVES.map((name) => ({
        name,
        pattern: new RegExp(`@${name}\\s*\\([^,]+,\\s*['\"]?[\\w.-]*$`),
    })),
];

export function getViewReferencePattern(directive: ViewReferenceDirective): RegExp {
    return VIEW_REFERENCE_PATTERNS.get(directive)!;
}

export function createAttributePattern(): RegExp {
    return /(?::|)([\w-]+)(?:\s*=)?/g;
}

export function isLivewireTagCompletionTrigger(textBeforeCursor: string): boolean {
    return textBeforeCursor.endsWith('<livewire:') || LIVEWIRE_TRIGGER_PATTERN.test(textBeforeCursor);
}

export function isComponentTagCompletionTrigger(textBeforeCursor: string): boolean {
    return (
        textBeforeCursor.endsWith('<x-') ||
        X_COMPONENT_TRIGGER_PATTERN.test(textBeforeCursor) ||
        NAMESPACED_COMPONENT_TRIGGER_PATTERN.test(textBeforeCursor)
    );
}

export function getSlotCompletionSyntax(textBeforeCursor: string): 'colon' | 'name' | null {
    if (SLOT_COMPLETION_COLON_PATTERN.test(textBeforeCursor)) return 'colon';
    if (SLOT_COMPLETION_NAME_PATTERN.test(textBeforeCursor)) return 'name';
    return null;
}

export function getDirectiveParameterName(textBeforeCursor: string): string | null {
    for (const matcher of DIRECTIVE_PARAMETER_MATCHERS) {
        if (matcher.pattern.test(textBeforeCursor)) {
            return matcher.name;
        }
    }

    return null;
}

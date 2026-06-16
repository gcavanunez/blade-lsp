import { Diagnostic } from 'vscode-languageserver/node';

export namespace DiagnosticStore {
    export type Kind = 'syntax' | 'semantic';

    interface Bucket {
        syntax: Diagnostic[];
        semantic: Diagnostic[];
        merged: Diagnostic[];
        published: boolean;
    }

    export interface Store {
        update(uri: string, diagnostics: Record<Kind, Diagnostic[]>): Diagnostic[] | null;
        delete(uri: string): void;
    }

    function rangeEquals(a: Diagnostic['range'], b: Diagnostic['range']): boolean {
        return (
            a.start.line === b.start.line &&
            a.start.character === b.start.character &&
            a.end.line === b.end.line &&
            a.end.character === b.end.character
        );
    }

    function codeEquals(a: Diagnostic['code'], b: Diagnostic['code']): boolean {
        if (a === b) return true;
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function relatedInformationEquals(
        a: Diagnostic['relatedInformation'] | undefined,
        b: Diagnostic['relatedInformation'] | undefined,
    ): boolean {
        const left = a ?? [];
        const right = b ?? [];
        if (left.length !== right.length) return false;

        for (let i = 0; i < left.length; i++) {
            const li = left[i];
            const ri = right[i];

            if (li.message !== ri.message) return false;
            if (li.location.uri !== ri.location.uri) return false;
            if (!rangeEquals(li.location.range, ri.location.range)) return false;
        }

        return true;
    }

    function arrayEquals<T>(a: T[] | undefined, b: T[] | undefined, equals: (x: T, y: T) => boolean): boolean {
        const left = a ?? [];
        const right = b ?? [];
        if (left.length !== right.length) return false;

        for (let i = 0; i < left.length; i++) {
            if (!equals(left[i], right[i])) return false;
        }

        return true;
    }

    function diagnosticEquals(a: Diagnostic, b: Diagnostic): boolean {
        return (
            a.message === b.message &&
            a.severity === b.severity &&
            a.source === b.source &&
            codeEquals(a.code, b.code) &&
            rangeEquals(a.range, b.range) &&
            arrayEquals(a.tags, b.tags, (x, y) => x === y) &&
            relatedInformationEquals(a.relatedInformation, b.relatedInformation)
        );
    }

    function diagnosticsEqual(a: Diagnostic[], b: Diagnostic[]): boolean {
        return arrayEquals(a, b, diagnosticEquals);
    }

    function merge(bucket: Bucket): Diagnostic[] {
        return [...bucket.syntax, ...bucket.semantic];
    }

    export function create(): Store {
        const buckets = new Map<string, Bucket>();

        return {
            update(uri: string, diagnostics: Record<Kind, Diagnostic[]>): Diagnostic[] | null {
                const bucket = buckets.get(uri) ?? {
                    syntax: [],
                    semantic: [],
                    merged: [],
                    published: false,
                };

                bucket.syntax = diagnostics.syntax;
                bucket.semantic = diagnostics.semantic;

                const merged = merge(bucket);
                if (bucket.published && diagnosticsEqual(bucket.merged, merged)) {
                    buckets.set(uri, bucket);
                    return null;
                }

                bucket.merged = merged;
                bucket.published = true;
                buckets.set(uri, bucket);
                return merged;
            },

            delete(uri: string): void {
                buckets.delete(uri);
            },
        };
    }
}

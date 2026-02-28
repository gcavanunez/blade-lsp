import { describe, expect, it } from 'vitest';
import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { DiagnosticStore } from '../../src/providers/diagnostic-store';

function makeDiagnostic(message: string, line: number, code?: string): Diagnostic {
    return {
        message,
        range: Range.create(line, 0, line, 5),
        severity: DiagnosticSeverity.Warning,
        source: 'blade-lsp',
        code,
    };
}

describe('DiagnosticStore', () => {
    it('returns merged diagnostics on first update', () => {
        const store = DiagnosticStore.create();

        const merged = store.update('file:///a.blade.php', {
            syntax: [makeDiagnostic('syntax', 1)],
            semantic: [makeDiagnostic('semantic', 2, 'blade/undefined-view')],
        });

        expect(merged).toEqual([makeDiagnostic('syntax', 1), makeDiagnostic('semantic', 2, 'blade/undefined-view')]);
    });

    it('returns null when diagnostics are unchanged', () => {
        const store = DiagnosticStore.create();

        const payload = {
            syntax: [makeDiagnostic('syntax', 1)],
            semantic: [makeDiagnostic('semantic', 2)],
        };

        const first = store.update('file:///a.blade.php', payload);
        const second = store.update('file:///a.blade.php', payload);

        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });

    it('returns merged diagnostics after any kind changes', () => {
        const store = DiagnosticStore.create();

        store.update('file:///a.blade.php', {
            syntax: [makeDiagnostic('syntax', 1)],
            semantic: [makeDiagnostic('semantic', 2)],
        });

        const next = store.update('file:///a.blade.php', {
            syntax: [makeDiagnostic('syntax', 1)],
            semantic: [makeDiagnostic('semantic changed', 2)],
        });

        expect(next).toEqual([makeDiagnostic('syntax', 1), makeDiagnostic('semantic changed', 2)]);
    });

    it('resets state after delete', () => {
        const store = DiagnosticStore.create();

        store.update('file:///a.blade.php', {
            syntax: [makeDiagnostic('syntax', 1)],
            semantic: [],
        });

        store.delete('file:///a.blade.php');

        const merged = store.update('file:///a.blade.php', {
            syntax: [makeDiagnostic('syntax', 1)],
            semantic: [],
        });

        expect(merged).toEqual([makeDiagnostic('syntax', 1)]);
    });
});

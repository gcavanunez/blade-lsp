/**
 * Progress reporting utility for the Blade LSP.
 *
 * Wraps the LSP `window/workDoneProgress` protocol to provide
 * a clean API for reporting progress during long-running operations
 * (initialization, Laravel data refresh, file watcher re-indexing).
 *
 * Gracefully degrades when the client doesn't support progress:
 * all methods become no-ops, so callers don't need to check.
 */

import { Connection, WorkDoneProgressCreateRequest } from 'vscode-languageserver/node';

export namespace Progress {
    /** Whether the connected client supports `window/workDoneProgress`. */
    let supported = false;
    let conn: Connection | null = null;
    let tokenCounter = 0;

    /**
     * Call once during `onInitialize` to store the connection and
     * detect client capability.
     */
    export function initialize(connection: Connection, clientSupportsProgress: boolean): void {
        conn = connection;
        supported = clientSupportsProgress;
    }

    /**
     * A handle returned by `begin()` that can report incremental
     * progress and signal completion.
     */
    export interface Handle {
        /** Update the progress message and optional percentage (0-100). */
        report(message: string, percentage?: number): void;
        /** Signal that the operation is complete. */
        done(message?: string): void;
    }

    /** A no-op handle used when progress is not supported. */
    const noopHandle: Handle = {
        report() {},
        done() {},
    };

    /**
     * Start a new progress operation.
     *
     * If the client doesn't support progress, returns a no-op handle
     * so callers can use the same code path unconditionally.
     *
     * @param title  Short title shown in the editor (e.g. "Blade LSP")
     * @param message  Initial status message (e.g. "Initializing parser...")
     */
    export async function begin(title: string, message?: string): Promise<Handle> {
        if (!supported || !conn) {
            return noopHandle;
        }

        const token = `blade-lsp-progress-${++tokenCounter}`;

        try {
            await conn.sendRequest(WorkDoneProgressCreateRequest.type, { token });
        } catch {
            // Client rejected the progress token -- degrade gracefully
            return noopHandle;
        }

        conn.sendProgress(WorkDoneProgressCreateRequest.type, token, {
            kind: 'begin',
            title,
            message,
            cancellable: false,
        } as any);

        const handle: Handle = {
            report(msg: string, percentage?: number) {
                if (!conn) return;
                conn.sendProgress(WorkDoneProgressCreateRequest.type, token, {
                    kind: 'report',
                    message: msg,
                    ...(percentage !== undefined ? { percentage } : {}),
                } as any);
            },
            done(msg?: string) {
                if (!conn) return;
                conn.sendProgress(WorkDoneProgressCreateRequest.type, token, {
                    kind: 'end',
                    message: msg,
                } as any);
            },
        };

        return handle;
    }
}

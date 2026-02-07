/**
 * LSP client emulator for testing blade-lsp.
 *
 * Provides a high-level API for sending LSP requests and receiving responses
 * through an in-memory connection. Modeled after tailwindcss-intellisense's
 * test client but simplified for blade-lsp's feature set.
 */

import {
    InitializeRequest,
    InitializedNotification,
    ShutdownRequest,
    ExitNotification,
    DidOpenTextDocumentNotification,
    DidChangeTextDocumentNotification,
    DidCloseTextDocumentNotification,
    HoverRequest,
    CompletionRequest,
    DefinitionRequest,
    PublishDiagnosticsNotification,
    RegistrationRequest,
    ConfigurationRequest,
    type InitializeParams,
    type InitializeResult,
    type Hover,
    type CompletionItem,
    type Location,
    type Diagnostic,
    type PublishDiagnosticsParams,
    type TextDocumentSyncKind,
    TextDocumentSyncKind as SyncKind,
} from 'vscode-languageserver/node';
import type { ProtocolConnection } from 'vscode-languageclient';
import { connect, type ConnectResult } from './connection';
import { Server } from '../../src/server';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClientOptions {
    /** Root URI of the workspace (default: 'file:///test/project') */
    rootUri?: string;
    /** Settings passed as initializationOptions */
    settings?: Server.Settings;
}

export interface DocumentDescriptor {
    /** Language ID (default: 'blade') */
    lang?: string;
    /** File content */
    text: string;
    /** File name within workspace (default: auto-generated) */
    name?: string;
}

export interface ClientDocument {
    /** The document URI */
    uri: string;
    /** Send a hover request at the given position */
    hover(line: number, character: number): Promise<Hover | null>;
    /** Send a completion request at the given position */
    completions(line: number, character: number): Promise<CompletionItem[]>;
    /** Send a definition request at the given position */
    definition(line: number, character: number): Promise<Location | Location[] | null>;
    /** Get the latest diagnostics for this document */
    diagnostics(): Promise<Diagnostic[]>;
    /** Update the document content */
    update(text: string): Promise<void>;
    /** Close the document */
    close(): Promise<void>;
}

export interface Client {
    /** The raw protocol connection (for advanced usage) */
    connection: ProtocolConnection;
    /** The initialization result from the server */
    initializeResult: InitializeResult;
    /** Open a document and return a ClientDocument handle */
    open(desc: DocumentDescriptor): Promise<ClientDocument>;
    /** Shut down the server and clean up */
    shutdown(): Promise<void>;
}

// ─── Implementation ─────────────────────────────────────────────────────────

let docCounter = 0;

/**
 * Create a test client connected to the blade-lsp server.
 *
 * This initializes the full LSP handshake (initialize + initialized)
 * and returns a Client object for interacting with the server.
 */
export async function createClient(options: ClientOptions = {}): Promise<Client> {
    const rootUri = options.rootUri ?? 'file:///test/project';
    const settings = options.settings ?? {
        parserBackend: 'wasm',
        enableLaravelIntegration: false,
    };

    const { clientConnection, dispose } = connect();

    // Track diagnostics per document URI
    const diagnosticsMap = new Map<string, Diagnostic[]>();
    const diagnosticsWaiters = new Map<string, Array<(diags: Diagnostic[]) => void>>();

    // Handle server → client requests
    (clientConnection as any).onRequest(ConfigurationRequest.type, () => {
        return [settings];
    });

    // Handle dynamic capability registration (file watchers etc.)
    (clientConnection as any).onRequest(RegistrationRequest.type, () => {
        return;
    });

    // Capture diagnostics notifications
    (clientConnection as any).onNotification(
        PublishDiagnosticsNotification.type,
        (params: PublishDiagnosticsParams) => {
            diagnosticsMap.set(params.uri, params.diagnostics);

            // Resolve any waiters
            const waiters = diagnosticsWaiters.get(params.uri);
            if (waiters) {
                for (const resolve of waiters) {
                    resolve(params.diagnostics);
                }
                diagnosticsWaiters.delete(params.uri);
            }
        },
    );

    // Suppress window/logMessage notifications
    (clientConnection as any).onNotification('window/logMessage', () => {});

    // Suppress window/workDoneProgress/create requests
    (clientConnection as any).onRequest('window/workDoneProgress/create', () => {
        return;
    });

    // Suppress $/progress notifications
    (clientConnection as any).onNotification('$/progress', () => {});

    // Send initialize request
    const initParams: InitializeParams = {
        processId: process.pid,
        rootUri,
        capabilities: {
            textDocument: {
                hover: {
                    contentFormat: ['markdown', 'plaintext'],
                },
                completion: {
                    completionItem: {
                        snippetSupport: true,
                        documentationFormat: ['markdown', 'plaintext'],
                    },
                },
                definition: {},
                publishDiagnostics: {
                    relatedInformation: true,
                },
                synchronization: {
                    didSave: true,
                    dynamicRegistration: true,
                },
            },
            workspace: {
                didChangeWatchedFiles: {
                    dynamicRegistration: true,
                },
                configuration: true,
            },
        },
        initializationOptions: settings,
        workspaceFolders: [
            {
                uri: rootUri,
                name: 'test',
            },
        ],
    };

    const initializeResult = await (clientConnection as any).sendRequest(InitializeRequest.type, initParams);

    // Send initialized notification
    await (clientConnection as any).sendNotification(InitializedNotification.type, {});

    // Wait for server to fully initialize (parser WASM load + onInitialized handler)
    // The onInitialize handler is async (loads WASM parser), and onInitialized
    // may also run async tasks. We need to wait for both to complete.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // ─── Client Document Factory ────────────────────────────────────────

    function createDocument(uri: string, version: number): ClientDocument {
        let currentVersion = version;

        return {
            uri,

            async hover(line: number, character: number): Promise<Hover | null> {
                return (clientConnection as any).sendRequest(HoverRequest.type, {
                    textDocument: { uri },
                    position: { line, character },
                });
            },

            async completions(line: number, character: number): Promise<CompletionItem[]> {
                const result = await (clientConnection as any).sendRequest(CompletionRequest.type, {
                    textDocument: { uri },
                    position: { line, character },
                });

                // Completion can return CompletionItem[] or CompletionList
                if (Array.isArray(result)) return result;
                if (result && 'items' in result) return result.items;
                return [];
            },

            async definition(line: number, character: number): Promise<Location | Location[] | null> {
                return (clientConnection as any).sendRequest(DefinitionRequest.type, {
                    textDocument: { uri },
                    position: { line, character },
                });
            },

            async diagnostics(): Promise<Diagnostic[]> {
                // Return cached diagnostics if available
                const cached = diagnosticsMap.get(uri);
                if (cached) return cached;

                // Wait for next diagnostics notification
                return new Promise((resolve) => {
                    const waiters = diagnosticsWaiters.get(uri) ?? [];
                    waiters.push(resolve);
                    diagnosticsWaiters.set(uri, waiters);

                    // Timeout after 5 seconds
                    setTimeout(() => {
                        const currentWaiters = diagnosticsWaiters.get(uri);
                        if (currentWaiters) {
                            const idx = currentWaiters.indexOf(resolve);
                            if (idx >= 0) {
                                currentWaiters.splice(idx, 1);
                                resolve([]);
                            }
                        }
                    }, 5000);
                });
            },

            async update(text: string): Promise<void> {
                currentVersion++;
                // Clear cached diagnostics so the next call waits for fresh ones
                diagnosticsMap.delete(uri);

                await (clientConnection as any).sendNotification(DidChangeTextDocumentNotification.type, {
                    textDocument: { uri, version: currentVersion },
                    contentChanges: [{ text }],
                });

                // Small delay for server to process
                await new Promise((resolve) => setTimeout(resolve, 50));
            },

            async close(): Promise<void> {
                diagnosticsMap.delete(uri);
                diagnosticsWaiters.delete(uri);

                await (clientConnection as any).sendNotification(DidCloseTextDocumentNotification.type, {
                    textDocument: { uri },
                });
            },
        };
    }

    // ─── Client API ─────────────────────────────────────────────────────

    return {
        connection: clientConnection,
        initializeResult,

        async open(desc: DocumentDescriptor): Promise<ClientDocument> {
            const lang = desc.lang ?? 'blade';
            const name = desc.name ?? `test-${++docCounter}.blade.php`;
            const uri = `${rootUri}/${name}`;
            const version = 1;

            await (clientConnection as any).sendNotification(DidOpenTextDocumentNotification.type, {
                textDocument: {
                    uri,
                    languageId: lang,
                    version,
                    text: desc.text,
                },
            });

            // Small delay for server to process (parse, diagnostics)
            await new Promise((resolve) => setTimeout(resolve, 50));

            return createDocument(uri, version);
        },

        async shutdown(): Promise<void> {
            try {
                await (clientConnection as any).sendRequest(ShutdownRequest.type);
                await (clientConnection as any).sendNotification(ExitNotification.type);
            } catch {
                // Connection may already be closed
            }

            dispose();
        },
    };
}

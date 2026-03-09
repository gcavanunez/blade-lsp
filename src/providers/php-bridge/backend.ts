import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import {
    createProtocolConnection,
    StreamMessageReader,
    StreamMessageWriter,
    type CompletionItem,
    type CompletionList,
    type Hover,
    type Location,
    type Position,
} from 'vscode-languageserver/node';

export namespace PhpBridgeBackend {
    export type BackendName = 'intelephense' | 'phpactor';

    export interface ShadowDocumentTransport {
        uri: string;
        version: number;
        text: string;
    }

    export interface BackendConfig {
        backendName: BackendName;
        command: string[];
        workspaceRoot: string;
        settings?: {
            intelephense?: {
                globalStoragePath?: string;
                storagePath?: string;
                files?: {
                    maxSize?: number;
                };
            };
        };
        logger?: {
            log(message: string): void;
            error(message: string): void;
        };
    }

    export interface Client {
        start(): Promise<void>;
        openOrUpdate(document: ShadowDocumentTransport): Promise<void>;
        hover(uri: string, position: Position): Promise<Hover | null>;
        definition(uri: string, position: Position): Promise<Location | Location[] | null>;
        completion(uri: string, position: Position): Promise<CompletionItem[] | CompletionList | null>;
        resolveCompletion(item: CompletionItem): Promise<CompletionItem | null>;
        shutdown(): Promise<void>;
    }

    function workspaceUri(workspaceRoot: string): string {
        const normalized = workspaceRoot.split(path.sep).join('/');
        return `file://${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
    }

    export function resolveDefaultCommand(backendName: BackendName): string[] {
        return backendName === 'phpactor' ? ['phpactor', 'language-server'] : ['intelephense', '--stdio'];
    }

    export function createLspClient(config: BackendConfig): Client {
        let processRef: ChildProcessWithoutNullStreams | null = null;
        let connection: ReturnType<typeof createProtocolConnection> | null = null;
        let started = false;
        const openVersions = new Map<string, number>();
        let indexing = false;

        function getConfiguration() {
            return config.settings ?? {};
        }

        async function ensureStarted(): Promise<void> {
            if (started) return;

            const [command, ...args] = config.command;
            processRef = spawn(command, args, {
                cwd: config.workspaceRoot,
                stdio: 'pipe',
            });

            connection = createProtocolConnection(
                new StreamMessageReader(processRef.stdout),
                new StreamMessageWriter(processRef.stdin),
            );
            connection.onRequest('workspace/configuration', () => [getConfiguration()]);
            connection.onNotification('indexingStarted', () => {
                indexing = true;
                config.logger?.log(`[php-bridge:${config.backendName}] indexing started`);
            });
            connection.onNotification('indexingEnded', () => {
                indexing = false;
                config.logger?.log(`[php-bridge:${config.backendName}] indexing ended`);
            });
            connection.listen();

            await connection.sendRequest('initialize', {
                processId: process.pid,
                rootUri: workspaceUri(config.workspaceRoot),
                capabilities: {
                    workspace: {
                        configuration: true,
                    },
                },
                initializationOptions: getConfiguration(),
                workspaceFolders: [
                    {
                        uri: workspaceUri(config.workspaceRoot),
                        name: path.basename(config.workspaceRoot),
                    },
                ],
            });
            connection.sendNotification('initialized', {});
            started = true;
        }

        return {
            async start() {
                await ensureStarted();
            },

            async openOrUpdate(document) {
                await ensureStarted();
                if (!connection) return;

                const knownVersion = openVersions.get(document.uri);
                if (knownVersion === undefined) {
                    connection.sendNotification('textDocument/didOpen', {
                        textDocument: {
                            uri: document.uri,
                            languageId: 'php',
                            version: document.version,
                            text: document.text,
                        },
                    });
                } else {
                    connection.sendNotification('textDocument/didChange', {
                        textDocument: {
                            uri: document.uri,
                            version: document.version,
                        },
                        contentChanges: [{ text: document.text }],
                    });
                }

                openVersions.set(document.uri, document.version);
            },

            async hover(uri, position) {
                await ensureStarted();
                return connection
                    ? ((await connection.sendRequest('textDocument/hover', {
                          textDocument: { uri },
                          position,
                      })) as Hover | null)
                    : null;
            },

            async definition(uri, position) {
                await ensureStarted();
                return connection
                    ? ((await connection.sendRequest('textDocument/definition', {
                          textDocument: { uri },
                          position,
                      })) as Location | Location[] | null)
                    : null;
            },

            async completion(uri, position) {
                await ensureStarted();
                if (indexing) {
                    config.logger?.log(`[php-bridge:${config.backendName}] completion requested while indexing`);
                }
                return connection
                    ? ((await connection.sendRequest('textDocument/completion', {
                          textDocument: { uri },
                          position,
                      })) as CompletionItem[] | CompletionList | null)
                    : null;
            },

            async resolveCompletion(item) {
                await ensureStarted();
                return connection
                    ? ((await connection.sendRequest('completionItem/resolve', item)) as CompletionItem | null)
                    : null;
            },

            async shutdown() {
                if (!connection || !processRef) {
                    started = false;
                    connection = null;
                    processRef = null;
                    openVersions.clear();
                    return;
                }

                try {
                    await connection.sendRequest('shutdown');
                } catch {
                    // Ignore shutdown transport failures and continue cleanup.
                }

                try {
                    connection.sendNotification('exit');
                } catch {
                    // Ignore exit transport failures and continue cleanup.
                }

                processRef.kill();
                connection.dispose();
                started = false;
                connection = null;
                processRef = null;
                openVersions.clear();
            },
        };
    }
}

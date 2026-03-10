import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    CompletionTriggerKind,
    createProtocolConnection,
    StreamMessageReader,
    StreamMessageWriter,
    type CompletionContext,
    type CompletionItem,
    type CompletionList,
    type Hover,
    type Location,
    type Position,
} from 'vscode-languageserver/node';

export namespace PhpBridgeBackend {
    const execFileAsync = promisify(execFile);

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
        initializationOptions?: Record<string, unknown>;
        settings?: {
            intelephense?: {
                globalStoragePath?: string;
                storagePath?: string;
                client?: {
                    autoCloseDocCommentDoSuggest?: boolean;
                };
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
        completion(
            uri: string,
            position: Position,
            context?: CompletionContext,
        ): Promise<CompletionItem[] | CompletionList | null>;
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

    function expandPhpactorTokens(value: string, tokens: Record<string, string>): string {
        let result = value;
        for (const [token, replacement] of Object.entries(tokens)) {
            result = result.replaceAll(token, replacement);
        }
        return result;
    }

    async function preparePhpactorCacheDirectories(config: BackendConfig): Promise<void> {
        const [command] = config.command;
        try {
            const { stdout } = await execFileAsync(command, ['config:dump'], {
                cwd: config.workspaceRoot,
                env: process.env,
                maxBuffer: 10 * 1024 * 1024,
            });

            const projectIdMatch = stdout.match(/%project_id%:\s*(.+)/);
            const cacheMatch = stdout.match(/%cache%:\s*(.+)/);
            if (!projectIdMatch || !cacheMatch) {
                return;
            }

            const jsonStart = stdout.indexOf('{');
            if (jsonStart === -1) {
                return;
            }

            const configDump = JSON.parse(stdout.slice(jsonStart)) as Record<string, unknown>;
            const indexPath =
                typeof configDump['indexer.index_path'] === 'string' ? configDump['indexer.index_path'] : null;
            const worseReflectionPath =
                typeof configDump['worse_reflection.cache_dir'] === 'string'
                    ? configDump['worse_reflection.cache_dir']
                    : null;

            const tokens = {
                '%project_id%': projectIdMatch[1].trim(),
                '%cache%': cacheMatch[1].trim(),
            };

            const directories = [
                indexPath ? expandPhpactorTokens(indexPath, tokens) : null,
                worseReflectionPath ? expandPhpactorTokens(worseReflectionPath, tokens) : null,
            ].filter((value): value is string => !!value);

            for (const directory of directories) {
                await mkdir(directory, { recursive: true });
                config.logger?.log(`[php-bridge:${config.backendName}] prepared cache dir ${directory}`);
            }
        } catch (error) {
            config.logger?.error(`[php-bridge:${config.backendName}] cache prep failed: ${String(error)}`);
        }
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

        function getConfigurationValue(section?: string): unknown {
            if (!section) {
                return getConfiguration();
            }

            return section.split('.').reduce<unknown>((current, key) => {
                if (!current || typeof current !== 'object') {
                    return undefined;
                }
                return (current as Record<string, unknown>)[key];
            }, getConfiguration());
        }

        async function ensureStarted(): Promise<void> {
            if (started) return;

            const [command, ...args] = config.command;
            if (config.backendName === 'phpactor') {
                await preparePhpactorCacheDirectories(config);
            }
            config.logger?.log(`[php-bridge:${config.backendName}] spawning backend: ${[command, ...args].join(' ')}`);
            processRef = spawn(command, args, {
                cwd: config.workspaceRoot,
                stdio: 'pipe',
            });

            processRef.stderr.on('data', (chunk) => {
                const text = chunk.toString().trim();
                if (text) {
                    config.logger?.error(`[php-bridge:${config.backendName}] stderr: ${text}`);
                }
            });
            processRef.on('exit', (code, signal) => {
                config.logger?.log(
                    `[php-bridge:${config.backendName}] exited code=${String(code)} signal=${String(signal)}`,
                );
            });
            processRef.on('error', (error) => {
                config.logger?.error(`[php-bridge:${config.backendName}] process error: ${String(error)}`);
            });

            connection = createProtocolConnection(
                new StreamMessageReader(processRef.stdout),
                new StreamMessageWriter(processRef.stdin),
            );
            connection.onRequest(
                'workspace/configuration',
                (params: { items?: Array<{ section?: string }> } | undefined) =>
                    (params?.items ?? []).map((item) => getConfigurationValue(item.section)),
            );
            connection.onNotification('indexingStarted', () => {
                indexing = true;
                config.logger?.log(`[php-bridge:${config.backendName}] indexing started`);
            });
            connection.onNotification('indexingEnded', () => {
                indexing = false;
                config.logger?.log(`[php-bridge:${config.backendName}] indexing ended`);
            });
            connection.listen();

            const initializeResult = await connection.sendRequest('initialize', {
                processId: process.pid,
                rootUri: workspaceUri(config.workspaceRoot),
                capabilities: {
                    workspace: {
                        configuration: true,
                        workspaceFolders: true,
                    },
                    textDocument: {
                        completion: {
                            completionItem: {
                                snippetSupport: true,
                                documentationFormat: ['markdown', 'plaintext'],
                                insertReplaceSupport: true,
                                labelDetailsSupport: true,
                                resolveSupport: {
                                    properties: ['documentation', 'detail', 'additionalTextEdits', 'command', 'data'],
                                },
                            },
                            completionList: {
                                itemDefaults: [
                                    'commitCharacters',
                                    'editRange',
                                    'insertTextFormat',
                                    'insertTextMode',
                                    'data',
                                ],
                            },
                            contextSupport: true,
                        },
                        hover: {
                            contentFormat: ['markdown', 'plaintext'],
                        },
                    },
                },
                initializationOptions: config.initializationOptions ?? {},
                workspaceFolders: [
                    {
                        uri: workspaceUri(config.workspaceRoot),
                        name: path.basename(config.workspaceRoot),
                    },
                ],
            });
            config.logger?.log(
                `[php-bridge:${config.backendName}] initialize result: ${JSON.stringify(initializeResult)}`,
            );
            connection.sendNotification('initialized', {});
            connection.sendNotification('workspace/didChangeConfiguration', {
                settings: getConfiguration(),
            });

            if (config.backendName === 'intelephense') {
                try {
                    const result = await connection.sendRequest('workspace/executeCommand', {
                        command: 'intelephense.index.workspace',
                    });
                    config.logger?.log(
                        `[php-bridge:${config.backendName}] index.workspace result: ${JSON.stringify(result)}`,
                    );
                } catch (error) {
                    config.logger?.error(`[php-bridge:${config.backendName}] index.workspace failed: ${String(error)}`);
                }
            }
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
                    config.logger?.log(
                        `[php-bridge:${config.backendName}] didOpen ${document.uri} v${document.version}`,
                    );
                    connection.sendNotification('textDocument/didOpen', {
                        textDocument: {
                            uri: document.uri,
                            languageId: 'php',
                            version: document.version,
                            text: document.text,
                        },
                    });
                } else {
                    config.logger?.log(
                        `[php-bridge:${config.backendName}] didChange ${document.uri} v${document.version}`,
                    );
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
                if (!connection) return null;

                const result = (await connection.sendRequest('textDocument/definition', {
                    textDocument: { uri },
                    position,
                })) as Location | Location[] | null;
                config.logger?.log(
                    `[php-bridge:${config.backendName}] definition ${uri} @ ${position.line}:${position.character} -> ${JSON.stringify(result)}`,
                );
                return result;
            },

            async completion(uri, position, context) {
                await ensureStarted();
                if (indexing) {
                    config.logger?.log(`[php-bridge:${config.backendName}] completion requested while indexing`);
                }
                if (!connection) return null;

                const result = (await connection.sendRequest('textDocument/completion', {
                    textDocument: { uri },
                    position,
                    context: context ?? {
                        triggerKind: CompletionTriggerKind.Invoked,
                    },
                })) as CompletionItem[] | CompletionList | null;
                const items = Array.isArray(result) ? result : (result?.items ?? []);
                config.logger?.log(
                    `[php-bridge:${config.backendName}] completion ${uri} @ ${position.line}:${position.character} -> ${items.length} items (${items
                        .slice(0, 10)
                        .map((item) => item.label)
                        .join(', ')})`,
                );
                return result;
            },

            async resolveCompletion(item) {
                await ensureStarted();
                if (!connection) return null;

                const result = (await connection.sendRequest('completionItem/resolve', item)) as CompletionItem | null;
                config.logger?.log(
                    `[php-bridge:${config.backendName}] resolveCompletion ${item.label} -> ${JSON.stringify({
                        textEdit: result && 'textEdit' in result ? result.textEdit : undefined,
                        additionalTextEdits: result?.additionalTextEdits,
                    })}`,
                );
                return result;
            },

            async shutdown() {
                if (!connection || !processRef) {
                    started = false;
                    connection = null;
                    processRef = null;
                    openVersions.clear();
                    return;
                }

                const activeConnection = connection;
                const activeProcess = processRef;

                try {
                    await activeConnection.sendRequest('shutdown');
                } catch {
                    // Ignore shutdown transport failures and continue cleanup.
                }

                if (activeProcess.exitCode === null && !activeProcess.killed) {
                    activeProcess.kill();
                }

                activeConnection.dispose();
                started = false;
                connection = null;
                processRef = null;
                openVersions.clear();
            },
        };
    }
}

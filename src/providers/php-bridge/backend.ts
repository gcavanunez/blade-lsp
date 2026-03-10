import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
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
        waitForReady(timeoutMs?: number): Promise<boolean>;
        onReady(callback: () => void): void;
        openOrUpdate(document: ShadowDocumentTransport): Promise<void>;
        /** Close and re-open a document so the backend fully re-analyzes it.
         *  Useful after indexing completes — some backends (intelephense) don't
         *  re-analyze files on `didChange` if they were opened pre-index. */
        reopen(document: ShadowDocumentTransport): Promise<void>;
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
        const binary = backendName === 'phpactor' ? 'phpactor' : 'intelephense';
        const args = backendName === 'phpactor' ? ['language-server'] : ['--stdio'];

        // Check Mason bin path first — Mason installs LSP servers here via nvim
        const masonBin = path.join(os.homedir(), '.local', 'share', 'nvim', 'mason', 'bin', binary);
        if (existsSync(masonBin)) {
            return [masonBin, ...args];
        }

        // Fall back to bare command name (relies on $PATH)
        return [binary, ...args];
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

        // Track $/progress tokens for indexing work-done progress
        const activeProgressTokens = new Set<string | number>();
        let indexingEverStarted = false;
        const readyCallbacks: Array<() => void> = [];

        function checkReady(): void {
            if (indexingEverStarted && activeProgressTokens.size === 0 && !indexing) {
                const count = readyCallbacks.length;
                for (const callback of readyCallbacks.splice(0)) {
                    callback();
                }
                if (count > 0) {
                    config.logger?.log(`[php-bridge:${config.backendName}] fired ${count} ready callbacks`);
                }
            }
        }

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
            // phpactor sends window/workDoneProgress/create before $/progress notifications.
            // We must acknowledge this request or phpactor will hang waiting for the response.
            connection.onRequest('window/workDoneProgress/create', () => {
                return null;
            });
            connection.onNotification('indexingStarted', () => {
                indexing = true;
                indexingEverStarted = true;
                config.logger?.log(`[php-bridge:${config.backendName}] indexing started`);
            });
            connection.onNotification('indexingEnded', () => {
                indexing = false;
                config.logger?.log(`[php-bridge:${config.backendName}] indexing ended`);
                checkReady();
            });
            connection.onNotification(
                '$/progress',
                (params: {
                    token: string | number;
                    value: { kind: 'begin' | 'report' | 'end'; title?: string; message?: string; percentage?: number };
                }) => {
                    if (params.value.kind === 'begin') {
                        activeProgressTokens.add(params.token);
                        indexingEverStarted = true;
                        config.logger?.log(
                            `[php-bridge:${config.backendName}] progress begin: ${params.value.title ?? ''} (${String(params.token)})`,
                        );
                    } else if (params.value.kind === 'end') {
                        activeProgressTokens.delete(params.token);
                        config.logger?.log(
                            `[php-bridge:${config.backendName}] progress end: (${String(params.token)})`,
                        );
                        checkReady();
                    }
                },
            );
            // Catch-all for any unhandled requests from the backend (e.g.
            // window/showMessageRequest).  Return null so the backend doesn't hang.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            (connection as any).onRequest((method: string, params: unknown) => {
                config.logger?.log(
                    `[php-bridge:${config.backendName}] unhandled request: ${method} ${JSON.stringify(params)?.slice(0, 300)}`,
                );
                return null;
            });
            // Catch-all for unhandled notifications.  Detects indexer crashes
            // so we can treat them as degraded-ready rather than hanging forever.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            (connection as any).onNotification((method: string, params: unknown) => {
                // Detect indexer crash: phpactor sends a window/showMessage with
                // type=1 (Error) mentioning the indexer service.  When this happens,
                // the indexer will never send $/progress end, so we need to treat
                // it as a degraded "ready" state.
                if (
                    method === 'window/showMessage' &&
                    typeof params === 'object' &&
                    params !== null &&
                    'message' in params &&
                    typeof (params as { message: unknown }).message === 'string' &&
                    (params as { message: string }).message.includes('Error in service "indexer"')
                ) {
                    config.logger?.error(
                        `[php-bridge:${config.backendName}] indexer service crashed — treating as degraded ready`,
                    );
                    // Clear the indexing progress token since the indexer won't
                    // send $/progress end after a crash
                    activeProgressTokens.clear();
                    indexing = false;
                    checkReady();
                }
            });
            connection.listen();

            const initializeResult = await connection.sendRequest('initialize', {
                processId: process.pid,
                rootUri: workspaceUri(config.workspaceRoot),
                capabilities: {
                    window: {
                        workDoneProgress: true,
                    },
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

            onReady(callback: () => void) {
                // If already ready, fire immediately
                if (indexingEverStarted && activeProgressTokens.size === 0 && !indexing) {
                    callback();
                    return;
                }
                readyCallbacks.push(callback);
            },

            async waitForReady(timeoutMs = 180_000) {
                await ensureStarted();

                // Already ready: indexing started and finished with no active progress tokens
                if (indexingEverStarted && activeProgressTokens.size === 0 && !indexing) {
                    return true;
                }

                // If indexing hasn't started yet, wait a short time for it to begin
                if (!indexingEverStarted) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
                    if (!indexingEverStarted) {
                        // Backend may not emit progress (e.g., empty project) — consider ready
                        config.logger?.log(`[php-bridge:${config.backendName}] no indexing detected, assuming ready`);
                        return true;
                    }
                }

                return new Promise<boolean>((resolve) => {
                    const timer = setTimeout(() => {
                        config.logger?.log(
                            `[php-bridge:${config.backendName}] waitForReady timed out after ${timeoutMs}ms`,
                        );
                        resolve(false);
                    }, timeoutMs);

                    readyCallbacks.push(() => {
                        clearTimeout(timer);
                        config.logger?.log(`[php-bridge:${config.backendName}] indexer ready`);
                        resolve(true);
                    });

                    // Check again — race between the check above and registering the callback
                    if (indexingEverStarted && activeProgressTokens.size === 0 && !indexing) {
                        clearTimeout(timer);
                        resolve(true);
                    }
                });
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

            async reopen(document) {
                await ensureStarted();
                if (!connection) return;

                // Close the document first if it's already open
                if (openVersions.has(document.uri)) {
                    config.logger?.log(`[php-bridge:${config.backendName}] didClose (reopen) ${document.uri}`);
                    connection.sendNotification('textDocument/didClose', {
                        textDocument: { uri: document.uri },
                    });
                    openVersions.delete(document.uri);
                }

                // Re-open with fresh state
                config.logger?.log(
                    `[php-bridge:${config.backendName}] didOpen (reopen) ${document.uri} v${document.version}`,
                );
                connection.sendNotification('textDocument/didOpen', {
                    textDocument: {
                        uri: document.uri,
                        languageId: 'php',
                        version: document.version,
                        text: document.text,
                    },
                });
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

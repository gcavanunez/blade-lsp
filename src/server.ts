#!/usr/bin/env node
import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    CompletionItem,
    Hover,
    Diagnostic,
    DiagnosticSeverity,
    MarkupKind,
    MessageType,
    Position,
    TextDocumentPositionParams,
    Location,
    DefinitionParams,
    Connection,
    DidChangeWatchedFilesNotification,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BladeParser } from './parser';
import { BladeDirectives } from './directives';
import { Laravel } from './laravel/index';
import { LaravelContext } from './laravel/context';
import { Directives } from './laravel/directives';
import { Views } from './laravel/views';
import { Components } from './laravel/components';
import { PhpEnvironment } from './laravel/php-environment';
import { FormatError, FormatErrorForLog } from './utils/format-error';
import { Progress } from './utils/progress';
import { Completions } from './providers/completions';
import { Hovers } from './providers/hovers';
import { Definitions } from './providers/definitions';
import { Diagnostics } from './providers/diagnostics';
import { Watcher } from './watcher';

export namespace Server {
    export interface Settings {
        // Command array to execute PHP (defaults to auto-detect if not provided)
        // Examples:
        //   - Local: ['php'] or ['/usr/bin/php']
        //   - Docker: ['docker', 'compose', 'exec', 'app', 'php']
        //   - Sail: ['./vendor/bin/sail', 'php']
        phpCommand?: string[];
        // Preferred PHP environment (e.g., 'sail', 'herd', 'docker').
        // If set, skips auto-detection and tries only this environment.
        phpEnvironment?: PhpEnvironment.Name;
        enableLaravelIntegration?: boolean;
        // Parser backend: 'wasm' (web-tree-sitter) or 'native' (node-gyp).
        // Defaults to 'wasm'. Use 'native' for local development with node-gyp bindings.
        parserBackend?: 'native' | 'wasm';
    }

    let connection: Connection | undefined;
    let documents: TextDocuments<TextDocument> | undefined;
    let treeCache: Map<string, BladeParser.Tree> | undefined;
    let workspaceRoot: string | null = null;
    let settings: Settings = {};
    let hasWatchedFileCapability = false;

    /**
     * Run `fn` within the Laravel context scope if available, otherwise run directly.
     * This ensures all `LaravelContext.use()` calls inside handlers resolve correctly.
     */
    function withContext<R>(fn: () => R): R {
        if (LaravelContext.isAvailable()) {
            return LaravelContext.provide(fn);
        }
        return fn();
    }

    function getConnection(): Connection {
        return connection ?? (connection = createConnection(ProposedFeatures.all));
    }

    function getDocuments(): TextDocuments<TextDocument> {
        return documents ?? (documents = new TextDocuments(TextDocument));
    }

    function getTreeCache(): Map<string, BladeParser.Tree> {
        return treeCache ?? (treeCache = new Map<string, BladeParser.Tree>());
    }

    export function getWorkspaceRoot(): string | null {
        return workspaceRoot;
    }

    // Parse document and cache the tree
    function parseDocument(document: TextDocument): BladeParser.Tree {
        const tree = BladeParser.parse(document.getText());
        getTreeCache().set(document.uri, tree);
        return tree;
    }

    const build = (externalConn?: Connection) => {
        const conn = externalConn ?? getConnection();
        connection = conn;
        const docs = getDocuments();
        const cache = getTreeCache();

        conn.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
            // Store workspace root for Laravel detection
            workspaceRoot = params.rootUri ? params.rootUri.replace('file://', '') : params.rootPath || null;

            // Get initialization options (settings passed from client)
            const initOptions = params.initializationOptions as Settings | undefined;
            if (initOptions) {
                settings = initOptions;
                conn.console.log(`Settings received: ${JSON.stringify(settings)}`);
            }

            // Detect client capability for file watching
            hasWatchedFileCapability = !!params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;

            // Detect client capability for progress reporting
            const supportsProgress = !!params.capabilities.window?.workDoneProgress;
            Progress.initialize(conn, supportsProgress);

            // Initialize the tree-sitter parser
            const backend = settings.parserBackend ?? 'native';
            try {
                await BladeParser.initialize(backend);
                conn.console.log(`Tree-sitter Blade parser initialized (${backend} backend)`);
            } catch (error) {
                conn.console.error(`Failed to initialize parser: ${FormatErrorForLog(error)}`);
            }

            return {
                capabilities: {
                    textDocumentSync: TextDocumentSyncKind.Incremental,
                    completionProvider: {
                        resolveProvider: true,
                        triggerCharacters: ['@', "'", '"', '$', '{', '<', ':', ' '],
                    },
                    hoverProvider: true,
                    definitionProvider: true,
                },
            };
        });

        conn.onInitialized(async () => {
            conn.console.log('Laravel Blade LSP initialized');

            const progress = await Progress.begin('Blade LSP', 'Initializing...');

            // Register file watchers if the client supports it
            if (hasWatchedFileCapability) {
                conn.client.register(DidChangeWatchedFilesNotification.type, {
                    watchers: Watcher.getWatchers(),
                });
                conn.console.log('File watchers registered');
            }

            // Check if Laravel integration is disabled
            if (settings.enableLaravelIntegration === false) {
                conn.console.log('Laravel integration disabled via settings');
                progress.done('Ready (static mode)');
                return;
            }

            // Initialize Laravel integration if workspace is available
            if (workspaceRoot) {
                try {
                    progress.report('Detecting Laravel project...');
                    const success = await Laravel.initialize(workspaceRoot, {
                        phpCommand: settings.phpCommand,
                        phpEnvironment: settings.phpEnvironment,
                        onProgress: (message, percentage) => progress.report(message, percentage),
                    });
                    if (success) {
                        const project = Laravel.getProject();
                        const envLabel = project?.phpEnvironment?.label ?? 'unknown';
                        const phpCmd = project?.phpCommand.join(' ') ?? settings.phpCommand?.join(' ') ?? 'php';
                        conn.console.log(`Laravel project integration enabled (${envLabel}: ${phpCmd})`);

                        // Check if refresh had failures and notify the user
                        const refreshResult = Laravel.getLastRefreshResult();
                        if (refreshResult && refreshResult.errors.length > 0) {
                            const failedParts = [
                                refreshResult.views === 'failed' ? 'views' : null,
                                refreshResult.components === 'failed' ? 'components' : null,
                                refreshResult.directives === 'failed' ? 'directives' : null,
                            ]
                                .filter(Boolean)
                                .join(', ');

                            const message = `Blade LSP: Failed to load ${failedParts} from Laravel. PHP command: ${phpCmd}. Check :LspLog for details.`;
                            conn.sendNotification('window/showMessage', {
                                type: MessageType.Warning,
                                message,
                            });
                            progress.done(`Ready (${failedParts} failed)`);
                        } else {
                            progress.done('Ready');
                        }
                    } else {
                        conn.console.log('No Laravel project detected, using static completions');
                        progress.done('Ready (no Laravel project)');
                    }
                } catch (error) {
                    const formatted = FormatError(error);
                    const errorMsg = formatted || FormatErrorForLog(error);
                    conn.console.error(`Laravel integration: ${errorMsg}`);
                    conn.sendNotification('window/showMessage', {
                        type: MessageType.Error,
                        message: `Blade LSP: Laravel integration failed. ${errorMsg}`,
                    });
                    progress.done('Ready (Laravel error)');
                }
            } else {
                progress.done('Ready');
            }
        });

        // ─── File Watching ─────────────────────────────────────────────────────
        //
        // When the client notifies us of file system changes we selectively
        // refresh only the affected data (views, components, directives).
        // Changes are debounced so rapid saves / git operations don't
        // trigger dozens of PHP processes.

        const debouncedRefresh = Watcher.createDebouncedRefresh(async (targets) => {
            if (!Laravel.isAvailable()) return;

            await LaravelContext.provide(async () => {
                conn.console.log(`File watcher: refreshing [${[...targets].join(', ')}]`);

                const targetList = [...targets];
                const progress = await Progress.begin('Blade LSP', `Reloading ${targetList.join(', ')}...`);

                const promises: Promise<void>[] = [];
                let completed = 0;
                const total = targetList.length;
                const trackProgress = (label: string) => {
                    completed++;
                    const pct = Math.round((completed / total) * 100);
                    progress.report(`${label} (${completed}/${total})`, pct);
                };

                if (targets.has('views')) {
                    promises.push(
                        Views.refresh()
                            .then(() => {
                                trackProgress('Views reloaded');
                            })
                            .catch((err) => {
                                conn.console.error(`File watcher: views refresh failed: ${FormatErrorForLog(err)}`);
                                trackProgress('Views failed');
                            }),
                    );
                }

                if (targets.has('components')) {
                    promises.push(
                        Components.refresh()
                            .then(() => {
                                trackProgress('Components reloaded');
                            })
                            .catch((err) => {
                                conn.console.error(
                                    `File watcher: components refresh failed: ${FormatErrorForLog(err)}`,
                                );
                                trackProgress('Components failed');
                            }),
                    );
                }

                if (targets.has('directives')) {
                    promises.push(
                        Directives.refresh()
                            .then(() => {
                                trackProgress('Directives reloaded');
                            })
                            .catch((err) => {
                                conn.console.error(
                                    `File watcher: directives refresh failed: ${FormatErrorForLog(err)}`,
                                );
                                trackProgress('Directives failed');
                            }),
                    );
                }

                await Promise.allSettled(promises);
                progress.done('Reload complete');
                conn.console.log('File watcher: refresh complete');
            });
        }, 500);

        conn.onDidChangeWatchedFiles((params) => {
            conn.console.log(`File changes detected: ${Watcher.describeChanges(params.changes)}`);

            const targets = Watcher.classifyChanges(params);
            if (targets.size > 0) {
                debouncedRefresh(targets);
            }
        });

        // Document change handler
        docs.onDidChangeContent((change) => {
            withContext(() => {
                const document = change.document;
                const source = document.getText();
                const tree = parseDocument(document);

                // 1. Tree-sitter syntax diagnostics
                const treeDiagnostics = BladeParser.getDiagnostics(tree);
                const syntaxDiagnostics: Diagnostic[] = treeDiagnostics.map((diag) => ({
                    severity:
                        diag.severity === 'error'
                            ? DiagnosticSeverity.Error
                            : diag.severity === 'warning'
                              ? DiagnosticSeverity.Warning
                              : DiagnosticSeverity.Information,
                    range: {
                        start: Position.create(diag.startPosition.row, diag.startPosition.column),
                        end: Position.create(diag.endPosition.row, diag.endPosition.column),
                    },
                    message: diag.message,
                    source: 'blade-lsp',
                }));

                // 2. Semantic diagnostics (view refs, component refs, unclosed directives, @method)
                const semanticDiagnostics = Diagnostics.analyze(source);

                conn.sendDiagnostics({
                    uri: document.uri,
                    diagnostics: [...syntaxDiagnostics, ...semanticDiagnostics],
                });
            });
        });

        docs.onDidClose((event) => {
            cache.delete(event.document.uri);
            conn.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
        });

        // Completion handler
        conn.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
            return withContext(() => {
                const document = docs.get(params.textDocument.uri);
                if (!document) return [];

                const tree = cache.get(params.textDocument.uri) || parseDocument(document);
                const position = params.position;
                const source = document.getText();
                const context = BladeParser.getCompletionContext(tree, source, position.line, position.character);

                const items: CompletionItem[] = [];

                if (context.type === 'directive') {
                    // Add built-in directives
                    const matchingDirectives = BladeDirectives.getMatching(context.prefix);
                    for (const directive of matchingDirectives) {
                        items.push(Completions.createDirectiveItem(directive, context.prefix));
                    }

                    // Add custom directives from Laravel project
                    if (Laravel.isAvailable()) {
                        const customDirectives = Directives.search(context.prefix.replace('@', ''));
                        for (const directive of customDirectives) {
                            // Skip if already exists in built-in directives
                            if (!BladeDirectives.map.has(directive.name)) {
                                items.push(Completions.createCustomDirectiveItem(directive, context.prefix));
                            }
                        }
                    }
                } else if (context.type === 'html') {
                    const line = source.split('\n')[position.line];
                    const textBeforeCursor = line.slice(0, position.character);

                    if (textBeforeCursor.endsWith('@')) {
                        // Add built-in directives
                        for (const directive of BladeDirectives.all) {
                            items.push(Completions.createDirectiveItem(directive, '@'));
                        }

                        // Add custom directives from Laravel project
                        if (Laravel.isAvailable()) {
                            for (const directive of Directives.getItems()) {
                                if (!BladeDirectives.map.has(directive.name)) {
                                    items.push(Completions.createCustomDirectiveItem(directive, '@'));
                                }
                            }
                        }
                    }

                    // Check for livewire component tag start
                    if (textBeforeCursor.endsWith('<livewire:') || /<livewire:[\w.-]*$/.test(textBeforeCursor)) {
                        items.push(...Completions.getLivewireCompletions(textBeforeCursor, position));
                    }
                    // Check for component tag start:
                    //   - x- prefixed: <x-button, <x-turbo::frame
                    //   - namespace prefixed: <flux:button (but not <livewire:)
                    else if (
                        textBeforeCursor.endsWith('<x-') ||
                        /<x-[\w.-]*(?:::[\w.-]*)?$/.test(textBeforeCursor) ||
                        /<[\w]+:[\w.-]*$/.test(textBeforeCursor)
                    ) {
                        items.push(...Completions.getComponentCompletions(textBeforeCursor, position));
                    }

                    // Check for component prop completion (inside component tag)
                    const componentPropContext = Completions.getComponentPropContext(
                        source,
                        position.line,
                        position.character,
                    );
                    if (componentPropContext) {
                        items.push(
                            ...Completions.getComponentPropCompletions(
                                componentPropContext.componentName,
                                componentPropContext.existingProps,
                            ),
                        );
                    }

                    // Check for slot completion (<x-slot: or <x-slot name=")
                    const isColonSyntax = /<x-slot:[\w-]*$/.test(textBeforeCursor);
                    const isNameSyntax = /<x-slot\s+name=["'][\w-]*$/.test(textBeforeCursor);
                    if (isColonSyntax || isNameSyntax) {
                        items.push(
                            ...Completions.getSlotCompletions(source, position.line, isColonSyntax ? 'colon' : 'name'),
                        );
                    }

                    // Check for directive parameter completions via regex fallback.
                    // Tree-sitter can't reliably detect parameter context because
                    // the directive node and parameter node are siblings in the AST.
                    // Use text-based detection like hover/definitions already do.
                    const directiveParamMatch = textBeforeCursor.match(
                        /@(extends|include(?:If|When|Unless|First)?|each|component|section|yield|can(?:not|any)?|env|method|push|stack|slot|livewire)\s*\(\s*['"][\w.-]*$/,
                    );
                    if (directiveParamMatch) {
                        items.push(...Completions.getParameterCompletions(directiveParamMatch[1]));
                    }
                } else if (context.type === 'echo') {
                    items.push(...Completions.getLaravelHelperCompletions());
                } else if (context.type === 'parameter') {
                    if (context.directiveName) {
                        items.push(...Completions.getParameterCompletions(context.directiveName));
                    } else {
                        // Fallback: tree-sitter detected parameter context but couldn't
                        // resolve the directive name (sibling node issue). Try regex.
                        const line = source.split('\n')[position.line];
                        const textBeforeCursor = line.slice(0, position.character);
                        const fallbackMatch = textBeforeCursor.match(
                            /@(extends|include(?:If|When|Unless|First)?|each|component|section|yield|can(?:not|any)?|env|method|push|stack|slot|livewire)\s*\(\s*['"][\w.-]*$/,
                        );
                        if (fallbackMatch) {
                            items.push(...Completions.getParameterCompletions(fallbackMatch[1]));
                        }
                    }
                }

                return items;
            });
        });

        conn.onCompletionResolve((item: CompletionItem): CompletionItem => item);

        // Hover handler
        conn.onHover((params: TextDocumentPositionParams): Hover | null => {
            return withContext(() => {
                const document = docs.get(params.textDocument.uri);
                if (!document) return null;

                const tree = cache.get(params.textDocument.uri) || parseDocument(document);
                const position = params.position;
                const source = document.getText();

                const node = BladeParser.findNodeAtPosition(tree, position.line, position.character);

                if (node) {
                    const directiveName = BladeParser.extractDirectiveName(node);
                    if (directiveName) {
                        const directive = BladeDirectives.map.get(directiveName);
                        if (directive) {
                            return {
                                contents: {
                                    kind: MarkupKind.Markdown,
                                    value: Hovers.formatDirective(directive),
                                },
                            };
                        }
                    }
                }

                // Check for special variables
                const lineText = source.split('\n')[position.line];
                const wordAtPosition = Hovers.getWordAtPosition(lineText, position.character);

                if (wordAtPosition === '$loop' || wordAtPosition.startsWith('$loop->')) {
                    return { contents: { kind: MarkupKind.Markdown, value: Hovers.formatLoopVariable() } };
                }

                if (wordAtPosition === '$slot') {
                    return { contents: { kind: MarkupKind.Markdown, value: Hovers.formatSlotVariable() } };
                }

                if (wordAtPosition === '$attributes' || wordAtPosition.startsWith('$attributes->')) {
                    return { contents: { kind: MarkupKind.Markdown, value: Hovers.formatAttributesVariable() } };
                }

                // Check for component hover
                const componentHover = Hovers.getComponentHover(lineText, position.character);
                if (componentHover) {
                    return componentHover;
                }

                // Check for component prop hover
                const propHover = Hovers.getPropHover(source, lineText, position.line, position.character);
                if (propHover) {
                    return propHover;
                }

                // Check for view hover in directives
                const viewHover = Hovers.getViewHover(lineText, position.character);
                if (viewHover) {
                    return viewHover;
                }

                // Check for slot hover (<x-slot:name> or <x-slot name="name">)
                const slotHover = Hovers.getSlotHover(source, lineText, position.line, position.character);
                if (slotHover) {
                    return slotHover;
                }

                return null;
            });
        });

        // Definition handler (go to definition)
        conn.onDefinition((params: DefinitionParams): Location | null => {
            return withContext(() => {
                const document = docs.get(params.textDocument.uri);
                if (!document) return null;

                const source = document.getText();
                const position = params.position;
                const lines = source.split('\n');
                const currentLine = lines[position.line] || '';

                // Check for view reference in directives
                const viewDefinition = Definitions.getViewDefinition(
                    currentLine,
                    position.character,
                    source,
                    position.line,
                );
                if (viewDefinition) {
                    return viewDefinition;
                }

                // Check for component reference
                const componentDefinition = Definitions.getComponentDefinition(currentLine, position.character);
                if (componentDefinition) {
                    return componentDefinition;
                }

                // Check for component prop/attribute reference
                const propDefinition = Definitions.getPropDefinition(
                    source,
                    currentLine,
                    position.line,
                    position.character,
                );
                if (propDefinition) {
                    return propDefinition;
                }

                // Check for slot reference (<x-slot:name> or <x-slot name="name">)
                const slotDefinition = Definitions.getSlotDefinition(
                    source,
                    currentLine,
                    position.line,
                    position.character,
                );
                if (slotDefinition) {
                    return slotDefinition;
                }

                return null;
            });
        });

        docs.listen(conn);
        return conn;
    };

    let instance: Connection | undefined;

    export function start(conn?: Connection): Connection {
        if (!instance) {
            instance = build(conn);
        }
        return instance;
    }

    /**
     * Reset all server state. Used between test runs for isolation.
     */
    export function reset(): void {
        connection = undefined;
        documents = undefined;
        treeCache = undefined;
        workspaceRoot = null;
        settings = {};
        hasWatchedFileCapability = false;
        instance = undefined;
        try {
            Laravel.dispose();
        } catch {
            // Laravel context may not be initialized — safe to ignore
        }
    }
}

// Start the server (only when not in test mode)
if (!process.env.TEST) {
    Server.start().listen();
}

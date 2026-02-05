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
  Position,
  TextDocumentPositionParams,
  Location,
  DefinitionParams,
  Connection,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BladeParser } from './parser';
import { BladeDirectives } from './directives';
import {
  Laravel,
  Directives,
} from './laravel';
import { FormatError, FormatErrorForLog } from './utils/format-error';
import { Completions } from './providers/completions';
import { Hovers } from './providers/hovers';
import { Definitions } from './providers/definitions';

export namespace Server {
  export interface Settings {
    // Command array to execute PHP (defaults to ['php'] if not provided)
    // Examples:
    //   - Local: ['php'] or ['/usr/bin/php']
    //   - Docker: ['docker', 'compose', 'exec', 'app', 'php']
    //   - Sail: ['./vendor/bin/sail', 'php']
    phpCommand?: string[];
    enableLaravelIntegration?: boolean;
  }

  let connection: Connection | undefined;
  let documents: TextDocuments<TextDocument> | undefined;
  let treeCache: Map<string, BladeParser.Tree> | undefined;
  let workspaceRoot: string | null = null;
  let settings: Settings = {};

  export function getConnection(): Connection {
    return connection ?? (connection = createConnection(ProposedFeatures.all));
  }

  export function getDocuments(): TextDocuments<TextDocument> {
    return documents ?? (documents = new TextDocuments(TextDocument));
  }

  export function getTreeCache(): Map<string, BladeParser.Tree> {
    return treeCache ?? (treeCache = new Map<string, BladeParser.Tree>());
  }

  export function getWorkspaceRoot(): string | null {
    return workspaceRoot;
  }

  export function getSettings(): Settings {
    return settings;
  }

  // Parse document and cache the tree
  export function parseDocument(document: TextDocument): BladeParser.Tree {
    const tree = BladeParser.parse(document.getText());
    getTreeCache().set(document.uri, tree);
    return tree;
  }

  const build = () => {
    const conn = getConnection();
    const docs = getDocuments();
    const cache = getTreeCache();

    conn.onInitialize((params: InitializeParams): InitializeResult => {
      // Store workspace root for Laravel detection
      workspaceRoot = params.rootUri ? params.rootUri.replace('file://', '') : params.rootPath || null;

      // Get initialization options (settings passed from client)
      const initOptions = params.initializationOptions as Settings | undefined;
      if (initOptions) {
        settings = initOptions;
        conn.console.log(`Settings received: ${JSON.stringify(settings)}`);
      }

      // Initialize the tree-sitter parser
      try {
        BladeParser.initialize();
        conn.console.log('Tree-sitter Blade parser initialized');
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

      // Check if Laravel integration is disabled
      if (settings.enableLaravelIntegration === false) {
        conn.console.log('Laravel integration disabled via settings');
        return;
      }

      // Initialize Laravel integration if workspace is available
      if (workspaceRoot) {
        try {
          const success = await Laravel.initialize(workspaceRoot, {
            phpCommand: settings.phpCommand,
          });
          if (success) {
            conn.console.log('Laravel project integration enabled');
            const phpCmd = settings.phpCommand || ['php'];
            conn.console.log(`Using PHP command: ${phpCmd.join(' ')}`);
          } else {
            conn.console.log('No Laravel project detected, using static completions');
          }
        } catch (error) {
          const formatted = FormatError(error);
          if (formatted) {
            conn.console.error(`Laravel integration: ${formatted}`);
          } else {
            conn.console.error(`Laravel integration error: ${FormatErrorForLog(error)}`);
          }
        }
      }
    });

    // Document change handler
    docs.onDidChangeContent((change) => {
      const document = change.document;
      const tree = parseDocument(document);
      const treeDiagnostics = BladeParser.getDiagnostics(tree);

      const diagnostics: Diagnostic[] = treeDiagnostics.map((diag) => ({
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

      conn.sendDiagnostics({ uri: document.uri, diagnostics });
    });

    docs.onDidClose((event) => {
      cache.delete(event.document.uri);
      conn.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
    });

    // Completion handler
    conn.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
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

        // Check for component tag start
        if (textBeforeCursor.endsWith('<x-') || /<x-[\w.-]*$/.test(textBeforeCursor)) {
          items.push(...Completions.getComponentCompletions(textBeforeCursor, position));
        }

        // Check for livewire component tag start
        if (textBeforeCursor.endsWith('<livewire:') || /<livewire:[\w.-]*$/.test(textBeforeCursor)) {
          items.push(...Completions.getLivewireCompletions(textBeforeCursor, position));
        }

        // Check for component prop completion (inside component tag)
        const componentPropContext = Completions.getComponentPropContext(
          source,
          position.line,
          position.character
        );
        if (componentPropContext) {
          items.push(
            ...Completions.getComponentPropCompletions(
              componentPropContext.componentName,
              componentPropContext.existingProps
            )
          );
        }

        // Check for slot completion (<x-slot: or <x-slot name=")
        const isColonSyntax = /<x-slot:[\w-]*$/.test(textBeforeCursor);
        const isNameSyntax = /<x-slot\s+name=["'][\w-]*$/.test(textBeforeCursor);
        if (isColonSyntax || isNameSyntax) {
          items.push(...Completions.getSlotCompletions(source, position.line, isColonSyntax ? 'colon' : 'name'));
        }
      } else if (context.type === 'echo') {
        items.push(...Completions.getLaravelHelperCompletions());
      } else if (context.type === 'parameter' && context.directiveName) {
        items.push(...Completions.getParameterCompletions(context.directiveName));
      }

      return items;
    });

    conn.onCompletionResolve((item: CompletionItem): CompletionItem => item);

    // Hover handler
    conn.onHover((params: TextDocumentPositionParams): Hover | null => {
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

    // Definition handler (go to definition)
    conn.onDefinition((params: DefinitionParams): Location | null => {
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
        position.line
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
        position.character
      );
      if (propDefinition) {
        return propDefinition;
      }

      // Check for slot reference (<x-slot:name> or <x-slot name="name">)
      const slotDefinition = Definitions.getSlotDefinition(
        source,
        currentLine,
        position.line,
        position.character
      );
      if (slotDefinition) {
        return slotDefinition;
      }

      return null;
    });

    docs.listen(conn);
    return conn;
  };

  let instance: Connection | undefined;

  export function start(): Connection {
    if (!instance) {
      instance = build();
    }
    return instance;
  }

  export function listen(): void {
    start().listen();
  }
}

// Start the server
Server.listen();

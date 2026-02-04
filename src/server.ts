#!/usr/bin/env node
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  Hover,
  Diagnostic,
  DiagnosticSeverity,
  InsertTextFormat,
  MarkupKind,
  Position,
  TextDocumentPositionParams,
  Location,
  Range,
  DefinitionParams,
  TextEdit,
  Connection,
} from 'vscode-languageserver/node';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Tree } from './parser';
import {
  initializeParser,
  parseBladeTemplate,
  findNodeAtPosition,
  getCompletionContext,
  getDiagnostics,
  extractDirectiveName,
} from './parser';
import {
  bladeDirectives,
  directiveMap,
  getMatchingDirectives,
  type BladeDirective,
} from './directives';
import {
  Laravel,
  Views,
  Components,
  Directives,
  ViewItem,
  ComponentItem,
  CustomDirective,
} from './laravel';
import { FormatError, FormatErrorForLog } from './utils/format-error';

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
  let treeCache: Map<string, Tree> | undefined;
  let workspaceRoot: string | null = null;
  let settings: Settings = {};

  export function getConnection(): Connection {
    return connection ?? (connection = createConnection(ProposedFeatures.all));
  }

  export function getDocuments(): TextDocuments<TextDocument> {
    return documents ?? (documents = new TextDocuments(TextDocument));
  }

  export function getTreeCache(): Map<string, Tree> {
    return treeCache ?? (treeCache = new Map<string, Tree>());
  }

  export function getWorkspaceRoot(): string | null {
    return workspaceRoot;
  }

  export function getSettings(): Settings {
    return settings;
  }

  // Parse document and cache the tree
  export function parseDocument(document: TextDocument): Tree {
    const tree = parseBladeTemplate(document.getText());
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
        initializeParser();
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
      const treeDiagnostics = getDiagnostics(tree);

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
      const context = getCompletionContext(tree, source, position.line, position.character);

      const items: CompletionItem[] = [];

      if (context.type === 'directive') {
        // Add built-in directives
        const matchingDirectives = getMatchingDirectives(context.prefix);
        for (const directive of matchingDirectives) {
          items.push(Completions.createDirectiveItem(directive, context.prefix));
        }

        // Add custom directives from Laravel project
        if (Laravel.isAvailable()) {
          const customDirectives = Directives.search(context.prefix.replace('@', ''));
          for (const directive of customDirectives) {
            // Skip if already exists in built-in directives
            if (!directiveMap.has(directive.name)) {
              items.push(Completions.createCustomDirectiveItem(directive, context.prefix));
            }
          }
        }
      } else if (context.type === 'html') {
        const line = source.split('\n')[position.line];
        const textBeforeCursor = line.slice(0, position.character);

        if (textBeforeCursor.endsWith('@')) {
          // Add built-in directives
          for (const directive of bladeDirectives) {
            items.push(Completions.createDirectiveItem(directive, '@'));
          }

          // Add custom directives from Laravel project
          if (Laravel.isAvailable()) {
            for (const directive of Directives.getItems()) {
              if (!directiveMap.has(directive.name)) {
                items.push(Completions.createCustomDirectiveItem(directive, '@'));
              }
            }
          }
        }

        // Check for component tag start
        if (textBeforeCursor.endsWith('<x-') || /<x-[\w.-]*$/.test(textBeforeCursor)) {
          items.push(...Completions.getComponentCompletions(textBeforeCursor, position));
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

        // Check for slot completion (<x-slot:)
        if (/<x-slot:[\w-]*$/.test(textBeforeCursor)) {
          items.push(...Completions.getSlotCompletions(source, position.line));
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

      const node = findNodeAtPosition(tree, position.line, position.character);

      if (node) {
        const directiveName = extractDirectiveName(node);
        if (directiveName) {
          const directive = directiveMap.get(directiveName);
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

      // Check for view hover in directives
      const viewHover = Hovers.getViewHover(lineText, position.character);
      if (viewHover) {
        return viewHover;
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

// Completions namespace for completion-related functions
export namespace Completions {
  export interface ComponentPropContext {
    componentName: string;
    existingProps: string[];
  }

  export interface ParsedProp {
    name: string;
    type: string;
    required: boolean;
    default: unknown;
  }

  export function createDirectiveItem(directive: BladeDirective, prefix: string): CompletionItem {
    return {
      label: directive.name,
      kind: CompletionItemKind.Keyword,
      detail: directive.parameters || undefined,
      documentation: {
        kind: MarkupKind.Markdown,
        value: directive.description,
      },
      insertText: directive.snippet
        ? directive.snippet.slice(prefix.length)
        : directive.name.slice(prefix.length),
      insertTextFormat: directive.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
      sortText: directive.hasEndTag ? '0' + directive.name : '1' + directive.name,
    };
  }

  export function createCustomDirectiveItem(directive: CustomDirective, prefix: string): CompletionItem {
    const snippetText = directive.hasParams ? `@${directive.name}(\${1})` : `@${directive.name}`;

    return {
      label: `@${directive.name}`,
      kind: CompletionItemKind.Keyword,
      detail: directive.file ? `Custom directive (${directive.file})` : 'Custom directive',
      documentation: {
        kind: MarkupKind.Markdown,
        value: `Custom Blade directive \`@${directive.name}\`${directive.file ? `\n\nDefined in: \`${directive.file}:${directive.line}\`` : ''}`,
      },
      insertText: snippetText.slice(prefix.length),
      insertTextFormat: directive.hasParams ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
      sortText: '2' + directive.name, // Custom directives sort after built-in
    };
  }

  export function getComponentCompletions(textBeforeCursor: string, position: Position): CompletionItem[] {
    const items: CompletionItem[] = [];

    // Calculate the start position of the component tag (where '<x-' begins)
    const match = textBeforeCursor.match(/<(x-[\w.-]*)$/);
    const partialName = match ? match[1] : 'x-';
    const matchedText = match ? match[0] : '<x-';
    const startCharacter = position.character - matchedText.length;

    const replaceRange = Range.create(Position.create(position.line, startCharacter), position);

    if (!Laravel.isAvailable()) {
      // Return static component suggestions if no Laravel project
      const staticComponents = ['x-button', 'x-alert', 'x-input', 'x-card'];
      return staticComponents.map((tag) => ({
        label: tag,
        kind: CompletionItemKind.Class,
        detail: 'Component',
        textEdit: TextEdit.replace(replaceRange, `<${tag}`),
      }));
    }

    const components = Components.getItems();

    for (const component of components) {
      // Match standard x- components
      if (component.fullTag.startsWith('x-')) {
        if (component.fullTag.startsWith(partialName) || partialName === 'x-') {
          items.push(createComponentCompletionItem(component, replaceRange));
        }
      }
    }

    return items;
  }

  export function createComponentCompletionItem(component: ComponentItem, replaceRange: Range): CompletionItem {
    let documentation = `**${component.fullTag}**\n\n`;
    documentation += `Type: ${component.type}\n`;
    documentation += `Path: \`${component.path}\`\n`;

    if (component.props) {
      if (typeof component.props === 'string') {
        documentation += `\n**Props:**\n\`\`\`php\n${component.props}\n\`\`\``;
      } else if (Array.isArray(component.props) && component.props.length > 0) {
        documentation += '\n**Props:**\n';
        for (const prop of component.props) {
          const required = prop.required ? '(required)' : '';
          documentation += `- \`${prop.name}\`: ${prop.type} ${required}\n`;
        }
      }
    }

    // Build snippet with common props - include the < prefix since we're replacing from there
    let snippet = `<${component.fullTag}`;
    if (component.props && Array.isArray(component.props)) {
      const requiredProps = component.props.filter((p) => p.required);
      if (requiredProps.length > 0) {
        const propsSnippet = requiredProps.map((p, i) => `:${p.name}="\${${i + 1}}"`).join(' ');
        snippet = `<${component.fullTag} ${propsSnippet}`;
      }
    }

    return {
      label: component.fullTag,
      kind: CompletionItemKind.Class,
      detail: component.isVendor ? `Component (vendor)` : `Component`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: documentation,
      },
      textEdit: TextEdit.replace(replaceRange, snippet),
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: component.isVendor ? '1' + component.key : '0' + component.key,
    };
  }

  export function getLaravelHelperCompletions(): CompletionItem[] {
    const helpers = [
      { name: '$errors', description: 'Validation errors bag', snippet: "\\$errors->first('${1:field}')" },
      { name: 'route', description: 'Generate URL for named route', snippet: "route('${1:name}')" },
      { name: 'url', description: 'Generate URL for path', snippet: "url('${1:path}')" },
      { name: 'asset', description: 'Generate URL for asset', snippet: "asset('${1:path}')" },
      { name: 'mix', description: 'Get versioned Mix file path', snippet: "mix('${1:path}')" },
      { name: 'config', description: 'Get configuration value', snippet: "config('${1:key}')" },
      { name: 'env', description: 'Get environment variable', snippet: "env('${1:key}')" },
      { name: 'trans', description: 'Translate the given message', snippet: "trans('${1:key}')" },
      { name: '__', description: 'Translate the given message', snippet: "__('${1:key}')" },
      { name: 'auth', description: 'Get Auth instance or user', snippet: 'auth()->user()' },
      { name: 'session', description: 'Get/set session value', snippet: "session('${1:key}')" },
      { name: 'old', description: 'Get old input value', snippet: "old('${1:key}')" },
      { name: 'request', description: 'Get request instance/input', snippet: "request('${1:key}')" },
      { name: 'csrf_token', description: 'Get CSRF token', snippet: 'csrf_token()' },
      { name: 'now', description: 'Get current datetime', snippet: 'now()' },
      { name: 'today', description: 'Get current date', snippet: 'today()' },
      { name: 'collect', description: 'Create a collection', snippet: 'collect(${1:\\$items})' },
      { name: 'optional', description: 'Optional helper for null safety', snippet: 'optional(${1:\\$value})' },
      { name: 'storage_path', description: 'Get storage path', snippet: "storage_path('${1:path}')" },
      { name: 'public_path', description: 'Get public path', snippet: "public_path('${1:path}')" },
      { name: 'base_path', description: 'Get base path', snippet: "base_path('${1:path}')" },
      { name: 'resource_path', description: 'Get resource path', snippet: "resource_path('${1:path}')" },
      { name: 'app', description: 'Get service from container', snippet: "app('${1:service}')" },
      { name: 'abort', description: 'Throw HTTP exception', snippet: 'abort(${1:404})' },
      { name: 'back', description: 'Redirect back', snippet: 'back()' },
      { name: 'redirect', description: 'Redirect to URL', snippet: "redirect('${1:url}')" },
      { name: 'view', description: 'Create view response', snippet: "view('${1:name}')" },
      { name: 'cache', description: 'Get/set cache value', snippet: "cache('${1:key}')" },
      { name: 'logger', description: 'Log a message', snippet: "logger('${1:message}')" },
      { name: 'dump', description: 'Dump variable', snippet: 'dump(${1:\\$var})' },
      { name: 'dd', description: 'Dump and die', snippet: 'dd(${1:\\$var})' },
    ];

    return helpers.map((helper) => ({
      label: helper.name,
      kind: CompletionItemKind.Function,
      detail: 'Laravel Helper',
      documentation: {
        kind: MarkupKind.Markdown,
        value: helper.description,
      },
      insertText: helper.snippet,
      insertTextFormat: InsertTextFormat.Snippet,
    }));
  }

  export function getParameterCompletions(directiveName: string): CompletionItem[] {
    const items: CompletionItem[] = [];

    switch (directiveName) {
      case 'extends':
      case 'include':
      case 'includeIf':
      case 'includeWhen':
      case 'includeUnless':
      case 'includeFirst':
        // Use dynamic views if available
        if (Laravel.isAvailable()) {
          const views = Views.getItems();

          // For extends, prefer layout views
          const relevantViews =
            directiveName === 'extends'
              ? views.filter((v) => v.key.startsWith('layouts.') || v.key.includes('layout'))
              : views;

          for (const view of relevantViews.slice(0, 50)) {
            // Limit to 50 items
            items.push(createViewCompletionItem(view));
          }
        } else {
          // Fall back to static suggestions
          items.push(
            { label: 'layouts.app', kind: CompletionItemKind.File, detail: 'Main layout' },
            { label: 'layouts.guest', kind: CompletionItemKind.File, detail: 'Guest layout' },
            { label: 'components.', kind: CompletionItemKind.Folder, detail: 'Components' },
            { label: 'partials.', kind: CompletionItemKind.Folder, detail: 'Partials' }
          );
        }
        break;

      case 'section':
      case 'yield':
        items.push(
          { label: 'content', kind: CompletionItemKind.Value, detail: 'Main content' },
          { label: 'title', kind: CompletionItemKind.Value, detail: 'Page title' },
          { label: 'scripts', kind: CompletionItemKind.Value, detail: 'JavaScript' },
          { label: 'styles', kind: CompletionItemKind.Value, detail: 'CSS styles' }
        );
        break;

      case 'can':
      case 'cannot':
      case 'canany':
        items.push(
          { label: 'view', kind: CompletionItemKind.Value, detail: 'View permission' },
          { label: 'create', kind: CompletionItemKind.Value, detail: 'Create permission' },
          { label: 'update', kind: CompletionItemKind.Value, detail: 'Update permission' },
          { label: 'delete', kind: CompletionItemKind.Value, detail: 'Delete permission' }
        );
        break;

      case 'env':
        items.push(
          { label: 'local', kind: CompletionItemKind.Value, detail: 'Local environment' },
          { label: 'production', kind: CompletionItemKind.Value, detail: 'Production' },
          { label: 'staging', kind: CompletionItemKind.Value, detail: 'Staging' }
        );
        break;

      case 'method':
        items.push(
          { label: 'PUT', kind: CompletionItemKind.Value, detail: 'HTTP PUT' },
          { label: 'PATCH', kind: CompletionItemKind.Value, detail: 'HTTP PATCH' },
          { label: 'DELETE', kind: CompletionItemKind.Value, detail: 'HTTP DELETE' }
        );
        break;

      case 'push':
      case 'stack':
        items.push(
          { label: 'scripts', kind: CompletionItemKind.Value, detail: 'JavaScript stack' },
          { label: 'styles', kind: CompletionItemKind.Value, detail: 'CSS stack' }
        );
        break;

      case 'slot':
        // Suggest common slot names
        items.push(
          { label: 'header', kind: CompletionItemKind.Value, detail: 'Header slot' },
          { label: 'footer', kind: CompletionItemKind.Value, detail: 'Footer slot' },
          { label: 'title', kind: CompletionItemKind.Value, detail: 'Title slot' },
          { label: 'icon', kind: CompletionItemKind.Value, detail: 'Icon slot' },
          { label: 'actions', kind: CompletionItemKind.Value, detail: 'Actions slot' },
          { label: 'trigger', kind: CompletionItemKind.Value, detail: 'Trigger slot' },
          { label: 'content', kind: CompletionItemKind.Value, detail: 'Content slot' }
        );
        break;

      case 'livewire':
      case 'livewireStyles':
      case 'livewireScripts':
        // Add Livewire component suggestions if available
        if (Laravel.isAvailable()) {
          const views = Views.getItems();
          const livewireViews = views.filter((v) => v.key.startsWith('livewire.'));
          for (const view of livewireViews) {
            items.push({
              label: view.key.replace('livewire.', ''),
              kind: CompletionItemKind.Class,
              detail: 'Livewire component',
              documentation: {
                kind: MarkupKind.Markdown,
                value: `Livewire component\n\nPath: \`${view.path}\``,
              },
            });
          }
        }
        break;
    }

    return items;
  }

  export function createViewCompletionItem(view: ViewItem): CompletionItem {
    return {
      label: view.key,
      kind: CompletionItemKind.File,
      detail: view.isVendor ? `View (vendor)` : `View`,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `**${view.key}**\n\nPath: \`${view.path}\`${view.namespace ? `\nNamespace: \`${view.namespace}\`` : ''}`,
      },
      sortText: view.isVendor ? '1' + view.key : '0' + view.key,
    };
  }

  /**
   * Detect if cursor is inside a component tag for prop completion
   */
  export function getComponentPropContext(
    source: string,
    row: number,
    column: number
  ): ComponentPropContext | null {
    const lines = source.split('\n');
    const currentLine = lines[row] || '';
    const textBeforeCursor = currentLine.slice(0, column);

    // Look backwards to find the opening tag
    let lineIndex = row;

    // Search backwards through lines to find the opening tag
    while (lineIndex >= 0 && lineIndex >= row - 10) {
      const lineText = lineIndex === row ? textBeforeCursor : lines[lineIndex];

      // Check if we found a closing > that would mean we're not in a tag
      if (lineText.includes('>') && lineIndex !== row) {
        // Find the last > and check if there's an opening < after it
        const lastClose = lineText.lastIndexOf('>');
        const afterClose = lineText.slice(lastClose + 1);
        if (!afterClose.includes('<')) {
          break;
        }
      }

      // Look for component tag opening
      const componentMatch = lineText.match(/<(x-[\w.-]+|[\w]+:[\w.-]+)/);
      if (componentMatch) {
        const tagStart = lineText.indexOf(componentMatch[0]);
        const fullTagName = componentMatch[1];

        // Check if tag is closed on this line before cursor
        const afterTag = lineIndex === row ? currentLine.slice(tagStart, column) : lineText.slice(tagStart);

        if (afterTag.includes('>') && !afterTag.includes('/>')) {
          // Tag is closed, but check if it's self-closing
          const closePos = afterTag.indexOf('>');
          if (lineIndex === row && tagStart + closePos < column) {
            break; // We're past the tag
          }
        }

        // We're inside this component tag
        // Extract existing props
        const existingProps = extractExistingProps(source, lineIndex, tagStart, row, column);

        return {
          componentName: fullTagName,
          existingProps,
        };
      }

      lineIndex--;
    }

    return null;
  }

  /**
   * Extract props that are already defined on a component tag
   */
  export function extractExistingProps(
    source: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): string[] {
    const lines = source.split('\n');
    let text = '';

    for (let i = startLine; i <= endLine; i++) {
      if (i === startLine && i === endLine) {
        text += lines[i].slice(startCol, endCol);
      } else if (i === startLine) {
        text += lines[i].slice(startCol) + '\n';
      } else if (i === endLine) {
        text += lines[i].slice(0, endCol);
      } else {
        text += lines[i] + '\n';
      }
    }

    // Match prop names (both regular and : prefixed for dynamic)
    const propMatches = text.matchAll(/(?::|)(\w[\w-]*)(?:=)/g);
    return Array.from(propMatches, (m) => m[1]);
  }

  /**
   * Get prop completions for a component
   */
  export function getComponentPropCompletions(
    componentName: string,
    existingProps: string[]
  ): CompletionItem[] {
    const items: CompletionItem[] = [];

    if (!Laravel.isAvailable()) {
      // Return common prop suggestions
      return getStaticPropCompletions(existingProps);
    }

    // Find the component
    const component =
      Components.findByTag(componentName) ||
      Components.find(componentName.replace(/^x-/, ''));

    if (!component) {
      return getStaticPropCompletions(existingProps);
    }

    // Add props from the component
    if (component.props) {
      if (typeof component.props === 'string') {
        // Parse @props() string
        const propsFromString = parsePropsString(component.props);
        for (const prop of propsFromString) {
          if (!existingProps.includes(prop.name)) {
            items.push(createPropCompletionItem(prop.name, prop.type, prop.required, prop.default));
          }
        }
      } else if (Array.isArray(component.props)) {
        for (const prop of component.props) {
          if (!existingProps.includes(prop.name)) {
            items.push(createPropCompletionItem(prop.name, prop.type, prop.required, prop.default));
          }
        }
      }
    }

    // Add common HTML attributes if not many component-specific props
    if (items.length < 5) {
      const commonProps = getStaticPropCompletions(existingProps);
      items.push(...commonProps);
    }

    return items;
  }

  /**
   * Parse a @props() string to extract prop definitions
   */
  export function parsePropsString(propsString: string): ParsedProp[] {
    const props: ParsedProp[] = [];

    // Match patterns like 'propName' or 'propName' => 'default'
    const arrayMatch = propsString.match(/@props\s*\(\s*\[([\s\S]*)\]\s*\)/);
    if (!arrayMatch) return props;

    const content = arrayMatch[1];

    // Match 'key' => value pairs
    const pairMatches = content.matchAll(/'([\w-]+)'\s*=>\s*([^,\]]+)/g);
    for (const match of pairMatches) {
      props.push({
        name: match[1],
        type: 'mixed',
        required: false,
        default: match[2].trim(),
      });
    }

    // Match simple 'key' entries (required props)
    const simpleMatches = content.matchAll(/(?<![=>])\s*'([\w-]+)'(?!\s*=>)/g);
    for (const match of simpleMatches) {
      // Check if this key wasn't already matched as a pair
      if (!props.some((p) => p.name === match[1])) {
        props.push({
          name: match[1],
          type: 'mixed',
          required: true,
          default: null,
        });
      }
    }

    return props;
  }

  /**
   * Create a completion item for a component prop
   */
  export function createPropCompletionItem(
    name: string,
    type: string,
    required: boolean,
    defaultValue: unknown
  ): CompletionItem {
    const isDynamic = type !== 'string' && type !== 'mixed';
    const prefix = isDynamic ? ':' : '';

    return {
      label: `${prefix}${name}`,
      kind: CompletionItemKind.Property,
      detail: required ? `${type} (required)` : type,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `**${name}**\n\nType: \`${type}\`${defaultValue !== null ? `\nDefault: \`${defaultValue}\`` : ''}`,
      },
      insertText: `${prefix}${name}="\${1}"`,
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: required ? '0' + name : '1' + name,
    };
  }

  /**
   * Get static prop suggestions for components without extracted props
   */
  export function getStaticPropCompletions(existingProps: string[]): CompletionItem[] {
    const commonProps = [
      { name: 'class', type: 'string', description: 'CSS classes' },
      { name: 'id', type: 'string', description: 'Element ID' },
      { name: 'style', type: 'string', description: 'Inline styles' },
      { name: 'wire:model', type: 'string', description: 'Livewire model binding' },
      { name: 'wire:click', type: 'string', description: 'Livewire click handler' },
      { name: 'x-data', type: 'string', description: 'Alpine.js data' },
      { name: 'x-show', type: 'string', description: 'Alpine.js conditional' },
      { name: 'x-on:click', type: 'string', description: 'Alpine.js click handler' },
      { name: 'disabled', type: 'boolean', description: 'Disable element' },
      { name: 'readonly', type: 'boolean', description: 'Make read-only' },
    ];

    return commonProps
      .filter((p) => !existingProps.includes(p.name))
      .map((prop) => ({
        label: prop.name,
        kind: CompletionItemKind.Property,
        detail: prop.type,
        documentation: {
          kind: MarkupKind.Markdown,
          value: prop.description,
        },
        insertText: `${prop.name}="\${1}"`,
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: '2' + prop.name,
      }));
  }

  /**
   * Get slot name completions
   */
  export function getSlotCompletions(source: string, currentLine: number): CompletionItem[] {
    const items: CompletionItem[] = [];

    // Find the parent component to suggest its slots
    const componentContext = findParentComponent(source, currentLine);

    if (componentContext && Laravel.isAvailable()) {
      const component =
        Components.findByTag(componentContext) ||
        Components.find(componentContext.replace(/^x-/, ''));

      if (component) {
        // TODO: Extract slots from component file
        // For now, suggest common slot names
      }
    }

    // Common slot names
    const commonSlots = [
      { name: 'header', description: 'Header content slot' },
      { name: 'footer', description: 'Footer content slot' },
      { name: 'title', description: 'Title slot' },
      { name: 'icon', description: 'Icon slot' },
      { name: 'actions', description: 'Action buttons slot' },
      { name: 'trigger', description: 'Trigger element slot' },
      { name: 'content', description: 'Main content slot' },
    ];

    for (const slot of commonSlots) {
      items.push({
        label: slot.name,
        kind: CompletionItemKind.Value,
        detail: 'Named slot',
        documentation: {
          kind: MarkupKind.Markdown,
          value: slot.description,
        },
        insertText: `${slot.name}>$0</x-slot>`,
        insertTextFormat: InsertTextFormat.Snippet,
      });
    }

    return items;
  }

  /**
   * Find the parent component tag for slot context
   */
  export function findParentComponent(source: string, currentLine: number): string | null {
    const lines = source.split('\n');
    let depth = 0;

    for (let i = currentLine; i >= 0; i--) {
      const line = lines[i];

      // Count closing tags
      const closingTags = line.match(/<\/x-[\w.-]+>/g);
      if (closingTags) depth += closingTags.length;

      // Count self-closing tags (don't affect depth)

      // Find opening tags
      const openingMatch = line.match(/<(x-[\w.-]+|[\w]+:[\w.-]+)(?:\s|>)/);
      if (openingMatch) {
        if (depth === 0) {
          return openingMatch[1];
        }
        depth--;
      }
    }

    return null;
  }
}

// Hovers namespace for hover-related functions
export namespace Hovers {
  export function formatDirective(directive: BladeDirective): string {
    let content = `## ${directive.name}\n\n${directive.description}\n\n`;
    if (directive.parameters) content += `**Parameters:** \`${directive.parameters}\`\n\n`;
    if (directive.hasEndTag && directive.endTag) content += `**End tag:** \`${directive.endTag}\`\n\n`;
    if (directive.snippet) {
      content += '**Example:**\n```blade\n';
      content += directive.snippet.replace(/\$\{\d+:?([^}]*)\}/g, '$1').replace(/\$\d+/g, '');
      content += '\n```';
    }
    return content;
  }

  export function formatLoopVariable(): string {
    return `## $loop Variable

Available inside \`@foreach\` loops.

| Property | Description |
|----------|-------------|
| \`$loop->index\` | Current index (0-based) |
| \`$loop->iteration\` | Current iteration (1-based) |
| \`$loop->remaining\` | Iterations remaining |
| \`$loop->count\` | Total items |
| \`$loop->first\` | Is first iteration |
| \`$loop->last\` | Is last iteration |
| \`$loop->even\` | Is even iteration |
| \`$loop->odd\` | Is odd iteration |
| \`$loop->depth\` | Nesting level |
| \`$loop->parent\` | Parent loop variable |`;
  }

  export function formatSlotVariable(): string {
    return `## $slot Variable

Contains the content passed to a component.

\`\`\`blade
<div class="alert">{{ $slot }}</div>
\`\`\``;
  }

  export function formatAttributesVariable(): string {
    return `## $attributes Variable

Contains all attributes passed to a component.

| Method | Description |
|--------|-------------|
| \`$attributes->merge()\` | Merge with defaults |
| \`$attributes->class()\` | Merge classes |
| \`$attributes->only()\` | Get specified only |
| \`$attributes->except()\` | Exclude specified |

\`\`\`blade
<div {{ $attributes->merge(['class' => 'alert']) }}>
\`\`\``;
  }

  /**
   * Get hover info for a component tag
   */
  export function getComponentHover(line: string, column: number): Hover | null {
    const componentMatch = line.match(/<(x-[\w.-]+|[\w]+:[\w.-]+)/);

    if (!componentMatch) {
      return null;
    }

    const componentTag = componentMatch[1];
    const tagStart = line.indexOf(componentMatch[0]) + 1;
    const tagEnd = tagStart + componentTag.length;

    if (column < tagStart || column > tagEnd) {
      return null;
    }

    if (!Laravel.isAvailable()) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `## ${componentTag}\n\nBlade component`,
        },
      };
    }

    const component =
      Components.findByTag(componentTag) ||
      Components.find(componentTag.replace(/^x-/, ''));

    if (!component) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `## ${componentTag}\n\nBlade component (not found in project)`,
        },
      };
    }

    let content = `## ${component.fullTag}\n\n`;
    content += `**Type:** ${component.type}\n\n`;
    content += `**Path:** \`${component.path}\`\n\n`;

    if (component.props) {
      if (typeof component.props === 'string') {
        content += `**Props:**\n\`\`\`php\n${component.props}\n\`\`\`\n`;
      } else if (Array.isArray(component.props) && component.props.length > 0) {
        content += '**Props:**\n\n';
        content += '| Name | Type | Required |\n';
        content += '|------|------|----------|\n';
        for (const prop of component.props) {
          content += `| \`${prop.name}\` | ${prop.type} | ${prop.required ? 'Yes' : 'No'} |\n`;
        }
      }
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: content,
      },
    };
  }

  /**
   * Get hover info for a view reference
   */
  export function getViewHover(line: string, column: number): Hover | null {
    const viewDirectives = [
      'extends',
      'include',
      'includeIf',
      'includeWhen',
      'includeUnless',
      'includeFirst',
      'each',
      'component',
    ];

    for (const directive of viewDirectives) {
      const regex = new RegExp(`@${directive}\\s*\\(\\s*['"]([^'"]+)['"]`);
      const match = line.match(regex);

      if (match) {
        const viewName = match[1];
        const viewStart = line.indexOf(viewName);
        const viewEnd = viewStart + viewName.length;

        if (column >= viewStart && column <= viewEnd) {
          return getViewHoverContent(viewName);
        }
      }
    }

    // Check for view() helper
    const viewHelperMatch = line.match(/view\s*\(\s*['"]([^'"]+)['"]/);
    if (viewHelperMatch) {
      const viewName = viewHelperMatch[1];
      const viewStart = line.indexOf(viewName);
      const viewEnd = viewStart + viewName.length;

      if (column >= viewStart && column <= viewEnd) {
        return getViewHoverContent(viewName);
      }
    }

    return null;
  }

  /**
   * Get hover content for a view
   */
  export function getViewHoverContent(viewName: string): Hover {
    if (!Laravel.isAvailable()) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `## ${viewName}\n\nBlade view`,
        },
      };
    }

    const view = Views.find(viewName);

    if (!view) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `## ${viewName}\n\n**View not found in project**`,
        },
      };
    }

    let content = `## ${view.key}\n\n`;
    content += `**Path:** \`${view.path}\`\n\n`;
    if (view.namespace) {
      content += `**Namespace:** \`${view.namespace}\`\n\n`;
    }
    if (view.isVendor) {
      content += `*Vendor package view*\n`;
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: content,
      },
    };
  }

  export function getWordAtPosition(line: string, column: number): string {
    let start = column;
    let end = column;
    while (start > 0 && /[\w$>-]/.test(line[start - 1])) start--;
    while (end < line.length && /[\w$>-]/.test(line[end])) end++;
    return line.slice(start, end);
  }
}

// Definitions namespace for go-to-definition functions
export namespace Definitions {
  /**
   * Get definition location for a view reference
   */
  export function getViewDefinition(
    line: string,
    column: number,
    _source: string,
    _lineNum: number
  ): Location | null {
    // Match view references in directives like @extends('layouts.app'), @include('partials.header')
    const viewDirectives = [
      'extends',
      'include',
      'includeIf',
      'includeWhen',
      'includeUnless',
      'includeFirst',
      'each',
      'component',
    ];

    for (const directive of viewDirectives) {
      const regex = new RegExp(`@${directive}\\s*\\(\\s*['"]([^'"]+)['"]`);
      const match = line.match(regex);

      if (match) {
        const viewName = match[1];
        const viewStart = line.indexOf(viewName);
        const viewEnd = viewStart + viewName.length;

        // Check if cursor is on the view name
        if (column >= viewStart && column <= viewEnd) {
          return resolveViewLocation(viewName);
        }
      }
    }

    // Also check for view() helper in echo statements
    const viewHelperMatch = line.match(/view\s*\(\s*['"]([^'"]+)['"]/);
    if (viewHelperMatch) {
      const viewName = viewHelperMatch[1];
      const viewStart = line.indexOf(viewName);
      const viewEnd = viewStart + viewName.length;

      if (column >= viewStart && column <= viewEnd) {
        return resolveViewLocation(viewName);
      }
    }

    return null;
  }

  /**
   * Resolve a view name to its file location
   */
  export function resolveViewLocation(viewName: string): Location | null {
    const workspaceRoot = Server.getWorkspaceRoot();
    if (!Laravel.isAvailable() || !workspaceRoot) {
      return null;
    }

    const view = Views.find(viewName);
    if (!view) {
      return null;
    }

    const fullPath = path.join(workspaceRoot, view.path);

    return {
      uri: `file://${fullPath}`,
      range: Range.create(0, 0, 0, 0),
    };
  }

  /**
   * Get definition location for a component reference
   */
  export function getComponentDefinition(line: string, column: number): Location | null {
    // Match component tags like <x-button, <x-alert.danger, <flux:button
    const componentMatch = line.match(/<(x-[\w.-]+|[\w]+:[\w.-]+)/);

    if (!componentMatch) {
      return null;
    }

    const componentTag = componentMatch[1];
    const tagStart = line.indexOf(componentMatch[0]) + 1; // +1 to skip <
    const tagEnd = tagStart + componentTag.length;

    // Check if cursor is on the component name
    if (column >= tagStart && column <= tagEnd) {
      return resolveComponentLocation(componentTag);
    }

    return null;
  }

  /**
   * Resolve a component name to its file location
   */
  export function resolveComponentLocation(componentTag: string): Location | null {
    const workspaceRoot = Server.getWorkspaceRoot();
    if (!Laravel.isAvailable() || !workspaceRoot) {
      return null;
    }

    const component =
      Components.findByTag(componentTag) ||
      Components.find(componentTag.replace(/^x-/, ''));

    if (!component) {
      return null;
    }

    const fullPath = path.join(workspaceRoot, component.path);

    return {
      uri: `file://${fullPath}`,
      range: Range.create(0, 0, 0, 0),
    };
  }
}

// Start the server
Server.listen();

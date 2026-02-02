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
} from "vscode-languageserver/node";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Tree } from "./parser";
import {
  initializeParser,
  parseBladeTemplate,
  findNodeAtPosition,
  getCompletionContext,
  getDiagnostics,
  extractDirectiveName,
} from "./parser";
import {
  bladeDirectives,
  directiveMap,
  getMatchingDirectives,
  type BladeDirective,
} from "./directives";
import {
  laravelManager,
  viewRepository,
  componentRepository,
  directiveRepository,
  ViewItem,
  ComponentItem,
  CustomDirective,
} from "./laravel";

// Create the connection
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Cache for parsed trees
const treeCache = new Map<string, Tree>();

// Workspace root path
let workspaceRoot: string | null = null;

// LSP Settings
interface BladeLspSettings {
  phpPath?: string;           // Path to PHP binary (e.g., '/usr/bin/php')
  phpCommand?: string[];      // Command array for Docker etc (e.g., ['docker', 'compose', 'exec', 'app', 'php'])
  phpDockerWorkdir?: string;  // Working directory inside Docker container (e.g., '/var/www/html')
  enableLaravelIntegration?: boolean;
}

let settings: BladeLspSettings = {};

connection.onInitialize((params: InitializeParams): InitializeResult => {
  // Store workspace root for Laravel detection
  workspaceRoot = params.rootUri 
    ? params.rootUri.replace('file://', '') 
    : params.rootPath || null;

  // Get initialization options (settings passed from client)
  const initOptions = params.initializationOptions as BladeLspSettings | undefined;
  if (initOptions) {
    settings = initOptions;
    connection.console.log(`Settings received: ${JSON.stringify(settings)}`);
  }

  // Initialize the tree-sitter parser
  try {
    initializeParser();
    connection.console.log("Tree-sitter Blade parser initialized");
  } catch (error) {
    connection.console.error(`Failed to initialize parser: ${error}`);
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ["@", "'", '"', "$", "{", "<", ":", " "],
      },
      hoverProvider: true,
      definitionProvider: true,
    },
  };
});

connection.onInitialized(async () => {
  connection.console.log("Laravel Blade LSP initialized");

  // Check if Laravel integration is disabled
  if (settings.enableLaravelIntegration === false) {
    connection.console.log("Laravel integration disabled via settings");
    return;
  }

  // Initialize Laravel integration if workspace is available
  if (workspaceRoot) {
    try {
      const success = await laravelManager.initialize(workspaceRoot, {
        phpPath: settings.phpPath,
        phpCommand: settings.phpCommand,
        phpDockerWorkdir: settings.phpDockerWorkdir,
      });
      if (success) {
        connection.console.log("Laravel project integration enabled");
        if (settings.phpCommand) {
          connection.console.log(`Using PHP command: ${settings.phpCommand.join(' ')}`);
        } else if (settings.phpPath) {
          connection.console.log(`Using PHP: ${settings.phpPath}`);
        }
      } else {
        connection.console.log("No Laravel project detected, using static completions");
      }
    } catch (error) {
      connection.console.error(`Laravel integration error: ${error}`);
    }
  }
});

// Parse document and cache the tree
function parseDocument(document: TextDocument): Tree {
  const tree = parseBladeTemplate(document.getText());
  treeCache.set(document.uri, tree);
  return tree;
}

// Document change handler
documents.onDidChangeContent((change) => {
  const document = change.document;
  const tree = parseDocument(document);
  const treeDiagnostics = getDiagnostics(tree);

  const diagnostics: Diagnostic[] = treeDiagnostics.map((diag) => ({
    severity:
      diag.severity === "error"
        ? DiagnosticSeverity.Error
        : diag.severity === "warning"
        ? DiagnosticSeverity.Warning
        : DiagnosticSeverity.Information,
    range: {
      start: Position.create(diag.startPosition.row, diag.startPosition.column),
      end: Position.create(diag.endPosition.row, diag.endPosition.column),
    },
    message: diag.message,
    source: "blade-lsp",
  }));

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
});

documents.onDidClose((event) => {
  treeCache.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Completion handler
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const tree = treeCache.get(params.textDocument.uri) || parseDocument(document);
  const position = params.position;
  const source = document.getText();
  const context = getCompletionContext(tree, source, position.line, position.character);

  const items: CompletionItem[] = [];

  if (context.type === "directive") {
    // Add built-in directives
    const matchingDirectives = getMatchingDirectives(context.prefix);
    for (const directive of matchingDirectives) {
      items.push(createDirectiveCompletionItem(directive, context.prefix));
    }
    
    // Add custom directives from Laravel project
    if (laravelManager.isAvailable()) {
      const customDirectives = directiveRepository.search(context.prefix.replace('@', ''));
      for (const directive of customDirectives) {
        // Skip if already exists in built-in directives
        if (!directiveMap.has(directive.name)) {
          items.push(createCustomDirectiveCompletionItem(directive, context.prefix));
        }
      }
    }
  } else if (context.type === "html") {
    const line = source.split("\n")[position.line];
    const textBeforeCursor = line.slice(0, position.character);
    
    if (textBeforeCursor.endsWith("@")) {
      // Add built-in directives
      for (const directive of bladeDirectives) {
        items.push(createDirectiveCompletionItem(directive, "@"));
      }
      
      // Add custom directives from Laravel project
      if (laravelManager.isAvailable()) {
        for (const directive of directiveRepository.getItems()) {
          if (!directiveMap.has(directive.name)) {
            items.push(createCustomDirectiveCompletionItem(directive, "@"));
          }
        }
      }
    }
    
    // Check for component tag start
    if (textBeforeCursor.endsWith("<x-") || /<x-[\w.-]*$/.test(textBeforeCursor)) {
      items.push(...getComponentCompletions(textBeforeCursor, position));
    }
    
    // Check for component prop completion (inside component tag)
    const componentPropContext = getComponentPropContext(source, position.line, position.character);
    if (componentPropContext) {
      items.push(...getComponentPropCompletions(componentPropContext.componentName, componentPropContext.existingProps));
    }
    
    // Check for slot completion (<x-slot:)
    if (/<x-slot:[\w-]*$/.test(textBeforeCursor)) {
      items.push(...getSlotCompletions(source, position.line));
    }
  } else if (context.type === "echo") {
    items.push(...getLaravelHelperCompletions());
  } else if (context.type === "parameter" && context.directiveName) {
    items.push(...getParameterCompletions(context.directiveName));
  }

  return items;
});

function createDirectiveCompletionItem(
  directive: BladeDirective,
  prefix: string
): CompletionItem {
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
    insertTextFormat: directive.snippet
      ? InsertTextFormat.Snippet
      : InsertTextFormat.PlainText,
    sortText: directive.hasEndTag ? "0" + directive.name : "1" + directive.name,
  };
}

function createCustomDirectiveCompletionItem(
  directive: CustomDirective,
  prefix: string
): CompletionItem {
  const snippetText = directive.hasParams
    ? `@${directive.name}(\${1})`
    : `@${directive.name}`;
  
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
    sortText: "2" + directive.name, // Custom directives sort after built-in
  };
}

function getComponentCompletions(textBeforeCursor: string, position: Position): CompletionItem[] {
  const items: CompletionItem[] = [];
  
  // Calculate the start position of the component tag (where '<x-' begins)
  const match = textBeforeCursor.match(/<(x-[\w.-]*)$/);
  const partialName = match ? match[1] : 'x-';
  const matchedText = match ? match[0] : '<x-';
  const startCharacter = position.character - matchedText.length;
  
  const replaceRange = Range.create(
    Position.create(position.line, startCharacter),
    position
  );
  
  if (!laravelManager.isAvailable()) {
    // Return static component suggestions if no Laravel project
    const staticComponents = ['x-button', 'x-alert', 'x-input', 'x-card'];
    return staticComponents.map(tag => ({
      label: tag,
      kind: CompletionItemKind.Class,
      detail: "Component",
      textEdit: TextEdit.replace(replaceRange, `<${tag}`),
    }));
  }
  
  const components = componentRepository.getItems();
  
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

function createComponentCompletionItem(component: ComponentItem, replaceRange: Range): CompletionItem {
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
    const requiredProps = component.props.filter(p => p.required);
    if (requiredProps.length > 0) {
      const propsSnippet = requiredProps
        .map((p, i) => `:${p.name}="\${${i + 1}}"`)
        .join(' ');
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
    sortText: component.isVendor ? "1" + component.key : "0" + component.key,
  };
}

function getLaravelHelperCompletions(): CompletionItem[] {
  const helpers = [
    { name: "$errors", description: "Validation errors bag", snippet: "\\$errors->first('${1:field}')" },
    { name: "route", description: "Generate URL for named route", snippet: "route('${1:name}')" },
    { name: "url", description: "Generate URL for path", snippet: "url('${1:path}')" },
    { name: "asset", description: "Generate URL for asset", snippet: "asset('${1:path}')" },
    { name: "mix", description: "Get versioned Mix file path", snippet: "mix('${1:path}')" },
    { name: "config", description: "Get configuration value", snippet: "config('${1:key}')" },
    { name: "env", description: "Get environment variable", snippet: "env('${1:key}')" },
    { name: "trans", description: "Translate the given message", snippet: "trans('${1:key}')" },
    { name: "__", description: "Translate the given message", snippet: "__('${1:key}')" },
    { name: "auth", description: "Get Auth instance or user", snippet: "auth()->user()" },
    { name: "session", description: "Get/set session value", snippet: "session('${1:key}')" },
    { name: "old", description: "Get old input value", snippet: "old('${1:key}')" },
    { name: "request", description: "Get request instance/input", snippet: "request('${1:key}')" },
    { name: "csrf_token", description: "Get CSRF token", snippet: "csrf_token()" },
    { name: "now", description: "Get current datetime", snippet: "now()" },
    { name: "today", description: "Get current date", snippet: "today()" },
    { name: "collect", description: "Create a collection", snippet: "collect(${1:\\$items})" },
    { name: "optional", description: "Optional helper for null safety", snippet: "optional(${1:\\$value})" },
    { name: "storage_path", description: "Get storage path", snippet: "storage_path('${1:path}')" },
    { name: "public_path", description: "Get public path", snippet: "public_path('${1:path}')" },
    { name: "base_path", description: "Get base path", snippet: "base_path('${1:path}')" },
    { name: "resource_path", description: "Get resource path", snippet: "resource_path('${1:path}')" },
    { name: "app", description: "Get service from container", snippet: "app('${1:service}')" },
    { name: "abort", description: "Throw HTTP exception", snippet: "abort(${1:404})" },
    { name: "back", description: "Redirect back", snippet: "back()" },
    { name: "redirect", description: "Redirect to URL", snippet: "redirect('${1:url}')" },
    { name: "view", description: "Create view response", snippet: "view('${1:name}')" },
    { name: "cache", description: "Get/set cache value", snippet: "cache('${1:key}')" },
    { name: "logger", description: "Log a message", snippet: "logger('${1:message}')" },
    { name: "dump", description: "Dump variable", snippet: "dump(${1:\\$var})" },
    { name: "dd", description: "Dump and die", snippet: "dd(${1:\\$var})" },
  ];

  return helpers.map((helper) => ({
    label: helper.name,
    kind: CompletionItemKind.Function,
    detail: "Laravel Helper",
    documentation: {
      kind: MarkupKind.Markdown,
      value: helper.description,
    },
    insertText: helper.snippet,
    insertTextFormat: InsertTextFormat.Snippet,
  }));
}

function getParameterCompletions(directiveName: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  switch (directiveName) {
    case "extends":
    case "include":
    case "includeIf":
    case "includeWhen":
    case "includeUnless":
    case "includeFirst":
      // Use dynamic views if available
      if (laravelManager.isAvailable()) {
        const views = viewRepository.getItems();
        
        // For extends, prefer layout views
        const relevantViews = directiveName === "extends"
          ? views.filter(v => v.key.startsWith('layouts.') || v.key.includes('layout'))
          : views;
        
        for (const view of relevantViews.slice(0, 50)) { // Limit to 50 items
          items.push(createViewCompletionItem(view));
        }
      } else {
        // Fall back to static suggestions
        items.push(
          { label: "layouts.app", kind: CompletionItemKind.File, detail: "Main layout" },
          { label: "layouts.guest", kind: CompletionItemKind.File, detail: "Guest layout" },
          { label: "components.", kind: CompletionItemKind.Folder, detail: "Components" },
          { label: "partials.", kind: CompletionItemKind.Folder, detail: "Partials" },
        );
      }
      break;

    case "section":
    case "yield":
      items.push(
        { label: "content", kind: CompletionItemKind.Value, detail: "Main content" },
        { label: "title", kind: CompletionItemKind.Value, detail: "Page title" },
        { label: "scripts", kind: CompletionItemKind.Value, detail: "JavaScript" },
        { label: "styles", kind: CompletionItemKind.Value, detail: "CSS styles" },
      );
      break;

    case "can":
    case "cannot":
    case "canany":
      items.push(
        { label: "view", kind: CompletionItemKind.Value, detail: "View permission" },
        { label: "create", kind: CompletionItemKind.Value, detail: "Create permission" },
        { label: "update", kind: CompletionItemKind.Value, detail: "Update permission" },
        { label: "delete", kind: CompletionItemKind.Value, detail: "Delete permission" },
      );
      break;

    case "env":
      items.push(
        { label: "local", kind: CompletionItemKind.Value, detail: "Local environment" },
        { label: "production", kind: CompletionItemKind.Value, detail: "Production" },
        { label: "staging", kind: CompletionItemKind.Value, detail: "Staging" },
      );
      break;

    case "method":
      items.push(
        { label: "PUT", kind: CompletionItemKind.Value, detail: "HTTP PUT" },
        { label: "PATCH", kind: CompletionItemKind.Value, detail: "HTTP PATCH" },
        { label: "DELETE", kind: CompletionItemKind.Value, detail: "HTTP DELETE" },
      );
      break;

    case "push":
    case "stack":
      items.push(
        { label: "scripts", kind: CompletionItemKind.Value, detail: "JavaScript stack" },
        { label: "styles", kind: CompletionItemKind.Value, detail: "CSS stack" },
      );
      break;

    case "slot":
      // Suggest common slot names
      items.push(
        { label: "header", kind: CompletionItemKind.Value, detail: "Header slot" },
        { label: "footer", kind: CompletionItemKind.Value, detail: "Footer slot" },
        { label: "title", kind: CompletionItemKind.Value, detail: "Title slot" },
        { label: "icon", kind: CompletionItemKind.Value, detail: "Icon slot" },
        { label: "actions", kind: CompletionItemKind.Value, detail: "Actions slot" },
        { label: "trigger", kind: CompletionItemKind.Value, detail: "Trigger slot" },
        { label: "content", kind: CompletionItemKind.Value, detail: "Content slot" },
      );
      break;
      
    case "livewire":
    case "livewireStyles":
    case "livewireScripts":
      // Add Livewire component suggestions if available
      if (laravelManager.isAvailable()) {
        const views = viewRepository.getItems();
        const livewireViews = views.filter(v => v.key.startsWith('livewire.'));
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

function createViewCompletionItem(view: ViewItem): CompletionItem {
  return {
    label: view.key,
    kind: CompletionItemKind.File,
    detail: view.isVendor ? `View (vendor)` : `View`,
    documentation: {
      kind: MarkupKind.Markdown,
      value: `**${view.key}**\n\nPath: \`${view.path}\`${view.namespace ? `\nNamespace: \`${view.namespace}\`` : ''}`,
    },
    sortText: view.isVendor ? "1" + view.key : "0" + view.key,
  };
}

interface ComponentPropContext {
  componentName: string;
  existingProps: string[];
}

/**
 * Detect if cursor is inside a component tag for prop completion
 */
function getComponentPropContext(source: string, row: number, column: number): ComponentPropContext | null {
  const lines = source.split('\n');
  const currentLine = lines[row] || '';
  const textBeforeCursor = currentLine.slice(0, column);
  
  // Check if we're after a component tag name and before closing >
  // Match patterns like: <x-button , <x-alert type="info" , <flux:button 
  
  // Look backwards to find the opening tag
  let searchText = textBeforeCursor;
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
      const afterTag = lineIndex === row 
        ? currentLine.slice(tagStart, column)
        : lineText.slice(tagStart);
      
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
function extractExistingProps(source: string, startLine: number, startCol: number, endLine: number, endCol: number): string[] {
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
  return Array.from(propMatches, m => m[1]);
}

/**
 * Get prop completions for a component
 */
function getComponentPropCompletions(componentName: string, existingProps: string[]): CompletionItem[] {
  const items: CompletionItem[] = [];
  
  if (!laravelManager.isAvailable()) {
    // Return common prop suggestions
    return getStaticPropCompletions(existingProps);
  }
  
  // Find the component
  const component = componentRepository.findByTag(componentName) || 
                   componentRepository.find(componentName.replace(/^x-/, ''));
  
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
function parsePropsString(propsString: string): Array<{name: string, type: string, required: boolean, default: unknown}> {
  const props: Array<{name: string, type: string, required: boolean, default: unknown}> = [];
  
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
    if (!props.some(p => p.name === match[1])) {
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
function createPropCompletionItem(name: string, type: string, required: boolean, defaultValue: unknown): CompletionItem {
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
    sortText: required ? "0" + name : "1" + name,
  };
}

/**
 * Get static prop suggestions for components without extracted props
 */
function getStaticPropCompletions(existingProps: string[]): CompletionItem[] {
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
    .filter(p => !existingProps.includes(p.name))
    .map(prop => ({
      label: prop.name,
      kind: CompletionItemKind.Property,
      detail: prop.type,
      documentation: {
        kind: MarkupKind.Markdown,
        value: prop.description,
      },
      insertText: `${prop.name}="\${1}"`,
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: "2" + prop.name,
    }));
}

/**
 * Get slot name completions
 */
function getSlotCompletions(source: string, currentLine: number): CompletionItem[] {
  const items: CompletionItem[] = [];
  
  // Find the parent component to suggest its slots
  const componentContext = findParentComponent(source, currentLine);
  
  if (componentContext && laravelManager.isAvailable()) {
    const component = componentRepository.findByTag(componentContext) ||
                     componentRepository.find(componentContext.replace(/^x-/, ''));
    
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
function findParentComponent(source: string, currentLine: number): string | null {
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

connection.onCompletionResolve((item: CompletionItem): CompletionItem => item);

// Hover handler
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const tree = treeCache.get(params.textDocument.uri) || parseDocument(document);
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
            value: formatDirectiveHover(directive),
          },
        };
      }
    }
  }

  // Check for special variables
  const lineText = source.split("\n")[position.line];
  const wordAtPosition = getWordAtPosition(lineText, position.character);

  if (wordAtPosition === "$loop" || wordAtPosition.startsWith("$loop->")) {
    return { contents: { kind: MarkupKind.Markdown, value: formatLoopVariableHover() } };
  }

  if (wordAtPosition === "$slot") {
    return { contents: { kind: MarkupKind.Markdown, value: formatSlotVariableHover() } };
  }

  if (wordAtPosition === "$attributes" || wordAtPosition.startsWith("$attributes->")) {
    return { contents: { kind: MarkupKind.Markdown, value: formatAttributesVariableHover() } };
  }

  // Check for component hover
  const componentHover = getComponentHover(lineText, position.character);
  if (componentHover) {
    return componentHover;
  }

  // Check for view hover in directives
  const viewHover = getViewHover(lineText, position.character);
  if (viewHover) {
    return viewHover;
  }

  return null;
});

function formatDirectiveHover(directive: BladeDirective): string {
  let content = `## ${directive.name}\n\n${directive.description}\n\n`;
  if (directive.parameters) content += `**Parameters:** \`${directive.parameters}\`\n\n`;
  if (directive.hasEndTag && directive.endTag) content += `**End tag:** \`${directive.endTag}\`\n\n`;
  if (directive.snippet) {
    content += "**Example:**\n```blade\n";
    content += directive.snippet.replace(/\$\{\d+:?([^}]*)\}/g, "$1").replace(/\$\d+/g, "");
    content += "\n```";
  }
  return content;
}

function formatLoopVariableHover(): string {
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

function formatSlotVariableHover(): string {
  return `## $slot Variable

Contains the content passed to a component.

\`\`\`blade
<div class="alert">{{ $slot }}</div>
\`\`\``;
}

function formatAttributesVariableHover(): string {
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
function getComponentHover(line: string, column: number): Hover | null {
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
  
  if (!laravelManager.isAvailable()) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `## ${componentTag}\n\nBlade component`,
      },
    };
  }
  
  const component = componentRepository.findByTag(componentTag) ||
                   componentRepository.find(componentTag.replace(/^x-/, ''));
  
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
function getViewHover(line: string, column: number): Hover | null {
  const viewDirectives = ['extends', 'include', 'includeIf', 'includeWhen', 'includeUnless', 'includeFirst', 'each', 'component'];
  
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
function getViewHoverContent(viewName: string): Hover {
  if (!laravelManager.isAvailable()) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `## ${viewName}\n\nBlade view`,
      },
    };
  }
  
  const view = viewRepository.find(viewName);
  
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

function getWordAtPosition(line: string, column: number): string {
  let start = column;
  let end = column;
  while (start > 0 && /[\w$>-]/.test(line[start - 1])) start--;
  while (end < line.length && /[\w$>-]/.test(line[end])) end++;
  return line.slice(start, end);
}

// Definition handler (go to definition)
connection.onDefinition((params: DefinitionParams): Location | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  
  const source = document.getText();
  const position = params.position;
  const lines = source.split('\n');
  const currentLine = lines[position.line] || '';
  
  // Check for view reference in directives
  const viewDefinition = getViewDefinition(currentLine, position.character, source, position.line);
  if (viewDefinition) {
    return viewDefinition;
  }
  
  // Check for component reference
  const componentDefinition = getComponentDefinition(currentLine, position.character);
  if (componentDefinition) {
    return componentDefinition;
  }
  
  return null;
});

/**
 * Get definition location for a view reference
 */
function getViewDefinition(line: string, column: number, source: string, lineNum: number): Location | null {
  // Match view references in directives like @extends('layouts.app'), @include('partials.header')
  const viewDirectives = ['extends', 'include', 'includeIf', 'includeWhen', 'includeUnless', 'includeFirst', 'each', 'component'];
  
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
function resolveViewLocation(viewName: string): Location | null {
  if (!laravelManager.isAvailable() || !workspaceRoot) {
    return null;
  }
  
  const view = viewRepository.find(viewName);
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
function getComponentDefinition(line: string, column: number): Location | null {
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
function resolveComponentLocation(componentTag: string): Location | null {
  if (!laravelManager.isAvailable() || !workspaceRoot) {
    return null;
  }
  
  const component = componentRepository.findByTag(componentTag) ||
                   componentRepository.find(componentTag.replace(/^x-/, ''));
  
  if (!component) {
    return null;
  }
  
  const fullPath = path.join(workspaceRoot, component.path);
  
  return {
    uri: `file://${fullPath}`,
    range: Range.create(0, 0, 0, 0),
  };
}

documents.listen(connection);
connection.listen();

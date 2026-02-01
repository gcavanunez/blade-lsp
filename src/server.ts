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
} from "vscode-languageserver/node";
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

// Create the connection
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Cache for parsed trees
const treeCache = new Map<string, Tree>();

connection.onInitialize((_params: InitializeParams): InitializeResult => {
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
        triggerCharacters: ["@", "'", '"', "$", "{"],
      },
      hoverProvider: true,
    },
  };
});

connection.onInitialized(() => {
  connection.console.log("Laravel Blade LSP initialized");
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
    const matchingDirectives = getMatchingDirectives(context.prefix);
    for (const directive of matchingDirectives) {
      items.push(createDirectiveCompletionItem(directive, context.prefix));
    }
  } else if (context.type === "html") {
    const line = source.split("\n")[position.line];
    const textBeforeCursor = line.slice(0, position.character);
    if (textBeforeCursor.endsWith("@")) {
      for (const directive of bladeDirectives) {
        items.push(createDirectiveCompletionItem(directive, "@"));
      }
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
      items.push(
        { label: "layouts.app", kind: CompletionItemKind.File, detail: "Main layout" },
        { label: "layouts.guest", kind: CompletionItemKind.File, detail: "Guest layout" },
        { label: "components.", kind: CompletionItemKind.Folder, detail: "Components" },
        { label: "partials.", kind: CompletionItemKind.Folder, detail: "Partials" },
      );
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
  }

  return items;
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

function getWordAtPosition(line: string, column: number): string {
  let start = column;
  let end = column;
  while (start > 0 && /[\w$>-]/.test(line[start - 1])) start--;
  while (end < line.length && /[\w$>-]/.test(line[end])) end++;
  return line.slice(start, end);
}

documents.listen(connection);
connection.listen();

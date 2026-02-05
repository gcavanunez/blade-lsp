import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver/node';
import * as path from 'path';
import * as fs from 'fs';
import { Shared } from './shared';
import { BladeDirectives } from '../directives';
import {
  Laravel,
  Views,
  Components,
  Directives,
  type ViewItem,
  type ComponentItem,
  type CustomDirective,
} from '../laravel';
import { Server } from '../server';

export namespace Completions {
  // Re-export shared types and functions so existing call sites work
  export type ComponentPropContext = Shared.ComponentPropContext;
  export type ParsedProp = Shared.ParsedProp;
  export const getComponentPropContext = Shared.getComponentPropContext;
  export const extractExistingProps = Shared.extractExistingProps;
  export const findParentComponent = Shared.findParentComponent;
  export const parsePropsString = Shared.parsePropsString;

  export function createDirectiveItem(directive: BladeDirectives.Directive, prefix: string): CompletionItem {
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

  export function getLivewireCompletions(textBeforeCursor: string, position: Position): CompletionItem[] {
    const items: CompletionItem[] = [];

    // Calculate the start position of the livewire tag (where '<livewire:' begins)
    const match = textBeforeCursor.match(/<(livewire:[\w.-]*)$/);
    const partialName = match ? match[1] : 'livewire:';
    const matchedText = match ? match[0] : '<livewire:';
    const startCharacter = position.character - matchedText.length;

    const replaceRange = Range.create(Position.create(position.line, startCharacter), position);

    if (!Laravel.isAvailable()) {
      return items;
    }

    // Get Livewire components from views (views starting with 'livewire.')
    const views = Views.getItems();
    const livewireViews = views.filter((v) => v.key.startsWith('livewire.'));

    for (const view of livewireViews) {
      // Convert view key 'livewire.counter' to tag 'livewire:counter'
      const componentName = view.key.replace('livewire.', '').replace(/\./g, '.');
      const fullTag = `livewire:${componentName}`;

      // Check if it matches the partial name being typed
      if (fullTag.startsWith(partialName) || partialName === 'livewire:') {
        items.push(createLivewireCompletionItem(view, componentName, replaceRange));
      }
    }

    return items;
  }

  export function createLivewireCompletionItem(
    view: ViewItem,
    componentName: string,
    replaceRange: Range
  ): CompletionItem {
    const fullTag = `livewire:${componentName}`;
    let documentation = `**${fullTag}**\n\n`;
    documentation += `**Type:** Livewire component\n\n`;
    documentation += `**Path:** \`${view.path}\`\n`;

    // Include Livewire-specific props if available
    if (view.livewire?.props && view.livewire.props.length > 0) {
      documentation += '\n**Props:**\n\n';
      documentation += '| Name | Type |\n';
      documentation += '|------|------|\n';
      for (const prop of view.livewire.props) {
        documentation += `| \`${prop.name}\` | ${prop.type} |\n`;
      }
    }

    return {
      label: fullTag,
      kind: CompletionItemKind.Class,
      detail: view.isVendor ? 'Livewire component (vendor)' : 'Livewire component',
      documentation: {
        kind: MarkupKind.Markdown,
        value: documentation,
      },
      textEdit: TextEdit.replace(replaceRange, `<${fullTag}`),
      insertTextFormat: InsertTextFormat.PlainText,
      sortText: view.isVendor ? '1' + componentName : '0' + componentName,
    };
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
   * Get prop completions for a component
   */
  export function getComponentPropCompletions(
    componentName: string,
    existingProps: string[]
  ): CompletionItem[] {
    const items: CompletionItem[] = [];

    if (!Laravel.isAvailable()) {
      return [];
    }

    // Find the component
    const component =
      Components.findByTag(componentName) ||
      Components.find(componentName.replace(/^x-/, ''));

    if (!component) {
      return [];
    }

    // Add props from the component
    if (component.props) {
      if (typeof component.props === 'string') {
        // Parse @props() string
        const propsFromString = Shared.parsePropsString(component.props);
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

    return items;
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
   * Get slot name completions
   * @param syntax - 'colon' for <x-slot:name> or 'name' for <x-slot name="name">
   */
  export function getSlotCompletions(
    source: string,
    currentLine: number,
    syntax: 'colon' | 'name' = 'colon'
  ): CompletionItem[] {
    const items: CompletionItem[] = [];

    // Find the parent component to suggest its slots
    const componentContext = Shared.findParentComponent(source, currentLine);

    if (componentContext && Laravel.isAvailable()) {
      const component =
        Components.findByTag(componentContext) ||
        Components.find(componentContext.replace(/^x-/, ''));

      if (component) {
        const slots = extractSlotsFromComponent(component);
        for (const slot of slots) {
          // Different insert text based on syntax
          const insertText =
            syntax === 'colon'
              ? `${slot.name}>$0</x-slot>` // <x-slot:name>...</x-slot>
              : `${slot.name}">$0</x-slot>`; // <x-slot name="name">...</x-slot>

          items.push({
            label: slot.name,
            kind: CompletionItemKind.Value,
            detail: `Named slot in ${component.key}`,
            documentation: {
              kind: MarkupKind.Markdown,
              value: `Slot \`${slot.name}\` from component \`${component.fullTag}\``,
            },
            insertText,
            insertTextFormat: InsertTextFormat.Snippet,
          });
        }
      }
    }

    return items;
  }

  /**
   * Extract named slots from a component file
   */
  export function extractSlotsFromComponent(component: ComponentItem): { name: string }[] {
    const workspaceRoot = Server.getWorkspaceRoot();
    if (!workspaceRoot) {
      return [];
    }

    const fullPath = path.join(workspaceRoot, component.path);

    // Only extract from blade files
    if (!component.path.endsWith('.blade.php')) {
      return [];
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return Shared.extractSlotsFromContent(content);
    } catch {
      return [];
    }
  }
}

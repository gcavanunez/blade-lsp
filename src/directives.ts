/**
 * Blade directive definitions with documentation and snippets
 */

export namespace BladeDirectives {
  export interface Directive {
    name: string;
    description: string;
    snippet?: string;
    hasEndTag?: boolean;
    endTag?: string;
    parameters?: string;
  }

  export const all: Directive[] = [
    // Conditionals
    {
      name: "@if",
      description: "Start a conditional block. Evaluates the given PHP expression.",
      snippet: "@if (${1:condition})\n\t$0\n@endif",
      hasEndTag: true,
      endTag: "@endif",
      parameters: "(condition)",
    },
    {
      name: "@elseif",
      description: "Add an else-if condition to an @if block.",
      snippet: "@elseif (${1:condition})",
      parameters: "(condition)",
    },
    {
      name: "@else",
      description: "Add an else clause to an @if block.",
      snippet: "@else",
    },
    {
      name: "@endif",
      description: "End an @if conditional block.",
      snippet: "@endif",
    },
    {
      name: "@unless",
      description: "Start a conditional block that executes unless the condition is true.",
      snippet: "@unless (${1:condition})\n\t$0\n@endunless",
      hasEndTag: true,
      endTag: "@endunless",
      parameters: "(condition)",
    },
    {
      name: "@endunless",
      description: "End an @unless conditional block.",
      snippet: "@endunless",
    },
    {
      name: "@isset",
      description: "Check if a variable is set and is not null.",
      snippet: "@isset (${1:\\$variable})\n\t$0\n@endisset",
      hasEndTag: true,
      endTag: "@endisset",
      parameters: "(variable)",
    },
    {
      name: "@endisset",
      description: "End an @isset block.",
      snippet: "@endisset",
    },
    {
      name: "@empty",
      description: "Check if a variable is empty.",
      snippet: "@empty (${1:\\$variable})\n\t$0\n@endempty",
      hasEndTag: true,
      endTag: "@endempty",
      parameters: "(variable)",
    },
    {
      name: "@endempty",
      description: "End an @empty block.",
      snippet: "@endempty",
    },

    // Authentication
    {
      name: "@auth",
      description: "Display content only if the user is authenticated.",
      snippet: "@auth${1:(${2:'guard'})}\n\t$0\n@endauth",
      hasEndTag: true,
      endTag: "@endauth",
      parameters: "('guard')?",
    },
    {
      name: "@endauth",
      description: "End an @auth block.",
      snippet: "@endauth",
    },
    {
      name: "@guest",
      description: "Display content only if the user is a guest (not authenticated).",
      snippet: "@guest${1:(${2:'guard'})}\n\t$0\n@endguest",
      hasEndTag: true,
      endTag: "@endguest",
      parameters: "('guard')?",
    },
    {
      name: "@endguest",
      description: "End a @guest block.",
      snippet: "@endguest",
    },

    // Loops
    {
      name: "@for",
      description: "Start a for loop.",
      snippet: "@for (${1:\\$i = 0}; ${2:\\$i < count}; ${3:\\$i++})\n\t$0\n@endfor",
      hasEndTag: true,
      endTag: "@endfor",
      parameters: "(init; condition; increment)",
    },
    {
      name: "@endfor",
      description: "End a @for loop.",
      snippet: "@endfor",
    },
    {
      name: "@foreach",
      description: "Start a foreach loop. The $loop variable is available inside.",
      snippet: "@foreach (${1:\\$items} as ${2:\\$item})\n\t$0\n@endforeach",
      hasEndTag: true,
      endTag: "@endforeach",
      parameters: "(array as item)",
    },
    {
      name: "@endforeach",
      description: "End a @foreach loop.",
      snippet: "@endforeach",
    },
    {
      name: "@forelse",
      description: "Foreach loop with an @empty fallback for empty arrays.",
      snippet: "@forelse (${1:\\$items} as ${2:\\$item})\n\t$0\n@empty\n\t\n@endforelse",
      hasEndTag: true,
      endTag: "@endforelse",
      parameters: "(array as item)",
    },
    {
      name: "@endforelse",
      description: "End a @forelse loop.",
      snippet: "@endforelse",
    },
    {
      name: "@while",
      description: "Start a while loop.",
      snippet: "@while (${1:condition})\n\t$0\n@endwhile",
      hasEndTag: true,
      endTag: "@endwhile",
      parameters: "(condition)",
    },
    {
      name: "@endwhile",
      description: "End a @while loop.",
      snippet: "@endwhile",
    },
    {
      name: "@continue",
      description: "Continue to the next iteration of a loop.",
      snippet: "@continue${1:(${2:condition})}",
      parameters: "(condition)?",
    },
    {
      name: "@break",
      description: "Break out of a loop.",
      snippet: "@break${1:(${2:condition})}",
      parameters: "(condition)?",
    },

    // Switch
    {
      name: "@switch",
      description: "Start a switch statement.",
      snippet:
        "@switch(${1:\\$variable})\n\t@case(${2:value})\n\t\t$0\n\t\t@break\n\t@default\n\t\t\n@endswitch",
      hasEndTag: true,
      endTag: "@endswitch",
      parameters: "(variable)",
    },
    {
      name: "@case",
      description: "Define a case in a switch statement.",
      snippet: "@case(${1:value})",
      parameters: "(value)",
    },
    {
      name: "@default",
      description: "Define the default case in a switch statement.",
      snippet: "@default",
    },
    {
      name: "@endswitch",
      description: "End a @switch statement.",
      snippet: "@endswitch",
    },

    // Template inheritance
    {
      name: "@extends",
      description: "Extend a parent layout template.",
      snippet: "@extends('${1:layouts.app}')",
      parameters: "('layout')",
    },
    {
      name: "@section",
      description: "Define a section of content.",
      snippet: "@section('${1:name}')\n\t$0\n@endsection",
      hasEndTag: true,
      endTag: "@endsection",
      parameters: "('name')",
    },
    {
      name: "@endsection",
      description: "End a @section block.",
      snippet: "@endsection",
    },
    {
      name: "@yield",
      description: "Display the contents of a section.",
      snippet: "@yield('${1:name}'${2:, '${3:default}'})",
      parameters: "('name', 'default'?)",
    },
    {
      name: "@parent",
      description: "Append to (rather than overwrite) the parent section.",
      snippet: "@parent",
    },
    {
      name: "@show",
      description: "End a section and immediately yield it.",
      snippet: "@show",
    },
    {
      name: "@stop",
      description: "Stop a section without yielding it.",
      snippet: "@stop",
    },
    {
      name: "@overwrite",
      description: "Overwrite an entire section.",
      snippet: "@overwrite",
    },

    // Components
    {
      name: "@component",
      description: "Render a component.",
      snippet: "@component('${1:component}')\n\t$0\n@endcomponent",
      hasEndTag: true,
      endTag: "@endcomponent",
      parameters: "('component', data?)",
    },
    {
      name: "@endcomponent",
      description: "End a @component block.",
      snippet: "@endcomponent",
    },
    {
      name: "@slot",
      description: "Define a slot within a component.",
      snippet: "@slot('${1:name}')\n\t$0\n@endslot",
      hasEndTag: true,
      endTag: "@endslot",
      parameters: "('name')",
    },
    {
      name: "@endslot",
      description: "End a @slot block.",
      snippet: "@endslot",
    },
    {
      name: "@props",
      description: "Define component properties with defaults.",
      snippet: "@props([${1:'property' => 'default'}])",
      parameters: "(['property' => 'default'])",
    },

    // Including views
    {
      name: "@include",
      description: "Include another Blade view.",
      snippet: "@include('${1:view.name}'${2:, [${3:'key' => 'value'}]})",
      parameters: "('view', data?)",
    },
    {
      name: "@includeIf",
      description: "Include a view if it exists.",
      snippet: "@includeIf('${1:view.name}'${2:, [${3:'key' => 'value'}]})",
      parameters: "('view', data?)",
    },
    {
      name: "@includeWhen",
      description: "Include a view when a condition is true.",
      snippet: "@includeWhen(${1:condition}, '${2:view.name}'${3:, [${4:'key' => 'value'}]})",
      parameters: "(condition, 'view', data?)",
    },
    {
      name: "@includeUnless",
      description: "Include a view unless a condition is true.",
      snippet: "@includeUnless(${1:condition}, '${2:view.name}'${3:, [${4:'key' => 'value'}]})",
      parameters: "(condition, 'view', data?)",
    },
    {
      name: "@includeFirst",
      description: "Include the first view that exists from an array.",
      snippet: "@includeFirst(['${1:view1}', '${2:view2}']${3:, [${4:'key' => 'value'}]})",
      parameters: "(['views'], data?)",
    },
    {
      name: "@each",
      description: "Render a view for each item in a collection.",
      snippet: "@each('${1:view}', ${2:\\$items}, '${3:item}'${4:, '${5:empty}'})",
      parameters: "('view', collection, 'varName', 'emptyView'?)",
    },

    // Stacks
    {
      name: "@stack",
      description: "Render a stack of pushed content.",
      snippet: "@stack('${1:name}')",
      parameters: "('name')",
    },
    {
      name: "@push",
      description: "Push content onto a stack.",
      snippet: "@push('${1:name}')\n\t$0\n@endpush",
      hasEndTag: true,
      endTag: "@endpush",
      parameters: "('name')",
    },
    {
      name: "@endpush",
      description: "End a @push block.",
      snippet: "@endpush",
    },
    {
      name: "@pushOnce",
      description: "Push content onto a stack only once.",
      snippet: "@pushOnce('${1:name}')\n\t$0\n@endPushOnce",
      hasEndTag: true,
      endTag: "@endPushOnce",
      parameters: "('name')",
    },
    {
      name: "@endPushOnce",
      description: "End a @pushOnce block.",
      snippet: "@endPushOnce",
    },
    {
      name: "@prepend",
      description: "Prepend content to a stack.",
      snippet: "@prepend('${1:name}')\n\t$0\n@endprepend",
      hasEndTag: true,
      endTag: "@endprepend",
      parameters: "('name')",
    },
    {
      name: "@endprepend",
      description: "End a @prepend block.",
      snippet: "@endprepend",
    },
    {
      name: "@prependOnce",
      description: "Prepend content to a stack only once.",
      snippet: "@prependOnce('${1:name}')\n\t$0\n@endPrependOnce",
      hasEndTag: true,
      endTag: "@endPrependOnce",
      parameters: "('name')",
    },
    {
      name: "@endPrependOnce",
      description: "End a @prependOnce block.",
      snippet: "@endPrependOnce",
    },

    // Raw PHP
    {
      name: "@php",
      description: "Execute raw PHP code.",
      snippet: "@php\n\t$0\n@endphp",
      hasEndTag: true,
      endTag: "@endphp",
    },
    {
      name: "@endphp",
      description: "End a @php block.",
      snippet: "@endphp",
    },

    // Escaping
    {
      name: "@verbatim",
      description: "Wrap content to prevent Blade from parsing it.",
      snippet: "@verbatim\n\t$0\n@endverbatim",
      hasEndTag: true,
      endTag: "@endverbatim",
    },
    {
      name: "@endverbatim",
      description: "End a @verbatim block.",
      snippet: "@endverbatim",
    },

    // CSRF & Method
    {
      name: "@csrf",
      description: "Generate a CSRF token hidden field.",
      snippet: "@csrf",
    },
    {
      name: "@method",
      description: "Generate a hidden form field for HTTP method spoofing.",
      snippet: "@method('${1|PUT,PATCH,DELETE|}')",
      parameters: "('method')",
    },

    // Errors & Validation
    {
      name: "@error",
      description: "Check if a validation error exists for an attribute.",
      snippet: "@error('${1:field}')\n\t{{ \\$message }}\n@enderror",
      hasEndTag: true,
      endTag: "@enderror",
      parameters: "('field', 'bag'?)",
    },
    {
      name: "@enderror",
      description: "End an @error block.",
      snippet: "@enderror",
    },

    // JavaScript Frameworks
    {
      name: "@json",
      description: "Output a variable as JSON.",
      snippet: "@json(${1:\\$variable}${2:, ${3:JSON_PRETTY_PRINT}})",
      parameters: "(variable, flags?)",
    },
    {
      name: "@js",
      description: "Output a PHP variable as JavaScript (Blade 9+).",
      snippet: "@js(${1:\\$variable})",
      parameters: "(variable)",
    },

    // Production checks
    {
      name: "@production",
      description: "Display content only in production environment.",
      snippet: "@production\n\t$0\n@endproduction",
      hasEndTag: true,
      endTag: "@endproduction",
    },
    {
      name: "@endproduction",
      description: "End a @production block.",
      snippet: "@endproduction",
    },
    {
      name: "@env",
      description: "Display content only in specified environment(s).",
      snippet: "@env('${1:local}')\n\t$0\n@endenv",
      hasEndTag: true,
      endTag: "@endenv",
      parameters: "('environment')",
    },
    {
      name: "@endenv",
      description: "End an @env block.",
      snippet: "@endenv",
    },

    // Session
    {
      name: "@session",
      description: "Check if a session key exists.",
      snippet: "@session('${1:key}')\n\t$0\n@endsession",
      hasEndTag: true,
      endTag: "@endsession",
      parameters: "('key')",
    },
    {
      name: "@endsession",
      description: "End a @session block.",
      snippet: "@endsession",
    },

    // Authorization
    {
      name: "@can",
      description: "Check if the user has a given ability.",
      snippet: "@can('${1:ability}'${2:, ${3:\\$model}})\n\t$0\n@endcan",
      hasEndTag: true,
      endTag: "@endcan",
      parameters: "('ability', model?)",
    },
    {
      name: "@endcan",
      description: "End a @can block.",
      snippet: "@endcan",
    },
    {
      name: "@cannot",
      description: "Check if the user lacks a given ability.",
      snippet: "@cannot('${1:ability}'${2:, ${3:\\$model}})\n\t$0\n@endcannot",
      hasEndTag: true,
      endTag: "@endcannot",
      parameters: "('ability', model?)",
    },
    {
      name: "@endcannot",
      description: "End a @cannot block.",
      snippet: "@endcannot",
    },
    {
      name: "@canany",
      description: "Check if the user has any of the given abilities.",
      snippet:
        "@canany(['${1:ability1}', '${2:ability2}']${3:, ${4:\\$model}})\n\t$0\n@endcanany",
      hasEndTag: true,
      endTag: "@endcanany",
      parameters: "(['abilities'], model?)",
    },
    {
      name: "@endcanany",
      description: "End a @canany block.",
      snippet: "@endcanany",
    },
    {
      name: "@elsecan",
      description: "Check alternative ability in a @can block.",
      snippet: "@elsecan('${1:ability}'${2:, ${3:\\$model}})",
      parameters: "('ability', model?)",
    },
    {
      name: "@elsecannot",
      description: "Check alternative inability in a @cannot block.",
      snippet: "@elsecannot('${1:ability}'${2:, ${3:\\$model}})",
      parameters: "('ability', model?)",
    },

    // Classes & Styles (Blade 8+)
    {
      name: "@class",
      description: "Conditionally compile a CSS class string.",
      snippet: "@class([${1:'class' => condition}])",
      parameters: "(['class' => condition])",
    },
    {
      name: "@style",
      description: "Conditionally compile an inline CSS style string.",
      snippet: "@style([${1:'style: value' => condition}])",
      parameters: "(['style' => condition])",
    },

    // Checked, Selected, Disabled, Required, Readonly (Blade 9+)
    {
      name: "@checked",
      description: "Add 'checked' attribute if condition is true.",
      snippet: "@checked(${1:condition})",
      parameters: "(condition)",
    },
    {
      name: "@selected",
      description: "Add 'selected' attribute if condition is true.",
      snippet: "@selected(${1:condition})",
      parameters: "(condition)",
    },
    {
      name: "@disabled",
      description: "Add 'disabled' attribute if condition is true.",
      snippet: "@disabled(${1:condition})",
      parameters: "(condition)",
    },
    {
      name: "@required",
      description: "Add 'required' attribute if condition is true.",
      snippet: "@required(${1:condition})",
      parameters: "(condition)",
    },
    {
      name: "@readonly",
      description: "Add 'readonly' attribute if condition is true.",
      snippet: "@readonly(${1:condition})",
      parameters: "(condition)",
    },

    // Once
    {
      name: "@once",
      description: "Render content only once per rendering cycle.",
      snippet: "@once\n\t$0\n@endonce",
      hasEndTag: true,
      endTag: "@endonce",
    },
    {
      name: "@endonce",
      description: "End a @once block.",
      snippet: "@endonce",
    },

    // Comments
    {
      name: "{{--",
      description: "Start a Blade comment (not rendered in HTML).",
      snippet: "{{-- ${1:comment} --}}",
    },

    // Fragments (Laravel 9+)
    {
      name: "@fragment",
      description: "Define a fragment that can be returned individually.",
      snippet: "@fragment('${1:name}')\n\t$0\n@endfragment",
      hasEndTag: true,
      endTag: "@endfragment",
      parameters: "('name')",
    },
    {
      name: "@endfragment",
      description: "End a @fragment block.",
      snippet: "@endfragment",
    },

    // Livewire
    {
      name: "@livewire",
      description: "Render a Livewire component.",
      snippet: "@livewire('${1:component}'${2:, [${3:'key' => 'value'}]})",
      parameters: "('component', data?)",
    },
    {
      name: "@livewireStyles",
      description: "Include Livewire styles.",
      snippet: "@livewireStyles",
    },
    {
      name: "@livewireScripts",
      description: "Include Livewire scripts.",
      snippet: "@livewireScripts",
    },

    // Vite
    {
      name: "@vite",
      description: "Include Vite assets.",
      snippet: "@vite(['${1:resources/css/app.css}', '${2:resources/js/app.js}'])",
      parameters: "(['assets'])",
    },
    {
      name: "@viteReactRefresh",
      description: "Include Vite React refresh script.",
      snippet: "@viteReactRefresh",
    },

    // Aware (props inheritance)
    {
      name: "@aware",
      description: "Access parent component data in child components.",
      snippet: "@aware(['${1:property}'])",
      parameters: "(['properties'])",
    },

    // Lang/Localization
    {
      name: "@lang",
      description: "Translate a given language line.",
      snippet: "@lang('${1:messages.welcome}')",
      parameters: "('key')",
    },

    // Use (for traits in anonymous components)
    {
      name: "@use",
      description: "Import a PHP class or namespace for use in Blade.",
      snippet: "@use('${1:App\\Models\\User}')",
      parameters: "('class')",
    },
  ];

  /**
   * Map of directive names to their definitions for quick lookup
   */
  export const map = new Map<string, Directive>(all.map((d) => [d.name, d]));

  /**
   * Get directives that match a given prefix
   */
  export function getMatching(prefix: string): Directive[] {
    const lowerPrefix = prefix.toLowerCase();
    return all.filter((d) => d.name.toLowerCase().startsWith(lowerPrefix));
  }
}

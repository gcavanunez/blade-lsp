/**
 * Benchmark fixture generators.
 *
 * Produces realistic Blade templates at various sizes for benchmarking.
 * Templates include a representative mix of HTML, Blade directives,
 * component tags, echo expressions, and @php blocks.
 */

import { Lexer } from '../src/parser/lexer';
import { PhpBridgeRegions } from '../src/providers/php-bridge/regions';
import { PhpBridgeShadowDocument } from '../src/providers/php-bridge/shadow-document';

// ─── Blade template generation ──────────────────────────────────────────────

const HTML_LINES = [
    '<div class="container mx-auto px-4">',
    '    <h1 class="text-2xl font-bold">{{ $title }}</h1>',
    '    <p class="text-gray-600">{{ $description }}</p>',
    '    <span class="badge badge-primary">{{ $status }}</span>',
    '    <a href="{{ route(\'home\') }}" class="underline">Home</a>',
    '    <img src="{{ asset(\'images/logo.png\') }}" alt="Logo" />',
    '    <input type="text" value="{{ old(\'name\') }}" />',
    '</div>',
    '<section class="py-8">',
    '    <div class="grid grid-cols-3 gap-4">',
    '        <div class="card shadow-md p-4">',
    '            <h3>{{ $item->name }}</h3>',
    '        </div>',
    '    </div>',
    '</section>',
];

const DIRECTIVE_BLOCKS = [
    // if block
    ['@if($user->isAdmin())', '    <span>Admin</span>', '@endif'],
    // foreach block
    ['@foreach($items as $item)', '    <li>{{ $item->name }}</li>', '@endforeach'],
    // forelse block
    ['@forelse($users as $user)', '    <p>{{ $user->email }}</p>', '@empty', '    <p>No users</p>', '@endforelse'],
    // auth block
    ['@auth', '    <p>Welcome, {{ auth()->user()->name }}</p>', '@endauth'],
    // guest block
    ['@guest', '    <a href="{{ route(\'login\') }}">Login</a>', '@endguest'],
    // section
    ["@section('content')", '    <main class="py-12">', '    </main>', '@endsection'],
    // unless
    ['@unless($disabled)', '    <button type="submit">Submit</button>', '@endunless'],
    // can
    ["@can('update', $post)", '    <a href="#">Edit</a>', '@endcan'],
];

const COMPONENT_BLOCKS = [
    ['<x-button type="submit">Save</x-button>'],
    [
        '<x-alert type="warning" :dismissible="true">',
        '    <x-slot:title>Warning</x-slot:title>',
        '    Something happened.',
        '</x-alert>',
    ],
    ['<x-card>', '    <x-slot:header>{{ $title }}</x-slot:header>', '    <p>{{ $content }}</p>', '</x-card>'],
    ['<x-input name="email" type="email" :value="$email" />'],
    ['<x-modal id="confirm-dialog">', '    <p>Are you sure?</p>', '</x-modal>'],
];

const PHP_BLOCKS = [
    ['@php', '    $count = count($items);', "    $total = $items->sum('amount');", '@endphp'],
    ['@php', '    $formatted = number_format($price, 2);', '@endphp'],
    [
        '@php',
        '    $categories = \\App\\Models\\Category::all();',
        "    $activeCount = $categories->where('active', true)->count();",
        '@endphp',
    ],
    ['<?php', '    use App\\Models\\User;', '    $users = User::query()->active()->get();', '?>'],
    ['@php', '    $now = now();', "    $greeting = $now->hour < 12 ? 'Good morning' : 'Good afternoon';", '@endphp'],
];

/**
 * Generate a realistic Blade template with approximately `targetLines` lines.
 *
 * The template mixes HTML, directives, components, echo expressions,
 * and PHP blocks in proportions similar to real-world Blade files.
 */
export function generateBladeTemplate(targetLines: number): string {
    const lines: string[] = ["@extends('layouts.app')", '', "@section('content')"];

    let lineCount = lines.length;

    // Cycle through content types to build up to the target
    let blockIndex = 0;
    const blocks = [...HTML_LINES.map((l) => [l]), ...DIRECTIVE_BLOCKS, ...COMPONENT_BLOCKS, ...PHP_BLOCKS];

    while (lineCount < targetLines - 2) {
        const block = blocks[blockIndex % blocks.length];
        for (const line of block) {
            lines.push(line);
            lineCount++;
            if (lineCount >= targetLines - 2) break;
        }
        lines.push('');
        lineCount++;
        blockIndex++;
    }

    lines.push('@endsection');
    return lines.join('\n');
}

/**
 * Generate a Blade template that has approximately `regionCount` PHP regions
 * spread throughout HTML content.
 */
export function generateBladeWithPhpRegions(regionCount: number): string {
    const lines: string[] = ['<div class="app">'];

    for (let i = 0; i < regionCount; i++) {
        // Add some HTML between regions
        lines.push(`    <section id="section-${i}">`, `        <h2>Section ${i}</h2>`);

        // Alternate between different PHP region styles
        const phpBlock = PHP_BLOCKS[i % PHP_BLOCKS.length];
        for (const line of phpBlock) {
            lines.push(`        ${line}`);
        }

        lines.push(`        <p>{{ $count }}</p>`, '    </section>', '');
    }

    lines.push('</div>');
    return lines.join('\n');
}

// ─── Pre-built fixtures at standard sizes ───────────────────────────────────

export const SMALL_TEMPLATE = generateBladeTemplate(100);
export const MEDIUM_TEMPLATE = generateBladeTemplate(500);
export const LARGE_TEMPLATE = generateBladeTemplate(2000);

export const TEMPLATE_5_REGIONS = generateBladeWithPhpRegions(5);
export const TEMPLATE_10_REGIONS = generateBladeWithPhpRegions(10);
export const TEMPLATE_20_REGIONS = generateBladeWithPhpRegions(20);

// ─── Derived fixtures ───────────────────────────────────────────────────────

/**
 * Pre-extract regions from a template source for benchmarks that need
 * shadow documents or region data without paying extraction cost per iteration.
 */
export function prepareExtraction(source: string): PhpBridgeRegions.RegionExtraction {
    return PhpBridgeRegions.extract(source);
}

/**
 * Pre-build a shadow document from a template source.
 */
export function prepareShadow(
    source: string,
    extraction?: PhpBridgeRegions.RegionExtraction,
): PhpBridgeShadowDocument.ShadowDocument {
    const ext = extraction ?? prepareExtraction(source);
    return PhpBridgeShadowDocument.build('/test/project', 'file:///test/project/resources/views/bench.blade.php', ext);
}

/**
 * Pick a random offset within the source that falls inside a PHP region.
 * Returns both the offset and its containing region.
 */
export function randomPhpOffset(
    source: string,
    extraction: PhpBridgeRegions.RegionExtraction,
): { offset: number; region: PhpBridgeRegions.Region } {
    const region = extraction.regions[Math.floor(Math.random() * extraction.regions.length)];
    const rangeSize = region.contentOffsetEnd - region.contentOffsetStart;
    const offset = region.contentOffsetStart + Math.floor(Math.random() * Math.max(1, rangeSize));
    return { offset, region };
}

/**
 * Pick a random offset anywhere in the source.
 */
export function randomOffset(source: string): number {
    return Math.floor(Math.random() * source.length);
}

/**
 * Pre-lex a source for benchmarks that need the lexed output.
 */
export function prepareLexed(source: string): Lexer.LexedSource {
    return Lexer.lexSource(source);
}

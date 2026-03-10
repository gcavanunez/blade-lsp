import path from 'node:path';
import { PhpBridgeRegions } from './regions';

export namespace PhpBridgeShadowDocument {
    export interface ShadowRegion {
        id: string;
        bladeContentOffsetStart: number;
        bladeContentOffsetEnd: number;
        shadowContentOffsetStart: number;
        shadowContentOffsetEnd: number;
    }

    export interface ShadowDocument {
        bladeUri: string;
        shadowPath: string;
        shadowUri: string;
        content: string;
        regions: ShadowRegion[];
        activeRegionId: string | null;
    }

    export interface BuildOptions {
        activeRegionId?: string;
        shadowDirectory?: string;
    }

    function uriToPath(uri: string): string {
        const parsed = new URL(uri);
        const pathname = decodeURIComponent(parsed.pathname);
        return process.platform === 'win32' ? pathname.replace(/^\/(\w:)/, '$1') : pathname;
    }

    function pathToUri(filePath: string): string {
        const normalized = filePath.split(path.sep).join('/');
        return `file://${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
    }

    function padToLength(value: string, targetLength: number): string {
        if (value.length >= targetLength) {
            return value.slice(0, targetLength);
        }

        return value.padEnd(targetLength, ' ');
    }

    function normalizeAnonymousClasses(content: string): string {
        let transformed = false;
        const normalized = content.replace(/new\s+((?:#\[[^\]]+\]\s*)*)class\b/g, (match) => {
            transformed = true;
            const stripped = match.replace(/^new\s+/, '');
            const rewritten = stripped.replace(/class\b/, 'class _');
            return padToLength(rewritten, match.length);
        });

        if (!transformed) {
            return normalized;
        }

        const lastAnonymousClose = normalized.lastIndexOf('};');
        if (lastAnonymousClose === -1) {
            return normalized;
        }

        return `${normalized.slice(0, lastAnonymousClose)}} ${normalized.slice(lastAnonymousClose + 2)}`;
    }

    function slugifyBladePath(relativePath: string): string {
        return relativePath
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/\.blade\.php$/i, '')
            .replace(/[^A-Za-z0-9._-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    export function getShadowPath(
        workspaceRoot: string,
        bladeUri: string,
        shadowDirectory = path.join('vendor', 'blade-lsp', 'shadow'),
    ): string {
        const bladePath = uriToPath(bladeUri);
        const relativePath = path.relative(workspaceRoot, bladePath);
        const slug = slugifyBladePath(relativePath || path.basename(bladePath, '.blade.php')) || 'shadow';
        return path.join(workspaceRoot, shadowDirectory, `${slug}.php`);
    }

    export function build(
        workspaceRoot: string,
        bladeUri: string,
        extraction: PhpBridgeRegions.RegionExtraction,
        options: BuildOptions = {},
    ): ShadowDocument {
        const shadowPath = getShadowPath(workspaceRoot, bladeUri, options.shadowDirectory);
        const parts: string[] = ['<?php\n'];
        const regions: ShadowRegion[] = [];
        let currentOffset = parts[0].length;
        const orderedRegions = [...extraction.regions];

        // Ensure use imports are grouped at the top to maintain valid PHP semantics.
        // We do not naively move the active region to the top anymore, because that
        // breaks PHP if the active region contains executable code and earlier regions contain imports.
        // For now, we simply maintain natural file order which correctly puts Volt imports and classes
        // before random @php blocks.
        //
        // In the future, we could explicitly parse and hoist `use` statements, but natural order
        // is generally correct for Blade/Volt files.

        for (let index = 0; index < orderedRegions.length; index++) {
            const region = orderedRegions[index];
            const content = normalizeAnonymousClasses(region.content);

            const shadowContentOffsetStart = currentOffset;
            parts.push(content);
            currentOffset += content.length;

            regions.push({
                id: region.id,
                bladeContentOffsetStart: region.contentOffsetStart,
                bladeContentOffsetEnd: region.contentOffsetEnd,
                shadowContentOffsetStart,
                shadowContentOffsetEnd: currentOffset,
            });

            if (!content.endsWith('\n')) {
                parts.push('\n');
                currentOffset += 1;
            }

            if (index < orderedRegions.length - 1) {
                parts.push('\n');
                currentOffset += 1;
            }
        }

        return {
            bladeUri,
            shadowPath,
            shadowUri: pathToUri(shadowPath),
            content: parts.join(''),
            regions,
            activeRegionId: options.activeRegionId ?? null,
        };
    }
}

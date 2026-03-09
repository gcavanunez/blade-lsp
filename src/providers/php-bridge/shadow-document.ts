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

    function slugifyBladePath(relativePath: string): string {
        return relativePath
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/\.blade\.php$/i, '')
            .replace(/[^A-Za-z0-9._-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    export function getShadowPath(workspaceRoot: string, bladeUri: string): string {
        const bladePath = uriToPath(bladeUri);
        const relativePath = path.relative(workspaceRoot, bladePath);
        const slug = slugifyBladePath(relativePath || path.basename(bladePath, '.blade.php')) || 'shadow';
        return path.join(workspaceRoot, '.blade-lsp', 'shadow', `${slug}.php`);
    }

    export function build(
        workspaceRoot: string,
        bladeUri: string,
        extraction: PhpBridgeRegions.RegionExtraction,
    ): ShadowDocument {
        const shadowPath = getShadowPath(workspaceRoot, bladeUri);
        const parts: string[] = ['<?php\n'];
        const regions: ShadowRegion[] = [];
        let currentOffset = parts[0].length;

        for (const region of extraction.regions) {
            const marker = `/* ${region.id} */\n`;
            parts.push(marker);
            currentOffset += marker.length;

            const shadowContentOffsetStart = currentOffset;
            parts.push(region.content);
            currentOffset += region.content.length;

            regions.push({
                id: region.id,
                bladeContentOffsetStart: region.contentOffsetStart,
                bladeContentOffsetEnd: region.contentOffsetEnd,
                shadowContentOffsetStart,
                shadowContentOffsetEnd: currentOffset,
            });

            if (!region.content.endsWith('\n')) {
                parts.push('\n');
                currentOffset += 1;
            }

            parts.push('\n');
            currentOffset += 1;
        }

        return {
            bladeUri,
            shadowPath,
            shadowUri: pathToUri(shadowPath),
            content: parts.join(''),
            regions,
        };
    }
}

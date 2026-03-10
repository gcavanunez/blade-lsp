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

    /**
     * Detects whether the content contains a Volt-style anonymous class
     * (`new class extends Component { ... };`).  We no longer rewrite
     * anonymous classes to named classes because intelephense returns 0
     * completions for named `class _` definitions in vendor-located shadow
     * files.  Both phpactor and intelephense handle anonymous classes fine.
     */
    function hasAnonymousClass(content: string): boolean {
        return /new\s+((?:#\[[^\]]+\]\s*)*)class\b/.test(content);
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

        // Track whether any region contained a Volt-style anonymous class.
        // If so, subsequent blade-directive regions are wrapped in a
        // function scope so language servers can analyze them properly
        // (bare top-level statements after a class expression can confuse
        // some backends).
        let hasVoltClass = false;
        let scopeCounter = 0;

        for (let index = 0; index < orderedRegions.length; index++) {
            const region = orderedRegions[index];
            const content = region.content;

            if (hasAnonymousClass(content)) {
                hasVoltClass = true;
            }

            // Wrap blade-directive regions that follow a Volt class in a
            // function scope.  The wrapper prefix/suffix are injected into
            // `parts` but the shadowContentOffsetStart is set to point at
            // the actual region content (past the prefix), so offset
            // mapping remains correct.
            const needsScope = hasVoltClass && region.kind === 'blade-directive';
            let wrapperPrefix = '';
            let wrapperSuffix = '';
            if (needsScope) {
                scopeCounter += 1;
                wrapperPrefix = `function __blade_lsp_scope_${scopeCounter}() {\n`;
                wrapperSuffix = '\n}';
            }

            if (wrapperPrefix) {
                parts.push(wrapperPrefix);
                currentOffset += wrapperPrefix.length;
            }

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

            if (wrapperSuffix) {
                parts.push(wrapperSuffix);
                currentOffset += wrapperSuffix.length;
            }

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

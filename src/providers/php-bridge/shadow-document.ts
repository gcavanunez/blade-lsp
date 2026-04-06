import path from 'node:path';
import { LineIndex } from '../../utils/line-index';
import { PhpBridgeRegions } from './regions';

export namespace PhpBridgeShadowDocument {
    /**
     * Controls which LSP features are forwarded through the PHP bridge
     * for a given region. Inspired by Vue/Volar's `CodeInformation`.
     */
    export interface RegionFeatures {
        completion: boolean;
        hover: boolean;
        definition: boolean;
        diagnostics: boolean;
        references: boolean;
        rename: boolean;
    }

    export interface ShadowRegion {
        id: string;
        bladeContentOffsetStart: number;
        bladeContentOffsetEnd: number;
        shadowContentOffsetStart: number;
        shadowContentOffsetEnd: number;
        features: RegionFeatures;
    }

    export interface ShadowDocument {
        bladeUri: string;
        shadowPath: string;
        shadowUri: string;
        content: string;
        lineIndex: LineIndex;
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

    // ─── Feature flag presets ───────────────────────────────────────────

    /** Full PHP block (`<?php ... ?>`) or `@php ... @endphp` block: all features enabled. */
    const ALL_FEATURES: RegionFeatures = {
        completion: true,
        hover: true,
        definition: true,
        diagnostics: true,
        references: true,
        rename: true,
    };

    /** Inline `@php($expr)` expression: interactive features only (diagnostics are noisy for partials). */
    const INLINE_FEATURES: RegionFeatures = {
        completion: true,
        hover: true,
        definition: true,
        diagnostics: false,
        references: false,
        rename: false,
    };

    /**
     * Post-Volt-class scoped wrapper: diagnostics disabled because the synthetic
     * `function __blade_lsp_scope_N()` wrapper confuses backends.
     */
    const SCOPED_FEATURES: RegionFeatures = {
        completion: true,
        hover: true,
        definition: true,
        diagnostics: false,
        references: true,
        rename: true,
    };

    /**
     * Determine whether a blade-directive region is an inline expression
     * like `@php($x = 1)` vs a block like `@php ... @endphp`.
     *
     * Inline expressions are single-line and don't contain newlines.
     */
    function isInlineExpression(content: string): boolean {
        return !content.includes('\n');
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

    /**
     * Attempt an incremental update of a shadow document when only a single
     * region's content has changed (same region count, same region structure).
     *
     * Returns the updated shadow document, or `null` if incremental update
     * is not possible (falls back to full rebuild).
     *
     * This avoids re-building the full shadow document on every keystroke
     * when the user is editing within a single PHP region.
     */
    export function tryIncrementalUpdate(
        previousShadow: ShadowDocument,
        previousExtraction: PhpBridgeRegions.RegionExtraction,
        newExtraction: PhpBridgeRegions.RegionExtraction,
        newSource: string,
    ): ShadowDocument | null {
        const prevRegions = previousExtraction.regions;
        const newRegions = newExtraction.regions;

        // Must have the same number of regions
        if (prevRegions.length !== newRegions.length) return null;
        if (prevRegions.length === 0) return null;

        // Find which region(s) changed content
        let changedIndex = -1;
        for (let i = 0; i < prevRegions.length; i++) {
            if (prevRegions[i].content !== newRegions[i].content) {
                if (changedIndex !== -1) {
                    // Multiple regions changed — cannot incrementally update
                    return null;
                }
                changedIndex = i;
            }
            // Region kind must stay the same
            if (prevRegions[i].kind !== newRegions[i].kind) return null;
        }

        if (changedIndex === -1) {
            // No region content changed — shadow content is identical,
            // but blade offsets may have shifted (e.g. HTML changed around the PHP).
            // Update blade offsets to match the new extraction.
            const updatedRegions = previousShadow.regions.map((sr, i) => ({
                ...sr,
                bladeContentOffsetStart: newRegions[i].contentOffsetStart,
                bladeContentOffsetEnd: newRegions[i].contentOffsetEnd,
            }));
            return {
                ...previousShadow,
                regions: updatedRegions,
            };
        }

        const changedPrev = prevRegions[changedIndex];
        const changedNew = newRegions[changedIndex];
        const prevShadowRegion = previousShadow.regions[changedIndex];
        if (!prevShadowRegion) return null;

        // Compute the content length delta
        const contentDelta = changedNew.content.length - changedPrev.content.length;

        // Splice the shadow content: replace the old region content with the new
        const newContent =
            previousShadow.content.slice(0, prevShadowRegion.shadowContentOffsetStart) +
            changedNew.content +
            previousShadow.content.slice(prevShadowRegion.shadowContentOffsetEnd);

        // Update shadow regions: patch the changed region and shift subsequent offsets
        const newShadowRegions = previousShadow.regions.map((sr, i) => {
            if (i === changedIndex) {
                return {
                    ...sr,
                    bladeContentOffsetStart: changedNew.contentOffsetStart,
                    bladeContentOffsetEnd: changedNew.contentOffsetEnd,
                    shadowContentOffsetEnd: sr.shadowContentOffsetStart + changedNew.content.length,
                };
            }
            if (i > changedIndex) {
                return {
                    ...sr,
                    bladeContentOffsetStart: newRegions[i].contentOffsetStart,
                    bladeContentOffsetEnd: newRegions[i].contentOffsetEnd,
                    shadowContentOffsetStart: sr.shadowContentOffsetStart + contentDelta,
                    shadowContentOffsetEnd: sr.shadowContentOffsetEnd + contentDelta,
                };
            }
            // Regions before the changed one: blade offsets may have shifted
            return {
                ...sr,
                bladeContentOffsetStart: newRegions[i].contentOffsetStart,
                bladeContentOffsetEnd: newRegions[i].contentOffsetEnd,
            };
        });

        return {
            ...previousShadow,
            content: newContent,
            lineIndex: new LineIndex(newContent),
            regions: newShadowRegions,
        };
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

            // Determine feature flags based on region context:
            // - Scoped wrappers (post-Volt-class): no diagnostics (synthetic wrapper confuses backends)
            // - php-tag (<?php ... ?>): all features
            // - blade-directive block (@php ... @endphp): all features
            // - blade-directive inline (@php($expr)): interactive only (no diagnostics for partials)
            let features: RegionFeatures;
            if (needsScope) {
                features = SCOPED_FEATURES;
            } else if (region.kind === 'php-tag') {
                features = ALL_FEATURES;
            } else if (isInlineExpression(content)) {
                features = INLINE_FEATURES;
            } else {
                features = ALL_FEATURES;
            }

            regions.push({
                id: region.id,
                bladeContentOffsetStart: region.contentOffsetStart,
                bladeContentOffsetEnd: region.contentOffsetEnd,
                shadowContentOffsetStart,
                shadowContentOffsetEnd: currentOffset,
                features,
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

        const content = parts.join('');
        return {
            bladeUri,
            shadowPath,
            shadowUri: pathToUri(shadowPath),
            content,
            lineIndex: new LineIndex(content),
            regions,
            activeRegionId: options.activeRegionId ?? null,
        };
    }
}

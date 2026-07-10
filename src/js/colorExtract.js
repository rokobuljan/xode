import * as csstree from 'css-tree';
import { parse as parseColor, formatHex, formatHex8 } from 'culori';

const COLOR_FUNCTIONS = new Set([
    'rgb', 'rgba', 'hsl', 'hsla', 'hwb',
    'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix',
]);

/**
 * Extract every color occurrence in a CSS string, with line numbers,
 * resolving var(--x) references against custom properties declared
 * in the same stylesheet.
 *
 * @param {string} cssText
 * @returns {Array<{
 *   line: number,
 *   raw: string,
 *   kind: 'literal' | 'var',
 *   varName?: string,
 *   resolvedFrom?: 'custom-property' | 'fallback' | 'unresolved',
 *   color: object | null,   // culori color object, or null if unparseable/unresolved
 * }>}
 */
export function extractColors(cssText) {
    let ast;
    try {
        ast = csstree.parse(cssText, { positions: true, onParseError: () => { } });
    } catch {
        return []; // css too broken to parse at all
    }

    // Pull the exact original substring for a node instead of regenerating it —
    // csstree.generate() reformats (collapses/repositions whitespace), which both
    // loses fidelity with what's on screen and can produce strings culori chokes on.
    const sourceOf = (node) =>
        node.loc ? cssText.slice(node.loc.start.offset, node.loc.end.offset) : null;

    // Pass 1: collect custom property definitions (--foo: value)
    const customProps = new Map();
    csstree.walk(ast, {
        visit: 'Declaration',
        enter(node) {
            if (node.property.startsWith('--')) {
                customProps.set(node.property, {
                    raw: sourceOf(node.value)?.trim(),
                    line: node.loc?.start.line,
                });
            }
        },
    });

    const results = [];

    // css-tree parses the value of a custom property (--x: ...) as a single
    // opaque `Raw` node, per spec — custom props can hold arbitrary token
    // streams, so it doesn't try to structure them the way it does `color`,
    // `background`, etc. That means Hash/Function/Identifier nodes inside a
    // --var's own definition are invisible to a normal walk. To find colors
    // there too, re-parse that raw text as a value, telling css-tree the
    // original offset/line/column so positions still line up with the source.
    const valueNodeOf = (declNode) => {
        if (declNode.value.type !== 'Raw') return declNode.value;
        const raw = declNode.value;
        try {
            return csstree.parse(raw.value, {
                context: 'value',
                positions: true,
                offset: raw.loc.start.offset,
                line: raw.loc.start.line,
                column: raw.loc.start.column,
            });
        } catch {
            return null; // malformed enough that even a lenient value-parse gave up
        }
    };

    // Pass 2: walk every declaration's value looking for colors
    csstree.walk(ast, {
        visit: 'Declaration',
        enter(declNode) {
            const line = declNode.loc?.start.line;
            const valueNode = valueNodeOf(declNode);
            if (!valueNode) return;

            csstree.walk(valueNode, (node) => {
                // var(--x) or var(--x, fallback)
                if (node.type === 'Function' && node.name === 'var') {
                    const children = node.children.toArray();
                    const varName = children[0]?.type === 'Identifier' ? children[0].name : undefined;
                    const fallbackNodes = children.slice(2); // skip name + comma operator
                    const fallbackRaw = fallbackNodes.length
                        ? cssText.slice(fallbackNodes[0].loc.start.offset, fallbackNodes.at(-1).loc.end.offset).trim()
                        : null;

                    const def = varName ? customProps.get(varName) : undefined;
                    const resolvedRaw = def?.raw ?? fallbackRaw ?? null;
                    const color = resolvedRaw ? safeParse(resolvedRaw) : null;

                    // Skip entirely if it doesn't resolve to an actual color — this is what
                    // filters out var(--font-mono), var(--spacing-lg), etc. Without this,
                    // "unresolved" and "resolves to a non-color value" look identical (both
                    // color: null), which is confusing. We only surface vars we can prove
                    // are colors.
                    if (color) {
                        results.push({
                            line: node.loc?.start.line ?? line,
                            raw: sourceOf(node),
                            kind: 'var',
                            varName,
                            resolvedFrom: def ? 'custom-property' : 'fallback',
                            css: cssString(color),
                            color,
                        });
                    }
                    return csstree.walk.skip; // don't descend into var()'s own args
                }

                // rgb(), hsl(), oklch(), color-mix(), etc.
                if (node.type === 'Function' && COLOR_FUNCTIONS.has(node.name)) {
                    const raw = sourceOf(node);
                    const color = safeParse(raw);
                    if (color) {
                        results.push({ line: node.loc?.start.line ?? line, raw, kind: 'literal', css: cssString(color), color });
                    }
                    return csstree.walk.skip; // don't separately flag nested args
                }

                // #hex / #hexa
                if (node.type === 'Hash') {
                    const raw = `#${node.value}`;
                    const color = safeParse(raw);
                    if (color) {
                        results.push({ line: node.loc?.start.line ?? line, raw, kind: 'literal', css: cssString(color), color });
                    }
                }

                // bare identifiers — only keep ones that are actually valid CSS colors
                // (named colors like `tomato`, `rebeccapurple`, `transparent`, `currentcolor`)
                if (node.type === 'Identifier') {
                    const color = safeParse(node.name);
                    if (color) {
                        results.push({ line: node.loc?.start.line ?? line, raw: node.name, kind: 'literal', css: cssString(color), color });
                    }
                }
            });
        },
    });

    return results;
}

// Produces a CSS-ready string you can drop straight into a style
// (background-color: <this>), regardless of what notation the source used.
function cssString(color) {
    return color.alpha !== undefined && color.alpha < 1
        ? formatHex8(color)
        : formatHex(color);
}

function safeParse(str) {
    try {
        return parseColor(str) ?? null;
    } catch {
        return null;
    }
}
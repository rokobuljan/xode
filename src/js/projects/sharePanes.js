import { DEFAULT_PANES } from "./project.js";
import { SHAREABLE_PANES } from "./sharePaneOptions.js";
export { SHAREABLE_PANES };

export function encodeSharedPanes(panes) {
    return SHAREABLE_PANES.filter(({ name }) => panes?.[name])
        .map(({ code }) => code)
        .join("");
}

export function decodeSharedPanes(value) {
    if (value === undefined || value === null) return null;

    const codes = [...value];
    const validCodes = new Set(SHAREABLE_PANES.map(({ code }) => code));
    const isMalformed = codes.length === 0 || new Set(codes).size !== codes.length || codes.some((code) => !validCodes.has(code));
    if (isMalformed) return { ...DEFAULT_PANES };

    const panes = { ...DEFAULT_PANES };
    SHAREABLE_PANES.forEach(({ name, code }) => {
        panes[name] = codes.includes(code);
    });
    return panes;
}

export function createProjectShareUrl(href, gistId, panes) {
    const url = new URL(href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("g", gistId);
    url.searchParams.set("p", encodeSharedPanes(panes));
    return url.toString();
}

export function parseGistReference(value) {
    const reference = String(value ?? "").trim();
    const isGistId = (id) => /^[0-9a-f]{32}$/i.test(id ?? "");
    if (isGistId(reference)) return { gistId: reference.toLowerCase(), panes: null };
    try {
        const url = new URL(reference);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
        if (url.hostname === "gist.github.com") {
            const segments = url.pathname.split("/").filter(Boolean);
            const gistId = segments[segments.length === 1 ? 0 : 1];
            return isGistId(gistId) ? { gistId: gistId.toLowerCase(), panes: null } : null;
        }
        const gistId = url.searchParams.get("g");
        return isGistId(gistId) ? { gistId: gistId.toLowerCase(), panes: decodeSharedPanes(url.searchParams.get("p")) } : null;
    } catch {
        return null;
    }
}

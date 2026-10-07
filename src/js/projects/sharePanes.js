import { DEFAULT_PANES } from "./project.js";

export const SHAREABLE_PANES = [
    { name: "html", code: "h", label: "HTML" },
    { name: "css", code: "c", label: "CSS" },
    { name: "js", code: "j", label: "JS" },
    { name: "console", code: "o", label: "Console" },
    { name: "preview", code: "p", label: "Preview" },
];

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

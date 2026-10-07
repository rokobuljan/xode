import { generatePreviewHTML } from "../preview/preview.js";
import { SHAREABLE_PANES as EMBED_PANES } from "./sharePaneOptions.js";
export { EMBED_PANES };

export const EMBED_SANDBOX = "allow-scripts";
const GIST_ID = /^[0-9a-f]{32}$/i;

function escapeAttribute(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function getEmbedPanes(value) {
    if (!value || new Set(value).size !== value.length || [...value].some((code) => !EMBED_PANES.some((pane) => pane.code === code))) return [EMBED_PANES[4]];
    return EMBED_PANES.filter(({ code }) => value.includes(code));
}

export function createProjectEmbedCode(href, gistId, panes, name = "Xode project") {
    if (!GIST_ID.test(gistId)) throw new Error("Invalid Gist ID.");
    const url = new URL("embed.html", href);
    url.searchParams.set("g", gistId);
    url.searchParams.set(
        "p",
        EMBED_PANES.filter(({ name }) => panes?.[name])
            .map(({ code }) => code)
            .join(""),
    );
    return `<iframe src="${escapeAttribute(url.href)}" title="${escapeAttribute(name)}" width="100%" height="450" style="border:0" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'"></iframe>`;
}

// Embeds never read local projects or credentials, even when framed on Xode's origin.
export async function loadEmbedProject(gistId, fetcher = fetch) {
    if (!GIST_ID.test(gistId ?? "")) throw new Error("A valid published project is required.");
    const response = await fetcher(`https://api.github.com/gists/${gistId}`, { credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(response.status === 404 ? "This project is unavailable or has been deleted." : "Could not load this project. Try again later.");
    const gist = await response.json();
    const readFile = async (filename) => {
        const file = gist.files?.[filename];
        if (!file) return "";
        if (!file.truncated) return String(file.content ?? "");
        const url = new URL(file.raw_url);
        if (url.protocol !== "https:" || url.hostname !== "gist.githubusercontent.com" || url.username || url.password) throw new Error("Invalid project file URL.");
        const raw = await fetcher(url.href, { credentials: "omit" });
        if (!raw.ok) throw new Error("Could not load a project file.");
        return raw.text();
    };
    const [html, css, js, manifestText] = await Promise.all(["index.html", "style.css", "script.js", "xode.json"].map(readFile));
    let manifest;
    try {
        manifest = JSON.parse(manifestText);
    } catch {
        // Older projects may not have a manifest.
    }
    const [name = "Untitled", ...description] = (gist.description || "Untitled").split(" — ");
    return { name, description: description.join(" — "), html, css, js, scriptType: manifest?.format === "xode" && manifest.scriptType === "classic" ? "classic" : "module" };
}

export function generateEmbedPreview(project) {
    const bridge = `<script>
(() => {
    const send = (level, args) => {
        const text = args.map(value => {
            if (typeof value === "string") return value;
            try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
        }).join(" ");
        parent.postMessage({ type: "xode:embed-console", level, text }, "*");
    };
    for (const level of ["log", "info", "warn", "error", "debug", "table"]) {
        const original = console[level].bind(console);
        console[level] = (...args) => { original(...args); send(level, args); };
    }
    console.clear = () => parent.postMessage({ type: "xode:embed-console", level: "clear", text: "" }, "*");
    console.assert = (condition, ...args) => { if (!condition) send("error", ["Assertion failed:", ...args]); };
    addEventListener("error", event => send("error", [event.message]));
    addEventListener("unhandledrejection", event => send("error", [event.reason]));
})();
</script>`;
    return generatePreviewHTML(project, "preview").replace("<head>", `<head>${bridge}`);
}

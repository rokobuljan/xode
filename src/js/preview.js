import { countLines } from "./utils.js";

export const PREVIEW_SANDBOX = "allow-modals allow-forms allow-pointer-lock allow-popups allow-scripts";

export function normalizeScriptType(value) {
    return value === "classic" ? "classic" : "module";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeScriptEnd(value) {
    return String(value ?? "").replace(/<\/script/gi, "<\\/script");
}

/**
 * Build a complete project document for the editor preview, thumbnails, and downloads.
 * Preview documents always run in an opaque-origin sandbox; source filtering is not a
 * security boundary and would be bypassable by dynamically created code.
 */
export function generatePreviewHTML(project, consumer = "app") {
    const isApp = consumer === "app";
    const isPreview = consumer === "preview";
    const title = escapeHtml(project.name?.trim() || "Untitled");
    const description = escapeHtml(project.description?.trim() || "");
    const scriptType = normalizeScriptType(project.scriptType);
    const typeAttribute = scriptType === "module" ? ' type="module"' : "";
    const injectScript = /*html*/ `<script id="◆xode-inject" {{◆xode-previewOffsets}} src="inject.js?t=${Date.now()}"></script>`;
    let previewHTML = /*html*/ `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="title" content="${title}">
        <meta name="description" content="${description}">
        <title>${title}</title>
        <style${isApp ? ' id="◆xode-css"' : ""}>${project.css ?? ""}</style>
        ${
            isApp || isPreview
                ? `<script>
(function() {
    // Neutralize every API that can cause cross-frame scroll propagation
    const noop = function() {};
    Element.prototype.scrollIntoView = noop;
    Element.prototype.scrollIntoViewIfNeeded = noop;
    window.scrollTo = noop;
    window.scroll = noop;
    window.scrollBy = noop;
    // .focus() can also trigger native scroll-into-view; strip that behavior
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function(options) {
        return originalFocus.call(this, { ...options, preventScroll: true });
    };
})();
</script>`
                : ""
        }
        ${isApp ? injectScript : ""}
    </head>
    <body${isApp ? ' id="◆xode-html" spellcheck="false"' : ""}>
        ${project.html ?? ""}
        <script${isApp ? ' id="◆xode-js"' : ""}${typeAttribute}>${escapeScriptEnd(project.js)}${isApp ? "//# sourceURL=js" : ""}</script>
    </body>
    </html>`;
    const previewOffsets = {
        htmlStartLine: countLines(previewHTML.split(/<body(?:.*?>)?/)[0]) + 1,
        jsStartLine: countLines(previewHTML) + countLines(project.html ?? ""),
    };
    return previewHTML.replace("{{◆xode-previewOffsets}}", `data-previewoffsets='${JSON.stringify(previewOffsets)}'`);
}

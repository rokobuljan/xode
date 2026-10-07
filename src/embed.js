import "@fontsource-variable/inter";
import "@fontsource-variable/fira-code";
import "./css/base.css";
import "./css/splitview.css";
import "./css/embed.css";
import "./js/ui/splitview.js";
import { isPaneIsolationGesture } from "./js/ui/paneTabs.js";
import hljs from "./js/shared/highlight.js";
import { EMBED_SANDBOX, generateEmbedPreview, getEmbedPanes, loadEmbedProject } from "./js/projects/embedProject.js";

const params = new URLSearchParams(location.search);
const gistId = params.get("g");
const status = document.querySelector("#embed-status");
const preview = document.querySelector("#embed-preview");
const output = document.querySelector("#embed-console");
const openLink = document.querySelector("#embed-open");
const nav = document.querySelector(".embed-bar nav");
const panes = getEmbedPanes(params.get("p"));
const paneElements = Object.fromEntries(panes.map(({ name }) => [name, document.querySelector(`#embed-pane-${name}`)]));
const visiblePanes = new Set(panes.map(({ name }) => name));
preview.setAttribute("sandbox", EMBED_SANDBOX);

// Only the project's opaque-origin frame can supply output. Render all messages as text.
addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== preview.contentWindow || data?.type !== "xode:embed-console" || typeof data.text !== "string") return;
    if (data.level === "clear") {
        output.replaceChildren();
        return;
    }
    const row = document.createElement("div");
    row.textContent = data.text.slice(0, 10000);
    if (["warn", "error"].includes(data.level)) row.dataset.level = data.level;
    output.append(row);
    if (output.childElementCount > 300) output.firstElementChild.remove();
});

try {
    const project = await loadEmbedProject(gistId);
    document.title = `${project.name} · Xode`;
    preview.title = `${project.name} preview`;
    const appUrl = new URL("./", location.href);
    appUrl.searchParams.set("g", gistId);
    appUrl.searchParams.set("p", panes.map(({ code }) => code).join(""));
    openLink.href = appUrl.href;
    openLink.hidden = false;
    document.querySelector(".embed-brand").href = appUrl.href;
    panes.forEach(({ name }) => {
        if (!["html", "css", "js"].includes(name)) return;
        const code = document.querySelector(`#embed-${name}-source code`);
        code.textContent = project[name];
        code.className = `hljs language-${name}`;
        // Highlight.js escapes source text before adding its own token spans.
        code.innerHTML = hljs.highlight(code.textContent, { language: name, ignoreIllegals: true }).value;
    });
    const buttons = panes.map(({ name, label }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.view = name;
        button.title = `Toggle ${label} pane (Ctrl/Cmd+click to isolate)`;
        nav.append(button);
        return button;
    });
    const updatePanes = () => {
        panes.forEach(({ name }) => {
            paneElements[name].dataset.open = String(visiblePanes.has(name));
        });
        buttons.forEach((button) => button.setAttribute("aria-pressed", String(visiblePanes.has(button.dataset.view))));
    };
    buttons.forEach((button) =>
        button.addEventListener("click", (event) => {
            const name = button.dataset.view;
            if (isPaneIsolationGesture(event, name)) {
                visiblePanes.clear();
                visiblePanes.add(name);
            } else if (visiblePanes.has(name)) {
                if (visiblePanes.size === 1) return;
                visiblePanes.delete(name);
            } else {
                visiblePanes.add(name);
            }
            updatePanes();
        }),
    );
    status.hidden = true;
    updatePanes();
    // Execute only when a result or console pane was shared, even if its tab is hidden.
    if (panes.some(({ name }) => ["preview", "console"].includes(name))) preview.srcdoc = generateEmbedPreview(project);
} catch (error) {
    status.textContent = error.message;
    status.dataset.type = "error";
}

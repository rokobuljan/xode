import "./css/index.css";

import expand, { extract } from 'emmet';
import * as prettier from "prettier/standalone";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import prettierPluginHtml from "prettier/plugins/html";
import prettierPluginPostcss from "prettier/plugins/postcss";
import hljs from "highlight.js";
import "./js/splitview.js";
import "./js/modal.js";
import Rx from "./js/Rx.js";
import { el, elNew, download } from "./js/utils.js";
import { openProject, listProjects, saveProject, createProject, deleteProject } from './js/storage.js';

// const recents = listProjects(); // [{id, name, description, updatedAt}, ...] — cheap, no full bodies parsed

// New Project
let currentProject = {};

class Pane {
    constructor(elParent, syntax, value) {
        this.elParent = elParent
        this.syntax = syntax;
        this.value = value;
        this.init();
    }
    init() {
        this.elSplitter = elNew("div", { className: "splitter" });
        this.el = elNew("div", {
            className: `view`,
            innerHTML: `<div class="editor" id="editor-${this.syntax}">
                    <pre class="editor-lines" data-label="${this.syntax}"></pre>
                    <div class="editor-area">
                        <pre class="editor-highlight" inert><code class="language-${this.syntax}"></code></pre>
                        <textarea data-rx="${this.syntax}" placeholder="${this.syntax}" class="editor-textarea" data-syntax="${this.type}"
                            spellcheck="false" autocorrect="off" autocapitalize="off"></textarea>
                    </div>
                    <div class="editor-selection-stat"></div>
                </div>`
        });
        this.el.dataset.view = this.syntax;
        this.el.dataset.open = "{{panes." + this.syntax + "}}";
        this.elTextarea = el(".editor-textarea", this.el);
        this.elCode = el(".editor-highlight code", this.el);
        this.elLines = el(".editor-lines", this.el);
        this.elParent.append(this.elSplitter, this.el);
        // Init value
        this.elTextarea.value = this.value;
        // Events
        this.elTextarea.addEventListener("keydown", async (evt) => {
            if (evt.key === "Tab") {
                evt.preventDefault(); // don't switch tabindex
                if ((this.syntax === "html" || this.syntax === "css") && this.emmetExpand()) {
                    this.highlight();
                    preview();
                } else {
                    tabToSpaces(evt);
                }
            }

            if (evt.altKey && evt.shiftKey && evt.key === "F") {
                const oldCaretPosition = this.elTextarea.selectionStart;
                evt.preventDefault();
                await this.format();
                // Try as best to reset caret position to where it was - but at the end of line:
                let newCaretPosition = Math.min(this.elTextarea.value.length, oldCaretPosition);
                // push cater to the end of current line
                while (this.elTextarea.value[newCaretPosition] !== "\n") {
                    newCaretPosition++;
                }
                this.elTextarea.setSelectionRange(newCaretPosition, newCaretPosition);
            }
            this.highlight();
        });

        this.highlight();
    }
    async format() {
        const formatted = await formatCode(this.elTextarea.value, this.syntax);
        this.elTextarea.value = formatted;
    }
    emmetExpand() {
        const source = this.elTextarea.value;
        const caretPos = this.elTextarea.selectionStart;
        // 2. Extract the abbreviation before the caret
        const type = { html: "markup", css: "stylesheet" }[this.syntax];
        const extraction = extract(source, caretPos, { type });
        if (!extraction) return; // No valid abbreviation found
        const { abbreviation, start, end } = extraction;
        // 3. Expand the abbreviation and replace the text
        try {
            let expanded = expand(abbreviation, { syntax: this.syntax, type });
            expanded = expanded.replace(/\t/g, " ".repeat(4)); // Replace tabs with 4 spaces
            // Replace the extracted abbreviation with the expanded code
            const newValue = source.substring(0, start) + expanded + source.substring(end);
            this.elTextarea.value = newValue;
            // Move the caret to the end of the expanded code
            const newCaretPos = start + expanded.length;
            this.elTextarea.setSelectionRange(newCaretPos, newCaretPos);
            return true;
        } catch (error) {
            console.warn('Failed to expand abbreviation:', error);
        }
    }
    highlight() {
        if (!this.elCode) return;
        this.elCode.textContent = this.elTextarea.value;
        delete this.elCode.dataset.highlighted;
        this.updateLineNumbers();
        hljs.highlightElement(this.elCode);
    }
    updateLineNumbers() {
        if (!this.elTextarea || !this.elLines) return;
        const totLines = this.elTextarea.value.split(/\n/).length;
        this.elLines.innerHTML = "<span></span>".repeat(totLines);
    }
    destroy() {
        this.elSplitter.remove();
        this.el.remove();
    }
}

class PaneConsole {
    constructor(elParent, syntax) {
        this.elParent = elParent;
        this.syntax = syntax;
        this.init();
    }
    init() {
        this.elSplitter = elNew("div", { className: "splitter" });
        this.el = elNew("div", {
            className: `view`,
            innerHTML: `<div class="console"></div>
                <button class="console-clear" type="button" title="Clear Console">Clear</button>`
        });
        this.el.dataset.view = "console";
        this.el.dataset.open = "{{panes.console}}";
        this.elConsole = el(".console", this.el);
        this.elBtnClear = el(".console-clear", this.el);
        this.elParent.append(this.elSplitter, this.el);

        this.elBtnClear.addEventListener("click", () => this.clear());
    }
    print({ type, args, line }) {
        const elBlock = elNew('code', {
            className: `log ${type}`,
            textContent: args.join("\n").trimStart(),
        });
        const elLine = elNew('span', {
            className: 'log-line',
            textContent: `js:${line}`,
        });
        elBlock.append(elLine);
        this.elConsole.append(elBlock);
    }
    clear() {
        this.elConsole.innerHTML = "";
    }
    destroy() {
        this.elSplitter.remove();
        this.el.remove();
    }
}

const rxChangeHandler = ({ detail }) => {
    // SAVE PROJECT if edited:
    if (/^(name|description)$/.test(detail.prop)) {
        if (detail.oldValue !== detail.value) {
            saveProject(currentProject);
        }
    }
    else if (/^(html|css|js)$/.test(detail.prop)) {
        if (detail.oldValue !== detail.value) {
            saveProject(currentProject);
            panes[detail.prop]?.highlight();
            preview(); // Update changes in iframe
        }
    }
    else if (/^(panes\.)/.test(detail.prop)) {
        if (detail.oldValue !== detail.value) {
            saveProject(currentProject);
        }
    }
};

const projectInit = (isNew = true, id) => {
    const project = isNew ?
        // Create new project with the currently open panes
        createProject({ panes: currentProject.panes }) :
        openProject(id); // Open latest project or a specific one (by ID)

    currentProject = new Rx(project).on("rx:change", rxChangeHandler).state;

    // Force-clear editors highlight if new project
    panes.html.highlight();
    panes.css.highlight();
    panes.js.highlight();
    panes.console.clear();
    // Preview the project
    preview();
};

const formatCode = async (code, language) => {
    const parserMap = {
        js: "babel",
        html: "html",
        css: "css",
    };
    const pluginMap = {
        babel: [prettierPluginBabel, prettierPluginEstree],
        html: [prettierPluginHtml],
        css: [prettierPluginPostcss],
    };
    const parser = parserMap[language];
    return await prettier.format(code, {
        parser,
        plugins: pluginMap[parser],
        semi: true,
        singleQuote: true,
        tabWidth: 4,
        htmlWhitespaceSensitivity: "ignore"
    });
};

/**
 * XODE Code editor (with highlight.js)
 * @author: rokobuljan@github.com
 * @url https://roxon.hr
 */

const tabToSpaces = (evt) => {
    if (evt.key !== "Tab") return;
    evt.preventDefault();  // this will prevent us from tabbing out of the editor
    document.execCommand("insertHTML", false, " ".repeat(4));
};

const panes = {};
const elPreview = el("#preview"); // the iframe
const elAutorun = el("#autorun");
const elRun = el("#run");
const elDownload = el("#download");
let previewTimeout;

/**
 * One-time call to generate UI panes
 */
const generatePanes = () => {
    const elPanes = el("#panes");
    ["html", "css", "js"].forEach(syntax => {
        panes[syntax] = new Pane(elPanes, syntax, currentProject[syntax]);
        panes[syntax]?.highlight();
    });
    panes.console = new PaneConsole(elPanes, "console");
};

/**
 * Construct HTML page output for preview or download
 * @param {boolean} isApp DDiffferentiate whilst in-app vs downloaded document
 */
const generatePreviewHTML = (isApp = true, data = currentProject) => {
    const injectScript = /*html*/`<script id="◆xode-inject" src="inject.js?t=${Date.now()}"></script>`;
    return /*html*/`<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${data.name}</title>
        <script${isApp ? ' id="◆xode-js"' : ''} type="module">${data.js}</script>
        <style${isApp ? ' id="◆xode-css"' : ''}>${data.css}</style>
        ${isApp ? injectScript : ""}
    </head>
    <body${isApp ? ' id="◆xode-html" spellcheck="false"' : ''}>
        ${data.html}
    </body>
    </html>`;
};

const preview = (isForce) => {
    if (!isForce && !elAutorun.checked) return;
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
        elPreview.srcdoc = generatePreviewHTML();
    }, isForce ? 0 : 350);
};

// Rich Editor --to--> HTML
addEventListener("message", async (evt) => {
    if (evt.data.type === "content-changed") {
        const body = new DOMParser().parseFromString(evt.data.html, "text/html").body;
        body.querySelector("#◆xode-js")?.remove();
        const html = (body.innerHTML.trim() ?? "").replace(/^<br ?\/?>$/, "");
        panes.html.elTextarea.value = html;
        await panes.html.format();
        panes.html.highlight();
        currentProject.html = html; // Update with new value + save project
    }
    // Console messages
    else if (evt.data.type === "clear") {
        panes.console.clear();
        panes.console.print({ ...evt.data, args: ["Console cleared"] });
    } else {
        panes.console.print(evt.data);
    }
});

const drawProjects = () => {
    el("#projects-select").innerHTML = "";
    listProjects().forEach((project) => {
        const elPreviewThumbnail = elNew("iframe", {
            className: "iframe-thumbnail",
            srcdoc: generatePreviewHTML(false, openProject(project.id)),
            sandbox: "allow-scripts"
        });
        const elProject = elNew("div", {
            id: `project-${project.id}`,
            className: "project",
            innerHTML: `
                <span>${project.name}</span>
                <span>${new Date(project.updatedAt).toLocaleString()}</span>
            `,
            title: `${project.name} - ${project.description || "No description"}\n(Right click to delete)`,
        });
        elProject.dataset.modal = "";
        elProject.addEventListener("contextmenu", (evt) => {
            evt.preventDefault();
            if (confirm(`Delete project: "${project.name}"?`)) {
                deleteProject(project.id);
                drawProjects();
            }
        })
        elProject.prepend(elPreviewThumbnail);
        elProject.addEventListener("click", () => {
            projectInit(false, project.id);
        });
        el("#projects-select").append(elProject);
    });
};

drawProjects();

// EVENTS
elRun.addEventListener("click", () => preview(true));

// Download project locally as .html
elDownload.addEventListener("click", () => {
    const timestamp = new Date().toISOString().replace(/[:.TZ-]/g, "_").replace(/_\d+_$/, "");
    const projectName = currentProject.name.trim() ? currentProject.name.trim().replace(/\s+/g, "-") : "untitled";
    download(generatePreviewHTML(false), `${projectName} - ${timestamp}.xode.html`);
});

// Editor exec commander for richEditor mode (text editing buttons)
addEventListener("click", (evt) => {
    const elBtnCmd = evt.target.closest("[data-cmd]");
    if (!elBtnCmd) return;
    elPreview.contentWindow.postMessage({
        type: "cmd",
        args: [elBtnCmd.dataset.cmd, elBtnCmd.dataset.par]
    }, "*");
});

// Actions from parent window to #preview iframe
addEventListener("click", (evt) => {
    const elBtnAction = evt.target.closest("[data-action]");
    if (!elBtnAction) return;
    // Else
    const action = elBtnAction.dataset.action;
    const val = elBtnAction.matches("[type=checkbox]") ?
        elBtnAction.checked :
        elBtnAction.value ?? elBtnAction.dataset.val;
    elPreview.contentWindow.postMessage({
        type: "action",
        args: [action, val]
    }, "*");
    if (action === "designMode") {
        currentProject.panes.richEditor = elBtnAction.checked;
        saveProject(currentProject);
    }
});

const selectionCounter = (elTextarea) => {
    const start = elTextarea.selectionStart;
    const end = elTextarea.selectionEnd;
    const selectedText = elTextarea.value.substring(start, end);
    const charCount = selectedText.length;
    const lineCount = selectedText.split('\n').length;
    const hasCount = charCount > 0;
    el(".editor-selection-stat", elTextarea.closest(".editor")).innerHTML = hasCount
        ? `< span class= "icon" data - name="text-t" >& #x10125;</span > ${charCount} & nbsp; <span class="icon" data-name="wrap-text">&#xf11d;</span> ${lineCount} `
        : "";
};

// Selection counter
;["select", "keyup", "click", "pointermove"].forEach((evName) => {
    addEventListener(evName, (evt) => {
        if (evt.type === "pointermove" && evt.buttons !== 1) return;
        const elTextarea = evt.target.closest(".editor-textarea");
        if (!elTextarea) return;
        selectionCounter(elTextarea);
    });
});

// Activate RTE
elPreview.addEventListener('load', () => {
    elPreview.contentWindow.postMessage({
        type: "action",
        args: ["designMode", currentProject.panes.richEditor]
    }, "*");
});

// NEW PROJECT
el("#project-new").addEventListener("click", () => {
    projectInit(); // Create new project
    drawProjects(); // redraw aold ones
});

// INIT
generatePanes();
projectInit(false); // Load latest old project

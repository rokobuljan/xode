import "./css/index.css";
import expand, { extract } from 'emmet';
import * as prettier from "prettier/standalone";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import prettierPluginHtml from "prettier/plugins/html";
import prettierPluginPostcss from "prettier/plugins/postcss";
import hljs from "highlight.js";
import "./js/splitview.js";
import { el, els, elNew, download, LS, elsSiblings } from "./js/utils.js";
import { openProject, listProjects, createProject, deleteProject } from './js/storage.js';

const recents = listProjects(); // [{id, name, description, updatedAt}, ...] — cheap, no full bodies parsed
console.log(recents);
let currentProject = openProject(); // loads existing or creates new
console.log(currentProject)

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

const emmetExpand = (elTextarea, syntax = "html") => {
    const source = elTextarea.value;
    const caretPos = elTextarea.selectionStart;
    // 2. Extract the abbreviation before the caret
    const type = { html: "markup", css: "stylesheet" }[syntax];
    const extraction = extract(source, caretPos, { type });
    if (!extraction) return; // No valid abbreviation found
    const { abbreviation, start, end } = extraction;
    // 3. Expand the abbreviation and replace the text
    try {
        let expanded = expand(abbreviation, { syntax, type });
        expanded = expanded.replace(/\t/g, " ".repeat(4)); // Replace tabs with 4 spaces
        // Replace the extracted abbreviation with the expanded code
        const newValue = source.substring(0, start) + expanded + source.substring(end);
        elTextarea.value = newValue;
        // Move the caret to the end of the expanded code
        const newCaretPos = start + expanded.length;
        elTextarea.setSelectionRange(newCaretPos, newCaretPos);
        return true;
    } catch (error) {
        console.warn('Failed to expand abbreviation:', error);
    }
};

const formatPane = async (el, syntax) => {
    const formatted = await formatCode(el.value, syntax);
    el.value = formatted;
};

const updateLineNumbers = (elEditor) => {
    if (!elEditor) return;
    const elTextarea = el(".editor-textarea", elEditor);
    const elLines = el(".editor-lines", elEditor);
    if (!elTextarea || !elLines) return;
    const totLines = elTextarea.value.split(/\n/).length;
    elLines.innerHTML = "<span></span>".repeat(totLines);
};

const tabToSpaces = (evt) => {
    if (evt.key !== "Tab") return;
    evt.preventDefault();  // this will prevent us from tabbing out of the editor
    document.execCommand("insertHTML", false, " ".repeat(4));
};

const hilite = (elEditor) => {
    const elTextarea = el(".editor-textarea", elEditor);
    const elCode = el(".editor-highlight code", elEditor);
    if (!elCode) return;
    elCode.textContent = elTextarea.value;
    delete elCode.dataset.highlighted;
    hljs.highlightElement(elCode);
};

/**
 * Construct HTML page output for preview or download
 * @param {boolean} isApp set to false to get the cleanest HTML document output
 */
const generatePreviewHTML = (isApp, isDesignMode = true) => {
    const injectScript = /*html*/`<script id="◆xode-inject" src="inject.js?t=${Date.now()}"></script>`;
    return /*html*/`<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Xode document</title>
        <script${isApp ? ' id="◆xode-js"' : ''} type="module">${elJS.value}</script>
        <style${isApp ? ' id="◆xode-css"' : ''}>${elCSS.value}</style>
        ${isApp && isDesignMode ? injectScript : ""}
    </head>
    <body ${isApp ? ' id="◆xode-html" spellcheck="false"' : ''}>
        ${elHTML.value}
    </body>
    </html>`;
};


const elHTML = el(`[data-syntax="html"]`);
const elCSS = el(`[data-syntax="css"]`);
const elJS = el(`[data-syntax="js"]`);
const elPreview = el("#preview"); // the iframe
const elAutorun = el("#autorun");
const elRun = el("#run");
const elDownload = el("#download");

// let ls = LS("xode");
let previewTimeout;

// Toggle views/panes
els("[data-view-toggle]").forEach((elToggle) => {
    const view = elToggle.dataset.viewToggle; // "html", "css",... 
    elToggle.checked = currentProject.panes[view];
    const elView = el(`[data-view="${view}"]`);
    elView.classList.toggle("is-hidden", !elToggle.checked);
    elToggle.addEventListener("input", () => {
        elView.classList.toggle("is-hidden", !elToggle.checked);
        currentProject.panes[view] = elToggle.checked;
    });
});

el("#currentProject").value = currentProject.name;
el("#currentProject").addEventListener("input", (ev) => {
    currentProject.name = ev.target.value.trim();
});

const preview = (isForce) => {
    if (!isForce && !elAutorun.checked) return;
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
        elPreview.srcdoc = generatePreviewHTML(true);
    }, isForce ? 0 : 350);
};

const makeEditor = (elEditor) => {
    const elTextarea = el(".editor-textarea", elEditor);
    if (!elTextarea) return;

    const syntax = elTextarea.dataset.syntax;
    elTextarea.addEventListener("keydown", async (evt) => {
        if (evt.key === "Tab") {
            evt.preventDefault(); // don't switch tabindex
            if ((syntax === "html" || syntax === "css") && emmetExpand(elTextarea, syntax)) {
                hilite(elEditor);
                updateLineNumbers(elEditor);
                preview();
            } else {
                tabToSpaces(evt);
            }
        }
        // Format on Alt + SHift + F (esthetic beautify)
        if (evt.altKey && evt.shiftKey && evt.key === "F") {
            evt.preventDefault();
            await formatPane(elTextarea, syntax);
        }
        hilite(elEditor);
        updateLineNumbers(elEditor);
        // if (evt.ctrlKey || evt.shiftKey || evt.metaKey || evt.altKey || evt.key.startsWith("Arrow")) return;
        // preview();
    });

    elTextarea.addEventListener("input", () => {
        hilite(elEditor);
        updateLineNumbers(elEditor);
        preview();
        // Save to LS
        currentProject[syntax] = elTextarea.value;
    });

    // Get from LS
    elTextarea.value = currentProject[syntax];

    hilite(elEditor);
    updateLineNumbers(elEditor);
};

// richEditor mode
const elHTMLEditor = el("#editor-HTML");
const elConsole = el("#console");

const clearElConsole = () => elConsole.innerHTML = "";

const appendLogBlock = ({ type, args, line }) => {
    const elBlock = elNew('code', {
        className: `log ${type}`,
        textContent: args.join("\n").trimStart(),
    });
    const elLine = elNew('span', {
        className: 'log-line',
        textContent: `js:${line}`,
    });
    elBlock.append(elLine);
    elConsole.append(elBlock);
};

addEventListener("message", async (evt) => {
    // richEditor --to--> HTML pane
    if (evt.data.type === "content-changed") {
        const body = new DOMParser().parseFromString(evt.data.html, "text/html").body;
        body.querySelector("#◆xode-js")?.remove();
        const html = (body.innerHTML.trim() ?? "").replace(/^<br ?\/?>$/, "");
        elHTML.value = html;
        await formatPane(elHTML, "html");
        hilite(elHTML.closest(".editor"));
        updateLineNumbers(elHTMLEditor);
        currentProject.html = html;
    }

    // Console messages
    else if (evt.data.type === "clear") {
        clearElConsole();
        appendLogBlock({ ...evt.data, args: ["Console cleared"] });
    } else {
        appendLogBlock(evt.data);
    }
});

// Initialize editor
els(".editor").forEach(makeEditor);
preview();
elRun.addEventListener("click", () => preview(true));
elDownload.addEventListener("click", () => {
    const timestamp = new Date().toISOString().replace(/[:.TZ-]/g, "_").replace(/_\d+_$/, "");
    const projectName = currentProject.name.trim() ? currentProject.name.trim().replace(/\s+/g, "-") : "untitled";
    download(generatePreviewHTML(), `${projectName}-${timestamp}.xode.html`);
});

el("#clearConsole").addEventListener("click", clearElConsole);

// Editor exec commander for richEditor mode
addEventListener("click", (evt) => {
    const elBtnCmd = evt.target.closest("[data-cmd]");
    if (!elBtnCmd) return;
    elPreview.contentWindow.postMessage({
        type: "cmd",
        args: [elBtnCmd.dataset.cmd, elBtnCmd.dataset.par]
    }, "*");
});

// Editor exec commander for richEditor mode
addEventListener("click", (evt) => {
    const elBtnAction = evt.target.closest("[data-action]");
    if (!elBtnAction) return;
    const action = elBtnAction.dataset.action;
    const val = elBtnAction.matches("[type=checkbox]") ?
        (elBtnAction.checked ? "on" : "off") :
        elBtnAction.value ?? elBtnAction.dataset.val;
    elPreview.contentWindow.postMessage({
        type: "action",
        args: [action, val]
    }, "*");
});

const selectionCounter = (elTextarea) => {
    const start = elTextarea.selectionStart;
    const end = elTextarea.selectionEnd;
    const selectedText = elTextarea.value.substring(start, end);
    const charCount = selectedText.length;
    const lineCount = selectedText.split('\n').length;
    const hasCount = charCount > 0;
    el(".editor-selection-stat", elTextarea.closest(".editor")).innerHTML = hasCount
        ? `<span class="icon" data-name="text-t">&#x10125;</span> ${charCount} &nbsp; <span class="icon" data-name="wrap-text">&#xf11d;</span> ${lineCount}`
        : "";
};

;["select", "keyup", "click", "pointermove"].forEach((evName) => {
    addEventListener(evName, (evt) => {
        if (evt.type === "pointermove" && evt.buttons !== 1) return;
        const elTextarea = evt.target.closest(".editor-textarea");
        if (!elTextarea) return;
        selectionCounter(elTextarea);
    });
});

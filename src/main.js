import "./index.css";

import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/+esm";
import esthetic from "https://cdn.jsdelivr.net/npm/esthetic/+esm";
import "./js/splitview.js";
import { el, els, elNew, download, LS } from "./js/utils.js";
// emmet
import expand, { extract } from 'emmet';

console.log(expand, { extract });

/**
 * XODE Code editor (with highlight.js)
 * @author: rokobuljan@github.com
 * @url https://roxon.hr
 */

const elHTML = el(`[data-lang="html"]`);
const elCSS = el(`[data-lang="css"]`);
const elJS = el(`[data-lang="js"]`);
const elPreview = el("#preview");
const elAutorun = el("#autorun");
const elRun = el("#run");
const elDownload = el("#download");

const emmetExpand = (elTextarea, syntax = "html") => {
    const source = elTextarea.value;
    const caretPos = elTextarea.selectionStart;
    // 2. Extract the abbreviation before the caret
    // For HTML/JSX use type: 'markup' (default), for CSS use type: 'stylesheet'
    const extraction = extract(source, caretPos, { type: 'markup' });
    if (!extraction) return; // No valid abbreviation found
    const { abbreviation, start, end } = extraction;
    // 3. Expand the abbreviation and replace the text
    try {
        let expanded = expand(abbreviation, { syntax });

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

function formatPane(el, lang) {
    const estheticOptions = {
        indentSize: 4,
        indentChar: " "
    };
    try {
        if (lang === 'js') el.value = esthetic.js(el.value, estheticOptions);
        else if (lang === 'css') el.value = esthetic.css(el.value, estheticOptions);
        else if (lang === 'html') el.value = esthetic.html(el.value, estheticOptions);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

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
    const spaces = " ".repeat(4);
    evt.preventDefault();  // this will prevent us from tabbing out of the editor
    document.execCommand("insertHTML", false, spaces);
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
let injectScript = `<script id="◆xode-inject">
const OFFSETLINES = 6; // Fix console.log line numbering (HOW MANY LINES OF CODE ARE ABOVE THIS SCRIPT TAG IN HTML)
document.designMode = "on";
const serialize = (arg) => {
    if (arg === null) return "null";
    if (arg === undefined) return 'undefined';
    if (arg instanceof Error) return \`\${arg.name}: \${arg.message}\`;
    if (typeof arg === 'object') {
        try { return JSON.stringify(arg, null, 2); }
        catch { return Object.prototype.toString.call(arg); }
    }
    return String(arg);
};
const getLineNumber = () => {
    const stack = new Error().stack;
    const line = stack.split('\\n')[4]; // caller's line
    const match = line.match(/:(\\d+):\\d+\\)?$/);
    return match ? Number(match[1]) - OFFSETLINES : '?';
};
const forward = (type, args) => {
    parent.postMessage({
        type,
        line: getLineNumber(),
        args: Array.from(args).map(serialize)
    }, '*');
};
["log", "warn", "error", "info", "clear"].forEach((method) => {
    const _orig = console[method];
    console[method] = (...args) => {
        _orig.apply(console, args); // keep DevTools working
        forward(method, args);
    };
});
window.addEventListener("error", (evt) => {
    window.parent.postMessage({ type: "error", line: evt.lineno - OFFSETLINES, args: [\`\${evt.message}\`] }, '*');
});
window.addEventListener('unhandledrejection', (evt) => {
    window.parent.postMessage({ type: "error", line: evt.lineno ?? '?', args: [\`Unhandled Promise: \${serialize(evt.reason)}\`] }, '*');
});
addEventListener("keyup", () => {
    window.parent.postMessage({ type: "html", args: [document.querySelector("body").innerHTML] }, "*");
});
</script>`;

const generatePreviewHTML = (isApp, isDesignMode = true) => {
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

// let ls = LS("xode");
let previewTimeout;
let projectTitle = localStorage["xode-projectTitle"] ?? "untitled";

el("#projectTitle").addEventListener("input", (ev) => {
    projectTitle = ev.target.value.trim();
    localStorage["xode-projectTitle"] = projectTitle;
});
el("#projectTitle").value = projectTitle;

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

    const lang = elTextarea.dataset.lang;
    elTextarea.addEventListener("keydown", (evt) => {
        if (evt.key === "Tab") {
            evt.preventDefault(); // don't switch tabindex
            if (lang === "html" && emmetExpand(elTextarea, lang)) {
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
            formatPane(elTextarea, lang);
        }
        hilite(elEditor);
        updateLineNumbers(elEditor);
        preview();
    });

    elTextarea.addEventListener("input", () => {
        hilite(elEditor);
        updateLineNumbers(elEditor);
        preview();
        // Save to LS
        localStorage[`xode-${projectTitle}-${lang}`] = elTextarea.value;
    });

    // Get from LS
    elTextarea.value = localStorage[`xode-${projectTitle}-${lang}`] ?? "";

    hilite(elEditor);
    updateLineNumbers(elEditor);
};

// Designer mode
const elHTMLEditor = el("#editor-HTML");
const elConsole = el("#console");

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

addEventListener("message", (evt) => {
    if (evt.data.type === "html") return;

    if (evt.data.type === "code") {
        const body = new DOMParser().parseFromString(evt.data.content, "text/html").body;
        body.querySelector("#◆xode-js")?.remove();
        elHTML.value = (body.innerHTML.trim() ?? "").replace(/^<br ?\/?>$/, "");
        hilite(elHTML.closest(".editor"));
        updateLineNumbers(elHTMLEditor);
    }
    // Console messages
    else if (evt.data.type === "clear") {
        elConsole.innerHTML = "";
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
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const projectName = projectTitle.trim() ? projectTitle.trim().replace(/\s+/g, "-") : "untitled";
    download(generatePreviewHTML(), `${projectName}-${timestamp}.xode.html`)
});

el("#clearConsole").addEventListener("click", () => {
    elConsole.innerHTML = "";
});

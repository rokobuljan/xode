import "./index.css";
import "./css/designer.css";

import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/+esm";
import "./js/splitview.js";
import { el, els, elNew, download, LS } from "./js/utils.js";
// emmet
import expand, { extract } from 'emmet';

// Prettier
import * as prettier from "prettier/standalone";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import prettierPluginHtml from "prettier/plugins/html";
import prettierPluginPostcss from "prettier/plugins/postcss";

async function formatCode(code, language) {
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
    });
}

/**
 * XODE Code editor (with highlight.js)
 * @author: rokobuljan@github.com
 * @url https://roxon.hr
 */


const elHTML = el(`[data-syntax="html"]`);
const elCSS = el(`[data-syntax="css"]`);
const elJS = el(`[data-syntax="js"]`);
const elPreview = el("#preview"); // the iframe
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
// Designer mode on
addEventListener("keyup", () => {
    window.parent.postMessage({ type: "code", args: [document.querySelector("body").innerHTML] }, "*");
});
addEventListener("message", (evt) => {
    if (evt.data.type !== "cmd") return;
    let [cmd, par] = evt.data.args;
    console.log(cmd, par)
    if (cmd == "InsertImage") par = prompt("Image URL:", "");
    else if (cmd == "CreateLink") {
        par = prompt("Link URL:", "http://");
        if (par === "" || par == "http://") cmd = "Unlink";
    }
    document.execCommand(cmd, false, par);
    window.parent.postMessage({ type: "code", args: [document.querySelector("body").innerHTML] }, "*");
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

    const syntax = elTextarea.dataset.syntax;
    elTextarea.addEventListener("keydown", async (evt) => {
        if (evt.key === "Tab") {
            evt.preventDefault(); // don't switch tabindex
            if (syntax === "html" && emmetExpand(elTextarea, syntax)) {
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
        preview();
    });

    elTextarea.addEventListener("input", () => {
        hilite(elEditor);
        updateLineNumbers(elEditor);
        preview();
        // Save to LS
        localStorage[`xode-${projectTitle}-${syntax}`] = elTextarea.value;
    });

    // Get from LS
    elTextarea.value = localStorage[`xode-${projectTitle}-${syntax}`] ?? "";

    hilite(elEditor);
    updateLineNumbers(elEditor);
};

// Designer mode
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
    if (evt.data.type === "html") return;

    // Designer --to--> HTML
    if (evt.data.type === "code") {
        const body = new DOMParser().parseFromString(evt.data.args.join(""), "text/html").body;
        body.querySelector("#◆xode-js")?.remove();
        elHTML.value = (body.innerHTML.trim() ?? "").replace(/^<br ?\/?>$/, "");
        await formatPane(elHTML, "html");
        hilite(elHTML.closest(".editor"));
        updateLineNumbers(elHTMLEditor);
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
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const projectName = projectTitle.trim() ? projectTitle.trim().replace(/\s+/g, "-") : "untitled";
    download(generatePreviewHTML(), `${projectName}-${timestamp}.xode.html`)
});

el("#clearConsole").addEventListener("click", clearElConsole);


// Editor exec commander for designer mode
addEventListener("click", (evt) => {
    const elBtnCmd = evt.target.closest("[data-cmd]");
    if (!elBtnCmd) return;
    evt.stopPropagation();
    elPreview.contentWindow.postMessage({
        type: "cmd",
        args: [elBtnCmd.dataset.cmd, elBtnCmd.dataset.par]
    }, '*');
});

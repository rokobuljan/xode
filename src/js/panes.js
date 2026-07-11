import hljs from "highlight.js";
import expand, { extract } from "emmet";
import * as prettier from "prettier/standalone";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import prettierPluginHtml from "prettier/plugins/html";
import prettierPluginPostcss from "prettier/plugins/postcss";

import { el, elNew } from "./utils.js";
import { extractColors } from "./colorExtract.js";

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
        tabWidth: 2,
        htmlWhitespaceSensitivity: "ignore"
    });
};

export class Pane {
    constructor(elParent, options) {
        this.elParent = elParent
        Object.assign(this, {
            syntax: "", // "html", "css", ...
            value: "",
        }, options);
        this.placeholder = options.palceholder ?? this.syntax;
        this.elSplitter = elNew("div", { className: "splitter" });
        this.init();
    }
    init() {
        this.el = elNew("div", { className: "view" });
        this.el.dataset.view = this.syntax;
        this.el.dataset.open = "{{panes." + this.syntax + "}}";
        this.elParent.append(this.elSplitter, this.el);
    }
    destroy() {
        this.elSplitter.remove();
        this.el.remove();
    }
}

export class PaneEditor extends Pane {
    init() {
        super.init();
        this.el.innerHTML = `<div class="editor" id="editor-${this.syntax}">
            <pre class="editor-lines" data-label="${this.syntax}"></pre>
            <div class="editor-area">
                <pre class="editor-highlight" inert><code class="language-${this.syntax}"></code></pre>
                <textarea data-rx="${this.syntax}" placeholder="${this.syntax}" class="editor-textarea" data-syntax="${this.syntax}"
                    spellcheck="false" autocorrect="off" autocapitalize="off"></textarea>
            </div>
            <div class="editor-selection-stat"></div>
        </div>`;

        this.elLines = el(".editor-lines", this.el);
        this.elTextarea = el(".editor-textarea", this.el);
        this.elCode = el(".editor-highlight code", this.el);
        this.elSelectionStat = el(".editor-selection-stat", this.el);

        // Init value
        this.setValue(this.value);

        // Events
        this.elTextarea.addEventListener("keydown", async (evt) => {
            if (evt.key === "Tab") {
                evt.preventDefault();
                if ((this.syntax === "html" || this.syntax === "css") && this.emmetExpand()) {
                    // Trigger input event
                    this.elTextarea.dispatchEvent(new Event("input", { bubbles: true }));
                } else {
                    // convert Tab to spaces
                    document.execCommand("insertHTML", false, " ".repeat(4));
                }
                this.highlight();
            }
            else if (evt.altKey && evt.shiftKey && evt.key === "F") {
                evt.preventDefault();
                const oldCaretPosition = this.elTextarea.selectionStart;
                await this.format();
                // // Try as best to reset caret position to where it was - but at the end of line:
                // let newCaretPosition = Math.min(this.elTextarea.value.length, oldCaretPosition);
                // // push cater to the end of current line
                // while (this.elTextarea.value[newCaretPosition] !== "\n") {
                //     newCaretPosition++;
                // }
                let newCaretPosition = oldCaretPosition;
                this.elTextarea.setSelectionRange(newCaretPosition, newCaretPosition);
                // Trigger input event
                this.elTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });

        // Selection counter
        ["select", "keyup", "click", "pointermove"].forEach((evName) => {
            this.elTextarea.addEventListener(evName, (evt) => {
                if (evt.type === "pointermove" && evt.buttons !== 1) return;
                this.selectionCounter();
            });
        });
    }
    setValue(value) {
        this.value = value;
        this.elTextarea.value = value;
        this.highlight();
    }
    async format() {
        const formatted = await formatCode(this.elTextarea.value, this.syntax);
        this.setValue(formatted);
        return formatted;
    }
    selectionCounter() {
        const start = this.elTextarea.selectionStart;
        const end = this.elTextarea.selectionEnd;
        const selectedText = this.elTextarea.value.substring(start, end);
        const charCount = selectedText.length;
        const lineCount = selectedText.split("\n").length;
        const hasCount = charCount > 0;
        this.elSelectionStat.innerHTML = hasCount
            ? `<span class= "icon" data-name="text-t">&#x10125;</span> ${charCount} &nbsp; <span class="icon" data-name="wrap-text">&#xf11d;</span> ${lineCount}`
            : "";
    }
    emmetExpand() {
        const source = this.elTextarea.value;
        const caretPos = this.elTextarea.selectionStart;
        const type = { html: "markup", css: "stylesheet" }[this.syntax];
        // 2. Extract the abbreviation before the caret
        const extraction = extract(source, caretPos, { type });
        if (!extraction) return; // No valid abbreviation found
        const { abbreviation, start, end } = extraction;
        // 3. Expand the abbreviation and replace the text
        try {
            let expanded = expand(abbreviation, { syntax: this.syntax, type });
            expanded = expanded.replace(/\t/g, " ".repeat(4)); // Replace tabs with 4 spaces
            // Replace the extracted abbreviation with the expanded code
            const newValue = source.substring(0, start) + expanded + source.substring(end);
            this.setValue(newValue);
            // Move the caret to the end of the expanded code
            const newCaretPos = start + expanded.length;
            this.elTextarea.setSelectionRange(newCaretPos, newCaretPos);
            return true;
        } catch (error) {
            console.warn("Failed to expand abbreviation:", error);
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

        // Color swatches in lines
        if (this.syntax === "css") {
            clearTimeout(this.colorTimeout);
            this.colorTimeout = setTimeout(() => {
                const colors = extractColors(this.elTextarea.value);
                colors.forEach((color) => {
                    const elLine = this.elLines.children[color.line - 1];
                    const elColor = elNew("span", {
                        className: "color",
                        title: color.raw
                    });
                    elColor.style.setProperty("--color", color.css);
                    elLine.append(elColor);
                });
            }, 300);
        }
    }
}

export class PaneConsole extends Pane {
    init() {
        this.syntax = "console";
        super.init();
        this.el.innerHTML = `<div class="console"></div>
            <button class="console-clear" type="button" title="Clear Console">Clear</button>`;
        this.elConsole = el(".console", this.el);
        this.elBtnClear = el(".console-clear", this.el);
        this.elBtnClear.addEventListener("click", () => this.clear());
    }
    print({ type, args, line }) {
        const logType = type.split(":")[1] || "log";
        const elBlock = elNew("code", {
            className: `log ${logType}`,
            textContent: args.join("\n").trimStart(),
        });
        const elLine = elNew("span", {
            className: "log-line",
            textContent: line,
        });
        elBlock.append(elLine);
        this.elConsole.append(elBlock);
    }
    clear() {
        this.elConsole.innerHTML = "";
    }
}

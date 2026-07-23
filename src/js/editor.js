import hljs from "highlight.js";
import expand, { extract } from "emmet";
import * as prettier from "prettier/standalone";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import prettierPluginHtml from "prettier/plugins/html";
import prettierPluginPostcss from "prettier/plugins/postcss";

import { el, elNew, LS } from "./utils.js";
import { extractColors } from "./colorExtract.js";

const lsSettings = LS("xode.settings");

function scrollToCaret(evt) {
    evt.preventDefault();
    const area = evt.target.closest("textarea");
    if (!area) return;
    area.blur();
    area.focus();
}

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
        tabWidth: Number(lsSettings.read("tabWidth")),
        htmlWhitespaceSensitivity: "ignore",
        bracketSameLine: true
    });
};

/**
 * A self-contained undo/redo stack, fully decoupled from the browser's
 * native contenteditable/textarea undo manager.
 *
 * Why: the native undo stack only tracks changes made via real user input
 * or execCommand — it has no idea when you do `textarea.value = x`
 * directly (which is exactly what's needed when syncing from an iframe).
 * Owning the stack ourselves means both "user typed in the textarea" and
 * "iframe pushed new HTML" go through the exact same, reliable path.
 */
class HistoryStack {
    constructor(value, caretStart = value.length, caretEnd = value.length) {
        this.stack = [{ value, caretStart, caretEnd }];
        this.index = 0;
        this.maxSize = 500;
    }
    get current() {
        return this.stack[this.index];
    }
    // Drops any redo entries ahead of the current position. Call this the
    // moment new input starts, so redo doesn't resurrect stale branches.
    cutRedoBranch() {
        this.stack.length = this.index + 1;
    }
    push(value, caretStart, caretEnd) {
        if (this.current.value === value) return;
        this.cutRedoBranch();
        this.stack.push({ value, caretStart, caretEnd });
        this.index++;
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
            this.index--;
        }
    }
    undo() {
        if (this.index === 0) return null;
        this.index--;
        return this.current;
    }
    redo() {
        if (this.index >= this.stack.length - 1) return null;
        this.index++;
        return this.current;
    }
}

export class Editor {
    constructor(elParent, options) {
        this.elParent = elParent
        Object.assign(this, {
            syntax: "", // "html", "css", ...
            value: "",
        }, options);
        this.history = new HistoryStack(this.value);
        this.historyTimer = null;
        this.historyDebounceMs = 400;
        this.init();
    }
    init() {
        this.elLines = elNew("div", { className: "editor-lines" });
        this.elLines.dataset.label = this.syntax;
        this.elArea = elNew("div", { className: "editor-area" });
        this.elArea.innerHTML = `<pre class="editor-highlight" inert><code class="language-${this.syntax}"></code></pre>
            <textarea class="editor-textarea" data-rx="${this.syntax}" placeholder="${this.syntax}" data-syntax="${this.syntax}"
                    spellcheck="false" autocorrect="off" autocapitalize="off"></textarea>`;
        this.elSelectionStat = elNew("div", { className: "editor-selection-stat" });

        // Insert into DOM
        this.elParent.append(this.elLines, this.elArea, this.elSelectionStat);

        this.elTextarea = el(".editor-textarea", this.elParent);
        this.elCode = el(".editor-highlight code", this.elParent);

        // Init value (already seeded into the history stack above, so skip re-pushing it)
        this.setValue(this.value, { history: false });
        this.notifyChange("init");

        // Events
        this.elTextarea.addEventListener("keydown", async (evt) => {
            if (evt.key === "Tab") {
                evt.preventDefault();
                // Tab = Emmet expand
                if (["html", "css"].includes(this.syntax) && this.emmetExpand()) {
                    // emmetExpand() already updated value/history/highlight
                }
                // Tab = insert spaces (no Emmet expansion was made)
                else {
                    this.insertAtCaret(" ".repeat(lsSettings.read("tabWidth")));
                }
            }
            // Undo / Redo — handled entirely by our own stack, not the browser's
            else if (this.isUndoShortcut(evt)) {
                evt.preventDefault();
                this.undo();
            }
            else if (this.isRedoShortcut(evt)) {
                evt.preventDefault();
                this.redo();
            }
            // Format combo
            else if (evt.altKey && evt.shiftKey && evt.key === "F") {
                evt.preventDefault();
                const oldCaretPosition = this.elTextarea.selectionStart;
                await this.format();
                this.elTextarea.setSelectionRange(oldCaretPosition, oldCaretPosition);
            }
        });

        // Any normal typing: re-highlight, (debounced) record a history snapshot,
        // and tell the outside world (e.g. the iframe sync code) that the value changed.
        this.elTextarea.addEventListener("input", (evt) => {
            this.value = this.elTextarea.value;
            this.highlight();
            if (evt.isTrusted) {
                this.queueHistory();
                this.notifyChange("user");
            }
        });

        // Flush a pending debounced snapshot when the user leaves the field,
        // so a switch to another pane becomes a clean undo boundary.
        this.elTextarea.addEventListener("blur", () => this.flushHistory());

        // Fix textaarea scroll on click - change line focus
        this.elTextarea.addEventListener('click', (evt) => {
            scrollToCaret(evt);
        });
        this.elTextarea.addEventListener('keyup', (evt) => {
            if (
                ["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(evt.key)
                || evt.ctrlKey && (evt.key === "z" || evt.key === "y")
            ) {
                scrollToCaret(evt);
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

    /**
     * Announce that the value changed, so outside code (the iframe <->
     * editor sync layer) can react. `origin` tells the listener where the
     * change came from:
     *   - "user" / "insert" / "undo" / "redo" / "format" / "emmet": the
     *      change originated in THIS editor pane and should be pushed
     *      out to the iframe.
     *   - "external": the change came FROM the iframe (via setValue(...,
     *      { origin: "external" })) — listeners should ignore this to
     *      avoid feeding the value right back into the iframe in a loop.
     *   - "init": first mount; useful for seeding the iframe initially.
     */
    notifyChange(origin = "user") {
        this.elParent.dispatchEvent(new CustomEvent("editor:change", {
            detail: { value: this.value, origin, syntax: this.syntax },
            bubbles: true,
        }));
    }

    isUndoShortcut(evt) {
        return (evt.ctrlKey || evt.metaKey) && !evt.shiftKey && evt.key.toLowerCase() === "z";
    }
    isRedoShortcut(evt) {
        return (evt.ctrlKey || evt.metaKey) &&
            (evt.key.toLowerCase() === "y" || (evt.shiftKey && evt.key.toLowerCase() === "z"));
    }

    // Inserts text at the caret without execCommand (which is deprecated and
    // inconsistent across browsers for plain <textarea> elements). Groups
    // with adjacent typing via the same debounce as normal input.
    insertAtCaret(text) {
        const ta = this.elTextarea;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newValue = ta.value.slice(0, start) + text + ta.value.slice(end);
        ta.value = newValue;
        const newPos = start + text.length;
        ta.setSelectionRange(newPos, newPos);
        this.value = newValue;
        this.highlight();
        this.elTextarea.dispatchEvent(new Event("input", { bubbles: true }));
        this.queueHistory();
        this.notifyChange("insert");
    }

    /**
     * Set the editor's value.
     * options.history:
     *   - true  (default): record an immediate history snapshot (use for
     *            discrete, deliberate changes like format()/emmet expand)
     *   - false: don't touch history at all (use only for initial seeding)
     *   - 'debounce': group with other rapid changes into one snapshot
     *            (use this for iframe -> editor sync, since designMode
     *            edits can fire many times per second)
     * options.origin: forwarded to notifyChange(); pass "external" when
     *   this call is just mirroring an edit that happened in the iframe,
     *   so listeners don't push it right back into the iframe.
     */
    setValue(newValue, { history = true, origin = "user" } = {}) {
        const shouldDispatch = this.elTextarea.value !== newValue;
        this.elTextarea.value = newValue;
        this.value = newValue;
        this.highlight();
        if (shouldDispatch) {
            this.elTextarea.dispatchEvent(new Event("input", { bubbles: true }));
        }
        this.notifyChange(origin);

        if (history === false) return;
        if (history === "debounce") {
            this.queueHistory();
        } else {
            this.flushHistory(); // cancel any pending debounce, it's superseded
            this.history.push(newValue, newValue.length, newValue.length);
        }
    }

    // Schedules a history snapshot after a short pause in activity, so a
    // burst of keystrokes (or a burst of iframe sync messages) becomes one
    // undo step instead of dozens.
    queueHistory() {
        this.history.cutRedoBranch(); // any typing after an undo kills the old redo branch immediately
        clearTimeout(this.historyTimer);
        this.historyTimer = setTimeout(() => {
            this.history.push(this.elTextarea.value, this.elTextarea.selectionStart, this.elTextarea.selectionEnd);
        }, this.historyDebounceMs);
    }
    flushHistory() {
        if (!this.historyTimer) return;
        clearTimeout(this.historyTimer);
        this.historyTimer = null;
        this.history.push(this.elTextarea.value, this.elTextarea.selectionStart, this.elTextarea.selectionEnd);
    }

    resetHistory(value = this.elTextarea.value) {
        clearTimeout(this.historyTimer);
        this.historyTimer = null;
        this.value = value;
        this.history = new HistoryStack(value, value.length, value.length);
    }

    undo() {
        // If there's an uncommitted (still-debounced) edit, commit it first so
        // the very first Ctrl+Z undoes the last thing the user actually did.
        clearTimeout(this.historyTimer);
        this.historyTimer = null;
        if (this.elTextarea.value !== this.history.current.value) {
            this.history.push(this.elTextarea.value, this.elTextarea.selectionStart, this.elTextarea.selectionEnd);
        }
        const entry = this.history.undo();
        if (!entry) return;
        this.applyHistoryEntry(entry);
    }
    redo() {
        const entry = this.history.redo();
        if (!entry) return;
        this.applyHistoryEntry(entry);
    }
    applyHistoryEntry(entry) {
        this.elTextarea.value = entry.value;
        this.value = entry.value;
        this.highlight();
        this.elTextarea.focus();
        this.elTextarea.setSelectionRange(entry.caretStart, entry.caretEnd);
        this.elTextarea.dispatchEvent(new Event("input", { bubbles: true }));
        this.notifyChange("undo"); // covers both undo() and redo() callers
    }

    async format() {
        const formatted = await formatCode(this.elTextarea.value, this.syntax);
        this.setValue(formatted); // immediate history snapshot, it's a deliberate action
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
            expanded = expanded.replace(/\t/g, " ".repeat(lsSettings.read("tabWidth"))); // Replace tabs with 4 spaces
            // Replace the extracted abbreviation with the expanded code
            const newValue = source.substring(0, start) + expanded + source.substring(end);
            const newCaretPos = start + expanded.length;
            this.elTextarea.value = newValue;
            this.elTextarea.setSelectionRange(newCaretPos, newCaretPos);
            this.value = newValue;
            this.highlight();
            this.elTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            this.flushHistory();
            this.history.push(newValue, newCaretPos, newCaretPos); // discrete action, its own undo step
            this.notifyChange("emmet");
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
        const digitsLen = String(totLines).length;
        this.elParent.style.setProperty("--gutter-digits", digitsLen);

        // Color swatches in lines
        if (this.syntax === "css") {
            clearTimeout(this.swatchTimeout);
            this.swatchTimeout = setTimeout(() => {
                const colors = extractColors(this.elTextarea.value);
                colors.forEach((color) => {
                    const elLine = this.elLines.children[color.line - 1];
                    const elColor = elNew("span", {
                        className: "swatch",
                        title: color.raw
                    });
                    elColor.style.setProperty("--swatch", color.css);
                    elLine.append(elColor);
                });
            }, 300);
        }
    }
}
import hljs from "highlight.js";
import expand, { extract } from "emmet";
import * as prettier from "prettier/standalone";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import prettierPluginHtml from "prettier/plugins/html";
import prettierPluginPostcss from "prettier/plugins/postcss";

import { el, elNew, LS } from "../shared/utils.js";
import { extractColors } from "./colorExtract.js";
import { getAutoIndentEdit, normalizeTabWidth } from "./editorIndent.js";
import MultiCursor from "./editorMultiCursor.js";
import Toast from "../ui/toast.js";
import { renderIcons } from "../ui/icons.js";

const lsSettings = LS("xode.settings");
const getTabWidth = () => normalizeTabWidth(lsSettings.read("tabWidth"));

const customEmmetSnippets = {
    html: {
        "!": '!!!+html[lang="en"]>(head>meta[charset="UTF-8"]+meta[http-equiv="X-UA-Compatible"][content="IE=edge"]+meta[name="viewport"][content="width=device-width, initial-scale=1.0"]+meta[name="description"][content="Project description"]+link[rel="favicon"][type="image/svg+xml"][href="#!"]+title{${1:Untitled}})+body',
    },
};

// Walk every text node under `root`, recording the absolute character
// range [start, end) it covers, so we can later go from "offset 57" to
// "this specific text node, at offset 4 within it" regardless of how
// many <span>s the offset happens to fall inside.
function getTextNodeMap(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const map = [];
    let node,
        offset = 0;
    while ((node = walker.nextNode())) {
        map.push({ node, start: offset, end: offset + node.nodeValue.length });
        offset += node.nodeValue.length;
    }
    return map;
}

function locate(map, pos) {
    for (const entry of map) {
        if (pos >= entry.start && pos <= entry.end) {
            return { node: entry.node, offset: pos - entry.start };
        }
    }
    return null; // pos didn't land in any text node (shouldn't happen if map is complete)
}

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
        tabWidth: getTabWidth(),
        htmlWhitespaceSensitivity: "ignore",
        bracketSameLine: true,
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
export class HistoryStack {
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
    push(value, caretStart, caretEnd, selections = []) {
        if (this.current.value === value) return;
        this.cutRedoBranch();
        this.stack.push({ value, caretStart, caretEnd, selections: selections.map((selection) => ({ ...selection })) });
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
        this.elParent = elParent;
        Object.assign(
            this,
            {
                syntax: "", // "html", "css", ...
                value: "",
            },
            options,
        );
        this.history = new HistoryStack(this.value);
        this.historyTimer = null;
        this.historyDebounceMs = 400;
        this.init();
    }
    init() {
        this.elLines = elNew("div", { className: "gutter" });
        this.elLines.dataset.label = this.syntax;
        this.elArea = elNew("div", { className: "canvas" });
        this.elArea.innerHTML = `<pre class="highlight" inert><code class="language-${this.syntax}"></code></pre>
            <textarea class="input" data-rea-model="project.${this.syntax}" placeholder="${this.syntax}" data-syntax="${this.syntax}"
                    spellcheck="false" autocorrect="off" autocapitalize="off"></textarea>`;
        this.elSelectionStat = elNew("div", { className: "selection-status" });

        // Insert into DOM
        this.elParent.append(this.elLines, this.elArea, this.elSelectionStat);

        this.elTextarea = el(".input", this.elParent);
        this.elCode = el(".highlight code", this.elParent);
        this.multiCursor = new MultiCursor(this, getTabWidth);

        // Init value (already seeded into the history stack above, so skip re-pushing it)
        this.setValue(this.value, { history: false });
        this.notifyChange("init");

        // Events
        this.elTextarea.addEventListener("keydown", async (evt) => {
            if (evt.defaultPrevented || evt.isComposing || this.multiCursor.composition) return;
            if (evt.key === "Tab") {
                evt.preventDefault();
                // Tab = Emmet expand
                if (["html", "css"].includes(this.syntax) && this.emmetExpand()) {
                    // emmetExpand() already updated value/history/highlight
                }
                // Tab = insert spaces (no Emmet expansion was made)
                else {
                    this.insertAtCaret(" ".repeat(getTabWidth()));
                }
            }
            // Undo / Redo — handled entirely by our own stack, not the browser's
            else if (this.isUndoShortcut(evt)) {
                evt.preventDefault();
                this.undo();
            } else if (this.isRedoShortcut(evt)) {
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
            if (this.multiCursor.consumedInput === evt) return;
            this.value = this.elTextarea.value;
            this.highlight();
            if (evt.isTrusted && !this.multiCursor.composition) {
                this.queueHistory();
                this.notifyChange("user");
            }
        });

        // Flush a pending debounced snapshot when the user leaves the field,
        // so a switch to another pane becomes a clean undo boundary.
        this.elTextarea.addEventListener("blur", () => this.flushHistory());

        // Fix textaarea scroll on click - change line focus
        this.elTextarea.addEventListener("click", (evt) => {
            scrollToCaret(evt);
        });
        this.elTextarea.addEventListener("keyup", (evt) => {
            if (["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(evt.key) || (evt.ctrlKey && (evt.key === "z" || evt.key === "y"))) {
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

        // Highlight

        // Text changed -> resync mirror + recompute highlights
        this.elTextarea.addEventListener("input", () => {
            this.updateHighlights();
        });

        // Selection changed via drag, double-click, keyboard, etc.
        this.elTextarea.addEventListener("select", () => this.updateHighlights());
        this.elTextarea.addEventListener("mouseup", () => this.updateHighlights());
        this.elTextarea.addEventListener("keyup", () => this.updateHighlights());
        document.addEventListener("selectionchange", () => {
            if (document.activeElement === this.elTextarea) this.updateHighlights();
        });

        // Auto-indent on Enter
        this.setupAutoIndent();
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
        this.elParent.dispatchEvent(
            new CustomEvent("editor:change", {
                detail: { value: this.value, origin, syntax: this.syntax },
                bubbles: true,
            }),
        );
    }

    isUndoShortcut(evt) {
        return (evt.ctrlKey || evt.metaKey) && !evt.shiftKey && evt.key.toLowerCase() === "z";
    }
    isRedoShortcut(evt) {
        return (evt.ctrlKey || evt.metaKey) && (evt.key.toLowerCase() === "y" || (evt.shiftKey && evt.key.toLowerCase() === "z"));
    }

    // Inserts text at the caret without execCommand (which is deprecated and
    // inconsistent across browsers for plain <textarea> elements). Groups
    // with adjacent typing via the same debounce as normal input.
    insertAtCaret(text, caretOffset = text.length) {
        this.captureHistorySelection();
        if (this.multiCursor.multiple) {
            this.multiCursor.insertText(text, caretOffset);
            return;
        }
        const ta = this.elTextarea;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newValue = ta.value.slice(0, start) + text + ta.value.slice(end);
        ta.value = newValue;
        const newPos = start + caretOffset;
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
        if (shouldDispatch) {
            this.flushHistory();
            this.multiCursor.reset();
        }
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
            this.history.push(newValue, newValue.length, newValue.length, this.multiCursor.getSelections());
        }
    }

    // Schedules a history snapshot after a short pause in activity, so a
    // burst of keystrokes (or a burst of iframe sync messages) becomes one
    // undo step instead of dozens.
    queueHistory() {
        this.history.cutRedoBranch(); // any typing after an undo kills the old redo branch immediately
        clearTimeout(this.historyTimer);
        this.historyTimer = setTimeout(() => {
            this.history.push(this.elTextarea.value, this.elTextarea.selectionStart, this.elTextarea.selectionEnd, this.multiCursor.getSelections());
            this.historyTimer = null;
        }, this.historyDebounceMs);
    }
    flushHistory() {
        if (!this.historyTimer) return;
        clearTimeout(this.historyTimer);
        this.historyTimer = null;
        this.history.push(this.elTextarea.value, this.elTextarea.selectionStart, this.elTextarea.selectionEnd, this.multiCursor.getSelections());
    }
    captureHistorySelection() {
        if (this.history.current.value !== this.elTextarea.value) return;
        Object.assign(this.history.current, {
            caretStart: this.elTextarea.selectionStart,
            caretEnd: this.elTextarea.selectionEnd,
            selections: this.multiCursor.getSelections(),
        });
    }
    resetHistory(value = this.elTextarea.value) {
        clearTimeout(this.historyTimer);
        this.historyTimer = null;
        this.value = value;
        this.multiCursor.reset();
        this.history = new HistoryStack(value, value.length, value.length);
    }
    undo() {
        // If there's an uncommitted (still-debounced) edit, commit it first so
        // the very first Ctrl+Z undoes the last thing the user actually did.
        clearTimeout(this.historyTimer);
        this.historyTimer = null;
        if (this.elTextarea.value !== this.history.current.value) {
            this.history.push(this.elTextarea.value, this.elTextarea.selectionStart, this.elTextarea.selectionEnd, this.multiCursor.getSelections());
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
        this.elTextarea.focus();
        this.multiCursor.setSelections(entry.selections?.length ? entry.selections : [{ anchor: entry.caretStart, head: entry.caretEnd }], false);
        this.elTextarea.dispatchEvent(new Event("input", { bubbles: true }));
        this.notifyChange("undo"); // covers both undo() and redo() callers
    }

    async format() {
        try {
            const formatted = await formatCode(this.elTextarea.value, this.syntax);
            this.setValue(formatted); // immediate history snapshot, it's a deliberate action
            return formatted;
        } catch (err) {
            new Toast({
                head: "Error",
                type: "error",
                body: `Could not format ${this.syntax.toUpperCase()}: ${err.message}`,
                time: 0,
            });
        }
    }

    // Setup auto-indent on Enter key
    setupAutoIndent() {
        this.elTextarea.addEventListener("keydown", (e) => {
            if (e.defaultPrevented || e.isComposing || this.multiCursor.composition) return;
            if (e.key === "Enter") {
                e.preventDefault();

                const ta = this.elTextarea;
                const start = ta.selectionStart;
                const value = ta.value;

                const edit = getAutoIndentEdit(value, start, ta.selectionEnd, getTabWidth());

                // Use insertAtCaret to ensure highlight, history, and events all work
                this.insertAtCaret(edit.text, edit.caretOffset);
            }
            // Smart backspace: remove full indent level if on whitespace-only line
            else if (e.key === "Backspace") {
                this.captureHistorySelection();
                const ta = this.elTextarea;
                const start = ta.selectionStart;
                const value = ta.value;

                // Only apply smart backspace if no selection and cursor not at position 0
                if (ta.selectionStart === ta.selectionEnd && start > 0) {
                    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
                    const currentLine = value.substring(lineStart, start);

                    // Check if line contains only spaces before cursor
                    if (currentLine.match(/^\s*$/)) {
                        const tabWidth = getTabWidth();
                        const spacesToRemove = currentLine.length % tabWidth || tabWidth;

                        // Only apply if we're removing spaces
                        if (spacesToRemove > 0 && spacesToRemove <= currentLine.length) {
                            e.preventDefault();
                            const newValue = value.substring(0, start - spacesToRemove) + value.substring(start);
                            ta.value = newValue;
                            ta.setSelectionRange(start - spacesToRemove, start - spacesToRemove);
                            this.value = newValue;
                            this.highlight();
                            this.elTextarea.dispatchEvent(new Event("input", { bubbles: true }));
                            this.queueHistory();
                            this.notifyChange("user");
                        }
                    }
                }
            }
        });
    }

    selectionCounter() {
        if (this.multiCursor?.multiple) {
            const selections = this.multiCursor.getSelections();
            const characters = selections.reduce((count, { anchor, head }) => count + Math.abs(head - anchor), 0);
            this.elSelectionStat.textContent = `${selections.length} cursors${characters ? ` · ${characters} characters` : ""}`;
            return;
        }
        const start = this.elTextarea.selectionStart;
        const end = this.elTextarea.selectionEnd;
        const selectedText = this.elTextarea.value.substring(start, end);
        const charCount = selectedText.length;
        const lineCount = selectedText.split("\n").length;
        const hasCount = charCount > 0;
        this.elSelectionStat.innerHTML = hasCount ? `<i data-lucide="type"></i> ${charCount} &nbsp; <i data-lucide="wrap-text"></i> ${lineCount}` : "";
        if (hasCount) renderIcons(this.elSelectionStat);
    }
    emmetExpand() {
        this.captureHistorySelection();
        const source = this.elTextarea.value;
        const caretPos = this.elTextarea.selectionStart;
        const type = { html: "markup", css: "stylesheet" }[this.syntax];
        // 2. Extract the abbreviation before the caret
        const extraction = extract(source, caretPos, { type });
        if (!extraction) return; // No valid abbreviation found
        const { abbreviation, start, end } = extraction;
        // 3. Expand the abbreviation and replace the text
        try {
            let expanded = expand(abbreviation, { syntax: this.syntax, type, snippets: customEmmetSnippets[this.syntax] ?? {} });
            expanded = expanded.replace(/\t/g, " ".repeat(getTabWidth()));
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
        this.multiCursor?.render();
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
                        title: color.raw,
                    });
                    elColor.style.setProperty("--swatch", color.css);
                    elLine.append(elColor);
                });
            }, 300);
        }
    }
    updateHighlights() {
        if (this.multiCursor?.multiple) {
            CSS.highlights.delete("word-highlight");
            return;
        }
        const text = this.elTextarea.value; // must match code.textContent exactly
        const start = this.elTextarea.selectionStart;
        const end = this.elTextarea.selectionEnd;
        const selected = text.slice(start, end);

        if (!selected.trim()) {
            CSS.highlights.delete("word-highlight");
            return;
        }

        // Recompute the map every time: `render()` rebuilds the spans on each
        // keystroke, so old text node references are stale.
        const map = getTextNodeMap(this.elCode);
        const ranges = [];
        let idx = 0;
        while ((idx = text.indexOf(selected, idx)) !== -1) {
            // The textarea already paints the active selection.
            if (idx === start) {
                idx += selected.length;
                continue;
            }
            const s = locate(map, idx);
            const e = locate(map, idx + selected.length);
            if (s && e) {
                const range = new Range();
                range.setStart(s.node, s.offset);
                range.setEnd(e.node, e.offset); // fine even if s.node !== e.node
                ranges.push(range);
            }
            idx += selected.length;
        }

        CSS.highlights.set("word-highlight", new Highlight(...ranges));
    }
}

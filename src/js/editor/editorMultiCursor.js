import { elNew } from "../shared/utils.js";
import { applySelectionEdits, characterBoundary, editSelections, indentSelections, lineBounds, normalizeSelections, replayNativeEdit, selectOccurrence, selectionBounds, verticalSelection, wordBoundary } from "./editorSelections.js";

let activeEditor = null;

export default class MultiCursor {
    constructor(editor, getTabWidth) {
        this.editor = editor;
        this.area = editor.elTextarea;
        this.getTabWidth = getTabWidth;
        this.selections = [];
        this.documentValue = this.area.value;
        this.layer = elNew("pre", { className: "multi-cursor-layer", inert: true });
        this.layer.setAttribute("aria-hidden", "true");
        editor.elArea.append(this.layer);
        this.area.setAttribute("aria-label", `${editor.syntax.toUpperCase()} editor`);
        this.area.title = "Multiple cursors: Alt+click or Ctrl+Alt+↑/↓. Ctrl+D selects the next occurrence. Escape clears extra cursors.";

        this.area.addEventListener("focus", () => {
            if (activeEditor && activeEditor !== this) activeEditor.clear();
            activeEditor = this;
            // Reactive project loading can populate the textarea before its first edit.
            if (!this.composition && editor.value !== this.area.value) {
                editor.value = this.area.value;
                editor.resetHistory(this.area.value);
            }
        });
        this.area.addEventListener("keydown", (event) => this.keydown(event));
        this.area.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            this.finishComposition();
            this.editor.flushHistory();
            this.pointerSelections = event.altKey ? this.getSelections() : null;
            if (!event.altKey) this.clear();
        });
        this.area.addEventListener("click", (event) => {
            const previous = this.pointerSelections;
            this.pointerSelections = null;
            if (!previous || !event.altKey) return;
            const clicked = this.nativeSelection();
            const matching = previous.findIndex((selection) => selection.anchor === clicked.anchor && selection.head === clicked.head);
            this.setSelections(matching >= 0 && previous.length > 1 ? previous.filter((_, index) => index !== matching) : [clicked, ...previous]);
        });
        this.area.addEventListener("pointercancel", () => {
            this.pointerSelections = null;
        });
        this.area.addEventListener("beforeinput", (event) => this.beforeInput(event));
        this.area.addEventListener("input", (event) => this.nativeInput(event));
        this.area.addEventListener("compositionstart", () => {
            this.editor.flushHistory();
            this.editor.captureHistorySelection();
            this.composition = { value: this.area.value, selections: this.getSelections() };
            this.render();
        });
        this.area.addEventListener("compositionend", () => {
            // Let the browser finish committing its candidate before replaying it.
            this.compositionTimer = setTimeout(() => this.finishComposition(), 0);
        });
        this.area.addEventListener("blur", () => this.finishComposition());
        ["copy", "cut"].forEach((type) => this.area.addEventListener(type, (event) => this.clipboard(event, type)));
        this.area.addEventListener("paste", (event) => {
            if (!this.multiple || !event.clipboardData) return;
            event.preventDefault();
            this.edit("paste", event.clipboardData.getData("text/plain"));
        });
        this.area.addEventListener("drop", () => this.clear());
        this.area.addEventListener("scroll", () => this.render());
        document.addEventListener("selectionchange", () => {
            if (document.activeElement !== this.area || this.pointerSelections || this.composition) return;
            const native = this.nativeSelection();
            const primary = this.selections[0];
            if (this.multiple && (native.anchor !== primary.anchor || native.head !== primary.head)) this.clear();
            this.editor.selectionCounter();
        });
    }

    get multiple() {
        return this.selections.length > 1;
    }

    nativeSelection() {
        const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = this.area;
        return direction === "backward" ? { anchor: end, head: start } : { anchor: start, head: end };
    }

    getSelections() {
        return this.multiple ? this.selections.map((selection) => ({ ...selection })) : [this.nativeSelection()];
    }

    setSelections(selections, capture = true) {
        if (capture) this.editor.flushHistory();
        this.selections = normalizeSelections(this.area.value, selections);
        const primary = this.selections[0];
        if (primary) {
            const { start, end } = selectionBounds(primary);
            this.area.setSelectionRange(start, end, primary.anchor > primary.head ? "backward" : "forward");
        }
        this.documentValue = this.area.value;
        if (capture) this.editor.captureHistorySelection();
        this.render();
        this.editor.selectionCounter();
    }

    clear(capture = true) {
        this.pointerSelections = null;
        this.pendingNative = null;
        if (this.multiple) this.setSelections([this.nativeSelection()], capture);
        else this.layer.replaceChildren();
    }

    reset() {
        clearTimeout(this.compositionTimer);
        this.composition = null;
        this.clear(false);
        this.documentValue = this.area.value;
    }

    nativeInput(event) {
        if (!event.isTrusted) return;
        if (this.pendingNative && !this.composition) {
            const pending = this.pendingNative;
            this.pendingNative = null;
            this.consumedInput = event;
            this.commit(editSelections(pending.value, pending.selections, pending.type, pending.text, this.getTabWidth()));
        } else if (!this.composition) this.documentValue = this.area.value;
    }

    finishComposition() {
        clearTimeout(this.compositionTimer);
        const composition = this.composition;
        if (!composition) return;
        this.composition = null;
        if (composition.selections.length > 1) this.commit(replayNativeEdit(composition.value, this.area.value, composition.selections));
        else {
            this.documentValue = this.area.value;
            this.editor.queueHistory();
            this.editor.notifyChange("user");
        }
    }

    commit(result) {
        const changed = this.area.value !== result.value || this.editor.value !== result.value;
        this.area.value = result.value;
        this.editor.value = result.value;
        this.setSelections(result.selections, false);
        if (!changed) return;
        this.area.dispatchEvent(new Event("input", { bubbles: true }));
        this.editor.queueHistory();
        this.editor.notifyChange("insert");
    }

    edit(type, text = "") {
        this.editor.captureHistorySelection();
        this.commit(editSelections(this.area.value, this.getSelections(), type, text, this.getTabWidth()));
    }

    insertText(text, caretOffset = text.length) {
        this.editor.captureHistorySelection();
        this.commit(applySelectionEdits(this.area.value, this.getSelections(), ({ start, end }) => ({ start, end, text, caretOffset })));
    }

    beforeInput(event) {
        if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
            if (event.cancelable) {
                event.preventDefault();
                if (event.inputType === "historyUndo") this.editor.undo();
                else this.editor.redo();
            }
            return;
        }
        if (this.composition || event.isComposing) return;
        this.editor.captureHistorySelection();
        if (!this.multiple) return;
        const types = {
            insertText: "text",
            insertLineBreak: "newline",
            insertParagraph: "newline",
            deleteContentBackward: "backspace",
            deleteContentForward: "delete",
            deleteWordBackward: "wordBackspace",
            deleteWordForward: "wordDelete",
            deleteSoftLineBackward: "lineBackspace",
            deleteSoftLineForward: "lineDelete",
        };
        const type = types[event.inputType];
        if (type && (type !== "text" || event.data != null)) {
            if (event.cancelable) {
                event.preventDefault();
                this.edit(type, event.data || "");
            } else this.pendingNative = { value: this.area.value, selections: this.getSelections(), type, text: event.data || "" };
        } else this.clear();
    }

    keydown(event) {
        if (event.isComposing || this.composition) return;
        const modifier = event.ctrlKey || event.metaKey;
        const key = event.key;
        if (modifier && event.altKey && ["ArrowUp", "ArrowDown"].includes(key)) {
            event.preventDefault();
            const selections = this.getSelections();
            const next = verticalSelection(this.area.value, selections[0], key === "ArrowUp" ? -1 : 1, this.getTabWidth());
            if (next) this.setSelections([next, ...selections]);
        } else if (modifier && !event.altKey && (key.toLowerCase() === "d" || (event.shiftKey && key.toLowerCase() === "l"))) {
            event.preventDefault();
            this.setSelections(selectOccurrence(this.area.value, this.getSelections(), event.shiftKey && key.toLowerCase() === "l"));
            this.editor.updateHighlights();
        } else if (key === "Escape" && this.multiple) {
            event.preventDefault();
            this.clear();
        } else if (modifier && !event.altKey && key.toLowerCase() === "a") this.clear();
        else if (!this.multiple) return;
        else if (key === "Tab") {
            event.preventDefault();
            this.editor.captureHistorySelection();
            const selections = this.getSelections();
            this.commit(
                event.shiftKey || selections.some((selection) => selection.anchor !== selection.head)
                    ? indentSelections(this.area.value, selections, this.getTabWidth(), event.shiftKey)
                    : editSelections(this.area.value, selections, "text", " ".repeat(this.getTabWidth()), this.getTabWidth()),
            );
        } else if (key === "Enter") {
            event.preventDefault();
            this.edit("newline");
        } else if (key === "Backspace" || key === "Delete") {
            event.preventDefault();
            this.edit(key === "Backspace" ? (modifier ? "wordBackspace" : "backspace") : modifier ? "wordDelete" : "delete");
        } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key) && !event.altKey) {
            event.preventDefault();
            const value = this.area.value;
            this.setSelections(
                this.getSelections().map((selection) => {
                    let head = selection.head,
                        goalColumn;
                    if (key === "ArrowUp" || key === "ArrowDown") {
                        const next = verticalSelection(value, selection, key === "ArrowUp" ? -1 : 1, this.getTabWidth());
                        head = next?.head ?? head;
                        goalColumn = next?.goalColumn ?? selection.goalColumn;
                    } else if (key === "Home" || key === "End") {
                        const bounds = lineBounds(value, head);
                        head = modifier ? (key === "Home" ? 0 : value.length) : key === "Home" ? bounds.start : bounds.end;
                    } else {
                        const direction = key === "ArrowLeft" ? -1 : 1;
                        const bounds = selectionBounds(selection);
                        head = !event.shiftKey && bounds.start !== bounds.end ? (direction < 0 ? bounds.start : bounds.end) : modifier ? wordBoundary(value, head, direction) : characterBoundary(value, head, direction);
                    }
                    return { anchor: event.shiftKey ? selection.anchor : head, head, ...(goalColumn == null ? {} : { goalColumn }) };
                }),
            );
        }
    }

    clipboard(event, type) {
        if (!this.multiple || !event.clipboardData) return;
        const value = this.area.value;
        const selections = this.getSelections();
        const bounds = selections.map(selectionBounds).map(({ start, end }) => {
            if (start !== end) return { start, end };
            const line = lineBounds(value, start);
            return { start: line.start, end: Math.min(value.length, line.end + 1), wholeLine: true };
        });
        const unique = [
            ...new Map(
                bounds
                    .slice()
                    .sort((a, b) => a.start - b.start)
                    .map((range) => [`${range.start}:${range.end}`, range]),
            ).values(),
        ];
        event.clipboardData.setData("text/plain", unique.map(({ start, end, wholeLine }) => (wholeLine ? value.slice(start, end).replace(/\n$/, "") : value.slice(start, end))).join("\n"));
        event.preventDefault();
        if (type === "cut") {
            this.editor.captureHistorySelection();
            this.commit(applySelectionEdits(value, selections, (_, index) => ({ ...bounds[index], text: "" })));
        }
    }

    render() {
        if (!this.composition && this.multiple && this.documentValue !== this.area.value) this.clear(false);
        if (!this.multiple || this.composition) {
            this.layer.replaceChildren();
            return;
        }
        const fragment = document.createDocumentFragment();
        const cursor = () => elNew("span", { className: "extra-caret", textContent: "\u200b" });
        let offset = 0;
        const value = this.area.value;
        // Include the primary caret so every caret inherits the layer's blink phase.
        for (const selection of this.selections.slice().sort((a, b) => selectionBounds(a).start - selectionBounds(b).start)) {
            const { start, end } = selectionBounds(selection);
            fragment.append(document.createTextNode(value.slice(offset, start)));
            if (selection.head === start) fragment.append(cursor());
            if (end > start) {
                const selectedText = value.slice(start, end);
                // The textarea already paints the primary selection.
                fragment.append(selection === this.selections[0] ? document.createTextNode(selectedText) : elNew("span", { className: "extra-selection", textContent: selectedText }));
            }
            if (selection.head !== start) fragment.append(cursor());
            offset = end;
        }
        fragment.append(document.createTextNode(value.slice(offset)));
        this.layer.replaceChildren(fragment);
        this.layer.style.transform = `translate(${-this.area.scrollLeft}px, ${-this.area.scrollTop}px)`;
    }
}

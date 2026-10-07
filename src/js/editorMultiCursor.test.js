/* global afterEach, beforeEach, describe, expect, it, vi */

import { Editor, HistoryStack } from "./editor.js";
import MultiCursor from "./editorMultiCursor.js";

vi.mock("./toast.js", () => ({ default: class {} }));

class TestNode extends EventTarget {
    constructor() {
        super();
        this.children = [];
        this.style = {};
        this.attributes = {};
        this.scrollLeft = this.scrollTop = 0;
    }
    append(...nodes) {
        this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
        this.children = nodes;
    }
    setAttribute(name, value) {
        this.attributes[name] = value;
    }
}

class TestTextarea extends TestNode {
    constructor(value) {
        super();
        this.value = value;
        this.setSelectionRange(value.length, value.length);
    }
    setSelectionRange(start, end, direction = "forward") {
        this.selectionStart = start;
        this.selectionEnd = end;
        this.selectionDirection = direction;
    }
    focus() {
        if (document.activeElement === this) return;
        document.activeElement?.dispatchEvent(new Event("blur"));
        document.activeElement = this;
        this.dispatchEvent(new Event("focus"));
    }
}

const caret = (head) => ({ anchor: head, head });
const send = (area, type, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties);
    area.dispatchEvent(event);
    return event;
};

function createEditor(value, syntax = "html") {
    const editor = Object.create(Editor.prototype);
    Object.assign(editor, {
        syntax,
        value,
        elTextarea: new TestTextarea(value),
        elArea: new TestNode(),
        elParent: new TestNode(),
        history: new HistoryStack(value),
        historyTimer: null,
        historyDebounceMs: 400,
        highlight: vi.fn(),
        selectionCounter: vi.fn(),
        updateHighlights: vi.fn(),
    });
    editor.multiCursor = new MultiCursor(editor, () => 4);
    editor.elTextarea.addEventListener("blur", () => editor.flushHistory());
    return editor;
}

beforeEach(() => {
    vi.useFakeTimers();
    const document = new TestNode();
    document.createElement = () => new TestNode();
    document.createDocumentFragment = () => new TestNode();
    document.createTextNode = (textContent) => ({ textContent });
    vi.stubGlobal("document", document);
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("multi-cursor editor integration", () => {
    it("adds adjacent cursors and handles beforeinput as a single edit", () => {
        const editor = createEditor("a\nb\nc");
        editor.elTextarea.focus();
        editor.elTextarea.setSelectionRange(1, 1);
        send(editor.elTextarea, "keydown", { key: "ArrowDown", ctrlKey: true, altKey: true });
        expect(editor.multiCursor.getSelections().map(({ head }) => head)).toEqual([3, 1]);
        const typed = send(editor.elTextarea, "beforeinput", { inputType: "insertText", data: "!" });
        expect(typed.defaultPrevented).toBe(true);
        expect(editor.value).toBe("a!\nb!\nc");
        expect(editor.elTextarea.value).toBe(editor.value);
    });

    it("adds and removes cursors with Alt+click", () => {
        const editor = createEditor("abc\ndef");
        editor.elTextarea.focus();
        editor.elTextarea.setSelectionRange(1, 1);
        send(editor.elTextarea, "pointerdown", { button: 0, altKey: true });
        editor.elTextarea.setSelectionRange(5, 5);
        send(editor.elTextarea, "click", { altKey: true });
        expect(editor.multiCursor.getSelections()).toEqual([caret(5), caret(1)]);
        send(editor.elTextarea, "pointerdown", { button: 0, altKey: true });
        editor.elTextarea.setSelectionRange(1, 1);
        send(editor.elTextarea, "click", { altKey: true });
        expect(editor.multiCursor.getSelections()).toEqual([caret(5)]);
    });

    it("keeps simultaneous editing confined to the focused pane", () => {
        const html = createEditor("a\nb", "html");
        const css = createEditor("c\nd", "css");
        const js = createEditor("e\nf", "js");
        html.elTextarea.focus();
        html.multiCursor.setSelections([caret(1), caret(3)]);
        html.multiCursor.edit("text", "!");
        css.elTextarea.focus();
        expect(html.multiCursor.multiple).toBe(false);
        css.multiCursor.setSelections([caret(1), caret(3)]);
        css.multiCursor.edit("text", "?");
        expect(html.value).toBe("a!\nb!");
        expect(css.value).toBe("c?\nd?");
        expect(js.value).toBe("e\nf");
        js.elTextarea.focus();
        expect(css.multiCursor.multiple).toBe(false);
    });

    it("undoes and redoes typing with all cursor positions restored", () => {
        const editor = createEditor("a\nb");
        editor.elTextarea.focus();
        editor.multiCursor.setSelections([caret(1), caret(3)]);
        editor.multiCursor.edit("text", "x");
        editor.multiCursor.edit("text", "y");
        expect(editor.value).toBe("axy\nbxy");
        editor.undo();
        expect(editor.value).toBe("a\nb");
        expect(editor.multiCursor.getSelections()).toEqual([caret(1), caret(3)]);
        editor.redo();
        expect(editor.value).toBe("axy\nbxy");
        expect(editor.multiCursor.getSelections()).toEqual([caret(3), caret(7)]);
    });

    it("copies and cuts selections in document order when the primary is last", () => {
        const editor = createEditor("one two three");
        editor.multiCursor.setSelections([
            { anchor: 8, head: 13 },
            { anchor: 0, head: 3 },
        ]);
        const clipboardData = { setData: vi.fn() };
        send(editor.elTextarea, "copy", { clipboardData });
        expect(clipboardData.setData).toHaveBeenLastCalledWith("text/plain", "one\nthree");
        send(editor.elTextarea, "cut", { clipboardData });
        expect(editor.value).toBe(" two ");
        editor.undo();
        expect(editor.value).toBe("one two three");
    });

    it("copies one whole line per empty cursor and distributes pasted lines", () => {
        const editor = createEditor("a\nb");
        editor.multiCursor.setSelections([caret(3), caret(1)]);
        const clipboardData = { setData: vi.fn(), getData: () => "1\n2" };
        send(editor.elTextarea, "copy", { clipboardData });
        expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "a\nb");
        send(editor.elTextarea, "paste", { clipboardData });
        expect(editor.value).toBe("a1\nb2");
    });

    it("keeps Enter and Tab on the multi-cursor path", () => {
        const editor = createEditor("{}\n[]");
        editor.multiCursor.setSelections([caret(1), caret(4)]);
        const enter = send(editor.elTextarea, "keydown", { key: "Enter" });
        expect(enter.defaultPrevented).toBe(true);
        expect(editor.value).toBe("{\n    \n}\n[\n    \n]");
        const tab = send(editor.elTextarea, "keydown", { key: "Tab" });
        expect(tab.defaultPrevented).toBe(true);
        expect(editor.value).toBe("{\n        \n}\n[\n        \n]");
    });

    it("moves and extends all selections and clears extras on Escape", () => {
        const editor = createEditor("abc\ndef");
        editor.multiCursor.setSelections([caret(1), caret(5)]);
        send(editor.elTextarea, "keydown", { key: "ArrowRight", shiftKey: true });
        expect(editor.multiCursor.getSelections()).toEqual([
            { anchor: 1, head: 2 },
            { anchor: 5, head: 6 },
        ]);
        send(editor.elTextarea, "keydown", { key: "Escape" });
        expect(editor.multiCursor.getSelections()).toEqual([{ anchor: 1, head: 2 }]);
    });

    it("commits IME composition once at all cursors", () => {
        const editor = createEditor("a\nb");
        editor.multiCursor.setSelections([caret(1), caret(3)]);
        send(editor.elTextarea, "compositionstart");
        editor.elTextarea.value = "a漢\nb";
        editor.elTextarea.setSelectionRange(2, 2);
        send(editor.elTextarea, "compositionend");
        vi.runOnlyPendingTimers();
        expect(editor.value).toBe("a漢\nb漢");
        expect(editor.multiCursor.getSelections()).toEqual([caret(2), caret(5)]);
        editor.undo();
        expect(editor.value).toBe("a\nb");
    });

    it("clears stale cursors when an external edit replaces the document", () => {
        const editor = createEditor("a\nb");
        editor.multiCursor.setSelections([caret(1), caret(3)]);
        editor.setValue("replacement", { origin: "external", history: false });
        expect(editor.multiCursor.multiple).toBe(false);
        expect(editor.value).toBe("replacement");
    });

    it("does not replay a pending composition after replacing the project text", () => {
        const editor = createEditor("a\nb");
        editor.multiCursor.setSelections([caret(1), caret(3)]);
        send(editor.elTextarea, "compositionstart");
        editor.elTextarea.value = "a字\nb";
        send(editor.elTextarea, "compositionend");
        editor.setValue("new project", { origin: "external", history: false });
        vi.runOnlyPendingTimers();
        expect(editor.value).toBe("new project");
        expect(editor.elTextarea.value).toBe("new project");
        expect(editor.multiCursor.multiple).toBe(false);
    });

    it("seeds undo from reactively loaded project text on first focus", () => {
        const editor = createEditor("");
        editor.elTextarea.value = "a\nb";
        editor.elTextarea.focus();
        editor.multiCursor.setSelections([caret(1), caret(3)]);
        editor.multiCursor.edit("text", "x");
        editor.undo();
        expect(editor.value).toBe("a\nb");
    });

    it("replays noncancelable deletion using its original input type", () => {
        const editor = createEditor("aaaa\naaaa");
        editor.multiCursor.setSelections([caret(2), caret(7)]);
        editor.multiCursor.beforeInput({ inputType: "deleteContentBackward", cancelable: false });
        editor.elTextarea.value = "aaa\naaaa";
        editor.multiCursor.nativeInput({ isTrusted: true });
        expect(editor.value).toBe("aaa\naaa");
        expect(editor.multiCursor.getSelections()).toEqual([caret(1), caret(5)]);
    });

    it("captures cursor metadata without sharing mutable selection objects", () => {
        const history = new HistoryStack("a");
        const selections = [caret(2), caret(4)];
        history.push("ab\nc", 2, 2, selections);
        selections[0].head = 100;
        expect(history.current.selections[0].head).toBe(2);
    });
});

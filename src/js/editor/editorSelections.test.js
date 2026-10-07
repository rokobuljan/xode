/* global describe, expect, it */

import { characterBoundary, editSelections, indentSelections, normalizeSelections, replayNativeEdit, selectOccurrence, verticalSelection, wordBoundary } from "./editorSelections.js";

const caret = (head) => ({ anchor: head, head });
const selected = (anchor, head) => ({ anchor, head });

describe("multiple selection edits", () => {
    it("inserts at every cursor with correct offsets even when the primary is last in the document", () => {
        const result = editSelections("one\ntwo\nthree", [caret(13), caret(3), caret(7)], "text", "!");
        expect(result.value).toBe("one!\ntwo!\nthree!");
        expect(result.selections).toEqual([caret(16), caret(4), caret(9)]);
    });

    it("replaces differently sized selections with the same text", () => {
        const result = editSelections("red green blue", [selected(9, 14), selected(0, 3)], "text", "x");
        expect(result.value).toBe("x greenx");
        expect(result.selections).toEqual([caret(8), caret(1)]);
    });

    it("merges duplicate and overlapping cursors without double insertion", () => {
        const result = editSelections("abcdef", [selected(4, 1), selected(3, 5), caret(2), caret(6), caret(6)], "text", "x");
        expect(result.value).toBe("axfx");
        expect(result.selections).toEqual([caret(2), caret(4)]);
    });

    it("keeps adjacent nonempty selections separate", () => {
        expect(editSelections("aabb", [selected(0, 2), selected(2, 4)], "text", "x").value).toBe("xx");
    });

    it("distributes matching paste lines in document order", () => {
        const result = editSelections("a\nb\nc", [caret(5), caret(1), caret(3)], "paste", "1\r\n2\r\n3\r\n");
        expect(result.value).toBe("a1\nb2\nc3");
        expect(result.selections).toEqual([caret(8), caret(2), caret(5)]);
    });

    it("pastes the entire clipboard at each cursor when line counts differ", () => {
        expect(editSelections("a\nb", [caret(1), caret(3)], "paste", "x\ny\nz").value).toBe("ax\ny\nz\nbx\ny\nz");
    });

    it("retains a trailing newline on single-cursor paste", () => {
        expect(editSelections("a", [caret(1)], "paste", "x\n").value).toBe("ax\n");
    });

    it("deletes selected content and keeps boundary cursors safe", () => {
        expect(editSelections("one two", [selected(0, 3), selected(4, 7)], "backspace").value).toBe(" ");
        expect(editSelections("abc", [caret(0), caret(3)], "delete").value).toBe("bc");
        expect(editSelections("abc", [caret(0), caret(3)], "backspace").value).toBe("ab");
    });

    it("deletes complete graphemes, including emoji and combining characters", () => {
        const text = "👩‍💻\ne\u0301";
        const result = editSelections(text, [caret(5), caret(text.length)], "backspace");
        expect(result.value).toBe("\n");
        expect(characterBoundary("👩‍💻", 0, 1)).toBe(5);
    });

    it("handles overlapping smart-backspace deletions only once", () => {
        expect(editSelections("    x", [caret(2), caret(4)], "backspace", "", 4).value).toBe("x");
    });

    it("indents each inserted newline according to its own line", () => {
        const result = editSelections("{}\n    []", [caret(1), caret(8)], "newline", "", 2);
        expect(result.value).toBe("{\n  \n}\n    [\n      \n    ]");
        expect(result.value[result.selections[0].head]).toBe("\n");
        expect(result.value[result.selections[1].head]).toBe("\n");
    });

    it("inserts exactly one newline at each empty line, including document start", () => {
        expect(editSelections("\n\n", [caret(0), caret(1)], "newline", "", 4).value).toBe("\n\n\n\n");
    });
});

describe("selection navigation and indentation", () => {
    it("preserves the desired column when crossing a shorter line", () => {
        const value = "abcdef\nx\nabcdef";
        const short = verticalSelection(value, caret(5), 1);
        expect(short).toEqual({ ...caret(8), goalColumn: 5 });
        expect(verticalSelection(value, short, 1)).toEqual({ ...caret(14), goalColumn: 5 });
        expect(verticalSelection(value, caret(0), -1)).toBeNull();
    });

    it("matches visual columns across tab-indented lines", () => {
        const value = "\tx\n    y";
        expect(verticalSelection(value, caret(1), 1, 4).head).toBe(7);
    });

    it("does not indent a shared line more than once", () => {
        const result = indentSelections("ab\ncd", [caret(0), caret(1), caret(3)], 2);
        expect(result.value).toBe("  ab\n  cd");
        expect(result.selections).toEqual([caret(2), caret(3), caret(7)]);
    });

    it("outdents selected lines, preserving backwards selections and endpoint lines", () => {
        const result = indentSelections("    a\n  b\nc", [selected(10, 0)], 4, true);
        expect(result.value).toBe("a\nb\nc");
        expect(result.selections).toEqual([selected(4, 0)]);
        expect(indentSelections("a\nb", [selected(0, 2)], 2).value).toBe("  a\nb");
    });

    it("clamps cursor positions and preserves the primary selection", () => {
        expect(normalizeSelections("abc", [caret(100), caret(-1)])).toEqual([caret(3), caret(0)]);
    });

    it("moves over words and whitespace", () => {
        expect(wordBoundary("  hello world", 0, 1)).toBe(7);
        expect(wordBoundary("hello world  ", 13, -1)).toBe(6);
        expect(wordBoundary("hello", 0, -1)).toBe(0);
    });
});

describe("occurrences and browser-managed edits", () => {
    it("selects a word, then the next occurrence, wrapping around the document", () => {
        const value = "foo bar foo";
        const first = selectOccurrence(value, [caret(9)]);
        expect(first).toEqual([selected(8, 11)]);
        expect(selectOccurrence(value, first)).toEqual([selected(0, 3), selected(8, 11)]);
        expect(selectOccurrence(value, selectOccurrence(value, first))).toHaveLength(2);
    });

    it("selects all occurrences without overlaps or duplicate primary selections", () => {
        expect(selectOccurrence("aa aa aa", [caret(1)], true)).toEqual([selected(0, 2), selected(3, 5), selected(6, 8)]);
        expect(selectOccurrence("aaa", [selected(0, 2)], true)).toEqual([selected(0, 2)]);
    });

    it("replays composed text at every cursor only after the browser commits it", () => {
        const result = replayNativeEdit("a\nb", "a漢字\nb", [caret(1), caret(3)]);
        expect(result.value).toBe("a漢字\nb漢字");
        expect(result.selections).toEqual([caret(3), caret(7)]);
    });

    it("replaces selected content during composition and leaves canceled composition unchanged", () => {
        const selections = [selected(0, 3), selected(4, 7)];
        expect(replayNativeEdit("foo foo", "字 foo", selections).value).toBe("字 字");
        expect(replayNativeEdit("foo foo", "foo foo", selections).selections).toEqual(selections);
    });
});

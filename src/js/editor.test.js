/* global describe, expect, it */

import { getAutoIndentEdit } from "./editorIndent.js";

function applyEdit(value, position, edit) {
    return {
        value: value.slice(0, position) + edit.text + value.slice(position),
        caret: position + edit.caretOffset,
    };
}

describe("editor auto-indentation", () => {
    it("places paired braces on separate indentation levels", () => {
        const value = "const project = {}";
        const position = value.indexOf("{") + 1;
        const result = applyEdit(value, position, getAutoIndentEdit(value, position, position, 4));

        expect(result.value).toBe("const project = {\n    \n}");
        expect(result.value[result.caret]).toBe("\n");
        expect(result.caret).toBe(result.value.indexOf("    ") + 4);
    });

    it("preserves the outer indentation for a nested closing brace", () => {
        const value = "    return {}";
        const position = value.indexOf("{") + 1;
        const result = applyEdit(value, position, getAutoIndentEdit(value, position, position, 4));

        expect(result.value).toBe("    return {\n        \n    }");
    });

    it.each([
        ["[]", "[\n  \n]"],
        ["()", "(\n  \n)"],
    ])("splits the paired delimiters in %s", (value, expected) => {
        const result = applyEdit(value, 1, getAutoIndentEdit(value, 1, 1, 2));
        expect(result.value).toBe(expected);
    });

    it("keeps the existing behavior after an unmatched opening brace", () => {
        const value = "if (ready) {";
        const edit = getAutoIndentEdit(value, value.length, value.length, 4);

        expect(edit).toEqual({ text: "\n    ", caretOffset: 5 });
    });
});

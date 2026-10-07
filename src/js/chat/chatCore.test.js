/* global describe, expect, it */

import { extractFirstJsonObject, mapLanguageToPane, parseAIResponse, shouldShowJumpLatest, splitMarkdownSegments, summarizeChanges, validateAIResponse } from "./chatCore.js";

describe("chat response parsing", () => {
    it("extracts a JSON object without being confused by braces in strings", () => {
        expect(extractFirstJsonObject('preface {"js":"const x = { ok: true };"} suffix')).toBe('{"js":"const x = { ok: true };"}');
    });

    it("normalizes and validates structured responses", () => {
        expect(parseAIResponse('```json\n{"html":"<main>Hi</main>","css":null,"js":null,"explanation":"Done"}\n```')).toEqual({
            html: "<main>Hi</main>",
            css: null,
            js: null,
            explanation: "Done",
        });
        expect(() => validateAIResponse({ html: 42 })).toThrow(/HTML change must be text/);
    });

    it("separates fenced snippets and maps common languages", () => {
        expect(splitMarkdownSegments("Use this:\n```css\nbody { color: red; }\n```")).toHaveLength(2);
        expect(mapLanguageToPane("typescript")).toBe("js");
        expect(mapLanguageToPane("python")).toBeNull();
    });

    it("records changed panes as applied in conversation history", () => {
        expect(summarizeChanges({ html: "<main>Hi</main>", css: null, js: "alert('Hi')", explanation: "Updated it." })).toBe("Updated it. (applied: html, js)");
    });

    it("only offers jumping when conversation history overflows away from the bottom", () => {
        expect(shouldShowJumpLatest({ hasHistory: false, scrollHeight: 500, scrollTop: 0, clientHeight: 0, threshold: 80 })).toBe(false);
        expect(shouldShowJumpLatest({ hasHistory: false, scrollHeight: 500, scrollTop: 0, clientHeight: 200, threshold: 80 })).toBe(false);
        expect(shouldShowJumpLatest({ hasHistory: true, scrollHeight: 200, scrollTop: 0, clientHeight: 200, threshold: 80 })).toBe(false);
        expect(shouldShowJumpLatest({ hasHistory: true, scrollHeight: 500, scrollTop: 230, clientHeight: 200, threshold: 80 })).toBe(false);
        expect(shouldShowJumpLatest({ hasHistory: true, scrollHeight: 500, scrollTop: 100, clientHeight: 200, threshold: 80 })).toBe(true);
    });
});

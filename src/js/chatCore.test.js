/* global describe, expect, it */

import { extractFirstJsonObject, mapLanguageToPane, parseAIResponse, splitMarkdownSegments, summarizeChanges, validateAIResponse } from "./chatCore.js";

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
});

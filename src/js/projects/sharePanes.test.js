/* global describe, expect, it */

import { DEFAULT_PANES } from "./project.js";
import { createProjectShareUrl, decodeSharedPanes, encodeSharedPanes, parseGistReference } from "./sharePanes.js";

describe("shared pane selection", () => {
    it("encodes panes in a stable order", () => {
        expect(encodeSharedPanes({ preview: true, html: true, console: true })).toBe("hop");
    });

    it("decodes only the five shareable panes", () => {
        expect(decodeSharedPanes("hc")).toEqual({
            ...DEFAULT_PANES,
            html: true,
            css: true,
            js: false,
            console: false,
            preview: false,
        });
        expect(decodeSharedPanes("p")).toEqual({ ...DEFAULT_PANES, html: false, css: false, js: false, console: false, preview: true });
    });

    it("uses project defaults for malformed values", () => {
        expect(decodeSharedPanes("")).toEqual(DEFAULT_PANES);
        expect(decodeSharedPanes("hh")).toEqual(DEFAULT_PANES);
        expect(decodeSharedPanes("hx")).toEqual(DEFAULT_PANES);
        expect(decodeSharedPanes(null)).toBeNull();
    });

    it("creates a clean share URL with gist and pane parameters", () => {
        expect(createProjectShareUrl("https://xode.test/?old=1#fragment", "gist-123", { html: true, css: true })).toBe("https://xode.test/?g=gist-123&p=hc");
    });
});

describe("shared Gist references", () => {
    const gistId = "1234567890abcdef1234567890abcdef";

    it("accepts a trimmed Gist ID and normalizes uppercase characters", () => {
        expect(parseGistReference(` ${gistId.toUpperCase()} `)).toEqual({ gistId, panes: null });
    });

    it.each([`https://gist.github.com/roxon/${gistId}`, `https://gist.github.com/${gistId}/`, `https://gist.github.com/roxon/${gistId}#file-index-html`])("accepts GitHub Gist URL %s", (url) => {
        expect(parseGistReference(url)).toEqual({ gistId, panes: null });
    });

    it("restores pane choices from a Xode share URL", () => {
        const url = createProjectShareUrl("https://xode.test/", gistId, { html: true, preview: true });
        expect(parseGistReference(url)).toEqual({ gistId, panes: decodeSharedPanes("hp") });
        expect(parseGistReference(`https://xode.test/?g=${gistId}`)).toEqual({ gistId, panes: null });
    });

    it.each(["", "not-a-gist", "https://gist.github.com/roxon/invalid", `https://example.com/${gistId}`, `javascript:?g=${gistId}`, `https://user:password@gist.github.com/roxon/${gistId}`])("rejects invalid reference %s", (value) => {
        expect(parseGistReference(value)).toBeNull();
    });
});

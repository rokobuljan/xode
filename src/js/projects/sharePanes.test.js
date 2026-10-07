/* global describe, expect, it */

import { DEFAULT_PANES } from "./project.js";
import { createProjectShareUrl, decodeSharedPanes, encodeSharedPanes } from "./sharePanes.js";

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

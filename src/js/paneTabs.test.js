/* global describe, expect, it */

import { isolatePane, isPaneIsolationGesture, isViewPane, paneNameFromModel } from "./paneTabs.js";

describe("pane tab isolation", () => {
    it("recognizes pane bindings and excludes the rich editor mode", () => {
        expect(paneNameFromModel("project.panes.preview")).toBe("preview");
        expect(paneNameFromModel("project.name")).toBeNull();
        expect(isViewPane("preview")).toBe(true);
        expect(isViewPane("richEditor")).toBe(false);
    });

    it("accepts Ctrl and Command/Meta clicks for view panes", () => {
        expect(isPaneIsolationGesture({ ctrlKey: true, metaKey: false }, "html")).toBe(true);
        expect(isPaneIsolationGesture({ ctrlKey: false, metaKey: true }, "preview")).toBe(true);
        expect(isPaneIsolationGesture({ ctrlKey: false, metaKey: false }, "preview")).toBe(false);
        expect(isPaneIsolationGesture({ ctrlKey: true, metaKey: false }, "richEditor")).toBe(false);
    });

    it("keeps only the selected view open without changing rich editor mode", () => {
        const panes = { html: true, css: true, js: true, console: true, preview: true, richEditor: true, chat: true };

        expect(isolatePane(panes, "preview")).toBe(true);
        expect(panes).toEqual({ html: false, css: false, js: false, console: false, preview: true, richEditor: true, chat: false });
    });
});

/* global beforeEach, describe, expect, it */

import paneConsole from "./console.js";

describe("pane console state", () => {
    beforeEach(() => {
        paneConsole.entries = [];
    });

    it("reports errors separately from other console output", () => {
        paneConsole.entries = [{ type: "warn" }, { type: "log" }];
        expect(paneConsole.hasErrors()).toBe(false);

        paneConsole.entries.push({ type: "error" });
        expect(paneConsole.hasErrors()).toBe(true);
    });

    it("has no errors after its entries are cleared", () => {
        paneConsole.entries = [{ type: "error" }];
        paneConsole.entries = [];
        expect(paneConsole.hasErrors()).toBe(false);
    });
});

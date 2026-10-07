/* global describe, expect, it */

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const injectScript = readFileSync(new URL("../../../public/inject.js", import.meta.url), "utf8");

function bridge() {
    const events = {};
    const messages = [];
    const commands = [];
    const anchors = [];
    const node = { isConnected: true, parentElement: { closest: () => null } };
    const range = { startContainer: node, endContainer: node, collapsed: false, cloneRange: () => range, intersectsNode: (anchor) => anchor.selected };
    const restored = [];
    const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges: () => {}, addRange: (value) => restored.push(value) };
    const parent = { postMessage: (data) => messages.push(data) };
    const document = {
        baseURI: "https://editor.example/",
        designMode: "on",
        body: { focus: () => {} },
        documentElement: { outerHTML: "<html><body>Selected text</body></html>" },
        querySelector: () => ({ dataset: { previewoffsets: "{}" } }),
        querySelectorAll: () => anchors,
        addEventListener: () => {},
        execCommand: (...args) => commands.push(args),
    };
    const console = Object.create(null);
    const window = {
        parent,
        console,
        getSelection: () => selection,
        addEventListener: (type, handler) => {
            events[type] = handler;
        },
    };
    runInNewContext(injectScript, { window, document, console, Node: { ELEMENT_NODE: 1 }, URL, crypto: { randomUUID: () => "dialog-request" }, clearTimeout, setTimeout });
    const send = (data, overrides = {}) => events.message({ data, source: parent, origin: "https://editor.example", ...overrides });
    return { send, messages, commands, range, restored, anchors };
}

function anchor(selected) {
    const relations = new Set();
    return {
        selected,
        href: "https://example.com/",
        get rel() {
            return [...relations].join(" ");
        },
        relList: { add: (value) => relations.add(value), remove: (value) => relations.delete(value) },
        removeAttribute(name) {
            delete this[name];
        },
    };
}

describe("rich editor dialog bridge", () => {
    it("inserts the requested table dimensions with a semantic header and syncs HTML", () => {
        const state = bridge();
        state.send({ type: "cmd", args: ["InsertTable"] });
        expect(state.messages.at(-1)).toMatchObject({ type: "rich-dialog-open", kind: "table" });
        expect(state.commands).toEqual([]);
        state.send({ type: "rich-dialog-result", requestId: "dialog-request", value: { rows: 3, columns: 4, header: true } });
        const table = state.commands.find(([command]) => command === "insertHTML")[2];
        expect(table.match(/<tr>/g)).toHaveLength(3);
        expect(table.match(/<th scope="col"/g)).toHaveLength(4);
        expect(table.match(/<td /g)).toHaveLength(8);
        expect(table).toContain("<thead>");
        expect(table).toContain("Column 4");
        expect(table.endsWith("<p><br></p>")).toBe(true);
        expect(state.restored).toEqual([state.range]);
        expect(state.messages.at(-1).type).toBe("content-changed");
    });

    it("supports tables without a header row", () => {
        const state = bridge();
        state.send({ type: "cmd", args: ["InsertTable"] });
        state.send({ type: "rich-dialog-result", requestId: "dialog-request", value: { rows: 2, columns: 3, header: false } });
        const table = state.commands.find(([command]) => command === "insertHTML")[2];
        expect(table).not.toContain("<thead>");
        expect(table.match(/<tr>/g)).toHaveLength(2);
        expect(table.match(/<td /g)).toHaveLength(6);
    });

    it.each([0, -1, 1.5, 21, "<img src=x>"])("rejects invalid table dimensions at the iframe boundary: %s", (rows) => {
        const state = bridge();
        state.send({ type: "cmd", args: ["InsertTable"] });
        state.send({ type: "rich-dialog-result", requestId: "dialog-request", value: { rows, columns: 3 } });
        expect(state.commands.some(([command]) => command === "insertHTML")).toBe(false);
    });

    it("cancels table insertion without editing", () => {
        const state = bridge();
        state.send({ type: "cmd", args: ["InsertTable"] });
        state.send({ type: "rich-dialog-result", requestId: "dialog-request", value: null });
        expect(state.commands).toEqual([]);
        expect(state.restored).toEqual([state.range]);
    });

    it("requests a parent dialog and restores selection when canceled without editing", () => {
        const state = bridge();
        state.send({ type: "cmd", args: ["InsertImage"] });
        expect(state.messages.at(-1)).toMatchObject({ type: "rich-dialog-open", kind: "image", requestId: "dialog-request" });
        expect(state.commands).toEqual([]);
        state.send({ type: "rich-dialog-result", requestId: "dialog-request", value: null });
        expect(state.restored).toEqual([state.range]);
        expect(state.commands).toEqual([]);
    });

    it("applies link options only to links in the selection and syncs HTML", () => {
        const state = bridge();
        const selected = anchor(true);
        const unrelated = anchor(false);
        state.anchors.push(selected, unrelated);
        state.send({ type: "cmd", args: ["CreateLink"] });
        state.send({ type: "rich-dialog-result", requestId: "dialog-request", value: { href: "https://example.com/", blank: true, noopener: true } });
        expect(selected.target).toBe("_blank");
        expect(selected.rel).toBe("noopener");
        expect(unrelated.target).toBeUndefined();
        expect(unrelated.rel).toBe("");
        expect(state.commands).toContainEqual(["createLink", false, "https://example.com/"]);
        expect(state.messages.at(-1).type).toBe("content-changed");
    });

    it("ignores foreign senders and stale dialog results", () => {
        const state = bridge();
        state.send({ type: "cmd", args: ["CreateLink"] }, { source: {} });
        state.send({ type: "cmd", args: ["CreateLink"] }, { origin: "https://other.example" });
        expect(state.messages).toEqual([]);
        state.send({ type: "cmd", args: ["CreateLink"] });
        state.send({ type: "rich-dialog-result", requestId: "stale", value: { href: "https://example.com/" } });
        expect(state.commands).toEqual([]);
        expect(state.restored).toEqual([]);
    });

    it("does not insert into a selection removed while the dialog was open", () => {
        const state = bridge();
        state.send({ type: "cmd", args: ["CreateLink"] });
        state.range.startContainer.isConnected = false;
        state.send({ type: "rich-dialog-result", requestId: "dialog-request", value: { href: "https://example.com/" } });
        expect(state.commands).toEqual([]);
    });
});

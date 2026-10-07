/* global afterEach, beforeEach, describe, expect, it, vi */

vi.mock("./js/projects/embedProject.js", async (importOriginal) => ({ ...(await importOriginal()), loadEmbedProject: vi.fn() }));
import { createProjectEmbedCode, EMBED_PANES, loadEmbedProject } from "./js/projects/embedProject.js";

class Element {
    constructor() {
        this.hidden = true;
        this.dataset = {};
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.contentWindow = {};
        this.textContent = "";
        this.srcdoc = "";
    }
    setAttribute(name, value) {
        this.attributes[name] = value;
    }
    addEventListener(name, callback) {
        this.listeners[name] = callback;
    }
    append(child) {
        child.parent = this;
        this.children.push(child);
    }
    replaceChildren() {
        this.children = [];
    }
    querySelector() {
        return this.code;
    }
    remove() {
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
    }
    get childElementCount() {
        return this.children.length;
    }
    get firstElementChild() {
        return this.children[0];
    }
}

const gistId = "1234567890abcdef1234567890abcdef";
let nodes;
let listeners;
const project = { name: "Demo", html: "<img src=x onerror=alert(1)>", css: "body { color: red; }", js: "console.log('hello')", scriptType: "classic" };

async function boot(panes) {
    vi.stubGlobal("location", { search: `?g=${gistId}&p=${panes}`, href: `https://xode.test/tools/embed.html?g=${gistId}&p=${panes}` });
    await import("./embed.js");
}

beforeEach(() => {
    vi.resetModules();
    const selectors = [
        "#embed-status",
        "#embed-preview",
        "#embed-console",
        "#embed-open",
        ".embed-bar nav",
        ".embed-brand",
        ...EMBED_PANES.map(({ name }) => `#embed-pane-${name}`),
        ...["html", "css", "js"].map((name) => `#embed-${name}-source code`),
    ];
    nodes = Object.fromEntries(selectors.map((selector) => [selector, new Element()]));
    EMBED_PANES.forEach(({ name }) => {
        nodes[`#embed-pane-${name}`].dataset.open = "false";
    });
    listeners = {};
    vi.stubGlobal("document", { querySelector: (selector) => nodes[selector], createElement: () => new Element() });
    vi.stubGlobal("addEventListener", (name, callback) => {
        listeners[name] = callback;
    });
    loadEmbedProject.mockResolvedValue(project);
});

afterEach(() => vi.unstubAllGlobals());

describe("embed viewer", () => {
    it("opens all shared panes together and presents code as text", async () => {
        await boot("hp");
        const buttons = nodes[".embed-bar nav"].children;
        expect(buttons.map((button) => button.textContent)).toEqual(["HTML", "Preview"]);
        expect(nodes["#embed-pane-html"].dataset.open).toBe("true");
        expect(nodes["#embed-pane-preview"].dataset.open).toBe("true");
        expect(nodes["#embed-preview"].attributes.sandbox).toBe("allow-scripts");
        expect(nodes["#embed-preview"].srcdoc).toContain("console.log('hello')");
        expect(nodes["#embed-html-source code"].textContent).toBe(project.html);
        expect(nodes["#embed-html-source code"].className).toBe("hljs language-html");
        expect(nodes["#embed-html-source code"].innerHTML).toContain('class="hljs-tag"');
        expect(nodes["#embed-html-source code"].innerHTML).toContain("&lt;");
        expect(nodes["#embed-html-source code"].innerHTML).not.toContain("<img");
        expect(buttons.every((button) => button.attributes["aria-pressed"] === "true")).toBe(true);
        buttons[0].listeners.click({});
        expect(nodes["#embed-pane-html"].dataset.open).toBe("false");
        expect(nodes["#embed-pane-preview"].dataset.open).toBe("true");
        expect(buttons[0].attributes["aria-pressed"]).toBe("false");
        expect(buttons[1].attributes["aria-pressed"]).toBe("true");
        buttons[0].listeners.click({});
        expect(nodes["#embed-pane-html"].dataset.open).toBe("true");
        expect(nodes["#embed-open"].href).toBe(`https://xode.test/tools/?g=${gistId}&p=hp`);
        expect(nodes[".embed-brand"].href).toBe(nodes["#embed-open"].href);
    });

    it("keeps code-only embeds from executing project scripts", async () => {
        await boot("cj");
        expect(nodes["#embed-preview"].srcdoc).toBe("");
        expect(nodes["#embed-css-source code"].textContent).toBe(project.css);
        expect(nodes["#embed-js-source code"].textContent).toBe(project.js);
        expect(nodes["#embed-css-source code"].className).toBe("hljs language-css");
        expect(nodes["#embed-css-source code"].innerHTML).toContain('class="hljs-attribute"');
        expect(nodes["#embed-js-source code"].className).toBe("hljs language-js");
        expect(nodes["#embed-js-source code"].innerHTML).toContain('class="hljs-string"');
        expect(nodes["#embed-pane-css"].dataset.open).toBe("true");
        expect(nodes["#embed-pane-js"].dataset.open).toBe("true");
        expect(nodes["#embed-pane-preview"].dataset.open).toBe("false");
        expect(nodes["#embed-pane-console"].dataset.open).toBe("false");
    });

    it("runs console-only projects and accepts bounded text output only from the preview", async () => {
        await boot("o");
        expect(nodes[".embed-bar nav"].children.map((button) => button.textContent)).toEqual(["Console"]);
        expect(nodes["#embed-pane-console"].dataset.open).toBe("true");
        expect(nodes["#embed-pane-preview"].dataset.open).toBe("false");
        expect(nodes["#embed-preview"].srcdoc).toContain("console.log('hello')");
        const data = { type: "xode:embed-console", level: "error", text: "<script>untrusted</script>" };
        listeners.message({ source: {}, data });
        expect(nodes["#embed-console"].children).toHaveLength(0);
        const source = nodes["#embed-preview"].contentWindow;
        listeners.message({ source, data });
        expect(nodes["#embed-console"].children[0].textContent).toBe(data.text);
        for (let index = 0; index < 305; index++) listeners.message({ source, data: { ...data, text: "x".repeat(10001) } });
        expect(nodes["#embed-console"].children).toHaveLength(300);
        expect(nodes["#embed-console"].children[0].textContent).toHaveLength(10000);
        listeners.message({ source, data: { ...data, level: "clear" } });
        expect(nodes["#embed-console"].children).toHaveLength(0);
    });

    it.each(Array.from({ length: 31 }, (_, index) => index + 1))("restores selected panes from generated embed code, selection %i", async (selection) => {
        const selected = Object.fromEntries(EMBED_PANES.map(({ name }, index) => [name, Boolean(selection & (1 << index))]));
        const code = createProjectEmbedCode("https://xode.test/tools/", gistId, selected);
        const url = new URL(code.match(/src="([^"]+)"/)[1].replaceAll("&amp;", "&"));
        await boot(url.searchParams.get("p"));
        const buttons = nodes[".embed-bar nav"].children;
        expect(buttons.map((button) => button.dataset.view)).toEqual(EMBED_PANES.filter(({ name }) => selected[name]).map(({ name }) => name));
        for (const { name } of EMBED_PANES) expect(nodes[`#embed-pane-${name}`].dataset.open).toBe(String(selected[name]));
    });

    it("supports pane isolation and keeps at least one selected pane open", async () => {
        await boot("hcp");
        const buttons = nodes[".embed-bar nav"].children;
        buttons[0].listeners.click({ ctrlKey: true });
        expect(nodes["#embed-pane-html"].dataset.open).toBe("true");
        expect(nodes["#embed-pane-css"].dataset.open).toBe("false");
        expect(nodes["#embed-pane-preview"].dataset.open).toBe("false");
        buttons[0].listeners.click({});
        expect(nodes["#embed-pane-html"].dataset.open).toBe("true");
        buttons[2].listeners.click({});
        expect(nodes["#embed-pane-preview"].dataset.open).toBe("true");
        buttons[2].listeners.click({ metaKey: true });
        expect(nodes["#embed-pane-html"].dataset.open).toBe("false");
        expect(nodes["#embed-pane-preview"].dataset.open).toBe("true");
    });

    it("shows load errors without exposing an empty preview", async () => {
        loadEmbedProject.mockRejectedValueOnce(new Error("Project unavailable"));
        await boot("p");
        expect(nodes["#embed-status"].textContent).toBe("Project unavailable");
        expect(nodes["#embed-status"].dataset.type).toBe("error");
        expect(nodes["#embed-preview"].srcdoc).toBe("");
        expect(nodes["#embed-open"].hidden).toBe(true);
    });
});

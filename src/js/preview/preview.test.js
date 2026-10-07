/* global describe, expect, it */

import { generatePreviewHTML, isProjectEmpty, normalizeScriptType, PREVIEW_SANDBOX } from "./preview.js";

describe("empty preview state", () => {
    it("treats missing and whitespace-only code as empty", () => {
        expect(isProjectEmpty({})).toBe(true);
        expect(isProjectEmpty({ html: " \n\t", css: "\n ", js: "\t" })).toBe(true);
    });

    it.each(["html", "css", "js"])("keeps the live preview when only %s has code", (pane) => {
        expect(isProjectEmpty({ html: "", css: "", js: "", [pane]: "/* code */" })).toBe(false);
    });

    it.each(["app", "preview", "download"])("keeps welcome markup out of %s project documents", (consumer) => {
        const html = generatePreviewHTML({ html: "", css: "", js: "" }, consumer);
        expect(html).not.toContain("preview-welcome");
        expect(html).not.toContain("Start creating");
    });
});

describe("project document generation", () => {
    it("writes escaped title and description metadata into downloads", () => {
        const html = generatePreviewHTML(
            {
                name: 'A <useful> "project"',
                description: 'A description with "quotes" & details',
                html: "<main>Hello</main>",
                css: "",
                js: "",
                scriptType: "module",
            },
            "download",
        );

        expect(html).toContain("<title>A &lt;useful&gt; &quot;project&quot;</title>");
        expect(html).toContain('<meta name="title" content="A &lt;useful&gt; &quot;project&quot;">');
        expect(html).toContain('<meta name="description" content="A description with &quot;quotes&quot; &amp; details">');
    });

    it("supports module and classic JavaScript per project", () => {
        const base = { name: "Test", description: "", html: "", css: "", js: "window.ready = true;" };

        expect(generatePreviewHTML({ ...base, scriptType: "module" }, "download")).toContain('<script type="module">');
        expect(generatePreviewHTML({ ...base, scriptType: "classic" }, "download")).toContain("<script>window.ready = true;");
        expect(normalizeScriptType("unknown")).toBe("module");
    });

    it("keeps preview frames on an opaque origin", () => {
        expect(PREVIEW_SANDBOX).toContain("allow-scripts");
        expect(PREVIEW_SANDBOX).not.toContain("allow-same-origin");
    });

    it("keeps an unfinished HTML tag from consuming the preview script", () => {
        const html = generatePreviewHTML({ name: "Test", description: "", html: "<button", css: "", js: "", scriptType: "module" });

        expect(html).toMatch(/<button>\s*<script id="◆xode-js"/);
        expect(html).not.toContain("<button>//# sourceURL=js");
    });
});

/* global describe, expect, it, vi */

import { createProjectEmbedCode, EMBED_SANDBOX, generateEmbedPreview, getEmbedPanes, loadEmbedProject } from "./embedProject.js";

const gistId = "1234567890abcdef1234567890abcdef";

describe("embedded project sharing", () => {
    it("includes only selected share panes and supports subdirectory deployments", () => {
        const code = createProjectEmbedCode("https://xode.test/tools/index.html?old=1#hash", gistId, { html: true, console: true, richEditor: true, chat: true }, 'A "demo" <script>');
        expect(code).toContain(`src="https://xode.test/tools/embed.html?g=${gistId}&amp;p=ho"`);
        expect(code).toContain('title="A &quot;demo&quot; &lt;script&gt;"');
        expect(code).not.toContain("old=");
        expect(code).not.toContain("#hash");
    });

    it("defaults invalid pane parameters to preview and preserves valid selections", () => {
        expect(getEmbedPanes("ho").map(({ name }) => name)).toEqual(["html", "console"]);
        for (const value of [null, "", "hh", "hx", "chat"]) expect(getEmbedPanes(value).map(({ name }) => name)).toEqual(["preview"]);
    });

    it("rejects invalid Gist identifiers before fetching", async () => {
        const fetcher = vi.fn();
        await expect(loadEmbedProject("../private", fetcher)).rejects.toThrow("valid published project");
        expect(fetcher).not.toHaveBeenCalled();
        expect(() => createProjectEmbedCode("https://xode.test/", "invalid", {})).toThrow("Invalid Gist ID");
    });

    it("loads the published project anonymously and respects classic scripts", async () => {
        const fetcher = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                description: "Demo — Description",
                files: {
                    "index.html": { content: "<h1>Published</h1>" },
                    "script.js": { content: "console.log('hi')" },
                    "xode.json": { content: '{"format":"xode","scriptType":"classic"}' },
                },
            }),
        });
        await expect(loadEmbedProject(gistId, fetcher)).resolves.toEqual({ name: "Demo", description: "Description", html: "<h1>Published</h1>", css: "", js: "console.log('hi')", scriptType: "classic" });
        expect(fetcher).toHaveBeenCalledWith(`https://api.github.com/gists/${gistId}`, { credentials: "omit", headers: { Accept: "application/vnd.github+json" } });
    });

    it("handles missing projects and API rate limits", async () => {
        await expect(loadEmbedProject(gistId, async () => ({ ok: false, status: 404 }))).rejects.toThrow("unavailable");
        await expect(loadEmbedProject(gistId, async () => ({ ok: false, status: 403 }))).rejects.toThrow("Try again later");
    });

    it("fetches complete truncated files only from the Gist raw origin", async () => {
        const rawUrl = `https://gist.githubusercontent.com/owner/${gistId}/raw/index.html`;
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ files: { "index.html": { truncated: true, raw_url: rawUrl } } }) })
            .mockResolvedValueOnce({ ok: true, text: async () => "complete" });
        expect((await loadEmbedProject(gistId, fetcher)).html).toBe("complete");
        expect(fetcher).toHaveBeenLastCalledWith(rawUrl, { credentials: "omit" });
        const unsafeFetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files: { "index.html": { truncated: true, raw_url: "https://xode.test/private" } } }) });
        await expect(loadEmbedProject(gistId, unsafeFetcher)).rejects.toThrow("Invalid project file URL");
        expect(unsafeFetcher).toHaveBeenCalledTimes(1);
    });

    it("restricts project capabilities and omits the editor bridge", () => {
        expect(EMBED_SANDBOX).toBe("allow-scripts");
        const html = generateEmbedPreview({ name: "Demo", html: "<p>Hello</p>", css: "", js: "console.log('hi')", scriptType: "classic" });
        expect(html).toContain('type: "xode:embed-console"');
        expect(html.indexOf('type: "xode:embed-console"')).toBeLessThan(html.indexOf("console.log('hi')"));
        expect(html).not.toContain("inject.js");
        expect(html).not.toContain("designMode");
        expect(html).not.toContain("content-changed");
    });
});

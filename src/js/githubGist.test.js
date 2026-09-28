/* global beforeEach, describe, expect, it, vi */

function successfulJson(body) {
    return {
        ok: true,
        status: 200,
        json: vi.fn(async () => body),
    };
}

async function loadGistModule() {
    vi.resetModules();
    return import("./githubGist.js");
}

beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {},
    });
    vi.stubGlobal("fetch", vi.fn());
});

describe("XODE Gist metadata", () => {
    it("creates and detects the versioned manifest", async () => {
        const { XODE_MANIFEST_FILENAME, XODE_MANIFEST, createXodeManifestFile, hasXodeManifest } = await loadGistModule();
        const manifestFile = createXodeManifestFile();

        expect(XODE_MANIFEST_FILENAME).toBe("xode.json");
        expect(JSON.parse(manifestFile.content)).toEqual(XODE_MANIFEST);
        expect(hasXodeManifest({ files: { "xode.json": manifestFile } })).toBe(true);
        expect(hasXodeManifest({ files: { "index.html": {} } })).toBe(false);
        expect(hasXodeManifest(null)).toBe(false);
    });
});

describe("authenticated Gist listing", () => {
    it("loads every page using the maximum page size", async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `gist-${index}` }));
        const secondPage = [{ id: "gist-100" }];
        fetch.mockResolvedValueOnce(successfulJson(firstPage)).mockResolvedValueOnce(successfulJson(secondPage));

        const { default: gist, setToken } = await loadGistModule();
        setToken("github-token");

        await expect(gist.list()).resolves.toEqual([...firstPage, ...secondPage]);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/gists?per_page=100&page=1");
        expect(fetch.mock.calls[1][0]).toBe("https://api.github.com/gists?per_page=100&page=2");
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer github-token");
    });
});

describe("authenticated Gist deletion", () => {
    it("deletes the requested Gist with the stored token", async () => {
        fetch.mockResolvedValueOnce({ ok: true, status: 204 });

        const { default: gist, setToken } = await loadGistModule();
        setToken("github-token");

        await expect(gist.delete("gist-to-delete")).resolves.toBe(true);
        expect(fetch).toHaveBeenCalledWith(
            "https://api.github.com/gists/gist-to-delete",
            expect.objectContaining({
                method: "DELETE",
                headers: expect.objectContaining({ Authorization: "Bearer github-token" }),
            }),
        );
    });
});

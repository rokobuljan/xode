/* global beforeEach, describe, expect, it, vi */

const emitAuthEvent = vi.hoisted(() => vi.fn());
vi.mock("../shared/bus.js", () => ({ bus: { emit: emitAuthEvent } }));

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
    emitAuthEvent.mockClear();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {},
    });
    vi.stubGlobal("fetch", vi.fn());
});

describe("XODE Gist metadata", () => {
    it("creates and detects the versioned manifest", async () => {
        const { XODE_MANIFEST_FILENAME, XODE_MANIFEST, createXodeManifestFile, hasXodeManifest, readXodeManifest } = await loadGistModule();
        const manifestFile = createXodeManifestFile({ scriptType: "classic" });

        expect(XODE_MANIFEST_FILENAME).toBe("xode.json");
        expect(JSON.parse(manifestFile.content)).toEqual({ ...XODE_MANIFEST, scriptType: "classic" });
        expect(hasXodeManifest({ files: { "xode.json": manifestFile } })).toBe(true);
        expect(readXodeManifest({ files: { "xode.json": manifestFile } })).toEqual({ ...XODE_MANIFEST, scriptType: "classic" });
        expect(hasXodeManifest({ files: { "index.html": {} } })).toBe(false);
        expect(hasXodeManifest(null)).toBe(false);
        expect(readXodeManifest({ files: { "xode.json": { content: "not json" } } })).toBeNull();
    });
});

describe("authenticated Gist listing", () => {
    it("loads one bounded page at a time", async () => {
        const secondPage = Array.from({ length: 30 }, (_, index) => ({ id: `gist-${index + 30}` }));
        fetch.mockResolvedValueOnce(successfulJson(secondPage));

        const { default: gist, setToken } = await loadGistModule();
        setToken("github-token");

        await expect(gist.list({ page: 2 })).resolves.toEqual(secondPage);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/gists?per_page=30&page=2");
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer github-token");
    });

    it("trims pasted tokens before saving and authenticating requests", async () => {
        fetch.mockResolvedValueOnce(successfulJson([]));
        const { default: gist, setToken, getToken } = await loadGistModule();
        setToken("  github-token\n");

        expect(JSON.parse(localStorage["ls-xode.settings"]).gt).toBe("github-token");
        expect(getToken()).toBe("github-token");
        await gist.list();
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer github-token");
    });

    it("normalizes previously stored tokens and rejects whitespace-only credentials", async () => {
        const { default: gist, getToken, hasToken, setToken, GistAuthError } = await loadGistModule();
        localStorage["ls-xode.settings"] = JSON.stringify({ gt: "  github-token  " });
        expect(getToken()).toBe("github-token");

        setToken(" \n ");
        expect(hasToken()).toBe(false);
        await expect(gist.list()).rejects.toBeInstanceOf(GistAuthError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it("explains how to reconnect when GitHub rejects credentials", async () => {
        const details = { message: "Bad credentials" };
        fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => details });
        const { default: gist, setToken, GistApiError } = await loadGistModule();
        setToken("invalid-token");

        await expect(gist.list()).rejects.toMatchObject({
            name: "GistApiError",
            status: 401,
            details,
            message: expect.stringContaining("token has expired or is invalid"),
        });
        expect(emitAuthEvent).toHaveBeenCalledWith("github:auth-expired", { message: expect.stringContaining("reconnect in GitHub Connect") });
        expect(new GistApiError(404, { message: "Not Found" }).message).toBe("Not Found");
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe("expired GitHub credentials", () => {
    function unauthorized() {
        return { ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) };
    }

    it("disconnects and notifies once for concurrent failures, then blocks authenticated requests", async () => {
        fetch.mockImplementation(async () => unauthorized());
        const { default: gist, setToken, getToken, hasToken, GistAuthError } = await loadGistModule();
        localStorage["ls-xode.settings"] = JSON.stringify({ tabWidth: 4 });
        setToken("expired-token");

        const results = await Promise.allSettled([gist.list(), gist.list({ page: 2 })]);

        expect(results.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
        expect(emitAuthEvent).toHaveBeenCalledTimes(1);
        expect(emitAuthEvent).toHaveBeenCalledWith("github:auth-expired", { message: expect.stringContaining("token has expired or is invalid") });
        expect(getToken()).toBeUndefined();
        expect(hasToken()).toBe(false);
        expect(JSON.parse(localStorage["ls-xode.settings"])).toEqual({ tabWidth: 4 });
        await expect(gist.list()).rejects.toBeInstanceOf(GistAuthError);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("preserves a replacement token when an older request returns 401", async () => {
        let respond;
        fetch.mockImplementationOnce(() => new Promise((resolve) => (respond = resolve)));
        const { default: gist, setToken, getToken } = await loadGistModule();
        setToken("expired-token");
        const pending = gist.list();
        setToken("replacement-token");

        respond(unauthorized());
        await expect(pending).rejects.toMatchObject({ status: 401 });

        expect(getToken()).toBe("replacement-token");
        expect(emitAuthEvent).not.toHaveBeenCalled();
    });

    it.each([403, 404, 429, 500])("preserves credentials for a %s response", async (status) => {
        fetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({ message: "Request failed" }) });
        const { default: gist, setToken, getToken } = await loadGistModule();
        setToken("github-token");

        await expect(gist.list()).rejects.toMatchObject({ status, message: "Request failed" });

        expect(getToken()).toBe("github-token");
        expect(emitAuthEvent).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("continues reading a public Gist without the expired token", async () => {
        const remote = { id: "public-gist", files: {} };
        fetch.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(successfulJson(remote));
        const { default: gist, setToken, hasToken } = await loadGistModule();
        setToken("expired-token");

        await expect(gist.read(remote.id)).resolves.toEqual(remote);

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://api.github.com/gists/public-gist", "https://api.github.com/gists/public-gist"]);
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer expired-token");
        expect(fetch.mock.calls[1][1].headers.Authorization).toBeUndefined();
        expect(hasToken()).toBe(false);
        expect(emitAuthEvent).toHaveBeenCalledTimes(1);
    });

    it("does not retry a write after credentials expire", async () => {
        fetch.mockResolvedValueOnce(unauthorized());
        const { default: gist, setToken } = await loadGistModule();
        setToken("expired-token");

        await expect(gist.update("gist-id", { files: {} })).rejects.toMatchObject({ status: 401 });

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(emitAuthEvent).toHaveBeenCalledTimes(1);
    });

    it("notifies even when the 401 response body is not JSON", async () => {
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: async () => {
                throw new SyntaxError("Not JSON");
            },
        });
        const { default: gist, setToken, hasToken } = await loadGistModule();
        setToken("expired-token");

        await expect(gist.list()).rejects.toMatchObject({ status: 401, details: {} });

        expect(hasToken()).toBe(false);
        expect(emitAuthEvent).toHaveBeenCalledTimes(1);
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

/* global beforeEach, describe, expect, it, vi */

const storageTestState = vi.hoisted(() => ({ database: null }));

vi.mock("idb", () => ({
    openDB: vi.fn(async () => storageTestState.database),
}));

function createMemoryDatabase() {
    const stores = new Map();
    const store = (name) => {
        if (!stores.has(name)) stores.set(name, new Map());
        return stores.get(name);
    };

    return {
        stores,
        async get(storeName, key) {
            return store(storeName).get(key);
        },
        async getKey(storeName, key) {
            return store(storeName).has(key) ? key : undefined;
        },
        async put(storeName, value, key) {
            store(storeName).set(key, value);
        },
        async delete(storeName, key) {
            store(storeName).delete(key);
        },
    };
}

function createLocalStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.get(String(key)) ?? null;
        },
        setItem(key, value) {
            values.set(String(key), String(value));
        },
        removeItem(key) {
            values.delete(String(key));
        },
    };
}

async function loadStorageModule() {
    vi.resetModules();
    return import("./chatStorage.js");
}

beforeEach(() => {
    storageTestState.database = createMemoryDatabase();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createLocalStorage() });
});

describe("serverless AI storage", () => {
    it("keeps session-only keys out of IndexedDB", async () => {
        const storage = await loadStorageModule();
        await storage.saveApiKey("openai", "session-secret");

        expect(await storage.getApiKey("openai")).toBe("session-secret");
        expect(await storage.isApiKeyRemembered("openai")).toBe(false);
        expect(storageTestState.database.stores.get("secrets")?.size || 0).toBe(0);
    });

    it("encrypts remembered keys instead of storing plaintext", async () => {
        const storage = await loadStorageModule();
        await storage.saveApiKey("openai", "remembered-secret", { remember: true });

        const record = storageTestState.database.stores.get("secrets").get("openai");
        expect(record.ciphertext).not.toContain("remembered-secret");
        expect(record.algorithm).toBe("AES-GCM");
        expect(await storage.getApiKey("openai")).toBe("remembered-secret");
    });

    it("migrates legacy keys and removes them from localStorage", async () => {
        localStorage.setItem("ls-xode.settings", JSON.stringify({ provider: "openai", model: "example-model", apiKeys: { openai: "legacy-secret" }, tabWidth: 4 }));
        const storage = await loadStorageModule();
        await storage.initChatStorage();

        expect(await storage.getApiKey("openai")).toBe("legacy-secret");
        expect(await storage.getChatSettings()).toMatchObject({ provider: "openai", models: { openai: "example-model" } });
        expect(JSON.parse(localStorage.getItem("ls-xode.settings"))).toEqual({ tabWidth: 4 });
    });

    it("stores conversations by project", async () => {
        const storage = await loadStorageModule();
        await storage.saveConversation("project-a", [{ role: "user", content: "Hello" }]);

        expect(await storage.loadConversation("project-a")).toEqual([{ role: "user", content: "Hello" }]);
        expect(await storage.loadConversation("project-b")).toEqual([]);
    });

    it("moves a conversation when a project id changes", async () => {
        const storage = await loadStorageModule();
        await storage.saveConversation("local-id", [{ role: "user", content: "Keep this" }]);
        await storage.moveConversation("local-id", "gist-id");

        expect(await storage.loadConversation("local-id")).toEqual([]);
        expect(await storage.loadConversation("gist-id")).toEqual([{ role: "user", content: "Keep this" }]);
    });

    it("stores favorite models by provider", async () => {
        const storage = await loadStorageModule();
        await storage.setModelFavorite("openai", "gpt-a", true);
        await storage.setModelFavorite("openai", "gpt-b", true);
        await storage.setModelFavorite("anthropic", "claude-a", true);
        await storage.setModelFavorite("openai", "gpt-a", false);

        expect(await storage.getFavoriteModels("openai")).toEqual(["gpt-b"]);
        expect(await storage.getFavoriteModels("anthropic")).toEqual(["claude-a"]);
    });

    it("removes favorites that are absent from a fresh model response", async () => {
        const storage = await loadStorageModule();
        await storage.setModelFavorite("openai", "available", true);
        await storage.setModelFavorite("openai", "retired", true);

        expect(await storage.reconcileFavoriteModels("openai", ["available", "new-model"])).toEqual(["available"]);
        expect(await storage.getFavoriteModels("openai")).toEqual(["available"]);

        await storage.reconcileFavoriteModels("openai", []);
        expect(await storage.getFavoriteModels("openai")).toEqual([]);
        expect(storageTestState.database.stores.get("favorite-models")?.has("openai")).toBe(false);
    });
});

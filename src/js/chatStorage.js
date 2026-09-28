import { openDB } from "idb";

const DB_NAME = "xode-ai";
const DB_VERSION = 2;
const SETTINGS_STORE = "settings";
const SECRETS_STORE = "secrets";
const META_STORE = "meta";
const CONVERSATIONS_STORE = "conversations";
const MODELS_STORE = "models";
const FAVORITE_MODELS_STORE = "favorite-models";
const VAULT_KEY_ID = "api-key-vault";
const SETTINGS_ID = "preferences";
const LEGACY_SETTINGS_KEY = "ls-xode.settings";

const DEFAULT_SETTINGS = {
    provider: "gemini",
    models: {},
};

const sessionKeys = new Map();
const conversationWrites = new Map();
const favoriteModelWrites = new Map();
let databasePromise;
let initializationPromise;
let settingsWriteQueue = Promise.resolve();

function getLocalStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function openChatDatabase() {
    if (!databasePromise) {
        databasePromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(database) {
                [SETTINGS_STORE, SECRETS_STORE, META_STORE, CONVERSATIONS_STORE, MODELS_STORE, FAVORITE_MODELS_STORE].forEach((storeName) => {
                    if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
                });
            },
        }).catch((error) => {
            databasePromise = undefined;
            throw error;
        });
    }
    return databasePromise;
}

function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getVaultKey(database) {
    let key = await database.get(META_STORE, VAULT_KEY_ID);
    if (key) return key;

    key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await database.put(META_STORE, key, VAULT_KEY_ID);
    return key;
}

async function encryptSecret(database, value) {
    const key = await getVaultKey(database);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(value);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    return {
        algorithm: "AES-GCM",
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(encrypted)),
        updatedAt: Date.now(),
    };
}

async function decryptSecret(database, record) {
    if (!record || record.algorithm !== "AES-GCM") return "";
    const key = await getVaultKey(database);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(record.iv) }, key, base64ToBytes(record.ciphertext));
    return new TextDecoder().decode(decrypted);
}

async function migrateLegacySettings(database) {
    const storage = getLocalStorage();
    const raw = storage?.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return;

    let legacy;
    try {
        legacy = JSON.parse(raw);
    } catch {
        return;
    }

    const current = (await database.get(SETTINGS_STORE, SETTINGS_ID)) || {};
    const models = { ...current.models };
    if (legacy.provider && legacy.model) models[legacy.provider] = legacy.model;

    await database.put(
        SETTINGS_STORE,
        {
            ...DEFAULT_SETTINGS,
            ...current,
            provider: legacy.provider || current.provider || DEFAULT_SETTINGS.provider,
            models,
        },
        SETTINGS_ID,
    );

    const legacyKeys = legacy.apiKeys && typeof legacy.apiKeys === "object" ? legacy.apiKeys : {};
    for (const [provider, key] of Object.entries(legacyKeys)) {
        if (typeof key === "string" && key.trim()) {
            await database.put(SECRETS_STORE, await encryptSecret(database, key.trim()), provider);
        }
    }

    // Preserve unrelated global preferences (for example tabWidth), but remove
    // every API key and the obsolete single-provider model setting.
    delete legacy.apiKeys;
    delete legacy.provider;
    delete legacy.model;
    if (Object.keys(legacy).length) storage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(legacy));
    else storage.removeItem(LEGACY_SETTINGS_KEY);
}

export async function initChatStorage() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            const database = await openChatDatabase();
            await migrateLegacySettings(database);
            return database;
        })().catch((error) => {
            initializationPromise = undefined;
            throw error;
        });
    }
    return initializationPromise;
}

export async function getChatSettings() {
    const database = await initChatStorage();
    const stored = (await database.get(SETTINGS_STORE, SETTINGS_ID)) || {};
    return {
        ...DEFAULT_SETTINGS,
        ...stored,
        models: { ...DEFAULT_SETTINGS.models, ...stored.models },
    };
}

export async function updateChatSettings(patch) {
    const operation = settingsWriteQueue
        .catch(() => undefined)
        .then(async () => {
            const database = await initChatStorage();
            const stored = (await database.get(SETTINGS_STORE, SETTINGS_ID)) || {};
            const current = { ...DEFAULT_SETTINGS, ...stored, models: { ...DEFAULT_SETTINGS.models, ...stored.models } };
            const next = {
                ...current,
                ...patch,
                models: patch.models ? { ...current.models, ...patch.models } : current.models,
            };
            await database.put(SETTINGS_STORE, next, SETTINGS_ID);
            return next;
        });
    settingsWriteQueue = operation;
    return operation;
}

export async function saveApiKey(provider, value, { remember = false } = {}) {
    const database = await initChatStorage();
    const key = value.trim();

    if (!key) {
        sessionKeys.delete(provider);
        await database.delete(SECRETS_STORE, provider);
        return;
    }

    sessionKeys.set(provider, key);
    if (remember) await database.put(SECRETS_STORE, await encryptSecret(database, key), provider);
    else await database.delete(SECRETS_STORE, provider);
}

export async function getApiKey(provider) {
    if (sessionKeys.has(provider)) return sessionKeys.get(provider);

    const database = await initChatStorage();
    const record = await database.get(SECRETS_STORE, provider);
    if (!record) return "";

    try {
        const key = await decryptSecret(database, record);
        if (key) sessionKeys.set(provider, key);
        return key;
    } catch {
        // Corrupt or no-longer-decryptable secrets are safer to discard than
        // to leave the UI claiming a key is available.
        await database.delete(SECRETS_STORE, provider);
        return "";
    }
}

export async function hasApiKey(provider) {
    if (sessionKeys.has(provider)) return true;
    const database = await initChatStorage();
    return (await database.getKey(SECRETS_STORE, provider)) !== undefined;
}

export async function isApiKeyRemembered(provider) {
    const database = await initChatStorage();
    return (await database.getKey(SECRETS_STORE, provider)) !== undefined;
}

export async function clearApiKey(provider) {
    sessionKeys.delete(provider);
    const database = await initChatStorage();
    await database.delete(SECRETS_STORE, provider);
}

export async function credentialFingerprint(value) {
    if (!value) return "no-key";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return bytesToBase64(new Uint8Array(digest).slice(0, 12));
}

export async function getModelCache(provider) {
    const database = await initChatStorage();
    return (await database.get(MODELS_STORE, provider)) || null;
}

export async function setModelCache(provider, value) {
    const database = await initChatStorage();
    await database.put(MODELS_STORE, value, provider);
}

function normalizeFavoriteModels(models) {
    if (!Array.isArray(models)) return [];
    return [...new Set(models.filter((model) => typeof model === "string" && model.trim()))];
}

async function updateFavoriteModels(provider, update) {
    const key = String(provider);
    const previous = favoriteModelWrites.get(key) || Promise.resolve();
    const operation = previous
        .catch(() => undefined)
        .then(async () => {
            const database = await initChatStorage();
            const current = normalizeFavoriteModels(await database.get(FAVORITE_MODELS_STORE, key));
            const next = normalizeFavoriteModels(update(current));
            if (next.length) await database.put(FAVORITE_MODELS_STORE, next, key);
            else await database.delete(FAVORITE_MODELS_STORE, key);
            return next;
        });
    favoriteModelWrites.set(key, operation);
    try {
        return await operation;
    } finally {
        if (favoriteModelWrites.get(key) === operation) favoriteModelWrites.delete(key);
    }
}

export async function getFavoriteModels(provider) {
    const key = String(provider);
    await favoriteModelWrites.get(key);
    const database = await initChatStorage();
    return normalizeFavoriteModels(await database.get(FAVORITE_MODELS_STORE, key));
}

export function setModelFavorite(provider, model, favorite) {
    return updateFavoriteModels(provider, (models) => {
        const next = new Set(models);
        if (favorite) next.add(model);
        else next.delete(model);
        return [...next];
    });
}

export function reconcileFavoriteModels(provider, availableModels) {
    const available = new Set(availableModels);
    return updateFavoriteModels(provider, (models) => models.filter((model) => available.has(model)));
}

export async function loadConversation(projectId) {
    if (!projectId) return [];
    await conversationWrites.get(String(projectId));
    const database = await initChatStorage();
    const record = await database.get(CONVERSATIONS_STORE, String(projectId));
    return Array.isArray(record?.messages) ? record.messages : [];
}

export async function saveConversation(projectId, messages) {
    if (!projectId) return;
    const key = String(projectId);
    const snapshot = structuredClone(messages);
    const previous = conversationWrites.get(key) || Promise.resolve();
    const operation = previous
        .catch(() => undefined)
        .then(async () => {
            const database = await initChatStorage();
            await database.put(CONVERSATIONS_STORE, { messages: snapshot, updatedAt: Date.now() }, key);
        });
    conversationWrites.set(key, operation);
    try {
        await operation;
    } finally {
        if (conversationWrites.get(key) === operation) conversationWrites.delete(key);
    }
}

export async function clearConversation(projectId) {
    if (!projectId) return;
    await conversationWrites.get(String(projectId));
    const database = await initChatStorage();
    await database.delete(CONVERSATIONS_STORE, String(projectId));
}

export async function moveConversation(fromProjectId, toProjectId) {
    if (!fromProjectId || !toProjectId || String(fromProjectId) === String(toProjectId)) return;
    const database = await initChatStorage();
    const sourceKey = String(fromProjectId);
    const targetKey = String(toProjectId);
    await Promise.all([conversationWrites.get(sourceKey), conversationWrites.get(targetKey)]);
    const conversation = await database.get(CONVERSATIONS_STORE, sourceKey);
    if (conversation) await database.put(CONVERSATIONS_STORE, conversation, targetKey);
    await database.delete(CONVERSATIONS_STORE, sourceKey);
}

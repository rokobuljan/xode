/**
 * Project (+ storage) management.
 *
 * Full project records live in IndexedDB. The last-opened project id stays in
 * localStorage so startup can cheaply determine which project to resume.
 */

import { openDB } from "idb";
import { generateUUID } from "./utils.js";

const APP_PREFIX = "xode";
const DB_NAME = APP_PREFIX;
const DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const UPDATED_AT_INDEX = "updatedAt";

const LEGACY_INDEX_KEY = `${APP_PREFIX}-index`;
const LEGACY_PROJECT_PREFIX = `${APP_PREFIX}-project-`;
const LAST_KEY = `${APP_PREFIX}-last-project`;
const legacyProjectKey = (id) => `${LEGACY_PROJECT_PREFIX}${id}`;

const DEFAULT_PANES = {
    html: true,
    js: true,
    css: true,
    console: true,
    preview: true,
    richEditor: false,
    chat: true,
};
const DEFAULT_SCRIPT_TYPE = "module";

function normalizeScriptType(value) {
    return value === "classic" ? "classic" : DEFAULT_SCRIPT_TYPE;
}

let databasePromise;
let initializationPromise;
let writeQueue = Promise.resolve();
const deletedProjectIds = new Set();

function getLocalStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

export function getLastProjectId() {
    return getLocalStorage()?.getItem(LAST_KEY) ?? null;
}

export function setLastProjectId(id) {
    getLocalStorage()?.setItem(LAST_KEY, id);
}

function openProjectDatabase() {
    if (!databasePromise) {
        databasePromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(database, _oldVersion, _newVersion, transaction) {
                const store = database.objectStoreNames.contains(PROJECTS_STORE) ? transaction.objectStore(PROJECTS_STORE) : database.createObjectStore(PROJECTS_STORE, { keyPath: "id" });

                if (!store.indexNames.contains(UPDATED_AT_INDEX)) {
                    store.createIndex(UPDATED_AT_INDEX, UPDATED_AT_INDEX);
                }
            },
        }).catch((error) => {
            databasePromise = undefined;
            throw error;
        });
    }

    return databasePromise;
}

function isProjectRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;

    const { id } = value;
    return (typeof id === "string" && id.length > 0) || (typeof id === "number" && Number.isFinite(id));
}

function collectLegacyProjects(storage) {
    const projectKeys = new Set();
    const keysToRemove = new Set();
    const projects = new Map();

    const rawIndex = storage.getItem(LEGACY_INDEX_KEY);
    if (rawIndex !== null) {
        keysToRemove.add(LEGACY_INDEX_KEY);

        try {
            const index = JSON.parse(rawIndex);
            if (index && typeof index === "object" && !Array.isArray(index)) {
                Object.keys(index).forEach((id) => projectKeys.add(legacyProjectKey(id)));
            }
        } catch {
            // A malformed index must not prevent valid project keys from migrating.
        }
    }

    // Also find orphaned project records that are not present in the old index.
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(LEGACY_PROJECT_PREFIX)) projectKeys.add(key);
    }

    projectKeys.forEach((key) => {
        const rawProject = storage.getItem(key);
        if (rawProject === null) return;

        keysToRemove.add(key);

        try {
            const project = JSON.parse(rawProject);
            const keyId = key.slice(LEGACY_PROJECT_PREFIX.length);

            // A mismatched key/id pair is treated as malformed instead of being
            // allowed to write an unrelated IndexedDB record.
            if (!isProjectRecord(project) || String(project.id) !== keyId) return;
            projects.set(project.id, project);
        } catch {
            // Malformed legacy records are skipped without aborting valid ones.
        }
    });

    return {
        projects: [...projects.values()],
        keysToRemove: [...keysToRemove],
    };
}

async function migrateLegacyProjects(database) {
    const storage = getLocalStorage();
    if (!storage) return;

    const { projects, keysToRemove } = collectLegacyProjects(storage);
    if (keysToRemove.length === 0) return;

    const transaction = database.transaction(PROJECTS_STORE, "readwrite");

    for (const project of projects) {
        // Checking and adding in the same transaction makes migration
        // idempotent and ensures an IndexedDB project always wins.
        const existingKey = await transaction.store.getKey(project.id);
        if (existingKey === undefined) await transaction.store.add(project);
    }

    await transaction.done;

    // Cleanup happens only after every valid record has committed. LAST_KEY is
    // deliberately not part of this collection and remains in localStorage.
    keysToRemove.forEach((key) => storage.removeItem(key));
}

/**
 * Opens the database and completes the one-time localStorage migration.
 * Concurrent callers share the same initialization attempt.
 */
export async function initProjectStorage() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            const database = await openProjectDatabase();
            await migrateLegacyProjects(database);
            return database;
        })().catch((error) => {
            initializationPromise = undefined;
            throw error;
        });
    }

    return initializationPromise;
}

function enqueueWrite(write) {
    const operation = writeQueue.then(async () => {
        const database = await initProjectStorage();
        return write(database);
    });

    // A failed write is reported to its caller but does not poison later writes.
    writeQueue = operation.catch(() => undefined);
    return operation;
}

async function databaseAfterEarlierWrites() {
    const earlierWrites = writeQueue;
    const database = await initProjectStorage();
    await earlierWrites;
    return database;
}

function plainProjectSnapshot(project) {
    if (!project || typeof project !== "object") {
        throw new TypeError("A project must be an object");
    }

    const serialized = JSON.stringify(project);
    if (serialized === undefined) throw new TypeError("The project cannot be serialized");

    const snapshot = JSON.parse(serialized);
    if (!isProjectRecord(snapshot)) {
        throw new TypeError("A project must have a non-empty string or finite number id");
    }

    return snapshot;
}

export async function listProjects() {
    const database = await databaseAfterEarlierWrites();
    const projects = await database.getAll(PROJECTS_STORE);

    return projects
        .map(({ id, name, description, updatedAt }) => ({
            id,
            name,
            description,
            updatedAt,
        }))
        .sort((a, b) => {
            const aUpdatedAt = Number.isFinite(Number(a.updatedAt)) ? Number(a.updatedAt) : 0;
            const bUpdatedAt = Number.isFinite(Number(b.updatedAt)) ? Number(b.updatedAt) : 0;
            return bUpdatedAt - aUpdatedAt;
        });
}

export async function loadProject(id) {
    if (id === undefined || id === null) return null;

    const database = await databaseAfterEarlierWrites();
    const project = (await database.get(PROJECTS_STORE, id)) ?? null;
    if (project) project.scriptType = normalizeScriptType(project.scriptType);
    return project;
}

export async function createProject(data = {}) {
    const now = Date.now();
    const { persist, panes, ...rest } = data;
    const project = {
        id: generateUUID(),
        gistId: null,
        name: "Untitled",
        description: "",
        html: "",
        css: "",
        js: "",
        ...rest,
        scriptType: normalizeScriptType(rest.scriptType),
        panes: { ...DEFAULT_PANES, ...panes },
        createdAt: now,
        updatedAt: now,
        isAutorun: true,
    };

    // Creating is the explicit way to reuse an id that was deleted during this
    // session. This is done before saveProject checks the tombstone.
    deletedProjectIds.delete(project.id);
    if (persist !== false) await saveProject(project);
    return project;
}

/**
 * Persists a JSON/plain-object snapshot taken when saveProject is called.
 * Saves are queued so the last call is also the last write to commit.
 */
export async function saveProject(project) {
    const updatedAt = Date.now();
    project.updatedAt = updatedAt;

    // JSON cloning strips reactive Proxies and preserves the data model used by
    // the former localStorage implementation, while producing an IDB-safe value.
    const snapshot = plainProjectSnapshot(project);
    snapshot.updatedAt = updatedAt;

    // A debounced autosave may arrive after its project was deleted. Ignore it
    // unless createProject has explicitly made that id live again.
    if (deletedProjectIds.has(snapshot.id)) return snapshot;

    return enqueueWrite(async (database) => {
        const transaction = database.transaction(PROJECTS_STORE, "readwrite");
        await transaction.store.put(snapshot);
        await transaction.done;
        setLastProjectId(snapshot.id);
        return snapshot;
    });
}

export async function deleteProject(id) {
    // Mark synchronously so saves still waiting in a caller's debounce are
    // rejected even though the IndexedDB deletion itself is asynchronous.
    deletedProjectIds.add(id);

    try {
        return await enqueueWrite(async (database) => {
            const transaction = database.transaction(PROJECTS_STORE, "readwrite");
            await transaction.store.delete(id);
            await transaction.done;
        });
    } catch (error) {
        deletedProjectIds.delete(id);
        throw error;
    }
}

/**
 * Opens an explicit project, then the last-opened project, or finally a new
 * in-memory draft. Merely opening the app never persists an empty project.
 */
export async function openProject(id) {
    const targetId = id || getLastProjectId();
    const project = targetId ? await loadProject(targetId) : null;
    return project || createProject({ persist: false });
}

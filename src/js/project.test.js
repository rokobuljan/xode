/* global beforeEach, describe, expect, it, vi */

const storageTestState = vi.hoisted(() => ({ database: null }));

vi.mock("idb", () => ({
    openDB: vi.fn(async () => storageTestState.database),
}));

function clone(value) {
    return structuredClone(value);
}

function createMemoryDatabase() {
    const records = new Map();
    const store = {
        async getKey(id) {
            return records.has(id) ? id : undefined;
        },
        async add(project) {
            if (records.has(project.id)) throw new Error("Duplicate key");
            records.set(project.id, clone(project));
        },
        async put(project) {
            records.set(project.id, clone(project));
        },
        async delete(id) {
            records.delete(id);
        },
    };

    return {
        records,
        transaction() {
            return { store, done: Promise.resolve() };
        },
        async getAll() {
            return [...records.values()].map(clone);
        },
        async get(_storeName, id) {
            return records.has(id) ? clone(records.get(id)) : undefined;
        },
    };
}

function createLocalStorage() {
    const values = new Map();
    return {
        get length() {
            return values.size;
        },
        key(index) {
            return [...values.keys()][index] ?? null;
        },
        getItem(key) {
            return values.get(String(key)) ?? null;
        },
        setItem(key, value) {
            values.set(String(key), String(value));
        },
        removeItem(key) {
            values.delete(String(key));
        },
        clear() {
            values.clear();
        },
    };
}

async function loadProjectModule() {
    vi.resetModules();
    return import("./project.js");
}

beforeEach(() => {
    storageTestState.database = createMemoryDatabase();
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: createLocalStorage(),
    });
});

describe("IndexedDB project storage", () => {
    it("migrates legacy projects and leaves only the last-project pointer in localStorage", async () => {
        const legacyProject = {
            id: "legacy-project",
            name: "Legacy",
            description: "Migrated",
            html: "<main>saved</main>",
            css: "main { color: tomato; }",
            js: "console.log('saved')",
            panes: {},
            createdAt: 1,
            updatedAt: 2,
            isAutorun: true,
        };
        localStorage.setItem("xode-index", JSON.stringify({ [legacyProject.id]: legacyProject }));
        localStorage.setItem(`xode-project-${legacyProject.id}`, JSON.stringify(legacyProject));
        localStorage.setItem("xode-last-project", legacyProject.id);

        const projects = await loadProjectModule();
        await projects.initProjectStorage();

        expect(await projects.loadProject(legacyProject.id)).toEqual(legacyProject);
        expect(localStorage.getItem("xode-index")).toBeNull();
        expect(localStorage.getItem(`xode-project-${legacyProject.id}`)).toBeNull();
        expect(localStorage.getItem("xode-last-project")).toBe(legacyProject.id);
    });

    it("round-trips a large project without writing its body to localStorage", async () => {
        const projects = await loadProjectModule();
        const project = await projects.createProject({
            name: "Large",
            html: "x".repeat(6 * 1024 * 1024),
            panes: { chat: false },
        });

        const loaded = await projects.loadProject(project.id);
        expect(loaded.html).toHaveLength(6 * 1024 * 1024);
        expect(loaded.panes.chat).toBe(false);
        expect(localStorage.getItem(`xode-project-${project.id}`)).toBeNull();
        expect(localStorage.getItem("xode-last-project")).toBe(project.id);
    });

    it("orders writes, deletes records, and blocks stale autosaves from resurrecting them", async () => {
        const projects = await loadProjectModule();
        const project = await projects.createProject({ id: "ordered", name: "First" });
        project.name = "Second";

        const secondSave = projects.saveProject(project);
        project.name = "Third";
        const thirdSave = projects.saveProject(project);
        await Promise.all([secondSave, thirdSave]);

        expect((await projects.loadProject(project.id)).name).toBe("Third");
        await projects.deleteProject(project.id);
        await projects.saveProject({ ...project, name: "Stale" });
        expect(await projects.loadProject(project.id)).toBeNull();
        expect(await projects.listProjects()).toEqual([]);
    });
});

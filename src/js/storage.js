/**
 * xode-storage.js
 * localStorage-backed persistence for a jsfiddle/jsbin-style app.
 *
 * Storage layout:
 *   xode-index                -> { [id]: { id, name, description, updatedAt } }
 *   xode-project-<id>         -> full project JSON (html, css, js, panes, etc.)
 *
 * Keying by id (not name) means renaming a project never requires
 * moving/rewriting its storage key. The index is small and cheap to
 * parse, so listing projects doesn't require loading every project's
 * full HTML/CSS/JS just to render a "recent projects" list.
 *
 * No autosave/Proxy magic here: the caller is responsible for calling
 * saveProject() whenever it mutates the project (on textarea "input",
 * on a pane toggle, on rename, etc.). This makes persistence explicit
 * and avoids the pitfall of silently-unpersisted nested mutations.
 */

const APP_PREFIX = 'xode';
const INDEX_KEY = `${APP_PREFIX}-index`;
const LAST_KEY = `${APP_PREFIX}-last-project`;
const projectKey = (id) => `${APP_PREFIX}-project-${id}`;

export function getLastProjectId() {
    return localStorage.getItem(LAST_KEY);
}

export function setLastProjectId(id) {
    localStorage.setItem(LAST_KEY, id);
}

const DEFAULT_PANES = {
    html: true,
    js: true,
    css: true,
    console: true,
    preview: true,
    richEditor: false, // hide by default
};

// low-level index helpers

function loadIndex() {
    try {
        return JSON.parse(localStorage.getItem(INDEX_KEY)) || {};
    } catch {
        return {};
    }
}

function saveIndex(index) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function updateIndexEntry(project) {
    const index = loadIndex();
    index[project.id] = {
        id: project.id,
        name: project.name,
        description: project.description,
        updatedAt: project.updatedAt,
    };
    saveIndex(index);
}

//  CRUD 

export function listProjects() {
    return Object.values(loadIndex()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadProject(id) {
    const raw = localStorage.getItem(projectKey(id));
    return raw ? JSON.parse(raw) : null;
}

export function createProject({ name = "Untitled", description = "", panes = {}, persist = true } = {}) {
    const now = Date.now();
    const project = {
        id: crypto.randomUUID(),
        name,
        description,
        html: '',
        css: '',
        js: '',
        panes: { ...DEFAULT_PANES, ...panes },
        createdAt: now,
        updatedAt: now,
        isAutorun: true,
        tabSpaces: 4,
    };
    if (persist) {
        saveProject(project);
    }
    return project;
}

/**
 * Persists the full project record and refreshes its index entry.
 * Call this explicitly after any mutation you want kept
 * (editor input, pane toggles, rename, etc).
 */
export function saveProject(project) {
    project.updatedAt = Date.now();
    localStorage.setItem(projectKey(project.id), JSON.stringify(project));
    updateIndexEntry(project);
    setLastProjectId(project.id);
    return project;
}

export function deleteProject(id) {
    localStorage.removeItem(projectKey(id));
    const index = loadIndex();
    delete index[id];
    saveIndex(index);
}

/**
 * Convenience: opens a project ready to edit, as a plain object
 * (no Proxy, no autosave).
 *
 * Resolution order:
 *   1. Explicit id passed in.
 *   2. The last-opened project id (so a page refresh resumes where you left off).
 *   3. A brand new "Untitled" draft — created in memory only, NOT written to
 *      localStorage yet, so simply loading the app never litters storage with
 *      empty projects. Call saveProject() yourself once the user actually
 *      changes something.
 */
export function openProject(id) {
    const targetId = id || getLastProjectId();
    const data = targetId ? loadProject(targetId) : null;
    return data || createProject({ persist: false });
}

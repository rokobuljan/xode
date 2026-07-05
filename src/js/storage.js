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
    richEditor: false,
};

// ---------- low-level index helpers ----------

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

// ---------- CRUD ----------

export function listProjects() {
    return Object.values(loadIndex()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadProject(id) {
    const raw = localStorage.getItem(projectKey(id));
    return raw ? JSON.parse(raw) : null;
}

export function createProject({ name = 'Untitled', description = '' } = {}, { persist = true } = {}) {
    const now = Date.now();
    const project = {
        id: crypto.randomUUID(),
        name,
        description,
        html: '',
        css: '',
        js: '',
        panes: { ...DEFAULT_PANES },
        createdAt: now,
        updatedAt: now,
    };
    if (persist) {
        saveProjectRaw(project);
        updateIndexEntry(project);
    }
    return project;
}

export function saveProjectRaw(project) {
    localStorage.setItem(projectKey(project.id), JSON.stringify(stripProxy(project)));
}

export function deleteProject(id) {
    localStorage.removeItem(projectKey(id));
    const index = loadIndex();
    delete index[id];
    saveIndex(index);
}

// strip Proxy wrapper markers before JSON.stringify (harmless no-op on plain objects)
function stripProxy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// ---------- debounce ----------

function debounce(fn, delay = 400) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// ---------- autosaving proxy ----------

/**
 * Wraps a project object in a deep Proxy. Any mutation (top-level field,
 * or nested e.g. project.panes.console = false) triggers a debounced
 * save to localStorage, updating both the full record and the index.
 */
export function createAutosavingProxy(project, { debounceMs = 400, onSave } = {}) {
    let root; // set after wrap() below

    const persist = debounce(() => {
        root.updatedAt = Date.now(); // note: this itself re-triggers persist via the trap,
        // which is fine, it just resets the debounce timer once more
        saveProjectRaw(root);
        updateIndexEntry(root);
        setLastProjectId(root.id);
        onSave?.(root);
    }, debounceMs);

    const handler = {
        set(target, prop, value, receiver) {
            if (value && typeof value === 'object' && !value.__isProxy) {
                value = wrap(value);
            }
            const ok = Reflect.set(target, prop, value, receiver);
            persist();
            return ok;
        },
        get(target, prop, receiver) {
            if (prop === '__isProxy') return true;
            return Reflect.get(target, prop, receiver);
        },
        deleteProperty(target, prop) {
            const ok = Reflect.deleteProperty(target, prop);
            persist();
            return ok;
        },
    };

    function wrap(obj) {
        for (const key of Object.keys(obj)) {
            if (obj[key] && typeof obj[key] === 'object' && !obj[key].__isProxy) {
                obj[key] = wrap(obj[key]);
            }
        }
        return new Proxy(obj, handler);
    }

    root = wrap(project);
    return root;
}

/**
 * Convenience: opens a project ready to edit, wrapped in the autosaving proxy.
 *
 * Resolution order:
 *   1. Explicit id passed in.
 *   2. The last-opened project id (so a page refresh resumes where you left off).
 *   3. A brand new "Untitled" draft — created in memory only, NOT written to
 *      localStorage yet, so simply loading the app never litters storage with
 *      empty projects. The moment the user edits anything (types in an editor,
 *      renames it, toggles a pane), the autosave proxy persists it for real.
 */
export function openProject(id, options) {
    const targetId = id || getLastProjectId();
    const data = targetId ? loadProject(targetId) : null;
    const project = data || createProject({}, { persist: false });
    return createAutosavingProxy(project, options);
}
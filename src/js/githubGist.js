import { LS } from "./utils.js";
const ls = LS("xode.settings");

/**
 * Minimal client-side connector for the GitHub Gist API.
 * Auth: a classic PAT with the `gist` scope, stored in localStorage.
 */

const API_BASE = 'https://api.github.com/gists';

/* ---------- token helpers ---------- */

export function getToken() {
    return ls.read().gt;
}

export function setToken(gt) {
    ls.update({ gt });
}

export function clearToken() {
    const settings = ls.read();
    delete settings.gt;
    ls.update(settings);
}

export function hasToken() {
    return !!getToken();
}

export class GistAuthError extends Error {
    constructor(message = 'No GitHub token found. Please connect your GitHub account.') {
        super(message);
        this.name = 'GistAuthError';
    }
}

export class GistApiError extends Error {
    constructor(status, details) {
        super(details?.message || `GitHub API error: ${status}`);
        this.name = 'GistApiError';
        this.status = status;
        this.details = details;
    }
}

/* middleware */

// Wraps a method that REQUIRES a token. Throws GistAuthError if missing.
function requireAuth(fn) {
    return async (...args) => {
        const token = getToken();
        if (!token) throw new GistAuthError();
        return fn(token, ...args);
    };
}

// Wraps a method where a token is OPTIONAL (e.g. reading a public gist).
function optionalAuth(fn) {
    return async (...args) => {
        const token = getToken(); // may be null — fn must handle that
        return fn(token, ...args);
    };
}

/* low-level request helper */

async function request(url, options = {}, token = null) {
    const headers = {
        'Accept': 'application/vnd.github+json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'Authorization': `token ${String(token)}` } : {}),
        ...options.headers
    };

    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
        const details = await res.json().catch(() => ({}));
        throw new GistApiError(res.status, details);
    }

    if (res.status === 204) return null; // e.g. DELETE
    return res.json();
}

/* CRUD methods */

const gistCrud = {
    /**
     * Create a new gist.
     * @param {{ description?: string, files: object, isPublic?: boolean }} data
     */
    create: requireAuth(async (token, { description = '', files, isPublic = true }) => {
        return request(API_BASE, {
            method: 'POST',
            body: JSON.stringify({ description, public: isPublic, files })
        }, token);
    }),

    /**
     * Read a gist by ID. Works without a token for public gists;
     * pass a token (already handled automatically if one exists) for private ones.
     */
    read: optionalAuth(async (token, gistId) => {
        return request(`${API_BASE}/${gistId}`, {
            method: 'GET'
        }, token);
    }),

    /**
     * Update (overwrite) an existing gist.
     * @param {string} gistId
     * @param {{ description?: string, files: object }} data
     */
    update: requireAuth(async (token, gistId, { description, files }) => {
        return request(`${API_BASE}/${gistId}`, {
            method: 'PATCH',
            body: JSON.stringify({ description, files })
        }, token);
    }),

    /**
     * Delete a gist. Returns true on success.
     */
    delete: requireAuth(async (token, gistId) => {
        await request(`${API_BASE}/${gistId}`, { method: 'DELETE' }, token);
        return true;
    }),

    /**
     * List gists owned by the authenticated user.
     */
    list: requireAuth(async (token) => {
        return request(API_BASE, { method: 'GET' }, token);
    })
};

export default gistCrud;
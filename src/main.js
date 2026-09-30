/**
 * XODE Code editor (with highlight.js)
 * @author: rokobuljan@github.com
 * @url https://roxon.hr
 */

import DOMPurify from "dompurify";
import "./css/index.css";
import "./js/splitview.js";
import { closeModals } from "./js/modal.js";
import paneConsole from "./js/console.js";
import { init as initChat } from "./js/chat.js";
import Toast from "./js/toast.js";
import "./js/consoleWarning.js";
import gist, { setToken, getToken, hasToken, clearToken, GistApiError, GIST_PAGE_SIZE, XODE_MANIFEST_FILENAME, createXodeManifestFile, hasXodeManifest, readXodeManifest } from "./js/githubGist.js";
import { bus } from "./js/bus.js";

import { reactive, effect, mount, persist } from "./js/reactive.js";

import { LS, el, els, elNew, download, formatDateTime, params } from "./js/utils.js";
import { initProjectStorage, openProject, listProjects, saveProject, createProject, deleteProject, setLastProjectId, loadProject } from "./js/project.js";
import { Editor } from "./js/editor.js";
import { renderIcons } from "./js/icons.js";
import { isolatePane, isPaneIsolationGesture, isViewPane, paneNameFromModel } from "./js/paneTabs.js";
import { generatePreviewHTML, PREVIEW_SANDBOX } from "./js/preview.js";
import { createProjectShareUrl, decodeSharedPanes, SHAREABLE_PANES } from "./js/sharePanes.js";

renderIcons();

await initProjectStorage();
const initialProject = await openProject();

const lsSettings = LS("xode.settings");
const tabWidth = Number(lsSettings.read("tabWidth") ?? 4);
const editors = {};
const elPreview = el("#preview"); // the iframe
elPreview.setAttribute("sandbox", PREVIEW_SANDBOX);
elPreview.setAttribute("credentialless", "");
elPreview.setAttribute("referrerpolicy", "no-referrer");
elPreview.setAttribute("allow", "");

// Toggle single `pane` or handle all panes depending on project panes state
const handlePanes = () => {
    const allTabsCheckboxes = els("#top .view-tabs [data-rea-model]");
    const openedTabs = [...allTabsCheckboxes].reduce((acc, elTabCkb) => {
        const pane = paneNameFromModel(elTabCkb.dataset.reaModel);
        if (elTabCkb.checked && isViewPane(pane)) acc.push(pane);
        return acc;
    }, []);
    // Toggle top tab if only preview is active
    el("#top").classList.toggle("is-detached", openedTabs.length === 1 && openedTabs[0] === "preview");
};

function loadProjectInto(target, source) {
    Object.keys(target).forEach((k) => {
        if (!(k in source)) delete target[k];
    });
    Object.assign(target, source);
}

const projectInit = async (isNew = true, id) => {
    const project = isNew ? await createProject({ panes: currentProjectState.panes }) : await openProject(id);

    loadProjectInto(currentProjectState, project); // ← mutate, don't replace
    setLastProjectId(currentProjectState.id);

    handlePanes();
    [editors.html, editors.css, editors.js].forEach((editor) => {
        editor.resetHistory(editor.elTextarea.value);
        editor.highlight();
    });
    paneConsole.clear();

    if (currentProjectState.gistId) params.set("g", currentProjectState.gistId);
    else params.delete("g");

    previewCurrentProject("all");
    updateProjectShareButtons();
    bus.emit("project:changed", { id: currentProjectState.id });
};

let previewTimeoutId;
const previewCurrentProject = (pane = "all", isForce = false) => {
    // If richEditor and iframe have focus - do NOT preview changes (prevent infinite editing loop)
    if (currentProjectState.panes.richEditor && document.activeElement === elPreview) {
        return;
    }

    let previewTask = null;
    if (isForce || (["all", "js", "html"].includes(pane) && currentProjectState.isAutorun)) {
        previewTask = () => (elPreview.srcdoc = generatePreviewHTML(currentProjectState));
    } else if (pane === "all" && !currentProjectState.isAutorun) {
        previewTask = () => (elPreview.srcdoc = generatePreviewHTML({ ...currentProjectState, js: "", html: DOMPurify.sanitize(currentProjectState.html) }));
    } else if (pane === "css") {
        previewTask = () => elPreview.contentWindow.postMessage({ type: "action", args: ["patchCSS", currentProjectState.css] }, "*");
    } else if (pane === "html") {
        previewTask = () => elPreview.contentWindow.postMessage({ type: "action", args: ["patchHTML", DOMPurify.sanitize(currentProjectState.html)] }, "*");
    }

    clearTimeout(previewTimeoutId);
    previewTimeoutId = setTimeout(
        () => {
            previewTask?.();
        },
        pane === "css" ? 250 : 320,
    );
};

// Rich Editor --to--> HTML
addEventListener("message", async (evt) => {
    if (evt.source !== elPreview.contentWindow || !evt.data || typeof evt.data.type !== "string") return;

    if (evt.data.type === "content-changed") {
        if (!currentProjectState.panes.richEditor || typeof evt.data.html !== "string") return;
        const body = new DOMParser().parseFromString(evt.data.html, "text/html").body;
        body.querySelector("#◆xode-js")?.remove();
        const html = (body.innerHTML.trim() ?? "").replace(/^<br ?\/?>$/, "");
        editors.html.setValue(html, { history: false, origin: "external" });
        currentProjectState.html = html; // Update with new value + save project
        // Reset focus back into Iframe
    }
    // Console messages
    else if (evt.data.type.startsWith("console:")) {
        if (evt.data.type === "console:clear") {
            paneConsole.clear();
            paneConsole.print({ ...evt.data, args: ["Console cleared"] });
        } else {
            paneConsole.print(evt.data);
        }
    }
});

const elProjectsList = el("#projects-list");
const elProjectsMore = el("#projects-more");
const elProjectDeleteDialog = el("#project-delete-dialog");
const elProjectDeleteTitle = el("#project-delete-title");
const elProjectDeleteDescription = el("#project-delete-description");
const elProjectDeleteGistNote = el('[data-delete-element="gist-note"]', elProjectDeleteDialog);
const elProjectDeleteStatus = el('[data-delete-element="status"]', elProjectDeleteDialog);
const elProjectDeleteLocal = el('[data-delete-action="local"]', elProjectDeleteDialog);
const elProjectDeleteGist = el('[data-delete-action="gist"]', elProjectDeleteDialog);
const elProjectShareDialog = el("#project-share-dialog");
const elProjectShareStatus = el('[data-share-element="status"]', elProjectShareDialog);
const elProjectShareUrl = el('[data-share-element="url"]', elProjectShareDialog);
const elProjectShareCopy = el('[data-share-action="copy"]', elProjectShareDialog);
const elProjectShareButton = el('[data-share-action="share"]', elProjectShareDialog);
const elProjectShareInputs = els('.pane-options input[type="checkbox"]', elProjectShareDialog);
let pendingProjectDeletion = null;
let isProjectDeleteBusy = false;
const PROJECTS_PAGE_SIZE = 30;
let visibleProjectCount = PROJECTS_PAGE_SIZE;
let projectSearch = "";

const setProjectDeleteBusy = (isBusy) => {
    isProjectDeleteBusy = isBusy;
    els("button", elProjectDeleteDialog).forEach((button) => {
        button.disabled = isBusy;
    });
    if (!isBusy) elProjectDeleteGist.disabled = !pendingProjectDeletion?.gistId || !hasToken();
};

const openProjectDeleteDialog = (project) => {
    pendingProjectDeletion = {
        id: String(project.id),
        gistId: project.gistId ? String(project.gistId) : null,
        name: String(project.name || "Untitled"),
    };

    const hasGist = Boolean(pendingProjectDeletion.gistId);
    const canDeleteGist = hasGist && hasToken();
    elProjectDeleteTitle.textContent = `Delete “${pendingProjectDeletion.name}”?`;
    elProjectDeleteDescription.textContent = "This permanently deletes the project data stored in this browser.";
    elProjectDeleteGist.hidden = !hasGist;
    elProjectDeleteGist.disabled = !canDeleteGist;
    elProjectDeleteGist.title = canDeleteGist ? "Delete the local project and its GitHub Gist" : "Connect GitHub to delete the linked Gist";
    elProjectDeleteGistNote.hidden = !hasGist;
    elProjectDeleteGistNote.textContent = canDeleteGist ? "This project is linked to a GitHub Gist. Deleting the Gist cannot be undone." : "The linked Gist will remain on GitHub because no GitHub token is connected.";
    elProjectDeleteStatus.textContent = "";
    setProjectDeleteBusy(false);
    elProjectDeleteDialog.showModal();
};

const deleteLocalProject = async (project) => {
    const wasActiveProject = String(currentProjectState.id) === project.id;
    await deleteProject(project.id);
    bus.emit("project:deleted", { id: project.id });

    if (wasActiveProject) {
        params.delete("g");
        const [firstProject] = await listProjects();
        if (firstProject) await projectInit(false, firstProject.id);
        else await projectInit();
    }

    await drawProjects();
};

const confirmProjectDeletion = async (deleteGist) => {
    const project = pendingProjectDeletion;
    if (!project || (deleteGist && !project.gistId)) return;

    setProjectDeleteBusy(true);
    elProjectDeleteStatus.textContent = deleteGist ? "Deleting GitHub Gist…" : "Deleting local project…";
    let gistWasDeleted = false;

    try {
        if (deleteGist) {
            await gist.delete(project.gistId);
            gistWasDeleted = true;
            elProjectDeleteStatus.textContent = "Gist deleted. Removing local project…";
        }
        await deleteLocalProject(project);
        pendingProjectDeletion = null;
        elProjectDeleteDialog.close("deleted");
    } catch (error) {
        elProjectDeleteStatus.textContent = gistWasDeleted ? `The Gist was deleted, but the local project could not be removed: ${error.message}` : `Nothing was deleted locally: ${error.message}`;
        setProjectDeleteBusy(false);
    }
};

elProjectDeleteLocal.addEventListener("click", () => void confirmProjectDeletion(false));
elProjectDeleteGist.addEventListener("click", () => void confirmProjectDeletion(true));
elProjectDeleteDialog.addEventListener("close", () => {
    isProjectDeleteBusy = false;
    pendingProjectDeletion = null;
    elProjectDeleteStatus.textContent = "";
});
elProjectDeleteDialog.addEventListener("cancel", (event) => {
    if (isProjectDeleteBusy) event.preventDefault();
});
elProjectDeleteDialog.addEventListener("click", (event) => {
    if (!isProjectDeleteBusy && event.target === elProjectDeleteDialog) elProjectDeleteDialog.close("cancel");
});

let drawProjectsSequence = 0;
const drawProjects = async ({ reset = false } = {}) => {
    if (reset) visibleProjectCount = PROJECTS_PAGE_SIZE;
    const sequence = ++drawProjectsSequence;
    const projectSummaries = await listProjects();
    const filteredSummaries = projectSummaries.filter((project) => {
        const full = `${project.name ?? ""} ${project.description ?? ""} ${project.id} ${new Date(project.updatedAt).toLocaleString()}`;
        return full.toLowerCase().includes(projectSearch);
    });
    const visibleSummaries = filteredSummaries.slice(0, visibleProjectCount);
    const projects = (await Promise.all(visibleSummaries.map(({ id }) => loadProject(id)))).filter(Boolean);
    if (sequence !== drawProjectsSequence) return;

    elProjectsList.innerHTML = "";
    elProjectsMore.hidden = visibleSummaries.length >= filteredSummaries.length;
    const remainingProjects = Math.max(0, filteredSummaries.length - visibleSummaries.length);
    el("span", elProjectsMore).textContent = `Load ${Math.min(PROJECTS_PAGE_SIZE, remainingProjects)} more project${remainingProjects === 1 ? "" : "s"}`;
    projects.forEach((projectData) => {
        const title = `${projectData.name} ${projectData.description ? " — " + projectData.description : ""} | ${formatDateTime(projectData.updatedAt)}`;
        const elThumbnail = elNew("div", { className: "preview", title });
        // elThumbnail.dataset.modal = "";
        projectData.html =
            `
            <script>
            // XODE-injected: suppress ALL console output + uncaught errors from bubbling to DevTools
            const methods = ['log', 'warn', 'error', 'info', 'debug'];
            methods.forEach(method => {
                if (window.console && window.console[method]) window.console[method] = function () {};
            });

            // Suppress uncaught runtime errors (syntax errors, thrown exceptions, missing brackets, etc.)
            window.onerror = function () { return true; }; // returning true prevents default browser logging

            // Suppress unhandled promise rejections
            window.addEventListener('unhandledrejection', function (e) {
                e.preventDefault();
            });
            </script>
            ` + projectData.html;
        const elThumbnailIframe = elNew("iframe", {
            srcdoc: generatePreviewHTML(projectData, "preview"),
            sandbox: PREVIEW_SANDBOX,
            credentialless: true,
            referrerPolicy: "no-referrer",
            allow: "",
            loading: "lazy",
            scrolling: "no",
        });

        elThumbnail.append(elThumbnailIframe);
        const gistLinkHTML = projectData.gistId ? `<a href="https://gist.github.com/${projectData.gistId}" target="_blank" rel="noopener noreferrer" title="External GitHub Gist"><i data-lucide="github"></i></a>` : "";
        const elProject = elNew("div", {
            id: `project-${projectData.id}`,
            className: "project-card",
            innerHTML: `<div class="meta">
                <span class="name"></span>
                <span class="actions">
                    ${gistLinkHTML}
                    ${projectData.gistId ? `<button data-share-id="${projectData.id}" type="button" title="Share published project"><i data-lucide="share-2"></i></button>` : ""}
                    <button data-download-id="${projectData.id}" type="button" title="Download"><i data-lucide="download"></i></button>
                    <button data-delete-id="${projectData.id}" type="button" title="Delete"><i data-lucide="trash-2"></i></button>
                </span>
            </div>`,
        });
        renderIcons(elProject);
        const elName = el(".name", elProject);
        elName.textContent = projectData.name; // safe — no HTML parsing
        elName.title = title; // safe — DOM property, not string-parsed
        elProject.prepend(elThumbnail);
        elThumbnail.tabIndex = 0;
        elThumbnail.setAttribute("role", "button");
        elThumbnail.setAttribute("aria-label", `Open ${projectData.name || "Untitled"}`);

        el(`[data-delete-id]`, elProject).addEventListener("click", () => openProjectDeleteDialog(projectData));

        el(`[data-download-id]`, elProject).addEventListener("click", () => {
            void downloadProject(projectData.id);
        });

        el(`[data-share-id]`, elProject)?.addEventListener("click", () => {
            openProjectShareDialog(projectData);
        });

        const activateProject = () => {
            closeModals();
            void projectInit(false, projectData.id);
        };
        elProject.addEventListener("click", (event) => {
            if (!event.target.closest(".actions")) activateProject();
        });
        elThumbnail.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateProject();
            }
        });

        elProjectsList.append(elProject);
    });
};

// Search projects
const elProjectsSearch = el("#projects-search");
elProjectsSearch.addEventListener("input", () => {
    projectSearch = elProjectsSearch.value.trim().toLowerCase();
    void drawProjects({ reset: true });
});
elProjectsMore.addEventListener("click", () => {
    visibleProjectCount += PROJECTS_PAGE_SIZE;
    void drawProjects();
});

// EVENTS

// RUN --> Preview
const elRun = el("#run");
elRun.addEventListener("click", () => previewCurrentProject("all", true));

// Download project by ID
const downloadProject = async (id) => {
    const project = await loadProject(id);
    if (!project) return;
    const projectName = project.name.trim() ? project.name.trim().replace(/\W/g, "-") : "untitled";
    download(generatePreviewHTML(project, "download"), `${projectName.toLowerCase()}.xode.html`);
};

// Download current project
els('[data-project-action="download-current"]').forEach((elBtnDownload) => {
    elBtnDownload.addEventListener("click", () => void downloadProject(currentProjectState.id));
});

const updateProjectShareButtons = () => {
    const isPublished = Boolean(currentProjectState.gistId);
    els('[data-project-action="share-current"]').forEach((button) => {
        button.disabled = !isPublished;
        button.title = isPublished ? "Share published project" : "Publish this project before sharing";
    });
};

const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }

    const textarea = elNew("textarea", { value });
    textarea.setAttribute("readonly", "");
    textarea.className = "sr-only";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy is not available in this browser");
};

async function shareProject(project, panes) {
    if (!project.gistId) return;

    const url = createProjectShareUrl(window.location.href, project.gistId, panes);
    const shareData = {
        title: project.name?.trim() || "Untitled XODE project",
        text: project.description?.trim() || "Open this XODE project",
        url,
    };

    if (navigator.share) {
        try {
            await navigator.share(shareData);
            return true;
        } catch (error) {
            if (error.name === "AbortError") return false;
        }
    }

    try {
        await copyText(url);
        new Toast({ head: "Share link copied", body: "Anyone with this link can open the published project.", type: "success", time: 3000 });
        return true;
    } catch (error) {
        new Toast({ head: "Could not copy link", body: error.message, type: "error", time: 0 });
        return false;
    }
}

let pendingProjectShare = null;

const selectedSharePanes = () => Object.fromEntries(SHAREABLE_PANES.map(({ name }) => [name, [...elProjectShareInputs].some((input) => input.value === name && input.checked)]));

const updateProjectShareDialog = () => {
    const hasSelection = [...elProjectShareInputs].some((input) => input.checked);
    elProjectShareUrl.value = hasSelection && pendingProjectShare ? createProjectShareUrl(window.location.href, pendingProjectShare.gistId, selectedSharePanes()) : "";
    elProjectShareCopy.disabled = !hasSelection;
    elProjectShareButton.disabled = !hasSelection;
    delete elProjectShareStatus.dataset.type;
    elProjectShareStatus.textContent = hasSelection ? "" : "Select at least one pane.";
};

function openProjectShareDialog(project) {
    if (!project.gistId) return;
    pendingProjectShare = project;
    elProjectShareInputs.forEach((input) => {
        input.checked = Boolean(project.panes?.[input.value]);
    });
    updateProjectShareDialog();
    elProjectShareDialog.showModal();
}

elProjectShareInputs.forEach((input) => input.addEventListener("change", updateProjectShareDialog));
elProjectShareUrl.addEventListener("click", () => elProjectShareUrl.select());
elProjectShareCopy.addEventListener("click", async () => {
    try {
        await copyText(elProjectShareUrl.value);
        elProjectShareStatus.dataset.type = "success";
        elProjectShareStatus.textContent = "Link copied to clipboard!";
    } catch (error) {
        delete elProjectShareStatus.dataset.type;
        elProjectShareStatus.textContent = `Could not copy link: ${error.message}`;
    }
});
elProjectShareButton.addEventListener("click", async () => {
    if (!pendingProjectShare || elProjectShareButton.disabled) return;
    elProjectShareButton.disabled = true;
    if (await shareProject(pendingProjectShare, selectedSharePanes())) elProjectShareDialog.close("shared");
    else updateProjectShareDialog();
});
elProjectShareDialog.addEventListener("close", () => {
    pendingProjectShare = null;
    delete elProjectShareStatus.dataset.type;
    elProjectShareStatus.textContent = "";
});
elProjectShareDialog.addEventListener("click", (event) => {
    if (event.target === elProjectShareDialog) elProjectShareDialog.close("cancel");
});

els('[data-project-action="share-current"]').forEach((button) => {
    button.addEventListener("click", () => openProjectShareDialog(currentProjectState));
});

// Editor exec commander for richEditor mode (text editing buttons)
addEventListener("click", (evt) => {
    const elBtnCmd = evt.target.closest("[data-cmd]");
    if (!elBtnCmd) return;
    elPreview.contentWindow.postMessage(
        {
            type: "cmd",
            args: [elBtnCmd.dataset.cmd, elBtnCmd.dataset.par],
        },
        "*",
    );
});

// Actions from parent window to #preview iframe
addEventListener("click", (evt) => {
    const elBtnAction = evt.target.closest("[data-action]");
    if (!elBtnAction) return;
    // Else
    const action = elBtnAction.dataset.action;
    const val = elBtnAction.matches("[type=checkbox]") ? elBtnAction.checked : (elBtnAction.value ?? elBtnAction.dataset.val);
    elPreview.contentWindow.postMessage(
        {
            type: "action",
            args: [action, val],
        },
        "*",
    );
    if (action === "designMode") {
        // Toggle rich editor
        currentProjectState.panes.richEditor = elBtnAction.checked;
        void saveProject(currentProjectState);
    }
});

// Activate RTE
elPreview.addEventListener("load", () => {
    elPreview.contentWindow.postMessage(
        {
            type: "action",
            args: ["designMode", currentProjectState.panes.richEditor],
        },
        "*",
    );
});

// NEW PROJECT
el("#project-new").addEventListener("click", async () => {
    await projectInit(); // Create new project
    await drawProjects(); // redraw old ones
});

el("#project-delete").addEventListener("click", () => openProjectDeleteDialog(currentProjectState));

// Apply an AI change through the Editor API so highlighting, preview updates,
// persistence, and the editor's undo stack remain in sync.
bus.on("ai:update", ({ syntax, content }) => {
    if (!editors[syntax] || typeof content !== "string") return;
    editors[syntax].setValue(content, { history: true, origin: "ai" });
});

// GISTS

let token = getToken();

// Save token to localStorage
const elGithubToken = el("#githubToken");
const elGithubTokenDelete = el("#githubTokenDelete");
const elGithubPublish = el("#githubPublish");
const elGithubLoad = el("#githubLoad");
const elGithubLoadId = el("#githubLoadId");
const elGithubFetch = el("#githubFetch");
const elGithubFetchLabel = el("#githubFetchLabel");
let nextGistPage = 1;
let hasMoreGists = true;

const resetGistPagination = () => {
    nextGistPage = 1;
    hasMoreGists = true;
    elGithubFetchLabel.textContent = "Fetch XODE Gists";
};

const updateElGithubToken = () => {
    elGithubToken.value = "";
    if (token) elGithubToken.placeholder = "ENABLED!";
    else elGithubToken.placeholder = "GitHub Token (classic)";
    elGithubTokenDelete.disabled = !token;
    elGithubPublish.disabled = !token;
    elGithubFetch.disabled = !token || !hasMoreGists;
    settingsState.isGithubEnabled = !!token;
    settingsState.isGithubDisabled = !token;
};

elGithubToken.addEventListener("input", (evt) => {
    token = evt.target.value;
    if (token) setToken(token);
    else clearToken();
    resetGistPagination();
    updateElGithubToken();
});
elGithubToken.addEventListener("blur", () => {
    updateElGithubToken();
});
elGithubTokenDelete.addEventListener("click", () => {
    updateElGithubToken();
    elGithubToken.dispatchEvent(new Event("input"));
});

elGithubLoad.addEventListener("click", async () => {
    const gistId = elGithubLoadId.value.trim().match(/[0-9a-f]{32}$/)?.[0];
    if (!gistId) return;
    await gistLoad(gistId);
    elGithubLoadId.value = "";
});

const gistToProject = (data) => {
    const files = { html: "", css: "", js: "" };
    Object.entries(data.files).forEach(([name, file]) => {
        if (name.endsWith(".html")) files.html = file.content;
        else if (name.endsWith(".css")) files.css = file.content;
        else if (name.endsWith(".js")) files.js = file.content;
    });

    const [projName = "Untitled", ...descriptionParts] = (data.description || "Untitled").split(" — ");
    const manifest = readXodeManifest(data);
    return {
        id: data.id,
        gistId: data.id,
        name: projName,
        description: descriptionParts.join(" — "),
        html: files.html,
        css: files.css,
        js: files.js,
        scriptType: manifest?.scriptType === "classic" ? "classic" : "module",
    };
};

const importGist = async (data) => {
    if (await loadProject(data.id)) return false;
    await createProject(gistToProject(data));
    return true;
};

const gistLoad = async (gistId) => {
    const existsLocally = await loadProject(gistId);
    if (!existsLocally) {
        await importGist(await gist.read(gistId));
        await drawProjects();
    }

    await projectInit(false, gistId);
};

elGithubFetch.addEventListener("click", async () => {
    elGithubFetch.disabled = true;

    try {
        const page = nextGistPage;
        const gistPage = await gist.list({ page, perPage: GIST_PAGE_SIZE });
        const remoteGists = gistPage.filter(hasXodeManifest);
        let imported = 0;
        let skipped = 0;
        let failed = 0;

        // Keep concurrent detail requests modest while still making a multi-Gist import responsive.
        for (let offset = 0; offset < remoteGists.length; offset += 4) {
            const batch = remoteGists.slice(offset, offset + 4);
            await Promise.all(
                batch.map(async ({ id }) => {
                    if (await loadProject(id)) {
                        skipped += 1;
                        return;
                    }

                    try {
                        const wasImported = await importGist(await gist.read(id));
                        if (wasImported) imported += 1;
                        else skipped += 1;
                    } catch (error) {
                        failed += 1;
                        console.error(`Could not import Gist ${id}`, error);
                    }
                }),
            );
        }

        if (imported) await drawProjects({ reset: true });

        if (gistPage.length < GIST_PAGE_SIZE) {
            hasMoreGists = false;
            elGithubFetchLabel.textContent = "All Gists fetched";
        } else {
            nextGistPage += 1;
            elGithubFetchLabel.textContent = `Fetch next ${GIST_PAGE_SIZE} Gists`;
        }

        const details = [`${gistPage.length} scanned`, `${imported} imported`];
        if (skipped) details.push(`${skipped} already local`);
        if (failed) details.push(`${failed} failed`);
        new Toast({
            head: remoteGists.length ? "XODE Gists fetched" : "No XODE Gists found",
            body: remoteGists.length ? details.join(", ") : `No Gists containing ${XODE_MANIFEST_FILENAME} were found.`,
            type: failed ? "error" : "success",
            time: failed ? 0 : 4000,
        });
    } catch (error) {
        new Toast({
            head: "Could not fetch Gists",
            body: error.message,
            type: "error",
            time: 0,
        });
    } finally {
        updateElGithubToken();
    }
});

const gistPublish = async (project) => {
    const files = {};
    if (project.html?.trim()) files["index.html"] = { content: project.html };
    if (project.js?.trim()) files["script.js"] = { content: project.js };
    if (project.css?.trim()) files["style.css"] = { content: project.css };
    if (Object.keys(files).length === 0) {
        console.warn("Nothing to publish — all panes are empty");
        return;
    }
    files[XODE_MANIFEST_FILENAME] = createXodeManifestFile(project);
    const projName = project.name?.trim() || "Untitled";
    const projDesc = project.description?.trim() || "";
    const description = `${projName} ${projDesc ? ` — ${projDesc}` : ""}`;

    // PUBLISH - Create
    if (!project.gistId) {
        try {
            const res = await gist.create({ description, files });
            const oldId = project.id;
            project.id = res.id;
            project.gistId = res.id;
            await saveProject(project); // Save a local copy with the new ID
            if (oldId && oldId !== project.id) {
                await deleteProject(oldId);
                bus.emit("project:rekeyed", { oldId, newId: project.id });
            }
            params.set("g", project.gistId);
            updateProjectShareButtons();
            new Toast({
                head: "Published",
                body: `Successfully published to <a href="https://gist.github.com/${project.gistId}" target="_blank" rel="noopener noreferrer">GitHub Gist</a>`,
                type: "success",
                time: 3000,
            });
        } catch (err) {
            new Toast({
                head: "Error",
                type: "error",
                body: `Could not publish: ${err.message}`,
                time: 0,
            });
        }
    }
    // PUBLISH - Update
    else {
        try {
            await gist.update(project.gistId, { description, files });
            new Toast({
                head: "Updated",
                type: "success",
                body: `Successfully updated: <a href="https://gist.github.com/${project.gistId}" target="_blank">${project.name}</a>`,
                time: 3000,
            });
        } catch (err) {
            if (err instanceof GistApiError && err.status === 404) {
                try {
                    const forked = await gist.fork(project.gistId);
                    await gist.update(forked.id, { description, files });
                    const oldId = project.id;
                    project.id = forked.id;
                    project.gistId = forked.id;
                    await saveProject(project);
                    if (oldId && oldId !== project.id) {
                        await deleteProject(oldId);
                        bus.emit("project:rekeyed", { oldId, newId: project.id });
                    }
                    params.set("g", project.gistId);
                    updateProjectShareButtons();
                    new Toast({
                        head: "Forked",
                        type: "success",
                        body: `This gist belonged to another user. A fork was created: <a href="https://gist.github.com/${project.gistId}" target="_blank">${project.name}</a>`,
                        time: 4000,
                    });
                } catch (forkErr) {
                    new Toast({
                        head: "Error",
                        type: "error",
                        body: `Could not fork gist: ${forkErr.message}`,
                        time: 3000,
                    });
                }
            } else {
                new Toast({
                    head: "Error",
                    type: "error",
                    body: `Could not publish ${project.name}: ${err.message}`,
                    time: 3000,
                });
            }
        }
    }
    await drawProjects();
};

elGithubPublish.addEventListener("click", () => {
    void gistPublish(currentProjectState);
});

// Tab width - Change indentation spaces for code format (prettier)
const elTabWidth = el("#tabWidth");
elTabWidth.addEventListener("input", () => {
    lsSettings.update({ tabWidth: elTabWidth.value });
});
elTabWidth.value = tabWidth;

// Tabs UI - Single pane toggle
const elTabs = el("#top .view-tabs");
elTabs.addEventListener("click", (evt) => {
    const elTab = evt.target.closest(".view-toggle");
    if (!elTab) return;
    if (params.get("p") !== undefined) params.delete("p");
    const elTabCheckbox = el("[data-rea-model]", elTab);
    const pane = paneNameFromModel(elTabCheckbox?.dataset.reaModel);
    if (!isPaneIsolationGesture(evt, pane)) return;
    evt.preventDefault();
    isolatePane(currentProjectState.panes, pane);
});

// One-time call to watch changes in editors
function watchEditors(project, editors, previewCurrentProject) {
    ["html", "css", "js"].forEach((prop) => {
        effect(() => {
            void project[prop]; // read → this effect now depends ONLY on `prop`
            editors[prop]?.highlight();
            previewCurrentProject(prop);
        });
    });
}
function watchScriptType(project, previewCurrentProject) {
    effect(() => {
        void project.scriptType;
        previewCurrentProject("all");
    });
}
// One-time call to watch panes (toggle panes)
function watchPanes(project, handlePanes) {
    Object.keys(project.panes).forEach((pane) => {
        effect(() => {
            void project.panes[pane];
            handlePanes(pane);
        });
    });
}

// INIT
editors.html = new Editor(el("#editor-html"), { syntax: "html" });
editors.css = new Editor(el("#editor-css"), { syntax: "css" });
editors.js = new Editor(el("#editor-js"), { syntax: "js" });
paneConsole.init();

// app boot — runs exactly once
const currentProjectState = reactive(initialProject); // Open latest Project
mount(currentProjectState, "project"); // Mount project to DOM and bind events
watchEditors(currentProjectState, editors, previewCurrentProject);
watchScriptType(currentProjectState, previewCurrentProject);
watchPanes(currentProjectState, handlePanes);

// App settings
const settingsState = reactive({
    isGithubEnabled: hasToken(),
    isGithubDisabled: !hasToken(),
});
mount(settingsState, "settings");
persist(settingsState, (data) => lsSettings.update(data)); // Persist changes to app settings
updateElGithubToken();

if (params.get("g")) {
    await gistLoad(params.get("g")); // Load Gist Project
} else {
    await projectInit(false); // Load latest Project
}
const sharedPanes = decodeSharedPanes(params.get("p"));
if (sharedPanes) Object.assign(currentProjectState.panes, sharedPanes);
persist(currentProjectState, saveProject, 300); // Persist changes to project every 300ms
await drawProjects();

// Initialize the serverless AI assistant. Conversations and optional encrypted
// API keys are stored in IndexedDB by the chat module.
await initChat({
    editors,
    getProjectId: () => currentProjectState.id,
    getConsoleContext: () => paneConsole.getRecentOutput(),
    hasConsoleErrors: () => paneConsole.hasErrors(),
});

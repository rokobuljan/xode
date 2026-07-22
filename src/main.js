/**
 * XODE Code editor (with highlight.js)
 * @author: rokobuljan@github.com
 * @url https://roxon.hr
 */

import DOMPurify from 'dompurify';
import "./css/index.css";
import "./js/splitview.js";
import "./js/modal.js";
import "./js/chat.js";
import "./js/consoleWarning.js";
import gist, { setToken, getToken, clearToken } from "./js/githubGist.js";
import { bus } from './js/bus.js';
import Rx from "./js/Rx.js";
import { el, els, elNew, download, formatDateTime, params, LS, debounce } from "./js/utils.js";
import { openProject, listProjects, saveProject, createProject, deleteProject, setLastProjectId, loadProject } from './js/project.js';
import { Editor } from "./js/editor.js";

const lsSettings = LS("xode.settings");
const tabWidth = lsSettings.read("tabWidth") || 4;
const editors = {};
const elPreview = el("#preview"); // the iframe

let currentProject = {};

const paneConsole = {
    init() {
        this.el = el(`[data-view="console"] .console`);
        this.elBtnClear = el(`[data-view="console"] .console-clear`);
        this.elBtnClear.addEventListener("click", () => this.clear());
    },
    print({ type, args, line }) {
        const logType = type.split(":")[1] || "log";
        const elBlock = elNew("code", {
            className: `log ${logType}`,
            textContent: args.join("\n").trimStart(),
        });
        const elLine = elNew("span", {
            className: "log-line",
            textContent: line,
        });
        elBlock.append(elLine);
        this.el.append(elBlock);
    },
    clear() {
        this.el.innerHTML = "";
    }
};

const rxHandler = ({ detail }) => {
    // SAVE PROJECT if edited:
    if (/^(name|description|isAutorun)$/.test(detail.prop)) {
        if (detail.oldValue !== detail.value) {
            saveProject(currentProject);
        }
    }
    // Editors "input" event (via data-rx): save project data
    else if (["html", "js", "css"].includes(detail.prop)) {
        if (detail.oldValue !== detail.value) {
            editors[detail.prop]?.highlight();
            previewCurrentProject(detail.prop); // Update changes in iframe
            saveProject(currentProject);
        }
    }
    // Save panes toggle changes
    else if (detail.prop.startsWith("panes.")) {
        if (detail.oldValue !== detail.value) {
            saveProject(currentProject);
        }
    }
};

const projectInit = (isNew = true, id) => {
    const project = isNew ?
        // new? Create new project with the currently open panes
        createProject({ panes: currentProject.panes }) :
        // old: Open latest project or a specific one (by ID)
        openProject(id);

    currentProject = new Rx(project, {}).on("rx:change", rxHandler).state;

    setLastProjectId(currentProject.id); // Remember last opened project

    //  Update UI: Toggle open/close panes
    els("[data-view]").forEach((elView) => {
        const isOpen = currentProject.panes[elView.dataset.view];
        if (typeof isOpen === "boolean") {
            elView.dataset.open = isOpen;
        }
    });

    // Force-clear editors highlight
    ["html", "css", "js"].forEach(syntax => editors[syntax]?.highlight());
    paneConsole.clear();

    // Update URI param if is Gist or not
    if (currentProject.gistId) {
        params.set("g", currentProject.gistId);
    } else {
        params.delete("g");
    }

    // Preview the project
    previewCurrentProject("all");
};


/**
 * Construct HTML page output for preview, download, or iframe "thumbnails"
 * @param {boolean} isApp DDiffferentiate whilst in-app vs downloaded document
 */
const generatePreviewHTML = (project, isApp = true) => {
    const injectScript = /*html*/`<script id="◆xode-inject" src="inject.js?t=${Date.now()}"></script>`;
    // Prevent user's <script> tags if autorun is disables
    return /*html*/`<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${project.name}</title>
        <style${isApp ? ' id="◆xode-css"' : ''}>${project.css}</style>
        ${isApp ? injectScript : ""}
    </head>
    <body${isApp ? ' id="◆xode-html" spellcheck="false"' : ''}>
        ${project.html}
        <script${isApp ? ' id="◆xode-js"' : ''} type="module">${project.js}${isApp ? "//# sourceURL=js" : ""}</script>
    </body>
    </html>`;
};

let previewTimeoutId;
const previewCurrentProject = (pane = "all", isForce = false) => {
    // If richEditor and iframe have focus - do NOT preview changes (prevent infinite editing loop)
    if (currentProject.panes.richEditor && document.activeElement === elPreview) {
        return;
    }

    let previewTask = null;
    if (isForce || (["all", "js", "html"].includes(pane) && currentProject.isAutorun)) {
        previewTask = () => elPreview.srcdoc = generatePreviewHTML(currentProject);
    } else if (pane === "all" && !currentProject.isAutorun) {
        previewTask = () => elPreview.srcdoc = generatePreviewHTML({ ...currentProject, js: "", html: DOMPurify.sanitize(currentProject.html) });
    } else if (pane === "css") {
        previewTask = () => elPreview.contentWindow.postMessage({ type: "action", args: ["patchCSS", currentProject.css] }, "*");
    } else if (pane === "html") {
        previewTask = () => elPreview.contentWindow.postMessage({ type: "action", args: ["patchHTML", DOMPurify.sanitize(currentProject.html)] }, "*");
    }

    clearTimeout(previewTimeoutId);
    previewTimeoutId = setTimeout(() => {
        previewTask?.();
    }, pane === "css" ? 250 : 320);
};

// Rich Editor --to--> HTML
addEventListener("message", async (evt) => {
    if (evt.data.type === "content-changed") {
        const body = new DOMParser().parseFromString(evt.data.html, "text/html").body;
        body.querySelector("#◆xode-js")?.remove();
        const html = (body.innerHTML.trim() ?? "").replace(/^<br ?\/?>$/, "");
        editors.html.setValue(html, { history: false, origin: "external" });
        currentProject.html = html; // Update with new value + save project
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
const drawProjects = () => {
    elProjectsList.innerHTML = "";
    listProjects().forEach((project) => {
        const projectData = openProject(project.id);
        const title = `${projectData.name} ${projectData.description ? " — " + projectData.description : ""} | ${formatDateTime(projectData.updatedAt)}`;
        const elThumbnail = elNew("div", { className: "thumbnail", title });
        elThumbnail.dataset.modal = "";
        projectData.html = `
            <script>// XODE-injected: Silence, suppress some console methods for thumbnails
            const methods = ['log', 'warn', 'error', 'info', 'debug'];
            methods.forEach(method => {
                if (window.console && window.console[method]) window.console[method] = function () {};
            });</script>
        ` + projectData.html;
        const elThumbnailIframe = elNew("iframe", {
            className: "iframe-thumbnail",
            srcdoc: generatePreviewHTML(projectData, false),
            sandbox: "allow-scripts", // allow-scripts, allow-same-origin
            loading: "lazy",
            scrolling: "no"
        });

        elThumbnail.append(elThumbnailIframe);
        const gistLinkHTML = projectData.gistId ? `<a href="https://gist.github.com/${projectData.gistId}" target="_blank" rel="noopener noreferrer" title="External Github Gist"><span class="icon" data-name="github-logo">&#xf772;</span></a>` : "";
        const elProject = elNew("div", {
            id: `project-${projectData.id}`,
            className: "project",
            innerHTML: `<div class="bar">
                <span class="project-name" title="${title}">${projectData.name}</span>
                <br>
                <span class="project-actions">
                    ${gistLinkHTML}
                    <button data-download-id="${projectData.id}" type="button" title="Download"><span class="icon" data-name="download">&#xf3b7;</span></button>
                    <button data-delete-id="${projectData.id}" type="button" title="Delete"><span class="icon" data-name="trash">&#xf202;</span></button>
                </span>
            </div>`
        });
        elProject.prepend(elThumbnail);

        el(`[data-delete-id]`, elProject).addEventListener("click", () => {
            if (confirm(`Delete project: "${projectData.name}"?`)) {
                requestAnimationFrame(() => {
                    el(`#project-${projectData.id}`).remove();
                    const isActiveProject = currentProject.id === projectData.id;
                    if (isActiveProject) {
                        params.delete("g"); // Remove from URI params to load load again the same project from GitHub gists
                        const firstProject = listProjects()[0];
                        if (firstProject) {
                            projectInit(false, firstProject.id);
                        } else {
                            projectInit(); // init a new empty project
                        }
                    }
                    deleteProject(projectData.id);
                });
            }
        }, { capture: true });
        el(`[data-download-id]`, elProject).addEventListener("click", () => {
            downloadProject(projectData.id);
        });
        // Close modal on iframe click:
        elThumbnail.addEventListener("click", () => {
            projectInit(false, projectData.id);
        });
        elProjectsList.append(elProject);
    });
};

// Search projects
const elProjectsSearch = el("#projects-search");
elProjectsSearch.addEventListener("input", () => {
    const search = elProjectsSearch.value.trim().toLowerCase();
    const elsProjects = els(".project", elProjectsList);
    const projectsListId = listProjects().reduce((acc, proj) => (acc[proj.id] = proj, acc), {});
    elsProjects.forEach((elProject) => {
        const elId = elProject.id.replace("project-", "");
        const project = projectsListId[elId];
        const full = `${project.name.trim()} ${project.description.trim()} ${project.id} ${new Date(project.updatedAt).toLocaleString()}`;
        const matchName = full.toLowerCase().includes(search);
        elProject.classList.toggle("is-hidden", !matchName);
    });
});

// EVENTS

// RUN --> Preview
const elRun = el("#run");
elRun.addEventListener("click", () => previewCurrentProject("all", true));

// Download project by ID
const downloadProject = (id) => {
    const project = openProject(id);
    const projectName = project.name.trim() ? project.name.trim().replace(/\W/g, "-") : "untitled";
    download(generatePreviewHTML(project, false), `${projectName.toLowerCase()}.xode.html`);
};

// Download current project
el("#download").addEventListener("click", () => {
    downloadProject(currentProject.id);
});

// Editor exec commander for richEditor mode (text editing buttons)
addEventListener("click", (evt) => {
    const elBtnCmd = evt.target.closest("[data-cmd]");
    if (!elBtnCmd) return;
    elPreview.contentWindow.postMessage({
        type: "cmd",
        args: [elBtnCmd.dataset.cmd, elBtnCmd.dataset.par]
    }, "*");
});

// Actions from parent window to #preview iframe
addEventListener("click", (evt) => {
    const elBtnAction = evt.target.closest("[data-action]");
    if (!elBtnAction) return;
    // Else
    const action = elBtnAction.dataset.action;
    const val = elBtnAction.matches("[type=checkbox]") ?
        elBtnAction.checked :
        elBtnAction.value ?? elBtnAction.dataset.val;
    elPreview.contentWindow.postMessage({
        type: "action",
        args: [action, val]
    }, "*");
    if (action === "designMode") {
        // Toggle rich editor
        currentProject.panes.richEditor = elBtnAction.checked;
        saveProject(currentProject);
    }
});

// Activate RTE
elPreview.addEventListener('load', () => {
    elPreview.contentWindow.postMessage({
        type: "action",
        args: ["designMode", currentProject.panes.richEditor]
    }, "*");
});

// NEW PROJECT
el("#project-new").addEventListener("click", () => {
    projectInit(); // Create new project
    drawProjects(); // redraw old ones
});

// Update html from AI
bus.on('ai:update', ({ syntax, content }) => {
    currentProject[syntax] = content; // Update and save
});

// === GISTS =============================

let token = getToken();

// Save token to localStorage
const elGithubToken = el("#githubToken");
const elGithubTokenDelete = el("#githubTokenDelete");
const elGithubPublish = el("#githubPublish");
const elGithubLoad = el("#githubLoad");
const elGithubLoadId = el("#githubLoadId");

const updateElGithubToken = () => {
    elGithubToken.value = "";
    if (token) elGithubToken.placeholder = "ENABLED!";
    else elGithubToken.placeholder = "GitHub Token (classic)";
    elGithubTokenDelete.disabled = !token;
    elGithubPublish.disabled = !token;
};
updateElGithubToken();
elGithubToken.addEventListener("input", (evt) => {
    token = evt.target.value;
    if (token) setToken(token);
    else clearToken();
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
    const gistId = elGithubLoadId.value;
    if (!gistId) return;
    await gistLoad(gistId);
    elGithubLoadId.value = "";
});

const gistLoad = async (gistId) => {
    const existsLocally = loadProject(gistId);
    if (!existsLocally) {
        const data = await gist.read(gistId);
        const files = { html: "", css: "", js: "" };
        Object.entries(data.files).forEach(([name, file]) => {
            if (name.endsWith(".html")) files.html = file.content;
            else if (name.endsWith(".css")) files.css = file.content;
            else if (name.endsWith(".js")) files.js = file.content;
        });
        const [projName, projDesc] = data.description.split(" — ");
        const newProjectData = {
            id: gistId,
            gistId,
            name: projName,
            description: `${projDesc || ""}`,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
            html: files.html,
            css: files.css,
            js: files.js,
        };
        const project = createProject(newProjectData);
        saveProject(project);
        drawProjects();
    }

    projectInit(false, gistId);
};

const gistPublish = async (project) => {
    const files = {};
    if (project.html?.trim()) files['index.html'] = { content: project.html };
    if (project.js?.trim()) files['script.js'] = { content: project.js };
    if (project.css?.trim()) files['style.css'] = { content: project.css };
    if (Object.keys(files).length === 0) {
        console.warn('Nothing to publish — all panes are empty');
        return;
    }
    const projName = project.name?.trim() || "Untitled";
    const projDesc = project.description?.trim() || "";
    const description = `${projName} ${projDesc ? ` — ${projDesc}` : ""}`;

    // PUBLISH - Create
    if (!project.gistId) {
        const res = await gist.create({ description, files });
        project.id = res.id;
        project.gistId = res.id;
        saveProject(project); // Save a local copy with the new ID
    }
    // PUBLISH - Update
    else {
        await gist.update(project.gistId, { description, files });
    }
    drawProjects();
};

elGithubPublish.addEventListener("click", () => {
    void gistPublish(currentProject);
});

// Tab width - Change indentation spaces for code format (prettier)
const elTabWidth = el("#tabWidth");
elTabWidth.addEventListener("input", () => {
    lsSettings.update({ tabWidth: elTabWidth.value });
});
elTabWidth.value = tabWidth;

// // Tabs UI - Single pane toggle
// const elTabs = el("#top .tabs");
// const elsTabs = els("[data-rx]", elTabs);
// elTabs.addEventListener("click", (evt) => {
//     const elTab = evt.target.closest(`.tab`);
//     if (!elTab) return;
//     const elTabCheckbox = el("[data-rx]", elTab);
//     if (!evt.ctrlKey || !elTabCheckbox) return;
//     // evt.preventDefault();
//     elsTabs.forEach((elTab) => {
//         const pane = elTab.dataset.rx;
//         const isTarget = pane === elTabCheckbox.dataset.rx;
//         const syntax = pane.split("panes.")[1];
//         elTab.checked = isTarget
//         currentProject.panes[syntax] = isTarget;
//     });
// });


// One-time call to generate UI panes
const generateEditors = () => {
    editors.html = new Editor(el("#editor-html"), { syntax: "html" });
    editors.css = new Editor(el("#editor-css"), { syntax: "css" });
    editors.js = new Editor(el("#editor-js"), { syntax: "js" });
    paneConsole.init();
};

// INIT
generateEditors();
if (params.get("g")) {
    void gistLoad(params.get("g")); // Load Gist Project
} else {
    projectInit(false); // Load latest Project
}
drawProjects();

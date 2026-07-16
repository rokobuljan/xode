/**
 * XODE Code editor (with highlight.js)
 * @author: rokobuljan@github.com
 * @url https://roxon.hr
 */

import "./css/index.css";
import "./js/splitview.js";
import "./js/modal.js";
import "./js/chat.js";
import "./js/consoleWarning.js";
import gist, { setToken, getToken, clearToken, hasToken } from "./js/githubGist.js";
import { bus } from './js/bus.js';
import Rx from "./js/Rx.js";
import { el, els, elNew, download, formatDateTime, params } from "./js/utils.js";
import { openProject, listProjects, saveProject, createProject, deleteProject, setLastProjectId, loadProject } from './js/project.js';
import { Editor } from "./js/editor.js";


const panes = {};
const elPreview = el("#preview"); // the iframe
const elAutorun = el("#autorun");
const elRun = el("#run");
let currentProject = {};
let previewTimeout;

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
    if (/^(name|description)$/.test(detail.prop)) {
        if (detail.oldValue !== detail.value) {
            saveProject(currentProject);
        }
    }
    else if (/^(html|css|js)$/.test(detail.prop)) {
        if (detail.oldValue !== detail.value) {
            panes[detail.prop]?.highlight();
            preview(); // Update changes in iframe
            saveProject(currentProject);
        }
    }
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
    ["html", "css", "js"].forEach(syntax => panes[syntax]?.highlight());
    paneConsole.clear();

    // Update URI param if is Gist or not
    const url = new URL(window.location.href);
    if (currentProject.gistId) {
        url.searchParams.set("g", currentProject.gistId);
    } else {
        url.searchParams.delete("g");
    }
    window.history.replaceState({}, "", url);

    // Preview the project
    preview();
};

/**
 * Construct HTML page output for preview or download
 * @param {boolean} isApp DDiffferentiate whilst in-app vs downloaded document
 */
const generatePreviewHTML = (isApp = true, data = currentProject) => {
    const injectScript = /*html*/`<script id="◆xode-inject" src="inject.js?t=${Date.now()}"></script>`;
    return /*html*/`<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${data.name}</title>
        <style${isApp ? ' id="◆xode-css"' : ''}>${data.css}</style>
        ${isApp ? injectScript : ""}
    </head>
    <body${isApp ? ' id="◆xode-html" spellcheck="false"' : ''}>
        ${data.html}
        <script${isApp ? ' id="◆xode-js"' : ''} type="module">${data.js}${isApp ? "//# sourceURL=js" : ""}</script>
    </body>
    </html>`;
};

const preview = (isForce) => {
    // If richEditor and iframe has focus - do NOT update preview
    if (currentProject.panes.richEditor && document.activeElement === elPreview) return;
    if (!isForce && !elAutorun.checked) return;
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
        elPreview.srcdoc = generatePreviewHTML();
    }, isForce ? 0 : 350);
};

// Rich Editor --to--> HTML
addEventListener("message", async (evt) => {
    if (evt.data.type === "content-changed") {
        const body = new DOMParser().parseFromString(evt.data.html, "text/html").body;
        body.querySelector("#◆xode-js")?.remove();
        const html = (body.innerHTML.trim() ?? "").replace(/^<br ?\/?>$/, "");
        panes.html.setValue(html);
        currentProject.html = html; // Update with new value + save project
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

const drawProjects = () => {
    const elProjectsList = el("#projects-list");
    elProjectsList.innerHTML = "";
    listProjects().forEach((project) => {
        const elThumbnail = elNew("div", { className: "thumbnail" });
        const projectData = openProject(project.id);
        projectData.html = `
            <script>// XODE-injected: Silence, suppress some console methods for thumbnails
            const methods = ['log', 'warn', 'error', 'info', 'debug'];
            methods.forEach(method => {
                if (window.console && window.console[method]) window.console[method] = function () {};
            });</script>
        ` + projectData.html;
        const elThumbnailIframe = elNew("iframe", {
            className: "iframe-thumbnail",
            srcdoc: generatePreviewHTML(false, projectData),
            sandbox: "allow-scripts", // allow-scripts, allow-same-origin
            loading: "lazy",
            scrolling: "no"
        });

        elThumbnail.append(elThumbnailIframe);
        const gistLinkHTML = projectData.gistId ? `<a href="https://gist.github.com/${projectData.gistId}" target="_blank" rel="noopener noreferrer"><span class="icon" data-name="github-logo">&#xf772;</span></a>` : "";
        const elProject = elNew("div", {
            id: `project-${projectData.id}`,
            className: "project",
            innerHTML: `<div class="bar">
                <span class="project-name">${projectData.name}</span>
                <br>
                <span class="project-actions">
                    ${gistLinkHTML}
                    <button data-download-id="${projectData.id}" type="button"><span class="icon" data-name="download">&#xf3b7;</span></button>
                    <button data-delete-id="${projectData.id}" type="button"><span class="icon" data-name="trash">&#xf202;</span></button>
                </span>
            </div>`,
            title: `${projectData.name} — ${projectData.description || "No description"} | ${formatDateTime(projectData.updatedAt)}`,
        });
        elProject.prepend(elThumbnail);

        el(`[data-delete-id]`, elProject).addEventListener("click", () => {
            if (confirm(`Delete project: "${projectData.name}"?`)) {
                deleteProject(projectData.id);
                drawProjects();
            }
        });
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

// EVENTS

// RUN --> Preview
elRun.addEventListener("click", () => preview(true));

// Download project by ID
const downloadProject = (id) => {
    const project = openProject(id);
    const projectName = project.name.trim() ? project.name.trim().replace(/\W/g, "-") : "untitled";
    download(generatePreviewHTML(false, project), `${projectName}.xode.html`);
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

/**
 * One-time call to generate UI panes
 */
const generatePanes = () => {
    panes.html = new Editor(el("#editor-html"), { syntax: "html" });
    panes.css = new Editor(el("#editor-css"), { syntax: "css" });
    panes.js = new Editor(el("#editor-js"), { syntax: "js" });
    paneConsole.init();
};

// Update html from AI
bus.on('ai:update', ({ syntax, content }) => {
    currentProject[syntax] = content; // Update and save
});

// === GISTS =============================

const gistId = params.g;
let token = getToken();


// Save token to localStorage
const elGithubToken = el("#githubToken");
const elGithubTokenDelete = el("#githubTokenDelete");
const elGithubPublish = el("#githubPublish");
const elGithubLoad = el("#githubLoad");
const elGithubLoadId = el("#githubLoadId");

const updateElGithubToken = () => {
    elGithubToken.value = "";
    if (token) elGithubToken.placeholder = "CONNECTED!";
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
        const newProjectData = {
            id: gistId,
            gistId,
            name: data.description,
            description: data.description,
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

    const description = project.name || project.description || "Untitled";
    let res;

    // PUBLISH - Create
    if (!project.gistId) {
        res = await gist.create({ description, files });
        project.id = res.id;
        project.gistId = res.id;
        saveProject(project); // Save a local copy with the new ID
    }
    // PUBLISH - Update
    else {
        resizeTo = await gist.update(project.gistId, { description, files });
    }
    drawProjects();
};

elGithubPublish.addEventListener("click", () => {
    void gistPublish(currentProject);
});


// INIT

generatePanes();

if (gistId) {
    void gistLoad(gistId);
} else {
    projectInit(false); // Load latest project
}

drawProjects();


/**
 * XODE Code editor (with highlight.js)
 * @author: rokobuljan@github.com
 * @url https://roxon.hr
 */

import "./css/index.css";
import "./js/splitview.js";
import "./js/modal.js";
import "./js/chat.js";
import Rx from "./js/Rx.js";
import { el, els, elNew, download } from "./js/utils.js";
import { openProject, listProjects, saveProject, createProject, deleteProject } from './js/project.js';
import { PaneEditor, PaneConsole } from "./js/panes.js";


let currentProject = {};
const panes = {};
const elPanes = el("#panes");
const elPreview = el("#preview"); // the iframe
const elAutorun = el("#autorun");
const elRun = el("#run");
let previewTimeout;

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

    //  Update UI: Toggle open/close panes
    els("[data-view][data-open]").forEach(elView => {
        const isOpen = currentProject.panes[elView.dataset.view];
        elView.dataset.open = isOpen;
    });

    // Force-clear editors highlight
    ["html", "css", "js"].forEach(syntax => panes[syntax]?.highlight());
    panes.console.clear();

    // Preview the project
    preview();

    console.log(currentProject, panes);

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
        <script${isApp ? ' id="◆xode-js"' : ''} type="module">${data.js}//# sourceURL=js</script>
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
            panes.console.clear();
            panes.console.print({ ...evt.data, args: ["Console cleared"] });
        } else {
            panes.console.print(evt.data);
        }
    }
});

const drawProjects = () => {
    el("#projects-select").innerHTML = "";
    listProjects().forEach((project) => {
        const elThumbnailIframe = elNew("iframe", {
            className: "iframe-thumbnail",
            srcdoc: generatePreviewHTML(false, openProject(project.id)),
            sandbox: "allow-scripts", // allow-scripts, allow-same-origin
            loading: "lazy",
            scrolling: "no"
        });
        const elThumbnail = elNew("div", { className: "thumbnail" });
        elThumbnail.dataset.modal = "";
        elThumbnail.append(elThumbnailIframe);

        const elProject = elNew("div", {
            id: `project-${project.id}`,
            className: "project",
            innerHTML: `<div class="bar">
                <span class="project-name">${project.name}</span>
                <span class="project-date">${new Date(project.updatedAt).toLocaleString()}</span>
                <br>
                <span>
                    <button data-download-id="${project.id}" type="button"><span class="icon" data-name="download">&#xf3b7;</span></button>
                    <button data-delete-id="${project.id}" type="button"><span class="icon" data-name="trash">&#xf202;</span></button>
                </span>
            </div>`,
            title: `${project.name} — ${project.description || "No description"}`,
        });
        elProject.prepend(elThumbnail);

        el(`[data-delete-id]`, elProject).addEventListener("click", () => {
            if (confirm(`Delete project: "${project.name}"?`)) {
                deleteProject(project.id);
                drawProjects();
            }
        });
        el(`[data-download-id]`, elProject).addEventListener("click", () => {
            downloadProject(project.id);
        });
        // Close modal on iframe click:
        elThumbnail.addEventListener("click", () => {
            projectInit(false, project.id);
        });
        el("#projects-select").append(elProject);
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
    drawProjects(); // redraw aold ones
});

/**
 * One-time call to generate UI panes
 */
const generatePanes = () => {
    ["html", "css", "js"].forEach(syntax => {
        panes[syntax] = new PaneEditor(elPanes, { syntax });
    });
    panes.console = new PaneConsole(elPanes, { syntax: "console" });
};

// INIT
generatePanes();
projectInit(false); // Load latest project
drawProjects();

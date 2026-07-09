/**
 * XODE Code editor (with highlight.js)
 * @author: rokobuljan@github.com
 * @url https://roxon.hr
 */

import "./css/index.css";
import "./js/splitview.js";
import "./js/modal.js";
import Rx from "./js/Rx.js";
import { el, elNew, download } from "./js/utils.js";
import { openProject, listProjects, saveProject, createProject, deleteProject } from './js/storage.js';
import { PaneEditor, PaneConsole } from "./js/panes.js";


let currentProject = {};
const panes = {};
const elPreview = el("#preview"); // the iframe
const elAutorun = el("#autorun");
const elRun = el("#run");
const elDownload = el("#download");
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
            saveProject(currentProject);
            panes[detail.prop]?.highlight();
            console.log(detail)
            preview(); // Update changes in iframe
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

    // Force-clear editors highlight
    ["html", "css", "js"].forEach(syntax => panes[syntax]?.highlight());
    panes.console.clear();

    // Preview the project
    preview();
};

/**
 * One-time call to generate UI panes
 */
const generatePanes = () => {
    const elPanes = el("#panes");
    ["html", "css", "js"].forEach(syntax => {
        panes[syntax] = new PaneEditor(elPanes, { syntax, value: currentProject[syntax] });
        panes[syntax]?.highlight();
    });
    panes.console = new PaneConsole(elPanes, "console");
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
        <script${isApp ? ' id="◆xode-js"' : ''} type="module">${data.js}</script>
        <style${isApp ? ' id="◆xode-css"' : ''}>${data.css}</style>
        ${isApp ? injectScript : ""}
    </head>
    <body${isApp ? ' id="◆xode-html" spellcheck="false"' : ''}>
        ${data.html}
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
        panes.html.elTextarea.value = html;
        await panes.html.format();
        console.log("formatted");



        panes.html.highlight();
        currentProject.html = html; // Update with new value + save project
    }
    // Console messages
    else if (evt.data.type === "clear") {
        panes.console.clear();
        panes.console.print({ ...evt.data, args: ["Console cleared"] });
    } else {
        panes.console.print(evt.data);
    }
});

const drawProjects = () => {
    el("#projects-select").innerHTML = "";
    listProjects().forEach((project) => {
        const elTHumbnailIframe = elNew("iframe", {
            className: "iframe-thumbnail",
            srcdoc: generatePreviewHTML(false, openProject(project.id)),
            sandbox: "allow-scripts",
            loading: "lazy",
        });
        const elProject = elNew("div", {
            id: `project-${project.id}`,
            className: "project",
            innerHTML: `<div class="bar">
                <span>${project.name}</span>
                <span>${new Date(project.updatedAt).toLocaleString()}</span>
                <button data-download-id="${project.id}" type="button"><span class="icon" data-name="download">&#xf3b7;</span></button>
                <button data-delete-id="${project.id}" type="button"><span class="icon" data-name="trash">&#xf202;</span></button>
            </div>`,
            title: `${project.name} — ${project.description || "No description"}`,
        });
        elProject.dataset.modal = "";
        elProject.addEventListener("contextmenu", (evt) => {
            evt.preventDefault();
            if (confirm(`Delete project: "${project.name}"?`)) {
                deleteProject(project.id);
                drawProjects();
            }
        })
        elProject.prepend(elTHumbnailIframe);
        elProject.addEventListener("click", () => {
            projectInit(false, project.id);
        });
        el("#projects-select").append(elProject);
    });
};

// EVENTS

// RUN --> Preview
elRun.addEventListener("click", () => preview(true));

// Download project locally as .html
elDownload.addEventListener("click", () => {
    const projectName = currentProject.name.trim() ? currentProject.name.trim().replace(/\W/g, "-") : "untitled";
    download(generatePreviewHTML(false), `${projectName}.xode.html`);
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

// INIT
generatePanes();
projectInit(false); // Load latest project
drawProjects();

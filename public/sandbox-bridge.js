const root = document.createElement("div");
root.id = "sandbox-root";
document.body.appendChild(root);

let parentOrigin = null;
const resolveParentOrigin = () => {
    if (parentOrigin) return parentOrigin;
    if (window.location.ancestorOrigins && window.location.ancestorOrigins.length) {
        parentOrigin = window.location.ancestorOrigins[0];
        return parentOrigin;
    }
    if (document.referrer) {
        try {
            parentOrigin = new URL(document.referrer).origin;
            return parentOrigin;
        } catch {
            // ignore invalid referrer
        }
    }
    try {
        parentOrigin = window.parent.location.origin;
        return parentOrigin;
    } catch {
        return null;
    }
};

const postToParent = (data) => {
    const origin = resolveParentOrigin();
    if (!origin) return;
    window.parent.postMessage(data, origin);
};

const serializeArg = (arg) => {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (typeof arg === "object") {
        try {
            return JSON.stringify(arg, null, 2);
        } catch {
            return Object.prototype.toString.call(arg);
        }
    }
    return String(arg);
};

const instrumentConsole = () => {
    const methods = ["log", "warn", "error", "info", "debug", "clear"];
    methods.forEach((method) => {
        const original = console[method]?.bind(console);
        if (!original) return;
        console[method] = (...args) => {
            original(...args);
            postToParent({ type: `console:${method}`, args: args.map(serializeArg) });
        };
    });
};

const notifyParent = (data) => postToParent(data);

const createStyle = (css) => {
    let style = document.getElementById("◆xode-css");
    if (!style) {
        style = document.createElement("style");
        style.id = "◆xode-css";
        document.head.appendChild(style);
    }
    style.textContent = css || "";
};

const setContent = (html) => {
    root.innerHTML = html || "";
};

const setJavaScript = (js) => {
    const existing = document.getElementById("◆xode-js");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "◆xode-js";
    script.type = "module";
    script.textContent = `${js || ""}\n//# sourceURL=app.js`;
    document.body.appendChild(script);
};

const renderProject = (project) => {
    createStyle(project.css);
    setContent(project.html);
    setJavaScript(project.js);
};

const actions = {
    designMode: (val) => {
        document.designMode = val ? "on" : "off";
    },
    patchCSS: (val) => createStyle(val),
    patchHTML: (val) => setContent(val),
};

let inputDebounce = null;
const notifyContentChanged = () => {
    if (document.designMode !== "on") return;
    clearTimeout(inputDebounce);
    inputDebounce = setTimeout(() => {
        postToParent({
            type: "content-changed",
            html: root.innerHTML,
        });
    }, 200);
};

document.addEventListener("input", notifyContentChanged);

document.addEventListener("paste", notifyContentChanged);

document.addEventListener("keyup", (evt) => {
    if (document.designMode === "on") {
        notifyContentChanged();
    }
});

window.addEventListener("message", (evt) => {
    if (!evt.data || typeof evt.data.type !== "string") return;
    if (evt.data.type === "set-parent-origin") {
        parentOrigin = evt.origin;
        return;
    }

    const origin = resolveParentOrigin();
    if (!origin || evt.origin !== origin) return;

    if (evt.data.type === "app:update") {
        renderProject(evt.data.project || {});
        return;
    }

    if (evt.data.type === "action") {
        const [prop, val] = evt.data.args || [];
        if (actions[prop]) actions[prop](val);
        return;
    }

    if (evt.data.type === "cmd") {
        let [cmd, par] = evt.data.args || [];
        if (cmd === "InsertImage") par = prompt("Image URL:", "");
        else if (cmd === "CreateLink") {
            par = prompt("Link URL:", "http://");
            if (par === "" || par == "http://") cmd = "Unlink";
        }
        document.execCommand("styleWithCSS", false, false);
        document.execCommand(cmd, false, par);
        return;
    }
});

window.addEventListener("error", (evt) => {
    postToParent({ type: "console:error", args: [evt.message] });
});
window.addEventListener("unhandledrejection", (evt) => {
    postToParent({ type: "console:error", args: ["Uncaught (in promise)"] });
});

instrumentConsole();
postToParent({ type: "sandbox:ready" });

const previewOffsetDataset = document.querySelector("#◆xode-inject")?.dataset?.previewoffsets;
const DEFAULT_SOURCE_OFFSETS = Object.assign({
    htmlStartLine: 1,
    jsStartLine: 1,
}, previewOffsetDataset ? JSON.parse(previewOffsetDataset) : {});

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

const applyProject = (project = {}) => {
    const css = project.css || "";
    const html = project.html || "";
    const js = project.js || "";

    let style = document.getElementById("◆xode-css");
    if (!style) {
        style = document.createElement("style");
        style.id = "◆xode-css";
        document.head.appendChild(style);
    }
    style.textContent = css;

    document.body.innerHTML = html;

    const existingScript = document.getElementById("◆xode-js");
    if (existingScript) existingScript.remove();
    const script = document.createElement("script");
    script.id = "◆xode-js";
    script.type = "module";
    script.textContent = `${js}\n//# sourceURL=project.js`;
    document.body.appendChild(script);
};

window.addEventListener("message", (evt) => {
    if (evt.data?.type === "set-parent-origin") {
        parentOrigin = evt.origin;
        return;
    }
    if (!parentOrigin || evt.origin !== parentOrigin) return;

    if (evt.data.type === "app:update") {
        applyProject(evt.data.project);
    }
});

const getSourceName = (file = "") => {
    if (file === "js") return "js";
    if (file === "<anonymous>") return "about:srcdoc";
    return file;
};
const extractLocation = (stack = "") => {
    const frames = String(stack)
        .split("\n")
        .map((frame) => frame.trim())
        .filter(Boolean);
    for (let index = frames.length - 1; index >= 0; index--) {
        const frame = frames[index].replace(/^at\s+/, "");
        const inner = frame.match(/\(([^()]*)\)\s*$/)?.[1] || frame;
        const location = inner.match(/^(.*):(\d+):(\d+)$/) || inner.match(/^(.*):(\d+)$/);
        if (!location) continue;
        const [, file, line, column = "0"] = location;
        if (!file || !line) continue;
        return { file, line: Number(line), column: Number(column) };
    }
    return null;
};
const formatLocation = (file, line) => {
    if (!line) return "";
    const source = getSourceName(file);
    const { htmlStartLine, jsStartLine } = DEFAULT_SOURCE_OFFSETS;
    if (source === "js") return `js:${line}`;
    if (source === "html") return `html:${line}`;
    if (source === "about:srcdoc" || source === "") {
        if (line >= jsStartLine) return `js:${line - jsStartLine + 1}`;
        if (line >= htmlStartLine) return `html:${line - htmlStartLine + 1}`;
        return `html:${line}`;
    }
    return `${source}:${line}`;
};
const serialize = (arg) => {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (arg instanceof Error) return arg.name + ": " + arg.message;
    if (typeof arg === "object") {
        try { return JSON.stringify(arg, null, 2); }
        catch { return Object.prototype.toString.call(arg); }
    }
    return String(arg);
};
const getLineNumber = (stack = new Error().stack) => {
    const location = extractLocation(stack);
    if (!location) return "";
    return formatLocation(location.file, location.line);
};
const getAllMethods = (obj) => {
    const methods = new Set();
    let current = obj;
    while (current) {
        Object.getOwnPropertyNames(current).forEach((key) => {
            if (typeof obj[key] === "function") methods.add(key);
        });
        current = Object.getPrototypeOf(current);
    }
    return [...methods];
}

// let i = 0;
getAllMethods(window.console).forEach((method) => {
    const _orig = console[method].bind(console);
    console[method] = (...args) => {
        // if (++i > 2) return;
        _orig(...args);
        postToParent({
            type: `console:${method}`,
            args: Array.from(args).map(serialize),
            line: getLineNumber(),
        });
    };
});
window.addEventListener("error", (evt) => {
    const location = evt.error?.stack ? extractLocation(evt.error.stack) : null;
    postToParent({
        type: "console:error",
        args: [evt.message],
        line: location ? formatLocation(location.file, location.line) : formatLocation(evt.filename, evt.lineno),
    });
});
window.addEventListener("unhandledrejection", (evt) => {
    const location = extractLocation(evt.reason?.stack || "");
    postToParent({
        type: "console:error",
        args: [location ? `Uncaught (in promise): at ${location.line}` : "Uncaught (in promise)"],
        line: location ? formatLocation(location.file, location.line) : "",
    });
});

// Rich Editor mode
// Inside the iframe's document
let debounceTimer = null;
const notifyParent = (data) => {
    postToParent(data);
};
document.addEventListener("input", () => {
    // Prevent notifying parent whilst i.e: writing into a textarea
    if (document.designMode === "off") return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        notifyParent({ type: "content-changed", html: document.documentElement.outerHTML })
    }, 250);
});
const actions = {
    designMode: (val) => {
        document.designMode = val ? "on" : "off";
    },
    patchCSS: (val) => {
        const elTarget = document.getElementById("◆xode-css");
        if (elTarget) elTarget.textContent = val;
    },
    patchHTML: (val) => {
        const elTarget = document.getElementById("◆xode-html");
        if (elTarget) elTarget.innerHTML = val;
    }
};
// Messages from parent window
window.addEventListener("message", (evt) => {
    // Actions
    if (evt.data.type === "action") {
        const [prop, val] = evt.data.args;
        if (actions[prop]) {
            actions[prop](val);
        }
        return;
    }
    // execcommand
    else if (evt.data.type === "cmd") {
        let [cmd, par] = evt.data.args;
        if (cmd === "InsertImage") par = prompt("Image URL:", "");
        else if (cmd === "CreateLink") {
            par = prompt("Link URL:", "http://");
            if (par === "" || par == "http://") cmd = "Unlink";
        }
        document.execCommand("styleWithCSS", false, false);
        document.execCommand(cmd, false, par);
        console.log("NOT PAR")
        // notifyParent({ type: "content-changed", html: document.documentElement.outerHTML })
    }
});

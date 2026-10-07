const DEFAULT_SOURCE_OFFSETS = Object.assign(
    {
        htmlStartLine: 1,
        jsStartLine: 1,
    },
    JSON.parse(document.querySelector("#◆xode-inject").dataset.previewoffsets),
);
const EDITOR_ORIGIN = new URL(document.baseURI).origin;
const targetsEditorOrigin = (value) => {
    try {
        return new URL(value, document.baseURI).origin === EDITOR_ORIGIN;
    } catch {
        return false;
    }
};

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
        try {
            return JSON.stringify(arg, null, 2);
        } catch {
            return Object.prototype.toString.call(arg);
        }
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
};

// let i = 0;
getAllMethods(window.console).forEach((method) => {
    const _orig = console[method].bind(console);
    console[method] = (...args) => {
        // if (++i > 2) return;
        _orig(...args);
        window.parent.postMessage(
            {
                type: `console:${method}`,
                args: Array.from(args).map(serialize),
                line: getLineNumber(),
            },
            "*",
        );
    };
});
window.addEventListener("error", (evt) => {
    const location = evt.error?.stack ? extractLocation(evt.error.stack) : null;
    window.parent.postMessage(
        {
            type: "console:error",
            args: [evt.message],
            line: location ? formatLocation(location.file, location.line) : formatLocation(evt.filename, evt.lineno),
        },
        "*",
    );
});
window.addEventListener("unhandledrejection", (evt) => {
    const location = extractLocation(evt.reason?.stack || "");
    window.parent.postMessage(
        {
            type: "console:error",
            args: [location ? `Uncaught (in promise): at ${location.line}` : "Uncaught (in promise)"],
            line: location ? formatLocation(location.file, location.line) : "",
        },
        "*",
    );
});

// Rich Editor mode
// Inside the iframe's document
let debounceTimer = null;
const notifyParent = (data) => {
    // restrict to your real origin in production
    window.parent.postMessage(data, "*");
};
document.addEventListener("input", () => {
    // Prevent notifying parent whilst i.e: writing into a textarea
    if (document.designMode === "off") return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        notifyParent({ type: "content-changed", html: document.documentElement.outerHTML });
    }, 250);
});
document.addEventListener(
    "click",
    (evt) => {
        if (evt.defaultPrevented) return;
        const anchor = evt.target.closest?.("a[href]");
        const href = anchor?.getAttribute("href")?.trim();
        if (href == null) return;
        if (!href.startsWith("#")) {
            if (targetsEditorOrigin(href)) evt.preventDefault();
            return;
        }

        evt.preventDefault();
        let fragment = href.slice(1);
        try {
            fragment = decodeURIComponent(fragment);
        } catch {
            // Keep malformed escape sequences usable as literal IDs.
        }

        const scrollRoot = document.scrollingElement;
        if (!scrollRoot) return;
        if (!fragment) {
            scrollRoot.scrollTop = 0;
            scrollRoot.scrollLeft = 0;
            return;
        }

        const target = document.getElementById(fragment) ?? document.getElementsByName(fragment)[0];
        if (!target) return;
        const bounds = target.getBoundingClientRect();
        scrollRoot.scrollTop += bounds.top;
        scrollRoot.scrollLeft += bounds.left;
    },
    true,
);
document.addEventListener(
    "submit",
    (evt) => {
        const form = evt.target;
        if (form?.tagName !== "FORM") return;
        const action = evt.submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? "";
        if (targetsEditorOrigin(action.trim())) evt.preventDefault();
    },
    true,
);
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
    },
};

let pendingRichDialog = null;
const closestAnchor = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest("a");
const syncRichContent = () => {
    clearTimeout(debounceTimer);
    notifyParent({ type: "content-changed", html: document.documentElement.outerHTML });
};
const openRichDialog = (kind) => {
    if (document.designMode !== "on" || pendingRichDialog) return;
    syncRichContent();
    const selection = window.getSelection();
    const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : document.createRange();
    if (!selection.rangeCount) {
        range.selectNodeContents(document.body);
        range.collapse(false);
    }
    const anchor = closestAnchor(range.startContainer);
    const existingLink = anchor && anchor === closestAnchor(range.endContainer) ? anchor : null;
    const requestId = crypto.randomUUID();
    pendingRichDialog = { requestId, kind, range, existingLink };
    notifyParent({
        type: "rich-dialog-open",
        requestId,
        kind,
        values:
            existingLink && kind === "link"
                ? {
                      href: existingLink.getAttribute("href"),
                      blank: existingLink.target === "_blank",
                      noopener: existingLink.relList.contains("noopener"),
                  }
                : {},
    });
};
const applyRichDialog = ({ requestId, value }) => {
    if (!pendingRichDialog || requestId !== pendingRichDialog.requestId) return;
    const { kind, range, existingLink } = pendingRichDialog;
    pendingRichDialog = null;
    if (document.designMode !== "on" || !range.startContainer.isConnected || !range.endContainer.isConnected) return;
    document.body.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (!value) return;
    document.execCommand("styleWithCSS", false, false);
    if (kind === "table") {
        const { rows, columns, header } = value;
        if (![rows, columns].every((count) => Number.isInteger(count) && count >= 1 && count <= 20)) return;
        const cellStyle = "padding: 0.5em; background: color-mix(in srgb, currentColor, transparent 94%);";
        const bodyRows = Array.from({ length: rows - (header ? 1 : 0) }, () => `<tr>${`<td style="${cellStyle}"><br></td>`.repeat(columns)}</tr>`).join("");
        const heading = header ? `<thead><tr>${Array.from({ length: columns }, (_, index) => `<th scope="col" style="${cellStyle}">Column ${index + 1}</th>`).join("")}</tr></thead>` : "";
        const table = `<table style="width: 100%; border-spacing: 0.25em;">${heading}<tbody>${bodyRows}</tbody></table><p><br></p>`;
        document.execCommand("insertHTML", false, table);
    } else if (kind === "image") {
        if (typeof value.src !== "string" || !/^(https:\/\/|data:image\/(?:png|jpeg|gif|webp|avif);base64,)/i.test(value.src)) return;
        const image = document.createElement("img");
        image.src = value.src;
        image.alt = typeof value.alt === "string" ? value.alt : "";
        document.execCommand("insertHTML", false, image.outerHTML);
    } else {
        let url;
        try {
            url = new URL(value.href);
        } catch {
            return;
        }
        if (url.protocol !== "https:" || url.username || url.password) return;
        const setAttributes = (anchor) => {
            anchor.href = url.href;
            if (value.blank) anchor.target = "_blank";
            else anchor.removeAttribute("target");
            if (value.noopener) anchor.relList.add("noopener");
            else anchor.relList.remove("noopener");
            if (!anchor.rel) anchor.removeAttribute("rel");
        };
        if (existingLink && range.collapsed) {
            setAttributes(existingLink);
        } else if (range.collapsed) {
            const anchor = document.createElement("a");
            anchor.textContent = url.href;
            setAttributes(anchor);
            document.execCommand("insertHTML", false, anchor.outerHTML);
        } else {
            document.execCommand("createLink", false, url.href);
            const linkedRange = selection.rangeCount ? selection.getRangeAt(0) : range;
            document.querySelectorAll("a[href]").forEach((anchor) => {
                if (anchor.href === url.href && linkedRange.intersectsNode(anchor)) setAttributes(anchor);
            });
        }
    }
    syncRichContent();
};
// Messages from parent window
window.addEventListener("message", (evt) => {
    if (evt.source !== window.parent || evt.origin !== EDITOR_ORIGIN || !evt.data || typeof evt.data.type !== "string") return;
    if (evt.data.type === "rich-dialog-result") {
        applyRichDialog(evt.data);
        return;
    }
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
        const [cmd, par] = evt.data.args;
        const dialogKind = { InsertImage: "image", CreateLink: "link", InsertTable: "table" }[cmd];
        if (dialogKind) {
            openRichDialog(dialogKind);
            return;
        }
        document.execCommand("styleWithCSS", false, false);
        document.execCommand(cmd, false, par);
        if (document.designMode === "on") {
            document.body.focus?.({ preventScroll: true });
        }
        if (document.designMode === "on") syncRichContent();
    }
});

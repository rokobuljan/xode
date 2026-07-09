const OFFSETLINES_JS = 0; // Offset for console.fn line number
const OFFSETLINES_HTML = 10;
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
    const callerLine = stack.split("\n").pop().replace(/ *at */, "");
    let [file, line, _column] = callerLine.split(/:(?=\d+)/);
    line = Number(line) - OFFSETLINES_JS;
    file = file.replace("about:srcdoc", "html");
    if (file === "html") line -= OFFSETLINES_HTML;
    return `${file}:${line}`;
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
    // const _orig = console[method].bind(console);
    console[method] = (...args) => {
        // if (++i > 2) return;
        // _orig(...args);
        window.parent.postMessage({
            type: `console:${method}`,
            args: Array.from(args).map(serialize),
            line: getLineNumber(),
        }, "*");
    };
});
window.addEventListener("error", (evt) => {
    window.parent.postMessage({
        type: "console:error",
        args: [evt.message],
        line: evt.lineno ? evt.lineno - OFFSETLINES_JS : "",
    }, "*");
});
window.addEventListener("unhandledrejection", (evt) => {
    let [line, col] = evt.reason.stack.split(/:(?=\d+:\d+$)/)[1].split(":");
    line = Number(line) - OFFSETLINES_JS;
    window.parent.postMessage({
        type: "console:error",
        args: [`Uncaught (in promise): at ${line}:${col}`],
        line,
    }, "*");
});

// Rich Editor mode
// Inside the iframe's document
let debounceTimer = null;
const notifyParent = () => {
    window.parent.postMessage(
        { type: "content-changed", html: document.documentElement.outerHTML },
        "*" // restrict to your real origin in production
    );
};
document.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(notifyParent, 250);
});
const actions = {
    designMode: (val) => {
        document.designMode = val ? "on" : "off";
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
        window.parent.postMessage({
            type: "content-changed",
            html: document.querySelector("body").innerHTML
        }, "*");
    }
});

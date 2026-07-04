const OFFSETLINES = 6;
document.designMode = "on";
const serialize = (arg) => {
    if (arg === null) return "null";
    if (arg === undefined) return 'undefined';
    if (arg instanceof Error) return arg.name + ': ' + arg.message;
    if (typeof arg === 'object') {
        try { return JSON.stringify(arg, null, 2); }
        catch { return Object.prototype.toString.call(arg); }
    }
    return String(arg);
};
const getLineNumber = () => {
    const stack = new Error().stack;
    const line = stack.split('\n')[4]; // caller's line
    const match = line.match(/:(\d+):\d+\)?$/);
    return match ? Number(match[1]) - OFFSETLINES : '?';
};
const forward = (type, args) => {
    parent.postMessage({
        type,
        line: getLineNumber(),
        args: Array.from(args).map(serialize)
    }, '*');
};
const getAllMethods = (obj) => {
    const methods = new Set();
    let current = obj;
    while (current) {
        Object.getOwnPropertyNames(current).forEach((key) => {
            if (typeof obj[key] === 'function') methods.add(key);
        });
        current = Object.getPrototypeOf(current);
    }
    return [...methods];
}
getAllMethods(console).forEach((method) => {
    const _orig = console[method].bind(console);
    console[method] = (...args) => {
        _orig(...args);
        forward(method, args);
    };
});
window.addEventListener("error", (evt) => {
    window.parent.postMessage({ type: "error", line: evt.lineno - OFFSETLINES, args: [evt.message] }, '*');
});
window.addEventListener('unhandledrejection', (evt) => {
    window.parent.postMessage({ type: "error", line: evt.lineno ?? '?', args: ["Unhandled Promise: " + serialize(evt.reason)] }, '*');
});
// Designer mode
addEventListener("keyup", () => {
    window.parent.postMessage({ type: "code", args: [document.querySelector("body").innerHTML] }, "*");
});
addEventListener("message", (evt) => {
    if (evt.data.type !== "cmd") return;
    let [cmd, par] = evt.data.args;
    if (cmd == "InsertImage") par = prompt("Image URL:", "");
    else if (cmd == "CreateLink") {
        par = prompt("Link URL:", "http://");
        if (par === "" || par == "http://") cmd = "Unlink";
    }
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(cmd, false, par);
    window.parent.postMessage({ type: "code", args: [document.querySelector("body").innerHTML] }, "*");
});

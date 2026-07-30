import { debounce } from './utils.js';

// reactive.js — tiny reactivity core, ES module
let activeEffect = null;
const targetMap = new WeakMap();

function track(target, key) {
    if (!activeEffect) return;
    let deps = targetMap.get(target);
    if (!deps) targetMap.set(target, deps = new Map());
    let dep = deps.get(key);
    if (!dep) deps.set(key, dep = new Set());
    dep.add(activeEffect);
}

function trigger(target, key) {
    targetMap.get(target)?.get(key)?.forEach(fn => fn());
}

export function effect(fn) {
    const wrapped = () => {
        activeEffect = wrapped;
        fn();
        activeEffect = null;
    };
    wrapped();
    return wrapped;
}

export function reactive(target) {
    if (typeof target !== 'object' || target === null) return target;
    return new Proxy(target, {
        get(obj, key, receiver) {
            track(obj, key);
            const val = Reflect.get(obj, key, receiver);
            return typeof val === 'object' && val !== null ? reactive(val) : val;
        },
        set(obj, key, value, receiver) {
            const oldValue = obj[key];
            const ok = Reflect.set(obj, key, value, receiver);
            if (oldValue !== value) {
                trigger(obj, key);
                if (Array.isArray(obj)) trigger(obj, 'length');
            }
            return ok;
        },
        deleteProperty(obj, key) {
            const ok = Reflect.deleteProperty(obj, key);
            trigger(obj, key);
            return ok;
        }
    });
}

export function mount(data, varName = 'state', root = document.body) {
    // true only if `expr` actually starts with this mount() call's varName
    // (e.g. "project.name" belongs to varName "project", not "settings")
    // needed so mount(x, "project") and mount(y, "settings") can share
    // document.body as the default root without crashing or cross-writing.
    function ownsExpr(expr) {
        return expr === varName || expr.startsWith(varName + '.');
    }

    // read-only display bindings: data-rea-text / data-rea-class / data-rea-open / data-rea-value
    // these accept full expressions (e.g. "project.name.toUpperCase()"), read-only
    root.querySelectorAll('[data-rea-text], [data-rea-class], [data-rea-open], [data-rea-value]').forEach(el => {
        bind(el.dataset.reaText, v => el.textContent = v);
        bind(el.dataset.reaClass, v => el.className = v);
        bind(el.dataset.reaOpen, v => el.dataset.open = v);
        bind(el.dataset.reaValue, v => { if (el.value !== v) el.value = v; });
    });

    // two-way form binding: data-rea-model="path.to.prop"
    // branches on element type so text/checkbox/radio each bind correctly
    root.querySelectorAll('[data-rea-model]').forEach(el => {
        const expr = el.dataset.reaModel;
        if (!ownsExpr(expr)) return;         // belongs to a different mount() call — skip
        const keys = expr.split('.').slice(1);      // drop leading varName segment
        const last = keys.pop();
        // Re-resolve the parent fresh on every read/write instead of caching
        // it once — otherwise if `data.panes` (etc.) is ever reassigned to a
        // new object later (e.g. loading a different project), this binding
        // would keep reading/writing the old, discarded object forever.
        const resolveParent = () => keys.reduce((o, k) => o[k], data);

        if (el.type === 'checkbox') {
            effect(() => { el.checked = !!resolveParent()[last]; });
            el.addEventListener('change', () => { resolveParent()[last] = el.checked; });
        } else if (el.type === 'radio') {
            effect(() => { el.checked = (el.value === resolveParent()[last]); });
            el.addEventListener('change', () => { if (el.checked) resolveParent()[last] = el.value; });
        } else {
            effect(() => { if (el.value !== resolveParent()[last]) el.value = resolveParent()[last]; });
            el.addEventListener('input', () => { resolveParent()[last] = el.value; });
        }
    });

    function bind(expr, apply) {
        if (!expr) return;
        if (!ownsExpr(expr)) return;         // belongs to a different mount() call — skip
        const fn = new Function(varName, `return (${expr})`);
        effect(() => apply(fn(data)));
    }
}


/**
 * Watches a reactive object and calls save(snapshot) whenever anything on
 * it changes. `save` receives a plain JSON snapshot, not the live Proxy —
 * this matters if `save` itself mutates its argument (e.g. setting an
 * updatedAt timestamp), since mutating the live Proxy would retrigger this
 * same effect and loop forever.
 *
 * `save` is fully generic: pass saveProject, lsSettings.update, or any
 * other function with the shape (data) => void.
 *
 * Pass `delay` (ms) to debounce fast-changing data, e.g. text input.
 * Omit it (or pass 0) for infrequent changes that should save immediately.
 */
export function persist(data, save, delay = 0) {
    const write = snapshot => save(snapshot);
    const run = delay > 0 ? debounce(write, delay) : write;
    effect(() => run(JSON.parse(JSON.stringify(data))));
}
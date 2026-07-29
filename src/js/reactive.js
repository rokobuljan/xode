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
    const wrapped = () => { activeEffect = wrapped; fn(); activeEffect = null; };
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
            const ok = Reflect.set(obj, key, value, receiver);
            trigger(obj, key);
            if (Array.isArray(obj)) trigger(obj, 'length');
            return ok;
        },
        deleteProperty(obj, key) {
            const ok = Reflect.deleteProperty(obj, key);
            trigger(obj, key);
            return ok;
        }
    });
}

export function mount(data, varName = 'state', rootNode = document.body) {
    rootNode.querySelectorAll('[data-text], [data-class], [data-show]').forEach(el => {
        bind(el.dataset.text, v => el.textContent = v);
        bind(el.dataset.class, v => el.className = v);
        bind(el.dataset.show, v => el.style.display = v ? '' : 'none');
    });
    function bind(expr, apply) {
        if (!expr) return;
        const fn = new Function(varName, `return (${expr})`);
        effect(() => apply(fn(data)));
    }
}

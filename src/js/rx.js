export default class Rx {

    constructor(data = {}, handlers = {}) {
        this.handlers = handlers;
        this.bindings = new Map(); // property -> Set of bound nodes
        this.nodeToTemplate = new WeakMap(); // node -> template info
        this.proxyCache = new WeakMap(); // Cache to store Proxy wrappers for objects
        this.templateId = 0;
        this.eventTarget = new EventTarget();
        this.state = this.createProxy(data);
        // Recursively assign properties to trigger proxy set traps for nested handlers
        this.scan(); // Scan DOM
        this.setupListeners();
        this.setupMutationObserver();
        this.triggerSetters(this.state, data);
        return this;
    }

    triggerSetters(target, source) {
        Object.entries(source).forEach(([key, value]) => {
            if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                // Recursively trigger setters for nested objects
                this.triggerSetters(target[key], value);
            } else {
                target[key] = value;
            }
        });
    }

    /**
     * Recursively convert back to a plain JavaScript object.
     * This is useful for serialization to store data in LocalStorage or sending it to a server.
     * @param {Object} obj - The object with deep Proxies to convert.
     * @returns {Object} The raw version of the object.
     */
    static toRaw(obj, seen = new WeakSet()) {
        if (typeof obj !== "object" || obj === null) return obj;

        // If already seen, skip it entirely (return undefined or omit)
        if (seen.has(obj)) return undefined;

        seen.add(obj);

        // Create result container
        const result = Array.isArray(obj) ? [] : {};

        // Get all property descriptors safely
        const descriptors = Object.getOwnPropertyDescriptors(obj);

        for (const [key, descriptor] of Object.entries(descriptors)) {
            // Only copy enumerable data properties
            if (!descriptor.enumerable) continue;
            if (typeof descriptor.get === 'function') continue;

            const value = descriptor.value;
            if (typeof value === 'function') continue;

            const processed = this.toRaw(value, seen);
            // Only add the property if it wasn't a circular reference
            if (processed !== undefined) {
                result[key] = processed;
            }
        }

        seen.delete(obj);
        return result;
    }

    createProxy(obj, path = "") {
        // Return cached Proxy if it exists
        if (this.proxyCache.has(obj)) {
            return this.proxyCache.get(obj);
        }

        const proxy = new Proxy(obj, {
            get: (target, prop, receiver) => {
                const value = Reflect.get(target, prop, receiver);
                const propPath = path ? `${path}.${String(prop)}` : String(prop);
                return typeof value === "object" && value !== null
                    ? this.createProxy(value, propPath)
                    : value;
            },
            set: (target, prop, val, receiver) => {
                const oldVal = target[prop];
                const isSet = Reflect.set(target, prop, val, receiver);
                if (isSet) {
                    const propPath = path ? `${path}.${String(prop)}` : String(prop);
                    this.update(propPath, val, oldVal);
                }
                return isSet;
            },
            deleteProperty: (target, prop) => {
                const oldVal = target[prop];
                const isDeleted = Reflect.deleteProperty(target, prop);
                if (isDeleted) {
                    const propPath = path ? `${path}.${String(prop)}` : String(prop);
                    this.update(propPath, undefined, oldVal);
                }
                return isDeleted;
            },
        });

        // Cache the Proxy before returning
        this.proxyCache.set(obj, proxy);
        return proxy;
    }

    setupMutationObserver() {
        this.observer = new MutationObserver((mutations) => {
            let shouldRescan = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && this.hasBindings(node)) {
                            shouldRescan = true;
                            break;
                        }
                    }
                }
                if (shouldRescan) break;
            }
            if (shouldRescan) this.rescan();
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
    }

    hasBindings(el) {
        if (el.hasAttribute?.("data-rx")) return true;
        if (el.attributes) {
            for (const attr of el.attributes) {
                if (this.extractVariables(attr.value).length > 0) return true;
            }
        }
        if (el.textContent && this.extractVariables(el.textContent).length > 0) return true;
        return el.querySelectorAll?.("[data-rx]").length > 0;
    }

    scan(root = document.body) {
        // Scan data-rx elements in root
        root.querySelectorAll("[data-rx]").forEach((el) => {
            const prop = el.getAttribute("data-rx");
            if (!this.bindings.has(prop)) this.bindings.set(prop, new Set());
            this.bindings.get(prop).add(el);
            const value = this.getNestedValue(this.state, prop);
            if (value !== undefined) this.setElementValue(el, value);
        });

        // Scan templates
        this.scanTemplates(root);
    }

    rescan(root = document.body) {
        this.scan(root, root === document.body);
        return this;
    }

    scanTemplates(root) {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            null
        );

        let node;
        while ((node = walker.nextNode()) !== null) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                this.scanElementAttributes(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
                this.scanTextNode(node);
            }
        }
    }

    scanElementAttributes(el) {
        if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;

        Array.from(el.attributes).forEach(attr => {
            const variables = this.extractVariables(attr.value);
            if (variables.length > 0) {
                const template = attr.value;
                const templateInfo = { element: el, attrName: attr.name, template, variables };

                // Store only once per element+attr combo
                if (!this.nodeToTemplate.has(el)) {
                    this.nodeToTemplate.set(el, []);
                }
                this.nodeToTemplate.get(el).push(templateInfo);

                variables.forEach(varPath => {
                    if (!this.bindings.has(varPath)) this.bindings.set(varPath, new Set());
                    this.bindings.get(varPath).add(el);
                });

                this.renderTemplate(templateInfo);
            }
        });
    }

    scanTextNode(textNode) {
        const variables = this.extractVariables(textNode.textContent);
        if (variables.length > 0) {
            const template = textNode.textContent;
            const templateInfo = { element: textNode, template, variables };
            this.nodeToTemplate.set(textNode, [templateInfo]);

            variables.forEach(varPath => {
                if (!this.bindings.has(varPath)) this.bindings.set(varPath, new Set());
                this.bindings.get(varPath).add(textNode);
            });

            this.renderTemplate(templateInfo);
        }
    }

    /**
     * Extracts variable paths from a template string.
     * For example, "Hello {{user.name}}!" would return ["user.name"].
     * @param {string} template - The template string to extract variables from.
     * @returns {string[]} An array of variable paths found in the template.
     */
    extractVariables(template) {
        const regex = /\{\{ *([^}]+) *\}\}/g;
        const variables = [];
        let match;
        while ((match = regex.exec(template)) !== null) {
            variables.push(match[1].trim());
        }
        return variables;
    }

    renderTemplate(templateInfo) {
        let result = templateInfo.template;
        templateInfo.variables.forEach(varPath => {
            const value = this.getNestedValue(this.state, varPath);
            const displayValue = value !== undefined && value !== null ? value : "";
            result = result.replace(new RegExp(`\\{\\{\\s*${varPath.replace(/\./g, "\\.")}\\s*\\}\\}`, "g"), displayValue);
        });

        if (templateInfo.attrName) {
            templateInfo.element.setAttribute(templateInfo.attrName, result);
        } else if (templateInfo.element.nodeType === Node.TEXT_NODE) {
            templateInfo.element.data = result;
        } else {
            templateInfo.element.textContent = result;
        }
    }

    setupListeners() {
        document.addEventListener("input", (ev) => {
            const el = ev.target.closest("[data-rx]");
            if (!el) return;
            const prop = el.dataset.rx;
            if (prop && this.bindings.has(prop)) {
                this.setNestedValue(this.state, prop, this.getElementValue(el));
            }
        });
    }

    getElementValue(el) {
        const tagName = el.tagName?.toLowerCase();
        const type = el.type?.toLowerCase();
        if (type === "checkbox") return el.checked;
        else if (type === "radio") return el.value;
        else if (tagName === "select" || tagName === "input" || tagName === "textarea") {
            return type === "number" || type === "range" ? el.valueAsNumber : el.value;
        }
        else if (el.isContentEditable || el.dataset.rxHtml) return el.innerHTML;
        return el.textContent;
    }

    setElementValue = (el, value) => {
        const tagName = el.tagName?.toLowerCase();
        const type = el.type?.toLowerCase();
        if (type === "checkbox") el.checked = Boolean(value);
        else if (type === "radio") el.checked = (el.value === String(value));
        else if (tagName === "select" || tagName === "input" || tagName === "textarea") el.value = value;
        else if (el.isContentEditable || el.dataset.rxHtml) el.innerHTML = value;
        else el.textContent = value;
    }

    update(prop, val, oldVal) {
        // Check both exact and nested path matches
        this.bindings.forEach((nodes, bindingPath) => {
            if (bindingPath === prop || bindingPath.startsWith(`${prop}.`)) {
                nodes.forEach(node => {
                    // Skip if node is no longer in DOM
                    if (node.nodeType === Node.TEXT_NODE) {
                        if (!node.parentNode) return;
                    } else if (!node.isConnected && !document.contains(node)) {
                        return;
                    }

                    const templateInfo = this.nodeToTemplate.get(node);
                    if (templateInfo) {
                        // Template binding
                        templateInfo.forEach(info => this.renderTemplate(info));
                    } else if (node.hasAttribute && node.hasAttribute("data-rx")) {
                        // Direct data-rx binding
                        const value = this.getNestedValue(this.state, bindingPath);
                        this.setElementValue(node, value);
                    }
                });
            }
        });

        // Notify
        const parts = prop.split(".");
        for (let i = parts.length; i > 0; i--) {
            const path = parts.slice(0, i).join(".");
            const pathVal = this.getNestedValue(this.state, path);
            this.notify(path, pathVal, i === parts.length ? oldVal : undefined);
        }
    }

    notify(prop, val, oldVal) {
        // DO NOT use here if (val === oldVal) return; because
        // it will not trigger initial setters & fn handlers
        this.eventTarget.dispatchEvent(new CustomEvent("rx:change", {
            detail: { prop, value: val, oldValue: oldVal }
        }));
        this.eventTarget.dispatchEvent(new CustomEvent(`rx:change:${prop}`, {
            detail: { value: val, oldValue: oldVal }
        }));
        this.handlers[prop]?.call(this.state, val, oldVal);
    }

    getNestedValue(obj, path) {
        return path.split(".").reduce((current, prop) => current?.[prop], obj);
    }

    setNestedValue(obj, path, value) {
        const keys = path.split(".");
        const lastKey = keys.pop();
        const target = keys.reduce((acc, key) => acc[key], obj);
        target[lastKey] = value;
    }

    on(event, callback) {
        this.eventTarget.addEventListener(event, callback);
        return this;
    }

    off(event, callback) {
        this.eventTarget.removeEventListener(event, callback);
        return this;
    }

    once(event, callback) {
        this.eventTarget.addEventListener(event, callback, { once: true });
        return this;
    }

    destroy() {
        this.observer?.disconnect();
    }
}

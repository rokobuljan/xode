export const el = (sel, par = document) => par.querySelector(sel);
export const els = (sel, par = document) => par.querySelectorAll(sel);
export const elNew = (tag, prop = {}) => Object.assign(document.createElement(tag), prop);
export const download = (content, filename = "new_document.html", mimeType = "text/html") => {
    const elA = elNew("a", {
        href: URL.createObjectURL(new Blob([content], { type: mimeType })),
        download: filename
    });
    elA.click();
};
export const LS = (id = "main", defaultData = {}) => {
    return {
        dbName: `ls-${id}`,
        read() {
            if (!localStorage[this.dbName]) {
                localStorage[this.dbName] = JSON.stringify(defaultData);
            }
            try {
                return JSON.parse(localStorage[this.dbName]);
            } catch {
                return null;
            }
        },
        update(data) {
            const _data = this.read() || {};
            if (data) Object.assign(_data, data);
            localStorage[this.dbName] = JSON.stringify(_data);
        },
        clear() {
            delete localStorage[this.dbName];
        }
    }
};
export const elsSiblings = (elem, sel) => [...els(sel, elem.parentElement)].filter(child => child !== elem);
export const formatDateTime = (date) => new Date(date).toISOString().replace('T', ' ').slice(0, 19);
export const params = {
    get(key) {
        const all = Object.fromEntries(new URLSearchParams(location.search));
        return key ? all[key] : all;
    },
    set(key, value) {
        if (value === null || value === undefined || value === "") {
            return this.delete(key);
        }
        const url = new URL(window.location.href);
        url.searchParams.set(key, value);
        window.history.replaceState({}, "", url);
    },
    delete(key) {
        const url = new URL(window.location.href);
        url.searchParams.delete(key);
        window.history.replaceState({}, "", url);
    }
};
export const generateUUID = () => crypto.randomUUID().replace(/-/g, '');


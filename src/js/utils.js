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
export const LS = (id = "main", defaultData) => {
    return {
        dbName: `ls-${id}`,
        get() {
            if (!localStorage[this.dbName]) {
                this.set(defaultData);
            }
            try {
                return JSON.parse(localStorage[this.dbName]);
            } catch {
                return null;
            }
        },
        set(data) {
            localStorage[this.dbName] = JSON.stringify(data);
        },
        clear() {
            delete localStorage[this.dbName];
        }
    }
};
export const elsSiblings = (elem, sel) => [...els(sel, elem.parentElement)].filter(child => child !== elem);


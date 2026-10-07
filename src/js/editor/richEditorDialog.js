import FormDialog from "../ui/dialog.js";

export const MAX_IMAGE_BYTES = 150 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
export const MAX_TABLE_DIMENSION = 20;

const dialogFocus = { link: "href", image: "src", table: "rows" };

export function validateTableDimensions(rows, columns) {
    const dimensions = { rows: Number(rows), columns: Number(columns) };
    if (Object.values(dimensions).some((value) => !Number.isInteger(value) || value < 1 || value > MAX_TABLE_DIMENSION)) {
        throw new Error(`Enter whole numbers between 1 and ${MAX_TABLE_DIMENSION} for rows and columns.`);
    }
    return dimensions;
}

export function validateHttpsUrl(value) {
    const url = String(value ?? "").trim();
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password) return parsed.href;
    } catch {
        /* Show the same validation message for malformed URLs. */
    }
    throw new Error("Enter a valid HTTPS URL, such as https://example.com.");
}

export function validateImageFile(file) {
    if (!file?.size) throw new Error("Choose an image from your computer.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Choose an image no larger than 150 KB.");
    if (!IMAGE_TYPES.includes(file.type)) throw new Error("Choose a PNG, JPEG, GIF, WebP, or AVIF image.");
}

async function readImage(file) {
    validateImageFile(file);
    const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read this image. Try another file."));
        reader.onabort = () => reject(new Error("Image reading was canceled."));
        reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = source;
    try {
        await image.decode();
    } catch {
        throw new Error("This file could not be opened as an image. Try another file.");
    }
    return source;
}

export default class RichEditorDialog {
    constructor() {
        this.dialogs = Object.fromEntries(Object.keys(dialogFocus).map((kind) => [kind, new FormDialog(document.getElementById(`rich-${kind}-dialog`))]));
        const { element, form } = this.dialogs.image;
        element.querySelector("[data-image-browse]").addEventListener("click", () => form.elements.file.click());
        element.querySelector("[data-image-clear]").addEventListener("click", () => {
            form.elements.file.value = "";
            this.updateImageSource();
            form.elements.src.focus({ preventScroll: true });
        });
        form.elements.src.addEventListener("input", () => {
            form.elements.file.value = "";
            this.updateImageSource();
        });
        form.elements.file.addEventListener("change", () => {
            if (form.elements.file.files.length) form.elements.src.value = "";
            this.updateImageSource();
        });
    }

    updateImageSource() {
        const { element, form, status } = this.dialogs.image;
        const file = form.elements.file.files[0];
        form.elements.src.required = !file;
        form.elements.src.setCustomValidity("");
        element.querySelector(".image-selection").hidden = !file;
        element.querySelector("[data-image-filename]").textContent = file ? `Selected: ${file.name}` : "";
        status.textContent = "";
        if (!file) return;
        try {
            validateImageFile(file);
        } catch (error) {
            // Keep validation on the visible input so the browser can focus it.
            form.elements.src.setCustomValidity(error.message);
            status.textContent = error.message;
        }
    }

    show(kind, values = {}) {
        if (!Object.hasOwn(this.dialogs, kind) || Object.values(this.dialogs).some((dialog) => dialog.element.open || dialog.resolve)) return Promise.resolve(null);
        const dialog = this.dialogs[kind];
        const { form } = dialog;
        form.reset();
        if (kind === "link") {
            form.elements.href.value = values.href || "";
            form.elements.blank.checked = values.blank ?? true;
            form.elements.noopener.checked = values.noopener ?? true;
        }
        if (kind === "image") this.updateImageSource();
        const result = dialog.open(async (data) => {
            if (kind === "link") return { href: validateHttpsUrl(data.get("href")), blank: data.has("blank"), noopener: data.has("noopener") };
            if (kind === "table") return { ...validateTableDimensions(data.get("rows"), data.get("columns")), header: data.has("header") };
            const file = data.get("file");
            const src = file?.size ? await readImage(file) : validateHttpsUrl(data.get("src"));
            return { src, alt: String(data.get("alt") || "").trim() };
        });
        form.elements[dialogFocus[kind]].focus({ preventScroll: true });
        return result;
    }

    close() {
        Object.values(this.dialogs).forEach((dialog) => dialog.close());
    }
}

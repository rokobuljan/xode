import FormDialog from "./dialog.js";

export const MAX_IMAGE_BYTES = 150 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
export const MAX_TABLE_DIMENSION = 20;

const dialogOptions = {
    link: { title: "Insert link", description: "Link the selected text to an HTTPS address.", focus: "href" },
    image: { title: "Insert image", description: "Use an image URL or upload an image up to 150 KB.", focus: "src" },
    table: { title: "Insert table", description: `Choose between 1 and ${MAX_TABLE_DIMENSION} rows and columns.`, focus: "rows" },
};

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

export default class RichEditorDialog extends FormDialog {
    constructor() {
        super({
            title: "Insert link",
            titleIcon: "link",
            description: "Link the selected text to an HTTPS address.",
            content: `
                <div data-fields="link" class="field-group">
                    <label class="field">HTTPS URL<input name="href" type="url" placeholder="https://example.com" required autofocus></label>
                    <label class="check-option"><input name="blank" type="checkbox" checked><span>Open in a new tab (_blank)</span></label>
                    <label class="check-option"><input name="noopener" type="checkbox" checked><span>Prevent access to this window (noopener)</span></label>
                </div>
                <div data-fields="image" class="field-group" hidden>
                    <div class="field">
                        <label for="rich-image-url">Image URL or local file</label>
                        <div class="image-source">
                            <input id="rich-image-url" name="src" type="url" placeholder="https://example.com/image.png" aria-describedby="rich-image-upload-note rich-image-selection">
                            <button type="button" data-image-browse><i data-lucide="folder-search"></i><span>Browse…</span></button>
                        </div>
                        <input name="file" type="file" accept="${IMAGE_TYPES.join(",")}" aria-label="Choose a local image" hidden>
                        <div id="rich-image-selection" class="image-selection" aria-live="polite" hidden>
                            <span data-image-filename></span><button type="button" class="button-quiet" data-image-clear aria-label="Remove selected image"><i data-lucide="x"></i><span>Remove</span></button>
                        </div>
                        <small id="rich-image-upload-note">PNG, JPEG, GIF, WebP, or AVIF · up to 150 KB.</small>
                    </div>
                    <label class="field">Alternative text<input name="alt" type="text" placeholder="Describe the image"></label>
                </div>
                <div data-fields="table" class="field-group" hidden>
                    <div class="table-dimensions">
                        <label class="field">Rows<input name="rows" type="number" min="1" max="${MAX_TABLE_DIMENSION}" step="1" value="3" required></label>
                        <label class="field">Columns<input name="columns" type="number" min="1" max="${MAX_TABLE_DIMENSION}" step="1" value="3" required></label>
                    </div>
                    <label class="check-option"><input name="header" type="checkbox" checked><span>First row is a header</span></label>
                </div>`,
        });
        this.element.classList.add("rich-editor-dialog");
        this.element.querySelector("[data-image-browse]").addEventListener("click", () => this.form.elements.file.click());
        this.element.querySelector("[data-image-clear]").addEventListener("click", () => {
            this.form.elements.file.value = "";
            this.updateImageSource();
            this.form.elements.src.focus({ preventScroll: true });
        });
        this.form.elements.src.addEventListener("input", () => {
            this.form.elements.file.value = "";
            this.updateImageSource();
        });
        this.form.elements.file.addEventListener("change", () => {
            if (this.form.elements.file.files.length) this.form.elements.src.value = "";
            this.updateImageSource();
        });
    }

    updateImageSource() {
        const file = this.form.elements.file.files[0];
        this.form.elements.src.required = !file;
        this.form.elements.src.setCustomValidity("");
        this.element.querySelector(".image-selection").hidden = !file;
        this.element.querySelector("[data-image-filename]").textContent = file ? `Selected: ${file.name}` : "";
        this.status.textContent = "";
        if (!file) return;
        try {
            validateImageFile(file);
        } catch (error) {
            // Keep validation on the visible input so the browser can focus it.
            this.form.elements.src.setCustomValidity(error.message);
            this.status.textContent = error.message;
        }
    }

    show(kind, values = {}) {
        const options = dialogOptions[kind];
        if (!options || this.element.open || this.resolve) return Promise.resolve(null);
        this.form.reset();
        this.form.elements.src.setCustomValidity("");
        this.element.querySelectorAll("[data-fields]").forEach((group) => {
            const active = group.dataset.fields === kind;
            group.hidden = !active;
            group.querySelectorAll("input, button").forEach((input) => {
                input.disabled = !active;
            });
        });
        const isLink = kind === "link";
        this.title.textContent = options.title;
        this.setTitleIcon(kind);
        this.description.textContent = options.description;
        this.form.elements.href.value = values.href || "";
        this.form.elements.blank.checked = values.blank ?? true;
        this.form.elements.noopener.checked = values.noopener ?? true;
        if (kind === "image") this.updateImageSource();
        const result = this.open(async (data) => {
            if (isLink) return { href: validateHttpsUrl(data.get("href")), blank: data.has("blank"), noopener: data.has("noopener") };
            if (kind === "table") return { ...validateTableDimensions(data.get("rows"), data.get("columns")), header: data.has("header") };
            const file = data.get("file");
            const src = file?.size ? await readImage(file) : validateHttpsUrl(data.get("src"));
            return { src, alt: String(data.get("alt") || "").trim() };
        });
        this.form.elements[options.focus].focus({ preventScroll: true });
        return result;
    }
}

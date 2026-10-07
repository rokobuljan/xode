import { elNew } from "./utils.js";
import { renderIcons } from "./icons.js";

let nextDialogId = 0;

/** Reusable modal form with native focus trapping, Escape, and async validation. */
export default class FormDialog {
    constructor({ title, description, content, titleIcon = "info", submitLabel = "Insert" }) {
        const id = `xode-dialog-${++nextDialogId}`;
        this.element = elNew("dialog", { className: "confirm-dialog form-dialog" });
        this.element.setAttribute("aria-labelledby", `${id}-title`);
        this.element.setAttribute("aria-describedby", `${id}-description`);
        this.element.innerHTML = `
            <form>
                <button class="close" type="button" data-dialog-cancel aria-label="Close dialog"><i data-lucide="x"></i></button>
                <header><span class="title-icon" aria-hidden="true"></span><h2 id="${id}-title"></h2></header>
                <p id="${id}-description" class="supporting-text"></p>
                <div class="fields">${content}</div>
                <p class="status" role="alert" aria-live="polite"></p>
                <div class="actions">
                    <button type="button" data-dialog-cancel><i data-lucide="x"></i><span>Cancel</span></button>
                    <button type="submit" class="button-primary"><i data-lucide="check"></i><span data-submit-label></span></button>
                </div>
            </form>`;
        this.form = this.element.querySelector("form");
        this.title = this.element.querySelector("h2");
        this.description = this.element.querySelector(".supporting-text");
        this.status = this.element.querySelector(".status");
        this.submitButton = this.element.querySelector('[type="submit"]');
        this.title.textContent = title;
        this.description.textContent = description;
        this.submitButton.querySelector("[data-submit-label]").textContent = submitLabel;
        this.setTitleIcon(titleIcon);
        renderIcons(this.element);
        document.body.append(this.element);
        this.element.querySelectorAll("[data-dialog-cancel]").forEach((button) => button.addEventListener("click", () => this.close()));
        this.element.addEventListener("click", (event) => {
            if (event.target !== this.element) return;
            const bounds = this.element.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) this.close();
        });
        this.element.addEventListener("close", () => {
            const resolve = this.resolve;
            this.resolve = null;
            this.session = null;
            resolve?.(this.result);
        });
        this.form.addEventListener("input", () => {
            this.status.textContent = "";
        });
        this.form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (this.submitButton.disabled) return;
            const session = this.session;
            this.submitButton.disabled = true;
            this.status.textContent = "";
            try {
                const result = await this.onSubmit(new FormData(this.form));
                if (this.session !== session || !this.element.open) return;
                this.result = result;
                this.element.close("submit");
            } catch (error) {
                if (this.session === session && this.element.open) this.status.textContent = error.message;
            } finally {
                if (this.session === session) this.submitButton.disabled = false;
            }
        });
    }

    setTitleIcon(name) {
        const container = this.element.querySelector(".title-icon");
        const icon = elNew("i");
        icon.dataset.lucide = name;
        container.replaceChildren(icon);
        renderIcons(container);
    }

    open(onSubmit) {
        if (this.element.open || this.resolve) return Promise.resolve(null);
        this.onSubmit = onSubmit;
        this.result = null;
        this.session = {};
        this.status.textContent = "";
        this.submitButton.disabled = false;
        const result = new Promise((resolve) => {
            this.resolve = resolve;
        });
        this.element.showModal();
        return result;
    }

    close() {
        if (this.element.open) this.element.close("cancel");
    }
}

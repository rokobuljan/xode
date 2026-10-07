/** Bind a dialog declared in HTML to reusable async form behavior. */
export default class FormDialog {
    constructor(element) {
        this.element = element;
        this.form = this.element.querySelector("form");
        this.status = this.element.querySelector(".status");
        this.submitButton = this.element.querySelector('[type="submit"][value="submit"]');
        this.element.querySelectorAll('button[value="cancel"]').forEach((button) => button.addEventListener("click", () => this.close()));
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

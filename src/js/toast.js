const el = (sel, par = document) => par.querySelector(sel);
const elNew = (tag, prop) => Object.assign(document.createElement(tag), prop);
class Toast {
    static elParent = el("#toasts");
    static active = new Set();

    constructor(data) {
        if (!Toast.elParent) {
            Toast.elParent = elNew("div", { id: "toasts", className: "toast-region" });
            el("body").append(Toast.elParent);
            el("body").addEventListener("keydown", (evt) => {
                if (evt.key === "Escape") {
                    Toast.closeTopmost();
                }
            });
        }

        Object.assign(
            this,
            {
                type: "default",
                time: 0,
                head: "",
                body: "",
                dismissable: true,
            },
            data,
            {
                tOut: null,
            },
        );

        this.el = elNew("div", { className: `toast is-${this.type}` });
        this.el.innerHTML = `
            <button class="close" type="button" aria-label="Dismiss notification"></button>
            <div class="head">${this.head}</div>
            <div class="body"></div>
        `;
        el(".body", this.el).setHTML(this.body);

        el(".close", this.el).addEventListener("click", () => {
            this.hide();
        });

        Toast.active.add(this);

        return this.show();
    }

    static closeTopmost() {
        // Sets preserve insertion order, so the last item is the most recent toast
        const toasts = [...Toast.active].filter((t) => t.dismissable);
        const last = toasts.at(-1);
        if (last) last.hide();
    }

    show() {
        Toast.elParent.append(this.el);
        const time = Number(this.time);
        if (time > 0) {
            this.tOut = setTimeout(() => {
                this.hide();
            }, time);
        }
        return this;
    }

    hide() {
        clearTimeout(this.tOut);
        Toast.active.delete(this);
        this.el.classList.add("is-hiding");
        this.el.addEventListener("transitionend", () => {
            this.el.remove();
        });
    }
}

export default Toast;

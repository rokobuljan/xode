import { el, els } from "./utils.js";

export function closeModals() {
    els(".modal.is-open").forEach((modal) => modal.classList.remove("is-open"));
}

// Modal
addEventListener("click", (evt) => {
    // Native dialogs own their clicks, including close buttons and backdrops.
    if (evt.target.closest("dialog")) return;

    const elBtn = evt.target.closest("[data-modal]");

    // Click inside modal (but not on a close modal button)
    if (evt.target.closest(".modal") && !elBtn) {
        return;
    }

    const id = elBtn?.dataset.modal;

    // Close all open modals
    closeModals();

    if (!elBtn) return;
    if (!id) {
        elBtn.closest(".modal").classList.remove("is-open");
    } else {
        el(id).classList.add("is-open");
    }
});

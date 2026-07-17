import { el, els } from "./utils.js";

// Modal
addEventListener("click", (evt) => {
    const elBtn = evt.target.closest("[data-modal]");

    // Click inside modal (but not on a close modal button)
    if (evt.target.closest('.modal') && !elBtn) {
        return;
    }

    const id = elBtn?.dataset.modal;

    // Close all open modals
    els(".modal.is-open").forEach(elMod => elMod.classList.remove("is-open"));

    if (!elBtn) return;
    if (!id) {
        elBtn.closest(".modal").classList.remove("is-open");
    }
    else {
        el(id).classList.add("is-open");
    }
});

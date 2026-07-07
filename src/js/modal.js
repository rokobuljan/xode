import { el, els } from "./utils.js";

// Modal
addEventListener("click", (evt) => {
    const elBtn = evt.target.closest("[data-modal]");
    if (evt.target.closest('.modal') && !elBtn) return;
    els(".modal.is-open").forEach(elMod => elMod.classList.remove("is-open"));
    if (!elBtn) return;
    const id = elBtn.dataset.modal;
    if (!id) elBtn.closest(".modal").classList.remove("is-open");
    else el(id).classList.add("is-open");
});

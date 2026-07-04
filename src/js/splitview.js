/**
 * SplitView.js
 * Resizable split-view panels
 */

const getGrow = (el) => Number(el.style.getPropertyValue("--grow") || getComputedStyle(el).getPropertyValue("--grow"));
const debouncedResize = () => {
    let timeout;
    return () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            dispatchEvent(new Event("resize"));
        }, 60);
    };
};
const triggerGlobalResizeEvent = debouncedResize();

const splitViewStart = (ev) => {
    const SIZE_MIN = 23;
    const elSplitter = ev.target.closest(".splitter");
    let elPrev = elSplitter?.previousElementSibling;
    while (elPrev && (!elPrev.classList.contains("view") || !elPrev.checkVisibility())) {
        elPrev = elPrev.previousElementSibling;
    }
    // get next element this is not hidden
    let elNext = elSplitter?.nextElementSibling;
    while (elNext && (!elNext.classList.contains("view") || !elNext.checkVisibility())) {
        elNext = elNext.nextElementSibling;
    }

    if (!elSplitter || !elPrev || !elNext) return;
    ev.preventDefault();

    elSplitter.setPointerCapture(ev.pointerId);
    const isCol = elSplitter.closest(".view").matches(".col");
    const offset = isCol ? "offsetHeight" : "offsetWidth";
    const clientXY = isCol ? "clientY" : "clientX";
    const growSum = getGrow(elPrev) + getGrow(elNext);
    const clientXYStart = ev[clientXY];
    const sizePrev = elPrev[offset];
    const sizeNext = elNext[offset];
    const sizeSum = sizePrev + sizeNext;
    const sizeMinPrev = Number(elPrev.style.getPropertyValue("--min") || SIZE_MIN);
    const sizeMinNext = Number(elNext.style.getPropertyValue("--min") || SIZE_MIN);

    const splitViewMove = (ev) => {
        const posDiff = ev[clientXY] - clientXYStart;
        const sizePrevNew = Math.max(sizeMinPrev, Math.min(sizeSum - sizeMinNext, sizePrev + posDiff));
        const sizeNextNew = Math.max(sizeMinNext, Math.min(sizeSum - sizeMinPrev, sizeNext - posDiff));
        const growPrevNew = (growSum * sizePrevNew / sizeSum);
        const growNextNew = (growSum * sizeNextNew / sizeSum);
        elPrev.style.setProperty("--grow", growPrevNew);
        elNext.style.setProperty("--grow", growNextNew);
        triggerGlobalResizeEvent();
    };

    const splitViewEnd = () => {
        removeEventListener("pointermove", splitViewMove);
        removeEventListener("pointerup", splitViewEnd);
    };

    addEventListener("pointermove", splitViewMove);
    addEventListener("pointerup", splitViewEnd);
}

addEventListener("pointerdown", splitViewStart);

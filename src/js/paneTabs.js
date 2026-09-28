const PANE_MODEL_PREFIX = "project.panes.";
const RICH_EDITOR_PANE = "richEditor";

export function paneNameFromModel(model) {
    if (typeof model !== "string" || !model.startsWith(PANE_MODEL_PREFIX)) return null;
    return model.slice(PANE_MODEL_PREFIX.length) || null;
}

export function isViewPane(pane) {
    return Boolean(pane && pane !== RICH_EDITOR_PANE);
}

export function isPaneIsolationGesture(event, pane) {
    return Boolean((event.ctrlKey || event.metaKey) && isViewPane(pane));
}

export function isolatePane(panes, targetPane) {
    if (!panes || !isViewPane(targetPane) || !Object.hasOwn(panes, targetPane)) return false;

    Object.keys(panes).forEach((pane) => {
        if (isViewPane(pane)) panes[pane] = pane === targetPane;
    });
    return true;
}

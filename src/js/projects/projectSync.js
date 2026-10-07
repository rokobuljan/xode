const CONTENT_KEYS = ["name", "description", "html", "css", "js", "scriptType"];

export function projectContent(project) {
    return JSON.stringify(
        CONTENT_KEYS.map((key) => {
            if (key === "name") return project.name?.trim() || "Untitled";
            if (key === "description") return project.description?.trim() || "";
            return project[key] ?? (key === "scriptType" ? "module" : "");
        }),
    );
}

export function hasPushChanges(local, remote) {
    if (!local.gistId) return ["html", "css", "js"].some((key) => local[key]?.trim());
    const onlineContent = remote ? projectContent(remote) : local.gistSnapshot;
    return onlineContent !== undefined && projectContent(local) !== onlineContent;
}

export function hasRemoteChanges(local, remote) {
    const baseline = local.gistSnapshot ?? projectContent(local);
    return projectContent(remote) !== baseline;
}

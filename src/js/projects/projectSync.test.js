import { projectContent, hasRemoteChanges, hasPushChanges } from "./projectSync.js";

it("distinguishes local edits from incoming remote updates", () => {
    const original = { name: "Example", html: "original" };
    const local = { ...original, html: "local edit", gistSnapshot: projectContent(original) };
    expect(hasRemoteChanges(local, original)).toBe(false);
    expect(hasRemoteChanges(local, { ...original, html: "remote edit" })).toBe(true);
    expect(projectContent(local)).not.toBe(local.gistSnapshot);
});

it("ignores local storage timestamps and pane settings", () => {
    const project = { html: "example" };
    expect(projectContent({ ...project, updatedAt: 123, panes: { html: true } })).toBe(projectContent(project));
});

it("checks legacy projects without sync metadata against their content", () => {
    expect(hasRemoteChanges({ html: "before" }, { html: "after" })).toBe(true);
    expect(hasRemoteChanges({ html: "same" }, { html: "same" })).toBe(false);
});

it("shows Push only when content differs from the latest online project", () => {
    const remote = { name: "Example", html: "online" };
    const local = { ...remote, gistId: "gist", gistSnapshot: projectContent({ html: "older version" }) };
    expect(hasPushChanges(local, remote)).toBe(false);
    expect(hasPushChanges({ ...local, description: "new description" }, remote)).toBe(true);
    expect(hasPushChanges({ ...local, html: "" }, remote)).toBe(true);
    expect(hasPushChanges({ ...local, panes: { html: false }, updatedAt: 42 }, remote)).toBe(false);
});

it("waits for an online comparison for legacy gists and skips empty drafts", () => {
    expect(hasPushChanges({ gistId: "gist", html: "code" })).toBe(false);
    expect(hasPushChanges({ html: " " })).toBe(false);
    expect(hasPushChanges({ html: "code" })).toBe(true);
});

it("uses the synced baseline offline and normalizes published metadata", () => {
    const project = { gistId: "gist", name: "Example", description: "Description", html: "code" };
    const local = { ...project, gistSnapshot: projectContent(project) };
    expect(hasPushChanges(local)).toBe(false);
    expect(hasPushChanges({ ...local, html: "edited" })).toBe(true);
    expect(hasPushChanges({ ...local, name: " Example ", description: " Description " }, project)).toBe(false);
});

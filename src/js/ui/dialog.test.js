/* global afterEach, describe, expect, it, vi */

import FormDialog from "./dialog.js";

function setupDialog() {
    const element = new EventTarget();
    const form = new EventTarget();
    const cancel = new EventTarget();
    const status = { textContent: "" };
    const submit = { disabled: false };
    const fields = new Map([["href", "https://example.com/"]]);
    vi.stubGlobal(
        "FormData",
        class {
            constructor() {
                return fields;
            }
        },
    );
    element.open = false;
    element.querySelector = (selector) => ({ form, ".status": status, '[type="submit"][value="submit"]': submit })[selector];
    element.querySelectorAll = () => [cancel];
    element.showModal = () => {
        element.open = true;
    };
    element.close = () => {
        element.open = false;
        element.dispatchEvent(new Event("close"));
    };
    return { dialog: new FormDialog(element), element, form, cancel, status, submit };
}

afterEach(() => vi.unstubAllGlobals());

describe("HTML form dialog behavior", () => {
    it("returns submitted fields from the bound form", async () => {
        const { dialog, element, form } = setupDialog();
        const result = dialog.open((data) => ({ href: data.get("href") }));
        const event = new Event("submit", { cancelable: true });
        form.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await expect(result).resolves.toEqual({ href: "https://example.com/" });
        expect(element.open).toBe(false);
    });

    it("allows cancellation without validating required fields", async () => {
        const { dialog, cancel } = setupDialog();
        const onSubmit = vi.fn();
        const result = dialog.open(onSubmit);
        cancel.dispatchEvent(new Event("click"));
        await expect(result).resolves.toBeNull();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("returns null when the browser closes the dialog with Escape", async () => {
        const { dialog, element } = setupDialog();
        const result = dialog.open(vi.fn());
        element.close();
        await expect(result).resolves.toBeNull();
    });

    it("keeps the dialog open after failed validation and allows retry", async () => {
        const { dialog, element, form, status, submit } = setupDialog();
        const onSubmit = vi.fn().mockRejectedValueOnce(new Error("Invalid image")).mockResolvedValueOnce({ src: "data:image/png;base64,example" });
        const result = dialog.open(onSubmit);
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        await vi.waitFor(() => expect(status.textContent).toBe("Invalid image"));
        expect(element.open).toBe(true);
        expect(submit.disabled).toBe(false);
        form.dispatchEvent(new Event("input"));
        expect(status.textContent).toBe("");
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        await expect(result).resolves.toEqual({ src: "data:image/png;base64,example" });
    });

    it("ignores an image read that finishes after cancellation and reopening", async () => {
        const { dialog, element, form, cancel, status, submit } = setupDialog();
        let finishRead;
        const first = dialog.open(
            () =>
                new Promise((resolve) => {
                    finishRead = resolve;
                }),
        );
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        cancel.dispatchEvent(new Event("click"));
        await expect(first).resolves.toBeNull();
        const second = dialog.open(() => ({ href: "https://example.com/new" }));
        finishRead({ src: "old image" });
        await Promise.resolve();
        expect(element.open).toBe(true);
        expect(status.textContent).toBe("");
        expect(submit.disabled).toBe(false);
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        await expect(second).resolves.toEqual({ href: "https://example.com/new" });
    });
});

/* global describe, expect, it */

import { MAX_IMAGE_BYTES, MAX_TABLE_DIMENSION, validateHttpsUrl, validateImageFile, validateTableDimensions } from "./richEditorDialog.js";

describe("rich editor URL validation", () => {
    it("normalizes HTTPS URLs with query strings and fragments", () => {
        expect(validateHttpsUrl("  https://example.com/image name.png?size=2#image  ")).toBe("https://example.com/image%20name.png?size=2#image");
    });

    it.each(["", "example.com", "http://example.com", "javascript:alert(1)", "data:text/html,hello", "https://user:password@example.com", "https://"])("rejects invalid or unsupported URL %s", (url) => {
        expect(() => validateHttpsUrl(url)).toThrow("valid HTTPS URL");
    });
});

describe("rich editor table dimensions", () => {
    it("accepts numeric inputs and both size boundaries", () => {
        expect(validateTableDimensions("3", "4")).toEqual({ rows: 3, columns: 4 });
        expect(validateTableDimensions(1, MAX_TABLE_DIMENSION)).toEqual({ rows: 1, columns: MAX_TABLE_DIMENSION });
    });

    it.each(["", "invalid", 0, -1, 1.5, MAX_TABLE_DIMENSION + 1, Infinity])("rejects invalid row or column count %s", (value) => {
        expect(() => validateTableDimensions(value, 3)).toThrow("whole numbers");
        expect(() => validateTableDimensions(3, value)).toThrow("whole numbers");
    });
});

describe("rich editor image uploads", () => {
    it("accepts supported images through the 150 KB boundary", () => {
        expect(() => validateImageFile({ size: MAX_IMAGE_BYTES, type: "image/png" })).not.toThrow();
        expect(() => validateImageFile({ size: 512, type: "image/webp" })).not.toThrow();
    });

    it("rejects images larger than the limit before reading them", () => {
        expect(() => validateImageFile({ size: MAX_IMAGE_BYTES + 1, type: "image/png" })).toThrow("150 KB");
    });

    it("rejects missing, empty, and unsupported files", () => {
        expect(() => validateImageFile(null)).toThrow("Choose an image");
        expect(() => validateImageFile({ size: 0, type: "image/png" })).toThrow("Choose an image");
        expect(() => validateImageFile({ size: 512, type: "text/plain" })).toThrow("PNG, JPEG");
    });
});

/* global describe, expect, it */

import { isChatModel, normalizeModelList } from "./chatModels.js";

describe("AI model discovery", () => {
    it("keeps current chat models from provider catalogs", () => {
        expect(
            normalizeModelList({
                data: [{ id: "gpt-6-astra", name: "GPT-6 Astra" }, { id: "openai/gpt-oss-120b" }, { id: "gpt-image-2.5-flare" }],
            }),
        ).toEqual([
            { id: "gpt-6-astra", label: "GPT-6 Astra" },
            { id: "openai/gpt-oss-120b", label: "openai/gpt oss 120b" },
        ]);
    });

    it("understands direct arrays and Cohere-style model responses", () => {
        expect(normalizeModelList([{ id: "deepseek-flash" }])).toEqual([{ id: "deepseek-flash", label: "deepseek flash" }]);
        expect(
            normalizeModelList({
                models: [
                    { name: "command-a-plus-05-2026", endpoints: ["chat"], is_deprecated: false },
                    { name: "embed-v4.0", endpoints: ["embed"] },
                    { name: "old-chat", endpoints: ["chat"], is_deprecated: true },
                ],
            }),
        ).toEqual([{ id: "command-a-plus-05-2026", label: "command-a-plus-05-2026" }]);
    });

    it("filters specialist models that cannot power Xody chat", () => {
        expect(isChatModel("gemini-3.8-flash")).toBe(true);
        expect(isChatModel("gemini-3.8-flash-tts")).toBe(false);
        expect(isChatModel("mistral-ocr-4-1")).toBe(false);
    });
});

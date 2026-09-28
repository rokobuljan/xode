const CHAT_EXCLUDE_PATTERNS = [
    /tts/i,
    /image/i,
    /native-audio/i,
    /embedding|embed/i,
    /robotics|computer-use|deep-research/i,
    /aqa|antigravity|lyria|veo|imagen|nano-banana/i,
    /customtools|whisper|dall-e|moderation/i,
    /davinci|babbage|curie|ada-/i,
    /audio|transcrib|speech|realtime/i,
    /ocr|rerank|classif|guard|shield|safety/i,
];

export function isChatModel(id) {
    return typeof id === "string" && id.length > 0 && !CHAT_EXCLUDE_PATTERNS.some((pattern) => pattern.test(id));
}

function modelCandidates(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.models)) return payload.models;
    return [];
}

function supportsChat(model) {
    if (!model || model.is_deprecated === true) return false;
    if (Array.isArray(model.endpoints) && !model.endpoints.some((endpoint) => String(endpoint).toLowerCase() === "chat")) return false;

    const outputModalities = model.architecture?.output_modalities;
    if (Array.isArray(outputModalities) && !outputModalities.includes("text")) return false;

    const type = String(model.type ?? "");
    if (/image|embed|moderation|rerank|audio|video|transcri|speech|ocr/i.test(type)) return false;
    return true;
}

export function normalizeModelList(payload) {
    const seen = new Set();
    const models = [];

    modelCandidates(payload).forEach((model) => {
        const record = typeof model === "string" ? { id: model } : model;
        const id = String(record?.id ?? record?.name ?? "").trim();
        if (!supportsChat(record) || !isChatModel(id) || seen.has(id)) return;

        seen.add(id);
        models.push({
            id,
            label: String(record.display_name ?? record.name ?? id.replace(/-/g, " ")),
        });
    });

    return models;
}

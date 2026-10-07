const PANES = ["html", "css", "js"];
const MAX_PANE_CHARS = 5 * 1024 * 1024;

export function extractFirstJsonObject(text) {
    const start = text.indexOf("{");
    if (start === -1) throw new Error("No JSON object was found in the response");

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = start; index < text.length; index += 1) {
        const character = text[index];
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (inString && character === "\\") {
            escapeNext = true;
            continue;
        }
        if (character === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (character === "{") depth += 1;
        if (character === "}" && --depth === 0) return text.slice(start, index + 1);
    }

    throw new Error("The response contains an incomplete JSON object");
}

export function validateAIResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("The AI response must be a JSON object");
    }

    const normalized = {
        html: null,
        css: null,
        js: null,
        explanation: typeof value.explanation === "string" ? value.explanation.trim() : "",
    };

    for (const pane of PANES) {
        const content = value[pane];
        if (content === null || content === undefined) continue;
        if (typeof content !== "string") throw new TypeError(`The ${pane.toUpperCase()} change must be text or null`);
        if (content.length > MAX_PANE_CHARS) throw new RangeError(`The ${pane.toUpperCase()} change is too large to apply safely`);
        normalized[pane] = content;
    }

    if (!normalized.explanation) normalized.explanation = PANES.some((pane) => normalized[pane] !== null) ? "I prepared the requested changes." : "No changes are needed.";
    return normalized;
}

export function parseAIResponse(rawText) {
    if (typeof rawText !== "string" || !rawText.trim()) throw new Error("The provider returned an empty response");
    const stripped = rawText
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
    return validateAIResponse(JSON.parse(extractFirstJsonObject(stripped)));
}

export function splitMarkdownSegments(text) {
    const regex = /```([\w+-]+)?\n?([\s\S]*?)```/g;
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
        segments.push({ type: "code", lang: (match[1] || "").toLowerCase(), code: match[2].trim() });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) segments.push({ type: "text", content: text.slice(lastIndex) });
    return segments;
}

export function mapLanguageToPane(language) {
    if (["js", "javascript", "jsx", "ts", "typescript", "mjs"].includes(language)) return "js";
    if (["html", "htm", "xml"].includes(language)) return "html";
    if (["css", "scss", "less"].includes(language)) return "css";
    return null;
}

export function sniffPane(code) {
    if (/<\/?[a-z][\s\S]*>/i.test(code)) return "html";
    if (/[.#]?[\w-]+\s*\{[\s\S]*:[^;]+;/.test(code)) return "css";
    return "js";
}

export function summarizeChanges(response) {
    const panes = PANES.filter((pane) => response[pane] !== null);
    return panes.length ? `${response.explanation} (applied: ${panes.join(", ")})` : response.explanation;
}

export function shouldShowJumpLatest({ hasHistory, scrollHeight, scrollTop, clientHeight, threshold = 0 }) {
    if (!hasHistory || clientHeight <= 0 || scrollHeight <= clientHeight) return false;
    return scrollHeight - scrollTop - clientHeight > threshold;
}

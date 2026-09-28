import DOMPurify from "dompurify";
import { diffLines } from "diff";
import { marked } from "marked";
import { bus } from "./bus.js";
import { mapLanguageToPane, parseAIResponse, shouldShowJumpLatest, sniffPane, splitMarkdownSegments, summarizeChanges } from "./chatCore.js";
import { isChatModel, normalizeModelList } from "./chatModels.js";
import { renderIcons } from "./icons.js";
import {
    clearApiKey,
    clearConversation,
    credentialFingerprint,
    getApiKey,
    getChatSettings,
    getFavoriteModels,
    getModelCache,
    hasApiKey,
    initChatStorage,
    isApiKeyRemembered,
    loadConversation,
    moveConversation,
    reconcileFavoriteModels,
    saveApiKey,
    saveConversation,
    setModelFavorite,
    setModelCache,
    updateChatSettings,
} from "./chatStorage.js";
import { el, elNew } from "./utils.js";

const PROVIDERS = {
    gemini: { label: "Google Gemini", kind: "gemini", keyPlaceholder: "Enter a Gemini API key", keyHelp: "Create a key at aistudio.google.com/app/api-keys." },
    anthropic: { label: "Anthropic Claude", kind: "anthropic", keyPlaceholder: "Enter an Anthropic API key", keyHelp: "Create a key at console.anthropic.com/settings/keys." },
    openai: {
        label: "OpenAI",
        kind: "openai-compatible",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        keyPlaceholder: "Enter an OpenAI API key",
        keyHelp: "Create a key at platform.openai.com/api-keys.",
    },
    deepseek: {
        label: "DeepSeek",
        kind: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1/chat/completions",
        keyPlaceholder: "Enter a DeepSeek API key",
        keyHelp: "Create a key at platform.deepseek.com/api_keys.",
    },
    xai: { label: "xAI Grok", kind: "openai-compatible", baseUrl: "https://api.x.ai/v1/chat/completions", keyPlaceholder: "Enter an xAI API key", keyHelp: "Create a key at console.x.ai." },
    mistral: {
        label: "Mistral",
        kind: "openai-compatible",
        baseUrl: "https://api.mistral.ai/v1/chat/completions",
        keyPlaceholder: "Enter a Mistral API key",
        keyHelp: "Create a key at console.mistral.ai/api-keys.",
    },
    openrouter: {
        label: "OpenRouter",
        kind: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1/chat/completions",
        modelsUrl: "https://openrouter.ai/api/v1/models?output_modalities=text&sort=newest",
        keyPlaceholder: "Enter an OpenRouter API key",
        keyHelp: "Create a key at openrouter.ai/settings/keys.",
    },
    groq: {
        label: "Groq",
        kind: "openai-compatible",
        baseUrl: "https://api.groq.com/openai/v1/chat/completions",
        keyPlaceholder: "Enter a Groq API key",
        keyHelp: "Create a key at console.groq.com/keys.",
    },
    cerebras: {
        label: "Cerebras",
        kind: "openai-compatible",
        baseUrl: "https://api.cerebras.ai/v1/chat/completions",
        keyPlaceholder: "Enter a Cerebras API key",
        keyHelp: "Create a key at cloud.cerebras.ai.",
    },
    together: {
        label: "Together AI",
        kind: "openai-compatible",
        baseUrl: "https://api.together.xyz/v1/chat/completions",
        keyPlaceholder: "Enter a Together AI API key",
        keyHelp: "Create a key at api.together.xyz/settings/api-keys.",
    },
    cohere: {
        label: "Cohere",
        kind: "openai-compatible",
        baseUrl: "https://api.cohere.ai/compatibility/v1/chat/completions",
        modelsUrl: "https://api.cohere.com/v1/models?endpoint=chat&page_size=1000",
        keyPlaceholder: "Enter a Cohere API key",
        keyHelp: "Create a key at dashboard.cohere.com/api-keys.",
    },
    ollama: {
        label: "Ollama (local)",
        kind: "openai-compatible",
        baseUrl: "http://localhost:11434/v1/chat/completions",
        requiresKey: false,
        keyPlaceholder: "No key required",
        keyHelp: "Start Ollama on port 11434 and allow this site's origin with OLLAMA_ORIGINS if necessary.",
    },
    lmstudio: {
        label: "LM Studio (local)",
        kind: "openai-compatible",
        baseUrl: "http://localhost:1234/v1/chat/completions",
        requiresKey: false,
        keyPlaceholder: "No key required",
        keyHelp: "Load a model, start LM Studio's local server on port 1234, and enable CORS if necessary.",
    },
};

const MODEL_CATALOG_VERSION = 2;
const MODEL_CACHE_TTL = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 90 * 1000;
const MAX_HISTORY_ENTRIES = 60;
const HISTORY_ENTRY_MAX_CHARS = 4000;
const MAX_CONTEXT_CHARS = 300_000;
const LATEST_SCROLL_THRESHOLD = 80;
const DIFF_CONTEXT_LINES = 3;
const MAX_RENDERED_DIFF_LINES = 1_500;
const MARKDOWN_CONFIG = {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "a", "p", "code", "pre", "ul", "ol", "li", "br", "blockquote", "h1", "h2", "h3", "hr"],
    ALLOWED_ATTR: ["href", "target", "rel"],
};

const elements = {
    provider: el('[data-chat-element="provider"]'),
    apiKey: el('[data-chat-element="api-key"]'),
    rememberKey: el('[data-chat-element="remember-key"]'),
    toggleKey: el('[data-chat-element="toggle-key"]'),
    toggleKeyLabel: el('[data-chat-element="toggle-key-label"]'),
    clearKey: el('[data-chat-element="clear-key"]'),
    keyStatus: el('[data-chat-element="key-status"]'),
    model: el('[data-chat-element="model"]'),
    modelRefresh: el('[data-chat-element="model-refresh"]'),
    modelFavorite: el('[data-chat-element="model-favorite"]'),
    input: el('[data-chat-element="input"]'),
    output: el('[data-chat-element="feed"]'),
    send: el('[data-chat-element="send"]'),
    stop: el('[data-chat-element="stop"]'),
    newChat: el('[data-chat-element="new-chat"]'),
    jumpLatest: el('[data-chat-element="jump-latest"]'),
    options: el('[data-chat-element="settings"]'),
    modelLabel: el('[data-chat-element="model-label"]'),
    contextStatus: el('[data-chat-element="context-status"]'),
    explainSelection: el('[data-chat-element="explain-selection"]'),
    fixConsole: el('[data-chat-element="fix-console"]'),
};

let editors = {};
let getProjectId = () => null;
let getConsoleContext = () => "";
let hasConsoleErrors = () => false;
let settings = { provider: "gemini", models: {} };
let chatHistory = [];
let currentProjectId = null;
let activeRequest = null;
let modelRequest = null;
let renderedModels = [];
let favoriteModelIds = new Set();
let projectLoadSequence = 0;
let initialized = false;
let lastActiveEditorPane = null;
let feedResizeObserver = null;

class ProviderError extends Error {
    constructor(message, status) {
        super(message);
        this.name = "ProviderError";
        this.status = status;
    }
}

function editorTextarea(pane) {
    return editors[pane]?.elTextarea || editors[pane] || null;
}

function editorValue(pane) {
    return editorTextarea(pane)?.value || "";
}

function iconElement(name) {
    const icon = elNew("i");
    icon.dataset.lucide = name;
    return icon;
}

function iconButton(label, iconName, properties = {}) {
    const button = elNew("button", properties);
    button.append(iconElement(iconName), elNew("span", { textContent: label }));
    return button;
}

function renderMarkdown(target, content) {
    const parsed = marked.parse(String(content || ""), { breaks: true });
    target.innerHTML = DOMPurify.sanitize(parsed, MARKDOWN_CONFIG);
    target.querySelectorAll("a").forEach((link) => {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    });
}

function isNearBottom() {
    return elements.output.scrollHeight - elements.output.scrollTop - elements.output.clientHeight <= LATEST_SCROLL_THRESHOLD;
}

function updateJumpLatestVisibility() {
    elements.jumpLatest.hidden = !shouldShowJumpLatest({
        hasHistory: chatHistory.length > 0,
        scrollHeight: elements.output.scrollHeight,
        scrollTop: elements.output.scrollTop,
        clientHeight: elements.output.clientHeight,
        threshold: LATEST_SCROLL_THRESHOLD,
    });
}

function scrollToLatest(force = false) {
    if (!force && !isNearBottom()) return;
    elements.output.scrollTo({ top: elements.output.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    elements.jumpLatest.hidden = true;
}

function addMessage(role, content, { historyIndex = null, forceScroll = false } = {}) {
    const shouldScroll = forceScroll || isNearBottom();
    const message = elNew("div", { className: `message is-${role}` });
    renderMarkdown(message, content);

    if (role === "user" && historyIndex !== null) {
        const controls = elNew("div", { className: "message-actions" });
        const retry = iconButton("Retry", "refresh-cw", { type: "button", title: "Regenerate from this message" });
        const edit = iconButton("Edit", "pencil-line", { type: "button", title: "Edit from this message" });
        retry.addEventListener("click", async () => {
            await branchConversation(historyIndex, message);
            await sendMessage(content);
        });
        edit.addEventListener("click", async () => {
            await branchConversation(historyIndex, message);
            elements.input.value = content;
            elements.input.focus();
        });
        controls.append(retry, edit);
        renderIcons(controls);
        message.append(controls);
    }

    elements.output.append(message);
    if (shouldScroll) scrollToLatest(true);
    else updateJumpLatestVisibility();
    return message;
}

function addStatusMessage(text) {
    const message = elNew("div", { className: "message is-system is-thinking" });
    const loader = elNew("span", { className: "activity-dot", ariaHidden: "true" });
    const label = elNew("em", { className: "thinking", textContent: text });
    message.append(loader, " ", label);
    elements.output.append(message);
    scrollToLatest(true);
    return { message, label };
}

function addWelcome() {
    const message = elNew("div", { className: "message is-system is-welcome" });
    message.append(elNew("h3", { textContent: "✨ Hi, I'm Xody" }), elNew("p", { textContent: "I can explain your project, investigate console errors, and update your HTML, CSS, or JavaScript." }));
    elements.output.append(message);
    updateJumpLatestVisibility();
}

function historyEntry(role, content) {
    const trimmed = content.length > HISTORY_ENTRY_MAX_CHARS ? `${content.slice(0, HISTORY_ENTRY_MAX_CHARS)}…` : content;
    return { id: crypto.randomUUID(), role, content: trimmed, createdAt: Date.now() };
}

async function persistHistory() {
    try {
        await saveConversation(currentProjectId, chatHistory);
    } catch (error) {
        console.warn("Could not save AI conversation", error);
    }
}

function pushHistory(role, content) {
    chatHistory.push(historyEntry(role, String(content)));
    if (chatHistory.length > MAX_HISTORY_ENTRIES) chatHistory = chatHistory.slice(-MAX_HISTORY_ENTRIES);
    void persistHistory();
}

async function branchConversation(historyIndex, messageElement) {
    if (activeRequest) stopActiveRequest();
    chatHistory = chatHistory.slice(0, historyIndex);
    let node = messageElement;
    while (node) {
        const next = node.nextElementSibling;
        node.remove();
        node = next;
    }
    updateJumpLatestVisibility();
    await persistHistory();
}

async function setProject(projectId) {
    const sequence = ++projectLoadSequence;
    if (activeRequest) stopActiveRequest();
    currentProjectId = projectId ? String(projectId) : null;
    elements.output.replaceChildren();
    chatHistory = await loadConversation(currentProjectId);
    if (sequence !== projectLoadSequence) return;

    if (!chatHistory.length) {
        addWelcome();
        return;
    }

    chatHistory.forEach((entry, index) => {
        if (entry.role === "user") addMessage("user", entry.content, { historyIndex: index });
        else addMessage("ai", entry.content);
    });
    scrollToLatest(true);
}

function selectedEditorContext() {
    if (!lastActiveEditorPane) return null;
    const textarea = editorTextarea(lastActiveEditorPane);
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) return null;
    return { pane: lastActiveEditorPane, content: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) };
}

function trimForContext(content, limit) {
    if (content.length <= limit) return content;
    const half = Math.floor(limit / 2);
    return `${content.slice(0, half)}\n\n/* … middle omitted to fit the model context … */\n\n${content.slice(-half)}`;
}

function buildSystemPrompt() {
    const values = Object.fromEntries(["html", "css", "js"].map((pane) => [pane, editorValue(pane)]));
    const totalLength = Object.values(values).reduce((total, value) => total + value.length, 0);
    const paneLimit = totalLength > MAX_CONTEXT_CHARS ? Math.floor(MAX_CONTEXT_CHARS / 3) : MAX_CONTEXT_CHARS;
    const selection = selectedEditorContext();
    const consoleOutput = String(getConsoleContext() || "").slice(-12_000);

    return `You are Xody, an expert web developer helping with an HTML/CSS/JavaScript prototype.
The editor's current state is authoritative. Keep explanations short, concrete, and in plain language.
The app immediately applies every non-null pane you return. Describe what you changed without making claims beyond the returned code.
Only include a pane when the user asked for a code change. Return the complete replacement content for every changed pane and null for every unchanged pane.
HTML must contain only markup that belongs inside the BODY element.

Respond with exactly one valid JSON object and no surrounding markdown:
{
  "html": "complete replacement HTML or null",
  "css": "complete replacement CSS or null",
  "js": "complete replacement JavaScript or null",
  "explanation": "brief explanation"
}

CURRENT HTML${values.html.length > paneLimit ? " (context shortened)" : ""}:
\`\`\`html
${trimForContext(values.html, paneLimit)}
\`\`\`

CURRENT CSS${values.css.length > paneLimit ? " (context shortened)" : ""}:
\`\`\`css
${trimForContext(values.css, paneLimit)}
\`\`\`

CURRENT JAVASCRIPT${values.js.length > paneLimit ? " (context shortened)" : ""}:
\`\`\`js
${trimForContext(values.js, paneLimit)}
\`\`\`
${selection ? `\nUSER SELECTION (${selection.pane.toUpperCase()}):\n\`\`\`${selection.pane}\n${trimForContext(selection.content, 50_000)}\n\`\`\`` : ""}
${consoleOutput ? `\nRECENT PREVIEW CONSOLE OUTPUT:\n\`\`\`text\n${consoleOutput}\n\`\`\`` : ""}`;
}

async function readErrorResponse(response, providerLabel) {
    let message = `${providerLabel} request failed (${response.status})`;
    try {
        const data = JSON.parse(await response.text());
        message = data.error?.message || data.message || (typeof data.error === "string" ? data.error : message);
    } catch {
        // Avoid exposing arbitrary HTML error pages or provider diagnostics.
    }
    throw new ProviderError(message, response.status);
}

async function fetchJson(url, options, providerLabel) {
    const response = await fetch(url, options);
    if (!response.ok) await readErrorResponse(response, providerLabel);
    try {
        return await response.json();
    } catch {
        throw new ProviderError(`${providerLabel} returned an unreadable response`, response.status);
    }
}

async function callGemini(config, systemText, history, userPrompt, signal) {
    const data = await fetchJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
        {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemText }] },
                contents: [...history.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] })), { role: "user", parts: [{ text: userPrompt }] }],
                generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
            }),
        },
        PROVIDERS.gemini.label,
    );
    return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

async function callOpenAICompatible(config, systemText, history, userPrompt, signal) {
    const provider = PROVIDERS[config.provider];
    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const data = await fetchJson(
        provider.baseUrl,
        {
            method: "POST",
            signal,
            headers,
            body: JSON.stringify({
                model: config.model,
                messages: [{ role: "system", content: systemText }, ...history.map(({ role, content }) => ({ role, content })), { role: "user", content: userPrompt }],
            }),
        },
        provider.label,
    );
    return data.choices?.[0]?.message?.content || "";
}

async function callAnthropic(config, systemText, history, userPrompt, signal) {
    const data = await fetchJson(
        "https://api.anthropic.com/v1/messages",
        {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
            body: JSON.stringify({
                model: config.model,
                max_tokens: 8192,
                system: systemText,
                messages: [...history.map(({ role, content }) => ({ role, content })), { role: "user", content: userPrompt }],
            }),
        },
        PROVIDERS.anthropic.label,
    );
    return (
        data.content
            ?.filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n") || ""
    );
}

async function getAIConfig() {
    const provider = elements.provider.value;
    return { provider, model: elements.model.value, apiKey: await getApiKey(provider) };
}

function assertReady(config) {
    const provider = PROVIDERS[config.provider];
    if (!provider) throw new Error("Choose a supported AI provider.");
    if (provider.requiresKey !== false && !config.apiKey) throw new Error(`Add a ${provider.label} API key in Options first. ${provider.keyHelp}`);
    if (!config.model) throw new Error(`Choose a ${provider.label} model in Options first.`);
}

async function callAI(config, history, userPrompt, signal, updateProgress) {
    const provider = PROVIDERS[config.provider];
    updateProgress(`Waiting for ${provider.label}…`);
    const systemText = buildSystemPrompt();
    let rawText;
    if (provider.kind === "gemini") rawText = await callGemini(config, systemText, history, userPrompt, signal);
    else if (provider.kind === "anthropic") rawText = await callAnthropic(config, systemText, history, userPrompt, signal);
    else rawText = await callOpenAICompatible(config, systemText, history, userPrompt, signal);

    updateProgress("Checking the response…");
    try {
        return { type: "structured", data: parseAIResponse(rawText) };
    } catch (error) {
        if (!rawText.trim()) throw error;
        return { type: "text", raw: rawText };
    }
}

function setBusy(isBusy) {
    elements.output.setAttribute("aria-busy", String(isBusy));
    elements.input.disabled = isBusy;
    elements.send.hidden = isBusy;
    elements.stop.hidden = !isBusy;
    elements.provider.disabled = isBusy;
    elements.model.disabled = isBusy || !elements.model.options.length;
    elements.modelRefresh.disabled = isBusy || Boolean(modelRequest);
    elements.modelFavorite.disabled = isBusy || !elements.model.value;
    elements.newChat.disabled = isBusy;
}

function stopActiveRequest() {
    activeRequest?.controller.abort(new DOMException("Generation stopped", "AbortError"));
}

function humanizeError(error) {
    if (error?.name === "AbortError") return error.message === "Request timed out" ? "The provider took too long to respond. Try again or choose a faster model." : "Generation stopped.";
    if (error instanceof ProviderError && error.status === 401) return "The provider rejected this API key. Open Options and replace it.";
    if (error instanceof ProviderError && error.status === 429) return "The provider's rate limit was reached. Wait briefly, then retry.";
    if (error instanceof TypeError && /fetch/i.test(error.message)) return "Could not reach the provider. Check your connection and the provider's browser/CORS settings.";
    return error?.message || "Something went wrong. Please try again.";
}

function paneStats(before, after) {
    const beforeLines = before ? before.split("\n").length : 0;
    const afterLines = after ? after.split("\n").length : 0;
    const delta = afterLines - beforeLines;
    return `${beforeLines} → ${afterLines} lines${delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${delta})`}`;
}

function diffPartLines(value) {
    const lines = value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines;
}

function renderPaneDiff(pane, parts) {
    const diff = elNew("div", { className: "diff", ariaLabel: `${pane.toUpperCase()} code diff` });
    const content = elNew("div", { className: "content" });
    let oldLine = 1;
    let newLine = 1;
    let renderedLines = 0;
    let truncated = false;

    const addRow = (kind, text, oldNumber = "", newNumber = "") => {
        if (renderedLines >= MAX_RENDERED_DIFF_LINES) {
            truncated = true;
            return false;
        }
        const marker = kind === "added" ? "+" : kind === "removed" ? "−" : " ";
        const row = elNew("div", { className: `line is-${kind}` });
        if (kind === "skip") {
            row.append(elNew("code", { className: "code", textContent: text }));
        } else {
            row.append(
                elNew("span", { className: "line-number", textContent: oldNumber }),
                elNew("span", { className: "line-number", textContent: newNumber }),
                elNew("span", { className: "marker", textContent: marker }),
                elNew("code", { className: "code", textContent: text || " " }),
            );
        }
        content.append(row);
        renderedLines += 1;
        return true;
    };

    const addCodeLine = (kind, text) => {
        const oldNumber = kind === "added" ? "" : oldLine;
        const newNumber = kind === "removed" ? "" : newLine;
        if (!addRow(kind, text, oldNumber, newNumber)) return false;
        if (kind !== "added") oldLine += 1;
        if (kind !== "removed") newLine += 1;
        return true;
    };

    for (let partIndex = 0; partIndex < parts.length && !truncated; partIndex += 1) {
        const part = parts[partIndex];
        const lines = diffPartLines(part.value);
        const kind = part.added ? "added" : part.removed ? "removed" : "context";

        if (kind !== "context" || lines.length <= DIFF_CONTEXT_LINES * 2) {
            for (const line of lines) {
                if (!addCodeLine(kind, line)) break;
            }
            continue;
        }

        const keepStart = parts[partIndex - 1]?.added || parts[partIndex - 1]?.removed ? DIFF_CONTEXT_LINES : 0;
        const keepEnd = parts[partIndex + 1]?.added || parts[partIndex + 1]?.removed ? DIFF_CONTEXT_LINES : 0;
        const skipped = lines.length - keepStart - keepEnd;

        for (const line of lines.slice(0, keepStart)) {
            if (!addCodeLine(kind, line)) break;
        }
        if (truncated) break;
        if (skipped > 0) {
            addRow("skip", `⋯ ${skipped} unchanged ${skipped === 1 ? "line" : "lines"}`);
            oldLine += skipped;
            newLine += skipped;
        }
        for (const line of lines.slice(lines.length - keepEnd)) {
            if (!addCodeLine(kind, line)) break;
        }
    }

    if (truncated) {
        const notice = elNew("p", { className: "truncated", textContent: `Diff preview limited to ${MAX_RENDERED_DIFF_LINES.toLocaleString()} lines.` });
        content.append(notice);
    }
    diff.append(content);
    return diff;
}

function renderSuggestion(response) {
    const shouldScroll = isNearBottom();
    const message = addMessage("ai", response.explanation);
    const snapshots = Object.fromEntries(["html", "css", "js"].filter((pane) => response[pane] !== null).map((pane) => [pane, { before: editorValue(pane), after: response[pane] }]));
    const changedPanes = Object.keys(snapshots).filter((pane) => snapshots[pane].before !== snapshots[pane].after);
    if (!changedPanes.length) return;

    const review = elNew("section", { className: "suggestion", ariaLabel: "Applied AI code changes" });
    changedPanes.forEach((pane) => {
        const details = elNew("details", { className: "pane" });
        const summary = elNew("summary", { textContent: `${pane.toUpperCase()} · ${paneStats(snapshots[pane].before, snapshots[pane].after)}` });
        const parts = diffLines(snapshots[pane].before, snapshots[pane].after);
        details.append(summary, renderPaneDiff(pane, parts));
        review.append(details);
    });

    const status = elNew("p", { className: "status", ariaLive: "polite" });
    const actions = elNew("div", { className: "suggestion-actions" });
    const undo = iconButton("Undo AI change", "undo-2", { type: "button" });
    const reapply = iconButton("Re-apply AI change", "redo-2", { type: "button", className: "button-primary", hidden: true });
    actions.append(undo, reapply);
    renderIcons(actions);
    review.append(status, actions);
    message.append(review);

    const changeVersion = (from, to) => {
        const conflicts = changedPanes.filter((pane) => editorValue(pane) !== snapshots[pane][from]);
        if (conflicts.length) {
            status.textContent = `${conflicts.join(", ").toUpperCase()} changed afterward. The newer code was preserved.`;
            return false;
        }
        changedPanes.forEach((pane) => bus.emit("ai:update", { syntax: pane, content: snapshots[pane][to] }));
        return true;
    };

    changedPanes.forEach((pane) => bus.emit("ai:update", { syntax: pane, content: snapshots[pane].after }));
    status.textContent = `Applied to ${changedPanes.join(", ").toUpperCase()}.`;

    undo.addEventListener("click", () => {
        if (!changeVersion("after", "before")) return;
        status.textContent = "AI changes undone.";
        undo.hidden = true;
        reapply.hidden = false;
    });
    reapply.addEventListener("click", () => {
        if (!changeVersion("before", "after")) return;
        status.textContent = `Re-applied to ${changedPanes.join(", ").toUpperCase()}.`;
        reapply.hidden = true;
        undo.hidden = false;
    });

    if (shouldScroll) scrollToLatest(true);
    else updateJumpLatestVisibility();
}

function renderTextResponse(rawText) {
    const shouldScroll = isNearBottom();
    const segments = splitMarkdownSegments(rawText);
    const wrapper = elNew("div", { className: "message is-ai fallback" });
    segments.forEach((segment) => {
        if (segment.type === "text") {
            if (!segment.content.trim()) return;
            const prose = elNew("div", { className: "fallback-copy" });
            renderMarkdown(prose, segment.content);
            wrapper.append(prose);
            return;
        }

        const pane = mapLanguageToPane(segment.lang) || sniffPane(segment.code);
        const card = elNew("div", { className: "code-card" });
        const header = elNew("div", { className: "code-header" });
        const insert = iconButton(`Insert in ${pane.toUpperCase()}`, "plus", { type: "button", className: "button-primary" });
        const replace = iconButton(`Replace ${pane.toUpperCase()}`, "replace", { type: "button" });
        const copy = iconButton("Copy", "copy", { type: "button" });
        const status = elNew("span", { className: "status", ariaLive: "polite" });
        header.append(elNew("span", { className: "code-language", textContent: (segment.lang || pane).toUpperCase() }), insert, replace, copy);
        const pre = elNew("pre");
        pre.append(elNew("code", { textContent: segment.code }));
        card.append(header, pre, status);

        insert.addEventListener("click", () => {
            const textarea = editorTextarea(pane);
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            bus.emit("ai:update", { syntax: pane, content: textarea.value.slice(0, start) + segment.code + textarea.value.slice(end) });
            status.textContent = `Inserted into ${pane.toUpperCase()}.`;
        });
        replace.addEventListener("click", () => {
            bus.emit("ai:update", { syntax: pane, content: segment.code });
            status.textContent = `Replaced ${pane.toUpperCase()}.`;
        });
        copy.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(segment.code);
                status.textContent = "Copied.";
            } catch {
                status.textContent = "Copy was blocked by the browser. Select the code manually.";
            }
        });
        wrapper.append(card);
    });
    renderIcons(wrapper);
    elements.output.append(wrapper);
    if (shouldScroll) scrollToLatest(true);
    else updateJumpLatestVisibility();
}

async function sendMessage(message) {
    const userText = String(message ?? elements.input.value).trim();
    if (!userText || activeRequest) return;

    let config;
    try {
        config = await getAIConfig();
        assertReady(config);
    } catch (error) {
        addMessage("ai", `**Cannot send:** ${humanizeError(error)}`, { forceScroll: true });
        return;
    }

    const projectId = currentProjectId;
    const historyBeforeUser = chatHistory.length;
    const providerHistory = chatHistory.map(({ role, content }) => ({ role, content }));
    addMessage("user", userText, { historyIndex: historyBeforeUser, forceScroll: true });
    pushHistory("user", userText);
    elements.input.value = "";

    const progress = addStatusMessage(`Contacting ${PROVIDERS[config.provider].label}…`);
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "AbortError")), REQUEST_TIMEOUT_MS);
    activeRequest = { id: requestId, controller, projectId };
    setBusy(true);

    try {
        const result = await callAI(config, providerHistory, userText, controller.signal, (text) => {
            progress.label.textContent = text;
        });
        if (activeRequest?.id !== requestId || currentProjectId !== projectId) return;
        if (result.type === "structured") {
            renderSuggestion(result.data);
            pushHistory("assistant", summarizeChanges(result.data));
        } else {
            renderTextResponse(result.raw);
            pushHistory("assistant", result.raw);
        }
    } catch (error) {
        if (currentProjectId === projectId) addMessage("ai", `**${humanizeError(error)}**`);
    } finally {
        clearTimeout(timeout);
        progress.message.remove();
        if (activeRequest?.id === requestId) {
            activeRequest = null;
            setBusy(false);
            elements.input.focus();
        }
    }
}

async function fetchModelsGemini(apiKey, signal) {
    const data = await fetchJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { signal, headers: { "x-goog-api-key": apiKey } }, PROVIDERS.gemini.label);
    return (data.models || [])
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => ({ id: model.name.replace("models/", ""), label: model.displayName || model.name }))
        .filter((model) => isChatModel(model.id));
}

async function fetchModelsOpenAICompatible(providerKey, apiKey, signal) {
    const provider = PROVIDERS[providerKey];
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const modelsUrl = provider.modelsUrl || provider.baseUrl.replace(/\/chat\/completions$/, "/models");
    const data = await fetchJson(modelsUrl, { signal, headers }, provider.label);
    return normalizeModelList(data);
}

async function fetchModelsAnthropic(apiKey, signal) {
    const data = await fetchJson(
        "https://api.anthropic.com/v1/models?limit=1000",
        { signal, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } },
        PROVIDERS.anthropic.label,
    );
    return normalizeModelList(data);
}

function appendModelGroup(label, models) {
    const group = elNew("optgroup", { label });
    models.forEach(({ id, label: modelLabel }) => group.append(elNew("option", { value: id, textContent: modelLabel })));
    elements.model.append(group);
}

function updateModelFavoriteButton() {
    const model = elements.model.value;
    const isFavorite = Boolean(model) && favoriteModelIds.has(model);
    elements.modelFavorite.disabled = !model || Boolean(activeRequest);
    elements.modelFavorite.setAttribute("aria-pressed", String(isFavorite));
    elements.modelFavorite.setAttribute("aria-label", isFavorite ? `Remove ${model} from favorites` : `Add ${model} to favorites`);
    elements.modelFavorite.title = isFavorite ? "Remove selected model from favorites" : "Favorite selected model";
}

function renderModelState(state, models = [], favorites = [], preferredModel = "") {
    elements.model.replaceChildren();
    elements.model.disabled = true;
    renderedModels = state === "ready" ? models : [];
    const availableIds = new Set(renderedModels.map(({ id }) => id));
    favoriteModelIds = new Set(favorites.filter((model) => availableIds.has(model)));
    const labels = { "no-key": "Add an API key to load models…", loading: "Loading models…", error: "Couldn't load models — check the key or CORS", empty: "No compatible chat models found" };
    if (state !== "ready") {
        elements.model.append(elNew("option", { value: "", textContent: labels[state] || "Models unavailable" }));
        updateModelFavoriteButton();
        updateModelLabel();
        return;
    }
    const favoriteModels = models.filter(({ id }) => favoriteModelIds.has(id));
    if (favoriteModels.length) appendModelGroup("Favorites", favoriteModels);
    appendModelGroup("All models", models);
    const savedModel = settings.models?.[elements.provider.value];
    if (preferredModel && availableIds.has(preferredModel)) elements.model.value = preferredModel;
    else if (savedModel && availableIds.has(savedModel)) elements.model.value = savedModel;
    else if (models[0]) {
        elements.model.value = models[0].id;
        settings = { ...settings, models: { ...settings.models, [elements.provider.value]: models[0].id } };
        void updateChatSettings({ models: { [elements.provider.value]: models[0].id } });
    }
    elements.model.disabled = Boolean(activeRequest);
    updateModelFavoriteButton();
    updateModelLabel();
}

function updateModelLabel() {
    const provider = PROVIDERS[elements.provider.value];
    const model = elements.model.value;
    elements.modelLabel.textContent = model ? model.replace(/-/g, " ") : provider?.label || "Options";
    elements.modelLabel.title = model ? `${provider?.label} · ${model}` : provider?.label || "AI options";
}

async function refreshKeyStatus(providerKey) {
    const provider = PROVIDERS[providerKey];
    elements.apiKey.value = "";
    elements.apiKey.type = "password";
    elements.toggleKey.textContent = "Show typed key";
    if (provider.requiresKey === false) {
        elements.apiKey.disabled = true;
        elements.rememberKey.disabled = true;
        elements.toggleKey.disabled = true;
        elements.clearKey.disabled = true;
        elements.keyStatus.textContent = provider.keyHelp;
        return;
    }
    const [available, remembered] = await Promise.all([hasApiKey(providerKey), isApiKeyRemembered(providerKey)]);
    if (elements.provider.value !== providerKey) return;
    elements.apiKey.disabled = false;
    elements.rememberKey.disabled = false;
    elements.toggleKey.disabled = false;
    elements.clearKey.disabled = !available;
    elements.rememberKey.checked = remembered;
    elements.apiKey.placeholder = available ? (remembered ? "Encrypted key saved" : "Key available for this session") : provider.keyPlaceholder;
    elements.keyStatus.textContent = available ? (remembered ? "This key is encrypted in IndexedDB on this device." : "This key will be forgotten when the page closes.") : provider.keyHelp;
}

async function refreshModelOptions(providerKey, { force = false } = {}) {
    modelRequest?.abort();
    const controller = new AbortController();
    modelRequest = controller;
    elements.modelRefresh.disabled = true;
    const finish = () => {
        if (modelRequest !== controller) return;
        modelRequest = null;
        if (elements.provider.value === providerKey) elements.modelRefresh.disabled = Boolean(activeRequest);
    };
    const provider = PROVIDERS[providerKey];
    const apiKey = await getApiKey(providerKey);
    if (elements.provider.value !== providerKey) {
        finish();
        return;
    }
    if (provider.requiresKey !== false && !apiKey) {
        renderModelState("no-key");
        finish();
        return;
    }

    const fingerprint = await credentialFingerprint(apiKey);
    const [cached, favorites] = await Promise.all([getModelCache(providerKey), getFavoriteModels(providerKey)]);
    if (!force && cached?.catalogVersion === MODEL_CATALOG_VERSION && cached.credentialFingerprint === fingerprint && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL) {
        renderModelState("ready", cached.models, favorites);
        finish();
        return;
    }

    renderModelState("loading");
    try {
        let models;
        if (provider.kind === "gemini") models = await fetchModelsGemini(apiKey, controller.signal);
        else if (provider.kind === "anthropic") models = await fetchModelsAnthropic(apiKey, controller.signal);
        else models = await fetchModelsOpenAICompatible(providerKey, apiKey, controller.signal);
        if (controller.signal.aborted || elements.provider.value !== providerKey) return;
        const currentFavorites = await reconcileFavoriteModels(
            providerKey,
            models.map(({ id }) => id),
        );
        if (controller.signal.aborted || elements.provider.value !== providerKey) return;
        if (!models.length) {
            renderModelState("empty");
            return;
        }
        await setModelCache(providerKey, { catalogVersion: MODEL_CATALOG_VERSION, models, fetchedAt: Date.now(), credentialFingerprint: fingerprint });
        renderModelState("ready", models, currentFavorites);
    } catch (error) {
        if (error.name !== "AbortError" && elements.provider.value === providerKey) renderModelState("error");
    } finally {
        finish();
    }
}

async function loadProvider(providerKey) {
    elements.apiKey.placeholder = PROVIDERS[providerKey].keyPlaceholder;
    await refreshKeyStatus(providerKey);
    if (elements.provider.value !== providerKey) return;
    await refreshModelOptions(providerKey);
}

function updateContextStatus() {
    const selection = selectedEditorContext();
    const consoleText = String(getConsoleContext() || "");
    const parts = [selection ? `${selection.pane.toUpperCase()} selection included` : "Current project included"];
    if (consoleText) parts.push("recent console output included");
    elements.contextStatus.textContent = parts.join(" · ");
    elements.explainSelection.hidden = !selection;
    elements.fixConsole.hidden = !hasConsoleErrors();
}

function wireEvents() {
    for (const pane of ["html", "css", "js"]) {
        editorTextarea(pane)?.addEventListener("focus", () => {
            lastActiveEditorPane = pane;
            updateContextStatus();
        });
    }
    elements.input.addEventListener("focus", () => {
        elements.options.open = false;
        updateContextStatus();
    });
    document.addEventListener("pointerdown", (event) => {
        if (elements.options.open && !elements.options.contains(event.target)) elements.options.open = false;
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !elements.options.open) return;
        elements.options.open = false;
        elements.options.querySelector("summary")?.focus();
    });
    elements.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void sendMessage();
        }
    });
    elements.send.addEventListener("click", () => void sendMessage());
    elements.stop.addEventListener("click", stopActiveRequest);
    elements.toggleKey.addEventListener("click", () => {
        const isVisible = elements.apiKey.type === "text";
        elements.apiKey.type = isVisible ? "password" : "text";
        elements.toggleKeyLabel.textContent = isVisible ? "Show typed key" : "Hide typed key";
        elements.toggleKey.querySelector("[data-lucide]")?.replaceWith(iconElement(isVisible ? "eye" : "eye-off"));
        renderIcons(elements.toggleKey);
    });
    elements.jumpLatest.addEventListener("click", () => scrollToLatest(true));
    elements.output.addEventListener("scroll", updateJumpLatestVisibility, { passive: true });
    feedResizeObserver?.disconnect();
    feedResizeObserver = new ResizeObserver(updateJumpLatestVisibility);
    feedResizeObserver.observe(elements.output);
    elements.newChat.addEventListener("click", async () => {
        if (chatHistory.length && !confirm("Clear this project's AI conversation? Your project code will not be changed.")) return;
        chatHistory = [];
        await clearConversation(currentProjectId);
        elements.output.replaceChildren();
        addWelcome();
    });
    document.querySelectorAll("[data-chat-prompt]").forEach((button) => button.addEventListener("click", () => void sendMessage(button.dataset.chatPrompt)));
    elements.provider.addEventListener("change", async () => {
        const provider = elements.provider.value;
        settings = await updateChatSettings({ provider });
        if (elements.provider.value === provider) await loadProvider(provider);
    });
    elements.model.addEventListener("change", async () => {
        const provider = elements.provider.value;
        const model = elements.model.value;
        updateModelFavoriteButton();
        settings = await updateChatSettings({ models: { [provider]: model } });
        updateModelLabel();
    });
    elements.modelRefresh.addEventListener("click", () => {
        void refreshModelOptions(elements.provider.value, { force: true });
    });
    elements.modelFavorite.addEventListener("click", async () => {
        const provider = elements.provider.value;
        const model = elements.model.value;
        if (!model) return;
        elements.modelFavorite.disabled = true;
        try {
            const favorites = await setModelFavorite(provider, model, !favoriteModelIds.has(model));
            if (elements.provider.value !== provider || elements.model.value !== model) return;
            renderModelState("ready", renderedModels, favorites, model);
        } catch (error) {
            console.warn("Could not update favorite AI model", error);
            if (elements.provider.value === provider && elements.model.value === model) updateModelFavoriteButton();
        }
    });
    elements.apiKey.addEventListener("change", async () => {
        const provider = elements.provider.value;
        const value = elements.apiKey.value.trim();
        if (!value) return;
        await saveApiKey(provider, value, { remember: elements.rememberKey.checked });
        if (elements.provider.value !== provider) return;
        elements.apiKey.value = "";
        await refreshKeyStatus(provider);
        if (elements.provider.value === provider) await refreshModelOptions(provider);
    });
    elements.rememberKey.addEventListener("change", async () => {
        const provider = elements.provider.value;
        const remember = elements.rememberKey.checked;
        const key = elements.apiKey.value.trim() || (await getApiKey(provider));
        if (key) await saveApiKey(provider, key, { remember });
        if (elements.provider.value === provider) await refreshKeyStatus(provider);
    });
    elements.clearKey.addEventListener("click", async () => {
        const provider = elements.provider.value;
        await clearApiKey(provider);
        if (elements.provider.value !== provider) return;
        await refreshKeyStatus(provider);
        renderModelState("no-key");
    });
    bus.on("project:changed", async ({ id }) => {
        await setProject(id);
        updateContextStatus();
    });
    bus.on("project:deleted", ({ id }) => void clearConversation(id));
    bus.on("project:rekeyed", async ({ oldId, newId }) => {
        await moveConversation(oldId, newId);
        if (currentProjectId === String(oldId)) await setProject(newId);
    });
    bus.on("console:changed", updateContextStatus);
    document.addEventListener("selectionchange", updateContextStatus);
}

export async function init(options) {
    editors = options.editors || options;
    getProjectId = options.getProjectId || (() => null);
    getConsoleContext = options.getConsoleContext || (() => "");
    hasConsoleErrors = options.hasConsoleErrors || (() => false);
    await initChatStorage();

    if (!initialized) {
        Object.entries(PROVIDERS).forEach(([key, provider]) => elements.provider.append(elNew("option", { value: key, textContent: provider.label })));
        wireEvents();
        initialized = true;
    }

    settings = await getChatSettings();
    elements.provider.value = PROVIDERS[settings.provider] ? settings.provider : "gemini";
    await loadProvider(elements.provider.value);
    await setProject(getProjectId());
    updateContextStatus();
    updateJumpLatestVisibility();
}

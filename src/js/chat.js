import { el, elNew, LS } from "./utils.js";
import { bus } from './bus.js';
import DOMPurify from 'dompurify';
import { marked } from 'marked';


// Provider registry — static config only (labels, endpoints, key help).
// Model lists are NOT hardcoded here; they're fetched live per-provider
// once an API key is present (see "Live model discovery" below), since
// hardcoded model IDs go stale the moment a provider deprecates one.
const PROVIDERS = {
    gemini: {
        label: "Google Gemini",
        kind: "gemini",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://aistudio.google.com/app/api-keys" target="_blank">aistudio.google.com/app/api-keys</a>`
    },
    openai: {
        label: "OpenAI",
        kind: "openai-compatible",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com/api-keys</a>`
    },
    anthropic: {
        label: "Anthropic Claude",
        kind: "anthropic",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>`
    },
    xai: {
        label: "xAI Grok",
        kind: "openai-compatible",
        baseUrl: "https://api.x.ai/v1/chat/completions",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://console.x.ai" target="_blank">console.x.ai</a>`
    },
    mistral: {
        label: "Mistral",
        kind: "openai-compatible",
        baseUrl: "https://api.mistral.ai/v1/chat/completions",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://console.mistral.ai/api-keys" target="_blank">console.mistral.ai</a>`
    }
};

function extractFirstJsonObject(text) {
    const start = text.indexOf('{');
    if (start === -1) throw new Error("No JSON found in response");

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < text.length; i++) {
        const char = text[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (char === '\\') {
            escapeNext = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (char === '{') depth++;
        if (char === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1); // exact matching object, garbage after ignored
            }
        }
    }

    throw new Error("Unbalanced JSON braces in response");
}

function tryParseAIJson(rawText) {
    let text = rawText.trim();
    text = text.replace(/```json\s*/i, '').replace(/```\s*$/, '').trim();

    const jsonStr = extractFirstJsonObject(text); // was: text.match(/\{[\s\S]*\}/)[0]

    try {
        return JSON.parse(jsonStr);
    } catch (err) {
        const repaired = jsonStr.replace(/"((?:[^"\\]|\\.)*)"/gs, (match, inner) => {
            const fixed = inner
                .replace(/\\/g, '\\\\')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');
            return `"${fixed}"`;
        });
        try {
            return JSON.parse(repaired);
        } catch (err2) {
            console.error("Raw AI response that failed to parse:", rawText);
            throw new Error("AI returned malformed JSON — couldn't repair automatically");
        }
    }
}

// Storage: keyed by provider so keys don't collide
const ls = LS("xode.settings", {
    provider: "gemini",
    model: "",   // no default — populated once a live model list loads
    apiKeys: {}  // { gemini: "...", openai: "...", anthropic: "...", ... }
});

// Cache of live-fetched model lists, keyed by provider.
// { [providerKey]: { models: [{id,label}], fetchedAt: number, forKey: string } }
const modelCache = LS("xode.modelCache", {});
const MODEL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

function setApiKey(provider, key) {
    const settings = ls.get();
    settings.apiKeys = settings.apiKeys || {};
    settings.apiKeys[provider] = key;
    ls.set(settings);
}

const getAIConfig = () => {
    const settings = ls.get();
    return {
        provider: settings.provider,
        model: elModel.value,
        apiKey: (settings.apiKeys || {})[settings.provider] || ""
    };
};

// DOM refs
const elProvider = el(".chat-provider");
const elApiKey = el(".chat-apiKey");
const elModel = el(".chat-model");
const elInput = el(".chat-input");
const elOutput = el(".chat-output");
const elSend = el(".chat-send");

// Prompt
const systemPrompt = () => `You are an expert web developer helping edit an HTML/CSS/JS prototype.
Current code:
HTML:
\`\`\`html
${el(`[data-rx="html"]`).value}
\`\`\`

CSS:
\`\`\`css
${el(`[data-rx="css"]`).value}
\`\`\`

JS:
\`\`\`js
${el(`[data-rx="js"]`).value}
\`\`\`

Keep the explanation to 1-3 sentences, plain language, no code fences inside "explanation".

Respond **only** with valid JSON (no extra text, no markdown, no code fences).
All string values must have newlines escaped as \\n and double quotes inside code escaped as \\" — the output must be valid, parseable JSON:
{
  "html": "full new html or null if unchanged",
  "css": "full new css or null",
  "js": "full new js or null",
  "explanation": "brief explanation of changes"
}

Only return changed panes as full strings. Keep the code functional.`;

// ADAPTERS (chat calls)

async function callGemini(config, fullPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
        })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Gemini request failed");
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callOpenAICompatible(config, fullPrompt) {
    const { baseUrl } = PROVIDERS[config.provider];
    const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: fullPrompt }]
        })
    });

    if (!res.ok) {
        const raw = await res.text();
        console.error(`${config.provider} error response:`, raw);
        let message = `${config.provider} request failed (${res.status})`;
        try {
            const parsed = JSON.parse(raw);
            message = parsed.error?.message || parsed.message || parsed.error || message;
        } catch { /* raw wasn't JSON, keep the generic message but it's logged above */ }
        throw new Error(message);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
}

async function callAnthropic(config, fullPrompt) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
            model: config.model,
            max_tokens: 4096,
            messages: [{ role: "user", content: fullPrompt }]
        })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Anthropic request failed");
    return data.content?.find(b => b.type === "text")?.text || "";
}

// Main AI call, dispatches by provider kind
async function callAI(userPrompt) {
    const config = getAIConfig();
    const providerInfo = PROVIDERS[config.provider];

    if (!config.apiKey) {
        addMessage("ai", `❌ Error<br>Please set your ${providerInfo.label} API key first.<br>${providerInfo.keyHelp}`);
        return null;
    }
    if (!config.model) {
        addMessage("ai", `❌ Error<br>No model selected. Make sure your ${providerInfo.label} API key is valid so models can load.`);
        return null;
    }

    const fullPrompt = `${systemPrompt()}\n\nUser request: ${userPrompt}`;

    try {
        let text;
        if (providerInfo.kind === "gemini") text = await callGemini(config, fullPrompt);
        else if (providerInfo.kind === "anthropic") text = await callAnthropic(config, fullPrompt);
        else text = await callOpenAICompatible(config, fullPrompt);
        console.log("AI response text:", text);
        return tryParseAIJson(text);

    } catch (err) {
        console.error("Error in callAI:", err);
        addMessage("ai", `❌ Error: ${err.message}`);
        return null;
    }
}

// Chat flow
async function sendMessage() {
    const userText = elInput.value.trim();
    if (!userText) return;

    addMessage('user', userText);
    elInput.value = "";

    const thinkingId = 'thinking-msg-' + Date.now();
    addMessage('system', '<em class="thinking">Thinking...</em>', thinkingId);

    try {
        const currentCode = {
            html: el(`[data-rx="html"]`).value,
            css: el(`[data-rx="css"]`).value,
            js: el(`[data-rx="js"]`).value
        };
        const aiResponse = await callAI(
            userText + `\n\nCurrent code: ${JSON.stringify(currentCode)}`
        );
        if (aiResponse) {
            renderSuggestion(aiResponse);
        } else {
            addMessage('ai', "Sorry, I couldn't process that request.");
        }
    } catch (err) {
        addMessage('ai', `❌ ${err.message || "Something went wrong. Please try again."}`);
        console.error(err);
    } finally {
        removeThinkingMessage(thinkingId);
    }
}

// Tracks the most recent auto-applied suggestion's message element,
// so we can invalidate its Discard button once a newer change lands on top of it.
let lastAppliedMsgEl = null;

function renderSuggestion(aiResponse) {
    const changedPanes = ['html', 'css', 'js'].filter(k => aiResponse[k] !== null && aiResponse[k] !== undefined);

    if (!changedPanes.length) {
        addMessage('ai', `${aiResponse.explanation || 'No changes needed.'}`);
        return;
    }

    // 0. Snapshot current pane values BEFORE applying
    const snapshot = {};
    changedPanes.forEach((syntax) => {
        snapshot[syntax] = el(`[data-rx="${syntax}"]`).value;
    });

    // 1. Apply immediately one Editor pane at a time
    changedPanes.forEach((syntax) => {
        bus.emit('ai:update', { syntax, content: aiResponse[syntax] });
    });

    // A newer change just landed on top of any previous pending one — freeze its Discard button
    if (lastAppliedMsgEl) {
        const prevActions = el('.suggestion-actions', lastAppliedMsgEl);
        if (prevActions) {
            prevActions.innerHTML = `<span class="suggestion-superseded">Superseded by a later change</span>`;
        }
    }

    const msgEl = addMessage('system', `
        <p>${aiResponse.explanation || 'Change applied.'}</p>
        <div class="suggestion-actions">
            <span class="suggestion-panes">✓ Applied to: ${changedPanes.join(', ').toUpperCase()}</span>
            <button class="btn-discard accent">Discard</button>
        </div>
    `);

    el('.btn-discard', msgEl)?.addEventListener('click', () => {
        changedPanes.forEach((syntax) => {
            bus.emit('ai:update', { syntax, content: snapshot[syntax] });
        });
        el('.suggestion-actions', msgEl).innerHTML = `<span class="suggestion-discarded">Discarded — reverted to previous version</span>`;

        if (lastAppliedMsgEl === msgEl) lastAppliedMsgEl = null;
    });

    lastAppliedMsgEl = msgEl;
}

function addMessage(role, content, customId = null) {
    const elMessage = elNew('div', {
        className: `chat-message role-${role}`,
    });
    if (customId) elMessage.id = customId;

    if (role === "system") {
        elMessage.innerHTML = content;
    } else {
        // All other roles (user, ai) render through markdown + sanitize.
        // Safety comes from DOMPurify's allowlist, not from skipping markdown.
        const html = marked.parse(content, { breaks: true });
        elMessage.innerHTML = DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'code', 'pre', 'ul', 'ol', 'li', 'br', 'blockquote', 'h1', 'h2', 'h3'],
            ALLOWED_ATTR: ['href', 'target', 'rel']
        });
    }

    elOutput.append(elMessage);
    elOutput.scrollTo({ top: elOutput.scrollHeight, behavior: 'smooth' });

    return elMessage;
}

function removeThinkingMessage(id) {
    const thinkingMsg = document.getElementById(id);
    if (thinkingMsg) thinkingMsg.remove();
}

// Events
elInput.addEventListener('keydown', function (evt) {
    if (evt.key === 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        if (elInput.value.trim()) {
            sendMessage();
        }
    }
});
elSend.addEventListener("click", sendMessage);

// ============================================================
// Live model discovery
// ============================================================
// No hardcoded model IDs anywhere below — model lists are always fetched
// live from each provider once an API key is present. If a fetch fails,
// the UI shows an explicit error state rather than silently falling back
// to a stale, possibly-deprecated model ID.

// Patterns for non-chat models (image/video/audio/embedding/etc.) and
// unpinned "-latest" aliases, excluded so saved projects stay reproducible
// when reopened later (an alias could silently repoint to a new model).
const CHAT_EXCLUDE_PATTERNS = [
    /tts/i, /image/i, /native-audio/i, /embedding/i, /embed/i, /robotics/i,
    /computer-use/i, /aqa/i, /antigravity/i, /deep-research/i,
    /lyria/i, /veo/i, /imagen/i, /nano-banana/i,
    /-latest$/i, /customtools/i,
    /whisper/i, /dall-e/i, /moderation/i, /davinci|babbage|curie|ada-/i // legacy OpenAI non-chat
];

function isChatModel(id) {
    return !CHAT_EXCLUDE_PATTERNS.some(re => re.test(id));
}

async function fetchModelsGemini(apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch Gemini models");
    const data = await res.json();
    return data.models
        .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
        .map(m => ({ id: m.name.replace("models/", ""), label: m.displayName || m.name }))
        .filter(m => isChatModel(m.id));
}

async function fetchModelsOpenAICompatible(providerKey, apiKey) {
    const { baseUrl } = PROVIDERS[providerKey];
    const listUrl = baseUrl.replace(/\/chat\/completions$/, "/models");
    const res = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) throw new Error(`Failed to fetch ${providerKey} models`);
    const data = await res.json();
    return data.data
        .map(m => ({ id: m.id, label: m.id.replace(/-/g, " ") }))
        .filter(m => isChatModel(m.id));
}

async function fetchModelsAnthropic(apiKey) {
    const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
        }
    });
    if (!res.ok) throw new Error("Failed to fetch Anthropic models");
    const data = await res.json();
    return data.data.map(m => ({ id: m.id, label: m.display_name || m.id }));
}

const MODEL_FETCHERS = {
    gemini: (providerKey, apiKey) => fetchModelsGemini(apiKey),
    "openai-compatible": (providerKey, apiKey) => fetchModelsOpenAICompatible(providerKey, apiKey),
    anthropic: (providerKey, apiKey) => fetchModelsAnthropic(apiKey)
};

// Renders one of five explicit states into the model <select>.
// state: "no-key" | "loading" | "error" | "empty" | "ready"
// payload: array of {id, label} — only used when state === "ready"
function renderModelState(state, payload) {
    elModel.innerHTML = "";
    elModel.disabled = true;

    if (state === "no-key") {
        elModel.append(elNew("option", { value: "", textContent: "Enter an API key to load models…" }));
    } else if (state === "loading") {
        elModel.append(elNew("option", { value: "", textContent: "Loading models…" }));
    } else if (state === "error") {
        elModel.append(elNew("option", { value: "", textContent: "Couldn't load models — check your key" }));
    } else if (state === "empty") {
        elModel.append(elNew("option", { value: "", textContent: "No models available" }));
    } else if (state === "ready") {
        elModel.disabled = false;
        payload.forEach(({ id, label }) => {
            elModel.append(elNew("option", { value: id, textContent: label }));
        });
    }
}

// Loads the model list for a provider into elModel.
// Uses a 24h cache (keyed to the exact API key used) to avoid refetching
// on every provider switch; otherwise fetches live and shows explicit
// loading/error states while doing so.
async function refreshModelOptions(providerKey, apiKey) {
    if (!apiKey) {
        renderModelState("no-key");
        return;
    }

    const cache = modelCache.get();
    const cached = cache[providerKey];
    const isFresh = cached && cached.forKey === apiKey && (Date.now() - cached.fetchedAt) < MODEL_CACHE_TTL;
    if (isFresh) {
        renderModelState("ready", cached.models);
        return;
    }

    renderModelState("loading");

    try {
        const fetcher = MODEL_FETCHERS[PROVIDERS[providerKey].kind];
        const models = await fetcher(providerKey, apiKey);

        if (!models.length) {
            renderModelState("empty");
            return;
        }

        cache[providerKey] = { models, fetchedAt: Date.now(), forKey: apiKey };
        modelCache.set(cache);
        renderModelState("ready", models);
    } catch (err) {
        console.warn(`Model fetch failed for ${providerKey}:`, err.message);
        renderModelState("error");
    }
}

// ============================================================
// Provider / model / key wiring
// ============================================================

// Populate provider <select> once
Object.entries(PROVIDERS).forEach(([key, p]) => {
    elProvider.append(elNew("option", { value: key, textContent: p.label }));
});

async function loadProviderIntoUI(providerKey) {
    const settings = ls.get();
    const apiKey = (settings.apiKeys || {})[providerKey] || "";

    elApiKey.placeholder = PROVIDERS[providerKey].keyPlaceholder;
    elApiKey.value = apiKey;

    await refreshModelOptions(providerKey, apiKey);

    // restore last-used model for this provider if it's still present in the loaded list
    const savedModel = settings.model;
    if (savedModel && [...elModel.options].some(o => o.value === savedModel)) {
        elModel.value = savedModel;
    }
}

elProvider.addEventListener("change", async () => {
    const settings = ls.get();
    settings.provider = elProvider.value;
    ls.set(settings);
    await loadProviderIntoUI(elProvider.value);
});

elModel.addEventListener("change", () => {
    const settings = ls.get();
    settings.model = elModel.value;
    ls.set(settings);
});

elApiKey.addEventListener("change", async () => {
    setApiKey(elProvider.value, elApiKey.value);
    await refreshModelOptions(elProvider.value, elApiKey.value);
});

// === Init ================================================================
(async () => {
    const initialSettings = ls.get();
    elProvider.value = initialSettings.provider || "gemini";
    await loadProviderIntoUI(elProvider.value);

    addMessage("system", `<h3>✨︎ Hi, I'm Xody</h3>your AI assistant.<br>Choose a provider, enter your API key, and ask a question to get started.`);
})();
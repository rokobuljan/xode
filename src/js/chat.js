import { el, elNew, LS } from "./utils.js";
import { bus } from './bus.js';
import DOMPurify from 'dompurify';
import { marked } from 'marked';


// Provider registry
const PROVIDERS = {
    gemini: {
        label: "Google Gemini",
        kind: "gemini",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://aistudio.google.com/app/api-keys" target="_blank">aistudio.google.com/app/api-keys</a>`,
        models: ["gemini-3-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash"]
    },
    openai: {
        label: "OpenAI",
        kind: "openai-compatible",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com/api-keys</a>`,
        models: ["gpt-5.5", "gpt-5.5-mini"]
    },
    anthropic: {
        label: "Anthropic Claude",
        kind: "anthropic",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>`,
        models: ["claude-sonnet-5", "claude-haiku-4-5-20251001"]
    },
    xai: {
        label: "xAI Grok",
        kind: "openai-compatible",
        baseUrl: "https://api.x.ai/v1/chat/completions",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://console.x.ai" target="_blank">console.x.ai</a>`,
        models: ["grok-4.3", "grok-4-fast"]
    },
    mistral: {
        label: "Mistral",
        kind: "openai-compatible",
        baseUrl: "https://api.mistral.ai/v1/chat/completions",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://console.mistral.ai/api-keys" target="_blank">console.mistral.ai</a>`,
        models: ["mistral-large-latest", "mistral-small-latest"]
    },
    deepseek: {
        label: "DeepSeek",
        kind: "openai-compatible",
        baseUrl: "https://api.deepseek.com/chat/completions",
        keyPlaceholder: "Key",
        keyHelp: `Create one at <a href="https://platform.deepseek.com/api_keys" target="_blank">platform.deepseek.com</a>`,
        models: ["deepseek-chat", "deepseek-coder"]
    }
};

// Storage: keyed by provider so keys don't collide
const ls = LS("xode.settings", {
    provider: "gemini",
    model: "gemini-3.5-flash",
    apiKeys: {}   // { gemini: "...", openai: "...", anthropic: "...", ... }
});

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

Respond **only** with **valid JSON** (no extra text, no markdown):
{
  "html": "full new html or null if unchanged",
  "css": "full new css or null",
  "js": "full new js or null",
  "explanation": "brief explanation of changes"
}

Only return changed panes as full strings. Keep the code functional.`;

// ADAPTERS

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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `${config.provider} request failed`);
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

    const fullPrompt = `${systemPrompt()}\n\nUser request: ${userPrompt}`;

    try {
        let text;
        if (providerInfo.kind === "gemini") text = await callGemini(config, fullPrompt);
        else if (providerInfo.kind === "anthropic") text = await callAnthropic(config, fullPrompt);
        else text = await callOpenAICompatible(config, fullPrompt);

        text = text.trim();
        text = text.replace(/```json\s*/i, '').replace(/```\s*$/, '').trim();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in response");

        return JSON.parse(jsonMatch[0]);

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
    addMessage('ai', '<em class="thinking">Thinking...</em>', thinkingId);

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

// Provider / model / key wiring

// Populate provider <select> once
Object.entries(PROVIDERS).forEach(([key, p]) => {
    elProvider.append(elNew("option", { value: key, textContent: p.label }));
});

function refreshModelOptions(providerKey) {
    elModel.innerHTML = "";
    PROVIDERS[providerKey].models.forEach(model => {
        elModel.append(elNew("option", {
            value: model,
            textContent: model.replace(/-/g, " ")
        }));
    });
}

function loadProviderIntoUI(providerKey) {
    refreshModelOptions(providerKey);

    const settings = ls.get();
    // restore last-used model for this provider if it's still valid, else default to first
    const savedModel = settings.model;
    if (savedModel && PROVIDERS[providerKey].models.includes(savedModel)) {
        elModel.value = savedModel;
    } else {
        elModel.value = PROVIDERS[providerKey].models[0];
    }

    elApiKey.placeholder = PROVIDERS[providerKey].keyPlaceholder;
    elApiKey.value = (settings.apiKeys || {})[providerKey] || "";
}

elProvider.addEventListener("change", () => {
    const settings = ls.get();
    settings.provider = elProvider.value;
    ls.set(settings);
    loadProviderIntoUI(elProvider.value);
});

elModel.addEventListener("change", () => {
    const settings = ls.get();
    settings.model = elModel.value;
    ls.set(settings);
});

elApiKey.addEventListener("change", () => setApiKey(elProvider.value, elApiKey.value));

// === Init ================================================================
const initialSettings = ls.get();
elProvider.value = initialSettings.provider || "gemini";
loadProviderIntoUI(elProvider.value);

addMessage("system", `<h3>✨︎ Hi, I'm Xody</h3>your AI assistant.<br>Choose a provider, enter your API key, and ask a question to get started.`);

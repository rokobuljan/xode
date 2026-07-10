import { el, elNew, LS } from "./utils.js";
const ls = LS("xode.settings", { apiKey: "" });

const geminiModels = [
    "gemini-3-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
];


const getAIConfig = () => {
    return {
        apiKey: ls.get().apiKey,
        provider: "gemini",
        model: elModel.value,
    };
};


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

Respond **only** with valid JSON (no extra text, no markdown):
{
  "html": "full new html or null if unchanged",
  "css": "full new css or null",
  "js": "full new js or null",
  "explanation": "brief explanation of changes"
}

Only return changed panes as full strings. Keep the code functional.`;


async function callAI(userPrompt) {
    const config = getAIConfig();
    if (!config.apiKey) {
        alert("Please set your Gemini API key first.");
        return null;
    }

    const fullPrompt = `${systemPrompt()}\n\nUser request: ${userPrompt}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }],
                generationConfig: {
                    temperature: 0.1,        // Lower = more consistent
                    responseMimeType: "application/json"   // ← Very important!
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("API Error:", data);
            throw new Error(data.error?.message || "API request failed");
        }

        let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // === Improved JSON extraction ===
        text = text.trim();

        // Remove markdown code blocks if present
        text = text.replace(/```json\s*/i, '').replace(/```\s*$/, '').trim();

        // Try to find JSON object in the text
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in response");

        const cleanJson = jsonMatch[0];
        const aiResponse = JSON.parse(cleanJson);

        return aiResponse;

    } catch (err) {
        console.error("Error in callAI:", err);
        addMessage("ai", `❌ Error: ${err.message}`);
        return null;
    }
}


async function sendMessage() {
    const userText = elInput.value.trim();
    if (!userText) return;

    addMessage('user', userText);
    elInput.value = '';

    // Show Thinking message
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

        // Remove thinking message
        removeThinkingMessage(thinkingId);

        console.log({ aiResponse });

        if (aiResponse) {
            addMessage('ai', aiResponse.explanation || 'Code updated successfully');

            if (aiResponse.html !== null) el(`[data-rx="html"]`).value = aiResponse.html;
            if (aiResponse.css !== null) el(`[data-rx="css"]`).value = aiResponse.css;
            if (aiResponse.js !== null) el(`[data-rx="js"]`).value = aiResponse.js;
        } else {
            addMessage('ai', "Sorry, I couldn't process that request.");
        }
    } catch (err) {
        removeThinkingMessage(thinkingId);
        addMessage('ai', `❌ ${err.message || "Something went wrong. Please try again."}`);
        console.error(err);
    }
}

function addMessage(role, content, customId = null) {
    const elMessage = elNew('div', {
        className: `chat-message role-${role}`,
        innerHTML: content
    });
    if (customId) elMessage.id = customId;
    elOutput.append(elMessage);
    elOutput.scrollTo({ top: elOutput.scrollHeight, behavior: 'smooth' });

    return elMessage;
}

function removeThinkingMessage(id) {
    const thinkingMsg = document.getElementById(id);
    if (thinkingMsg) thinkingMsg.remove();
}

// Init

const elApiKey = el("#chat-apiKey");
const elModel = el("#chat-model");
const elInput = el(".chat-input");
const elOutput = el(".chat-output");
const elSend = el(".chat-send");

// Events
elInput.addEventListener('keydown', function (evt) {
    if (evt.key === 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        if (elInput.value.trim() !== '') {
            sendMessage();
        }
    }
});
elSend.addEventListener("click", sendMessage);

// Hello message:
addMessage("system", `<h3>✨&#xfe0e; Hi, I'm <b>Xody</b></h3>your Xode's AI assistant.<br>Enter your API key, ask a question to get started.`);

// Save API key to LS xode.apiKey
elApiKey.addEventListener("change", () => {
    ls.set({ apiKey: elApiKey.value });
});
// Ready API key if any
const apiKey = ls.get().apiKey;
elApiKey.value = apiKey;

// Create <option> models

geminiModels.forEach(model => {
    const option = elNew("option", {
        value: model,
        textContent: model.replace(/-/g, " "),
    });
    elModel.append(option);
});
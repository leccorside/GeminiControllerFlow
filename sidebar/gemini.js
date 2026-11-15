// Cliente mínimo da API do Gemini (Google AI Studio / generativelanguage.googleapis.com).
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Nível de raciocínio ("low" | "medium" | "high"; vazio = padrão do modelo) -> thinkingConfig.
// Gemini 3+ usa thinkingLevel; a família 2.5 usa thinkingBudget (tokens).
function thinkingConfigFor(model, level) {
  if (!level) return null;
  const m = String(model).toLowerCase();
  if (/gemini-2\.5|gemini-2\.0/.test(m)) {
    const budget = { low: 1024, medium: 8192, high: 24576 }[level];
    return budget ? { thinkingBudget: budget } : null;
  }
  return { thinkingLevel: level };
}

async function geminiGenerate({ apiKey, model, systemInstruction, contents, tools, signal, thinkingLevel }) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    tools,
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { temperature: 0.4 }
  };
  const tc = thinkingConfigFor(model, thinkingLevel);
  if (tc) body.generationConfig.thinkingConfig = tc;
  let droppedThinking = false;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal
    });
    if (res.ok) return res.json();
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch (_) { /* texto puro */ }
    // Modelo sem suporte ao nível pedido: tenta de novo sem thinkingConfig (usa o padrão do modelo).
    if (res.status === 400 && !droppedThinking && body.generationConfig.thinkingConfig && /think/i.test(msg)) {
      delete body.generationConfig.thinkingConfig;
      droppedThinking = true;
      continue;
    }
    if ((res.status === 429 || res.status === 503 || res.status === 500) && attempt < 2) {
      await new Promise(r => setTimeout(r, 2500 * (attempt + 1)));
      continue;
    }
    throw new Error(`Gemini API ${res.status}: ${msg}`);
  }
}

async function geminiListModels(apiKey) {
  const out = [];
  let pageToken = "";
  do {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=200${pageToken ? "&pageToken=" + pageToken : ""}`, {
      headers: { "x-goog-api-key": apiKey }
    });
    if (!res.ok) throw new Error(`Falha ao listar modelos (${res.status}). Confira a chave da API.`);
    const data = await res.json();
    for (const m of data.models || []) {
      if ((m.supportedGenerationMethods || []).includes("generateContent")) {
        out.push({ id: m.name.replace(/^models\//, ""), nome: m.displayName || m.name });
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}

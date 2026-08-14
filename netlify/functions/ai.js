// Serverless function: proxy seguro para a API do Gemini.
// A chave NUNCA vai para o navegador — fica em process.env.GEMINI_API_KEY (config no Netlify).

// Ordem de tentativa: modelos "lite" têm mais capacidade e falham menos com 503.
const MODELS = (process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ["gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-2.5-flash"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = `Você é a Atlas, assistente do app de calistenia "Calistenia by Atlas".
Tom: acolhedor, segunda pessoa, frases curtas, verbo no começo. Zero culpa, zero jargão técnico,
nunca prometa resultado em prazo fechado. O usuário nunca está atrasado — está no dia dele.
Responda sempre em português do Brasil. Seja objetiva e prática. Use no máximo 1 ou 2 emojis discretos.`;

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Método não permitido" }) };

  const key = process.env.GEMINI_API_KEY;
  if (!key)
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "GEMINI_API_KEY não configurada no Netlify." }) };

  let prompt = "";
  try { prompt = (JSON.parse(event.body || "{}").prompt || "").toString().slice(0, 4000); }
  catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON inválido" }) }; }
  if (!prompt.trim())
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Prompt vazio" }) };

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 900 },
  };

  let lastErr = "Erro na API do Gemini";
  // Tenta cada modelo; em caso de sobrecarga (429/503) faz 1 retry com espera antes de trocar.
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (r.ok) {
          const text =
            data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
            "Não consegui responder agora. Tente novamente. 🌱";
          return { statusCode: 200, headers: cors, body: JSON.stringify({ text }) };
        }
        lastErr = (data && data.error && data.error.message) || lastErr;
        const overloaded = r.status === 503 || r.status === 429;
        if (overloaded && attempt === 0) { await sleep(900); continue; } // retry mesmo modelo
        break; // troca de modelo
      } catch (e) {
        lastErr = "Falha ao contatar o Gemini: " + e.message;
        break;
      }
    }
  }
  return {
    statusCode: 503,
    headers: cors,
    body: JSON.stringify({ error: "O serviço de IA está sobrecarregado no momento. Tente novamente em alguns segundos. 🌱", detail: lastErr }),
  };
};

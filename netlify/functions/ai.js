// Serverless function: proxy seguro para a API do Gemini.
// A chave NUNCA vai para o navegador — fica em process.env.GEMINI_API_KEY (config no Netlify).

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || "Erro na API do Gemini";
      return { statusCode: r.status, headers: cors, body: JSON.stringify({ error: msg }) };
    }
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
      "Não consegui responder agora. Tente novamente. 🌱";
    return { statusCode: 200, headers: cors, body: JSON.stringify({ text }) };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: "Falha ao contatar o Gemini: " + e.message }) };
  }
};

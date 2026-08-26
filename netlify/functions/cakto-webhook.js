// Webhook da Cakto → libera/bloqueia acesso no Supabase.
// Env vars: SUPABASE_SERVICE_ROLE_KEY, CAKTO_WEBHOOK_SECRET  (SUPABASE_URL opcional)
//
// Registre na Cakto a URL:
//   https://calisteniaasiiatica.netlify.app/.netlify/functions/cakto-webhook?secret=SEU_SEGREDO
// (o mesmo valor de CAKTO_WEBHOOK_SECRET). Assim validamos que veio da Cakto.

const URL = process.env.SUPABASE_URL || "https://bjtxrtsazsehcqmtnpkg.supabase.co";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.CAKTO_WEBHOOK_SECRET;

// procura recursivamente a 1ª propriedade cujo nome bate com uma das chaves
function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  for (const k of Object.keys(obj)) {
    if (keys.includes(k.toLowerCase()) && typeof obj[k] !== "object" && obj[k]) return obj[k];
  }
  for (const k of Object.keys(obj)) {
    const v = deepFind(obj[k], keys, depth + 1);
    if (v) return v;
  }
  return null;
}
function collectStrings(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return out;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === "string") out.push(k.toLowerCase() + "=" + v.toLowerCase());
    else if (typeof v === "object") collectStrings(v, out, depth + 1);
  }
  return out;
}

async function sb(path, opts = {}) {
  return fetch(`${URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  if (!SR) return { statusCode: 500, body: "faltando SUPABASE_SERVICE_ROLE_KEY" };
  if (!SECRET) return { statusCode: 503, body: "faltando CAKTO_WEBHOOK_SECRET" };

  // valida segredo (query ?secret= ou header)
  const q = event.queryStringParameters || {};
  const h = event.headers || {};
  const provided = q.secret || h["x-cakto-secret"] || h["x-webhook-secret"] || h["x-cakto-signature"] || "";
  if (provided !== SECRET) return { statusCode: 401, body: "assinatura inválida" };

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = { _raw: event.body }; }

  // Auditoria temporária, restrita aos e-mails explicitamente informados.
  if (body && body._audit === true && Array.isArray(body.emails)) {
    const emails = body.emails.map(v => String(v).trim().toLowerCase()).filter(Boolean).slice(0, 5);
    const enc = encodeURIComponent(`(${emails.join(",")})`);
    const [entRes, logRes] = await Promise.all([
      sb(`entitlements?select=email,active,plan,status,updated_at&email=in.${enc}`),
      sb("webhook_logs?select=received_at,matched_email,matched_status,body&order=received_at.desc&limit=200"),
    ]);
    const allLogs = await logRes.json();
    const logs = (Array.isArray(allLogs) ? allLogs.filter(log => {
      if (log.body && log.body._audit === true) return false;
      const raw = JSON.stringify(log).toLowerCase();
      return emails.some(email => raw.includes(email));
    }) : []).map(log => ({received_at:log.received_at,matched_email:log.matched_email,matched_status:log.matched_status}));
    return { statusCode: 200, body: JSON.stringify({ entitlements: await entRes.json(), logs }) };
  }

  // extrai e-mail e status de forma tolerante a formato
  const email = (deepFind(body, ["email", "customer_email", "buyer_email", "e_mail"]) || "").toString().trim().toLowerCase();
  const blob = collectStrings(body).join(" | ");
  const statusRaw = (deepFind(body, ["status", "event", "type", "action", "payment_status", "transaction_status"]) || "").toString();

  const isPaid = /(approved|paid|complete|completed|active|authorized|aprovad|pago|autorizad|assinatura_ativa|subscription_active)/.test(blob);
  const isCancel = /(refund|chargeback|charge_back|cancel|expired|expir|estorn|reembols|recus|declin|failed|falhou|inadimpl|overdue|unpaid|subscription_canceled|assinatura_cancelad)/.test(blob);
  const isSubscription = /(subscription|assinatura|recorr|recurring)/.test(blob);
  const active = isPaid && !isCancel;

  // registra tudo (para conferirmos o formato real da Cakto)
  try {
    await sb("webhook_logs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ provider: "cakto", matched_email: email || null, matched_status: statusRaw || null, headers: h, body }) });
  } catch (e) { /* log é best-effort */ }

  if (!email) return { statusCode: 200, body: JSON.stringify({ ok: true, note: "sem email no payload — registrado em webhook_logs" }) };

  const row = {
    email, active, status: statusRaw || (active ? "paid" : "canceled"),
    plan: isSubscription ? "assinatura" : "unica", source: "cakto",
    raw: body, updated_at: new Date().toISOString(),
  };
  try {
    await sb("entitlements", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: "falha ao gravar entitlement: " + e.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, email, active }) };
};

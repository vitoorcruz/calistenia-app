// Hubla Webhooks v2 -> libera/remove acesso no Supabase.
// Env vars: SUPABASE_SERVICE_ROLE_KEY, HUBLA_WEBHOOK_TOKEN
// SUPABASE_URL e opcional.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://bjtxrtsazsehcqmtnpkg.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HUBLA_TOKEN = process.env.HUBLA_WEBHOOK_TOKEN;

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

exports.handler = async (request) => {
  if (request.httpMethod === "OPTIONS") return { statusCode: 204, body: "" };
  if (request.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  if (!SERVICE_ROLE) return { statusCode: 503, body: "faltando SUPABASE_SERVICE_ROLE_KEY" };
  if (!HUBLA_TOKEN) return { statusCode: 503, body: "faltando HUBLA_WEBHOOK_TOKEN" };

  const headers = request.headers || {};
  const receivedToken = headers["x-hubla-token"] || headers["X-Hubla-Token"] || "";
  if (receivedToken !== HUBLA_TOKEN) return { statusCode: 401, body: "x-hubla-token invalido" };

  let payload;
  try {
    payload = JSON.parse(request.body || "{}");
  } catch {
    return { statusCode: 400, body: "JSON invalido" };
  }

  const eventType = String(payload.type || "").trim().toLowerCase();
  const event = payload.event || {};
  const email = normalizeEmail(event.user?.email || event.customer?.email || event.subscription?.email);
  const subscriptionType = String(event.subscription?.type || "").toLowerCase();
  const plan = subscriptionType === "recurring" ? "assinatura" : "unica";

  const grantEvents = new Set([
    "customer.member_added",
    "subscription.activated",
    "invoice.payment_succeeded",
  ]);
  const revokeEvents = new Set([
    "customer.member_removed",
    "subscription.deactivated",
    "invoice.refunded",
  ]);

  const recognized = grantEvents.has(eventType) || revokeEvents.has(eventType);
  const active = grantEvents.has(eventType);

  // Log para suporte e auditoria. Dados protegidos por RLS; somente o backend usa service_role.
  try {
    await supabase("webhook_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        provider: "hubla",
        matched_email: email || null,
        matched_status: eventType || null,
        headers: {
          "x-hubla-idempotency": headers["x-hubla-idempotency"] || null,
          "x-hubla-sandbox": headers["x-hubla-sandbox"] || null,
        },
        body: payload,
      }),
    });
  } catch (_) {}

  // Eventos nao relacionados a acesso sao aceitos e ignorados para evitar retries.
  if (!recognized) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, ignored: true, type: eventType }) };
  }
  if (!email) {
    return { statusCode: 422, body: JSON.stringify({ ok: false, error: "email nao encontrado no payload" }) };
  }

  const row = {
    email,
    active,
    status: eventType,
    plan,
    source: "hubla",
    raw: payload,
    updated_at: new Date().toISOString(),
  };

  try {
    await supabase("entitlements", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
  } catch (error) {
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: error.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, email, active, type: eventType }) };
};

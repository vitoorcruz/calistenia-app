// Painel admin — acesso por CONTA (não por senha compartilhada).
// A função confere o token do usuário logado e só libera se o e-mail dele
// estiver na tabela public.admins. Usa a service_role (bypassa RLS) só no servidor.
// Env vars no Netlify: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Método não permitido" }) };

  const URL = process.env.SUPABASE_URL || "https://bjtxrtsazsehcqmtnpkg.supabase.co";
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SR)
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Falta a variável SUPABASE_SERVICE_ROLE_KEY no Netlify (com escopo Functions)." }) };

  // token do usuário logado (enviado pelo app)
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "not_logged_in" }) };

  let action = "data";
  try { action = (JSON.parse(event.body || "{}").action || "data"); } catch (e) {}

  const srh = { apikey: SR, Authorization: `Bearer ${SR}` };

  try {
    // 1) identifica o usuário a partir do token
    const ur = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SR, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "not_logged_in" }) };
    const user = await ur.json();
    const email = (user.email || "").toLowerCase();

    // 2) esse e-mail é admin?
    const ar = await fetch(`${URL}/rest/v1/admins?select=email&email=eq.${encodeURIComponent(email)}`, { headers: srh });
    const admins = await ar.json();
    const isAdmin = Array.isArray(admins) && admins.length > 0;

    if (action === "check")
      return { statusCode: 200, headers: cors, body: JSON.stringify({ admin: isAdmin }) };

    if (!isAdmin)
      return { statusCode: 403, headers: cors, body: JSON.stringify({ error: "not_admin" }) };

    // 3) admin confirmado → devolve os dados
    const [pr, dr] = await Promise.all([
      fetch(`${URL}/rest/v1/profiles?select=id,email,name,workouts_done,progress_pct,created_at,updated_at&order=created_at.desc`, { headers: srh }),
      fetch(`${URL}/rest/v1/diets?select=user_id,type,created_at`, { headers: srh }),
    ]);
    const profiles = await pr.json();
    const diets = await dr.json();
    if (!pr.ok) return { statusCode: pr.status, headers: cors, body: JSON.stringify({ error: profiles.message || "Erro ao ler perfis" }) };

    const byUser = {};
    (Array.isArray(diets) ? diets : []).forEach((d) => { byUser[d.user_id] = (byUser[d.user_id] || 0) + 1; });
    const users = (Array.isArray(profiles) ? profiles : []).map((p) => ({
      name: p.name, email: p.email, workouts_done: p.workouts_done, progress_pct: p.progress_pct,
      diets: byUser[p.id] || 0, created_at: p.created_at, updated_at: p.updated_at,
    }));

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({ totals: { users: users.length, diets: Array.isArray(diets) ? diets.length : 0 }, users }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: "Falha ao consultar o Supabase: " + e.message }) };
  }
};

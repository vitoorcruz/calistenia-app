// Painel admin — roda no servidor com a service_role (bypassa RLS), protegido por senha.
// Requer as env vars no Netlify:
//   SUPABASE_URL                (ex.: https://xxxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY   (chave secreta service_role)
//   ADMIN_PASSWORD              (senha que você escolhe para o painel)

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

  const URL = process.env.SUPABASE_URL;
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const PW = process.env.ADMIN_PASSWORD;
  if (!URL || !SR || !PW)
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Painel não configurado (faltam env vars no Netlify)." }) };

  let password = "";
  try { password = (JSON.parse(event.body || "{}").password || "").toString(); }
  catch (e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON inválido" }) }; }

  if (password !== PW)
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "Senha incorreta." }) };

  const h = { apikey: SR, Authorization: `Bearer ${SR}` };
  try {
    const [pr, dr] = await Promise.all([
      fetch(`${URL}/rest/v1/profiles?select=id,email,name,workouts_done,progress_pct,created_at,updated_at&order=created_at.desc`, { headers: h }),
      fetch(`${URL}/rest/v1/diets?select=user_id,type,created_at`, { headers: h }),
    ]);
    const profiles = await pr.json();
    const diets = await dr.json();
    if (!pr.ok) return { statusCode: pr.status, headers: cors, body: JSON.stringify({ error: profiles.message || "Erro ao ler perfis" }) };

    const byUser = {};
    (Array.isArray(diets) ? diets : []).forEach((d) => { byUser[d.user_id] = (byUser[d.user_id] || 0) + 1; });

    const users = (Array.isArray(profiles) ? profiles : []).map((p) => ({
      name: p.name, email: p.email,
      workouts_done: p.workouts_done, progress_pct: p.progress_pct,
      diets: byUser[p.id] || 0,
      created_at: p.created_at, updated_at: p.updated_at,
    }));

    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        totals: { users: users.length, diets: Array.isArray(diets) ? diets.length : 0 },
        users,
      }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: "Falha ao consultar o Supabase: " + e.message }) };
  }
};

-- ============================================================
--  Calistenia · Pagamentos (Cakto)
--  Rode no Supabase → SQL Editor.
-- ============================================================

-- Quem tem acesso liberado (por e-mail da compra)
create table if not exists public.entitlements (
  email       text primary key,
  active      boolean default false,
  plan        text,           -- 'unica' | 'assinatura' | nome do produto
  status      text,           -- último status recebido da Cakto
  source      text default 'cakto',
  expires_at  timestamptz,    -- para assinatura (null = sem expiração)
  raw         jsonb,
  updated_at  timestamptz default now()
);

alter table public.entitlements enable row level security;

-- O usuário logado pode LER a própria liberação (comparando pelo e-mail do token).
drop policy if exists "ent_select_own" on public.entitlements;
create policy "ent_select_own" on public.entitlements
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));
-- Escrita só pela função do webhook (service_role bypassa RLS). Sem policy de insert/update.

-- Log cru de tudo que a Cakto enviar (para conferir o formato real e depurar).
create table if not exists public.webhook_logs (
  id          bigint generated always as identity primary key,
  provider    text default 'cakto',
  received_at timestamptz default now(),
  matched_email text,
  matched_status text,
  headers     jsonb,
  body        jsonb
);
alter table public.webhook_logs enable row level security; -- sem policies: só service_role lê/escreve

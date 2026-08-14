-- ============================================================
--  Calistenia · Tabela de administradores
--  Rode no Supabase → SQL Editor. Depois, para tornar alguém admin,
--  basta inserir o e-mail da conta dela aqui (ou pelo Table Editor).
-- ============================================================

create table if not exists public.admins (
  email      text primary key,
  created_at timestamptz default now()
);

-- RLS ligado e SEM políticas: ninguém acessa via app.
-- Só a função no servidor (service_role) consegue ler. Seguro.
alter table public.admins enable row level security;

-- >>> TROQUE pelo e-mail da SUA conta no app para virar admin <<<
insert into public.admins (email) values ('SEU_EMAIL_AQUI@exemplo.com')
on conflict (email) do nothing;

-- Para adicionar outro admin depois:
-- insert into public.admins (email) values ('pessoa@email.com') on conflict do nothing;

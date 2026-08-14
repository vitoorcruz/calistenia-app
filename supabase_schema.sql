-- ============================================================
--  Calistenia · Schema Supabase
--  Rode este arquivo inteiro no Supabase → SQL Editor → New query → Run
-- ============================================================

-- ---------- PROFILES (1 registro por usuário) ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  name          text default 'anjinha',
  data          jsonb default '{}'::jsonb,   -- estado do app (progresso, minutos, extras, dieta...)
  workouts_done int  default 0,              -- coluna "achatada" para o painel admin
  progress_pct  int  default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- ---------- DIETS (histórico de dietas e receitas) ----------
create table if not exists public.diets (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  type       text check (type in ('dieta','receita')),
  content    text,
  created_at timestamptz default now()
);

alter table public.diets enable row level security;

drop policy if exists "diets_select_own" on public.diets;
drop policy if exists "diets_insert_own" on public.diets;

create policy "diets_select_own" on public.diets
  for select using (auth.uid() = user_id);
create policy "diets_insert_own" on public.diets
  for insert with check (auth.uid() = user_id);

-- ---------- Cria o profile automaticamente quando o usuário se cadastra ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

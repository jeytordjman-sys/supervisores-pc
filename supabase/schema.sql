-- Supervisores P&C — esquema Supabase (Postgres)
-- Executar uma vez no SQL Editor do projeto (Dashboard → SQL Editor → New query → colar → Run).
-- Idempotente: pode ser executado de novo sem estragar dados.

create extension if not exists pgcrypto;

-- ---------- contas ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  role text not null default 'sup' check (role in ('sup','admin')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Perfil criado automaticamente a cada conta nova. A primeira conta é Sede e ativa;
-- as seguintes ficam inativas até a Sede as ativar no Bastidor (a página é pública).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, name, email, phone, role, active)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          coalesce(new.email,''),
          coalesce(new.raw_user_meta_data->>'phone',''),
          case when first_user then 'admin' else 'sup' end,
          first_user)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

-- Só a Sede muda perfil / ativação; cada um pode mudar o próprio nome e telemóvel.
create or replace function public.guard_profile_update() returns trigger
language plpgsql as $$
begin
  if not public.is_admin() then
    if new.role <> old.role or new.active <> old.active or new.id <> auth.uid() then
      raise exception 'Só a Sede pode alterar perfil ou ativação de contas';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- configuração ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  cad_a int not null default 14, cad_b int not null default 30, cad_c int not null default 91,
  dormant int not null default 90, no_ship int not null default 14, due_soon int not null default 7, max_no_visit int not null default 30,
  reasons text[] not null default array['Visita de cadência','Acompanhamento de ações','Abertura / formação da equipa','Incidente ou reclamação','Inventário / stock','Campanha / merchandising','Outro'],
  trainings text[] not null default array['Produto / marcas','Técnica de venda','Caixa / sistema','Atendimento','Merchandising'],
  sede_email text not null default ''
);
insert into public.settings (id) values (1) on conflict do nothing;

create table if not exists public.items (
  id bigint primary key,
  label text not null, action text not null default '', days int not null default 7,
  owner text not null default 'Responsável loja', active boolean not null default true
);

create table if not exists public.stores (
  id bigint primary key,
  name text not null, code text not null default '', city text not null default '', address text not null default '',
  phone text not null default '', hours text not null default '', team int, manager text not null default '', email text not null default '',
  cad text not null default 'B' check (cad in ('A','B','C')), temp_cad text check (temp_cad in ('A','B','C')), temp_until date,
  sup uuid references public.profiles(id) on delete set null,
  active boolean not null default true, lat double precision, lng double precision,
  priority text not null default 'Normal', notes text not null default ''
);

-- ---------- atividade ----------
create table if not exists public.planned (
  id bigint primary key, store bigint not null references public.stores(id) on delete cascade,
  sup uuid references public.profiles(id) on delete set null,
  date date not null, time text not null default '10:00', reason text not null default '', notes text not null default '',
  visit_id bigint
);
create table if not exists public.visits (
  id bigint primary key, store bigint not null references public.stores(id) on delete cascade,
  sup uuid references public.profiles(id) on delete set null,
  at timestamp not null, reason text not null default '', rating int, comment text not null default '',
  bad bigint[] not null default '{}', photos text[] not null default '{}',
  lat double precision, lng double precision,
  sent boolean not null default false, sent_via jsonb not null default '[]', extra jsonb not null default '{}'
);
create table if not exists public.actions (
  id bigint primary key, store bigint not null references public.stores(id) on delete cascade,
  visit bigint references public.visits(id) on delete set null, item bigint,
  title text not null, owner text not null default 'Responsável loja',
  status text not null default 'open' check (status in ('open','in_progress','done')),
  due date not null, notes text not null default ''
);

-- ---------- Sage X3 (escrito pelo import noturno com a chave service_role) ----------
create table if not exists public.stock (
  site text not null, ref text not null, des text not null default '', qty int not null default 0, last date, top boolean not null default false,
  primary key (site, ref)
);
create table if not exists public.shipments (
  no text primary key, site text not null, date date, lines int not null default 0, sent int not null default 0, recv int not null default 0,
  status text not null default 'in_transit' check (status in ('in_transit','received','discrepancy'))
);
create table if not exists public.kpis (
  site text not null, month text not null, sales numeric not null default 0, target numeric not null default 0, traffic int, tickets int,
  primary key (site, month)
);
create table if not exists public.imports (
  id bigint primary key, kind text not null, at timestamptz not null default now(), rows int not null default 0, unknown text[] not null default '{}'
);

-- ---------- mensagens (a Edge Function send-report envia por e-mail cada linha nova) ----------
create table if not exists public.outbox (
  id bigint primary key,
  at timestamptz not null default now(),
  to_label text not null default '', to_email text not null default '', cc_email text not null default '',
  to_user uuid references public.profiles(id) on delete set null,
  subject text not null, body text not null,
  visit bigint references public.visits(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','sent','error','skipped')),
  sent_at timestamptz, error text
);

-- ---------- histórico (quem fez o quê) — só inserções; o servidor carimba a conta e a hora ----------
create table if not exists public.activity (
  id bigint primary key,
  at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  entity text not null, action text not null, detail text not null default '',
  store bigint references public.stores(id) on delete set null
);
create or replace function public.stamp_activity() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  new.at := now();
  return new;
end $$;
drop trigger if exists stamp_activity on public.activity;
create trigger stamp_activity before insert on public.activity
  for each row execute function public.stamp_activity();

-- Registo bruto de cada alteração (antes/depois), independente da app: prova em caso de dúvida.
create table if not exists public.audit_raw (
  id bigserial primary key, at timestamptz not null default now(), user_id uuid, tbl text not null, op text not null,
  row_id text, before jsonb, after jsonb
);
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_raw (user_id, tbl, op, row_id, before, after)
  values (auth.uid(), TG_TABLE_NAME, TG_OP,
          coalesce((case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', ''),
          case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','settings','items','stores','planned','visits','actions'] loop
    execute format('drop trigger if exists audit_%I on public.%I', t, t);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- ---------- RLS: quem vê o quê ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.items enable row level security;
alter table public.stores enable row level security;
alter table public.planned enable row level security;
alter table public.visits enable row level security;
alter table public.actions enable row level security;
alter table public.stock enable row level security;
alter table public.shipments enable row level security;
alter table public.kpis enable row level security;
alter table public.imports enable row level security;
alter table public.outbox enable row level security;
alter table public.activity enable row level security;
alter table public.audit_raw enable row level security;

create or replace function public.my_store(sid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.stores s where s.id = sid and s.sup = auth.uid() and public.is_active());
$$;

do $$ begin
  -- profiles: todos os ativos veem os nomes (precisos nas listas); o próprio ou a Sede editam
  drop policy if exists profiles_select on public.profiles; create policy profiles_select on public.profiles for select using (auth.uid() = id or public.is_active());
  drop policy if exists profiles_update on public.profiles; create policy profiles_update on public.profiles for update using (auth.uid() = id or public.is_admin());
  -- settings / items: leitura para ativos, escrita Sede
  drop policy if exists settings_select on public.settings; create policy settings_select on public.settings for select using (public.is_active());
  drop policy if exists settings_write on public.settings; create policy settings_write on public.settings for all using (public.is_admin()) with check (public.is_admin());
  drop policy if exists items_select on public.items; create policy items_select on public.items for select using (public.is_active());
  drop policy if exists items_write on public.items; create policy items_write on public.items for all using (public.is_admin()) with check (public.is_admin());
  -- stores: supervisor vê e edita (notas, prioridade) as suas; Sede tudo
  drop policy if exists stores_select on public.stores; create policy stores_select on public.stores for select using (public.my_store(id));
  drop policy if exists stores_update on public.stores; create policy stores_update on public.stores for update using (public.my_store(id));
  drop policy if exists stores_insert on public.stores; create policy stores_insert on public.stores for insert with check (public.is_admin());
  drop policy if exists stores_delete on public.stores; create policy stores_delete on public.stores for delete using (public.is_admin());
  -- planned / visits / actions: pela loja
  drop policy if exists planned_all on public.planned; create policy planned_all on public.planned for all using (public.my_store(store)) with check (public.my_store(store));
  drop policy if exists visits_all on public.visits; create policy visits_all on public.visits for all using (public.my_store(store)) with check (public.my_store(store));
  drop policy if exists actions_all on public.actions; create policy actions_all on public.actions for all using (public.my_store(store)) with check (public.my_store(store));
  -- Sage: leitura para ativos; escrita só Sede (o import usa service_role, que ignora RLS)
  drop policy if exists stock_select on public.stock; create policy stock_select on public.stock for select using (public.is_active());
  drop policy if exists stock_write on public.stock; create policy stock_write on public.stock for all using (public.is_admin()) with check (public.is_admin());
  drop policy if exists shipments_select on public.shipments; create policy shipments_select on public.shipments for select using (public.is_active());
  drop policy if exists shipments_write on public.shipments; create policy shipments_write on public.shipments for all using (public.is_admin()) with check (public.is_admin());
  drop policy if exists kpis_select on public.kpis; create policy kpis_select on public.kpis for select using (public.is_active());
  drop policy if exists kpis_write on public.kpis; create policy kpis_write on public.kpis for all using (public.is_admin()) with check (public.is_admin());
  drop policy if exists imports_select on public.imports; create policy imports_select on public.imports for select using (public.is_active());
  drop policy if exists imports_write on public.imports; create policy imports_write on public.imports for all using (public.is_admin()) with check (public.is_admin());
  -- outbox: cada um vê as suas mensagens e as das suas lojas; Sede tudo; qualquer ativo insere
  drop policy if exists outbox_select on public.outbox; create policy outbox_select on public.outbox for select using (public.is_admin() or to_user = auth.uid() or (visit is not null and exists (select 1 from public.visits v where v.id = visit and public.my_store(v.store))));
  drop policy if exists outbox_insert on public.outbox; create policy outbox_insert on public.outbox for insert with check (public.is_active());
  drop policy if exists outbox_update on public.outbox; create policy outbox_update on public.outbox for update using (public.is_admin());
  -- activity: insere quem está ativo (carimbado pelo servidor); vê o próprio ou a Sede; ninguém altera/apaga
  drop policy if exists activity_select on public.activity; create policy activity_select on public.activity for select using (public.is_admin() or user_id = auth.uid());
  drop policy if exists activity_insert on public.activity; create policy activity_insert on public.activity for insert with check (public.is_active());
  -- audit_raw: só a Sede lê
  drop policy if exists audit_select on public.audit_raw; create policy audit_select on public.audit_raw for select using (public.is_admin());
end $$;

-- Realtime: a app recebe as alterações em direto
do $$ begin
  begin alter publication supabase_realtime add table public.profiles, public.settings, public.items, public.stores, public.planned, public.visits, public.actions, public.stock, public.shipments, public.kpis, public.imports, public.outbox, public.activity;
  exception when duplicate_object then null; end;
end $$;

-- ---------- estado de cada loja (mesma lógica da app), usado pela agenda e lembretes ----------
create or replace function public.store_status()
returns table (id bigint, name text, city text, sup uuid, last_at timestamp, cad_e text, next_date date, days_until int, status text, no_visit boolean, open_actions int, late_actions int)
language sql stable security definer set search_path = public as $$
  with st as (
    select s.id, s.name, s.city, s.sup,
      (select max(v.at) from public.visits v where v.store = s.id) as last_at,
      case when s.temp_cad is not null and s.temp_until >= current_date then s.temp_cad else s.cad end as cad_e
    from public.stores s where s.active),
  cfg as (select * from public.settings where id = 1),
  calc as (
    select st.*, cfg.due_soon, cfg.max_no_visit,
      case when st.last_at is null then current_date else (st.last_at::date + case st.cad_e when 'A' then cfg.cad_a when 'B' then cfg.cad_b else cfg.cad_c end) end as next_date
    from st, cfg)
  select c.id, c.name, c.city, c.sup, c.last_at, c.cad_e, c.next_date, (c.next_date - current_date)::int as days_until,
    case when c.last_at is null then 'never' when c.next_date < current_date then 'late' when c.next_date <= current_date + c.due_soon then 'soon' else 'ok' end as status,
    (c.last_at is null or current_date - c.last_at::date > c.max_no_visit) as no_visit,
    (select count(*)::int from public.actions a where a.store = c.id and a.status <> 'done') as open_actions,
    (select count(*)::int from public.actions a where a.store = c.id and a.status <> 'done' and a.due < current_date) as late_actions
  from calc c;
$$;

-- Agenda de 2ª feira: uma mensagem por supervisor ativo → outbox → e-mail (Edge Function)
create or replace function public.generate_weekly_agenda() returns int
language plpgsql security definer set search_path = public as $$
declare p record; n int := 0; body text; cnt int; cfg record;
begin
  select * into cfg from public.settings where id = 1;
  for p in select * from public.profiles where active and role = 'sup' loop
    select count(*), coalesce(string_agg(
      (case when s.status = 'soon' then '🟠 ' else '🔴 ' end) || s.name || ' (' || s.city || ') — ' ||
      case s.status when 'never' then 'Nunca visitada' when 'late' then 'Atrasada ' || (-s.days_until) || ' d' when 'soon' then (case when s.days_until = 0 then 'Visitar hoje' else 'Visitar até ' || to_char(s.next_date,'DD/MM') end) else 'Sem visita há ' || (current_date - s.last_at::date) || ' dias' end ||
      case when s.open_actions > 0 then ' · ' || s.open_actions || ' ação(ões) aberta(s)' else '' end,
      E'\n' order by s.days_until), '')
    into cnt, body
    from public.store_status() s where s.sup = p.id and (s.status <> 'ok' or s.no_visit);
    insert into public.outbox (id, to_label, to_email, cc_email, to_user, subject, body)
    values ((extract(epoch from clock_timestamp())*1000)::bigint*1000 + (random()*999)::int,
            p.name || ' · ' || p.email, p.email, cfg.sede_email, p.id,
            'Lojas a visitar esta semana (' || cnt || ')',
            'Bom dia ' || p.name || E',\n\nLojas a visitar nos próximos ' || cfg.due_soon || E' dias (🔴 = em atraso):\n\n' ||
            case when cnt > 0 then body else 'Nenhuma loja a visitar esta semana. 👍' end || E'\n\nBoa semana!');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Lembrete diário das ações em atraso (só para quem tem alguma)
create or replace function public.generate_daily_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare p record; n int := 0; body text; cnt int;
begin
  for p in select * from public.profiles where active and role = 'sup' loop
    select count(*), coalesce(string_agg('• ' || a.title || ' — prazo ' || to_char(a.due,'DD/MM/YYYY') || ' · ' || a.owner, E'\n' order by a.due), '')
    into cnt, body
    from public.actions a join public.stores s on s.id = a.store
    where s.sup = p.id and a.status <> 'done' and a.due < current_date;
    if cnt > 0 then
      insert into public.outbox (id, to_label, to_email, to_user, subject, body)
      values ((extract(epoch from clock_timestamp())*1000)::bigint*1000 + (random()*999)::int,
              p.name || ' · ' || p.email, p.email, p.id,
              'Ações em atraso (' || cnt || ')',
              'Bom dia ' || p.name || E',\n\nAções com prazo ultrapassado nas suas lojas:\n\n' || body || E'\n\nObrigado!');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Agendamento (requer a extensão pg_cron: Dashboard → Database → Extensions → pg_cron → Enable).
-- Horas em UTC: 07:00 UTC = 07:00/08:00 em Lisboa.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('weekly-agenda','daily-reminders');
    perform cron.schedule('weekly-agenda', '0 7 * * 1', $cron$select public.generate_weekly_agenda()$cron$);
    perform cron.schedule('daily-reminders', '30 7 * * 1-5', $cron$select public.generate_daily_reminders()$cron$);
  end if;
end $$;

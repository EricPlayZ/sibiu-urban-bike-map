-- Pas 5: rulează acest SQL în Supabase → SQL Editor
-- Apoi completează js/supabase-config.js cu URL + anon key

create extension if not exists postgis;

create table if not exists street_measurements (
  street_id text primary key,
  name text,
  neighborhood_slug text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists neighborhoods (
  slug text primary key,
  name text not null,
  geom jsonb,
  updated_at timestamptz default now()
);

create table if not exists building_types (
  building_id text primary key,
  type text not null check (type in ('casa', 'bloc', 'altceva', 'necunoscut')),
  updated_at timestamptz default now()
);

-- Politici simple: citire publică, scriere pentru useri autentificați
alter table street_measurements enable row level security;
alter table neighborhoods enable row level security;
alter table building_types enable row level security;

create policy "public read measurements" on street_measurements for select using (true);
create policy "auth write measurements" on street_measurements for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "public read neighborhoods" on neighborhoods for select using (true);
create policy "auth write neighborhoods" on neighborhoods for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "public read buildings" on building_types for select using (true);
create policy "auth write buildings" on building_types for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

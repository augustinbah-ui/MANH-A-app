-- À exécuter dans Supabase : SQL Editor > New query > coller tout > Run

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,
  password text not null,
  role text not null check (role in ('client', 'livreur')),
  rating numeric default 5.0,
  balance numeric default 0,
  created_at timestamptz default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references users(id),
  client_name text not null,
  client_phone text not null,
  livreur_id uuid references users(id),
  livreur_name text,
  mode text not null check (mode in ('tournee', 'multiple')),
  item text not null,
  stops jsonb not null,
  price numeric not null,
  status text not null default 'en_attente' check (status in ('en_attente', 'acceptee', 'en_cours', 'livree')),
  history jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- Active la mise à jour en temps réel (pour que les livreurs voient les nouvelles courses instantanément)
alter publication supabase_realtime add table courses;

-- Row Level Security : ouvert pour le prototype (à restreindre avant un vrai lancement public)
alter table users enable row level security;
alter table courses enable row level security;

create policy "Allow all on users" on users for all using (true) with check (true);
create policy "Allow all on courses" on courses for all using (true) with check (true);

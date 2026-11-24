-- LaundrySync Supabase setup
-- Run this entire script in Supabase Dashboard > SQL Editor > New query.
-- This creates owner-private tables. Each signed-in user can access only their own rows.

create table if not exists public.laundry_orders (
  order_code text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer text not null,
  phone text not null default '',
  weight numeric(7,2) not null check (weight > 0 and weight <= 100),
  service text not null,
  rate integer not null check (rate > 0),
  total integer not null check (total >= 0),
  payment text not null check (payment in ('Unpaid','Paid','Deposit')),
  notes text not null default '',
  status text not null check (status in ('Received','Washing','Drying','Ironing','Ready for pickup','Completed')),
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists laundry_orders_owner_created_idx
  on public.laundry_orders(owner_id, created_at desc);

create table if not exists public.laundry_activity (
  activity_code text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  detail text not null default '',
  created_at timestamptz not null
);

create index if not exists laundry_activity_owner_created_idx
  on public.laundry_activity(owner_id, created_at desc);

alter table public.laundry_orders enable row level security;
alter table public.laundry_activity enable row level security;

drop policy if exists "Users can read their own laundry orders" on public.laundry_orders;
create policy "Users can read their own laundry orders"
  on public.laundry_orders for select to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Users can insert their own laundry orders" on public.laundry_orders;
create policy "Users can insert their own laundry orders"
  on public.laundry_orders for insert to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "Users can update their own laundry orders" on public.laundry_orders;
create policy "Users can update their own laundry orders"
  on public.laundry_orders for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Users can read their own laundry activity" on public.laundry_activity;
create policy "Users can read their own laundry activity"
  on public.laundry_activity for select to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Users can insert their own laundry activity" on public.laundry_activity;
create policy "Users can insert their own laundry activity"
  on public.laundry_activity for insert to authenticated
  with check (auth.uid() = owner_id);

-- Only authenticated users receive table access. RLS still limits every row to its owner.
grant select, insert, update on public.laundry_orders to authenticated;
grant select, insert, update on public.laundry_activity to authenticated;

drop policy if exists "Users can update their own laundry activity" on public.laundry_activity;
create policy "Users can update their own laundry activity"
  on public.laundry_activity for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

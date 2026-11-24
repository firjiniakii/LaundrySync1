-- LaundrySync workspace + multi-staff upgrade
-- Run this ONCE in Supabase SQL Editor AFTER the original supabase_setup.sql.
-- It preserves existing order/activity rows and moves each existing owner into
-- a private default workspace. Do not drop your existing tables.

create extension if not exists pgcrypto;

create table if not exists public.laundry_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists laundry_workspaces_created_by_uidx
  on public.laundry_workspaces(created_by);

create table if not exists public.laundry_workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.laundry_workspaces(id) on delete cascade,
  role text not null check (role in ('admin','cashier','production','delivery')),
  display_name text not null default 'Team member',
  joined_at timestamptz not null default now()
);
create index if not exists laundry_workspace_members_workspace_idx
  on public.laundry_workspace_members(workspace_id);

create table if not exists public.laundry_workspace_invites (
  code text primary key,
  workspace_id uuid not null references public.laundry_workspaces(id) on delete cascade,
  role text not null check (role in ('cashier','production','delivery')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references auth.users(id),
  used_at timestamptz
);
create index if not exists laundry_workspace_invites_workspace_idx
  on public.laundry_workspace_invites(workspace_id);

-- Migrate existing single-owner accounts to a workspace, retaining their data.
insert into public.laundry_workspaces(name, created_by)
select 'My Laundry Workspace', owners.owner_id
from (
  select owner_id from public.laundry_orders
  union
  select owner_id from public.laundry_activity
) owners
where owners.owner_id is not null
on conflict (created_by) do nothing;

insert into public.laundry_workspace_members(user_id, workspace_id, role, display_name)
select u.id, w.id, 'admin',
       coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                nullif(split_part(coalesce(u.email,''),'@',1), ''),
                'Workspace admin')
from auth.users u
join public.laundry_workspaces w on w.created_by = u.id
on conflict (user_id) do nothing;

alter table public.laundry_orders add column if not exists workspace_id uuid;
alter table public.laundry_activity add column if not exists workspace_id uuid;

update public.laundry_orders o
set workspace_id = m.workspace_id
from public.laundry_workspace_members m
where o.owner_id = m.user_id and o.workspace_id is null;

update public.laundry_activity a
set workspace_id = m.workspace_id
from public.laundry_workspace_members m
where a.owner_id = m.user_id and a.workspace_id is null;

-- Existing data must be migrated before these constraints are applied.
do $$
begin
  if exists (select 1 from public.laundry_orders where workspace_id is null) then
    raise exception 'Some laundry_orders could not be assigned to a workspace. Check owner_id and workspace migration.';
  end if;
  if exists (select 1 from public.laundry_activity where workspace_id is null) then
    raise exception 'Some laundry_activity rows could not be assigned to a workspace. Check owner_id and workspace migration.';
  end if;
end $$;

alter table public.laundry_orders
  alter column workspace_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'laundry_orders_workspace_fk') then
    alter table public.laundry_orders
      add constraint laundry_orders_workspace_fk
      foreign key (workspace_id) references public.laundry_workspaces(id) on delete cascade;
  end if;
end $$;
create index if not exists laundry_orders_workspace_created_idx
  on public.laundry_orders(workspace_id, created_at desc);

alter table public.laundry_activity
  alter column workspace_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'laundry_activity_workspace_fk') then
    alter table public.laundry_activity
      add constraint laundry_activity_workspace_fk
      foreign key (workspace_id) references public.laundry_workspaces(id) on delete cascade;
  end if;
end $$;
create index if not exists laundry_activity_workspace_created_idx
  on public.laundry_activity(workspace_id, created_at desc);

-- Membership helpers are SECURITY DEFINER to avoid recursive RLS evaluation.
create or replace function public.ls_is_workspace_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.laundry_workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.ls_has_workspace_role(p_workspace_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.laundry_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

-- Workspace creation for a new business owner.
create or replace function public.ls_create_workspace(p_name text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_workspace public.laundry_workspaces;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if exists (select 1 from public.laundry_workspace_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a workspace.';
  end if;
  if char_length(trim(coalesce(p_name,''))) < 2 or char_length(trim(p_name)) > 80 then
    raise exception 'Workspace name must be between 2 and 80 characters.';
  end if;
  insert into public.laundry_workspaces(name, created_by)
  values (trim(p_name), auth.uid()) returning * into v_workspace;
  insert into public.laundry_workspace_members(user_id, workspace_id, role, display_name)
  values (auth.uid(), v_workspace.id, 'admin',
          coalesce(nullif(trim(p_display_name),''), 'Workspace admin'));
  return jsonb_build_object('workspace_id', v_workspace.id, 'workspace_name', v_workspace.name, 'role', 'admin');
end;
$$;

-- Admin creates one-time invites. Invite codes expire after 7 days.
create or replace function public.ls_create_workspace_invite(p_role text)
returns text language plpgsql security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_code text;
begin
  select workspace_id into v_workspace_id
  from public.laundry_workspace_members
  where user_id = auth.uid() and role = 'admin';
  if v_workspace_id is null then raise exception 'Only workspace admins can invite staff.'; end if;
  if p_role not in ('cashier','production','delivery') then
    raise exception 'Choose a valid staff role.';
  end if;
  v_code := upper(encode(gen_random_bytes(5), 'hex'));
  insert into public.laundry_workspace_invites(code, workspace_id, role, created_by, expires_at)
  values (v_code, v_workspace_id, p_role, auth.uid(), now() + interval '7 days');
  return v_code;
end;
$$;

-- Staff joins using an invite code after creating their own login.
create or replace function public.ls_join_workspace(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_invite public.laundry_workspace_invites;
  v_workspace_name text;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if exists (select 1 from public.laundry_workspace_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a workspace.';
  end if;
  select * into v_invite
  from public.laundry_workspace_invites
  where code = upper(trim(p_code))
  for update;
  if not found then raise exception 'Invite code not found.'; end if;
  if v_invite.used_at is not null then raise exception 'This invite code has already been used.'; end if;
  if v_invite.expires_at < now() then raise exception 'This invite code has expired.'; end if;
  select name into v_workspace_name from public.laundry_workspaces where id = v_invite.workspace_id;
  insert into public.laundry_workspace_members(user_id, workspace_id, role, display_name)
  values (auth.uid(), v_invite.workspace_id, v_invite.role,
          coalesce(nullif(trim(p_display_name),''), 'Team member'));
  update public.laundry_workspace_invites set used_by = auth.uid(), used_at = now()
  where code = v_invite.code;
  return jsonb_build_object('workspace_id', v_invite.workspace_id,
                            'workspace_name', v_workspace_name, 'role', v_invite.role);
end;
$$;

create or replace function public.ls_update_my_display_name(p_display_name text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if char_length(trim(coalesce(p_display_name,''))) < 2 or char_length(trim(p_display_name)) > 80 then
    raise exception 'Name must be between 2 and 80 characters.';
  end if;
  update public.laundry_workspace_members
  set display_name = trim(p_display_name)
  where user_id = auth.uid();
  if not found then raise exception 'You are not a member of a workspace.'; end if;
end;
$$;

-- Enforce role-based restrictions on order updates at the database level.
create or replace function public.ls_enforce_order_role()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_workspace_id uuid;
begin
  if tg_op = 'INSERT' then
    v_workspace_id := new.workspace_id;
  else
    v_workspace_id := old.workspace_id;
  end if;

  select role into v_role
  from public.laundry_workspace_members
  where user_id = auth.uid() and workspace_id = v_workspace_id;

  if v_role is null then raise exception 'You are not a member of this workspace.'; end if;

  if tg_op = 'INSERT' then
    if v_role not in ('admin','cashier') then
      raise exception 'Only admins and cashiers can create transactions.';
    end if;
    return new;
  end if;

  if v_role = 'admin' then
    return new;
  elsif v_role = 'cashier' then
    if (to_jsonb(new) - 'payment' - 'notes' - 'updated_at') is distinct from
       (to_jsonb(old) - 'payment' - 'notes' - 'updated_at') then
      raise exception 'Cashiers can update payment and notes only. Ask production to update laundry status.';
    end if;
    return new;
  elsif v_role = 'production' then
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from
       (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Production staff can update order status only.';
    end if;
    if not (
      (old.status = 'Received' and new.status = 'Washing') or
      (old.status = 'Washing' and new.status = 'Drying') or
      (old.status = 'Drying' and new.status = 'Ironing') or
      (old.status = 'Ironing' and new.status = 'Ready for pickup') or
      (old.status = new.status)
    ) then
      raise exception 'Production status must follow the normal laundry workflow.';
    end if;
    return new;
  elsif v_role = 'delivery' then
    if old.status <> 'Ready for pickup' or new.status <> 'Completed' or old.payment <> 'Paid'
       or (to_jsonb(new) - 'status' - 'updated_at') is distinct from
          (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Delivery staff can only complete a ready, paid order.';
    end if;
    return new;
  end if;
  raise exception 'Your role cannot update this transaction.';
end;
$$;

drop trigger if exists laundry_orders_role_guard on public.laundry_orders;
create trigger laundry_orders_role_guard
before insert or update on public.laundry_orders
for each row execute function public.ls_enforce_order_role();


-- Admin can change non-admin staff roles or remove staff from the workspace.
create or replace function public.ls_set_member_role(p_member_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.laundry_workspace_members
  where user_id = auth.uid() and role = 'admin';
  if v_workspace_id is null then raise exception 'Only workspace admins can manage roles.'; end if;
  if p_role not in ('cashier','production','delivery') then
    raise exception 'Role must be cashier, production or delivery.';
  end if;
  update public.laundry_workspace_members
  set role = p_role
  where user_id = p_member_id
    and workspace_id = v_workspace_id
    and role <> 'admin';
  if not found then raise exception 'Staff member not found or cannot change an admin role.'; end if;
end;
$$;

create or replace function public.ls_remove_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.laundry_workspace_members
  where user_id = auth.uid() and role = 'admin';
  if v_workspace_id is null then raise exception 'Only workspace admins can remove staff.'; end if;
  if p_member_id = auth.uid() then raise exception 'You cannot remove your own admin account.'; end if;
  delete from public.laundry_workspace_members
  where user_id = p_member_id and workspace_id = v_workspace_id and role <> 'admin';
  if not found then raise exception 'Staff member not found or cannot remove an admin.'; end if;
end;
$$;

-- Remove previous owner-only policies and replace them with workspace policies.
drop policy if exists "Users can read their own laundry orders" on public.laundry_orders;
drop policy if exists "Users can insert their own laundry orders" on public.laundry_orders;
drop policy if exists "Users can update their own laundry orders" on public.laundry_orders;
drop policy if exists "Users can read their own laundry activity" on public.laundry_activity;
drop policy if exists "Users can insert their own laundry activity" on public.laundry_activity;
drop policy if exists "Users can update their own laundry activity" on public.laundry_activity;

alter table public.laundry_workspaces enable row level security;
alter table public.laundry_workspace_members enable row level security;
alter table public.laundry_workspace_invites enable row level security;

drop policy if exists "Workspace members can view their workspace" on public.laundry_workspaces;
create policy "Workspace members can view their workspace"
on public.laundry_workspaces for select to authenticated
using (public.ls_is_workspace_member(id));

drop policy if exists "Workspace admins can update their workspace" on public.laundry_workspaces;
create policy "Workspace admins can update their workspace"
on public.laundry_workspaces for update to authenticated
using (public.ls_has_workspace_role(id, array['admin']))
with check (public.ls_has_workspace_role(id, array['admin']));

drop policy if exists "Members can view workspace membership" on public.laundry_workspace_members;
create policy "Members can view workspace membership"
on public.laundry_workspace_members for select to authenticated
using (public.ls_is_workspace_member(workspace_id));

drop policy if exists "Members can view workspace orders" on public.laundry_orders;
create policy "Members can view workspace orders"
on public.laundry_orders for select to authenticated
using (public.ls_is_workspace_member(workspace_id));

drop policy if exists "Admins and cashiers can create orders" on public.laundry_orders;
create policy "Admins and cashiers can create orders"
on public.laundry_orders for insert to authenticated
with check (
  public.ls_has_workspace_role(workspace_id, array['admin','cashier'])
  and owner_id = auth.uid()
);

drop policy if exists "Workspace roles can update orders" on public.laundry_orders;
create policy "Workspace roles can update orders"
on public.laundry_orders for update to authenticated
using (public.ls_has_workspace_role(workspace_id, array['admin','cashier','production','delivery']))
with check (public.ls_is_workspace_member(workspace_id));

drop policy if exists "Members can view workspace activity" on public.laundry_activity;
create policy "Members can view workspace activity"
on public.laundry_activity for select to authenticated
using (public.ls_is_workspace_member(workspace_id));

drop policy if exists "Members can add workspace activity" on public.laundry_activity;
create policy "Members can add workspace activity"
on public.laundry_activity for insert to authenticated
with check (public.ls_is_workspace_member(workspace_id) and owner_id = auth.uid());

drop policy if exists "Members can update workspace activity" on public.laundry_activity;
drop policy if exists "Members can update their own workspace activity" on public.laundry_activity;
create policy "Members can update their own workspace activity"
on public.laundry_activity for update to authenticated
using (public.ls_is_workspace_member(workspace_id) and owner_id = auth.uid())
with check (public.ls_is_workspace_member(workspace_id) and owner_id = auth.uid());

grant select, update on public.laundry_workspaces to authenticated;
grant select on public.laundry_workspace_members to authenticated;
grant select on public.laundry_orders to authenticated;
grant insert, update on public.laundry_orders to authenticated;
grant select, insert, update on public.laundry_activity to authenticated;
revoke all on function public.ls_create_workspace(text,text) from public;
revoke all on function public.ls_create_workspace_invite(text) from public;
revoke all on function public.ls_join_workspace(text,text) from public;
revoke all on function public.ls_update_my_display_name(text) from public;
revoke all on function public.ls_set_member_role(uuid,text) from public;
revoke all on function public.ls_remove_member(uuid) from public;
grant execute on function public.ls_is_workspace_member(uuid) to authenticated;
grant execute on function public.ls_has_workspace_role(uuid,text[]) to authenticated;
grant execute on function public.ls_create_workspace(text,text) to authenticated;
grant execute on function public.ls_create_workspace_invite(text) to authenticated;
grant execute on function public.ls_join_workspace(text,text) to authenticated;
grant execute on function public.ls_update_my_display_name(text) to authenticated;
grant execute on function public.ls_set_member_role(uuid,text) to authenticated;
grant execute on function public.ls_remove_member(uuid) to authenticated;

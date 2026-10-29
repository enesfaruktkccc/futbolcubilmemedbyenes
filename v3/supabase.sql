-- Ultimate Football Arena - Supabase online foundation
-- Run once in Supabase SQL Editor. Do not expose service_role keys to browsers.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 20),
  bio text not null default '' check (char_length(bio) <= 160),
  favorite_team text not null default '' check (char_length(favorite_team) <= 40),
  xp bigint not null default 0 check (xp >= 0),
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0 check (wins >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  check(sender_id <> recipient_id)
);

create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 3 and 48),
  game_mode text not null,
  multiplayer boolean not null default true check (multiplayer),
  is_public boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting','playing','finished','cancelled')),
  max_players smallint not null default 4 check (max_players between 2 and 12),
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id)
);

create table if not exists public.room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  check(inviter_id <> invitee_id)
);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- The browser is never allowed to submit competitive XP/game results directly.
create table if not exists public.game_results (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  mode text not null check(mode in ('solo','multiplayer')),
  room_id uuid references public.game_rooms(id) on delete set null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists friendships_inbox_idx on public.friendships(addressee_id,status,created_at desc);
create unique index if not exists profiles_username_lower_idx on public.profiles(lower(username));
create index if not exists dm_pair_idx on public.direct_messages(sender_id,recipient_id,created_at desc);
create index if not exists rooms_waiting_idx on public.game_rooms(status,created_at desc);
create index if not exists room_invites_inbox_idx on public.room_invites(invitee_id,status,created_at desc);
create index if not exists room_messages_by_room_idx on public.room_messages(room_id,created_at asc);

-- SECURITY DEFINER helpers avoid recursive RLS when checking membership.
create or replace function public.is_room_member(check_room uuid, check_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.room_members m where m.room_id=check_room and m.user_id=check_user)
$$;
create or replace function public.can_join_room(check_room uuid, check_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.game_rooms r where r.id=check_room and r.status='waiting' and
    (r.is_public or r.owner_id=check_user or exists(select 1 from public.room_invites i where i.room_id=r.id and i.invitee_id=check_user and i.status='accepted')))
$$;

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  candidate := coalesce(nullif(new.raw_user_meta_data->>'username',''), 'oyuncu_' || left(new.id::text,8));
  candidate := regexp_replace(candidate, '[^[:alnum:]_-]', '', 'g');
  if char_length(candidate) < 3 then candidate := 'oyuncu_' || left(new.id::text,8); end if;
  if exists(select 1 from public.profiles where lower(username)=lower(candidate)) then
    candidate := left(candidate,15) || '_' || right(new.id::text,4);
  end if;
  insert into public.profiles(id,username) values(new.id,candidate);
  return new;
end $$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute function public.create_profile_for_auth_user();

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.direct_messages enable row level security;
alter table public.game_rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_invites enable row level security;
alter table public.room_messages enable row level security;
alter table public.game_results enable row level security;

drop policy if exists profiles_visible_to_signed_in on public.profiles;
create policy profiles_visible_to_signed_in on public.profiles for select to authenticated using (true);
drop policy if exists profiles_create_self on public.profiles;
create policy profiles_create_self on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists profiles_edit_safe_fields on public.profiles;
create policy profiles_edit_safe_fields on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update(username,bio,favorite_team) on public.profiles to authenticated;

drop policy if exists friendships_read_participant on public.friendships;
create policy friendships_read_participant on public.friendships for select to authenticated using (auth.uid() in (requester_id,addressee_id));
drop policy if exists friendships_send_self on public.friendships;
create policy friendships_send_self on public.friendships for insert to authenticated with check (auth.uid() = requester_id);
drop policy if exists friendships_respond_inbox on public.friendships;
create policy friendships_respond_inbox on public.friendships for update to authenticated using (auth.uid() = addressee_id and status = 'pending') with check (auth.uid() = addressee_id and status in ('accepted','declined'));
drop policy if exists friendships_cancel_self on public.friendships;
create policy friendships_cancel_self on public.friendships for delete to authenticated using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists dm_read_pair on public.direct_messages;
create policy dm_read_pair on public.direct_messages for select to authenticated using (auth.uid() in (sender_id,recipient_id));
drop policy if exists dm_send_as_self on public.direct_messages;
create policy dm_send_as_self on public.direct_messages for insert to authenticated with check (auth.uid() = sender_id and exists (select 1 from public.friendships f where f.status='accepted' and ((f.requester_id=auth.uid() and f.addressee_id=recipient_id) or (f.addressee_id=auth.uid() and f.requester_id=recipient_id))));

drop policy if exists rooms_read_public_or_member on public.game_rooms;
create policy rooms_read_public_or_member on public.game_rooms for select to authenticated using (is_public or owner_id = auth.uid() or public.is_room_member(id,auth.uid()) or exists(select 1 from public.room_invites i where i.room_id=id and i.invitee_id=auth.uid() and i.status in ('pending','accepted')));
drop policy if exists rooms_create_self on public.game_rooms;
create policy rooms_create_self on public.game_rooms for insert to authenticated with check (auth.uid() = owner_id);
drop policy if exists rooms_owner_update on public.game_rooms;
create policy rooms_owner_update on public.game_rooms for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists rooms_owner_delete on public.game_rooms;
create policy rooms_owner_delete on public.game_rooms for delete to authenticated using (owner_id = auth.uid());

drop policy if exists room_members_read_room on public.room_members;
create policy room_members_read_room on public.room_members for select to authenticated using (user_id=auth.uid() or public.is_room_member(room_id,auth.uid()) or exists(select 1 from public.game_rooms r where r.id=room_id and (r.is_public or r.owner_id=auth.uid())));
drop policy if exists room_members_join on public.room_members;
create policy room_members_join on public.room_members for insert to authenticated with check (user_id=auth.uid() and public.can_join_room(room_id,auth.uid()));
drop policy if exists room_members_self_leave on public.room_members;
create policy room_members_self_leave on public.room_members for delete to authenticated using (user_id=auth.uid() or exists(select 1 from public.game_rooms r where r.id=room_id and r.owner_id=auth.uid()));

drop policy if exists invites_read_participant on public.room_invites;
create policy invites_read_participant on public.room_invites for select to authenticated using (auth.uid() in (inviter_id,invitee_id));
drop policy if exists invites_send_friend on public.room_invites;
create policy invites_send_friend on public.room_invites for insert to authenticated with check (inviter_id=auth.uid() and exists(select 1 from public.game_rooms r where r.id=room_id and r.owner_id=auth.uid() and r.status='waiting') and exists(select 1 from public.friendships f where f.status='accepted' and ((f.requester_id=auth.uid() and f.addressee_id=invitee_id) or (f.addressee_id=auth.uid() and f.requester_id=invitee_id))));
drop policy if exists invites_respond_inbox on public.room_invites;
create policy invites_respond_inbox on public.room_invites for update to authenticated using (invitee_id=auth.uid() and status='pending') with check (invitee_id=auth.uid() and status in ('accepted','declined'));

drop policy if exists room_messages_read_members on public.room_messages;
create policy room_messages_read_members on public.room_messages for select to authenticated using (public.is_room_member(room_id,auth.uid()));
drop policy if exists room_messages_send_members on public.room_messages;
create policy room_messages_send_members on public.room_messages for insert to authenticated with check (sender_id=auth.uid() and public.is_room_member(room_id,auth.uid()));

-- Competitive results are service-role only. Use an Edge Function to validate turns and award XP.
drop policy if exists results_read_signed_in on public.game_results;
create policy results_read_signed_in on public.game_results for select to authenticated using (true);
revoke insert,update,delete on public.game_results from anon,authenticated;

grant select on public.profiles,public.friendships,public.direct_messages,public.game_rooms,public.room_members,public.room_invites,public.room_messages,public.game_results to authenticated;
grant insert,delete on public.friendships to authenticated;
grant insert on public.direct_messages to authenticated;
grant insert,update,delete on public.game_rooms to authenticated;
grant insert,delete on public.room_members to authenticated;
grant insert,update on public.room_invites to authenticated;
grant insert on public.room_messages to authenticated;

-- Enable database change events for browser subscriptions; Presence itself is ephemeral Realtime state.
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.game_rooms;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.room_invites;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.room_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;


-- Pokémon Figure Archive v5 Online Beta
-- Supabase Dashboard > SQL Editor에서 전체 실행하세요.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  friend_code text not null unique default ('PFG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  share_photos boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','blocked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_unique_pair on public.friendships
  (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester_idx on public.friendships(requester_id);
create index if not exists friendships_addressee_idx on public.friendships(addressee_id);

create table if not exists public.public_figures (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  species_id integer not null check (species_id > 0),
  species_name text not null,
  form_key text not null default 'default',
  form_name text not null default '기본 모습',
  figure_name text not null default '',
  maker text not null default '',
  series text not null default '',
  product_code text not null default '',
  condition text not null default '',
  purchase_date date,
  thumb_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists public_figures_user_idx on public.public_figures(user_id);
create index if not exists public_figures_species_idx on public.public_figures(user_id, species_id);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.public_figures enable row level security;

-- 로그인 사용자는 친구 코드 검색과 친구 목록 표시에 필요한 공개 프로필만 읽을 수 있습니다.
drop policy if exists "authenticated profiles read" on public.profiles;
create policy "authenticated profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);

-- 친구 관계는 당사자만 접근합니다.
drop policy if exists "friendship parties read" on public.friendships;
create policy "friendship parties read" on public.friendships for select to authenticated
using ((select auth.uid()) in (requester_id, addressee_id));
drop policy if exists "request friendship" on public.friendships;
create policy "request friendship" on public.friendships for insert to authenticated
with check ((select auth.uid()) = requester_id and status = 'pending');
drop policy if exists "addressee responds" on public.friendships;
create policy "addressee responds" on public.friendships for update to authenticated
using ((select auth.uid()) = addressee_id)
with check ((select auth.uid()) = addressee_id);
drop policy if exists "parties delete friendship" on public.friendships;
create policy "parties delete friendship" on public.friendships for delete to authenticated
using ((select auth.uid()) in (requester_id, addressee_id));

-- 자신의 기록은 모두 읽고 쓸 수 있고, 친구는 accepted 관계일 때 읽을 수 있습니다.
drop policy if exists "own or friend figures read" on public.public_figures;
create policy "own or friend figures read" on public.public_figures for select to authenticated
using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = (select auth.uid()) and f.addressee_id = public_figures.user_id)
        or (f.addressee_id = (select auth.uid()) and f.requester_id = public_figures.user_id))
  )
);
drop policy if exists "own figures insert" on public.public_figures;
create policy "own figures insert" on public.public_figures for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "own figures update" on public.public_figures;
create policy "own figures update" on public.public_figures for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own figures delete" on public.public_figures;
create policy "own figures delete" on public.public_figures for delete to authenticated
using (user_id = (select auth.uid()));

-- Storage 버킷
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('figure-thumbs', 'figure-thumbs', false, 1048576, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owner upload thumbnails" on storage.objects;
create policy "owner upload thumbnails" on storage.objects for insert to authenticated
with check (bucket_id = 'figure-thumbs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "owner update thumbnails" on storage.objects;
create policy "owner update thumbnails" on storage.objects for update to authenticated
using (bucket_id = 'figure-thumbs' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'figure-thumbs' and owner_id = (select auth.uid())::text);
drop policy if exists "owner or friend read thumbnails" on storage.objects;
create policy "owner or friend read thumbnails" on storage.objects for select to authenticated
using (
  bucket_id = 'figure-thumbs' and (
    (storage.foldername(name))[1] = (select auth.uid())::text or exists (
      select 1 from public.friendships f
      join public.profiles p on p.id::text = (storage.foldername(name))[1]
      where p.share_photos = true and f.status = 'accepted'
        and ((f.requester_id = (select auth.uid()) and f.addressee_id = p.id)
          or (f.addressee_id = (select auth.uid()) and f.requester_id = p.id))
    )
  )
);
drop policy if exists "owner delete thumbnails" on storage.objects;
create policy "owner delete thumbnails" on storage.objects for delete to authenticated
using (bucket_id = 'figure-thumbs' and owner_id = (select auth.uid())::text);

-- 친구 목록과 요청을 한 번에 반환합니다.
create or replace function public.get_my_friend_overview()
returns table (
  friendship_id uuid, friend_id uuid, nickname text, friend_code text,
  status text, direction text, figure_count bigint, species_count bigint
)
language sql security definer set search_path = public stable
as $$
  select f.id,
    case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
    p.nickname, p.friend_code, f.status,
    case when f.addressee_id = auth.uid() then 'incoming' else 'outgoing' end,
    (select count(*) from public.public_figures pf where pf.user_id = p.id),
    (select count(distinct species_id) from public.public_figures pf where pf.user_id = p.id)
  from public.friendships f
  join public.profiles p on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id) and f.status <> 'rejected'
  order by f.created_at desc;
$$;
grant execute on function public.get_my_friend_overview() to authenticated;

-- 두 사용자의 종 단위 보유 현황 비교
create or replace function public.compare_collections(other_user uuid)
returns table (
  species_id integer, species_name text, mine boolean, theirs boolean,
  mine_count bigint, their_count bigint
)
language plpgsql security definer set search_path = public stable
as $$
begin
  if not exists (
    select 1 from public.friendships f where f.status='accepted'
      and ((f.requester_id=auth.uid() and f.addressee_id=other_user)
        or (f.addressee_id=auth.uid() and f.requester_id=other_user))
  ) then raise exception '친구 관계가 아닙니다.';
  end if;
  return query
  with mine as (
    select pf.species_id, max(pf.species_name) species_name, count(*) c
    from public.public_figures pf where pf.user_id=auth.uid() group by pf.species_id
  ), theirs as (
    select pf.species_id, max(pf.species_name) species_name, count(*) c
    from public.public_figures pf where pf.user_id=other_user group by pf.species_id
  )
  select coalesce(m.species_id,t.species_id), coalesce(m.species_name,t.species_name),
    m.species_id is not null, t.species_id is not null, coalesce(m.c,0), coalesce(t.c,0)
  from mine m full join theirs t using(species_id)
  order by coalesce(m.species_id,t.species_id);
end;
$$;
grant execute on function public.compare_collections(uuid) to authenticated;

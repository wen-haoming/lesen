-- Owlivo subscription list sync.
-- Stores only per-account subscription metadata (platform + stable author id + display fields).
-- Does not store cookies, tokens, post bodies, reading history, or personal settings.
-- Writes go through RPCs with revision/idempotency checks; clients cannot upsert the table directly.

create schema if not exists internal;

revoke all on schema internal from public, anon, authenticated;

create table if not exists public.subscription_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('xueqiu', 'weibo', 'xiaohongshu', 'x')),
  author_id text not null check (char_length(author_id) between 1 and 200),
  display_name text not null default '' check (char_length(display_name) <= 200),
  avatar_url text not null default '' check (char_length(avatar_url) <= 1000),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision >= 1),
  last_op_id uuid,
  updated_at timestamptz not null default now(),
  unique (user_id, platform, author_id)
);

comment on table public.subscription_entries is
  'Owlivo per-account subscription list only. No cookies, tokens, post bodies, reading history, or personal settings.';

create index if not exists subscription_entries_user_revision_idx
  on public.subscription_entries (user_id, revision);

create unique index if not exists subscription_entries_user_last_op_id_idx
  on public.subscription_entries (user_id, last_op_id)
  where last_op_id is not null;

alter table public.subscription_entries enable row level security;
alter table public.subscription_entries force row level security;

drop policy if exists subscription_entries_select_own on public.subscription_entries;
create policy subscription_entries_select_own
  on public.subscription_entries
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.subscription_entries from public, anon, authenticated;
grant select on table public.subscription_entries to authenticated;

create or replace function internal.normalize_author_id(p_platform text, p_author_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_platform in ('x', 'xiaohongshu') then lower(trim(p_author_id))
    else trim(p_author_id)
  end;
$$;

create or replace function internal.sanitize_avatar_url(p_avatar text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_avatar ~* '^https://' then left(p_avatar, 1000)
    when p_avatar ~* '^/?(fixtures|icons)/' then left(p_avatar, 1000)
    else ''
  end;
$$;

create or replace function internal.apply_subscription_change(
  p_platform text,
  p_author_id text,
  p_op text,
  p_base_revision bigint,
  p_op_id uuid,
  p_display_name text,
  p_avatar_url text,
  p_allow_resurrect boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_author text;
  v_row public.subscription_entries%rowtype;
  v_name text;
  v_avatar text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_platform not in ('xueqiu', 'weibo', 'xiaohongshu', 'x') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;
  if p_op not in ('subscribe', 'unsubscribe', 'patch_meta') then
    raise exception 'invalid op' using errcode = '22023';
  end if;
  if p_op_id is null then
    raise exception 'invalid op_id' using errcode = '22023';
  end if;

  v_author := internal.normalize_author_id(p_platform, p_author_id);
  if v_author is null or v_author = '' or char_length(v_author) > 200 then
    raise exception 'invalid author_id' using errcode = '22023';
  end if;

  v_name := left(coalesce(trim(p_display_name), ''), 200);
  v_avatar := internal.sanitize_avatar_url(coalesce(p_avatar_url, ''));

  select * into v_row
  from public.subscription_entries
  where user_id = v_uid
    and platform = p_platform
    and author_id = v_author
  for update;

  if v_row.id is not null and v_row.last_op_id is not distinct from p_op_id then
    return jsonb_build_object('status', 'ok', 'idempotent', true, 'entry', to_jsonb(v_row));
  end if;

  if v_row.id is null then
    if p_op = 'patch_meta' then
      return jsonb_build_object('status', 'missing');
    end if;
    insert into public.subscription_entries (
      user_id, platform, author_id, display_name, avatar_url, deleted_at, revision, last_op_id
    )
    values (
      v_uid,
      p_platform,
      v_author,
      v_name,
      v_avatar,
      case when p_op = 'unsubscribe' then now() else null end,
      1,
      p_op_id
    )
    returning * into v_row;
    return jsonb_build_object('status', 'ok', 'entry', to_jsonb(v_row));
  end if;

  if p_base_revision is distinct from v_row.revision then
    return jsonb_build_object('status', 'conflict', 'entry', to_jsonb(v_row));
  end if;

  if p_op = 'subscribe' then
    if v_row.deleted_at is not null and not coalesce(p_allow_resurrect, false) then
      return jsonb_build_object('status', 'tombstone', 'entry', to_jsonb(v_row));
    end if;
    update public.subscription_entries
      set display_name = case when v_name = '' then display_name else v_name end,
          avatar_url = case when v_avatar = '' then avatar_url else v_avatar end,
          deleted_at = null,
          revision = v_row.revision + 1,
          last_op_id = p_op_id,
          updated_at = now()
      where id = v_row.id
        and user_id = v_uid
      returning * into v_row;
    return jsonb_build_object('status', 'ok', 'entry', to_jsonb(v_row));
  end if;

  if p_op = 'unsubscribe' then
    update public.subscription_entries
      set deleted_at = coalesce(deleted_at, now()),
          revision = v_row.revision + 1,
          last_op_id = p_op_id,
          updated_at = now()
      where id = v_row.id
        and user_id = v_uid
      returning * into v_row;
    return jsonb_build_object('status', 'ok', 'entry', to_jsonb(v_row));
  end if;

  if v_row.deleted_at is not null then
    return jsonb_build_object('status', 'tombstone', 'entry', to_jsonb(v_row));
  end if;

  update public.subscription_entries
    set display_name = case when v_name = '' then display_name else v_name end,
        avatar_url = case when v_avatar = '' then avatar_url else v_avatar end,
        revision = v_row.revision + 1,
        last_op_id = p_op_id,
        updated_at = now()
    where id = v_row.id
      and user_id = v_uid
    returning * into v_row;
  return jsonb_build_object('status', 'ok', 'entry', to_jsonb(v_row));
end;
$$;

create or replace function internal.merge_local_subscriptions(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_platform text;
  v_author text;
  v_added int := 0;
  v_skipped_existing int := 0;
  v_skipped_tombstone int := 0;
  v_skipped_invalid int := 0;
  v_deleted timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid items' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_platform := coalesce(v_item ->> 'platform', '');
    if v_platform not in ('xueqiu', 'weibo', 'xiaohongshu', 'x') then
      v_skipped_invalid := v_skipped_invalid + 1;
      continue;
    end if;
    v_author := internal.normalize_author_id(v_platform, coalesce(v_item ->> 'author_id', v_item ->> 'id', ''));
    if v_author is null or v_author = '' or char_length(v_author) > 200 then
      v_skipped_invalid := v_skipped_invalid + 1;
      continue;
    end if;

    select deleted_at
      into v_deleted
    from public.subscription_entries
    where user_id = v_uid
      and platform = v_platform
      and author_id = v_author;

    if found then
      if v_deleted is not null then
        v_skipped_tombstone := v_skipped_tombstone + 1;
      else
        v_skipped_existing := v_skipped_existing + 1;
      end if;
      continue;
    end if;

    insert into public.subscription_entries (
      user_id, platform, author_id, display_name, avatar_url, deleted_at, revision
    )
    values (
      v_uid,
      v_platform,
      v_author,
      left(coalesce(trim(v_item ->> 'display_name'), trim(v_item ->> 'name'), ''), 200),
      internal.sanitize_avatar_url(coalesce(v_item ->> 'avatar_url', v_item ->> 'avatar', '')),
      null,
      1
    );
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object(
    'added', v_added,
    'skipped_existing', v_skipped_existing,
    'skipped_tombstone', v_skipped_tombstone,
    'skipped_invalid', v_skipped_invalid
  );
end;
$$;

create or replace function public.apply_subscription_change(
  p_platform text,
  p_author_id text,
  p_op text,
  p_base_revision bigint,
  p_op_id uuid,
  p_display_name text default '',
  p_avatar_url text default '',
  p_allow_resurrect boolean default false
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select internal.apply_subscription_change(
    p_platform,
    p_author_id,
    p_op,
    p_base_revision,
    p_op_id,
    p_display_name,
    p_avatar_url,
    p_allow_resurrect
  );
$$;

create or replace function public.merge_local_subscriptions(p_items jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select internal.merge_local_subscriptions(p_items);
$$;

revoke all on function public.apply_subscription_change(text, text, text, bigint, uuid, text, text, boolean) from public, anon;
revoke all on function public.merge_local_subscriptions(jsonb) from public, anon;
grant execute on function public.apply_subscription_change(text, text, text, bigint, uuid, text, text, boolean) to authenticated;
grant execute on function public.merge_local_subscriptions(jsonb) to authenticated;

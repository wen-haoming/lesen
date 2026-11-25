-- Public RPC wrappers are SECURITY INVOKER so the Data API does not expose definer functions.
-- Privileged writes stay in the unexposed internal schema and always use auth.uid().

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
security invoker
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
security invoker
set search_path = ''
as $$
  select internal.merge_local_subscriptions(p_items);
$$;

grant usage on schema internal to authenticated;
grant execute on function internal.apply_subscription_change(text, text, text, bigint, uuid, text, text, boolean) to authenticated;
grant execute on function internal.merge_local_subscriptions(jsonb) to authenticated;

revoke all on function internal.normalize_author_id(text, text) from public, anon, authenticated;
revoke all on function internal.sanitize_avatar_url(text) from public, anon, authenticated;

revoke all on function public.apply_subscription_change(text, text, text, bigint, uuid, text, text, boolean) from public, anon;
revoke all on function public.merge_local_subscriptions(jsonb) from public, anon;
grant execute on function public.apply_subscription_change(text, text, text, bigint, uuid, text, text, boolean) to authenticated;
grant execute on function public.merge_local_subscriptions(jsonb) to authenticated;

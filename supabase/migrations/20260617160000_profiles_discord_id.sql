-- Discord user ID (snowflake) for DM notifications; captured client-side from the
-- user's Discord OAuth identity at login. Used by the `discord-notify` edge function.
alter table public.profiles add column if not exists discord_id text;

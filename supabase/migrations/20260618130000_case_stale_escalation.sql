-- Wave 1: auto-escalate stale cases.
--
-- A 14-day-stale open/active case should escalate (notify assignee + command)
-- at most once per staleness window, no matter how many detectives load the
-- portal. The client drives the notification, but needs a shared dedup marker
-- so the *first* loader to notice escalates and everyone else stands down.
--
-- Staleness is measured from cases.updated_at, so writing the marker must NOT
-- count as case activity (otherwise stamping the case would reset its own
-- staleness clock). We give cases a dedicated touch trigger that preserves
-- updated_at when the only change is last_stale_notified_at.

alter table public.cases
  add column if not exists last_stale_notified_at timestamptz;

create or replace function private.touch_cases() returns trigger
  language plpgsql as $$
begin
  -- A stale-escalation stamp (only last_stale_notified_at changed) is not real
  -- case activity — keep updated_at so the staleness clock keeps running.
  if new.last_stale_notified_at is distinct from old.last_stale_notified_at then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end $$;

-- Swap the generic touch trigger (created by platform.sql) for the cases-aware
-- one. Name matches the generated "<table>_touch" so we replace cleanly.
drop trigger if exists cases_touch on public.cases;
create trigger cases_touch before update on public.cases
  for each row execute function private.touch_cases();

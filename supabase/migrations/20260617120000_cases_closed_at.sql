-- Command Dashboard (#17): track when a case is resolved so we can report
-- average resolution time. closed_at is set automatically when a case moves to
-- the 'closed' status and cleared if it is reopened.
alter table public.cases add column if not exists closed_at timestamptz;

-- Backfill existing closed cases with an approximate close time.
update public.cases set closed_at = updated_at where status = 'closed' and closed_at is null;

create or replace function public.set_case_closed_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and (old.status is distinct from 'closed') then
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;   -- reopened: clear resolution timestamp
  end if;
  return new;
end $$;

drop trigger if exists trg_case_closed_at on public.cases;
create trigger trg_case_closed_at before update of status on public.cases
  for each row execute function public.set_case_closed_at();

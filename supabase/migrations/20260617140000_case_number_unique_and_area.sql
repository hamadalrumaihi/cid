-- §1 Case numbering: manual, unique, bureau-prefixed; + area for the heatmap.
alter table public.cases add column if not exists area text;
create unique index if not exists cases_case_number_uniq on public.cases (case_number);

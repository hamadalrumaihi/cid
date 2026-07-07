-- Free-form per-case Markdown notes ("vault" scratchpad) for the case detail
-- Notes tab. Covered by the existing cases RLS (same row policy as title/summary
-- edits) and the table-level grant, so no extra policy/grant is required.
alter table public.cases add column if not exists notes text;

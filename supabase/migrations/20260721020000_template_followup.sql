-- Phase 2 — case templates gain a default follow-up interval.
--
-- Templates already prefill bureau/title/summary/area/status and seed a task
-- checklist. This adds an optional default review cadence: when a template with
-- followup_days is applied to a NEW case, the case's follow_up_at is set to
-- today + N days, so the Guided-next-action banner and the Division Calendar
-- pick it up automatically. Additive, nullable — existing templates are
-- unaffected (null = no default follow-up). case_templates already carries its
-- own RLS (command-managed, all-read); no policy change.

alter table public.case_templates
  add column if not exists followup_days integer;

comment on column public.case_templates.followup_days is
  'Optional default review cadence in days; applied to cases.follow_up_at on creation from this template.';

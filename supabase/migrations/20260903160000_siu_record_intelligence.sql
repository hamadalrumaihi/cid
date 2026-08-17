-- ============================================================================
-- Recording intelligence is a workflow, not a missing form.
--
-- public.siu_case_notes has had an INSERT policy since it was created, and no
-- way to reach it. The Intelligence tab lists notes, grades them and reviews
-- them — every verb except the one that puts a note there in the first place.
-- So the unit could assess intelligence it had no supported way to record.
--
-- ── Why an RPC rather than a form over the table ──────────────────────────
-- Three things have to happen together, and a raw insert does only the first:
--
--   1. `case_id` and `siu_case_id` mean different things and the policies key
--      on `case_id`. A concern recorded ABOUT a CID investigation has
--      case_id = the CID case; the SIU investigation holding that concern goes
--      in siu_case_id. Get them the wrong way round and the note is either
--      invisible to the unit or visible to the CID case's own detectives.
--   2. The 5x5x5 grading can only be set AT AUTHORSHIP. After that
--      `block_direct_siu_note_grading` refuses it and siu_grade_note() is the
--      only route. An author who does not grade at creation cannot grade their
--      own note a second later without going through a different verb.
--   3. Nothing was audited, because nothing wrote.
--
-- ── The authorization is a deliberate MIRROR, and here is the pair ────────
-- This function is SECURITY DEFINER — not by preference but because
-- private.siu_audit() is not executable by `authenticated`, so an invoker
-- function could not write the audit row. Definer means RLS does not apply to
-- the insert, so the policy has to be restated here, and a restated policy is
-- a policy that can drift.
--
-- It is restated as EXACTLY the two terms of `siu_case_notes_ins`, in order:
--
--     private.siu_can_read_case_note(case_id) AND private.siu_is_agent()
--
-- Anyone changing that policy must change this line, and vice versa. It is
-- written as one expression rather than decomposed precisely so the two are
-- visibly the same text.
--
-- Note what that predicate means, because it is easy to misread: for an SIU
-- investigation it resolves to siu_case_read(), and for a CID case to
-- siu_oversight_read() — so any SIU FIELD AGENT may record a concern against
-- any CID case. That is the existing rule, not a new one. It is not tightened
-- here: an RPC that refused what a direct insert still allows would be a
-- fiction, and tightening the wall is a policy change that belongs in a
-- migration of its own with its own reasoning.
--
-- ── What this function will NOT do ────────────────────────────────────────
-- It never sets last_reviewed_at, last_reviewed_by or review_outcome. Those
-- say somebody came back and checked, and at creation nobody has. Because the
-- function is definer the grading trigger does not fire its guard here, so the
-- restraint has to be in the code rather than enforced around it — which is
-- exactly why it is called out rather than left implied.
--
-- APPLICATION NOTE: applied live as siu_record_intelligence.
-- ============================================================================

create or replace function public.siu_record_intelligence(
  p_case uuid,
  p_note_type text,
  p_body text,
  p_severity text default 'medium',
  p_siu_case uuid default null,
  p_subject_person uuid default null,
  p_source_type text default null,
  p_source_reliability text default null,
  p_info_credibility text default null,
  p_review_days int default 90
) returns uuid
language plpgsql security definer set search_path to ''
as $$
declare v_actor uuid := (select auth.uid()); v_id uuid;
begin
  -- The mirror of siu_case_notes_ins. Keep these two terms identical to the
  -- policy's WITH CHECK; see this migration's header.
  if not (private.siu_can_read_case_note(p_case) and private.siu_is_agent()) then
    raise exception 'not authorized';
  end if;

  if p_note_type not in ('intelligence','integrity_concern','corruption_flag',
                         'compromised_officer','leak_concern','conflict_of_interest',
                         'surveillance_note','related_investigation') then
    raise exception 'unknown note type';
  end if;
  if p_severity not in ('low','medium','high','critical') then
    raise exception 'unknown severity';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'a note needs a body - what is being recorded';
  end if;
  if p_source_type is not null and p_source_type not in
     ('human_source','officer_observation','surveillance','technical','documentary',
      'open_source','anonymous','partner_agency','other') then
    raise exception 'unknown source type';
  end if;
  if p_source_reliability is not null and p_source_reliability not in
     ('reliable','usually_reliable','fairly_reliable','not_usually_reliable',
      'unreliable','untested') then
    raise exception 'unknown source reliability';
  end if;
  if p_info_credibility is not null and p_info_credibility not in
     ('confirmed','probably_true','possibly_true','doubtful','improbable','cannot_judge') then
    raise exception 'unknown credibility';
  end if;
  if p_review_days is not null and (p_review_days < 1 or p_review_days > 730) then
    raise exception 'a review falls between 1 and 730 days out';
  end if;

  -- The holding investigation, when there is one, must be one the author can
  -- actually work. Otherwise a note could be filed into a compartment its
  -- author cannot open, where nobody expects it and its author cannot find it.
  if p_siu_case is not null and not private.siu_case_access(p_siu_case) then
    raise exception 'not authorized for that investigation';
  end if;

  -- A named subject must exist. The dossier reads subject_person_id, so a
  -- dangling id is a note that never surfaces against the person it is about.
  if p_subject_person is not null
     and not exists (select 1 from public.persons p where p.id = p_subject_person) then
    raise exception 'that person is not in the registry';
  end if;

  insert into public.siu_case_notes (
    case_id, siu_case_id, note_type, body, severity, subject_person_id,
    source_type, source_reliability, info_credibility, review_due_at, created_by)
  values (
    p_case, p_siu_case, p_note_type, btrim(p_body), p_severity, p_subject_person,
    p_source_type, p_source_reliability, p_info_credibility,
    -- A review date is set only for graded intelligence. Scheduling a review of
    -- something nobody has assessed yet would put a date on the calendar that
    -- means nothing; an ungraded note is surfaced as ungraded instead, which is
    -- the actual next action.
    case when p_info_credibility is not null and p_review_days is not null
         then now() + make_interval(days => p_review_days) end,
    v_actor)
  returning id into v_id;

  -- The body is NOT copied into the audit detail. The audit log has a wider
  -- readership than the note, and duplicating restricted intelligence into it
  -- would route around siu_can_read_case_note() entirely.
  perform private.siu_audit('SIU_INTEL_RECORDED', v_id, jsonb_build_object(
    'case', p_case, 'siu_case', p_siu_case, 'note_type', p_note_type,
    'severity', p_severity, 'subject_person', p_subject_person,
    'graded_at_authorship', p_info_credibility is not null,
    'source_type', p_source_type, 'recorded_by', v_actor));
  return v_id;
end $$;
revoke all on function public.siu_record_intelligence(uuid, text, text, text, uuid, uuid, text, text, text, int) from public;
revoke execute on function public.siu_record_intelligence(uuid, text, text, text, uuid, uuid, text, text, text, int) from anon;
grant execute on function public.siu_record_intelligence(uuid, text, text, text, uuid, uuid, text, text, text, int) to authenticated, service_role;

-- ── Reading, with the case and the subject resolved ─────────────────────────
-- SECURITY INVOKER, as with the dossier: siu_case_notes_sel already decides
-- which notes a caller sees, and the joins are only reached for rows it
-- returned. `subject_name` comes from the registry rather than being stored, so
-- a note keeps naming the right person after a correction or a merge.
create or replace function public.siu_intelligence_live()
returns table (
  id uuid, case_id uuid, case_number text, case_title text,
  siu_case_id uuid, siu_case_number text,
  is_about_cid_case boolean,
  note_type text, body text, severity text,
  subject_person_id uuid, subject_name text,
  source_type text, source_reliability text, info_credibility text,
  review_due_at timestamptz, review_overdue boolean,
  last_reviewed_at timestamptz, review_outcome text,
  resolved_at timestamptz, resolution text,
  created_at timestamptz, created_by uuid, created_by_name text
)
language sql stable security invoker set search_path to 'public'
as $$
  select
    n.id, n.case_id, c.case_number, c.title,
    n.siu_case_id, s.case_number,
    -- The distinction the UI has to lead with: a concern recorded ABOUT a CID
    -- investigation is invisible to that investigation's own detectives and to
    -- CID command, and an author needs to see that stated rather than infer it.
    coalesce(c.case_authority, 'cid') <> 'siu' as is_about_cid_case,
    n.note_type, n.body, n.severity,
    n.subject_person_id, p.name,
    n.source_type, n.source_reliability, n.info_credibility,
    n.review_due_at,
    (n.review_due_at is not null and n.review_due_at < now()
       and n.resolved_at is null) as review_overdue,
    n.last_reviewed_at, n.review_outcome,
    n.resolved_at, n.resolution,
    n.created_at, n.created_by, a.display_name
  from public.siu_case_notes n
  left join public.cases    c on c.id = n.case_id
  left join public.cases    s on s.id = n.siu_case_id
  left join public.persons  p on p.id = n.subject_person_id
  left join public.profiles a on a.id = n.created_by
  order by
    (n.resolved_at is not null),
    (n.review_due_at is not null and n.review_due_at < now()) desc,
    (n.info_credibility is null) desc,
    n.created_at desc
$$;
revoke all on function public.siu_intelligence_live() from public;
revoke execute on function public.siu_intelligence_live() from anon;
grant execute on function public.siu_intelligence_live() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop siu_intelligence_live() and siu_record_intelligence(). No
-- table changes here; notes already recorded are unaffected.
-- ============================================================================

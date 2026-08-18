-- ============================================================================
-- private.case_charge_transition_ok() gets its search_path pinned.
--
-- 20260905130000 declared it `language sql immutable` and stopped there. Every
-- other function in that migration -- case_charge_may, both triggers,
-- case_charge_court_read -- carries `set search_path to ''`, and this one was
-- missed. Supabase's own advisor flagged it: `function_search_path_mutable`,
-- the only such warning in the project.
--
-- ── How much it actually mattered ─────────────────────────────────────────
-- Not much, and that is worth saying plainly rather than dressing it up. The
-- body is two string comparisons against literals; it calls nothing, reads no
-- table, and references no unqualified object, so there is no name for a
-- caller's search_path to capture. It could not have been made to return the
-- wrong answer.
--
-- It is fixed anyway for two reasons. A function whose search_path is mutable
-- is one edit away from mattering -- the day somebody adds a table lookup to
-- the transition table, the hole opens silently. And an advisor with one known
-- exception in it stops being read, which costs far more than this line.
--
-- Nothing else changes: same signature, same edges, same immutability. The
-- transition table itself is untouched.
--
-- APPLICATION NOTE: applied live as case_charge_transition_search_path.
-- ============================================================================

create or replace function private.case_charge_transition_ok(p_from text, p_to text)
returns boolean language sql immutable set search_path to '' as $$
  select case p_from
    when 'proposed'     then p_to in ('under_review', 'withdrawn')
    -- back to 'proposed' is a RETURN: a reviewer sending it down for rework.
    when 'under_review' then p_to in ('approved', 'proposed', 'withdrawn')
    when 'approved'     then p_to in ('filed', 'withdrawn')
    -- Once filed it is before a court; only the court disposes of it.
    when 'filed'        then p_to in ('convicted', 'dismissed')
    -- convicted / dismissed / withdrawn are terminal. A conviction that turns
    -- out to be wrong is corrected by the court record, not by editing the
    -- charge back to 'proposed'.
    else false
  end
$$;

-- ============================================================================
-- Rollback: re-emit without `set search_path to ''`. That restores the advisor
-- warning and nothing else.
-- ============================================================================

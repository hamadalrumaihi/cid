-- ============================================================================
-- When command approves in place of the bureau's own Bureau Lead, say so.
--
-- review_legal_request_as_cid() already works out whether the approver was the
-- responsible bureau's own Bureau Lead or somebody standing in for them:
--
--   v_jtf_any   a Bureau Lead from a DIFFERENT bureau, allowed because the
--               case is JTF
--   v_fallback  a Deputy Director, Director or Owner approving because they
--               outrank the lane, not because the bureau is theirs
--
-- Both are recorded — but only into private.legal_audit(), which is the
-- restricted audit log. The request's OWN timeline, the thing an investigator,
-- a prosecutor or a judge actually reads, shows a bare "CID approved" and says
-- nothing about who stood in or why.
--
-- That matters for the commonest stuck case in the CID lane. A request can only
-- be approved by somebody who is NOT its author (`created_by <> p_user` in
-- can_approve_legal), so when the requesting investigator IS the bureau's
-- Bureau Lead, their own request cannot move without a Deputy Director or
-- Director. That happens, it gets resolved by a fallback approver, and the
-- record of the substitution lived only somewhere most readers cannot see.
--
-- ── Why the timeline and not just the audit log ───────────────────────────
-- The audit log answers "what happened, for an investigator of the system".
-- The timeline answers "what happened, for a participant in this request".
-- Who authorised a warrant, and whether they were the ordinary authority or a
-- substitute, is squarely the second question. A defence challenge to a warrant
-- is a participant-facing question, not an internal-audit one.
--
-- ── Why the fact is recorded at decision time, not derived later ──────────
-- It would be possible to work this out in the client by comparing the
-- reviewer's CURRENT role and division against the request's responsible
-- bureau. That would be wrong. People transfer: a Bureau Lead who moves from
-- LSB to BCB would retroactively turn every past LSB approval into a
-- "fallback", and a Director demoted later would turn one into a regular
-- approval. The substitution is a fact about the moment of decision, and the
-- only honest place to capture it is at that moment.
--
-- ── Why this rewrites the function's source rather than re-emitting it ────
-- review_legal_request_as_cid() is ~150 lines and sits on the most sensitive
-- path in the codebase; it was re-emitted once already in 20260903170000.
-- Retyping it a second time to add two log lines is transcription risk for no
-- benefit — and this migration series has already had one silent divergence
-- between the file and the database, so the fewer characters retyped, the
-- better. The insertion is anchored on an exact, unique string and RAISES if
-- that anchor is absent, so it cannot quietly apply to nothing.
--
-- APPLICATION NOTE: applied live as cid_fallback_visibility.
-- ============================================================================

do $mig$
declare v_src text; v_new text; v_anchor text; v_insert text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'review_legal_request_as_cid';
  if v_src is null then
    raise exception 'public.review_legal_request_as_cid is missing';
  end if;

  -- Dollar-quoted, so the anchor is the literal bytes to match with no
  -- apostrophe escaping in the way. The first attempt at this migration used
  -- ''-escaping, miscounted, and matched nothing -- which the guard below
  -- caught rather than letting it apply silently. Dollar quotes remove the
  -- whole class of mistake.
  v_anchor := $a$perform private.legal_log(p_request, v_ver, 'cid_approved',
    'cid_supervisor_review', 'prosecutor_queue', p_note,
    nullif(btrim(coalesce(p_override_reason, '')), ''));$a$;

  if position(v_anchor in v_src) = 0 then
    raise exception 'review_legal_request_as_cid no longer contains the cid_approved log call this migration anchors on';
  end if;

  -- ASCII only, deliberately: the text that reaches the database and the text
  -- in this file must be the same bytes, and the last batch in this series
  -- diverged precisely because non-ASCII punctuation was sanitised in transit.
  v_insert := v_anchor || $b$
  -- Who actually authorised this, when it was not the bureau's own lead.
  if v_jtf_any then
    perform private.legal_log(p_request, v_ver, 'command_fallback', null, null,
      'Approved by a Bureau Lead from another bureau, permitted because the case is JTF.', null);
  elsif v_fallback then
    perform private.legal_log(p_request, v_ver, 'command_fallback', null, null,
      'Approved by command standing in for the ' || r.responsible_bureau || ' Bureau Lead.', null);
  end if;$b$;

  v_new := replace(v_src, v_anchor, v_insert);
  if v_new = v_src then
    raise exception 'the fallback log insertion changed nothing';
  end if;
  execute v_new;
end $mig$;

-- ============================================================================
-- Rollback: re-emit review_legal_request_as_cid() from 20260903170000, which
-- drops the two command_fallback log lines. Rows already written to
-- legal_request_actions are history and are left alone.
-- ============================================================================

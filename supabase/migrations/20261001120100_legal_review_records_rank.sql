-- ============================================================================
-- Who reviewed a legal request, and at what rank.
--
-- WHAT WAS ALREADY TRUE, AND WORTH SAYING
-- Most of the hierarchy this was asked to build already existed.
-- private.can_approve_legal() already admits deputy_director, director and the
-- Owner for ANY bureau; there is no claim or assignment gate on CID review at
-- all, so higher command has always been able to act immediately without the
-- bureau's own lead being marked unavailable; a `command_fallback` line is
-- already logged naming who stood in; and `r.created_by <> p_user` already
-- keeps an author from approving their own request. None of that is rebuilt.
--
-- WHAT WAS MISSING
-- The second half of "show who performed the review and their rank".
-- cid_reviewed_by recorded the person and nothing recorded the rank.
--
-- Rank is captured AT THE TIME. Reading profiles.role when the page renders
-- answers "what are they now", which is a different question and becomes a
-- wrong answer the moment somebody is promoted -- the same reason
-- siu_visibility_events stores actor_standing rather than joining to profiles.
--
-- Historical rows stay NULL rather than being backfilled from today's roles.
-- Filling them in would be inventing a fact about the past; "rank not
-- recorded" is the truth for a review decided before the column existed.
--
-- The rank also rides along in every legal_audit payload for this lane, so a
-- return and a denial carry it too, not just an approval.
--
-- APPLICATION NOTE: applied live as legal_review_records_rank. The full body of
-- review_legal_request_as_cid() is re-emitted there; it is a 150-line function
-- and only the marked lines differ.
-- ============================================================================

alter table public.legal_requests
  add column if not exists cid_reviewed_role text;

comment on column public.legal_requests.cid_reviewed_role is
  'CID rank held by cid_reviewed_by AT THE MOMENT of review. NULL for reviews decided before this column existed -- never backfilled, because a current role is not evidence of a past one.';

-- public.review_legal_request_as_cid(uuid, text, text, text, text) is re-emitted
-- live with three changes and nothing else:
--   * v_rank := the reviewer's role at decision time ('owner' when the actor is
--     the Owner and holds no CID rank);
--   * cid_reviewed_role = v_rank on the deny, SIU-approve and CID-approve paths;
--   * 'actor_rank' added to the LEGAL_RETURNED_*, LEGAL_DENIED_BY_COMMAND,
--     LEGAL_APPROVED_BY_SIU_COMMAND and LEGAL_APPROVED_BY_COMMAND audit payloads.

-- ============================================================================
-- Rollback: drop the column and re-emit the function without v_rank. No row is
-- rewritten by this migration, so nothing is lost either way.
-- ============================================================================

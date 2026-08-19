-- ============================================================================
-- Who can send us intelligence -- a roster, not a queue.
--
-- Field Intelligence access is immediate and needs no approval, because the
-- access grants nothing except the ability to write a report addressed to CID.
-- That is a decision about APPROVAL, not about RECORDS: investigators still
-- need to be able to ask "who is allowed to submit, and who are they?", and
-- answer it without opening the Command Center.
--
-- field_access_roster() is that answer. One row per account that has ever held
-- field standing, whether it is live now or ended, with the identity they gave,
-- when the access was created, whether it is still good, and how much they have
-- actually sent. It is a read of records that already exist -- field_officers,
-- profiles, field_submissions and the auth account -- assembled in one place so
-- nobody has to join four tables by eye.
--
-- WHAT IS AND IS NOT IN IT
-- No passwords, no tokens, no session material: "keep their login information"
-- means the account identity and the access history, and this returns exactly
-- that. The two genuinely sensitive columns -- the sign-in email and the last
-- sign-in time -- follow the existing rule for member emails
-- (20260708140000_restrict_profile_email): command sees them, everybody else
-- gets null. An investigator does not need a patrol officer's email address to
-- know they are cleared to submit.
-- ============================================================================

create or replace function public.field_access_roster()
returns table (
  user_id uuid,
  display_name text,
  email text,
  agency text,
  callsign text,
  officer_rank text,
  unit text,
  standing_active boolean,
  self_served boolean,
  appointed_by uuid,
  appointed_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  removed_at timestamptz,
  login_denied boolean,
  first_seen timestamptz,
  last_seen timestamptz,
  submissions integer,
  last_submission_at timestamptz)
language plpgsql stable security definer set search_path to '' as $$
declare v_command boolean := private.is_command();
begin
  if not private.is_active() then raise exception 'not authorized'; end if;

  return query
  select
    f.user_id,
    p.display_name,
    case when v_command then p.email end,
    f.agency,
    f.callsign,
    f.officer_rank,
    f.unit,
    f.active,
    -- Nobody appointed a self-served officer, and the roster should say so
    -- rather than leaving a blank that reads like missing data.
    f.appointed_by is null,
    f.appointed_by,
    f.appointed_at,
    f.ended_at,
    f.end_reason,
    p.removed_at,
    p.login_denied,
    u.created_at,
    case when v_command then u.last_sign_in_at end,
    (select count(*) from public.field_submissions s
      where s.officer_id = f.user_id and s.status <> 'draft')::int,
    (select max(s.submitted_at) from public.field_submissions s
      where s.officer_id = f.user_id and s.status <> 'draft')
  from public.field_officers f
  join public.profiles p on p.id = f.user_id
  left join auth.users u on u.id = f.user_id
  order by f.active desc, f.appointed_at desc;
end $$;
revoke all on function public.field_access_roster() from public;
revoke execute on function public.field_access_roster() from anon;
grant execute on function public.field_access_roster() to authenticated, service_role;

-- -- Legacy requests that the world moved past -----------------------------------
-- Rows filed before access became self-service, belonging to somebody who has
-- since created their own access. Answering them now would be theatre: the
-- thing they asked for already happened. Marked withdrawn rather than approved,
-- because nobody decided them -- writing 'approved' would put a decision in the
-- record that no human made. The rows themselves stay, with their history.
update public.field_access_requests r
   set status = 'withdrawn',
       decision_reason = coalesce(r.decision_reason,
         'Superseded: Field Intelligence access became immediate, and this account already has it.'),
       updated_at = now()
 where r.status = 'pending'
   and exists (select 1 from public.field_officers f
                where f.user_id = r.user_id and f.active);

-- ============================================================================
-- Rollback: drop public.field_access_roster(). The legacy-request update is a
-- data change on rows that were already obsolete; reversing it would mean
-- re-opening requests for access the applicant already holds.
-- ============================================================================

-- ============================================================================
-- The person dossier: one investigative view assembled from the registries.
--
-- The watchlist now points at canonical records (20260903120000) rather than
-- copying them. This is what that link is FOR — opening a watch entry should
-- show everything the department already knows about the subject, gathered
-- from where it actually lives, not a summary somebody typed once.
--
-- ── Why this function is SECURITY INVOKER ──────────────────────────────────
-- Every other SIU RPC in this codebase is `security definer`, because it has
-- to perform a privileged action. This one performs no action: it reads. So it
-- runs as the caller, and every one of the fifteen tables it touches is
-- filtered by its own existing policy, automatically and without me restating
-- a single rule.
--
-- That matters more than the convenience. §26 requires that SIU material reach
-- only authorized SIU users, and the failure mode to avoid is a definer
-- function that assembles a rich object and then tries to remember which parts
-- to strip. Here there is nothing to remember. A CID detective calling this
-- gets the registry facts their policies already allow and an EMPTY siu block
-- — not because this function checked, but because `siu_watchlist_sel`,
-- `siu_case_notes` and `siu_targets` returned them no rows. An SIU agent gets
-- both halves for the same reason. The authorization lives in one place and
-- this function cannot disagree with it.
--
-- If the caller cannot read the person at all, `persons` returns nothing and
-- the function reports the subject as not found — the same answer they would
-- get for a person who does not exist.
--
-- ── Fact and intelligence are kept apart, using the columns that exist ─────
-- The registries already record how strongly each link is held:
--   person_vehicles / person_places   link_status, confidence, provenance
--   gang_members                      status, confidence, provenance
--   account_links                     ownership_confidence, source
--   person_relationships              rel_status, confidence, provenance
--   surveillance_observations         confidence, verification_status
-- Every relationship is returned WITH those fields rather than flattened into
-- a list of names. A confirmed registered vehicle and a plate somebody thinks
-- they saw are both in the dossier, and the client can tell them apart because
-- the database said which is which. Inventing a parallel `is_verified` flag
-- here would have created a second, disagreeing answer.
--
-- APPLICATION NOTE: applied live as siu_person_dossier.
-- ============================================================================

create or replace function public.siu_person_dossier(p_person uuid)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with subject as (
    select p.* from public.persons p where p.id = p_person
  )
  select case when not exists (select 1 from subject) then null else jsonb_build_object(

    -- ── Identity, as the registry holds it ────────────────────────────────
    'person', (select jsonb_build_object(
        'id', s.id, 'name', s.name, 'alias', s.alias, 'dob', s.dob,
        'phone', s.phone, 'status', s.status, 'classification', s.classification,
        'confidence', s.confidence, 'priority', s.priority, 'lifecycle', s.lifecycle,
        'mugshot_url', s.mugshot_url, 'notes', s.notes,
        'ccw', s.ccw, 'vch', s.vch, 'felony_count', s.felony_count,
        'merged_into', s.merged_into,
        'reviewed_at', s.reviewed_at, 'next_review_at', s.next_review_at,
        'identity', s.identity, 'properties', s.properties,
        'intelligence_summary', s.intelligence_summary,
        'bolo', jsonb_build_object(
          'active', s.bolo, 'reason', s.bolo_reason, 'risk', s.bolo_risk,
          'instructions', s.bolo_instructions, 'issued_at', s.bolo_issued_at,
          'expires_at', s.bolo_expires_at, 'case_id', s.bolo_case_id))
      from subject s),

    -- ── Gang: the current affiliation on the person record, plus the ──────
    -- membership rows, which carry their own status and confidence and may
    -- disagree with it. Both are shown; neither is quietly preferred.
    'gang', (select jsonb_build_object(
        'id', g.id, 'name', g.name, 'threat_level', g.threat_level,
        'classification', g.classification, 'status', g.status,
        'confidence', g.confidence)
      from subject s join public.gangs g on g.id = s.gang_id),

    'gang_memberships', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'gang_id', m.gang_id, 'gang_name', g.name,
        'rank', m.rank, 'callsign', m.callsign, 'status', m.status,
        'confidence', m.confidence, 'provenance', m.provenance,
        'joined_at', m.joined_at, 'left_at', m.left_at, 'note', m.note,
        'case_id', m.case_id,
        'reviewed_at', m.reviewed_at) order by m.left_at nulls first, m.joined_at desc)
      from public.gang_members m left join public.gangs g on g.id = m.gang_id
      where m.person_id = p_person), '[]'::jsonb),

    -- ── Vehicles. Two different claims, deliberately not merged: ──────────
    -- `registered` is the vehicle record naming this person as owner;
    -- `linked` is an observed association with its own strength.
    'vehicles_registered', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'plate', v.plate, 'model', v.model, 'color', v.color,
        'gang_id', v.gang_id, 'notes', v.notes) order by v.plate)
      from public.vehicles v where v.owner_id = p_person), '[]'::jsonb),

    'vehicles_linked', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pv.id, 'vehicle_id', v.id, 'plate', v.plate, 'model', v.model,
        'color', v.color, 'role', pv.role, 'link_status', pv.link_status,
        'confidence', pv.confidence, 'provenance', pv.provenance,
        'note', pv.note, 'first_observed', pv.first_observed,
        'last_confirmed', pv.last_confirmed)
        order by pv.last_confirmed desc nulls last)
      from public.person_vehicles pv join public.vehicles v on v.id = pv.vehicle_id
      where pv.person_id = p_person), '[]'::jsonb),

    -- ── Places. `role` distinguishes a home address from a place they were
    -- once seen; link_status and confidence say how well either is held.
    'places', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pp.id, 'place_id', pl.id, 'name', pl.name, 'type', pl.type,
        'area', pl.area, 'role', pp.role, 'link_status', pp.link_status,
        'confidence', pp.confidence, 'provenance', pp.provenance,
        'note', pp.note, 'first_observed', pp.first_observed,
        'last_confirmed', pp.last_confirmed)
        order by pp.last_confirmed desc nulls last)
      from public.person_places pp join public.places pl on pl.id = pp.place_id
      where pp.person_id = p_person), '[]'::jsonb),

    -- ── Online presence. ownership_confidence is the whole point: an
    -- account "believed" to be theirs must never read as an account that is.
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'link_id', al.id, 'account_id', a.id, 'platform', a.platform,
        'handle', a.handle, 'display_name', a.display_name,
        'profile_url', a.profile_url, 'category', a.category, 'state', a.state,
        'restricted', a.restricted, 'lifecycle', a.lifecycle,
        'is_impersonation', a.is_impersonation, 'is_compromised', a.is_compromised,
        'ownership_confidence', al.ownership_confidence, 'source', al.source,
        'notes', al.notes, 'confirmed_at', al.confirmed_at,
        'handles', (select coalesce(jsonb_agg(jsonb_build_object(
              'handle', h.handle, 'is_current', h.is_current,
              'observed_at', h.observed_at, 'source', h.source)
            order by h.is_current desc, h.observed_at desc), '[]'::jsonb)
          from public.account_handles h where h.account_id = a.id))
        order by al.confirmed_at desc nulls last)
      from public.account_links al join public.accounts a on a.id = al.account_id
      where al.person_id = p_person), '[]'::jsonb),

    'relationships', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'other_id', case when r.person_a = p_person then r.person_b else r.person_a end,
        'other_name', o.name,
        'relationship', r.relationship, 'rel_status', r.rel_status,
        'confidence', r.confidence, 'provenance', r.provenance, 'note', r.note,
        'first_observed', r.first_observed, 'last_confirmed', r.last_confirmed)
        order by r.last_confirmed desc nulls last)
      from public.person_relationships r
      join public.persons o
        on o.id = case when r.person_a = p_person then r.person_b else r.person_a end
      where r.person_a = p_person or r.person_b = p_person), '[]'::jsonb),

    'narcotics', coalesce((select jsonb_agg(jsonb_build_object(
        'id', np.id, 'narcotic_id', n.id, 'name', n.name, 'role', np.role,
        'link_status', np.link_status, 'confidence', np.confidence,
        'provenance', np.provenance, 'first_observed', np.first_observed,
        'last_confirmed', np.last_confirmed)
        order by np.last_confirmed desc nulls last)
      from public.narcotic_persons np join public.narcotics n on n.id = np.narcotic_id
      where np.person_id = p_person), '[]'::jsonb),

    -- ── Everything below reaches SIU-held tables. Nothing here is gated by
    -- this function; each is gated by its own policy, so an unauthorized
    -- caller receives empty arrays rather than a refusal.
    'watch', (select jsonb_build_object(
        'id', w.id, 'reason', w.reason, 'priority', w.priority,
        'status', w.status, 'classification', w.classification,
        'source', w.source, 'notes', w.notes, 'case_id', w.case_id,
        'assigned_agent', w.assigned_agent, 'expires_at', w.expires_at,
        'review_due_at', w.review_due_at, 'created_at', w.created_at,
        'live', w.status in ('active','monitor','review_due','suspended')
                and w.expires_at > now())
      from public.siu_watchlist w
      where w.person_id = p_person
        and w.status in ('active','monitor','review_due','suspended')
      order by w.created_at desc limit 1),

    'watch_history', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'reason', w.reason, 'priority', w.priority,
        'status', w.status, 'created_at', w.created_at,
        'removed_at', w.removed_at, 'removal_reason', w.removal_reason)
        order by w.created_at desc)
      from public.siu_watchlist w where w.person_id = p_person), '[]'::jsonb),

    'siu_targets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'case_id', t.case_id, 'designation', t.designation,
        'role_in_network', t.role_in_network, 'priority', t.priority,
        'notes', t.notes, 'cleared_at', t.cleared_at,
        'created_at', t.created_at) order by t.created_at desc)
      from public.siu_targets t
      where t.entity_type = 'person' and t.entity_id = p_person), '[]'::jsonb),

    -- Intelligence notes naming this person as the subject. The 5x5x5 grading
    -- travels with each note; an ungraded note is not silently promoted.
    'siu_intelligence', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'case_id', coalesce(n.siu_case_id, n.case_id),
        'note_type', n.note_type, 'body', n.body, 'severity', n.severity,
        'source_type', n.source_type,
        'source_reliability', n.source_reliability,
        'info_credibility', n.info_credibility,
        'review_due_at', n.review_due_at, 'last_reviewed_at', n.last_reviewed_at,
        'review_outcome', n.review_outcome,
        'resolved_at', n.resolved_at, 'created_at', n.created_at)
        order by n.created_at desc)
      from public.siu_case_notes n where n.subject_person_id = p_person), '[]'::jsonb),

    -- §19 deconfliction. Codename and status only — never the handler, the
    -- tasking or the control notes. Its purpose is to stop an agent targeting
    -- somebody else's registered source, which needs no detail beyond the
    -- fact. Callers outside the source's case see nothing at all.
    'siu_source', (select jsonb_build_object(
        'id', src.id, 'codename', src.codename, 'status', src.status,
        'case_id', src.case_id)
      from public.siu_sources src
      where src.person_id = p_person and src.deactivated_at is null
      order by src.registered_at desc limit 1),

    'surveillance', coalesce((select jsonb_agg(jsonb_build_object(
        'id', so.id, 'case_id', so.case_id, 'observed_at', so.observed_at,
        'place_id', so.place_id, 'location_text', so.location_text,
        'activity', so.activity, 'confidence', so.confidence,
        'verification_status', so.verification_status,
        'restricted', so.restricted) order by so.observed_at desc)
      from (select * from public.surveillance_observations o
             where o.person_id = p_person
             order by o.observed_at desc limit 25) so), '[]'::jsonb)
  ) end
$$;
revoke all on function public.siu_person_dossier(uuid) from public;
revoke execute on function public.siu_person_dossier(uuid) from anon;
grant execute on function public.siu_person_dossier(uuid) to authenticated, service_role;

comment on function public.siu_person_dossier(uuid) is
  'One person, assembled from the registries. SECURITY INVOKER on purpose: every table it reads is filtered by that table''s own policy, so SIU material reaches only SIU callers without this function restating a single rule. Returns null when the caller cannot see the person.';

-- ── The watchlist, read through the registry ────────────────────────────────
-- The list itself now has to join, because a linked entry no longer carries a
-- label. Also security invoker — siu_watchlist_sel decides who sees rows, and
-- the joined registry columns are only reached for rows that policy returned.
create or replace function public.siu_watchlist_live()
returns table (
  id uuid, entity_type text, entity_id uuid, display_name text,
  secondary text, reason text, priority text, status text,
  classification text, source text, notes text, case_id uuid,
  case_number text, assigned_agent uuid, assigned_agent_name text,
  expires_at timestamptz, review_due_at timestamptz, created_at timestamptz,
  created_by uuid, removed_at timestamptz, removal_reason text,
  review_overdue boolean, days_left integer
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    w.id, w.entity_type,
    coalesce(w.person_id, w.vehicle_id, w.gang_id, w.place_id,
             w.account_id, w.indicator_id) as entity_id,
    -- The name comes from the registry every time it is read, so a correction
    -- made in CID shows here immediately. `label` is the fallback and now only
    -- carries weight for an 'unknown' subject.
    coalesce(p.name, v.plate, g.name, pl.name, a.handle, i.value, w.label,
             'Unidentified subject') as display_name,
    coalesce(p.alias, nullif(concat_ws(' ', v.color, v.model), ''), g.classification,
             pl.area, a.platform, i.kind) as secondary,
    w.reason, w.priority, w.status, w.classification, w.source, w.notes,
    w.case_id, c.case_number, w.assigned_agent, ag.display_name,
    w.expires_at, w.review_due_at, w.created_at, w.created_by,
    w.removed_at, w.removal_reason,
    (w.review_due_at is not null and w.review_due_at <= now()
       and w.status in ('active','monitor','review_due','suspended')) as review_overdue,
    greatest(0, extract(day from (w.expires_at - now()))::int) as days_left
  from public.siu_watchlist w
  left join public.persons    p  on p.id  = w.person_id
  left join public.vehicles   v  on v.id  = w.vehicle_id
  left join public.gangs      g  on g.id  = w.gang_id
  left join public.places     pl on pl.id = w.place_id
  left join public.accounts   a  on a.id  = w.account_id
  left join public.indicators i  on i.id  = w.indicator_id
  left join public.cases      c  on c.id  = w.case_id
  left join public.profiles   ag on ag.id = w.assigned_agent
  order by
    case w.status when 'review_due' then 0 when 'active' then 1 when 'monitor' then 2
                  when 'suspended' then 3 else 4 end,
    case w.priority when 'critical' then 0 when 'high_priority' then 1
                    when 'priority' then 2 else 3 end,
    w.review_due_at nulls last, w.created_at desc
$$;
revoke all on function public.siu_watchlist_live() from public;
revoke execute on function public.siu_watchlist_live() from anon;
grant execute on function public.siu_watchlist_live() to authenticated, service_role;

-- ── Registry search, for attaching a watch to a real record ────────────────
-- The add form must offer existing records instead of a text box, or the
-- duplicate address book grows back. Invoker again: a caller only searches
-- what they may already read.
create or replace function public.siu_registry_search(p_entity_type text, p_q text)
returns table (id uuid, display_name text, secondary text, already_watched boolean)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select x.id, x.display_name, x.secondary,
         exists (select 1 from public.siu_watchlist w
                  where w.status in ('active','monitor','review_due','suspended')
                    and (case p_entity_type
                           when 'person'  then w.person_id
                           when 'vehicle' then w.vehicle_id
                           when 'gang'    then w.gang_id
                           when 'place'   then w.place_id
                           when 'account' then w.account_id
                           else w.indicator_id end) = x.id) as already_watched
  from (
    select p.id, p.name as display_name,
           nullif(concat_ws(' - ', p.alias, p.status), '') as secondary
      from public.persons p
     where p_entity_type = 'person'
       and (p.name ilike '%' || btrim(coalesce(p_q, '')) || '%'
         or p.alias ilike '%' || btrim(coalesce(p_q, '')) || '%')
    union all
    select v.id, v.plate, nullif(concat_ws(' ', v.color, v.model), '')
      from public.vehicles v
     where p_entity_type = 'vehicle'
       and v.plate ilike '%' || btrim(coalesce(p_q, '')) || '%'
    union all
    select g.id, g.name, g.classification
      from public.gangs g
     where p_entity_type = 'gang'
       and (g.name ilike '%' || btrim(coalesce(p_q, '')) || '%'
         or g.aliases ilike '%' || btrim(coalesce(p_q, '')) || '%')
    union all
    select pl.id, pl.name, pl.area
      from public.places pl
     where p_entity_type = 'place'
       and pl.name ilike '%' || btrim(coalesce(p_q, '')) || '%'
    union all
    select a.id, coalesce(a.handle, a.display_name, a.external_id), a.platform
      from public.accounts a
     where p_entity_type = 'account'
       and (a.handle ilike '%' || btrim(coalesce(p_q, '')) || '%'
         or a.display_name ilike '%' || btrim(coalesce(p_q, '')) || '%')
    union all
    select i.id, i.value, i.kind
      from public.indicators i
     where p_entity_type = 'indicator'
       and i.value ilike '%' || btrim(coalesce(p_q, '')) || '%'
  ) x
  order by x.display_name
  limit 25
$$;
revoke all on function public.siu_registry_search(text, text) from public;
revoke execute on function public.siu_registry_search(text, text) from anon;
grant execute on function public.siu_registry_search(text, text) to authenticated, service_role;

-- ============================================================================
-- Rollback: drop siu_person_dossier(uuid), siu_watchlist_live() and
-- siu_registry_search(text, text). Nothing else reads them and no table
-- changes here.
-- ============================================================================

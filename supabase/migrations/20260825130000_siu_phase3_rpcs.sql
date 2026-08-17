-- ============================================================================
-- SIU Phase 3, part 2 — restricted export and the oversight report.
--
-- ── siu_export_case() ──────────────────────────────────────────────────────
-- The ONE export path. It is a definer RPC rather than a client-side "select
-- everything and serialize" so that three properties hold for every export,
-- by construction rather than by convention:
--
--   1. It is logged. Every call writes a siu_exports row AND an audit row,
--      with the scope and the mandatory reason. An export nobody can see is
--      not possible.
--   2. It cannot exceed the caller's own access. Access is re-checked
--      (siu_case_access + siu_is_agent), so a compartmented investigation can
--      only be exported from inside the compartment, and oversight standing
--      cannot export at all.
--   3. It NEVER emits source identities, undercover legends or intercept
--      content — at any scope, for any caller, including SIU command and the
--      Owner. Those categories leave the database only by a human deciding to
--      write them down somewhere else, which is the correct friction.
--
-- The payload names what it withheld, with counts computed under the caller's
-- OWN visibility predicates (siu_handler_access for the handler-compartmented
-- tables), so "3 source records withheld" never becomes an oracle for records
-- the caller could not otherwise read.
--
-- Scopes:
--   case_summary        the file's spine — number, title, status, agents
--   investigation_file  the above plus reports, evidence, tasks, notes, targets
--   intelligence_only   notes, targets and financial/comms METADATA
--   disclosure_packet   exactly what was released to CID, for court
--
-- ── siu_oversight_report() ─────────────────────────────────────────────────
-- The supervision surface for the SOP chain. Aggregate counts only — no case
-- ids, no titles, no names, no identifiers. It answers "is the unit working,
-- and is it closing what it opens" for the Director of CID and the Attorney
-- General without handing either of them the tradecraft they may be the
-- subject of. Any SIU standing may read it; an unauthorized caller gets
-- {"access": false} rather than an error.
--
-- APPLICATION NOTE: applied live as siu_phase3_rpcs.
-- ============================================================================

create or replace function public.siu_export_case(
  p_case uuid,
  p_scope text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_case record;
  v_payload jsonb;
  v_items jsonb := '[]'::jsonb;
  v_withheld jsonb;
  v_count integer := 0;
  v_sources integer;
  v_legends integer;
  v_intercepts integer;
begin
  if not private.is_siu_case(p_case) then raise exception 'not an SIU investigation'; end if;
  if not (private.siu_case_access(p_case) and private.siu_is_agent()) then
    raise exception 'not authorized';
  end if;
  if p_scope not in ('case_summary', 'investigation_file', 'intelligence_only', 'disclosure_packet') then
    raise exception 'unknown export scope';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select c.id, c.case_number, c.title, c.summary, c.status, c.siu_classification,
         c.created_at, c.siu_assumed_at
    into v_case from public.cases c where c.id = p_case;

  -- Counts of what is being held back, under the caller's own visibility.
  select count(*) into v_sources from public.siu_sources s
   where s.case_id = p_case and private.siu_handler_access(s.case_id, s.handler_id);
  select count(*) into v_legends from public.siu_undercover_operations u
   where u.case_id = p_case
     and (private.siu_handler_access(u.case_id, u.handler_id) or u.agent_id = v_actor);
  select count(*) into v_intercepts from public.siu_comms_intel m
   where m.case_id = p_case and m.content_summary is not null;

  v_withheld := jsonb_build_array(
    jsonb_build_object('category', 'confidential_source_identities', 'count', v_sources),
    jsonb_build_object('category', 'undercover_legends',             'count', v_legends),
    jsonb_build_object('category', 'intercept_content',              'count', v_intercepts));

  if p_scope = 'disclosure_packet' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'released_at', d.released_at, 'item_type', d.item_type,
             'audience', d.audience, 'handling', d.handling,
             'title', d.title, 'body', d.body,
             'revoked_at', d.revoked_at,
             'acknowledged_at', d.acknowledged_at) order by d.released_at), '[]'::jsonb)
      into v_items
      from public.siu_disclosures d where d.siu_case_id = p_case;
  elsif p_scope = 'intelligence_only' then
    select jsonb_build_object(
      'notes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'created_at', n.created_at, 'note_type', n.note_type,
                  'severity', n.severity, 'body', n.body,
                  'resolved_at', n.resolved_at) order by n.created_at), '[]'::jsonb)
                from public.siu_case_notes n where n.case_id = p_case),
      'targets', (select coalesce(jsonb_agg(jsonb_build_object(
                    'label', t.label, 'entity_type', t.entity_type,
                    'designation', t.designation, 'priority', t.priority,
                    'role_in_network', t.role_in_network,
                    'cleared_at', t.cleared_at) order by t.created_at), '[]'::jsonb)
                  from public.siu_targets t where t.case_id = p_case),
      -- Financial records in full; communications METADATA only — the
      -- content_summary column is never projected here or anywhere else.
      'financial', (select coalesce(jsonb_agg(jsonb_build_object(
                      'record_type', f.record_type, 'institution', f.institution,
                      'identifier', f.identifier, 'amount', f.amount,
                      'currency', f.currency, 'occurred_at', f.occurred_at,
                      'counterparty', f.counterparty, 'description', f.description,
                      'flagged', f.flagged) order by f.occurred_at), '[]'::jsonb)
                    from public.siu_financial_intel f where f.case_id = p_case),
      'communications_metadata', (select coalesce(jsonb_agg(jsonb_build_object(
                      'record_type', m.record_type, 'identifier', m.identifier,
                      'subscriber', m.subscriber, 'carrier', m.carrier,
                      'counterpart', m.counterpart, 'direction', m.direction,
                      'occurred_at', m.occurred_at,
                      'duration_seconds', m.duration_seconds,
                      'legal_authority', m.legal_authority) order by m.occurred_at), '[]'::jsonb)
                    from public.siu_comms_intel m where m.case_id = p_case)
    ) into v_items;
  elsif p_scope = 'investigation_file' then
    select jsonb_build_object(
      'reports', (select coalesce(jsonb_agg(jsonb_build_object(
                    'created_at', r.created_at, 'template', r.template,
                    'kind', r.kind, 'seq', r.seq, 'finalized', r.finalized,
                    'author', (select p.display_name from public.profiles p where p.id = r.author_id),
                    'fields', r.fields) order by r.created_at), '[]'::jsonb)
                  from public.reports r where r.case_id = p_case),
      'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
                     'item_code', e.item_code, 'type', e.type,
                     'description', e.description, 'location', e.location,
                     'collected_at', e.collected_at,
                     'collected_by', (select p.display_name from public.profiles p where p.id = e.collected_by)
                   ) order by e.created_at), '[]'::jsonb)
                   from public.evidence e where e.case_id = p_case),
      'tasks', (select coalesce(jsonb_agg(jsonb_build_object(
                  'title', k.title, 'done', k.done, 'due', k.due) order by k.created_at), '[]'::jsonb)
                from public.case_tasks k where k.case_id = p_case),
      'notes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'created_at', n.created_at, 'note_type', n.note_type,
                  'severity', n.severity, 'body', n.body) order by n.created_at), '[]'::jsonb)
                from public.siu_case_notes n where n.case_id = p_case),
      'targets', (select coalesce(jsonb_agg(jsonb_build_object(
                    'label', t.label, 'designation', t.designation,
                    'priority', t.priority) order by t.created_at), '[]'::jsonb)
                  from public.siu_targets t where t.case_id = p_case)
    ) into v_items;
  end if;

  -- How many records the payload actually carries: a flat list for the
  -- disclosure packet, the sum of the sections for the grouped scopes.
  if jsonb_typeof(v_items) = 'array' then
    v_count := jsonb_array_length(v_items);
  elsif jsonb_typeof(v_items) = 'object' then
    select coalesce(sum(jsonb_array_length(value)), 0) into v_count
      from jsonb_each(v_items) where jsonb_typeof(value) = 'array';
  end if;

  v_payload := jsonb_build_object(
    'case', jsonb_build_object(
      'case_number', v_case.case_number, 'title', v_case.title,
      'summary', v_case.summary, 'status', v_case.status,
      'classification', v_case.siu_classification,
      'opened_at', v_case.created_at,
      'assumed_from_cid_at', v_case.siu_assumed_at),
    'agents', (select coalesce(jsonb_agg(jsonb_build_object(
                 'name', p.display_name, 'role', a.agent_role,
                 'callsign', (select m.callsign from public.siu_memberships m
                               where m.user_id = a.user_id and m.active))
                 order by a.assigned_at), '[]'::jsonb)
               from public.siu_case_agents a
               join public.profiles p on p.id = a.user_id
              where a.case_id = p_case and a.removed_at is null),
    'scope', p_scope,
    'items', v_items,
    'withheld', v_withheld,
    'exported_at', now(),
    'exported_by', (select p.display_name from public.profiles p where p.id = v_actor));

  insert into public.siu_exports (case_id, scope, reason, item_count, withheld, exported_by)
  values (p_case, p_scope, btrim(p_reason), v_count, v_withheld, v_actor);

  perform private.siu_audit('SIU_EXPORTED', p_case, jsonb_build_object(
    'scope', p_scope, 'reason', btrim(p_reason),
    'item_count', v_count, 'withheld', v_withheld, 'exported_by', v_actor));

  return v_payload;
end $$;
revoke all on function public.siu_export_case(uuid, text, text) from public;
revoke execute on function public.siu_export_case(uuid, text, text) from anon;
grant execute on function public.siu_export_case(uuid, text, text) to authenticated, service_role;

-- ── The oversight report ────────────────────────────────────────────────────
create or replace function public.siu_oversight_report()
returns jsonb
language sql stable security definer set search_path to ''
as $$
  select case when not private.siu_operates() then jsonb_build_object('access', false)
  else jsonb_build_object(
    'access', true,
    'standing', private.siu_standing(),
    'generated_at', now(),
    -- Caseload by classification and disposition.
    'investigations', jsonb_build_object(
      'total',         (select count(*) from public.cases c where c.case_authority = 'siu'),
      'open',          (select count(*) from public.cases c where c.case_authority = 'siu' and c.status <> 'closed'),
      'closed',        (select count(*) from public.cases c where c.case_authority = 'siu' and c.status = 'closed'),
      'standard',      (select count(*) from public.cases c where c.case_authority = 'siu'
                          and coalesce(c.siu_classification, 'siu') = 'siu'),
      'restricted',    (select count(*) from public.cases c where c.case_authority = 'siu'
                          and c.siu_classification = 'siu_restricted'),
      'command',       (select count(*) from public.cases c where c.case_authority = 'siu'
                          and c.siu_classification = 'siu_command'),
      'compartmented', (select count(*) from public.cases c where c.case_authority = 'siu'
                          and c.siu_classification = 'siu_compartmented')),
    -- §14: how often SIU has taken a CID case, and how often it gave one back.
    'control', jsonb_build_object(
      'assumed_total',   (select count(*) from public.cases c where c.siu_assumed_at is not null),
      'currently_held',  (select count(*) from public.cases c
                            where c.siu_assumed_at is not null and c.case_authority = 'siu'),
      'returned_to_cid', (select count(*) from public.cases c where c.siu_returned_at is not null)),
    -- §15: what the unit has told CID.
    'disclosure', jsonb_build_object(
      'released',     (select count(*) from public.siu_disclosures),
      'live',         (select count(*) from public.siu_disclosures d where d.revoked_at is null),
      'revoked',      (select count(*) from public.siu_disclosures d where d.revoked_at is not null),
      'acknowledged', (select count(*) from public.siu_disclosures d where d.acknowledged_at is not null),
      'to_division',  (select count(*) from public.siu_disclosures d where d.audience = 'cid'),
      'to_case',      (select count(*) from public.siu_disclosures d where d.audience = 'case_members'),
      'to_officer',   (select count(*) from public.siu_disclosures d where d.audience = 'investigator')),
    -- Corruption workload and its disposition. Counts only: no subject names.
    'integrity', jsonb_build_object(
      'total',           (select count(*) from public.siu_integrity_reviews),
      'open',            (select count(*) from public.siu_integrity_reviews r where r.closed_at is null),
      'substantiated',   (select count(*) from public.siu_integrity_reviews r where r.status = 'substantiated'),
      'unsubstantiated', (select count(*) from public.siu_integrity_reviews r where r.status = 'unsubstantiated'),
      'inconclusive',    (select count(*) from public.siu_integrity_reviews r where r.status = 'inconclusive'),
      'referred',        (select count(*) from public.siu_integrity_reviews r where r.status = 'referred'),
      'critical_open',   (select count(*) from public.siu_integrity_reviews r
                            where r.closed_at is null and r.severity = 'critical'),
      'flags_against_cid_cases', (select count(*) from public.siu_case_notes n
                                    join public.cases c on c.id = n.case_id
                                   where c.case_authority = 'cid' and n.resolved_at is null
                                     and n.note_type in ('integrity_concern', 'corruption_flag',
                                                         'compromised_officer', 'leak_concern'))),
    -- Tradecraft VOLUME only. No codename, no legend, no identifier ever
    -- appears here — that is the whole point of the report existing.
    'tradecraft', jsonb_build_object(
      'sources_registered',   (select count(*) from public.siu_sources),
      'sources_active',       (select count(*) from public.siu_sources s where s.status = 'active'),
      'undercover_active',    (select count(*) from public.siu_undercover_operations u
                                 where u.status in ('authorized', 'active')),
      'undercover_compromised', (select count(*) from public.siu_undercover_operations u
                                   where u.status = 'compromised'),
      'financial_records',    (select count(*) from public.siu_financial_intel),
      'comms_records',        (select count(*) from public.siu_comms_intel),
      'comms_with_content',   (select count(*) from public.siu_comms_intel m
                                 where m.content_summary is not null)),
    -- Exports are an accountability signal in their own right.
    'exports', jsonb_build_object(
      'total',       (select count(*) from public.siu_exports),
      'last_30_days', (select count(*) from public.siu_exports e
                         where e.exported_at > now() - interval '30 days')),
    'personnel', jsonb_build_object(
      'agents', (select count(*) from public.siu_memberships m where m.active))
  ) end
$$;
revoke all on function public.siu_oversight_report() from public;
revoke execute on function public.siu_oversight_report() from anon;
grant execute on function public.siu_oversight_report() to authenticated, service_role;

-- ============================================================================
-- Rollback: drop public.siu_export_case(uuid, text, text) and
-- public.siu_oversight_report().
-- ============================================================================

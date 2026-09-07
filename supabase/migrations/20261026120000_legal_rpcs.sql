-- ============================================================================
-- 20261026120000_legal_rpcs.sql
-- Phase 4 (P4-03 charges, P4-05 comments, P4-06 revision resolution,
--          P4-08 evidence from the request, P4-09 amend / observers,
--          P4-11 export ledger) — the request-side RPCs plus the `legal`
-- arms of private.perm_dispatch and their permission_catalog rows.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as
-- migration `legal_rpcs` (Supabase MCP). Additive: every new function is
-- CREATE OR REPLACE; private.perm_dispatch is re-emitted with the legal arm
-- extended and every other arm byte-identical to 20261022120000.
-- After the security review, private.legal_can_comment (the wall is the
-- outer conjunct), legal_set_observer (a sealed request's observers are
-- granted by command / the AG, never the creator alone) and
-- legal_add_evidence_and_exhibit (case_writable, so an archived or deleted
-- case takes no new media) were re-applied live as legal_review_fixes,
-- byte-identical to this file.
--
-- Contract (scratch p4_contract.md §5): the new RPCs return jsonb
-- `{ok:true, …}` or `{ok:false, code:'denied', message}` on an AUTHORITY
-- refusal (which also writes private.perm_deny), and raise only on hard
-- validation errors (missing row, bad enum, malformed payload). RLS on the
-- Phase 4 tables is SELECT-only for `authenticated`; these definers are the
-- sole writers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shared helpers
-- ---------------------------------------------------------------------------

-- Purpose:        the one shape every authority refusal takes: a
--                 PERMISSION_DENIED audit row (private.perm_deny) and the
--                 jsonb the client renders verbatim.
create or replace function private.legal_denied(p_action text, p_request uuid, p_reason text, p_message text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform private.perm_deny(p_action, 'legal', p_request, p_reason);
  return jsonb_build_object('ok', false, 'code', 'denied', 'message', p_message);
end $$;
revoke all on function private.legal_denied(text, uuid, text, text) from public, anon, authenticated;

-- Purpose:        who may post on a request's discussion thread — always
--                 someone who can SEE it (the wall is the outer conjunct):
--                 the creator, every active participant (the judge once
--                 claimed, an observer), the CID / SIB approver pool, the
--                 Attorney General, the Owner.
create or replace function private.legal_can_comment(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_user is not null
     and private.can_view_legal_request(p_request, p_user)
     and (exists (select 1 from public.legal_requests r where r.id = p_request and r.created_by = p_user)
          or private.is_legal_participant(p_request, p_user)
          or private.can_approve_legal(p_request, p_user)
          or coalesce(private.justice_role_effective(p_user) = 'attorney_general', false)
          or private.owner_flag(p_user))
$$;
revoke all on function private.legal_can_comment(uuid, uuid) from public, anon, authenticated;

-- Purpose:        command authority over a request's lifecycle (cancel,
--                 supersede, observers): the CID / SIB approver pool, the
--                 Attorney General, the Owner. Mirrors the checks inside
--                 legal_admin_cancel / legal_mark_superseded.
create or replace function private.legal_is_command_authority(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select p_user is not null and (
    private.can_approve_legal(p_request, p_user)
    or coalesce(private.justice_role_effective(p_user) = 'attorney_general', false)
    or private.owner_flag(p_user))
$$;
revoke all on function private.legal_is_command_authority(uuid, uuid) from public, anon, authenticated;

-- Purpose:        who may grant / revoke per-request observer access (L16 —
--                 the retired prosecutor role's replacement): command
--                 authority or the creator.
create or replace function private.can_set_legal_observer(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.legal_is_command_authority(p_request, p_user)
      or exists (select 1 from public.legal_requests r where r.id = p_request and r.created_by = p_user)
$$;
revoke all on function private.can_set_legal_observer(uuid, uuid) from public, anon, authenticated;

-- Purpose:        who may open an amendment: an active member with access to
--                 the case who can see the source request, once the source is
--                 decided or terminal.
create or replace function private.can_amend_legal(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.legal_requests r
     where r.id = p_request
       and r.review_status in ('approved', 'partially_approved', 'denied', 'superseded', 'withdrawn', 'cancelled')
       and p_user = (select auth.uid())
       and private.is_active()
       and private.can_access_case(r.case_id)
       and private.can_view_legal_request(p_request, p_user))
$$;
revoke all on function private.can_amend_legal(uuid, uuid) from public, anon, authenticated;

-- Purpose:        form_data without the server-owned '_' keys
--                 (_charges, _target_decisions, …) — what an amendment clones.
create or replace function private.legal_form_public(p_form jsonb)
returns jsonb language sql immutable set search_path to '' as $$
  select coalesce((select jsonb_object_agg(e.key, e.value)
                     from jsonb_each(coalesce(p_form, '{}'::jsonb)) e
                    where e.key not like '\_%'), '{}'::jsonb)
$$;
revoke all on function private.legal_form_public(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. P4-03 — structured charges
-- ---------------------------------------------------------------------------

-- Purpose:        replace the request's charge set with [{case_charge_id,
--                 counts}]; every charge must belong to the request's case;
--                 code / offense / class / title are snapshotted from
--                 case_charges so the instrument is stable even if the case
--                 charge is later amended. Creator, while editable.
create or replace function public.legal_set_charges(p_request uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; x jsonb;
        cc public.case_charges; v_counts integer; v_ids uuid[] := '{}'; v_n integer := 0;
        v_removed integer := 0;
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'charges must be an array of {case_charge_id, counts}';
  end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    return private.legal_denied('set_charges', p_request, 'not_editable',
      'charges can only change while the request is editable');
  end if;
  for x in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(x) <> 'object' or nullif(btrim(coalesce(x->>'case_charge_id', '')), '') is null then
      raise exception 'each charge needs a case_charge_id';
    end if;
    select * into cc from public.case_charges where id = (x->>'case_charge_id')::uuid;
    if not found or cc.case_id <> r.case_id then
      raise exception 'charge % does not belong to this request''s case', x->>'case_charge_id';
    end if;
    if cc.id = any(v_ids) then continue; end if;
    v_counts := coalesce(nullif(btrim(coalesce(x->>'counts', '')), '')::integer, cc.counts, 1);
    if v_counts < 1 or v_counts > 999 then raise exception 'counts must be between 1 and 999'; end if;
    v_ids := v_ids || cc.id;
    insert into public.legal_request_charges
      (legal_request_id, case_charge_id, snap_code, snap_offense, snap_charge_class,
       snap_penal_title, counts, added_by)
    values (p_request, cc.id, cc.snap_code, cc.snap_offense, cc.snap_charge_class,
            cc.snap_penal_title, v_counts, v_uid)
    on conflict (legal_request_id, case_charge_id) do update
      set counts = excluded.counts, snap_code = excluded.snap_code,
          snap_offense = excluded.snap_offense, snap_charge_class = excluded.snap_charge_class,
          snap_penal_title = excluded.snap_penal_title;
    v_n := v_n + 1;
  end loop;
  delete from public.legal_request_charges
   where legal_request_id = p_request and not (case_charge_id = any(v_ids));
  get diagnostics v_removed = row_count;
  perform private.legal_log(p_request, null, 'charges_set', null, null,
    v_n || ' charge' || case when v_n = 1 then '' else 's' end, null);
  perform private.legal_audit(p_request, 'LEGAL_CHARGES_SET',
    jsonb_build_object('count', v_n, 'removed', v_removed, 'case_charge_ids', to_jsonb(v_ids)));
  return jsonb_build_object('ok', true, 'count', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- 3. P4-05 — discussion thread
-- ---------------------------------------------------------------------------

-- Purpose:        post a comment (optionally a reply). Everyone with a stake
--                 in the request — creator, active participants, the assigned
--                 judge — is told, never the author; a sealed request's
--                 payload is {request_id, sealed:true} (legal_notify).
create or replace function public.legal_comment(p_request uuid, p_body text, p_parent uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests;
        v_body text := left(btrim(coalesce(p_body, '')), 4000); v_id uuid;
        v_parent public.legal_request_comments; rec record; v_actor text;
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if v_body = '' then raise exception 'a comment body is required'; end if;
  if not private.legal_can_comment(p_request, v_uid) then
    return private.legal_denied('comment', p_request, 'not_participant',
      'only participants and reviewers of this request may comment');
  end if;
  if p_parent is not null then
    select * into v_parent from public.legal_request_comments where id = p_parent;
    if not found or v_parent.legal_request_id <> p_request then
      raise exception 'parent comment not found on this request';
    end if;
    if v_parent.deleted_at is not null then raise exception 'cannot reply to a deleted comment'; end if;
  end if;
  insert into public.legal_request_comments (legal_request_id, author_id, parent_id, body)
  values (p_request, v_uid, p_parent, v_body) returning id into v_id;
  perform private.legal_audit(p_request, 'LEGAL_COMMENTED',
    jsonb_build_object('comment_id', v_id, 'parent_id', p_parent));
  select display_name into v_actor from public.profiles where id = v_uid;
  for rec in
    select distinct s.u from (
      select r.created_by as u
      union select p.user_id from public.legal_request_participants p
             where p.legal_request_id = p_request and p.removed_at is null
      union select r.assigned_judge_id
    ) s where s.u is not null and s.u <> v_uid
  loop
    perform private.legal_notify(rec.u, p_request, 'legal_comment',
      coalesce(v_actor, 'Someone') || ' commented on ' || r.request_number || ': ' || left(v_body, 140),
      jsonb_build_object('comment_id', v_id));
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Purpose:        the author rewrites their own comment; the prior body goes
--                 to legal_request_comment_versions (immutable).
create or replace function public.legal_comment_edit(p_comment uuid, p_body text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.legal_request_comments;
        v_body text := left(btrim(coalesce(p_body, '')), 4000);
begin
  select * into c from public.legal_request_comments where id = p_comment for update;
  if not found then raise exception 'comment not found'; end if;
  if v_body = '' then raise exception 'a comment body is required'; end if;
  if c.deleted_at is not null then raise exception 'a deleted comment cannot be edited'; end if;
  if c.author_id <> v_uid then
    return private.legal_denied('comment', c.legal_request_id, 'not_author',
      'only the author may edit a comment');
  end if;
  if c.body = v_body then return jsonb_build_object('ok', true); end if;
  insert into public.legal_request_comment_versions (comment_id, body, edited_by)
  values (c.id, c.body, v_uid);
  update public.legal_request_comments set body = v_body, edited_at = now() where id = c.id;
  perform private.legal_audit(c.legal_request_id, 'LEGAL_COMMENT_EDITED',
    jsonb_build_object('comment_id', c.id));
  return jsonb_build_object('ok', true);
end $$;

-- Purpose:        soft-delete a comment — the row stays (thread shape and
--                 replies survive) with an empty body; the last body is kept
--                 in the versions table. Author, Attorney General, Owner.
create or replace function public.legal_comment_delete(p_comment uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); c public.legal_request_comments;
begin
  select * into c from public.legal_request_comments where id = p_comment for update;
  if not found then raise exception 'comment not found'; end if;
  if c.deleted_at is not null then return jsonb_build_object('ok', true); end if;
  if not (c.author_id = v_uid
          or coalesce(private.justice_role_effective(v_uid) = 'attorney_general', false)
          or private.owner_flag(v_uid)) then
    return private.legal_denied('comment', c.legal_request_id, 'not_author',
      'only the author, the Attorney General or the Owner may delete a comment');
  end if;
  insert into public.legal_request_comment_versions (comment_id, body, edited_by)
  values (c.id, c.body, v_uid);
  update public.legal_request_comments
     set body = '', deleted_at = now(), deleted_by = v_uid
   where id = c.id;
  perform private.legal_audit(c.legal_request_id, 'LEGAL_COMMENT_DELETED',
    jsonb_build_object('comment_id', c.id, 'author_id', c.author_id,
                       'by_author', c.author_id = v_uid));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 4. P4-06 — the creator ticks off a returned checklist item
-- ---------------------------------------------------------------------------
create or replace function public.legal_revision_resolve(p_item uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); i public.legal_request_revision_items;
begin
  select * into i from public.legal_request_revision_items where id = p_item for update;
  if not found then raise exception 'revision item not found'; end if;
  if i.resolved_at is not null then return jsonb_build_object('ok', true); end if;
  if not private.can_edit_legal_draft(i.legal_request_id, v_uid) then
    return private.legal_denied('edit', i.legal_request_id, 'not_editable',
      'revision items are resolved by the creator while the request is editable');
  end if;
  update public.legal_request_revision_items
     set resolved_at = now(), resolved_by = v_uid,
         resolution_note = left(nullif(btrim(coalesce(p_note, '')), ''), 2000)
   where id = p_item;
  perform private.legal_audit(i.legal_request_id, 'LEGAL_REVISION_RESOLVED',
    jsonb_build_object('item_id', p_item, 'field', i.field));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 5. P4-08 — evidence added from inside the request
-- ---------------------------------------------------------------------------

-- Purpose:        the client uploads to the media host first (the existing
--                 MediaUploadPanel seam) and hands over the URL; the server
--                 files a public.media row on the request's case (kind
--                 'legal_upload', uploaded_by = caller) and attaches it as a
--                 case_media exhibit through add_legal_exhibit, so the
--                 exhibit checks (editable, case access) stay in one place.
create or replace function public.legal_add_evidence_and_exhibit(p_request uuid, p_title text,
  p_type public.media_type, p_external_url text, p_category text default null, p_rationale text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_media uuid;
        e public.legal_request_exhibits; v_title text := left(btrim(coalesce(p_title, '')), 200);
        v_url text := btrim(coalesce(p_external_url, ''));
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if v_title = '' then raise exception 'a title is required'; end if;
  if v_url !~* '^https?://' then raise exception 'the media URL must use http:// or https://'; end if;
  if p_category is not null and p_category not in
     ('scene', 'people', 'vehicles', 'places', 'surveillance', 'documents', 'report_media', 'other') then
    raise exception 'invalid media category';
  end if;
  if not private.can_edit_legal_draft(p_request, v_uid) then
    return private.legal_denied('edit', p_request, 'not_editable',
      'evidence can only be added while the request is editable');
  end if;
  if not (private.is_active() and private.case_writable(r.case_id)) then
    return private.legal_denied('edit', p_request, 'case_not_writable',
      'this request''s case is not writable (no access, archived or deleted)');
  end if;
  insert into public.media (title, type, external_url, kind, case_id, uploaded_by, category)
  values (v_title, p_type, v_url, 'legal_upload', r.case_id, v_uid, p_category)
  returning id into v_media;
  e := public.add_legal_exhibit(p_request, 'case_media', v_media, v_title,
         jsonb_build_object('url', v_url, 'media_type', p_type::text, 'legal_upload', true),
         p_rationale);
  perform private.legal_log(p_request, null, 'evidence_added', null, null, v_title, null);
  perform private.legal_audit(p_request, 'LEGAL_EVIDENCE_ADDED',
    jsonb_build_object('media_id', v_media, 'exhibit_id', e.id, 'media_type', p_type::text));
  return jsonb_build_object('ok', true, 'media_id', v_media, 'exhibit_id', e.id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. P4-09 — amend (a new draft that cites the decided one) and observers
-- ---------------------------------------------------------------------------

-- Purpose:        a decided or terminal request is never edited; an amendment
--                 is a NEW draft (amends_request_id = source) carrying the
--                 source's public form, narrative, targets, exhibits and
--                 charges, owned by whoever opened it. Any active member with
--                 case access who can see the source (a teammate included).
create or replace function public.legal_amend(p_request uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); s public.legal_requests; n public.legal_requests;
        v_reason text := left(btrim(coalesce(p_reason, '')), 2000); v_archived timestamptz;
        v_exhibits integer := 0; v_charges integer := 0;
begin
  select * into s from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if v_reason = '' then raise exception 'a reason is required'; end if;
  if s.review_status not in ('approved', 'partially_approved', 'denied', 'superseded', 'withdrawn', 'cancelled') then
    raise exception 'only a decided or closed request can be amended — edit the draft instead';
  end if;
  if not private.can_amend_legal(p_request, v_uid) then
    return private.legal_denied('amend', p_request, 'no_case_access',
      'amending needs active membership, access to the case and sight of the request');
  end if;
  select archived_at into v_archived from public.cases where id = s.case_id;
  if v_archived is not null then
    raise exception 'this case is archived — restore it before amending a legal request';
  end if;

  insert into public.legal_requests
    (request_type, subtype, case_id, source_report_id, source_report_seq, created_by,
     responsible_bureau, classification, priority, title, form_data, narrative,
     person_id, person_name_snapshot, citizen_id_snapshot, recipient_type, recipient_name,
     case_number_snapshot, case_title_snapshot, approval_route, amends_request_id)
  values
    (s.request_type, s.subtype, s.case_id, s.source_report_id, s.source_report_seq, v_uid,
     private.legal_resolve_bureau(s.case_id), s.classification, s.priority, s.title,
     private.legal_form_public(s.form_data), s.narrative,
     s.person_id, s.person_name_snapshot, s.citizen_id_snapshot, s.recipient_type, s.recipient_name,
     s.case_number_snapshot, s.case_title_snapshot,
     coalesce(s.approval_route, private.legal_default_route(s.request_type, s.subtype)), p_request)
  returning * into n;

  perform private.legal_add_participant(n.id, v_uid, 'requesting_investigator');

  insert into public.legal_request_exhibits
    (legal_request_id, exhibit_type, source_id, display_title, snapshot_metadata, added_by, rationale)
  select n.id, e.exhibit_type, e.source_id, e.display_title, e.snapshot_metadata, v_uid, e.rationale
    from public.legal_request_exhibits e
   where e.legal_request_id = p_request
   order by e.created_at;
  get diagnostics v_exhibits = row_count;

  insert into public.legal_request_charges
    (legal_request_id, case_charge_id, snap_code, snap_offense, snap_charge_class,
     snap_penal_title, counts, added_by)
  select n.id, c.case_charge_id, c.snap_code, c.snap_offense, c.snap_charge_class,
         c.snap_penal_title, c.counts, v_uid
    from public.legal_request_charges c
   where c.legal_request_id = p_request;
  get diagnostics v_charges = row_count;

  perform private.legal_log(n.id, null, 'created', null, 'not_submitted', null, null);
  perform private.legal_log(n.id, null, 'amended_from', null, null,
    'Amends ' || s.request_number || ': ' || v_reason, null);
  perform private.legal_audit(n.id, 'LEGAL_AMENDED', jsonb_build_object(
    'source_id', p_request, 'source_number', s.request_number,
    'source_status', s.review_status, 'reason', left(v_reason, 300),
    'exhibits', v_exhibits, 'charges', v_charges));
  perform private.legal_audit(n.id, 'LEGAL_CREATED', jsonb_build_object(
    'type', n.request_type, 'subtype', n.subtype, 'case_id', n.case_id,
    'bureau', n.responsible_bureau, 'amends', p_request));
  return jsonb_build_object('ok', true, 'id', n.id, 'request_number', n.request_number);
end $$;

-- Purpose:        per-request observer access (L16). An observer sees the
--                 request through the participant branch of
--                 can_view_legal_request and may comment; nothing else.
--                 Target: an active CID profile or an active justice member.
create or replace function public.legal_set_observer(p_request uuid, p_user uuid,
  p_active boolean default true, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_name text;
        v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  select * into r from public.legal_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if p_user is null then raise exception 'an observer is required'; end if;
  if not private.can_set_legal_observer(p_request, v_uid) then
    return private.legal_denied('observe', p_request, 'not_command',
      'only the creator, command or the Attorney General may change observers');
  end if;
  -- A sealed request is walled off even from case members; re-opening it to
  -- one more person is a command / Attorney General decision, never the
  -- creator's alone.
  if r.classification = 'sealed' and not private.legal_is_command_authority(p_request, v_uid) then
    return private.legal_denied('observe', p_request, 'sealed_not_command',
      'observers on a sealed request are granted by command or the Attorney General');
  end if;
  if p_user = r.created_by then raise exception 'the creator is already a participant'; end if;
  select display_name into v_name from public.profiles p
   where p.id = p_user and p.removed_at is null
     and (p.active or private.justice_role_of(p.id) is not null);
  if not found then raise exception 'the observer must be an active member or justice member'; end if;
  if coalesce(p_active, true) then
    if private.is_legal_participant(p_request, p_user)
       and exists (select 1 from public.legal_request_participants x
                    where x.legal_request_id = p_request and x.user_id = p_user
                      and x.participant_role = 'observer' and x.removed_at is null) then
      return jsonb_build_object('ok', true);
    end if;
    perform private.legal_add_participant(p_request, p_user, 'observer');
    perform private.legal_log(p_request, null, 'observer_added', null, null,
      coalesce(v_name, 'Observer') || coalesce(' — ' || v_reason, ''), null);
    perform private.legal_notify(p_user, p_request, 'legal_observer',
      'You were added as an observer on ' || r.request_number || '.'
      || coalesce(' ' || v_reason, ''));
  else
    if not exists (select 1 from public.legal_request_participants x
                    where x.legal_request_id = p_request and x.user_id = p_user
                      and x.participant_role = 'observer' and x.removed_at is null) then
      return jsonb_build_object('ok', true);
    end if;
    perform private.legal_end_participant(p_request, p_user, 'observer');
    perform private.legal_log(p_request, null, 'observer_removed', null, null,
      coalesce(v_name, 'Observer') || coalesce(' — ' || v_reason, ''), null);
  end if;
  perform private.legal_audit(p_request, 'LEGAL_OBSERVER_SET',
    jsonb_build_object('user_id', p_user, 'active', coalesce(p_active, true), 'reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 7. P4-11 — export ledger
-- ---------------------------------------------------------------------------

-- Purpose:        every PDF / DOCX the client renders is logged against the
--                 frozen version it came from, with a short verification code
--                 the printed page carries. The instrument (the decided
--                 warrant / subpoena) exists only once approved; the packet
--                 (dossier) follows the read.
create or replace function public.legal_record_export(p_request uuid, p_format text, p_kind text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); r public.legal_requests; v_id uuid; v_code text;
begin
  select * into r from public.legal_requests where id = p_request;
  if not found then raise exception 'request not found'; end if;
  if p_format not in ('pdf', 'docx') then raise exception 'format must be pdf or docx'; end if;
  if p_kind not in ('instrument', 'packet') then raise exception 'kind must be instrument or packet'; end if;
  if not private.can_view_legal_request(p_request, v_uid) then
    return private.legal_denied('export', p_request, 'not_visible', 'not authorized to export this request');
  end if;
  if p_kind = 'instrument' and r.review_status not in ('approved', 'partially_approved') then
    raise exception 'the instrument can only be exported once the request is approved';
  end if;
  v_code := upper(left(md5(coalesce(r.current_version_id::text, '') || p_request::text), 10));
  insert into public.legal_export_log
    (legal_request_id, version_id, format, kind, verification_code, exported_by)
  values (p_request, r.current_version_id, p_format, p_kind, v_code, v_uid)
  returning id into v_id;
  perform private.legal_log(p_request, r.current_version_id, 'exported', null, null,
    upper(p_format) || ' ' || p_kind || ' · ' || v_code, null);
  perform private.legal_audit(p_request, 'LEGAL_EXPORTED', jsonb_build_object(
    'export_id', v_id, 'format', p_format, 'kind', p_kind,
    'version_id', r.current_version_id, 'verification_code', v_code));
  return jsonb_build_object('ok', true, 'id', v_id, 'version_id', r.current_version_id,
                            'verification_code', v_code);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants — the new RPCs are callable by signed-in users; every refusal is
--    inside the body.
-- ---------------------------------------------------------------------------
revoke all on function public.legal_set_charges(uuid, jsonb) from public, anon;
revoke all on function public.legal_comment(uuid, text, uuid) from public, anon;
revoke all on function public.legal_comment_edit(uuid, text) from public, anon;
revoke all on function public.legal_comment_delete(uuid) from public, anon;
revoke all on function public.legal_revision_resolve(uuid, text) from public, anon;
revoke all on function public.legal_add_evidence_and_exhibit(uuid, text, public.media_type, text, text, text) from public, anon;
revoke all on function public.legal_amend(uuid, text) from public, anon;
revoke all on function public.legal_set_observer(uuid, uuid, boolean, text) from public, anon;
revoke all on function public.legal_record_export(uuid, text, text) from public, anon;
grant execute on function public.legal_set_charges(uuid, jsonb) to authenticated;
grant execute on function public.legal_comment(uuid, text, uuid) to authenticated;
grant execute on function public.legal_comment_edit(uuid, text) to authenticated;
grant execute on function public.legal_comment_delete(uuid) to authenticated;
grant execute on function public.legal_revision_resolve(uuid, text) to authenticated;
grant execute on function public.legal_add_evidence_and_exhibit(uuid, text, public.media_type, text, text, text) to authenticated;
grant execute on function public.legal_amend(uuid, text) to authenticated;
grant execute on function public.legal_set_observer(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.legal_record_export(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. private.perm_dispatch — the `legal` arm grows the Phase 4 actions;
--    every other arm is byte-identical to 20261022120000.
-- ---------------------------------------------------------------------------
create or replace function private.perm_dispatch(p_action text, p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(case
    when p_kind = 'legal' then case p_action
      when 'read'    then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'edit'    then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'approve' then private.can_approve_legal(p_id, (select auth.uid()))
      -- Phase 4 (P4-03 … P4-11): the request-side actions the dossier shows.
      when 'comment'     then private.legal_can_comment(p_id, (select auth.uid()))
      when 'set_charges' then private.can_edit_legal_draft(p_id, (select auth.uid()))
      when 'decide'      then exists (select 1 from public.legal_requests r
                                       where r.id = p_id and r.review_status = 'judicial_review'
                                         and r.assigned_judge_id = (select auth.uid()))
      when 'amend'       then private.can_amend_legal(p_id, (select auth.uid()))
      when 'supersede'   then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status in ('approved', 'partially_approved', 'denied', 'declined'))
      when 'cancel'      then private.legal_is_command_authority(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status not in ('approved', 'partially_approved', 'denied',
                                                                       'withdrawn', 'declined', 'cancelled', 'superseded'))
      when 'export'      then private.can_view_legal_request(p_id, (select auth.uid()))
      when 'observe'     then private.can_set_legal_observer(p_id, (select auth.uid()))
      when 'assign_judge' then private.can_manage_legal_assignment(p_id, (select auth.uid()))
                              and exists (select 1 from public.legal_requests r where r.id = p_id
                                           and r.review_status = 'submitted_to_judge')
      else false end
    when p_kind = 'case' and p_action in ('access', 'archive', 'unarchive', 'grant_access', 'delete_child', 'permanent_delete') then case p_action
      when 'access'       then private.can_access_case(p_id)
      when 'archive'      then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null and c.deleted_at is null)
                               and not private.case_has_active_hold(p_id)
      when 'unarchive'    then private.is_command()
                               and exists (select 1 from public.cases c where c.id = p_id and c.archived_at is not null and c.deleted_at is null)
      when 'grant_access' then private.can_grant_case(p_id)
                               and exists (select 1 from public.cases c where c.id = p_id and c.deleted_at is null)
      when 'delete_child' then private.can_delete_case_child(p_id)
      when 'permanent_delete' then private.is_owner()
                               and exists (select 1 from public.cases c where c.id = p_id
                                            and (c.archived_at is not null or c.deleted_at is not null))
      else false end
    when p_kind in ('person', 'vehicle', 'gang', 'place', 'account', 'indicator', 'narcotic', 'operation', 'tracker', 'gang_member', 'gang_turf', 'person_place', 'person_vehicle', 'person_relationship', 'account_link', 'case', 'report', 'media', 'evidence', 'case_task', 'case_message', 'case_intel_link', 'case_blocker', 'rico_case', 'predicate_act', 'case_note', 'case_link') then (
      select case p_action
        when 'read' then st.p_exists and (st.p_deleted_at is null or private.is_owner())
                         and private.perm_registry_visible(p_kind, p_id)
        when 'edit' then st.p_exists and st.p_deleted_at is null
                         and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                         and private.perm_registry_edit(p_kind, p_id)
        when 'soft_delete' then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'delete'      then st.p_exists and st.p_deleted_at is null and private.perm_registry_delete(p_kind, p_id)
        when 'restore'     then st.p_exists and st.p_deleted_at is not null
                                and (private.is_owner() or private.perm_registry_delete(p_kind, p_id))
        -- P1-05: field-level history follows the read; a restore is an edit
        -- (a finalized report and a legal request are display-only).
        when 'read_history' then private.version_table(p_kind) is not null
                                and st.p_exists and (st.p_deleted_at is null or private.is_owner())
                                and private.perm_registry_visible(p_kind, p_id)
        when 'restore_version' then private.version_table(p_kind) is not null
                                and st.p_exists and st.p_deleted_at is null
                                and (p_kind <> 'case' or exists (select 1 from public.cases c where c.id = p_id and c.archived_at is null))
                                and private.perm_registry_edit(p_kind, p_id)
                                and not (p_kind = 'report' and exists (select 1 from public.reports r where r.id = p_id and r.finalized))
        -- P1-07: the Owner permanently deletes from the Trash (an archived
        -- case too); the protocol's own preview refuses live dependants.
        when 'permanent_delete' then private.is_owner() and st.p_exists and st.p_deleted_at is not null
        else false end
      from private.soft_delete_state(p_kind, p_id) st)
    else false end, false)
$$;
revoke all on function private.perm_dispatch(text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Catalog — the `read` row's rule text loses the prosecutor lanes; nine
--     new legal actions.
-- ---------------------------------------------------------------------------
insert into public.permission_catalog (action, kind, area, rule, enforcing_object, test_id, matrix, sort_order) values
  ('read', 'legal', 'Read a legal request', 'Creator, active participants (observers included), Owner, the Attorney General once the request reached the judicial queue, judges for the judicial queue (never sealed), the CID / SIB reviewer during bureau review, CID case members for standard classification; sealed requests are undiscoverable.', 'private.can_view_legal_request', 'legal', '{"owner":"✓","command":"participant / case member (standard)","member":"participant / case member (standard)","inactive":"✗"}', 400),
  ('comment', 'legal', 'Comment on a legal request', 'Creator, active participants (the assigned judge, observers), the CID / SIB approver pool, the Attorney General wherever the request is visible to them, Owner.', 'public.legal_comment → private.legal_can_comment', 'v186c', '{"owner":"✓","command":"approver pool / participant","member":"creator / participant","inactive":"✗"}', 430),
  ('set_charges', 'legal', 'Set the charges on a legal request', 'The creator, while the request is a draft or returned; every charge must belong to the request''s case.', 'public.legal_set_charges', 'v186b', '{"owner":"creator","command":"creator","member":"creator","inactive":"✗"}', 440),
  ('decide', 'legal', 'Decide a legal request as the judge', 'The assigned judge, during judicial review; a per-target denial needs reasoning and at least one approved target.', 'public.decide_legal_request_as_judge', 'v186d', '{"owner":"✗","command":"✗","member":"✗","inactive":"✗"}', 450),
  ('amend', 'legal', 'Amend a decided legal request', 'An active member with access to the case who can see the request, once it is decided or closed; lands as a NEW draft that cites the source.', 'public.legal_amend → private.can_amend_legal', 'v186e', '{"owner":"✓","command":"case access","member":"case access","inactive":"✗"}', 460),
  ('supersede', 'legal', 'Supersede a decided legal request', 'The CID / SIB approver pool, the Attorney General or the Owner; the replacement must be approved and on the same case.', 'public.legal_mark_superseded', 'v186e', '{"owner":"✓","command":"approver pool","member":"✗","inactive":"✗"}', 470),
  ('cancel', 'legal', 'Cancel an in-flight legal request', 'The CID / SIB approver pool, the Attorney General or the Owner, with a reason, before a decision.', 'public.legal_admin_cancel', 'v186e', '{"owner":"✓","command":"approver pool","member":"✗","inactive":"✗"}', 480),
  ('export', 'legal', 'Export a legal request (PDF / DOCX)', 'Whoever can read the request; the instrument only once approved. Every export is logged with a verification code.', 'public.legal_record_export', 'v186e', '{"owner":"✓","command":"read access","member":"read access","inactive":"✗"}', 490),
  ('observe', 'legal', 'Grant or revoke observer access on a legal request', 'The creator, the CID / SIB approver pool, the Attorney General or the Owner; the observer must be an active member or justice member.', 'public.legal_set_observer → private.can_set_legal_observer', 'v186c', '{"owner":"✓","command":"approver pool","member":"creator","inactive":"✗"}', 500),
  ('assign_judge', 'legal', 'Assign a judge to a legal request', 'The Attorney General (or the Owner with no AG seated), while the request awaits a judge; sealed requests are never self-claimed.', 'public.assign_judge', 'v186a', '{"owner":"fallback","command":"✗","member":"✗","inactive":"✗"}', 510)
on conflict (action, kind) do update set area = excluded.area, rule = excluded.rule,
  enforcing_object = excluded.enforcing_object, test_id = excluded.test_id, matrix = excluded.matrix, sort_order = excluded.sort_order;

-- ============================================================================
-- Rollback: re-emit private.perm_dispatch from the 20261022120000 state;
-- drop the nine public RPCs and the six private helpers; delete the nine new
-- catalog rows and restore the 20261005120000 `read` row.
-- ============================================================================

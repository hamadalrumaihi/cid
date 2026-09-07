-- ============================================================================
-- 20261028120000_report_templates.sql
-- Phase 5 (P5-01 templates in the database, P5-02 template administration,
--          P5-06 the six new templates) — report_templates +
-- report_template_versions, the seed of every FORM_SCHEMAS form as a
-- published version 1, reports.template_version_id (pinned at creation) and
-- the review columns, the template-admin RPCs.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox as
-- migration `report_templates` (Supabase MCP). Additive: new tables, new
-- nullable columns, CREATE OR REPLACE functions; public.report_create is
-- re-emitted (unknown / retired template refused, version pinned) and
-- rls_test_cleanup is spliced through pg_get_functiondef. After the security
-- review, private.report_schema_keys (opts must be strings, 200 KB cap),
-- private.reports_template_pin (retired templates never pinned) and
-- report_template_save (a pending draft is replaced only by its author or a
-- Director) were re-applied live as report_review_fixes, byte-identical to
-- this file.
--
-- Design (decisions RB1, RB4, RB10; plan §5.7 / §6.6):
--   · a template is a key + name; its versions carry the FormSchema (the
--     exact src/lib/forms.ts shape), the required and advisory field keys and
--     review_required; one published and at most one draft per template;
--   · a report pins the published version at creation (BEFORE INSERT trigger
--     `reports_template_pin` fills it for direct inserts too; a direct insert
--     with an unknown key keeps NULL — the v180 fixture inserts template
--     'initial' — which is why the plan's NOT NULL is not applied);
--   · Director / Deputy Director / Owner publish, retire and create keys;
--     Bureau Leads propose drafts on existing templates.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.report_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text not null,
  description text,
  is_default boolean not null default false,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.report_templates enable row level security;
drop policy if exists rt_sel on public.report_templates;
create policy rt_sel on public.report_templates for select to authenticated
  using (private.is_active() or private.is_owner());
revoke all on public.report_templates from public, anon, authenticated;
grant select on public.report_templates to authenticated;
grant all on public.report_templates to service_role;
drop trigger if exists report_templates_touch on public.report_templates;
create trigger report_templates_touch before update on public.report_templates
  for each row execute function private.touch();
drop trigger if exists report_templates_audit on public.report_templates;
create trigger report_templates_audit after insert or delete or update on public.report_templates
  for each row execute function private.audit();

create table if not exists public.report_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.report_templates(id) on delete restrict,
  version_number integer not null check (version_number >= 1),
  schema jsonb not null,
  required text[] not null default '{}',
  advisory text[] not null default '{}',
  review_required boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  change_summary text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  superseded_at timestamptz,
  unique (template_id, version_number)
);
create unique index if not exists report_template_versions_one_published_idx
  on public.report_template_versions (template_id) where status = 'published';
create unique index if not exists report_template_versions_one_draft_idx
  on public.report_template_versions (template_id) where status = 'draft';
alter table public.report_template_versions enable row level security;
drop policy if exists rtv_sel on public.report_template_versions;
create policy rtv_sel on public.report_template_versions for select to authenticated
  using (private.is_active() or private.is_owner());
revoke all on public.report_template_versions from public, anon, authenticated;
grant select on public.report_template_versions to authenticated;
grant all on public.report_template_versions to service_role;
drop trigger if exists report_template_versions_audit on public.report_template_versions;
create trigger report_template_versions_audit after insert or delete or update on public.report_template_versions
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------
-- 2. Schema validation (shared by the seed and report_template_save)
-- ---------------------------------------------------------------------------
-- Purpose:        the FormSchema shape src/lib/forms.ts renders: title,
--                 subtitle, sections[] of kv (fields) | grid (cols) |
--                 textarea (key) | note (text); returns the set of value keys
--                 (field keys, textarea keys, grid section ids) so required /
--                 advisory lists can be checked against it.
create or replace function private.report_schema_keys(p_schema jsonb)
returns text[] language plpgsql immutable set search_path to '' as $$
declare s jsonb; f jsonb; v_keys text[] := '{}'; v_ids text[] := '{}'; v_type text; v_k text;
        v_ftypes text[] := array['text', 'date', 'money', 'select', 'textarea', 'checks'];
begin
  if p_schema is null or jsonb_typeof(p_schema) <> 'object' then raise exception 'schema must be an object'; end if;
  if length(p_schema::text) > 200000 then raise exception 'schema is too large (200 KB limit)'; end if;
  if btrim(coalesce(p_schema->>'title', '')) = '' then raise exception 'schema.title is required'; end if;
  if jsonb_typeof(p_schema->'subtitle') is distinct from 'string' then raise exception 'schema.subtitle must be a string'; end if;
  if jsonb_typeof(p_schema->'sections') <> 'array' or jsonb_array_length(p_schema->'sections') = 0 then
    raise exception 'schema.sections must be a non-empty array';
  end if;
  for s in select * from jsonb_array_elements(p_schema->'sections') loop
    if jsonb_typeof(s) <> 'object' then raise exception 'each section must be an object'; end if;
    if btrim(coalesce(s->>'id', '')) = '' or btrim(coalesce(s->>'label', '')) = '' then
      raise exception 'every section needs an id and a label';
    end if;
    if (s->>'id') = any(v_ids) then raise exception 'duplicate section id %', s->>'id'; end if;
    v_ids := v_ids || (s->>'id');
    v_type := s->>'type';
    if v_type = 'kv' then
      if jsonb_typeof(s->'fields') <> 'array' or jsonb_array_length(s->'fields') = 0 then
        raise exception 'kv section % needs fields', s->>'id';
      end if;
      for f in select * from jsonb_array_elements(s->'fields') loop
        v_k := f->>'key';
        if btrim(coalesce(v_k, '')) = '' or btrim(coalesce(f->>'label', '')) = '' then
          raise exception 'every field in section % needs a key and a label', s->>'id';
        end if;
        if not (coalesce(f->>'type', '') = any(v_ftypes)) then
          raise exception 'field % has an unknown type %', v_k, f->>'type';
        end if;
        if f->>'type' in ('select', 'checks') and jsonb_typeof(f->'opts') <> 'array' then
          raise exception 'field % needs opts', v_k;
        end if;
        if f ? 'opts' and exists (select 1 from jsonb_array_elements(f->'opts') o where jsonb_typeof(o) <> 'string') then
          raise exception 'field % opts must be strings', v_k;
        end if;
        if v_k = any(v_keys) then raise exception 'duplicate field key %', v_k; end if;
        v_keys := v_keys || v_k;
      end loop;
    elsif v_type = 'grid' then
      if jsonb_typeof(s->'cols') <> 'array' or jsonb_array_length(s->'cols') = 0 then
        raise exception 'grid section % needs cols', s->>'id';
      end if;
      for f in select * from jsonb_array_elements(s->'cols') loop
        if btrim(coalesce(f->>'key', '')) = '' or btrim(coalesce(f->>'label', '')) = '' then
          raise exception 'every column in section % needs a key and a label', s->>'id';
        end if;
        if f ? 'type' and not (coalesce(f->>'type', '') = any(v_ftypes)) then
          raise exception 'column % has an unknown type %', f->>'key', f->>'type';
        end if;
      end loop;
      if (s->>'id') = any(v_keys) then raise exception 'grid id % collides with a field key', s->>'id'; end if;
      v_keys := v_keys || (s->>'id');
    elsif v_type = 'textarea' then
      v_k := s->>'key';
      if btrim(coalesce(v_k, '')) = '' then raise exception 'textarea section % needs a key', s->>'id'; end if;
      if v_k = any(v_keys) then raise exception 'duplicate field key %', v_k; end if;
      v_keys := v_keys || v_k;
    elsif v_type = 'note' then
      if btrim(coalesce(s->>'text', '')) = '' then raise exception 'note section % needs text', s->>'id'; end if;
    else
      raise exception 'section % has an unknown type %', s->>'id', coalesce(v_type, '(none)');
    end if;
  end loop;
  return v_keys;
end $$;
revoke all on function private.report_schema_keys(jsonb) from public, anon, authenticated;

-- Purpose:        a jsonb array of strings → text[], every entry a known key.
create or replace function private.report_key_list(p_list jsonb, p_keys text[], p_what text)
returns text[] language plpgsql immutable set search_path to '' as $$
declare v_out text[] := '{}'; x text;
begin
  if p_list is null or jsonb_typeof(p_list) = 'null' then return v_out; end if;
  if jsonb_typeof(p_list) <> 'array' then raise exception '% must be an array of field keys', p_what; end if;
  for x in select jsonb_array_elements_text(p_list) loop
    if not (x = any(p_keys)) then raise exception '% key % is not in the schema', p_what, x; end if;
    if not (x = any(v_out)) then v_out := v_out || x; end if;
  end loop;
  return v_out;
end $$;
revoke all on function private.report_key_list(jsonb, text[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Authority
-- ---------------------------------------------------------------------------
create or replace function private.report_template_admin()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.is_owner()
      or exists (select 1 from public.profiles p
                  where p.id = (select auth.uid()) and p.active and p.removed_at is null
                    and p.role in ('deputy_director', 'director'))
$$;
revoke all on function private.report_template_admin() from public, anon, authenticated;

create or replace function private.report_template_proposer()
returns boolean language sql stable security definer set search_path to '' as $$
  select private.report_template_admin()
      or exists (select 1 from public.profiles p
                  where p.id = (select auth.uid()) and p.active and p.removed_at is null
                    and p.role = 'bureau_lead')
$$;
revoke all on function private.report_template_proposer() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Seed — every FORM_SCHEMAS form (8 existing + the six of P5-06) as a
--    published version 1. Idempotent: a key that already exists is skipped.
-- ---------------------------------------------------------------------------
do $$
declare v_seed jsonb := $seed${"cid_investigative_report":{"name":"CID Investigative Report","description":"The general investigative report.","is_default":true,"sort_order":10,"schema":{"title":"CID Investigative Report","subtitle":"Criminal Investigations Department — Major Crimes Bureau — FOR OFFICIAL USE ONLY","sections":[{"id":"details","label":"Case / Report Details","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"report_type","label":"Report Type","type":"select","opts":["Initial","Supplemental","Follow-up"]},{"key":"filed_at","label":"Date / Time Filed","type":"text"}]},{"id":"detective","label":"Detective Information","type":"kv","fields":[{"key":"det_name","label":"Name","type":"text"},{"key":"det_rank","label":"Rank","type":"text"},{"key":"det_callsign","label":"Callsign","type":"text"},{"key":"det_dept","label":"Department","type":"select","opts":["","LSPD","BCSO","SAHP"]}]},{"id":"subjects","label":"Suspect / Witness Information","type":"grid","cols":[{"key":"name","label":"Name","type":"text","person":true},{"key":"phone","label":"Phone","type":"text"},{"key":"dob","label":"DOB","type":"text"},{"key":"affiliation","label":"Affiliation","type":"text"}]},{"id":"rights","label":"Rights Advisement","type":"kv","fields":[{"key":"rights_admin","label":"Article 31 / Miranda Administered","type":"select","opts":["","Yes","No"]},{"key":"rights_dt","label":"Date / Time","type":"text"},{"key":"rights_waived","label":"Rights Waived?","type":"select","opts":["","Yes","No"]},{"key":"rights_witness","label":"Rights Witness","type":"text"}]},{"id":"incident","label":"Incident Details","type":"kv","fields":[{"key":"inc_type","label":"Type of Incident","type":"text"},{"key":"inc_dt","label":"Date / Time of Incident","type":"text"},{"key":"inc_loc","label":"Location of Incident","type":"text"},{"key":"inc_parties","label":"Involved Parties","type":"text"},{"key":"inc_class","label":"MCB Classification","type":"text"}]},{"id":"narrative","label":"Narrative / Statement","type":"textarea","key":"narrative"},{"id":"evidence","label":"Evidence / Property","type":"kv","evidenceLookup":true,"fields":[{"key":"ev_items","label":"Item(s)","type":"text"},{"key":"ev_collected_by","label":"Collected by","type":"text"},{"key":"ev_files","label":"Files","type":"text"}]},{"id":"remarks","label":"Detective Remarks","type":"textarea","key":"remarks"},{"id":"actions","label":"Investigative Actions","type":"grid","cols":[{"key":"action","label":"Action Taken","type":"text"}]},{"id":"understanding","label":"Statement of Understanding","type":"note","text":"By completing this report, I understand that I am strictly prohibited from disclosing any information, reports, or materials pertaining to Criminal Investigation Division (CID) matters, whether ongoing, past, or closed, as doing so may jeopardize the integrity of investigative processes, compromise the rights and safety of individuals involved, and undermine the mission of CID. I further acknowledge that any unauthorized disclosure of such information may result in disciplinary, administrative, or criminal consequences under applicable laws and regulations."}]},"required":["case_number","filed_at","det_name","narrative"],"advisory":["inc_dt","inc_loc","ev_items"],"review_required":true},"raid_seizure":{"name":"Raid Seizure Value Distribution & Allocation Form","description":"Raid and seizure inventory with fund allocation.","is_default":false,"sort_order":20,"schema":{"title":"Raid Seizure Value Distribution & Allocation Form","subtitle":"Criminal Investigations Department — FOR OFFICIAL USE ONLY","sections":[{"id":"case","label":"Case Information","type":"kv","fields":[{"key":"bureau","label":"Bureau","type":"select","opts":["","Major Crimes Bureau","Street Crimes Bureau","Special Investigations Bureau","Joint Task Force"]},{"key":"case_number","label":"Case #","type":"text"},{"key":"operation","label":"Operation Name","type":"text"},{"key":"seizure_date","label":"Date of Seizure","type":"text"},{"key":"seizure_loc","label":"Location of Seizure","type":"text"}]},{"id":"inventory","label":"Seizure Inventory & Valuation","type":"grid","cols":[{"key":"item","label":"Item","type":"text"},{"key":"qty","label":"Quantity","type":"text"},{"key":"unit_value","label":"Unit Street Value","type":"money"},{"key":"total_value","label":"Total Street Value","type":"money"}]},{"id":"distribution","label":"Authorized Director Distribution","type":"kv","fields":[{"key":"net_value","label":"Total Net Seizure Value ($)","type":"money"},{"key":"lead_amount","label":"Amount to Lead Detective ($)","type":"money"},{"key":"division_amount","label":"Amount to Division","type":"money"},{"key":"other_alloc","label":"Other Allocations (if any)","type":"text"},{"key":"dir_sig","label":"Director Signature","type":"text"},{"key":"dist_date","label":"Date","type":"text"}]},{"id":"lead_alloc","label":"Lead Detective Allocation","type":"grid","cols":[{"key":"recipient_type","label":"Recipient Type","type":"text"},{"key":"recipient","label":"Recipient Name / Identifier","type":"text"},{"key":"allocation","label":"Allocation ($)","type":"money"}]},{"id":"final","label":"Final Authorization","type":"kv","fields":[{"key":"final_dir_sig","label":"Director Signature","type":"text"},{"key":"final_lead_sig","label":"Lead Detective Signature","type":"text"}]}]},"required":["case_number","seizure_date","operation","inventory"],"advisory":["net_value"],"review_required":true},"uc_operation":{"name":"Undercover Operation Activity Report","description":"Undercover operation report.","is_default":false,"sort_order":30,"schema":{"title":"Undercover Operation Activity Report","subtitle":"Criminal Investigations Department — FOR OFFICIAL USE ONLY","sections":[{"id":"report","label":"Report Information","type":"kv","fields":[{"key":"report_type","label":"Report Type","type":"select","opts":["Initial","Supplemental","Final"]},{"key":"submitted","label":"Date Submitted","type":"text"},{"key":"uc_officer","label":"UC Officer Name","type":"text"},{"key":"bureau","label":"Bureau","type":"select","opts":["","Major Crimes Bureau","Street Crimes Bureau","Special Investigations Bureau","Joint Task Force"]},{"key":"op_code","label":"Operation Code / Case ID","type":"text"}]},{"id":"overview","label":"Operation Overview","type":"kv","fields":[{"key":"activity_dates","label":"Date(s) of UC Activity","type":"text"},{"key":"objective","label":"Primary Objective","type":"text"}]},{"id":"summary","label":"Summary of Activities","type":"textarea","key":"summary"},{"id":"contacts","label":"Contacts & Interactions","type":"grid","cols":[{"key":"individual","label":"Individuals Met or Observed","type":"text"},{"key":"nature","label":"Nature of Interaction","type":"text"},{"key":"key_actions","label":"Key Conversations / Actions","type":"text"}]},{"id":"intel","label":"Intelligence & Evidence","type":"grid","evidencePick":true,"cols":[{"key":"item","label":"Items Observed or Discussed","type":"text"},{"key":"description","label":"Description of Evidence / Intelligence","type":"text"}]},{"id":"media","label":"Photos / Recordings Captured (attach references)","type":"textarea","key":"media_refs","mediaPick":true},{"id":"assessment","label":"Operational Assessment","type":"kv","fields":[{"key":"threat_level","label":"Threat Level","type":"select","opts":["","Low","Medium","High","Critical"]},{"key":"cover_status","label":"UC Cover Status","type":"select","opts":["","Intact","At Risk","Compromised","Withdrawn"]}]},{"id":"notes","label":"Additional Notes","type":"textarea","key":"notes"},{"id":"approval","label":"Review & Approval","type":"kv","fields":[{"key":"uc_sig","label":"UC Officer Signature","type":"text"},{"key":"lead_sig","label":"Unit Lead Signature","type":"text"}]}]},"required":["submitted","uc_officer","summary"],"advisory":["objective","threat_level"],"review_required":true},"arrest_warrant":{"name":"Arrest Warrant Request","description":"Legal drafting form — feeds a warrant request.","is_default":false,"sort_order":40,"schema":{"title":"Arrest Warrant Request","subtitle":"State of San Andreas — FOR OFFICIAL USE ONLY","sections":[{"id":"hdr","label":"Request","type":"kv","fields":[{"key":"warrant_title","label":"Warrant Title","type":"text"},{"key":"case_number","label":"Case Number","type":"text"},{"key":"detective","label":"Requesting Detective","type":"text"},{"key":"department","label":"Department","type":"select","opts":["","LSPD","BCSO","SAHP"]},{"key":"priority","label":"Priority","type":"select","opts":["","Medium","High","Critical"]},{"key":"date","label":"Date","type":"text"}]},{"id":"suspects","label":"Suspect Information","type":"grid","cols":[{"key":"full_name","label":"Full Name","type":"text","person":true},{"key":"dob","label":"DOB","type":"text"},{"key":"address","label":"Known Address","type":"text"}]},{"id":"charges","label":"Charges Requested","type":"textarea","key":"charges"},{"id":"summary","label":"Summary of Incident","type":"textarea","key":"summary"},{"id":"pc","label":"Probable Cause Statement","type":"textarea","key":"probable_cause"},{"id":"evidence","label":"Supporting Evidence","type":"kv","fields":[{"key":"supporting_evidence","label":"Evidence","type":"checks","opts":["Witness Statements","Surveillance Footage","Bodycam Footage","Physical Evidence","Other"]}]},{"id":"links","label":"Evidence / Supporting Links","type":"kv","evidenceLookup":true,"fields":[{"key":"ev_items","label":"Item(s)","type":"text"},{"key":"ev_files","label":"Files / Links","type":"text"}]},{"id":"affirm","label":"Detective Affirmation","type":"note","text":"I affirm that probable cause exists for the arrest of the above-named individual."},{"id":"sign","label":"Authorization","type":"kv","fields":[{"key":"detective_sig","label":"Detective Signature","type":"text"},{"key":"supervisor_approval","label":"Supervisor Approval","type":"text"},{"key":"judge_approval","label":"Judge Approval","type":"text"}]}]},"required":["case_number","detective","date","probable_cause"],"advisory":["charges","supporting_evidence"],"review_required":false},"search_warrant":{"name":"Search Warrant Affidavit","description":"Legal drafting form — feeds a warrant request.","is_default":false,"sort_order":50,"schema":{"title":"Search Warrant Affidavit","subtitle":"State of San Andreas — FOR OFFICIAL USE ONLY","sections":[{"id":"hdr","label":"Affidavit","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"affiant","label":"Affiant (Detective)","type":"text"},{"key":"department","label":"Department","type":"select","opts":["","LSPD","BCSO","SAHP"]},{"key":"date","label":"Date","type":"text"}]},{"id":"location","label":"Location to be Searched","type":"textarea","key":"location"},{"id":"properties","label":"Properties / Premises to Search","type":"grid","cols":[{"key":"address","label":"Address / Location","type":"text"},{"key":"type","label":"Type","type":"select","opts":["","Residence","Business","Vehicle","Storage Unit","Other"]},{"key":"notes","label":"Notes","type":"text"}]},{"id":"persons","label":"Person(s) Involved","type":"textarea","key":"persons_involved"},{"id":"items","label":"Items to be Seized","type":"kv","fields":[{"key":"items_to_seize","label":"Items","type":"checks","opts":["Narcotics","Firearms (Class 2 / Class 3)","Currency / Proceeds","Documents / Records","Electronic Devices","Other"]}]},{"id":"pc","label":"Probable Cause Narrative","type":"textarea","key":"probable_cause"},{"id":"basis","label":"Basis of Information","type":"kv","fields":[{"key":"basis","label":"Basis","type":"checks","opts":["Officer Observations","Witness Statements","Confidential Informant","Surveillance","Other"]}]},{"id":"affirm","label":"Detective Affirmation","type":"note","text":"I affirm that the information provided is true and accurate to the best of my knowledge."},{"id":"sign","label":"Authorization","type":"kv","fields":[{"key":"detective_sig","label":"Detective Signature","type":"text"},{"key":"supervisor_approval","label":"Supervisor Approval","type":"text"},{"key":"judge_approval","label":"Judge Approval","type":"text"}]}]},"required":["case_number","affiant","date","location","probable_cause"],"advisory":["items_to_seize","basis"],"review_required":false},"wiretap_warrant":{"name":"Wiretap / Electronic Surveillance Request","description":"Legal drafting form — feeds a warrant request.","is_default":false,"sort_order":60,"schema":{"title":"Wiretap / Electronic Surveillance Request","subtitle":"State of San Andreas — FOR OFFICIAL USE ONLY","sections":[{"id":"hdr","label":"Request","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"detective","label":"Requesting Detective","type":"text"},{"key":"department","label":"Department","type":"select","opts":["","LSPD","BCSO","SAHP"]},{"key":"date","label":"Date","type":"text"}]},{"id":"targets","label":"Target Information","type":"grid","cols":[{"key":"name_alias","label":"Name / Alias","type":"text","person":true},{"key":"phone_device","label":"Phone Number / Device","type":"text"}]},{"id":"type","label":"Type of Surveillance Requested","type":"kv","fields":[{"key":"surveillance_type","label":"Type","type":"checks","opts":["Phone Intercept","Text Message Monitoring","Electronic Communication Monitoring","Other"]}]},{"id":"details","label":"Investigation Details","type":"textarea","key":"investigation_details"},{"id":"pc","label":"Probable Cause","type":"textarea","key":"probable_cause"},{"id":"necessity","label":"Necessity Statement","type":"textarea","key":"necessity"},{"id":"duration","label":"Duration Requested","type":"kv","fields":[{"key":"duration","label":"Duration","type":"select","opts":["","24 Hours","48 Hours","72 Hours","Other"]}]},{"id":"affirm","label":"Detective Affirmation","type":"note","text":"I affirm that this request is necessary for the investigation and supported by probable cause."},{"id":"sign","label":"Authorization","type":"kv","fields":[{"key":"detective_sig","label":"Detective Signature","type":"text"},{"key":"supervisor_approval","label":"Supervisor Approval","type":"text"},{"key":"judge_approval","label":"Judge Approval","type":"text"}]}]},"required":["case_number","detective","date","probable_cause","necessity"],"advisory":["duration"],"review_required":false},"subpoena":{"name":"Subpoena — Records / Witness","description":"Legal drafting form — feeds a subpoena request.","is_default":false,"sort_order":70,"schema":{"title":"Subpoena — Records / Witness","subtitle":"State of San Andreas — FOR OFFICIAL USE ONLY","sections":[{"id":"hdr","label":"Issuance","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"detective","label":"Requesting Detective","type":"text"},{"key":"department","label":"Department","type":"select","opts":["","LSPD","BCSO","SAHP"]},{"key":"date","label":"Date","type":"text"}]},{"id":"type","label":"Subpoena Type","type":"kv","fields":[{"key":"subpoena_type","label":"Type","type":"checks","opts":["Records (Duces Tecum)","Witness Testimony (Ad Testificandum)","Financial / Bank Records","Phone / Communications Records","Other"]}]},{"id":"recipients","label":"Recipient / Custodian","type":"grid","cols":[{"key":"recipient_name","label":"Name / Business","type":"text","person":true},{"key":"recipient_address","label":"Address","type":"text"}]},{"id":"records","label":"Records / Items / Testimony Requested","type":"textarea","key":"records_requested"},{"id":"relevance","label":"Relevance to the Investigation","type":"textarea","key":"relevance"},{"id":"return","label":"Return / Compliance","type":"kv","fields":[{"key":"return_date","label":"Return Date","type":"text"},{"key":"return_location","label":"Deliver To","type":"text"}]},{"id":"affirm","label":"Detective Affirmation","type":"note","text":"I affirm that the records or testimony sought are relevant and necessary to an active investigation."},{"id":"sign","label":"Authorization","type":"kv","fields":[{"key":"detective_sig","label":"Detective Signature","type":"text"},{"key":"supervisor_approval","label":"Supervisor Approval","type":"text"},{"key":"judge_approval","label":"Judge / DA Approval","type":"text"}]}]},"required":["case_number","detective","date","records_requested"],"advisory":["relevance","return_date"],"review_required":false},"surveillance_report":{"name":"Surveillance Report","description":"Surveillance period report (observations opt-in).","is_default":false,"sort_order":80,"schema":{"title":"Surveillance Report","subtitle":"Criminal Investigations Department — FOR OFFICIAL USE ONLY","sections":[{"id":"hdr","label":"Report","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"detective","label":"Reporting Detective","type":"text"},{"key":"department","label":"Department","type":"select","opts":["","LSPD","BCSO","SAHP"]},{"key":"date","label":"Date","type":"text"}]},{"id":"authorization","label":"Authorization","type":"kv","fields":[{"key":"target_label","label":"Target Label","type":"text"},{"key":"authorized_by","label":"Authorized By","type":"text"},{"key":"period_from","label":"Period From","type":"text"},{"key":"period_to","label":"Period To","type":"text"},{"key":"auth_objective","label":"Objective","type":"text"}]},{"id":"scope","label":"Objective / Scope","type":"textarea","key":"scope"},{"id":"detectives","label":"Participating Detectives","type":"grid","cols":[{"key":"name","label":"Name","type":"text","person":true},{"key":"role","label":"Role","type":"text"}]},{"id":"obs_note","label":"Observations — Selection","type":"note","text":"Copy in only the observations you intend to include. Selection is a deliberate investigative decision — observations are never auto-dumped into a report, and unverified entries must be identified as such."},{"id":"observations","label":"Observations Included","type":"grid","cols":[{"key":"observed_at","label":"Observed At","type":"text"},{"key":"source","label":"Source","type":"text"},{"key":"summary","label":"Summary","type":"text"},{"key":"verified","label":"Verified","type":"select","opts":["","Yes","No"]}]},{"id":"entities","label":"Relevant Persons / Vehicles","type":"grid","cols":[{"key":"name_or_plate","label":"Name / Plate","type":"text"},{"key":"relevance","label":"Relevance","type":"text"}]},{"id":"meetings","label":"Notable Meetings & Patterns","type":"textarea","key":"meetings"},{"id":"assessment","label":"Investigative Assessment","type":"textarea","key":"assessment"},{"id":"outcome","label":"Outcome / Recommendations","type":"textarea","key":"outcome"}]},"required":["case_number","detective","date","assessment"],"advisory":["observations","outcome"],"review_required":true},"incident_followup":{"name":"Incident Follow-up Report","description":"Developments since the last report on an incident.","is_default":false,"sort_order":90,"schema":{"title":"Incident Follow-up Report","subtitle":"Criminal Investigations Department — FOR OFFICIAL USE ONLY","sections":[{"id":"details","label":"Report Details","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"date","label":"Date","type":"date"},{"key":"detective","label":"Reporting Detective","type":"text"},{"key":"bureau","label":"Bureau","type":"select","opts":["","Major Crimes Bureau","Street Crimes Bureau","Special Investigations Bureau","Joint Task Force"]},{"key":"incident_ref","label":"Original Incident / Report","type":"text"},{"key":"location","label":"Location","type":"text"}]},{"id":"developments","label":"Developments Since the Last Report","type":"textarea","key":"developments"},{"id":"contacts","label":"Contacts Made","type":"grid","cols":[{"key":"name","label":"Name","type":"text","person":true},{"key":"role","label":"Role","type":"text"},{"key":"summary","label":"Summary","type":"text"}]},{"id":"evidence","label":"Evidence Collected / Reviewed","type":"grid","cols":[{"key":"item","label":"Item","type":"text"},{"key":"source","label":"Source","type":"text"},{"key":"status","label":"Status","type":"select","opts":["","Logged","Pending","Returned"]}],"evidencePick":true},{"id":"narrative","label":"Narrative","type":"textarea","key":"narrative"},{"id":"next_steps","label":"Next Steps","type":"textarea","key":"next_steps"}]},"required":["case_number","date","detective","narrative"],"advisory":["next_steps"],"review_required":true},"interview":{"name":"Interview Report","description":"Interview of a suspect, witness, victim or informant.","is_default":false,"sort_order":100,"schema":{"title":"Interview Report","subtitle":"Criminal Investigations Department — FOR OFFICIAL USE ONLY","sections":[{"id":"details","label":"Interview Details","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"date","label":"Date","type":"date"},{"key":"start_time","label":"Start","type":"text"},{"key":"end_time","label":"End","type":"text"},{"key":"location","label":"Location","type":"text"},{"key":"detective","label":"Interviewing Detective","type":"text"},{"key":"second_officer","label":"Second Officer","type":"text"}]},{"id":"subject","label":"Subject","type":"kv","fields":[{"key":"subject_name","label":"Name","type":"text","person":true},{"key":"subject_role","label":"Role","type":"select","opts":["","Suspect","Witness","Victim","Informant","Other"]},{"key":"rights_advised","label":"Rights Advised","type":"select","opts":["","Yes","No","Not applicable"]},{"key":"rights_dt","label":"Rights Advised At","type":"text"},{"key":"counsel","label":"Counsel Present","type":"select","opts":["","Yes","No","Waived"]},{"key":"recorded","label":"Recorded","type":"select","opts":["","Audio","Video","Not recorded"]}]},{"id":"summary","label":"Summary of Statements","type":"textarea","key":"summary"},{"id":"narrative","label":"Narrative","type":"textarea","key":"narrative"},{"id":"assessment","label":"Investigative Assessment","type":"textarea","key":"assessment"}]},"required":["case_number","date","detective","subject_name","summary"],"advisory":["rights_advised","recorded"],"review_required":true},"arrest_report":{"name":"Arrest Report","description":"Arrest, charges and property seized.","is_default":false,"sort_order":110,"schema":{"title":"Arrest Report","subtitle":"Criminal Investigations Department — FOR OFFICIAL USE ONLY","sections":[{"id":"details","label":"Arrest Details","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"date","label":"Date","type":"date"},{"key":"time","label":"Time","type":"text"},{"key":"location","label":"Location","type":"text"},{"key":"detective","label":"Arresting Detective","type":"text"},{"key":"assisting","label":"Assisting Officers","type":"text"},{"key":"warrant_ref","label":"Warrant Reference","type":"text"}]},{"id":"arrestee","label":"Arrestee","type":"kv","fields":[{"key":"arrestee_name","label":"Name","type":"text","person":true},{"key":"arrestee_dob","label":"Date of Birth","type":"text"},{"key":"rights_advised","label":"Rights Advised","type":"select","opts":["","Yes","No"]},{"key":"rights_dt","label":"Rights Advised At","type":"text"},{"key":"injuries","label":"Injuries / Medical","type":"text"},{"key":"transported_to","label":"Transported To","type":"text"}]},{"id":"charges","label":"Charges","type":"grid","cols":[{"key":"code","label":"Code","type":"text"},{"key":"offense","label":"Offense","type":"text"},{"key":"counts","label":"Counts","type":"text"}]},{"id":"seized","label":"Property Seized","type":"grid","cols":[{"key":"item","label":"Item","type":"text"},{"key":"description","label":"Description","type":"text"},{"key":"disposition","label":"Disposition","type":"text"}],"evidencePick":true},{"id":"narrative","label":"Narrative / Probable Cause","type":"textarea","key":"narrative"}]},"required":["case_number","date","detective","arrestee_name","narrative"],"advisory":["rights_advised","charges"],"review_required":true},"search_report":{"name":"Search Report","description":"Execution of a search and items seized.","is_default":false,"sort_order":120,"schema":{"title":"Search Report","subtitle":"Criminal Investigations Department — FOR OFFICIAL USE ONLY","sections":[{"id":"details","label":"Search Details","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"date","label":"Date","type":"date"},{"key":"start_time","label":"Start","type":"text"},{"key":"end_time","label":"End","type":"text"},{"key":"location","label":"Location Searched","type":"text"},{"key":"detective","label":"Lead Detective","type":"text"},{"key":"officers","label":"Officers Present","type":"text"},{"key":"authority","label":"Authority","type":"select","opts":["","Search warrant","Consent","Exigent circumstances","Incident to arrest","Other"]},{"key":"warrant_ref","label":"Warrant Reference","type":"text"}]},{"id":"present","label":"Persons Present","type":"grid","cols":[{"key":"name","label":"Name","type":"text","person":true},{"key":"role","label":"Role","type":"text"}]},{"id":"items","label":"Items Seized","type":"grid","cols":[{"key":"item","label":"Item","type":"text"},{"key":"found_at","label":"Found At","type":"text"},{"key":"seized_by","label":"Seized By","type":"text"},{"key":"evidence_ref","label":"Evidence Ref","type":"text"}],"evidencePick":true},{"id":"narrative","label":"Narrative","type":"textarea","key":"narrative"},{"id":"damage","label":"Damage / Property Left","type":"textarea","key":"damage"}]},"required":["case_number","date","detective","location","narrative"],"advisory":["authority","items"],"review_required":true},"case_closure":{"name":"Case Closure Report","description":"Disposition and closure of a case — every open task must be done or waived.","is_default":false,"sort_order":130,"schema":{"title":"Case Closure Report","subtitle":"Criminal Investigations Department — FOR OFFICIAL USE ONLY","sections":[{"id":"details","label":"Closure Details","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"date","label":"Date","type":"date"},{"key":"detective","label":"Lead Detective","type":"text"},{"key":"bureau","label":"Bureau","type":"select","opts":["","Major Crimes Bureau","Street Crimes Bureau","Special Investigations Bureau","Joint Task Force"]},{"key":"disposition","label":"Disposition","type":"select","opts":["","Cleared by arrest","Cleared exceptionally","Unfounded","Inactive — leads exhausted","Referred","Other"]},{"key":"prosecution_status","label":"Prosecution Status","type":"text"}]},{"id":"note","label":"Before you submit","type":"note","text":"Every open task on this case must be done or waived before a closure report can be submitted."},{"id":"summary","label":"Investigation Summary","type":"textarea","key":"summary"},{"id":"outcome","label":"Outcome","type":"textarea","key":"outcome"},{"id":"evidence_disposition","label":"Evidence Disposition","type":"grid","cols":[{"key":"item","label":"Item","type":"text"},{"key":"disposition","label":"Disposition","type":"select","opts":["","Retained","Returned","Destroyed","Transferred"]},{"key":"note","label":"Note","type":"text"}],"evidencePick":true},{"id":"recommendations","label":"Recommendations","type":"textarea","key":"recommendations"}]},"required":["case_number","date","detective","disposition","summary"],"advisory":["outcome","recommendations"],"review_required":true},"warrant_return":{"name":"Warrant Return","description":"Return of service on an issued warrant.","is_default":false,"sort_order":140,"schema":{"title":"Warrant Return","subtitle":"Criminal Investigations Department — Return of Service — FOR OFFICIAL USE ONLY","sections":[{"id":"details","label":"Warrant","type":"kv","fields":[{"key":"case_number","label":"Case Number","type":"text"},{"key":"warrant_ref","label":"Warrant / Legal Request Number","type":"text"},{"key":"warrant_type","label":"Warrant Type","type":"select","opts":["","Arrest warrant","Search warrant"]},{"key":"issued_by","label":"Issuing Judge","type":"text"},{"key":"issued_on","label":"Issued On","type":"date"},{"key":"detective","label":"Executing Detective","type":"text"}]},{"id":"execution","label":"Execution","type":"kv","fields":[{"key":"executed_on","label":"Executed On","type":"date"},{"key":"time","label":"Time","type":"text"},{"key":"location","label":"Location","type":"text"},{"key":"outcome","label":"Outcome","type":"select","opts":["","Executed","Executed — nothing found","Not executed","Expired unexecuted"]},{"key":"subject","label":"Subject","type":"text","person":true},{"key":"officers","label":"Officers Present","type":"text"}]},{"id":"inventory","label":"Inventory / Persons Taken Into Custody","type":"grid","cols":[{"key":"item","label":"Item / Person","type":"text"},{"key":"description","label":"Description","type":"text"},{"key":"evidence_ref","label":"Evidence Ref","type":"text"}],"evidencePick":true},{"id":"return_narrative","label":"Return Narrative","type":"textarea","key":"return_narrative"}]},"required":["case_number","warrant_ref","executed_on","outcome","return_narrative"],"advisory":["inventory","issued_by"],"review_required":true}}$seed$::jsonb;
        k text; t jsonb; v_tid uuid; v_keys text[];
begin
  for k, t in select * from jsonb_each(v_seed) loop
    if exists (select 1 from public.report_templates where key = k) then continue; end if;
    v_keys := private.report_schema_keys(t->'schema');
    insert into public.report_templates (key, name, description, is_default, sort_order, active)
    values (k, t->>'name', t->>'description', coalesce((t->>'is_default')::boolean, false),
            coalesce((t->>'sort_order')::integer, 100), true)
    returning id into v_tid;
    insert into public.report_template_versions
      (template_id, version_number, schema, required, advisory, review_required, status,
       change_summary, published_at)
    values (v_tid, 1, t->'schema',
            private.report_key_list(t->'required', v_keys, 'required'),
            private.report_key_list(t->'advisory', v_keys, 'advisory'),
            coalesce((t->>'review_required')::boolean, true), 'published',
            'Seeded from src/lib/forms.ts (Phase 5)', now());
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. reports — the pinned version and the review columns
-- ---------------------------------------------------------------------------
alter table public.reports add column if not exists template_version_id uuid references public.report_template_versions(id);
alter table public.reports add column if not exists review_status text not null default 'draft';
alter table public.reports add column if not exists submitted_at timestamptz;
alter table public.reports add column if not exists submitted_by uuid references public.profiles(id);
alter table public.reports add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.reports add column if not exists reviewed_at timestamptz;
alter table public.reports add column if not exists review_note text;
alter table public.reports add column if not exists reviewer_signature jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reports_review_status_check') then
    alter table public.reports add constraint reports_review_status_check
      check (review_status in ('draft', 'submitted', 'returned', 'approved'));
  end if;
end $$;
create index if not exists reports_template_version_id_idx on public.reports (template_version_id);
create index if not exists reports_review_status_idx on public.reports (case_id, review_status) where review_status = 'submitted';

update public.reports r
   set template_version_id = v.id
  from public.report_templates t
  join public.report_template_versions v on v.template_id = t.id and v.status = 'published'
 where r.template_version_id is null and r.template = t.key;
update public.reports set review_status = 'approved' where finalized and review_status = 'draft';

alter table public.report_versions add column if not exists reviewer_signature jsonb;

-- Purpose:        pin the published version at creation for every insert
--                 path (the RPC and the legacy direct insert alike).
create or replace function private.reports_template_pin()
returns trigger language plpgsql set search_path to '' as $$
begin
  if new.template_version_id is null then
    select v.id into new.template_version_id
      from public.report_templates t
      join public.report_template_versions v on v.template_id = t.id and v.status = 'published'
     where t.key = new.template and t.active;
  end if;
  return new;
end $$;
drop trigger if exists reports_template_pin on public.reports;
create trigger reports_template_pin before insert on public.reports
  for each row execute function private.reports_template_pin();

-- ---------------------------------------------------------------------------
-- 6. Template administration
-- ---------------------------------------------------------------------------
create or replace function private.report_template_denied(p_action text, p_id uuid, p_reason text, p_message text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  perform private.perm_deny(p_action, 'report_template', p_id, p_reason);
  return jsonb_build_object('ok', false, 'code', 'denied', 'message', p_message);
end $$;
revoke all on function private.report_template_denied(text, uuid, text, text) from public, anon, authenticated;

-- Purpose:        create or replace a template's single draft version. A new
--                 key creates the template (Director / DD / Owner); a draft
--                 on an existing template is a proposal (Bureau Lead+ / Owner).
create or replace function public.report_template_save(p_key text, p_name text, p_schema jsonb, p_required jsonb,
  p_advisory jsonb default '[]'::jsonb, p_review_required boolean default true,
  p_change_summary text default null, p_description text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); t public.report_templates; v_keys text[];
        v_req text[]; v_adv text[]; v_ver uuid; v_num integer; v_key text := lower(btrim(coalesce(p_key, '')));
        v_name text := left(btrim(coalesce(p_name, '')), 120);
begin
  if v_key !~ '^[a-z][a-z0-9_]{1,63}$' then raise exception 'the template key must be snake_case (a–z, 0–9, _)'; end if;
  if v_name = '' then raise exception 'a template name is required'; end if;
  v_keys := private.report_schema_keys(p_schema);
  v_req := private.report_key_list(p_required, v_keys, 'required');
  v_adv := private.report_key_list(p_advisory, v_keys, 'advisory');
  select * into t from public.report_templates where key = v_key for update;
  if not found then
    if not private.report_template_admin() then
      return private.report_template_denied('publish', null, 'not_admin',
        'only a Director, Deputy Director or the Owner may create a report template');
    end if;
    insert into public.report_templates (key, name, description, created_by)
    values (v_key, v_name, left(nullif(btrim(coalesce(p_description, '')), ''), 500), v_uid)
    returning * into t;
  elsif not private.report_template_proposer() then
    return private.report_template_denied('propose', t.id, 'not_proposer',
      'only a Bureau Lead or above may propose a template version');
  end if;
  select id into v_ver from public.report_template_versions
   where template_id = t.id and status = 'draft' for update;
  if v_ver is not null and not private.report_template_admin()
     and exists (select 1 from public.report_template_versions d where d.id = v_ver and d.created_by is distinct from v_uid) then
    return private.report_template_denied('propose', t.id, 'not_draft_author',
      'another proposer''s draft is pending — only its author or a Director may replace it');
  end if;
  if v_ver is not null then
    update public.report_template_versions
       set schema = p_schema, required = v_req, advisory = v_adv,
           review_required = coalesce(p_review_required, true),
           change_summary = left(nullif(btrim(coalesce(p_change_summary, '')), ''), 500),
           created_by = v_uid, created_at = now()
     where id = v_ver;
    select version_number into v_num from public.report_template_versions where id = v_ver;
  else
    select coalesce(max(version_number), 0) + 1 into v_num
      from public.report_template_versions where template_id = t.id;
    insert into public.report_template_versions
      (template_id, version_number, schema, required, advisory, review_required, status, change_summary, created_by)
    values (t.id, v_num, p_schema, v_req, v_adv, coalesce(p_review_required, true), 'draft',
            left(nullif(btrim(coalesce(p_change_summary, '')), ''), 500), v_uid)
    returning id into v_ver;
  end if;
  if private.report_template_admin() then
    update public.report_templates
       set name = v_name,
           description = coalesce(left(nullif(btrim(coalesce(p_description, '')), ''), 500), description)
     where id = t.id;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_TEMPLATE_DRAFTED', 'report_templates', t.id,
          jsonb_build_object('key', v_key, 'version_id', v_ver, 'version_number', v_num,
                             'required', to_jsonb(v_req), 'review_required', coalesce(p_review_required, true)));
  return jsonb_build_object('ok', true, 'template_id', t.id, 'version_id', v_ver, 'version_number', v_num);
end $$;

-- Purpose:        publish a draft; the previous published version is
--                 superseded; reports keep the version they pinned.
create or replace function public.report_template_publish(p_version uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v public.report_template_versions; v_prev uuid;
begin
  select * into v from public.report_template_versions where id = p_version for update;
  if not found then raise exception 'version not found'; end if;
  if not private.report_template_admin() then
    return private.report_template_denied('publish', v.template_id, 'not_admin',
      'only a Director, Deputy Director or the Owner may publish a template version');
  end if;
  if v.status <> 'draft' then raise exception 'only a draft version can be published'; end if;
  select id into v_prev from public.report_template_versions
   where template_id = v.template_id and status = 'published' for update;
  if v_prev is not null then
    update public.report_template_versions set status = 'superseded', superseded_at = now() where id = v_prev;
  end if;
  update public.report_template_versions
     set status = 'published', published_by = v_uid, published_at = now(),
         change_summary = coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 500), change_summary)
   where id = p_version;
  update public.report_templates set updated_at = now() where id = v.template_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_TEMPLATE_PUBLISHED', 'report_templates', v.template_id,
          jsonb_build_object('version_id', p_version, 'version_number', v.version_number,
                             'superseded_version_id', v_prev, 'note', left(coalesce(p_note, ''), 500)));
  return jsonb_build_object('ok', true, 'version_id', p_version, 'superseded_version_id', v_prev);
end $$;

create or replace function public.report_template_discard(p_version uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); v public.report_template_versions;
begin
  select * into v from public.report_template_versions where id = p_version for update;
  if not found then raise exception 'version not found'; end if;
  if v.status <> 'draft' then raise exception 'only a draft version can be discarded'; end if;
  if not (v.created_by = v_uid or private.report_template_admin()) then
    return private.report_template_denied('propose', v.template_id, 'not_author',
      'only the draft''s author or a Director may discard it');
  end if;
  delete from public.report_template_versions where id = p_version;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_TEMPLATE_DISCARDED', 'report_templates', v.template_id,
          jsonb_build_object('version_id', p_version, 'version_number', v.version_number));
  return jsonb_build_object('ok', true);
end $$;

-- Purpose:        name / description / active / sort_order / is_default.
--                 Retiring a template hides it from new reports; existing
--                 reports keep their pinned version.
create or replace function public.report_template_update(p_template uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := (select auth.uid()); t public.report_templates;
begin
  select * into t from public.report_templates where id = p_template for update;
  if not found then raise exception 'template not found'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'p_patch must be an object'; end if;
  if not private.report_template_admin() then
    return private.report_template_denied('publish', p_template, 'not_admin',
      'only a Director, Deputy Director or the Owner may change a template');
  end if;
  if p_patch ? 'name' and btrim(coalesce(p_patch->>'name', '')) = '' then raise exception 'a template name is required'; end if;
  if coalesce((p_patch->>'is_default')::boolean, false) then
    update public.report_templates set is_default = false where is_default and id <> p_template;
  end if;
  update public.report_templates
     set name = case when p_patch ? 'name' then left(btrim(p_patch->>'name'), 120) else name end,
         description = case when p_patch ? 'description' then left(nullif(btrim(coalesce(p_patch->>'description', '')), ''), 500) else description end,
         active = case when p_patch ? 'active' then coalesce((p_patch->>'active')::boolean, active) else active end,
         sort_order = case when p_patch ? 'sort_order' then coalesce((p_patch->>'sort_order')::integer, sort_order) else sort_order end,
         is_default = case when p_patch ? 'is_default' then coalesce((p_patch->>'is_default')::boolean, is_default) else is_default end
   where id = p_template;
  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_TEMPLATE_UPDATED', 'report_templates', p_template,
          jsonb_build_object('patch', p_patch));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.report_template_save(text, text, jsonb, jsonb, jsonb, boolean, text, text) from public, anon;
revoke all on function public.report_template_publish(uuid, text) from public, anon;
revoke all on function public.report_template_discard(uuid) from public, anon;
revoke all on function public.report_template_update(uuid, jsonb) from public, anon;
grant execute on function public.report_template_save(text, text, jsonb, jsonb, jsonb, boolean, text, text) to authenticated;
grant execute on function public.report_template_publish(uuid, text) to authenticated;
grant execute on function public.report_template_discard(uuid) to authenticated;
grant execute on function public.report_template_update(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. report_create — an unknown or retired template is refused; the
--    published version is pinned; an archived case refuses (the reports_ins
--    policy already does — the RPC now says so). Body otherwise the
--    20261002130000 one.
-- ---------------------------------------------------------------------------
create or replace function public.report_create(p_case uuid, p_template text, p_kind text default null, p_fields jsonb default '{}'::jsonb)
returns public.reports language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := (select auth.uid());
  r public.reports;
  v_kind public.report_kind;
  v_seq int;
  v_rt text;
  v_ver uuid;
begin
  if not private.is_active() or not private.can_access_case(p_case) then
    raise exception 'case not found or not accessible';
  end if;
  if not private.case_writable(p_case) then
    raise exception 'this case is archived — restore it before adding a report';
  end if;
  if nullif(btrim(coalesce(p_template, '')), '') is null then
    raise exception 'a report template is required';
  end if;
  select v.id into v_ver
    from public.report_templates t
    join public.report_template_versions v on v.template_id = t.id and v.status = 'published'
   where t.key = btrim(p_template) and t.active;
  if v_ver is null then raise exception 'unknown report template'; end if;
  if p_kind is not null then
    if p_kind not in ('initial', 'supplemental', 'followup') then
      raise exception 'invalid report kind';
    end if;
    v_kind := p_kind::public.report_kind;
  else
    v_rt := lower(coalesce(p_fields->>'report_type', ''));
    v_kind := (case when v_rt like 'supplemental%' then 'supplemental'
                    when v_rt like 'follow%' then 'followup'
                    else 'initial' end)::public.report_kind;
  end if;

  perform pg_advisory_xact_lock(hashtext('report_seq:' || p_case::text));
  select coalesce(max(x.seq), 0) + 1 into v_seq
    from public.reports x
   where x.case_id = p_case and x.template = btrim(p_template) and x.kind = v_kind;

  insert into public.reports (case_id, template, kind, seq, fields, author_id, template_version_id)
  values (p_case, btrim(p_template), v_kind, v_seq,
          coalesce(p_fields, '{}'::jsonb), v_uid, v_ver)
  returning * into r;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'REPORT_CREATED', 'reports', r.id,
          jsonb_build_object('case_id', p_case, 'template', r.template,
                             'kind', r.kind, 'seq', r.seq, 'template_version_id', v_ver));
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 8. rls_test_cleanup — draft versions (and templates) created by test
--    accounts go before the reports delete. Spliced live with
--    pg_get_functiondef so the body stays byte-identical otherwise.
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_anchor text := 'delete from public.reports where case_id = any(case_ids);';
        v_add text := E'delete from public.report_template_versions where status = ''draft'' and created_by = any(ids);\n'
                   || E'  delete from public.report_template_versions v using public.report_templates t where t.id = v.template_id and t.created_by = any(ids) and not exists (select 1 from public.reports x where x.template_version_id = v.id);\n'
                   || E'  delete from public.report_templates t where t.created_by = any(ids) and not exists (select 1 from public.report_template_versions v where v.template_id = t.id);\n'
                   || E'  ';
begin
  v_def := pg_get_functiondef('public.rls_test_cleanup()'::regprocedure);
  if v_def like '%report_template_versions%' then return; end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'rls_test_cleanup anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_add || v_anchor);
end $$;

-- ============================================================================
-- Rollback: drop the two tables (after clearing reports.template_version_id),
-- the eight new reports columns, report_versions.reviewer_signature, the
-- trigger and the private helpers; re-emit report_create from
-- 20261002130000; re-emit rls_test_cleanup without the three deletes.
-- ============================================================================

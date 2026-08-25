
-- ============================================================================
-- CID BUREAU RESTRUCTURE — finalize pass. Companion to
-- 20260825120000_bureau_restructure.sql; applied live via MCP in ordered
-- chunks (see MIGRATION-HISTORY.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 7. SIU → SIB in every remaining user-facing string emitted by the database
--    (notification texts, generated notes, error messages). Internal tokens
--    are untouched: audit actions like SIU_CASE_ASSUMED and lowercase
--    identifiers (siu_*, 'siu' classification values) contain no standalone
--    uppercase "SIU" word, so the word-boundary replace never reaches them.
--    next_siu_case_number was rewritten above ('SI[UB]-' has no bare SIU).
-- ----------------------------------------------------------------------------
do $bulkrename$
declare rec record; v_def text; v_new text; v_count int := 0;
begin
  for rec in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ~ '\mSIU\M|Special Investigations? Unit'
  loop
    v_def := pg_get_functiondef(rec.oid);
    v_new := regexp_replace(v_def, 'Special Investigations? Unit', 'Special Investigations Bureau', 'g');
    v_new := regexp_replace(v_new, '\mSIU\M', 'SIB', 'g');
    if v_new is distinct from v_def then
      execute v_new;
      v_count := v_count + 1;
    end if;
  end loop;
  raise notice 'bureau restructure: % function bodies renamed SIU -> SIB', v_count;
end $bulkrename$;

-- ----------------------------------------------------------------------------
-- 8. Constraints: only the new vocabulary is storable.
-- ----------------------------------------------------------------------------
alter table public.announcements drop constraint announcements_audience_check;
alter table public.announcements add constraint announcements_audience_check
  check (audience = any (array['all', 'command', 'specific_members', 'major_crimes', 'street_crimes', 'JTF']));

alter table public.document_reading_campaigns drop constraint document_reading_campaigns_audience_check;
alter table public.document_reading_campaigns add constraint document_reading_campaigns_audience_check
  check (audience = any (array['all', 'major_crimes', 'street_crimes', 'JTF', 'command', 'detectives', 'senior_detectives', 'specific']));

alter table public.cases drop constraint cases_originating_bureau_permanent;
alter table public.cases add constraint cases_originating_bureau_permanent
  check (originating_bureau is null or originating_bureau in ('major_crimes', 'street_crimes'));

-- The SIB bureau value is reserved for SIB-authority investigations.
alter table public.cases add constraint cases_sib_bureau_requires_siu_authority
  check (bureau <> 'special_investigations' or case_authority = 'siu');

alter table public.justice_memberships drop constraint justice_memberships_prosecutor_bureau_check;
alter table public.justice_memberships add constraint justice_memberships_prosecutor_bureau_check
  check (prosecutor_bureau is null or prosecutor_bureau in ('major_crimes', 'street_crimes'));

alter table public.legal_requests drop constraint legal_requests_responsible_bureau_check;
alter table public.legal_requests add constraint legal_requests_responsible_bureau_check
  check (responsible_bureau in ('major_crimes', 'street_crimes'));

alter table public.member_transfers drop constraint member_transfers_target_bureau_check;
alter table public.member_transfers add constraint member_transfers_target_bureau_check
  check (target_bureau is null or target_bureau in ('major_crimes', 'street_crimes'));

alter table public.membership_requests drop constraint membership_requests_requested_bureau_check;
alter table public.membership_requests add constraint membership_requests_requested_bureau_check
  check (requested_bureau in ('major_crimes', 'street_crimes'));
alter table public.membership_requests drop constraint membership_requests_decided_bureau_check;
alter table public.membership_requests add constraint membership_requests_decided_bureau_check
  check (decided_bureau in ('major_crimes', 'street_crimes'));

alter table public.prosecutor_bureau_assignments drop constraint prosecutor_bureau_assignments_bureau_check;
alter table public.prosecutor_bureau_assignments add constraint prosecutor_bureau_assignments_bureau_check
  check (bureau in ('major_crimes', 'street_crimes'));

alter table public.prosecutor_coverage drop constraint prosecutor_coverage_bureau_check;
alter table public.prosecutor_coverage add constraint prosecutor_coverage_bureau_check
  check (bureau in ('major_crimes', 'street_crimes'));

alter table public.transfer_requests drop constraint transfer_requests_from_bureau_check;
alter table public.transfer_requests add constraint transfer_requests_from_bureau_check
  check (from_bureau in ('major_crimes', 'street_crimes', 'JTF'));
alter table public.transfer_requests drop constraint transfer_requests_to_bureau_check;
alter table public.transfer_requests add constraint transfer_requests_to_bureau_check
  check (to_bureau in ('major_crimes', 'street_crimes', 'JTF'));

-- Operations are a normal-CID surface: participants and leads are the two
-- normal bureaus (SIB operations run under authority = 'siu').
alter table public.operation_bureaus drop constraint operation_bureaus_bureau_check;
alter table public.operation_bureaus add constraint operation_bureaus_bureau_check
  check (bureau in ('major_crimes', 'street_crimes'));
alter table public.operations drop constraint operations_bureau_check;
alter table public.operations add constraint operations_bureau_check
  check (bureau is null or bureau in ('major_crimes', 'street_crimes'));
alter table public.operations drop constraint operations_lead_bureau_check;
alter table public.operations add constraint operations_lead_bureau_check
  check (lead_bureau is null or lead_bureau in ('major_crimes', 'street_crimes'));

-- ----------------------------------------------------------------------------
-- 9. The live SOP document: CID Special Investigation Unit → CID Special
--    Investigations Bureau. Terminology only — mission, authority, command
--    structure (Director → Special Agent in Charge (X-1) → Special Agents)
--    and procedures are preserved verbatim.
-- ----------------------------------------------------------------------------
update public.documents
   set name = regexp_replace(
                regexp_replace(name, 'Special Investigations? Unit', 'Special Investigations Bureau', 'g'),
                '\mSIU\M', 'SIB', 'g'),
       content = regexp_replace(
                regexp_replace(content::text, 'Special Investigations? Unit', 'Special Investigations Bureau', 'g'),
                '\mSIU\M', 'SIB', 'g')::jsonb
 where (coalesce(name, '') || ' ' || coalesce(content::text, '')) ~ '\mSIU\M|Special Investigations? Unit';

-- ----------------------------------------------------------------------------
-- 10. History + visibility of the restructure.
-- ----------------------------------------------------------------------------
-- Member history entries: one dated event per member whose bureau changed.
insert into public.role_events (target_id, actor_id, old_role, new_role,
  old_division, new_division, old_active, new_active, reason, source)
select p.id, null, p.role, p.role, 'SAB', p.division::text, p.active, p.active,
       'CID bureau restructure — the State Bureau was dissolved into the Major Crimes and Street Crimes Bureaus', 'transfer'
  from public.profiles p
 where p.id in (
  '5def7dbc-1c44-4dc1-8fd0-b9dfc4813675','7a22c60c-0e00-441b-af1f-364ef00e90d5',
  'c9ee2158-dd2c-413d-a486-197025b4ceb8','358c730e-11fd-496b-942c-198162a36ab5',
  '6554181a-e2ed-4993-a66f-420c08f1471c','ea1e6d18-104a-4a79-9b65-371916132dcf',
  '8cd30181-dc71-4d1d-be6f-3619addb9111','a4e9d7bb-1674-4fa1-a2ac-6ad4f551f322',
  'b6d81d6a-5eba-480b-9142-ef303b5a6b99','c054111a-9946-4b6f-b60e-f4f3573cf9cf',
  '18b50a3b-0728-44f0-92ad-282410caa64a','d4bc918b-cf18-4229-a4ca-ac45bf0ecea7',
  'f2b82051-9346-41a6-a48a-96d1a7b3a49f','aea14410-2c0c-455d-92da-e5446d30976d',
  '3a41751b-02fc-4a5b-b36a-fef8a3f1e63f','de727b21-52a8-4802-8ab5-306fd3970d8b',
  'b7b48624-2ba4-4d65-83b0-4bc934b4540d','25466146-c512-4497-8ee8-88cbf3b1d22d',
  '56bbe203-6ccd-49ed-b73d-f2829427c548','d0f92ed9-45ee-4d28-b915-726ae4073bd1');

insert into public.role_events (target_id, actor_id, old_role, new_role,
  old_division, new_division, old_active, new_active, reason, source)
select p.id, null, p.role, p.role, 'LSB', p.division::text, p.active, p.active,
       'CID bureau restructure — the Los Santos Bureau became part of the Major Crimes / Street Crimes structure', 'transfer'
  from public.profiles p
 where p.id in (
  '00c15bc9-287f-4dc1-95de-ee37998c8f18','f4cbe18b-db41-4281-b625-6b5fd839956b',
  'a0728f76-65cf-4e32-bfb8-49970cd89eb3','961166f6-2882-47ab-b8c1-ae69bdf261cd',
  'e9e487e5-e9fc-487b-9926-0f27a01bbf8f','433dee0c-3653-439e-ad4a-3b94dec50000',
  '076afcc8-5557-4384-a4d6-fb6fe0a9cf81','534be82e-aa8f-4bab-8e9b-a309b6d0760f');

insert into public.role_events (target_id, actor_id, old_role, new_role,
  old_division, new_division, old_active, new_active, reason, source)
select p.id, null, p.role, p.role, 'BCB', p.division::text, p.active, p.active,
       'CID bureau restructure — the Blaine County Bureau became the Street Crimes Bureau', 'transfer'
  from public.profiles p
 where p.id in (
  '4897cced-1208-4359-bde7-4d1dd6a30b3c','1980aca4-8275-4149-b130-84f3ea9a557c',
  'cc441cd5-4eed-4842-9e78-5eb487be0f41','a540daf6-b920-43fc-85d6-7a8af2b06908',
  '92978a6f-0c14-46bb-b8da-f702bf59bbaa','92556655-3a53-423c-ad5c-0bd226a7bc2e');

-- Surface the members whose new bureau was a DEFAULT (no case signal) so
-- command reviews and reassigns them deliberately.
insert into public.notifications (user_id, type, payload)
select p.id, 'membership_update', jsonb_build_object(
  'status', 'bureau_restructure',
  'reason', 'CID restructure: LSB/BCB/SAB were replaced by the Major Crimes and Street Crimes Bureaus, and SIU is now the Special Investigations Bureau (SIB). Members were migrated by casework; these members had no clear case signal and were placed by default — please review their assignment: charles adams, Conrad Steele, Ember, john smith, Mark Broody, Quez rich, wickedpissa47, Lana Croft (Street Crimes); nick brown (Major Crimes, placed for bureau leadership). Use the member transfer tools to adjust.')
  from public.profiles p
 where p.active and p.removed_at is null and not coalesce(p.is_test, false)
   and (p.role in ('deputy_director', 'director') or p.is_owner);

insert into public.audit_log (actor_id, action, entity, entity_id, detail)
values (null, 'BUREAU_RESTRUCTURE', 'profiles', null, jsonb_build_object(
  'summary', 'LSB/BCB/SAB dissolved into Major Crimes (major_crimes, MCB) and Street Crimes (street_crimes, SCB); SIU renamed to the Special Investigations Bureau (special_investigations, SIB). Members, cases, legal routing, operations and prosecutor relationships migrated; existing case numbers preserved; new cases mint MCB-/SCB-/SIB- numbers.',
  'migration', '20260825120000_bureau_restructure'));

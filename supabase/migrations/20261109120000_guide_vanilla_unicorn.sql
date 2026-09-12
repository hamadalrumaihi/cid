-- ============================================================================
-- 20261109120000_guide_vanilla_unicorn.sql
-- The Vanilla Unicorn Money Laundering System — a system-intelligence record.
--
-- Content, not schema: one row in the Guide Library. Nothing here creates a
-- table, a column, a policy or an RPC, and nothing existing changes.
--
-- WHAT THIS RECORD IS, AND IS NOT. It documents how a system is STRUCTURED.
-- It is deliberately NOT a case: no case number, no incident, no transaction,
-- no suspect, no charge, no legal request, and no amount attributed to any
-- person. Tom Wood (X-2 Special Agent) is recorded as its SUBMITTER; no case
-- investigator is assigned, because there is no case to assign one to.
--
-- WHY IT IS A LIBRARY ROW. A system record is reference content — it reads no
-- portal record and writes none — which is the same shape as the UNDERGRND
-- System record seeded by 20261107120000. It therefore lives where that one
-- lives, under the `systems` category, and inherits the library's audience
-- wall, revision history, audit trail and optional per-section imagery rather
-- than growing a parallel surface with its own versions of all four.
--
-- AUDIENCE. `investigative` — the audience the portal already uses for
-- sensitive investigative material, and the one the other investigative
-- records carry. Deliberately NOT a narrower compartment: naming one (SIB, a
-- task force) would be inventing a permission that was never granted.
--
-- NPC REFERENCES. Names the system displays — a manager, dancers, floor
-- actors — are recorded as content INSIDE this record and nowhere else. They
-- are not entity rows, which is exactly why they cannot reach the People
-- Registry, person or global search, a suspect list, a warrant, a charge, a
-- subpoena, an organization roster, or a relationship graph for real people.
-- Storing them as prose is not a shortcut around those rules; it is the only
-- storage that cannot violate them by omission later. Promoting one to a
-- Person record stays a separate, authorized, manual act on separate
-- evidence.
--
-- APPLICATION NOTE: applied live to project jhxuflzmqspidkvjckox (Supabase
-- MCP) under the name `guide_vanilla_unicorn_system_record`. Written as an
-- upsert on the address, so re-running it changes nothing.
-- ============================================================================

-- ===== PART 1: guide_vanilla_unicorn_system_record =====
do $$
declare v_id uuid;
begin
  if exists (select 1 from public.guides where slug = 'vanilla-unicorn' and deleted_at is null) then
    update public.guides set
      title = 'Vanilla Unicorn Money Laundering System',
      summary = 'System intelligence: a reputation-based, business-based laundering capability in the Vanilla Unicorn back office — access, standing, branches, unlock requirements and perks',
      category = 'systems',
      audience = 'investigative',
      body_key = 'vanilla-unicorn',
      body_kind = 'module',
      tags = array['system intelligence', 'financial system', 'money laundering', 'business-based operation', 'active capability']::text[],
      keywords = 'vanilla unicorn vu strip club back office laundering dirty money parcel manager the floor the house collections bank runs nightlife standing reputation perk points house rules on the books floor manager crypto undergrnd npc reference system actor',
      status = 'published',
      published_at = coalesce(published_at, now()),
      last_reviewed_at = now()
    where slug = 'vanilla-unicorn' and deleted_at is null;
  else
    insert into public.guides (slug, title, summary, category, audience, body_key, body_kind,
                               pinned, tags, keywords, status, published_at, last_reviewed_at)
    values (
      'vanilla-unicorn',
      'Vanilla Unicorn Money Laundering System',
      'System intelligence: a reputation-based, business-based laundering capability in the Vanilla Unicorn back office — access, standing, branches, unlock requirements and perks',
      'systems',
      'investigative',
      'vanilla-unicorn',
      'module',
      false,
      array['system intelligence', 'financial system', 'money laundering', 'business-based operation', 'active capability']::text[],
      'vanilla unicorn vu strip club back office laundering dirty money parcel manager the floor the house collections bank runs nightlife standing reputation perk points house rules on the books floor manager crypto undergrnd npc reference system actor',
      'published', now(), now()
    )
    returning id into v_id;

    insert into public.audit_log (actor_id, action, entity, entity_id, detail)
    values (null, 'GUIDE_CREATED', 'guides', v_id,
            jsonb_build_object('slug', 'vanilla-unicorn',
                               'title', 'Vanilla Unicorn Money Laundering System',
                               'record_type', 'System Intelligence',
                               'submitted_by', 'Tom Wood',
                               'submitter_position', 'X-2 Special Agent',
                               'source', 'seeded by migration guide_vanilla_unicorn_system_record'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK NOTE
-- ---------------------------------------------------------------------------
-- Content, so removal is a content decision: soft-delete the row through the
-- portal (`soft_delete('guide', id, reason)`) rather than deleting it here,
-- which keeps it in the Trash and in the audit trail. The prose itself lives
-- in src/components/guides/docs/vanillaUnicornDoc.ts and goes with the code.

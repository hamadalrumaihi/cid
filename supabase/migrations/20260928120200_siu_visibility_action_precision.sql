-- ============================================================================
-- The disclosure audit was calling a narrowing an expansion.
--
-- Found by the live role probe for part two: an SIU release to all of CID,
-- later pulled back to a single named officer, was recorded as
--
--   marked -> revealed -> expanded
--
-- The third act made the audience strictly smaller. Labelling that "expanded"
-- is not a cosmetic slip: the whole point of this audit is to answer "who could
-- see what, when?", and an entry that overstates a disclosure is worse than no
-- entry, because it will be believed.
--
-- The original logic only looked at whether sections were named, and ignored
-- the audience entirely -- so every change from one released state to another
-- fell through to 'expanded'.
--
-- Breadth has two independent axes and they do not reduce to one number: a
-- partial reveal to everybody and a full reveal to one person are not
-- comparable. So rather than invent a total order, this compares each axis and
-- names what actually happened -- including 'redirected', for a move that is
-- neither wider nor narrower but points somewhere else (one case to another,
-- one officer to another). Guessing between 'expanded' and 'reduced' for those
-- would put a false claim in the permanent record.
--
-- APPLICATION NOTE: applied live as siu_visibility_action_precision.
-- ============================================================================

alter table public.siu_visibility_events
  drop constraint if exists siu_visibility_events_action_check;
alter table public.siu_visibility_events
  add constraint siu_visibility_events_action_check
  check (action in ('marked', 'revealed', 'expanded', 'reduced', 'redirected',
                    'restricted', 'flagged'));

-- How wide an audience is: one person is narrower than one case, which is
-- narrower than every active investigator.
create or replace function private.siu_audience_rank(p_case uuid, p_user uuid)
returns int language sql immutable set search_path to '' as $$
  select case when p_user is not null then 1
              when p_case is not null then 2
              else 3 end
$$;
revoke all on function private.siu_audience_rank(uuid, uuid) from public;
grant execute on function private.siu_audience_rank(uuid, uuid) to authenticated, service_role;

create or replace function public.siu_reveal_to_cid(
  p_type text, p_id uuid, p_reason text,
  p_sections text[] default null,
  p_to_case_id uuid default null, p_to_user_id uuid default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_standing text; v_row public.siu_visibility; v_to text; v_action text;
  v_secs text[]; v_from_aud int; v_to_aud int;
  v_wider boolean; v_narrower boolean;
begin
  v_standing := private.siu_standing();
  if not private.siu_may_control_visibility() then
    raise exception 'only SIU may release a compartmented record';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 10 then
    raise exception 'record why this is being released, in a sentence';
  end if;
  if p_to_case_id is not null and p_to_user_id is not null then
    raise exception 'release to a case or to a person, not both';
  end if;

  select * into v_row from public.siu_visibility
   where entity_type = p_type and entity_id = p_id;
  if v_row.entity_id is null then
    raise exception 'that record is not compartmented, so there is nothing to release';
  end if;

  v_to := case when coalesce(array_length(p_sections, 1), 0) > 0
               then 'partial' else 'revealed' end;
  v_secs := case when v_to = 'partial' then p_sections else '{}'::text[] end;

  if v_row.state in ('siu_only', 'unclassified') then
    -- Nothing was visible before, so this is the disclosure itself.
    v_action := 'revealed';
  else
    v_from_aud := private.siu_audience_rank(v_row.revealed_to_case_id, v_row.revealed_to_user_id);
    v_to_aud   := private.siu_audience_rank(p_to_case_id, p_to_user_id);

    -- Wider on either axis: a bigger audience, or full text where only named
    -- sections were released, or a superset of those sections.
    v_wider := v_to_aud > v_from_aud
            or (v_row.state = 'partial' and v_to = 'revealed')
            or (v_row.state = 'partial' and v_to = 'partial'
                and not (v_secs <@ v_row.revealed_sections));
    v_narrower := v_to_aud < v_from_aud
               or (v_row.state = 'revealed' and v_to = 'partial')
               or (v_row.state = 'partial' and v_to = 'partial'
                   and not (v_row.revealed_sections <@ v_secs));

    v_action := case
      when v_wider and not v_narrower then 'expanded'
      when v_narrower and not v_wider then 'reduced'
      when v_wider and v_narrower then 'redirected'
      -- Identical breadth on both axes but a different case or officer.
      else 'redirected' end;
  end if;

  update public.siu_visibility
     set state = v_to,
         revealed_sections = v_secs,
         revealed_to_case_id = p_to_case_id,
         revealed_to_user_id = p_to_user_id,
         revealed_at = now(), revealed_by = (select auth.uid()),
         reveal_reason = btrim(p_reason),
         needs_review = false, review_note = null,
         updated_at = now()
   where entity_type = p_type and entity_id = p_id;

  insert into public.siu_visibility_events
    (entity_type, entity_id, action, from_state, to_state, sections,
     to_case_id, to_user_id, actor_id, actor_standing, reason)
  values (p_type, p_id, v_action, v_row.state, v_to, v_secs,
          p_to_case_id, p_to_user_id, (select auth.uid()), v_standing, btrim(p_reason));
end
$$;
revoke all on function public.siu_reveal_to_cid(text, uuid, text, text[], uuid, uuid) from public;
grant execute on function public.siu_reveal_to_cid(text, uuid, text, text[], uuid, uuid) to authenticated;

-- ============================================================================
-- Rollback: restore the previous siu_reveal_to_cid body and drop 'redirected'
-- from the action constraint. Any 'redirected' rows already written would have
-- to be relabelled first, which is itself a reason not to roll this back.
-- ============================================================================

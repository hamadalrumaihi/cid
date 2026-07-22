-- ─────────────────────────────────────────────────────────────────────────────
-- Case-number auto-numbering — continue each bureau's established series.
--
-- Bug: CaseModal built the number as `${bureau}-${digits || Date.now().slice(-5)}`,
-- so leaving the number field blank produced a timestamp fragment (e.g.
-- SAB-69179, BCB-74902) instead of continuing the established per-bureau block
-- (SAB-9000xxx, BCB-2000xxx). The USER-GUIDE already documents auto-numbering
-- ("like SAB-9000041") — this makes that real.
--
-- next_case_number(bureau) returns the greatest existing number WITHIN that
-- bureau's block (stray sub-base timestamp numbers are ignored), plus one; a
-- bureau with no case in its block yet starts at base + 1. The client pre-fills
-- the field from this and also falls back to it at save time, so a blank field
-- can never mint a timestamp number again.
--
-- Block bases: LSB 1,000,000 · BCB 2,000,000 · JTF 3,000,000 · SAB 9,000,000.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.case_number_base(p_bureau text)
returns bigint language sql immutable as $$
  select case upper(coalesce(p_bureau, ''))
           when 'LSB' then 1000000
           when 'BCB' then 2000000
           when 'JTF' then 3000000
           when 'SAB' then 9000000
           else 1000000
         end::bigint
$$;

create or replace function public.next_case_number(p_bureau text)
returns text language sql stable security definer set search_path to '' as $$
  with base as (
    select private.case_number_base(p_bureau) as lo
  ),
  -- Numeric part of same-bureau numbers only (filters strays before casting).
  candidates as (
    select (regexp_replace(c.case_number, '^[A-Z]+-', ''))::bigint as n
    from public.cases c
    where c.bureau::text = upper(p_bureau)
      and c.case_number ~ '^[A-Z]+-[0-9]+$'
  )
  select upper(p_bureau) || '-' || (
    coalesce(
      (select max(n) from candidates, base where n between base.lo and base.lo + 999999),
      (select lo from base)
    ) + 1
  )::text
$$;

revoke all on function public.next_case_number(text) from public;
revoke execute on function public.next_case_number(text) from anon;
grant execute on function public.next_case_number(text) to authenticated, service_role;

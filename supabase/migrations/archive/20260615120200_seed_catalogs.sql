-- ============================================================================
-- ODYSSEY CID PORTAL — Reference catalogs, report templates & demo content
-- (Static reference data only. Existing per-user data is migrated separately via
--  the in-app JSON importer — see supabase/README.md.)
-- ============================================================================

-- ---------- Report templates (command-editable) ----------
create table if not exists public.report_templates (
  id text primary key,
  name text not null,
  icon text,
  sections jsonb not null default '[]',
  sort_order int default 0
);
alter table public.report_templates enable row level security;
create policy rtpl_select on public.report_templates for select using ( public.is_active() );
create policy rtpl_write  on public.report_templates for all using ( public.is_command() ) with check ( public.is_command() );

insert into public.report_templates (id, name, icon, sort_order, sections) values
 ('incident','Initial Incident Report','📄',1,
   '[{"key":"caseId","label":"Case Number","type":"auto"},{"key":"bureau","label":"Bureau","type":"auto"},{"key":"detective","label":"Reporting Detective","type":"auto"},{"key":"datetime","label":"Date of Incident","type":"date"},{"key":"location","label":"Location","type":"text"},{"key":"classification","label":"Offense Classification","type":"select","opts":["Trafficking","Weapons","Narcotics Manufacture","Homicide","Robbery","Other"]},{"key":"narrative","label":"Incident Narrative","type":"textarea"}]'::jsonb),
 ('arrest','Arrest / Booking Report','🔗',2,
   '[{"key":"caseId","label":"Case Number","type":"auto"},{"key":"detective","label":"Arresting Detective","type":"auto"},{"key":"suspect","label":"Suspect Name","type":"text"},{"key":"charges","label":"Charges","type":"textarea"},{"key":"miranda","label":"Miranda Advised","type":"select","opts":["Yes","No","Waived"]},{"key":"datetime","label":"Date of Arrest","type":"date"}]'::jsonb),
 ('warrant','Search Warrant Affidavit','📜',3,
   '[{"key":"caseId","label":"Case Number","type":"auto"},{"key":"affiant","label":"Affiant","type":"auto"},{"key":"premises","label":"Premises to be Searched","type":"text"},{"key":"probable","label":"Statement of Probable Cause","type":"textarea"},{"key":"items","label":"Items Sought","type":"textarea"}]'::jsonb),
 ('surveillance','Surveillance Log','🛰️',4,
   '[{"key":"caseId","label":"Case Number","type":"auto"},{"key":"detective","label":"Observing Detective","type":"auto"},{"key":"target","label":"Target / Subject","type":"text"},{"key":"datetime","label":"Date","type":"date"},{"key":"observations","label":"Observations","type":"textarea"}]'::jsonb),
 ('rico_summary','RICO Predicate Summary','⚖️',5,
   '[{"key":"caseId","label":"Case Number","type":"auto"},{"key":"enterprise","label":"Enterprise","type":"text"},{"key":"pattern","label":"Pattern Summary","type":"textarea"}]'::jsonb)
on conflict (id) do nothing;

-- ---------- RICO predicate catalog ----------
insert into public.rico_predicate_catalog (id, label) values
 ('drug_trafficking','Drug Trafficking'),('extortion','Extortion'),('money_laundering','Money Laundering'),
 ('witness_tampering','Witness Tampering'),('murder_for_hire','Murder-for-Hire'),('firearms_trafficking','Illegal Firearms Trafficking'),
 ('bribery','Bribery'),('obstruction','Obstruction of Justice'),('kidnapping','Kidnapping'),('loan_sharking','Loan Sharking'),('robbery','Robbery')
on conflict (id) do nothing;

-- ---------- Narcotics registry (seed from legacy app) ----------
do $$
declare nid uuid;
begin
  -- Blue Meth
  insert into public.narcotics (name,classification,icon,popularity,street_price,wholesale_price)
    values ('Blue Meth','Synthetic Stimulant','🔵',92,1200,450) returning id into nid;
  insert into public.narcotic_precursors (narcotic_id,name,default_purity,sort_order) values
    (nid,'Pseudoephedrine',80,1),(nid,'Anhydrous Ammonia',65,2),(nid,'Lithium',55,3),(nid,'Red Phosphorus',40,4);
  insert into public.narcotic_hotspots (narcotic_id,area,density) values (nid,'Sandy Shores','high'),(nid,'Rancho','medium');

  insert into public.narcotics (name,classification,icon,popularity,street_price,wholesale_price)
    values ('Purity Heroin','Opioid','🟤',74,1800,700) returning id into nid;
  insert into public.narcotic_precursors (narcotic_id,name,default_purity,sort_order) values
    (nid,'Morphine Base',75,1),(nid,'Acetic Anhydride',60,2),(nid,'Activated Charcoal',35,3);
  insert into public.narcotic_hotspots (narcotic_id,area,density) values (nid,'Vespucci Beach','medium'),(nid,'Mirror Park','low');

  insert into public.narcotics (name,classification,icon,popularity,street_price,wholesale_price)
    values ('Crack Cocaine','Freebase Stimulant','⚪',81,900,300) returning id into nid;
  insert into public.narcotic_precursors (narcotic_id,name,default_purity,sort_order) values
    (nid,'Cocaine HCl',85,1),(nid,'Sodium Bicarbonate',50,2),(nid,'Ammonia',30,3);
  insert into public.narcotic_hotspots (narcotic_id,area,density) values (nid,'Davis','high'),(nid,'Strawberry','medium');

  insert into public.narcotics (name,classification,icon,popularity,street_price,wholesale_price)
    values ('Moonshine','Illicit Distilled Alcohol','🥃',55,120,35) returning id into nid;
  insert into public.narcotic_precursors (narcotic_id,name,default_purity,sort_order) values
    (nid,'Corn Mash',70,1),(nid,'Sugar',60,2),(nid,'Yeast',45,3);
  insert into public.narcotic_hotspots (narcotic_id,area,density) values (nid,'Grapeseed','high'),(nid,'Paleto Bay','medium');

  insert into public.narcotics (name,classification,icon,popularity,street_price,wholesale_price)
    values ('Lab-Grade Amphetamine','Synthetic Stimulant','💠',68,1400,520) returning id into nid;
  insert into public.narcotic_precursors (narcotic_id,name,default_purity,sort_order) values
    (nid,'Phenylacetic Acid',78,1),(nid,'Acetic Anhydride',55,2),(nid,'Hydrochloric Acid',42,3);
  insert into public.narcotic_hotspots (narcotic_id,area,density) values (nid,'Murrieta Heights','medium'),(nid,'La Mesa','low');
end $$;

-- ---------- Demo gangs (global) for RLS testing ----------
do $$
declare gid uuid; rid uuid;
begin
  insert into public.gangs (name,colors,threat_level) values ('Davis Ballas','Purple','high') returning id into gid;
  insert into public.gang_ranks (gang_id,name,sort_order) values (gid,'Leadership',1) returning id into rid;
  insert into public.gang_members (gang_id,rank_id,name,ccw,vch,felony_count,status) values (gid,rid,'Marcus "Tre" Bell',true,7,7,'At Large');
  insert into public.gang_ranks (gang_id,name,sort_order) values (gid,'Enforcer',2) returning id into rid;
  insert into public.gang_members (gang_id,rank_id,name,ccw,vch,felony_count,status) values (gid,rid,'Dion Park',true,5,5,'In Custody');
  insert into public.gang_turf (gang_id,block,density,hotspot_area) values (gid,'Davis Blocks','high','Davis'),(gid,'Strawberry Ave','medium','Strawberry');

  insert into public.gangs (name,colors,threat_level) values ('Vagos Cartel Cell','Yellow','high') returning id into gid;
  insert into public.gang_ranks (gang_id,name,sort_order) values (gid,'Leadership',1) returning id into rid;
  insert into public.gang_members (gang_id,rank_id,name,ccw,vch,felony_count,status) values (gid,rid,'"Ghost"',true,9,9,'At Large');
  insert into public.gang_turf (gang_id,block,density,hotspot_area) values (gid,'East Vinewood','medium','Rancho');
end $$;

-- ---------- Ballistics benches ----------
insert into public.ballistics_benches (bench_type,name,tier,heat,outputs,components) values
 ('street','Grove St. Zip-Gun Workshop','Low','Active', '{Zip-guns,"Serial-number grinding","Modified .38 pistols"}', '{"Scrap steel tubing",Springs,"Improvised firing pins","Electrical tape"}'),
 ('organized','Cartel CNC Rifle Foundry','High','Active', '{"Class 3 military rifles",Suppressors,"Custom attachments"}', '{"Steel receivers","CNC billet blanks","Firing pins","Threaded barrels",Optics}');

-- ============================================================================
-- BOOTSTRAP: run AFTER the director has signed in once with Discord, so their
-- profile row exists. Promotes them to director + active so they can assign others.
--   select public.bootstrap_director('<discord_user_id>');
-- ============================================================================
create or replace function public.bootstrap_director(p_discord text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  select id into uid from public.profiles where discord_id = p_discord;
  if uid is null then return 'No profile with that discord_id yet — sign in via Discord first.'; end if;
  update public.profiles set rank='director', bureau='JTF', active=true, view_all=true,
         display_name = coalesce(nullif(display_name,'Unassigned Officer'), 'Director')
   where id = uid;
  return 'Bootstrapped director: ' || uid::text;
end $$;

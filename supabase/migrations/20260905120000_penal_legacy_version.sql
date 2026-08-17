-- ============================================================================
-- The legacy San Andreas Penal Code, recorded as the superseded version it is.
--
-- 29 charges sit on 6 live cases today, and every one of them carries an old
-- code -- (1)09, (4)22, (10)01 -- that does not exist in the 2026 import. They
-- were charged under a different penal code, and that code was real.
--
-- The decision was to freeze existing cases as historical snapshots. A snapshot
-- needs a version to belong to: without one, a migrated charge either points at
-- nothing (a nullable foreign key that later code will forget to check) or
-- points at the wrong 2026 charge, which would silently restate what a case
-- charged. So the legacy code becomes a first-class version, marked
-- 'superseded', and the historical charges resolve against it forever.
--
-- ── Generated, not transcribed ────────────────────────────────────────────
-- The payload below was produced mechanically from src/lib/penal.ts, the array
-- the portal still runs on, by a script that fails rather than guesses: it
-- aborts if the file does not yield exactly 162 charges, if any row does not
-- split into exactly 14 fields, or if any non-ASCII character survives
-- normalisation. Nobody retyped 162 charges, so nobody mistyped one.
--
-- Three characters are normalised deliberately: RIGHT SINGLE QUOTE to an
-- apostrophe, EN DASH to a hyphen, GREATER-THAN-OR-EQUAL to ">=". apply_migration
-- sanitises non-ASCII in transit, and this migration series has already had one
-- silent divergence between a file and the database from exactly that. Doing
-- the substitution here means both sides hold identical bytes.
--
-- ── Facts the 2026 table had no column for ────────────────────────────────
-- Three legacy facts would have been destroyed by a naive mapping:
--
--   'Capital'  8 charges carry a class the 2026 check constraint refuses.
--              Widened rather than folded into Felony: a capital offense is not
--              a felony with a bigger number, and rewriting it would misstate
--              what 8 charges are.
--
--   rico       In the legacy code this marks 24 offenses that can serve as RICO
--              PREDICATES -- Murder 1st, Kidnapping, Robbery. In the 2026 code
--              is_rico marks the six Title 12 RICO MODIFIERS, which only a
--              prosecutor or judge may add. These are opposite ends of the same
--              statute and collapsing them would do two wrong things at once:
--              put Murder 1st on the prosecutor-only list, and empty the
--              predicate-act picker that reads the flag today. Split into
--              is_rico (6 Title 10 modifiers) and is_rico_predicate (18).
--
--   arrest     11 charges require an arrest rather than a citation. No 2026
--              column; added rather than dropped.
--
-- is_rico_predicate and arrest_required are NULLABLE on purpose. On a 2026 row
-- they are null, meaning "this version does not state it" -- which is true.
-- Defaulting them to false would have the 2026 code positively asserting that
-- Murder is not a RICO predicate, which it never says.
--
-- ── The effective date is derived, not invented ───────────────────────────
-- effective_date is NOT NULL and the legacy code's real start date is not
-- recorded anywhere in this repo. Rather than invent one, it is taken from the
-- oldest case that actually charged under it: the code was demonstrably in
-- force by then. If no case has charges the fallback is that case table's
-- earliest row, and failing that today -- each a fact about this database
-- rather than a number chosen to look plausible.
--
-- Status is 'superseded', not 'published': penal_code_versions_one_published
-- permits exactly one published version, and this code is not the one in force.
-- Being superseded also keeps it out of penal_current_charges() while leaving
-- it fully readable, which is what a historical reference needs to be.
--
-- APPLICATION NOTE: applied live as penal_legacy_version.
-- ============================================================================

-- ── Columns for the facts above ────────────────────────────────────────────
alter table public.penal_charges
  drop constraint if exists penal_charges_charge_class_check;
alter table public.penal_charges
  add constraint penal_charges_charge_class_check
  check (charge_class in ('Infraction', 'Misdemeanor', 'Felony', 'Capital'));

alter table public.penal_charges
  add column if not exists is_rico_predicate boolean,
  add column if not exists arrest_required boolean;

create index if not exists penal_charges_predicate_idx
  on public.penal_charges (version_id) where is_rico_predicate;

do $legacy$
declare
  v uuid;
  v_effective date;
  -- code | offense | title | class | stackable | fine | jail | judge_jail |
  -- is_rico | is_rico_predicate | is_modifier | arrest | source_row | definition
  payload text := '
(1)01|Assault, Simple|TITLE 1|Misdemeanor||8000|15||||||1|Putting another person in a state of belief that they are in immediate harm.
(1)02|Battery, Simple|TITLE 1|Misdemeanor||12000|20|||||1|2|Intentionally touching/inflicting bodily harm on another person.
(1)03|Aggravated Assault|TITLE 1|Felony|1|16000|20||||||3|Immediate-harm belief with a weapon.
(1)04|Aggravated Battery|TITLE 1|Felony|1|16000|25||||||4|Inflicting bodily harm on another person with a weapon.
(1)05|Murder, 1st Degree|TITLE 1|Felony|1|250000|150|||1|||5|Unlawful killing, willful and premeditated.
(1)06|Murder, 2nd Degree|TITLE 1|Felony|1|200000|90|||1|||6|Unlawful killing, willful but not premeditated.
(1)07|Voluntary Manslaughter|TITLE 1|Felony|1|100000|45||||||7|Killing in sudden, violent, irresistible passion.
(1)08|Involuntary Manslaughter|TITLE 1|Felony|1|75000|30||||||8|Accidental killing due to criminal negligence/recklessness.
(1)09|Attempted Murder|TITLE 1|Felony|1|110000|60|||1|||9|Intentionally attempting to kill or cause great bodily harm.
(1)10|Kidnapping|TITLE 1|Felony|1|30000|25|||1|||10|Taking and moving a person without consent.
(1)11|False Imprisonment|TITLE 1|Felony||20000|20||||||11|Restricting a person''s movement without justification.
(1)12|Conspiracy to Commit|TITLE 1|Misdemeanor||25000|30||||||12|Agreement among two+ to commit an illegal act.
(1)13|Wanton Endangerment|TITLE 1|Felony||15000|20||||||13|Conduct creating substantial risk of injury or death.
(1)14|Criminal Threats|TITLE 1|Misdemeanor||20000|15||||||14|Saying something to terrorize/threaten another.
(1)15|Stalking|TITLE 1|Felony||15000|10||||||15|Repeatedly following or harassing another person.
(2)01|Vandalism|TITLE 2|Misdemeanor||8000|10||||||16|Deliberate destruction/damage to property.
(2)02|Destruction of Government Property|TITLE 2|Felony|1|50000|30||||||17|Destroying government-owned property.
(2)03|Destruction of a Traffic Control Device|TITLE 2|Misdemeanor||10000|10||||||18|Destroying traffic lights/signs/devices.
(2)04|Littering|TITLE 2|Misdemeanor||1000|5||||||19|Throwing trash on the ground.
(2)05|Trespassing|TITLE 2|Misdemeanor||6000|15||||||20|Illegally entering property / trespassed location.
(2)06|Trespassing in a Restricted Area|TITLE 2|Felony||8000|20||||||21|Entering a restricted area in a government building.
(2)07|Burglary / Breaking and Entering|TITLE 2|Felony||20000|25||||||22|Unlawfully entering a building.
(2)08|Possession of Tools for the Commission of a Crime|TITLE 2|Misdemeanor||15000|15||||||23|Possession of burglary/crime tools.
(2)09|Receiving/Possession of Stolen Property (M)|TITLE 2|Misdemeanor||10000|15||||||24|Stolen property valued $949 or less.
(2)10|Receiving/Possession of Stolen Property (F)|TITLE 2|Felony||20000|25||||||25|Stolen property valued $950 or more.
(2)11|Grand Theft Auto|TITLE 2|Felony||16000|15||||||26|Taking an unoccupied vehicle without consent.
(2)12|Carjacking|TITLE 2|Felony||16000|25||||||27|Stealing an occupied vehicle.
(2)13|Possession of a Stolen Vehicle|TITLE 2|Felony||10000|15||||||28|Intentional possession of a stolen vehicle.
(2)14|Criminal Possession of Identification|TITLE 2|Felony||10000|10||||||29|Providing an ID/license not belonging to the person.
(2)15|Extortion|TITLE 2|Felony||20000|20|||1|||30|Obtaining money/favors by threat, force, or blackmail.
(2)16|Robbery|TITLE 2|Felony||15000|20|||1|||31|Taking property by threats or force.
(2)17|Aggravated Robbery|TITLE 2|Felony||20000|30|||1|||32|Robbery using a deadly weapon.
(2)18|Petty Theft|TITLE 2|Misdemeanor||10000|10||||||33|Theft of property $1000 or less.
(2)19|Grand Larceny|TITLE 2|Felony||15000|20||||||34|Theft of property at/above $1000.
(2)20|Laundering|TITLE 2|Felony||15000|15|||1|||35|Obtaining or possessing illegal money.
(2)21|Tampering with a Motor Vehicle|TITLE 2|Misdemeanor||16000|15||||||36|Altering/tampering with a vehicle without consent.
(2)22|Fraud|TITLE 2|Felony||25000|25||||||37|Criminal deception for financial/personal gain.
(2)23|Arson|TITLE 2|Felony||15000|15|||1|||38|Willful and malicious burning of property/persons.
(2)24|Theft of Mail/Mailbox|TITLE 2|Felony||20000|15||||||39|Theft of mail/mailbox of personal or commercial entities.
(3)01|Disorderly Conduct|TITLE 3|Misdemeanor||5000|10||||||40|Disruptive behavior in a public setting.
(3)02|Disturbing the Peace|TITLE 3|Infraction||6000|5||||||41|Causing a disruption in public by behavior/noise.
(3)03|Unlawful Assembly|TITLE 3|Misdemeanor||10000|15||||||42|Group intending deliberate disturbance/crime.
(3)04|Rioting|TITLE 3|Felony||16000|20||||||43|Group intending battery, theft, vandalism.
(3)05|Public Urination|TITLE 3|Misdemeanor||2000|5||||||44|Urinating in a public area.
(3)06|Loitering|TITLE 3|Misdemeanor||6000|10||||||45|Lingering/prowling on property without lawful business.
(3)07|Impersonating a Public Servant|TITLE 3|Felony||25000|30||||||46|Falsely pretending to hold a public-service position.
(3)08|Possession of an Explosive Device|TITLE 3|Felony||90000|60||||||47|Unregistered/illegally modified explosive.
(3)09|Attempted Use of an Explosive or Incendiary Device|TITLE 3|Felony||100000|75||||||48|Attempting to deploy/ignite an explosive device.
(3)10|Making a Bomb Threat|TITLE 3|Felony||75000|45||||||49|False statement/threat indicating a bomb is present.
(3)11|Possession of Explosive Materials with Intent to Distribute|TITLE 3|Felony||85000|50||||||50|Multiple devices/components suggesting intent to sell/arm.
(3)12|Terrorism|TITLE 3|Capital||500000||1|||||51|Act of mass violence/destruction to cause widespread fear (sentence: JUDGE).
(3)13|Breach of the Safe Haven Protection Act|TITLE 3|Capital||400000||1|||||52|Knowingly breaching the Safe Haven Protection Act (sentence: JUDGE).
(4)01|Murder of a Peace Officer|TITLE 4|Felony|1|300000|180|||1|||53|Intentional killing of a peace officer.
(4)02|Attempted Murder of a Peace Officer|TITLE 4|Felony|1|110000|60|||1|||54|Attempting to kill/gravely harm a peace officer.
(4)03|Battery of a Peace Officer|TITLE 4|Felony|1|20000|30||||||55|Inflicting bodily harm on a peace officer, no weapon.
(4)04|Aggravated Battery of a Peace Officer|TITLE 4|Felony|1|40000|45||||||56|Inflicting bodily harm on a peace officer with a weapon.
(4)05|Fleeing and Eluding, Felony|TITLE 4|Felony|1|30000|30||||||57|Vehicle flight from LE exceeding 20 MPH over the limit.
(4)06|Fleeing or Eluding, Misdemeanor|TITLE 4|Misdemeanor||20000|15|||||1|58|Flight on foot / under 3 minutes.
(4)07|Resisting Arrest|TITLE 4|Misdemeanor||15000|15||||||59|Actively resisting detainment or arrest.
(4)08|Escaping Custody|TITLE 4|Felony||20000|30||||||60|Leaving a cell/LE vehicle/facility while in custody.
(4)09|Obstruction of Justice|TITLE 4|Felony||15000|20||||||61|Interfering with an investigation/peace officer.
(4)10|Interfering with a Peace Officer|TITLE 4|Felony||16000|15||||||62|Interfering with an officer performing duties.
(4)11|Aiding or Abetting|TITLE 4|Felony||20000|25||||||63|Helping/inciting during the commission of a crime.
(4)12|Accessory After the Fact|TITLE 4|Felony||10000|15||||||64|Helping a person avoid arrest after a crime.
(4)13|Bribery|TITLE 4|Felony||10000|15|||1|||65|Paying/exchanging services to alter decisions.
(4)14|Failure to Obey a Lawful Command|TITLE 4|Misdemeanor||10000|15||||||66|Going against a lawful order of a peace officer.
(4)15|Misuse of a 911 Hotline|TITLE 4|Misdemeanor||10000|15||||||67|Misusing 911 / calls without actual reason.
(4)16|Failure to Identify|TITLE 4|Misdemeanor||10000|10||||||68|Failing to provide identifying info when requested.
(4)17|Providing False Information|TITLE 4|Misdemeanor||10000|10|||||1|69|Knowingly lying to a peace officer.
(4)18|Failure to Yield to an Emergency Vehicle|TITLE 4|Misdemeanor||10000|15||||||70|Blocking/failing to yield to an emergency vehicle.
(4)19|Filing a False Report|TITLE 4|Misdemeanor||16000|20||||||71|False report/complaint against another person.
(4)20|Evidence Tampering|TITLE 4|Felony||16000|20||||||72|Moving, destroying, or concealing evidence.
(4)21|Malfeasance|TITLE 4|Felony||50000|45||||||73|Intentional neglect of duties and the law.
(4)22|Theft of Government Property|TITLE 4|Felony||20000|20||||||74|Taking government property from a structure/vehicle.
(4)23|Contempt of Court|TITLE 4|Misdemeanor|1|10000||1|||||75|Being disruptive or disrespectful in court (sentence: JUDGE).
(4)24|Perjury|TITLE 4|Felony||50000||1|||||76|Providing false information / lying while under oath (sentence: JUDGE).
(4)25|Failure to Appear|TITLE 4|Felony||20000|25||||||77|Willfully failing to appear at a required court date.
(4)26|Murder of a Police K-9|TITLE 4|Felony|1|40000|60||||||78|Intentional killing of a Police K-9.
(4)27|Attempted Murder of a Police K-9|TITLE 4|Felony|1|24000|40||||||79|Attempting to kill or gravely harm a Police K-9.
(4)28|Unlawful Death of a Police K-9|TITLE 4|Misdemeanor||18000|30||||||80|Actions resulting in the death of a K-9, with or without malice.
(4)29|Murder of a State Official|TITLE 4|Felony|1|300000|180|||1|||81|Intentional killing of a State Official.
(4)30|Attempted Murder of a State Official|TITLE 4|Felony|1|120000|60|||1|||82|Attempting to kill or gravely harm a State Official.
(4)31|Battery of a State Official|TITLE 4|Felony|1|75000|30||||||83|Inflicting bodily harm on a State Official, no weapon.
(4)32|Aggravated Battery of a State Official|TITLE 4|Felony|1|90000|45||||||84|Inflicting bodily harm on a State Official with a weapon.
(4)33|Assisting or Instigating Escape|TITLE 4|Felony||20000|30||||||85|Assisting/instigating an escape from lawful custody.
(4)34|Corruption|TITLE 4|Felony||200000|60||||||86|Being influenced to commit fraud or violate official duty as an authority.
(4)35|Prison Break|TITLE 4|Felony||100000||1|||||87|Unlawfully escaping/attempting to escape a correctional facility (sentence: MAX ORIGINAL TIME); aiders face the same.
(4)36|Misprision of Felony|TITLE 4|Felony||15000|15||||||88|Concealing/failing to report a felony on premises you control (+30mo & $30k if business owner).
(5)01|Brandishing a Firearm|TITLE 5|Misdemeanor||14000|10|||||1|89|Aiming/waving a firearm in a reckless manner.
(5)02|Unlawful Discharge of a Firearm|TITLE 5|Felony||18000|20||||||90|Discharging a firearm recklessly, risking serious injury or death.
(5)03|Felon in Possession of a Firearm and/or Ammunition|TITLE 5|Felony||16000|10||||||91|A convicted felon possessing a firearm and/or ammunition.
(5)04|Possession of a Firearm in the Commission of a Crime (Modifier)|TITLE 5|Felony||12000|10||||1||92|Committing a crime with a firearm in your possession.
(5)05|Possession of a Firearm Alongside Illegal Substances (Modifier)|TITLE 5|Felony||20000|15||||1|1|93|Possessing a firearm with illegal substances.
(5)06|Unlicensed Distribution of Firearms|TITLE 5|Felony||14000|15||||||94|Selling/giving away firearms without a license.
(5)07|Wearing Body Armor in the Commission of a Crime (Modifier)|TITLE 5|Felony||10000|20||||1||95|Wearing body armor while committing a crime.
(5)08|Possession of an Illegal Firearm (Class 1)|TITLE 5|Felony|1|20000|20||||||96|Possessing an illegal Class 1 firearm/weapon.
(5)09|Possession of an Illegal Firearm (Class 2)|TITLE 5|Felony|1|70000|30||||||97|Possessing an illegal Class 2 firearm/weapon.
(5)10|Possession of an Illegal Firearm (Class 3)|TITLE 5|Felony|1|100000|40||||||98|Possessing an illegal Class 3 firearm/weapon.
(5)11|Distribution of Illegal Weapons|TITLE 5|Felony||150000|80||||||99|Selling/giving away illegal weapons.
(5)12|Unlawful Possession of a Firearm|TITLE 5|Felony||15000|15||||||100|Carrying a firearm without an active license/permit (non-felon).
(5)13|Illegal Firearm Modification|TITLE 5|Felony||10000|15||||||101|Illegally modifying a firearm with a drum magazine or suppressor.
(5)14|Discharge of a Class 2 or Class 3 Firearm in the Commission of a Crime (Modifier)|TITLE 5|Felony||20000|10||||1||102|Discharging a Class 2/3 firearm while committing a crime.
(5)15|Unlawful Carry|TITLE 5|Misdemeanor||10000|0||||||103|Openly carrying a firearm, registered or not, in public.
(6)01|Possession of a Controlled Substance [Schedule I]|TITLE 6|Felony||20000|20||||||104|Possessing a Schedule I controlled substance or materials to make it.
(6)02|Possession of a Controlled Substance [Schedule II]|TITLE 6|Felony||50000|30||||||105|Possessing a Schedule II controlled substance or materials to make it.
(6)03|Possession of a Controlled Substance with Intent to Sell (Modifier)|TITLE 6|Felony||75000|30|||1|1|1|106|Possessing a controlled substance packaged for distribution.
(6)04|Distribution of a Controlled Substance|TITLE 6|Felony||60000|30|||1|||107|Selling a controlled substance to another person.
(6)05|Possession of Drug Paraphernalia|TITLE 6|Misdemeanor||10000|15||||||108|Possessing items used to sniff, smoke, or inject drugs.
(6)06|Manufacturing a Controlled Substance|TITLE 6|Felony||25000|30||||||109|Making a controlled substance.
(6)07|Criminal Possession of Marijuana|TITLE 6|Misdemeanor||10000|10||||||110|Over 4oz unrolled or 10 joints in public / off your property.
(6)08|Under the Influence of Narcotics|TITLE 6|Misdemeanor||5000|10|||||1|111|Being in public under the influence of a narcotic.
(6)09|Underage Possession of Alcohol|TITLE 6|Misdemeanor||4000|10||||||112|Possessing alcohol under the legal age (21).
(6)10|Public Intoxication|TITLE 6|Misdemeanor||10000|10|||||1|113|Being in public under the influence of alcohol.
(6)11|Trafficking Narcotics, First Degree|TITLE 6|Felony||50000|45|||1|||114|Transporting 16oz (448g)+ of any controlled substance incl. marijuana.
(6)12|Trafficking Narcotics, Second Degree|TITLE 6|Felony||40000|30|||1|||115|Transporting 4oz-16oz of any controlled substance excl. marijuana.
(6)13|Unlawful Production of Distilled Spirits|TITLE 6|Felony||15000|20||||||116|Unlicensed production of distilled spirits (moonshine).
(6)14|Unlicensed Distribution of Distilled Spirits|TITLE 6|Misdemeanor||20000|25|||||1|117|Unlicensed sale of distilled spirits (moonshine).
(7)01|Animal Abuse|TITLE 7|Felony|1|20000|30||||||118|Physically abusing or neglecting an animal.
(7)02|Hunting without a Permit|TITLE 7|Misdemeanor||10000|10||||||119|Hunting wildlife without proper credentials.
(7)03|Fishing without a Permit|TITLE 7|Misdemeanor||10000|15||||||120|Fishing without proper credentials.
(7)04|Poaching|TITLE 7|Misdemeanor||15000|25||||||121|Illegal hunting/capturing of wildlife.
(7)05|Illegal Hunting/Fishing Methods|TITLE 7|Misdemeanor||10000|10||||||122|Illegal methods/equipment used for hunting or fishing.
(7)06|Illegal Fire Placement|TITLE 7|Misdemeanor||16000|10||||||123|Illegally placing/setting fires in a natural area.
(7)07|Possession of Illegal Trophies|TITLE 7|Infraction||2000|0||||||124|Possessing animal parts/products obtained in violation of wildlife laws.
(8)01|Failure to Keep/Maintain Log Book|TITLE 8|Infraction||1500|0||||||125|Commercial driver failing to keep/maintain a log book.
(8)02|Failure to Stop at Weigh Station/Inspection|TITLE 8|Misdemeanor||2000|10||||||126|Passing an active weigh station.
(8)03|Improper Safety Equipment|TITLE 8|Misdemeanor||4000|10||||||127|Operating a commercial vehicle with improper safety equipment.
(8)04|Operating an Overweight Vehicle|TITLE 8|Misdemeanor||3000|10||||||128|Operating an overweight commercial vehicle.
(8)05|Failure to Ensure Connection of Trailer|TITLE 8|Misdemeanor||3000|10||||||129|Operating with an improperly connected trailer.
(8)06|Possession of Alcohol Inside of a Commercial Vehicle|TITLE 8|Misdemeanor||8000|10||||||130|Unlawful possession of alcohol while in/operating a commercial vehicle.
(9)01|Driving without a License|TITLE 9|Misdemeanor||4000|10||||||131|Operating a motor vehicle without an active DL.
(9)02|Driving with a Suspended or Revoked License|TITLE 9|Misdemeanor||10000|15||||||132|Operating a motor vehicle with a suspended/revoked DL.
(9)03|Operating a Motor Vehicle without Proper Reg/Insurance|TITLE 9|Infraction||15000|0||||||133|Operating without valid registration and/or insurance.
(9)04|Failure to Display License Plate|TITLE 9|Infraction||10000|0||||||134|Operating without a plate or with the plate obstructed.
(9)05|License Plate Violation|TITLE 9|Infraction||10000|0||||||135|Operating with an SA Exempt plate or another vehicle''s registration.
(9)06|Speeding, 1st Degree|TITLE 9|Misdemeanor||10000|0||||||136|Operating 51-99 MPH over the posted limit.
(9)07|Speeding, 2nd Degree|TITLE 9|Infraction||7000|0||||||137|Operating 26-50 MPH over the posted limit.
(9)08|Speeding, 3rd Degree|TITLE 9|Infraction||5000|0||||||138|Operating 1-25 MPH over the posted limit.
(9)09|Felony Speeding|TITLE 9|Felony||15000|15||||||139|Operating 100+ MPH over the posted limit.
(9)10|Window Tint Violation|TITLE 9|Infraction||1000|0||||||140|Dark smoke/limo/black window tint on a vehicle.
(9)11|Failure to Display Headlights/Brake Lights|TITLE 9|Infraction||1000|0||||||141|Operating without headlights or brake lights on.
(9)12|Failure to Maintain Lanes|TITLE 9|Infraction||2000|0||||||142|Failing to stay in lane or changing lanes recklessly.
(9)13|Reckless Driving|TITLE 9|Felony||15000|15|||||1|143|Operating with total disregard for public safety.
(9)14|Distracted Driving|TITLE 9|Infraction||2000|0||||||144|Operating while paying attention to things other than the road.
(9)15|Excessive Use of Horn|TITLE 9|Infraction||1000|0||||||145|Honking for reasons other than motor safety.
(9)16|Parking Violation|TITLE 9|Infraction||1000|0||||||146|Parking in an unauthorized area.
(9)17|Illegal Overtake|TITLE 9|Infraction||2000|0||||||147|Illegally passing via shoulder or crossing a double yellow.
(9)18|Obstructing a Roadway|TITLE 9|Misdemeanor||4000|5||||||148|Obstructing/impeding traffic on foot or by vehicle.
(9)19|Obstructing a Sidewalk/Crosswalk|TITLE 9|Infraction||1000|0||||||149|Stopping/parking on a sidewalk or crosswalk.
(9)20|Failure to Yield Right of Way/Stop Sign|TITLE 9|Infraction||2000|0||||||150|Failing to yield right of way or stop at stop signs.
(9)21|Hit and Run, 1st Degree|TITLE 9|Felony||10000|10||||||151|Striking another and leaving the scene, causing death/serious injury.
(9)22|Hit and Run, 2nd Degree|TITLE 9|Misdemeanor||3000|5||||||152|Striking another vehicle/person and leaving the scene.
(9)23|Driving Under the Influence [DUI]|TITLE 9|Misdemeanor||6000|10|||||1|153|Operating under the influence (over 35%); FST/PBT or BaC >=0.08% satisfies.
(9)24|Aggravated Driving Under the Influence|TITLE 9|Felony||10000|20||||||154|Operating while unusually intoxicated (over 60%); PBT satisfies.
(9)25|Failure to Obey a Traffic Control Device|TITLE 9|Infraction||2000|0||||||155|Failing to follow a construction/LE sign or traffic light.
(9)26|Failure to Display Drivers License|TITLE 9|Infraction||2000|0||||||156|Failing to display DL when requested by an officer.
(10)01|RICO Conspiracy (Modifier)|TITLE 10 - RICO MODIFIERS|Capital||150000||1|1||1||157|Organized agreement to commit an illegal act (sentence: JUDGE).
(10)02|RICO Murder (Modifier)|TITLE 10 - RICO MODIFIERS|Capital||500000||1|1||1||158|Unlawful killing as part of a criminal organization (sentence: JUDGE).
(10)03|RICO Robbery (Modifier)|TITLE 10 - RICO MODIFIERS|Capital||100000||1|1||1||159|Taking property by force as part of a criminal organization (sentence: JUDGE).
(10)04|RICO Bribery (Modifier)|TITLE 10 - RICO MODIFIERS|Capital||75000||1|1||1||160|Bribery as part of a criminal organization (sentence: JUDGE).
(10)05|RICO Trafficking (Modifier)|TITLE 10 - RICO MODIFIERS|Capital||80000||1|1||1||161|Trafficking 16oz+ as part of a criminal organization (sentence: JUDGE).
(10)06|RICO Kidnapping (Modifier)|TITLE 10 - RICO MODIFIERS|Capital||50000||1|1||1||162|Kidnapping as part of a criminal organization (sentence: JUDGE).';
  ln text; p text[];
begin
  -- Derived, never invented. See the header.
  select coalesce(
    (select min(c.created_at)::date from public.cases c
      where c.charges is not null and jsonb_array_length(c.charges) > 0),
    (select min(c.created_at)::date from public.cases c),
    current_date)
  into v_effective;

  select id into v from public.penal_code_versions
   where name = 'San Andreas Penal Code (legacy)';
  if v is not null then
    delete from public.penal_charges where version_id = v;
  else
    insert into public.penal_code_versions
      (name, effective_date, source_file, change_summary, status, superseded_at)
    values ('San Andreas Penal Code (legacy)', v_effective, 'src/lib/penal.ts',
            'The 162-charge code the portal ran on before the 2026 import, recorded so historical case charges resolve against the code that was actually in force when they were filed. Generated from the source array, not transcribed.',
            'superseded', now())
    returning id into v;
  end if;

  foreach ln in array string_to_array(payload, chr(10)) loop
    if btrim(ln) = '' then continue; end if;
    p := string_to_array(ln, '|');
    insert into public.penal_charges (
      version_id, code, offense, penal_title, charge_class, stackable,
      fine, jail_months, judge_set_jail, is_rico, is_rico_predicate,
      is_modifier, arrest_required, source_row, definition, lifecycle)
    select v, p[1], p[2], p[3], p[4], p[5] = '1',
           nullif(p[6], '')::numeric, nullif(p[7], '')::numeric,
           -- p[10]/p[12] use plain '=' so an absent flag lands as FALSE, not
           -- NULL. penal.ts is exhaustive: a charge without `rico` is not a
           -- predicate, which is a statement, unlike a 2026 row where the
           -- column is null because that version never addresses the question.
           p[8] = '1', p[9] = '1', p[10] = '1',
           p[11] = '1', p[12] = '1',
           p[13]::int, nullif(p[14], ''), 'active';
  end loop;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'PENAL_VERSION_IMPORTED', 'penal_code_versions', v,
          jsonb_build_object(
            'name', 'San Andreas Penal Code (legacy)',
            'source_file', 'src/lib/penal.ts',
            'status', 'superseded',
            'effective_date', v_effective,
            'charges', (select count(*) from public.penal_charges where version_id = v),
            'note', 'Historical reference for cases charged before the 2026 code.'));
end $legacy$;

-- ============================================================================
-- Rollback: delete the 'San Andreas Penal Code (legacy)' version (charges
-- cascade), drop is_rico_predicate and arrest_required, and narrow
-- penal_charges_charge_class_check back to three classes. Narrowing the check
-- fails while any Capital charge exists, which is the correct order of
-- operations rather than an obstacle.
-- ============================================================================

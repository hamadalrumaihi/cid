-- ============================================================================
-- The Odyssey RP Penal Code 2026, imported as a draft version.
--
-- Source: ODY_PENAL_CODE_2026_ALL_SHEETS.md, both worksheets.
--   "Penal Code"  -> 197 charge rows across 12 titles
--   "Start Here"  -> the schedules, the hard limits, and the court/plea rules
--
-- Imported as a DRAFT. Publishing is a separate, audited act by a Penal Code
-- administrator (penal_publish_version), because publishing changes the law in
-- force and should not be a side effect of a deployment.
--
-- ── What the source could not supply, and what was done about it ──────────
--
-- 31 rows carry no charge code. The spreadsheet exported unresolved formulas
-- (=A69+1, =A147+1 ...) in the Code column: the two Schedule 2 / Schedule 3
-- possession charges, and Title 7 from Street Racing through Illegal Dumping.
-- Every other field on those rows is intact, so they are imported in full with
-- lifecycle 'draft' and needs_code, which the SELECT policy keeps out of every
-- selector. Assigning a code through penal_restore_charge() brings one into
-- force.
--
-- Sequential inference was considered and rejected as unsafe. In document
-- order Title 4 runs 401 (Schedule 1), =A69+1, =A70+1, then 402 and 403 --
-- so continuing the sequence would number the two Schedule rows 402 and 403,
-- which already belong to Possession with Intent to Sell and Sales. The guess
-- would have put the wrong number on a narcotics charge.
--
-- ── Conflicts recorded rather than silently resolved ──────────────────────
--
-- 214 Possession of Burglary Tools: the Stackable column reads N while the
-- definition ends "STACKABLE". Imported as stackable, because the definition
-- is the operative text, and the disagreement is written into special_notes so
-- a reviewer sees it rather than inheriting a silent decision.
--
-- 516 Prison Break: jail reads "MAX ORIGINAL" rather than a number. Stored as
-- no fixed term with the rule in special_notes; it is not judge-set, so it is
-- not flagged as such.
--
-- 8 charges are judge-set (314, 513, and all six RICO modifiers). Their fine
-- and/or jail is NULL with judge_set_fine / judge_set_jail true -- a distinct
-- state from zero, enforced by constraint, so a total can never quietly count
-- "a judge decides" as nothing.
--
-- No duplicate codes were found among the 166 rows that have one.
--
-- ── What this migration does NOT do ───────────────────────────────────────
-- It does not publish the version, touch cases.charges, alter src/lib/penal.ts
-- or change any selector. The portal keeps running on its current hard-coded
-- code until those are migrated in a later step, deliberately, so this import
-- can be reviewed against the source on its own.
--
-- APPLICATION NOTE: applied live as penal_code_2026_import.
-- ============================================================================

do $import$
declare
  v uuid;
  -- One pipe-delimited line per charge, in source order. Columns:
  --   code | offense | title_index | class | stackable | fine | jail |
  --   judge_fine | judge_jail | pd_exempt | modifier | rico | schedule |
  --   needs_code | source_row | lifecycle | definition | special_notes
  -- Empty means NULL (or false for the flags). The delimiter was checked
  -- against every field in the source before it was chosen: no pipe occurs in
  -- any offense, definition or note.
  payload text := '101|Simple Assault|0|Misdemeanor|1|10000|15||||||||1|active|Attempting or threatening to cause physical harm to another person.|
102|Battery|0|Misdemeanor|1|25000|20||||||||2|active|Actually making unwanted physical contact that harms another person.|
103|Aggravated Battery|0|Felony|1|75000|30||||||||3|active|Battery causing serious injury, or committed against a vulnerable person. (Downing)|
104|Assault with a Deadly Weapon|0|Felony||125000|35||||||||4|active|Assault committed while using or displaying any weapon.|
105|Assault on a Peace Officer|0|Felony|1|100000|50||||||||5|active|Assault or battery against on-duty police, EMS, or fire personnel.|
106|Attempted Murder|0|Felony||500000|55||||||||6|active|Taking a direct step toward killing someone, where the victim survives. (PERMA)|
107|Manslaughter|0|Felony||100000|45||||||||7|active|Killing someone without planning it, through recklessness or heat of the moment. (PERMA)|
108|Involuntary Manslaughter|0|Felony||75000|30||||||||8|active|Accidentally killing someone through criminal negligence, such as impaired or reckless driving. (PERMA)|
109|Murder|0|Felony|1|750000|60||||||||9|active|Intentionally and knowingly killing another person, with premeditation. (PERMA)|
110|Murder, Second Degree|0|Felony|1|500000|60||||||||10|active|Killing another person willfully, but without planning it in advance. (PERMA)|
111|Murder of a Peace Officer|0|Felony|1|2500000|60||||||||11|active|Murder of on-duty police, EMS, or fire personnel. (PERMA)|
112|Kidnapping|0|Felony|1|50000|20||||||||12|active|Taking or moving a person against their will.|
113|False Imprisonment|0|Felony||20000|10||||||||13|active|Restricting another person''s movement within an area without lawful justification. DO NOT STACK WITH KIDNAPPING|
114|Torture|0|Felony||125000|45||||||||14|active|Inflicting severe pain on a restrained or captive person.|
115|Criminal Threats|0|Misdemeanor||40000|15||||||||15|active|Threatening death or serious harm in a way a reasonable person would believe.|
116|Harassment|0|Misdemeanor||20000|10||||||||16|active|Repeated unwanted contact that alarms or seriously annoys another person.|
117|Stalking|0|Felony||30000|10||||||||17|active|Willfully, maliciously, and repeatedly following or harassing another person.|
118|Wanton Endangerment|0|Misdemeanor||20000|10||||||||18|active|Acting in a way that puts others at serious risk of injury or death.|
119|Assault on a Government Official|0|Felony||100000|20||||||||19|active|Assault against a judge, prosecutor, or elected official over their duties.|
120|Conspiracy to Commit|0|Misdemeanor||25000|10||||||||20|active|An agreement between two or more people to commit a crime, with a step taken toward it.|
201|Attempted Robbery|1|Felony||50000|10||||||||21|active|The act of attempting to take property by force.|
202|Attempted Aggravated Robbery|1|Felony||80000|15||||||||22|active|The act of attempting to take property by deadly force.|
203|Robbery|1|Felony||115000|20||||||||23|active|Taking property directly from a person or premise using force or fear.|
204|Aggravated Robbery|1|Felony||150000|25||||||||24|active|Taking property directly from a person or premise using deadly force.|
205|Carjacking|1|Felony||25000|10||||||||25|active|Stealing a vehicle that is occupied at the time.|
206|Grand Theft Auto|1|Felony||15000|5||||||||26|active|Taking an unoccupied vehicle that does not belong to you.|
207|Possession of a Stolen Vehicle|1|Felony||50000|15||||||||27|active|Possessing a vehicle that is known by you to be stolen.|
208|Tampering with a Motor Vehicle|1|Misdemeanor||10000|5||||||||28|active|Altering or tampering with any vehicle or its contents without the consent of the owner.|
209|Theft|1|Felony||50000|15||||||||29|active|Taking property valued at any amount.|
210|Receiving or Possessing Stolen Property|1|Misdemeanor||10000|15||||||||30|active|Receiving or holding stolen property valued under $1,000.|
211|Receiving or Possessing Stolen Property (Felony)|1|Felony||50000|15||||||||31|active|Receiving or holding stolen property valued at $1,000 or more.|
212|Theft of Mail or Mailbox|1|Felony||20000|15||||||||32|active|Theft of mail or a mailbox belonging to a person or business.|
213|Burglary|1|Felony||50000|15||||||||33|active|Entering a building or vehicle intending to commit a crime inside.|
214|Possession of Burglary Tools|1|Infraction|1|2000|||||||||34|active|Possessing advanced lockpicks, thermite, explosives, or other tools made for breaking in. STACKABLE|Stackable column read N but the definition states STACKABLE; imported as stackable and flagged for review.
215|Trespassing|1|Misdemeanor||20000|20||||||||35|active|Being on private property after being told to leave.|
216|Trespassing in a Restricted Area|1|Felony||50000|45||||||||36|active|Entering a restricted or controlled area inside a government building.|
217|Vandalism|1|Misdemeanor||25000|10||||||||37|active|Damaging or defacing property belonging to someone else.|
218|Destruction of Government Property|1|Felony||75000|10||||||||38|active|Destroying any property owned by the state, county, or city.|
219|Destruction of a Traffic Control Device|1|Infraction||5000|||||||||39|active|Destroying traffic lights, signs, or other devices used to direct traffic.|
220|Arson|1|Felony|1|150000|10||||||||40|active|The willful burning of someone else''s property, or person.|
221|Extortion|1|Felony||100000|10||||||||41|active|Obtaining money or favors by means of threat, force, or blackmail.|
222|Fraud|1|Felony|1|250000|20||||||||42|active|Deceiving someone to obtain money, property, or services.|
223|Identity Theft|1|Felony||50000|5||||||||43|active|Using another person''s identity or credentials without permission.|
224|Criminal Possession of Identification|1|Felony||75000|5||||||||44|active|Presenting an identification or driver''s license that belongs to someone else.|
225|Looting|1|Felony||50000|10||||||||45|active|Theft committed during a riot, disaster, or emergency services scene.|
226|Grand Theft Aircraft / Watercraft|1|Felony||125000|20||||||||46|active|Taking a plane, helicopter, or boat that does not belong to you.|
227|Littering|1|Infraction||5000|||||||||47|active|Disposing of objects onto the ground rather than using a city trash can.|
301|Disorderly Conduct|2|Misdemeanor||10000|20||||||||48|active|Fighting, shouting, or behaving in a way that disrupts public peace.|
302|Disturbing the Peace|2|Misdemeanor||20000|20||||||||49|active|Causing a disruption in public through behavior or excessive noise.|
303|Public Intoxication|2|Infraction||1000|||||||||50|active|Being visibly impaired in public to the point of being a hazard.|
304|Public Urination|2|Infraction||10000|||||||||51|active|The act of urinating in a publicly accessible place.|
305|Loitering|2|Infraction||15000|||||||||52|active|Lingering or prowling on private property with no lawful business with the owner or occupant.|
306|Unlawful Assembly|2|Misdemeanor||10000|5||||||||53|active|Gathering in a group that refuses a lawful order to disperse.|
307|Rioting|2|Felony||50000|20||||||||54|active|Participating in a violent or destructive group disturbance.|
308|Indecent Exposure|2|Infraction||10000|||||||||55|active|Exposing oneself in public where others can see.|
309|Solicitation|2|Misdemeanor||30000|10||||||||56|active|Offering or agreeing to exchange sexual services for money.|
310|Possession of an Explosive Device|2|Felony|1|50000|10||||||||57|active|Possession of an illegally modified or unregistered explosive. STACKABLE|
311|Attempted Use of an Explosive or Incendiary Device|2|Felony||225000|30||||||||58|active|Attempting to deploy or ignite an explosive device, whether or not it detonated.|
312|Possession of Explosive Materials with Intent to Distribute|2|Felony||200000|25||||||||59|active|Holding multiple devices or components, indicating intent to sell or arm others.|
313|Making a Bomb Threat|2|Felony||150000|20||||||||60|active|Knowingly making a statement or threat to bomb somebody or something.|
314|Breach of Safe Haven|2|Felony||||1|1||||||61|active|Any person or group who knowingly commits acts that directly breach the Safe Haven Protection Act. If no judge is available, $60,000 and 60 months.|
401|Possession of a Controlled Substance (Schedule 1)|3|Misdemeanor|1|5000|10||||||1||62|active|Possessing a schedule 1 controlled substance, or materials to make such. STACKABLE|
|Possession of a Controlled Substance (Schedule 2)|3|Misdemeanor|1|8000|10||||||2|1|63|draft|Possessing a schedule 2 controlled substance, or materials to make such. STACKABLE|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A69+1) instead of a number. Held as a draft until a code is assigned.
|Possession of a Controlled Substance (Schedule 3)|3|Felony|1|10000|10||||||3|1|64|draft|Possessing a schedule 3 controlled substance, or materials to make such. STACKABLE|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A70+1) instead of a number. Held as a draft until a code is assigned.
402|Possession with Intent to Sell (Modifier)|3|Felony||75000|15||||1||||65|active|Holding ANY controlled substance packaged in selling amounts. Added on top of the possession charge.|
403|Sales of a Controlled Substance|3|Felony|1|10000|5||||||||66|active|Selling any amount of a controlled substance to any person, including locals. STACKABLE|
404|Manufacture of a Controlled Substance|3|Felony||75000|25||||||||67|active|Growing, cooking, or producing illegal substances.|
405|Trafficking Narcotics, First Degree|3|Felony||100000|20||||||||68|active|Moving or supplying illegal substances in bulk quantity (50+ item quantity).|
406|Trafficking Narcotics, Second Degree|3|Felony||50000|15||||||||69|active|Moving or supplying illegal substances in a 20 to 49 item quantity.|
407|Possession of Drug Paraphernalia|3|Infraction|1|5000|||||||||70|active|Holding equipment used to consume or prepare illegal substances.|
408|Public Consumption of a Controlled Substance|3|Infraction||2000|||||||||71|active|Using an illegal substance in a public place.|
409|Under the Influence of Narcotics|3|Infraction||5000|||||||||72|active|Being in a public place under the influence of a narcotic.|
410|Unlawful Possession of Cannabis|3|Misdemeanor||15000|10||||||||73|active|Possessing more than 10 item quantity of cannabis in total on your person.|
411|Unlawful Production of Cannabis|3|Misdemeanor||75000|15||||||||74|active|Growing or possessing 7 or more cannabis plants, but fewer than 20.|
412|Unlawful Production of Cannabis (20+ Plants)|3|Felony||100000|25||||||||75|active|Growing or possessing 20 or more cannabis plants.|
413|Unlawful Distribution of Cannabis|3|Felony||75000|25||||||||76|active|Conducting unlicensed sales of cannabis to any person in the city while not operating as a dispensary.|
414|Unlawful Production of Distilled Spirits|3|Misdemeanor||30000|10||||||||77|active|Unlawful production of distilled spirits (moonshine).|
415|Unlawful Sale of Distilled Spirits|3|Felony||35000|15||||||||78|active|Unlawful sales of distilled spirits (moonshine).|
501|Failure to Comply with a Lawful Order|4|Misdemeanor||30000|5||||||||79|active|Refusing a clear, lawful instruction from an officer.|
502|Failure to Identify|4|Misdemeanor||30000|25||||||||80|active|Intentionally failing to provide identifying information when lawfully required.|
503|Providing False Information|4|Misdemeanor||50000|30||||||||81|active|Giving a false name, ID, or statement to an officer.|
504|Filing a False Report|4|Misdemeanor||30000|10||||||||82|active|Reporting a crime or emergency that did not occur.|
505|Misuse of 911 Hotline|4|Misdemeanor||40000|20||||||||83|active|Misusing a 911 system or placing 911 calls for non-emergency reasons.|
506|Resisting Arrest|4|Misdemeanor||30000|15||||||||84|active|Running from officers while handcuffed, tackling officers, or refusing to comply during processing.|
507|Fleeing and Eluding (Foot)|4|Misdemeanor||20000|5||||||||85|active|Fleeing from an officer while on foot.|
508|Interfering with a Peace Officer|4|Misdemeanor||20000|10||||||||86|active|Intentionally interfering with an officer while they are performing their duties.|
509|Obstruction of Justice|4|Misdemeanor||20000|10||||||||87|active|Interfering with an officer''s investigation, scene, or duties.|
510|Evidence Tampering|4|Felony||50000|15||||||||88|active|Moving, destroying, or concealing evidence.|
511|Witness / Victim Intimidation|4|Felony||250000|20||||||||89|active|Threatening someone to stop them testifying or reporting.|
512|Perjury|4|Felony||3000000|40||||||||90|active|Knowingly lying under oath in court.|
513|Contempt of Court|4|Misdemeanor||||1|1||||||91|active|Disrespecting or disobeying the court or a judge''s order.|
514|Failure to Appear|4|Misdemeanor||20000|20||||||||92|active|Failing to appear for a scheduled court date. Issued by a judge in a valid warrant only.|
515|Escape from Custody|4|Felony||100000|25||||||||93|active|Fleeing lawful detention, including running out of the jail cells.|
516|Prison Break|4|Felony||300000|||||||||94|active|Escaping or attempting to escape a correctional facility. Anyone who aids the escape faces the same penalty.|Jail equals the maximum of the original sentence (source: "MAX ORIGINAL").
517|Harboring or Aiding an Escaped Prisoner|4|Felony||150000|20||||||||95|active|Concealing or aiding any prisoner wanted after or during their escape from a state prison.|
518|Aiding and Abetting|4|Misdemeanor||40000|10||||||||96|active|Helping someone commit a crime.|
519|Accessory After the Fact|4|Felony||40000|10||||||||97|active|Helping someone avoid arrest after they have committed a crime.|
520|Misprision of Felony|4|Felony||15000|15||||||||98|active|Concealing or failing to report a felony committed by employees or associates on premises you own or control. Add 30 months and $30,000 if the accused is the business owner.|
521|Bribery of a Public Official|4|Felony||50000|20||||||||99|active|Offering value to an official to influence their conduct.|
522|Corruption|4|Felony||1500000|30||||||||100|active|Committing fraud, violating an official duty, or performing an official act that self-benefits.|
523|Malfeasance|4|Felony||50000|15||||||||101|active|The intentional neglect of official duties and the law.|
524|Impersonating a Peace Officer|4|Felony||150000|60||||||||102|active|Presenting yourself as police, EMS, or fire personnel.|
525|Impersonating a Government Official|4|Felony||150000|45||||||||103|active|Presenting yourself as a judge, attorney, or elected official.|
526|Theft of Government Property|4|Felony||75000|20||||||||104|active|Taking government property from a government building or vehicle.|
527|Attempted Murder of a Peace Officer|4|Felony|1|750000|30||||||||105|active|Attempting to kill or cause great bodily harm to a peace officer. (PERMA)|
528|Aggravated Battery of a Peace Officer|4|Felony|1|175000|30||||||||106|active|Inflicting bodily harm on a peace officer with a weapon.|
529|Murder of a State Official|4|Felony||1000000|30||||||||107|active|The intentional murder of a state official. (PERMA)|
530|Attempted Murder of a State Official|4|Felony|1|750000|30||||||||108|active|The attempted intentional murder of a state official. (PERMA)|
531|Battery of a State Official|4|Felony|1|125000|20||||||||109|active|Inflicting bodily harm on a state official without a weapon.|
532|Aggravated Battery of a State Official|4|Felony|1|225000|30||||||||110|active|Inflicting bodily harm on a state official with a weapon.|
533|Murder of a Police K-9|4|Felony|1|100000|25||||||||111|active|The intentional killing of a police service dog.|
534|Attempted Murder of a Police K-9|4|Felony|1|75000|15||||||||112|active|The intentional attempted killing of a police service dog.|
535|Unlawful Death of a Police K-9|4|Misdemeanor||18000|15||||||||113|active|Actions taken purposely or without malice that result in the death of a K-9.|
536|Terrorism|4|Felony||500000|60||||||||114|active|Violence intended to intimidate the public or coerce government.|
601|Brandishing a Firearm|5|Misdemeanor||15000|10||||||||115|active|Displaying a weapon in a threatening or intimidating manner.|
602|Unlawful Carry|5|Misdemeanor||20000|5|||1|||||116|active|Openly carrying a firearm, registered or not, in a public space.|
603|Carrying a Concealed Weapon|5|Felony||10000|10||||||||117|active|Carrying a firearm without a valid state permit.|
604|Possession of an Illegal Class 1 Firearm|5|Felony|1|25000|10|||1|||||118|active|Possessing an illegal Class 1 firearm or weapon.|
605|Possession of an Illegal Class 2 Firearm|5|Felony|1|125000|15|||1|||||119|active|Possessing an illegal Class 2 firearm or weapon.|
606|Possession of an Illegal Class 3 Firearm|5|Felony|1|200000|20|||1|||||120|active|Possessing an illegal Class 3 firearm or weapon.|
607|Possession of a Stolen Firearm|5|Felony||50000|20||||||||121|active|Holding a firearm you knew or should have known was stolen.|
608|Possession of a Firearm by a Felon|5|Felony||50000|10||||||||122|active|Holding any firearm while carrying a prior felony conviction.|
609|Possession of a Government-Issue Firearm|5|Felony||200000|10|||1|||||123|active|Possession of any firearm, including flashbangs, owned or issued by a government entity.|
610|Possession of Government-Issue Equipment|5|Misdemeanor||50000|10|||1|||||124|active|Possession of any government issued equipment, including but not limited to tasers, batons, bean bag shotguns, and spike strips.|
611|Illegal Firearm Modification|5|Felony||20000|15|||1|||||125|active|Modifying a firearm with a drum magazine or suppressor.|
612|Unlawful Discharge of a Firearm|5|Misdemeanor||30000|10|||1|||||126|active|Firing a weapon within city limits without lawful cause.|
613|Drive-By Shooting|5|Felony||80000|20||||||||127|active|Discharge of a firearm from a moving or stationary vehicle with intent to intimidate, harass, injure, or kill|
614|Possession of a Firearm in Commission of a Crime (Modifier)|5|Felony||30000|5||||1||||128|active|Possessing a firearm while committing a crime.|
615|Possession of a Firearm Alongside Illegal Substances (Modifier)|5|Felony||40000|10||||1||||129|active|Possessing a firearm together with illegal substances.|
616|Discharge of a Class 2 or 3 Firearm in Commission of a Crime (Modifier)|5|Felony||75000|10||||1||||130|active|Discharging a Class 2 or Class 3 firearm while committing a crime.|
617|Unlawful Use / Possession of Body Armor (MODIFIER)|5|Misdemeanor||25000|10|||1|1||||131|active|Wearing body armor while committing another offense.|
618|Unlicensed Distribution of Firearms|5|Felony||200000|15||||||||132|active|Selling or giving away firearms without a proper license or permit.|
619|Weapons Trafficking|5|Felony||350000|20|||1|||||133|active|Unlawful possession of 6 or more illegally possessed firearms.|
701|Speeding (1-15 Over)|6|Infraction||10000||||1|||||134|active|Exceeding the posted limit by up to 15.|
702|Speeding (16-30 Over)|6|Infraction||25000||||1|||||135|active|Exceeding the posted limit by 16 to 30.|
703|Speeding (31+ Over)|6|Infraction||45000||||1|||||136|active|Exceeding the posted limit by more than 30.|
704|Reckless Driving|6|Misdemeanor||70000|10|||1|||||137|active|Driving with willful disregard for the safety of others.|
|Street Racing|6|Misdemeanor||50000|15|||||||1|138|draft|Participating in an unsanctioned speed contest on public roads.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A147+1) instead of a number. Held as a draft until a code is assigned.
|Fleeing and Eluding (Vehicle)|6|Felony||30000|10|||||||1|139|draft|Fleeing from an officer while operating a vehicle. Bicycles are included.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A148+1) instead of a number. Held as a draft until a code is assigned.
|Driving Under the Influence|6|Misdemeanor||10000|10|||||||1|140|draft|Operating a vehicle while impaired by alcohol or drugs. FST, PBT, or BAC of 0.08% or greater can satisfy.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A149+1) instead of a number. Held as a draft until a code is assigned.
|Aggravated Driving Under the Influence|6|Felony||15000|20|||||||1|141|draft|Operating a vehicle while unusually intoxicated (over 60%). PBT can satisfy.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A150+1) instead of a number. Held as a draft until a code is assigned.
|Hit and Run (Property)|6|Misdemeanor||20000|5|||||||1|142|draft|Leaving the scene of a collision involving property damage.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A151+1) instead of a number. Held as a draft until a code is assigned.
|Hit and Run (Injury)|6|Felony||75000|15|||||||1|143|draft|Leaving the scene of a collision involving an injured person.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A152+1) instead of a number. Held as a draft until a code is assigned.
|Driving Without a License|6|Infraction||20000||||||||1|144|draft|Operating a vehicle without ever holding a valid license.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A153+1) instead of a number. Held as a draft until a code is assigned.
|Driving on a Suspended License|6|Misdemeanor||50000|10|||||||1|145|draft|Operating a vehicle while your license is suspended or revoked.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A154+1) instead of a number. Held as a draft until a code is assigned.
|Failure to Display Driver''s License|6|Infraction||40000||||||||1|146|draft|Failing to display a driver''s license when requested by an officer.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A155+1) instead of a number. Held as a draft until a code is assigned.
|No Registration / License Plate|6|Infraction||15000||||||||1|147|draft|Operating a vehicle without a valid registration or license plate.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A156+1) instead of a number. Held as a draft until a code is assigned.
|License Plate Violation|6|Infraction||20000||||||||1|148|draft|Operating with an SA Exempt plate or with another vehicle''s registration.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A157+1) instead of a number. Held as a draft until a code is assigned.
|Illegal Vehicle Modification|6|Infraction||5000||||||||1|149|draft|Operating a vehicle with prohibited lighting, plates, or equipment.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A158+1) instead of a number. Held as a draft until a code is assigned.
|Window Tint Violation|6|Infraction||10000||||||||1|150|draft|Use of dark smoke, limo, or black window tint on a vehicle.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A159+1) instead of a number. Held as a draft until a code is assigned.
|Unroadworthy Vehicle|6|Infraction||5000||||||||1|151|draft|Operating a vehicle in a condition unsafe for public roads.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A160+1) instead of a number. Held as a draft until a code is assigned.
|Failure to Display Headlights or Brake Lights|6|Infraction||8000||||1||||1|152|draft|Operating a vehicle without headlights or brake lights on.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A161+1) instead of a number. Held as a draft until a code is assigned.
|Failure to Obey a Traffic Control Device|6|Infraction||5000||||1||||1|153|draft|Not yielding at a red light, stop sign, or posted signal.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A162+1) instead of a number. Held as a draft until a code is assigned.
|Failure to Yield Right of Way|6|Infraction||5000||||1||||1|154|draft|Failing to yield the right of way or stop at a stop sign.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A163+1) instead of a number. Held as a draft until a code is assigned.
|Failure to Yield to an Emergency Vehicle|6|Misdemeanor||30000|5|||||||1|155|draft|Blocking or failing to yield to an emergency vehicle responding to a call.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A164+1) instead of a number. Held as a draft until a code is assigned.
|Failure to Obey a Traffic Officer|6|Infraction||15000||||||||1|156|draft|Ignoring directions given by an officer directing traffic.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A165+1) instead of a number. Held as a draft until a code is assigned.
|Unsafe Lane Change|6|Infraction||10000||||1||||1|157|draft|Changing lanes without signaling or checking clearance.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A166+1) instead of a number. Held as a draft until a code is assigned.
|Illegal Overtake|6|Infraction||10000||||1||||1|158|draft|Illegally passing another vehicle by shoulder or across a double yellow line.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A167+1) instead of a number. Held as a draft until a code is assigned.
|Driving Against Traffic|6|Infraction||15000||||1||||1|159|draft|Operating a vehicle on the wrong side of the roadway.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A168+1) instead of a number. Held as a draft until a code is assigned.
|Distracted Driving|6|Infraction||5000||||||||1|160|draft|Operating a vehicle while paying attention to anything other than the road.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A169+1) instead of a number. Held as a draft until a code is assigned.
|Excessive Use of Horn|6|Infraction||15000||||1||||1|161|draft|Honking the horn for any reason other than motor safety.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A170+1) instead of a number. Held as a draft until a code is assigned.
|Illegal Parking|6|Infraction||5000||||1||||1|162|draft|Parking in a prohibited, reserved, or obstructive location.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A171+1) instead of a number. Held as a draft until a code is assigned.
|Obstructing a Sidewalk or Crosswalk|6|Infraction||8000||||1||||1|163|draft|Intentionally stopping or parking on a sidewalk or crosswalk.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A172+1) instead of a number. Held as a draft until a code is assigned.
|Impeding Traffic|6|Misdemeanor||20000|5|||1||||1|164|draft|Obstructing the flow of vehicles on a roadway.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A173+1) instead of a number. Held as a draft until a code is assigned.
|Aggravated Impeding Traffic|6|Misdemeanor||40000|15|||||||1|165|draft|Obstructing the flow of vehicles on a roadway after being warned by law enforcement.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A174+1) instead of a number. Held as a draft until a code is assigned.
|Illegal Dumping|6|Felony||100000|15|||||||1|166|draft|Willingly placing a vehicle in the ocean wether to avoid capture.|Imported without a charge code: the source exported an unresolved spreadsheet formula (=A175+1) instead of a number. Held as a draft until a code is assigned.
801|Unlicensed Aircraft or Watercraft Operation|7|Felony||250000|15|||1|||||167|active|Operating a plane, helicopter, or boat without certification.|
802|Failure to Radio|7|Infraction||75000||||1|||||168|active|Failure to utilize radio 737 as a pilot actively flying.|
803|Reckless Flight|7|Felony||500000|15|||1|||||169|active|Operating a plane or helicopter in an unsafe manner that puts the public at risk.|
804|Flying in Restricted Airspace|7|Felony||1000000|15|||1|||||170|active|Flying or hovering over any government building or active emergency scene.|
805|Flying Below the Minimum Altitude|7|Misdemeanor||50000|20|||1|||||171|active|Aircraft shall not operate below 500ft unless landing or taking off.|
901|Third Degree Money Laundering|8|Misdemeanor||40000|10||||||||172|active|Possessing less than $50,000 of dirty money.|
902|Second Degree Money Laundering|8|Felony||75000|15||||||||173|active|Possessing between $50,000 and $299,999 of dirty money.|
903|First Degree Money Laundering|8|Felony||150000|20||||||||174|active|Possessing more than $300,000 of dirty money.|
1001|Animal Abuse|9|Felony||50000|10||||||||175|active|The act of physically abusing or neglecting an animal.|
1002|Hunting Without a Permit|9|Misdemeanor||15000|5||||||||176|active|Hunting wildlife without the proper permits or license.|
1003|Fishing Without a Permit|9|Misdemeanor||15000|5||||||||177|active|Fishing without the proper license or permit.|
1004|Hunting With a Vehicle|9|Misdemeanor||30000|10||||||||178|active|Using any vehicle to hunt or kill any wildlife.|
1005|Poaching|9|Misdemeanor||15000|25||||||||179|active|The illegal hunting or capturing of wildlife.|
1006|Illegal Hunting or Fishing Methods|9|Misdemeanor||10000|10||||||||180|active|Illegal methods, tactics, or equipment used for hunting or fishing.|
1007|Illegal Fire Placement|9|Misdemeanor||16000|10||||||||181|active|Illegally placing or setting fires in a natural area.|
1008|Possession of Illegal Trophies|9|Infraction||5000|||||||||182|active|Possessing animal or fish parts or products obtained, imported, or held in violation of wildlife laws.|
1101|Operating Without a CDL|10|Infraction||2500|||||||||183|active|Operating a commercial motor vehicle without a valid endorsement.|
1102|Operating Without a CDL, Second Offense|10|Infraction||5000|||||||||184|active|Operating a commercial motor vehicle without a valid endorsement (second offense).|
1103|Operating Without a CDL, Third Offense|10|Infraction||7500|||||||||185|active|Operating a commercial motor vehicle without a valid endorsement (third offense).|
1104|Failure to Maintain a Log Book|10|Infraction||5000|||||||||186|active|Not maintaining a log book while performing duties as a commercial vehicle driver.|
1105|Failure to Stop at Weigh Station / Inspection|10|Misdemeanor||20000|10||||||||187|active|Not stopping at an active and clearly operating weigh station when police are present.|
1106|Operating an Overweight Vehicle|10|Infraction||20000|||||||||188|active|Operating a commercial vehicle that is overweight.|
1107|Improper Safety Equipment|10|Misdemeanor||4000|10||||||||189|active|Operating a commercial vehicle with faulty brakes, tires, air systems, or similar equipment.|
1108|Failure to Secure Trailer Connection|10|Misdemeanor||3000|10||||||||190|active|Operating a vehicle with a trailer that is not properly connected.|
1109|Alcohol Inside a Commercial Vehicle|10|Misdemeanor||10000|||||||||191|active|Possessing alcohol inside a commercial vehicle''s driving quarters.|
1201|RICO Conspiracy (Modifier)|11|Felony||350000|||1||1|1|||192|active|An agreement between two or more people, as part of a criminal organization, to commit a crime.|
1202|RICO Murder (Modifier)|11|Felony||3000000|||1||1|1|||193|active|Unlawful killing of another person while acting as part of a criminal organization.|
1203|RICO Robbery (Modifier)|11|Felony||500000|||1||1|1|||194|active|Taking property by threat or force while acting as part of a criminal organization.|
1204|RICO Bribery (Modifier)|11|Felony||1500000|||1||1|1|||195|active|Paying or exchanging services to alter someone''s decisions while acting as part of a criminal organization.|
1205|RICO Trafficking (Modifier)|11|Felony||500000|||1||1|1|||196|active|Trafficking controlled substances while acting as part of a criminal organization.|
1206|RICO Kidnapping (Modifier)|11|Felony||75000|||1||1|1|||197|active|Taking and moving a person without consent while acting as part of a criminal organization.|';
  ln text; p text[];
begin
  select id into v from public.penal_code_versions
   where name = 'Odyssey RP Penal Code 2026' and status = 'draft';
  if v is not null then
    delete from public.penal_charges where version_id = v;
    delete from public.penal_substance_schedules where version_id = v;
    delete from public.penal_rules where version_id = v;
    delete from public.penal_limits where version_id = v;
  else
    insert into public.penal_code_versions (name, effective_date, source_file, change_summary, status)
    values ('Odyssey RP Penal Code 2026', date '2026-01-01',
            'ODY_PENAL_CODE_2026_ALL_SHEETS.md',
            'Full import of both worksheets: 197 charges across 12 titles, 3 controlled-substance schedules, and the court/plea/limit rules. 31 charges arrived without codes and are held as drafts.',
            'draft')
    returning id into v;
  end if;

  create temporary table _penal_titles (idx int primary key, name text) on commit drop;
  insert into _penal_titles (idx, name) values
    (0, 'TITLE 1 - OFFENSES AGAINST PERSONS'),
    (1, 'TITLE 2 - OFFENSES AGAINST PROPERTY'),
    (2, 'TITLE 3 - OFFENSES AGAINST PUBLIC ORDER'),
    (3, 'TITLE 4 - CONTROLLED SUBSTANCES'),
    (4, 'TITLE 5 - OFFENSES AGAINST PUBLIC JUSTICE'),
    (5, 'TITLE 6 - WEAPONS OFFENSES'),
    (6, 'TITLE 7 - VEHICLE AND TRAFFIC CODE'),
    (7, 'TITLE 8 - Aircraft and Airspace Regulation'),
    (8, 'TITLE 9 - MONEY LAUNDERING'),
    (9, 'TITLE 10 - WILDLIFE AND NATURAL RESOURCES'),
    (10, 'TITLE 11 - COMMERCIAL VEHICLE OFFENSES'),
    (11, 'TITLE 12 - RICO (PROSECUTOR OR JUDGE ONLY)');

  foreach ln in array string_to_array(payload, chr(10)) loop
    if btrim(ln) = '' then continue; end if;
    p := string_to_array(ln, '|');
    insert into public.penal_charges (
      version_id, code, offense, penal_title, charge_class, stackable,
      fine, jail_months, judge_set_fine, judge_set_jail, pd_exempt,
      is_modifier, is_rico, substance_schedule, needs_code, source_row,
      lifecycle, definition, special_notes)
    select v, nullif(p[1], ''), p[2],
           (select name from _penal_titles where idx = p[3]::int),
           p[4], p[5] = '1',
           nullif(p[6], '')::numeric, nullif(p[7], '')::numeric,
           p[8] = '1', p[9] = '1', p[10] = '1', p[11] = '1', p[12] = '1',
           nullif(p[13], '')::int, p[14] = '1', p[15]::int,
           p[16], nullif(p[17], ''), nullif(p[18], '');
  end loop;

  insert into public.penal_substance_schedules (version_id, schedule, substances) values
    (v, 1, 'Devils Letuce, MDMA, and PCP'),
    (v, 2, 'Cocaine, Methamphetamine, unprescribed pills.'),
    (v, 3, 'Fentanyl');

  insert into public.penal_limits (version_id, max_total_months, max_total_months_note)
  values (v, 200, 'Maximum total sentence is 200 months, unless set higher by a Judge or PD High Command.');

  insert into public.penal_rules (version_id, section, ordinal, heading, body) values
    (v, 'How this document works', 1, null, 'Every offense has a code number, a class, a fine, and a jail time in months.'),
    (v, 'How this document works', 2, null, 'Officers charge the code. Fines and time listed are the STANDARD sentence.'),
    (v, 'How this document works', 3, null, 'Officers may reduce the time during processing, but may not change the fine.'),
    (v, 'How this document works', 4, null, 'If an act is not written in this code, it is not a chargeable offense.'),
    (v, 'The three classes', 1, 'Infraction', 'Ticket only. Paid on scene, no arrest.'),
    (v, 'The three classes', 2, 'Misdemeanor', 'Arrestable. Can issue a ticket in place of jail time if you so desire.'),
    (v, 'The three classes', 3, 'Felony', 'Arrestable.'),
    (v, 'PD exempt', 1, null, 'A charge marked YES in the PD EXEMPT column does not apply to a peace officer who is acting within the scope of their duties at the time.'),
    (v, 'PD exempt', 2, null, 'The exemption covers on-duty police, EMS, and fire personnel only.'),
    (v, 'PD exempt', 3, null, 'Off duty, or acting outside their duties, an officer is charged the same as any civilian.'),
    (v, 'PD exempt', 4, null, 'An exemption is not a defense to Reckless Driving where the conduct was plainly unsafe.'),
    (v, 'Modifiers', 1, null, 'A charge marked (Modifier) cannot be charged on its own. It is added on top of another charge.'),
    (v, 'Modifiers', 2, null, 'A modifier may not be stacked on itself.'),
    (v, 'Modifiers', 3, null, 'RICO charges are modifiers and may only be added by a prosecuting attorney or judge.'),
    (v, 'Hard limits', 1, null, 'Maximum total sentence is 200 months, unless set higher by a Judge or PD High Command.'),
    (v, 'Hard limits', 2, null, 'No charge may be stacked twice for the same single act.'),
    (v, 'Hard limits', 3, null, 'Any charge listed as JUDGE must be set by a judge. If no judge is available, see the charge note.'),
    (v, 'Pleas', 1, null, 'Individuals may enter a plea of guilty or not guilty. Failure to give a plea is recorded as No Contest.'),
    (v, 'Pleas', 2, 'Guilty plea', 'Processed normally. Officers may offer reduced time at any point.'),
    (v, 'Pleas', 3, 'No contest', 'Same process as a guilty plea.'),
    (v, 'Court scheduling', 1, null, 'Court is held every Thursday, one hour after main tsunami (7PM EST).'),
    (v, 'Court scheduling', 2, null, 'Several cases occur each session.'),
    (v, 'Court scheduling', 3, null, 'If you miss your court date you may reschedule for the following Thursday.'),
    (v, 'Court scheduling', 4, null, 'Missing two Thursdays is treated as a breach of bail. A Failure to Appear warrant is issued.'),
    (v, 'Courtroom structure', 1, null, 'The courtroom consists of the Judge, the Defendant (and attorney if obtained), and the arresting officer if able.'),
    (v, 'Courtroom structure', 2, null, 'If the officer does not appear, the Judge rules on the evidence submitted in the police report.'),
    (v, 'Courtroom structure', 3, null, 'If the suspect is found not guilty on one charge, they are found not guilty on all charges.'),
    (v, 'Courtroom structure', 4, null, 'An officer failing to show does not mean the case is dropped. A police report that justifies the charges is sufficient.'),
    (v, 'If found not guilty', 1, null, 'The conviction and all associated charges are removed.'),
    (v, 'If found not guilty', 2, null, 'The appeal bond is refunded in full.'),
    (v, 'If found not guilty', 3, null, 'The defendant receives $25,000 for every 10 months served, paid from the Judicial Society Account.'),
    (v, 'If found guilty', 1, null, 'The conviction stands.'),
    (v, 'If found guilty', 2, null, 'The appeal bond is forfeited.'),
    (v, 'If found guilty', 3, null, 'No additional jail time or fines are imposed.'),
    (v, 'Failure to appear', 1, null, 'Failing to appear forfeits the appeal bond, and a warrant for Failure to Appear is issued.'),
    (v, 'Ankle monitors', 1, null, 'Ankle monitors are to be utilized by a judge only.');

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (null, 'PENAL_VERSION_IMPORTED', 'penal_code_versions', v,
          jsonb_build_object(
            'name', 'Odyssey RP Penal Code 2026',
            'source_file', 'ODY_PENAL_CODE_2026_ALL_SHEETS.md',
            'charges', (select count(*) from public.penal_charges where version_id = v),
            'needing_codes', (select count(*) from public.penal_charges where version_id = v and needs_code),
            'note', 'Imported as a draft by migration; publishing is a separate audited act.'));
end $import$;

-- ============================================================================
-- Rollback: delete the 'Odyssey RP Penal Code 2026' draft version; its
-- charges, schedules, rules and limits cascade. Nothing else references it
-- while it remains unpublished.
-- ============================================================================

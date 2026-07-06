/* penal.js — San Andreas Penal Code catalog + helpers (Titles 1–10). Reference
   data for attaching charges to cases (cases.charges jsonb = [{code,count}]).
   Classic script, shared global scope. Up-to-date 20/01/2026.
   Flags: stack = stackable (Ⓢ) · arrest = arrest required (**) · rico = RICO-eligible
   predicate (murder/kidnapping/robbery/extortion/arson/bribery/laundering/controlled-
   substance dealing) · modifier = enhances another charge, can't stand alone or stack.
   jail in months; null jail = JUDGE/Capital/special sentence. */
"use strict";

    const PENAL_CODE = [
      // Title 1 — Crimes Against the Person
      { code:'(1)01', title:'Assault, Simple', level:'Misdemeanor', jail:15, fine:8000, desc:'Putting another person in a state of belief that they are in immediate harm.' },
      { code:'(1)02', title:'Battery, Simple', level:'Misdemeanor', jail:20, fine:12000, arrest:true, desc:'Intentionally touching/inflicting bodily harm on another person.' },
      { code:'(1)03', title:'Aggravated Assault', level:'Felony', jail:20, fine:16000, stack:true, desc:'Immediate-harm belief with a weapon.' },
      { code:'(1)04', title:'Aggravated Battery', level:'Felony', jail:25, fine:16000, stack:true, desc:'Inflicting bodily harm on another person with a weapon.' },
      { code:'(1)05', title:'Murder, 1st Degree', level:'Felony', jail:150, fine:250000, stack:true, rico:true, desc:'Unlawful killing, willful and premeditated.' },
      { code:'(1)06', title:'Murder, 2nd Degree', level:'Felony', jail:90, fine:200000, stack:true, rico:true, desc:'Unlawful killing, willful but not premeditated.' },
      { code:'(1)07', title:'Voluntary Manslaughter', level:'Felony', jail:45, fine:100000, stack:true, desc:'Killing in sudden, violent, irresistible passion.' },
      { code:'(1)08', title:'Involuntary Manslaughter', level:'Felony', jail:30, fine:75000, stack:true, desc:'Accidental killing due to criminal negligence/recklessness.' },
      { code:'(1)09', title:'Attempted Murder', level:'Felony', jail:60, fine:110000, stack:true, rico:true, desc:'Intentionally attempting to kill or cause great bodily harm.' },
      { code:'(1)10', title:'Kidnapping', level:'Felony', jail:25, fine:30000, stack:true, rico:true, desc:'Taking and moving a person without consent.' },
      { code:'(1)11', title:'False Imprisonment', level:'Felony', jail:20, fine:20000, desc:'Restricting a person’s movement without justification.' },
      { code:'(1)12', title:'Conspiracy to Commit', level:'Misdemeanor', jail:30, fine:25000, desc:'Agreement among two+ to commit an illegal act.' },
      { code:'(1)13', title:'Wanton Endangerment', level:'Felony', jail:20, fine:15000, desc:'Conduct creating substantial risk of injury or death.' },
      { code:'(1)14', title:'Criminal Threats', level:'Misdemeanor', jail:15, fine:20000, desc:'Saying something to terrorize/threaten another.' },
      { code:'(1)15', title:'Stalking', level:'Felony', jail:10, fine:15000, desc:'Repeatedly following or harassing another person.' },
      // Title 2 — Crimes Against Property
      { code:'(2)01', title:'Vandalism', level:'Misdemeanor', jail:10, fine:8000, desc:'Deliberate destruction/damage to property.' },
      { code:'(2)02', title:'Destruction of Government Property', level:'Felony', jail:30, fine:50000, stack:true, desc:'Destroying government-owned property.' },
      { code:'(2)03', title:'Destruction of a Traffic Control Device', level:'Misdemeanor', jail:10, fine:10000, desc:'Destroying traffic lights/signs/devices.' },
      { code:'(2)04', title:'Littering', level:'Misdemeanor', jail:5, fine:1000, desc:'Throwing trash on the ground.' },
      { code:'(2)05', title:'Trespassing', level:'Misdemeanor', jail:15, fine:6000, desc:'Illegally entering property / trespassed location.' },
      { code:'(2)06', title:'Trespassing in a Restricted Area', level:'Felony', jail:20, fine:8000, desc:'Entering a restricted area in a government building.' },
      { code:'(2)07', title:'Burglary / Breaking and Entering', level:'Felony', jail:25, fine:20000, desc:'Unlawfully entering a building.' },
      { code:'(2)08', title:'Possession of Tools for the Commission of a Crime', level:'Misdemeanor', jail:15, fine:15000, desc:'Possession of burglary/crime tools.' },
      { code:'(2)09', title:'Receiving/Possession of Stolen Property (M)', level:'Misdemeanor', jail:15, fine:10000, desc:'Stolen property valued $949 or less.' },
      { code:'(2)10', title:'Receiving/Possession of Stolen Property (F)', level:'Felony', jail:25, fine:20000, desc:'Stolen property valued $950 or more.' },
      { code:'(2)11', title:'Grand Theft Auto', level:'Felony', jail:15, fine:16000, desc:'Taking an unoccupied vehicle without consent.' },
      { code:'(2)12', title:'Carjacking', level:'Felony', jail:25, fine:16000, desc:'Stealing an occupied vehicle.' },
      { code:'(2)13', title:'Possession of a Stolen Vehicle', level:'Felony', jail:15, fine:10000, desc:'Intentional possession of a stolen vehicle.' },
      { code:'(2)14', title:'Criminal Possession of Identification', level:'Felony', jail:10, fine:10000, desc:'Providing an ID/license not belonging to the person.' },
      { code:'(2)15', title:'Extortion', level:'Felony', jail:20, fine:20000, rico:true, desc:'Obtaining money/favors by threat, force, or blackmail.' },
      { code:'(2)16', title:'Robbery', level:'Felony', jail:20, fine:15000, rico:true, desc:'Taking property by threats or force.' },
      { code:'(2)17', title:'Aggravated Robbery', level:'Felony', jail:30, fine:20000, rico:true, desc:'Robbery using a deadly weapon.' },
      { code:'(2)18', title:'Petty Theft', level:'Misdemeanor', jail:10, fine:10000, desc:'Theft of property $1000 or less.' },
      { code:'(2)19', title:'Grand Larceny', level:'Felony', jail:20, fine:15000, desc:'Theft of property at/above $1000.' },
      { code:'(2)20', title:'Laundering', level:'Felony', jail:15, fine:15000, rico:true, desc:'Obtaining or possessing illegal money.' },
      { code:'(2)21', title:'Tampering with a Motor Vehicle', level:'Misdemeanor', jail:15, fine:16000, desc:'Altering/tampering with a vehicle without consent.' },
      { code:'(2)22', title:'Fraud', level:'Felony', jail:25, fine:25000, desc:'Criminal deception for financial/personal gain.' },
      { code:'(2)23', title:'Arson', level:'Felony', jail:15, fine:15000, rico:true, desc:'Willful and malicious burning of property/persons.' },
      { code:'(2)24', title:'Theft of Mail/Mailbox', level:'Felony', jail:15, fine:20000, desc:'Theft of mail/mailbox of personal or commercial entities.' },
      // Title 3 — Crimes Against Public Safety and Order
      { code:'(3)01', title:'Disorderly Conduct', level:'Misdemeanor', jail:10, fine:5000, desc:'Disruptive behavior in a public setting.' },
      { code:'(3)02', title:'Disturbing the Peace', level:'Infraction', jail:5, fine:6000, desc:'Causing a disruption in public by behavior/noise.' },
      { code:'(3)03', title:'Unlawful Assembly', level:'Misdemeanor', jail:15, fine:10000, desc:'Group intending deliberate disturbance/crime.' },
      { code:'(3)04', title:'Rioting', level:'Felony', jail:20, fine:16000, desc:'Group intending battery, theft, vandalism.' },
      { code:'(3)05', title:'Public Urination', level:'Misdemeanor', jail:5, fine:2000, desc:'Urinating in a public area.' },
      { code:'(3)06', title:'Loitering', level:'Misdemeanor', jail:10, fine:6000, desc:'Lingering/prowling on property without lawful business.' },
      { code:'(3)07', title:'Impersonating a Public Servant', level:'Felony', jail:30, fine:25000, desc:'Falsely pretending to hold a public-service position.' },
      { code:'(3)08', title:'Possession of an Explosive Device', level:'Felony', jail:60, fine:90000, desc:'Unregistered/illegally modified explosive.' },
      { code:'(3)09', title:'Attempted Use of an Explosive or Incendiary Device', level:'Felony', jail:75, fine:100000, desc:'Attempting to deploy/ignite an explosive device.' },
      { code:'(3)10', title:'Making a Bomb Threat', level:'Felony', jail:45, fine:75000, desc:'False statement/threat indicating a bomb is present.' },
      { code:'(3)11', title:'Possession of Explosive Materials with Intent to Distribute', level:'Felony', jail:50, fine:85000, desc:'Multiple devices/components suggesting intent to sell/arm.' },
      { code:'(3)12', title:'Terrorism', level:'Capital', jail:null, fine:500000, desc:'Act of mass violence/destruction to cause widespread fear (sentence: JUDGE).' },
      { code:'(3)13', title:'Breach of the Safe Haven Protection Act', level:'Capital', jail:null, fine:400000, desc:'Knowingly breaching the Safe Haven Protection Act (sentence: JUDGE).' },
      // Title 4 — Crimes Against Justice
      { code:'(4)01', title:'Murder of a Peace Officer', level:'Felony', jail:180, fine:300000, stack:true, rico:true, desc:'Intentional killing of a peace officer.' },
      { code:'(4)02', title:'Attempted Murder of a Peace Officer', level:'Felony', jail:60, fine:110000, stack:true, rico:true, desc:'Attempting to kill/gravely harm a peace officer.' },
      { code:'(4)03', title:'Battery of a Peace Officer', level:'Felony', jail:30, fine:20000, stack:true, desc:'Inflicting bodily harm on a peace officer, no weapon.' },
      { code:'(4)04', title:'Aggravated Battery of a Peace Officer', level:'Felony', jail:45, fine:40000, stack:true, desc:'Inflicting bodily harm on a peace officer with a weapon.' },
      { code:'(4)05', title:'Fleeing and Eluding, Felony', level:'Felony', jail:30, fine:30000, stack:true, desc:'Vehicle flight from LE exceeding 20 MPH over the limit.' },
      { code:'(4)06', title:'Fleeing or Eluding, Misdemeanor', level:'Misdemeanor', jail:15, fine:20000, arrest:true, desc:'Flight on foot / under 3 minutes.' },
      { code:'(4)07', title:'Resisting Arrest', level:'Misdemeanor', jail:15, fine:15000, desc:'Actively resisting detainment or arrest.' },
      { code:'(4)08', title:'Escaping Custody', level:'Felony', jail:30, fine:20000, desc:'Leaving a cell/LE vehicle/facility while in custody.' },
      { code:'(4)09', title:'Obstruction of Justice', level:'Felony', jail:20, fine:15000, desc:'Interfering with an investigation/peace officer.' },
      { code:'(4)10', title:'Interfering with a Peace Officer', level:'Felony', jail:15, fine:16000, desc:'Interfering with an officer performing duties.' },
      { code:'(4)11', title:'Aiding or Abetting', level:'Felony', jail:25, fine:20000, desc:'Helping/inciting during the commission of a crime.' },
      { code:'(4)12', title:'Accessory After the Fact', level:'Felony', jail:15, fine:10000, desc:'Helping a person avoid arrest after a crime.' },
      { code:'(4)13', title:'Bribery', level:'Felony', jail:15, fine:10000, rico:true, desc:'Paying/exchanging services to alter decisions.' },
      { code:'(4)14', title:'Failure to Obey a Lawful Command', level:'Misdemeanor', jail:15, fine:10000, desc:'Going against a lawful order of a peace officer.' },
      { code:'(4)15', title:'Misuse of a 911 Hotline', level:'Misdemeanor', jail:15, fine:10000, desc:'Misusing 911 / calls without actual reason.' },
      { code:'(4)16', title:'Failure to Identify', level:'Misdemeanor', jail:10, fine:10000, desc:'Failing to provide identifying info when requested.' },
      { code:'(4)17', title:'Providing False Information', level:'Misdemeanor', jail:10, fine:10000, arrest:true, desc:'Knowingly lying to a peace officer.' },
      { code:'(4)18', title:'Failure to Yield to an Emergency Vehicle', level:'Misdemeanor', jail:15, fine:10000, desc:'Blocking/failing to yield to an emergency vehicle.' },
      { code:'(4)19', title:'Filing a False Report', level:'Misdemeanor', jail:20, fine:16000, desc:'False report/complaint against another person.' },
      { code:'(4)20', title:'Evidence Tampering', level:'Felony', jail:20, fine:16000, desc:'Moving, destroying, or concealing evidence.' },
      { code:'(4)21', title:'Malfeasance', level:'Felony', jail:45, fine:50000, desc:'Intentional neglect of duties and the law.' },
      { code:'(4)22', title:'Theft of Government Property', level:'Felony', jail:20, fine:20000, desc:'Taking government property from a structure/vehicle.' },
      { code:'(4)23', title:'Contempt of Court', level:'Misdemeanor', jail:null, fine:10000, stack:true, desc:'Being disruptive or disrespectful in court (sentence: JUDGE).' },
      { code:'(4)24', title:'Perjury', level:'Felony', jail:null, fine:50000, desc:'Providing false information / lying while under oath (sentence: JUDGE).' },
      { code:'(4)25', title:'Failure to Appear', level:'Felony', jail:25, fine:20000, desc:'Willfully failing to appear at a required court date.' },
      { code:'(4)26', title:'Murder of a Police K-9', level:'Felony', jail:60, fine:40000, stack:true, desc:'Intentional killing of a Police K-9.' },
      { code:'(4)27', title:'Attempted Murder of a Police K-9', level:'Felony', jail:40, fine:24000, stack:true, desc:'Attempting to kill or gravely harm a Police K-9.' },
      { code:'(4)28', title:'Unlawful Death of a Police K-9', level:'Misdemeanor', jail:30, fine:18000, desc:'Actions resulting in the death of a K-9, with or without malice.' },
      { code:'(4)29', title:'Murder of a State Official', level:'Felony', jail:180, fine:300000, stack:true, rico:true, desc:'Intentional killing of a State Official.' },
      { code:'(4)30', title:'Attempted Murder of a State Official', level:'Felony', jail:60, fine:120000, stack:true, rico:true, desc:'Attempting to kill or gravely harm a State Official.' },
      { code:'(4)31', title:'Battery of a State Official', level:'Felony', jail:30, fine:75000, stack:true, desc:'Inflicting bodily harm on a State Official, no weapon.' },
      { code:'(4)32', title:'Aggravated Battery of a State Official', level:'Felony', jail:45, fine:90000, stack:true, desc:'Inflicting bodily harm on a State Official with a weapon.' },
      { code:'(4)33', title:'Assisting or Instigating Escape', level:'Felony', jail:30, fine:20000, desc:'Assisting/instigating an escape from lawful custody.' },
      { code:'(4)34', title:'Corruption', level:'Felony', jail:60, fine:200000, desc:'Being influenced to commit fraud or violate official duty as an authority.' },
      { code:'(4)35', title:'Prison Break', level:'Felony', jail:null, fine:100000, desc:'Unlawfully escaping/attempting to escape a correctional facility (sentence: MAX ORIGINAL TIME); aiders face the same.' },
      { code:'(4)36', title:'Misprision of Felony', level:'Felony', jail:15, fine:15000, desc:'Concealing/failing to report a felony on premises you control (+30mo & $30k if business owner).' },
      // Title 5 — Crimes Committed with Firearms, Deadly Weapons, or Enhancements
      { code:'(5)01', title:'Brandishing a Firearm', level:'Misdemeanor', jail:10, fine:14000, arrest:true, desc:'Aiming/waving a firearm in a reckless manner.' },
      { code:'(5)02', title:'Unlawful Discharge of a Firearm', level:'Felony', jail:20, fine:18000, desc:'Discharging a firearm recklessly, risking serious injury or death.' },
      { code:'(5)03', title:'Felon in Possession of a Firearm and/or Ammunition', level:'Felony', jail:10, fine:16000, desc:'A convicted felon possessing a firearm and/or ammunition.' },
      { code:'(5)04', title:'Possession of a Firearm in the Commission of a Crime (Modifier)', level:'Felony', jail:10, fine:12000, modifier:true, desc:'Committing a crime with a firearm in your possession.' },
      { code:'(5)05', title:'Possession of a Firearm Alongside Illegal Substances (Modifier)', level:'Felony', jail:15, fine:20000, modifier:true, arrest:true, desc:'Possessing a firearm with illegal substances.' },
      { code:'(5)06', title:'Unlicensed Distribution of Firearms', level:'Felony', jail:15, fine:14000, desc:'Selling/giving away firearms without a license.' },
      { code:'(5)07', title:'Wearing Body Armor in the Commission of a Crime (Modifier)', level:'Felony', jail:20, fine:10000, modifier:true, desc:'Wearing body armor while committing a crime.' },
      { code:'(5)08', title:'Possession of an Illegal Firearm (Class 1)', level:'Felony', jail:20, fine:20000, stack:true, desc:'Possessing an illegal Class 1 firearm/weapon.' },
      { code:'(5)09', title:'Possession of an Illegal Firearm (Class 2)', level:'Felony', jail:30, fine:70000, stack:true, desc:'Possessing an illegal Class 2 firearm/weapon.' },
      { code:'(5)10', title:'Possession of an Illegal Firearm (Class 3)', level:'Felony', jail:40, fine:100000, stack:true, desc:'Possessing an illegal Class 3 firearm/weapon.' },
      { code:'(5)11', title:'Distribution of Illegal Weapons', level:'Felony', jail:80, fine:150000, desc:'Selling/giving away illegal weapons.' },
      { code:'(5)12', title:'Unlawful Possession of a Firearm', level:'Felony', jail:15, fine:15000, desc:'Carrying a firearm without an active license/permit (non-felon).' },
      { code:'(5)13', title:'Illegal Firearm Modification', level:'Felony', jail:15, fine:10000, desc:'Illegally modifying a firearm with a drum magazine or suppressor.' },
      { code:'(5)14', title:'Discharge of a Class 2 or Class 3 Firearm in the Commission of a Crime (Modifier)', level:'Felony', jail:10, fine:20000, modifier:true, desc:'Discharging a Class 2/3 firearm while committing a crime.' },
      { code:'(5)15', title:'Unlawful Carry', level:'Misdemeanor', jail:0, fine:10000, desc:'Openly carrying a firearm, registered or not, in public.' },
      // Title 6 — Crimes Against Public Health
      { code:'(6)01', title:'Possession of a Controlled Substance [Schedule I]', level:'Felony', jail:20, fine:20000, desc:'Possessing a Schedule I controlled substance or materials to make it.' },
      { code:'(6)02', title:'Possession of a Controlled Substance [Schedule II]', level:'Felony', jail:30, fine:50000, desc:'Possessing a Schedule II controlled substance or materials to make it.' },
      { code:'(6)03', title:'Possession of a Controlled Substance with Intent to Sell (Modifier)', level:'Felony', jail:30, fine:75000, modifier:true, arrest:true, rico:true, desc:'Possessing a controlled substance packaged for distribution.' },
      { code:'(6)04', title:'Distribution of a Controlled Substance', level:'Felony', jail:30, fine:60000, rico:true, desc:'Selling a controlled substance to another person.' },
      { code:'(6)05', title:'Possession of Drug Paraphernalia', level:'Misdemeanor', jail:15, fine:10000, desc:'Possessing items used to sniff, smoke, or inject drugs.' },
      { code:'(6)06', title:'Manufacturing a Controlled Substance', level:'Felony', jail:30, fine:25000, desc:'Making a controlled substance.' },
      { code:'(6)07', title:'Criminal Possession of Marijuana', level:'Misdemeanor', jail:10, fine:10000, desc:'Over 4oz unrolled or 10 joints in public / off your property.' },
      { code:'(6)08', title:'Under the Influence of Narcotics', level:'Misdemeanor', jail:10, fine:5000, arrest:true, desc:'Being in public under the influence of a narcotic.' },
      { code:'(6)09', title:'Underage Possession of Alcohol', level:'Misdemeanor', jail:10, fine:4000, desc:'Possessing alcohol under the legal age (21).' },
      { code:'(6)10', title:'Public Intoxication', level:'Misdemeanor', jail:10, fine:10000, arrest:true, desc:'Being in public under the influence of alcohol.' },
      { code:'(6)11', title:'Trafficking Narcotics, First Degree', level:'Felony', jail:45, fine:50000, rico:true, desc:'Transporting 16oz (448g)+ of any controlled substance incl. marijuana.' },
      { code:'(6)12', title:'Trafficking Narcotics, Second Degree', level:'Felony', jail:30, fine:40000, rico:true, desc:'Transporting 4oz–16oz of any controlled substance excl. marijuana.' },
      { code:'(6)13', title:'Unlawful Production of Distilled Spirits', level:'Felony', jail:20, fine:15000, desc:'Unlicensed production of distilled spirits (moonshine).' },
      { code:'(6)14', title:'Unlicensed Distribution of Distilled Spirits', level:'Misdemeanor', jail:25, fine:20000, arrest:true, desc:'Unlicensed sale of distilled spirits (moonshine).' },
      // Title 7 — Crimes Against Natural Resources and Wildlife
      { code:'(7)01', title:'Animal Abuse', level:'Felony', jail:30, fine:20000, stack:true, desc:'Physically abusing or neglecting an animal.' },
      { code:'(7)02', title:'Hunting without a Permit', level:'Misdemeanor', jail:10, fine:10000, desc:'Hunting wildlife without proper credentials.' },
      { code:'(7)03', title:'Fishing without a Permit', level:'Misdemeanor', jail:15, fine:10000, desc:'Fishing without proper credentials.' },
      { code:'(7)04', title:'Poaching', level:'Misdemeanor', jail:25, fine:15000, desc:'Illegal hunting/capturing of wildlife.' },
      { code:'(7)05', title:'Illegal Hunting/Fishing Methods', level:'Misdemeanor', jail:10, fine:10000, desc:'Illegal methods/equipment used for hunting or fishing.' },
      { code:'(7)06', title:'Illegal Fire Placement', level:'Misdemeanor', jail:10, fine:16000, desc:'Illegally placing/setting fires in a natural area.' },
      { code:'(7)07', title:'Possession of Illegal Trophies', level:'Infraction', jail:0, fine:2000, desc:'Possessing animal parts/products obtained in violation of wildlife laws.' },
      // Title 8 — Crimes Relating to Commercial Vehicles
      { code:'(8)01', title:'Failure to Keep/Maintain Log Book', level:'Infraction', jail:0, fine:1500, desc:'Commercial driver failing to keep/maintain a log book.' },
      { code:'(8)02', title:'Failure to Stop at Weigh Station/Inspection', level:'Misdemeanor', jail:10, fine:2000, desc:'Passing an active weigh station.' },
      { code:'(8)03', title:'Improper Safety Equipment', level:'Misdemeanor', jail:10, fine:4000, desc:'Operating a commercial vehicle with improper safety equipment.' },
      { code:'(8)04', title:'Operating an Overweight Vehicle', level:'Misdemeanor', jail:10, fine:3000, desc:'Operating an overweight commercial vehicle.' },
      { code:'(8)05', title:'Failure to Ensure Connection of Trailer', level:'Misdemeanor', jail:10, fine:3000, desc:'Operating with an improperly connected trailer.' },
      { code:'(8)06', title:'Possession of Alcohol Inside of a Commercial Vehicle', level:'Misdemeanor', jail:10, fine:8000, desc:'Unlawful possession of alcohol while in/operating a commercial vehicle.' },
      // Title 9 — Crimes and Offenses Related to Traffic
      { code:'(9)01', title:'Driving without a License', level:'Misdemeanor', jail:10, fine:4000, desc:'Operating a motor vehicle without an active DL.' },
      { code:'(9)02', title:'Driving with a Suspended or Revoked License', level:'Misdemeanor', jail:15, fine:10000, desc:'Operating a motor vehicle with a suspended/revoked DL.' },
      { code:'(9)03', title:'Operating a Motor Vehicle without Proper Reg/Insurance', level:'Infraction', jail:0, fine:15000, desc:'Operating without valid registration and/or insurance.' },
      { code:'(9)04', title:'Failure to Display License Plate', level:'Infraction', jail:0, fine:10000, desc:'Operating without a plate or with the plate obstructed.' },
      { code:'(9)05', title:'License Plate Violation', level:'Infraction', jail:0, fine:10000, desc:'Operating with an SA Exempt plate or another vehicle’s registration.' },
      { code:'(9)06', title:'Speeding, 1st Degree', level:'Misdemeanor', jail:0, fine:10000, desc:'Operating 51–99 MPH over the posted limit.' },
      { code:'(9)07', title:'Speeding, 2nd Degree', level:'Infraction', jail:0, fine:7000, desc:'Operating 26–50 MPH over the posted limit.' },
      { code:'(9)08', title:'Speeding, 3rd Degree', level:'Infraction', jail:0, fine:5000, desc:'Operating 1–25 MPH over the posted limit.' },
      { code:'(9)09', title:'Felony Speeding', level:'Felony', jail:15, fine:15000, desc:'Operating 100+ MPH over the posted limit.' },
      { code:'(9)10', title:'Window Tint Violation', level:'Infraction', jail:0, fine:1000, desc:'Dark smoke/limo/black window tint on a vehicle.' },
      { code:'(9)11', title:'Failure to Display Headlights/Brake Lights', level:'Infraction', jail:0, fine:1000, desc:'Operating without headlights or brake lights on.' },
      { code:'(9)12', title:'Failure to Maintain Lanes', level:'Infraction', jail:0, fine:2000, desc:'Failing to stay in lane or changing lanes recklessly.' },
      { code:'(9)13', title:'Reckless Driving', level:'Felony', jail:15, fine:15000, arrest:true, desc:'Operating with total disregard for public safety.' },
      { code:'(9)14', title:'Distracted Driving', level:'Infraction', jail:0, fine:2000, desc:'Operating while paying attention to things other than the road.' },
      { code:'(9)15', title:'Excessive Use of Horn', level:'Infraction', jail:0, fine:1000, desc:'Honking for reasons other than motor safety.' },
      { code:'(9)16', title:'Parking Violation', level:'Infraction', jail:0, fine:1000, desc:'Parking in an unauthorized area.' },
      { code:'(9)17', title:'Illegal Overtake', level:'Infraction', jail:0, fine:2000, desc:'Illegally passing via shoulder or crossing a double yellow.' },
      { code:'(9)18', title:'Obstructing a Roadway', level:'Misdemeanor', jail:5, fine:4000, desc:'Obstructing/impeding traffic on foot or by vehicle.' },
      { code:'(9)19', title:'Obstructing a Sidewalk/Crosswalk', level:'Infraction', jail:0, fine:1000, desc:'Stopping/parking on a sidewalk or crosswalk.' },
      { code:'(9)20', title:'Failure to Yield Right of Way/Stop Sign', level:'Infraction', jail:0, fine:2000, desc:'Failing to yield right of way or stop at stop signs.' },
      { code:'(9)21', title:'Hit and Run, 1st Degree', level:'Felony', jail:10, fine:10000, desc:'Striking another and leaving the scene, causing death/serious injury.' },
      { code:'(9)22', title:'Hit and Run, 2nd Degree', level:'Misdemeanor', jail:5, fine:3000, desc:'Striking another vehicle/person and leaving the scene.' },
      { code:'(9)23', title:'Driving Under the Influence [DUI]', level:'Misdemeanor', jail:10, fine:6000, arrest:true, desc:'Operating under the influence (over 35%); FST/PBT or BaC ≥0.08% satisfies.' },
      { code:'(9)24', title:'Aggravated Driving Under the Influence', level:'Felony', jail:20, fine:10000, desc:'Operating while unusually intoxicated (over 60%); PBT satisfies.' },
      { code:'(9)25', title:'Failure to Obey a Traffic Control Device', level:'Infraction', jail:0, fine:2000, desc:'Failing to follow a construction/LE sign or traffic light.' },
      { code:'(9)26', title:'Failure to Display Drivers License', level:'Infraction', jail:0, fine:2000, desc:'Failing to display DL when requested by an officer.' },
      // Title 10 — Racketeering Influenced Corrupt Organizations (RICO). Modifiers added
      // only by a prosecuting attorney; apply to organized criminal activity (2+ persons).
      { code:'(10)01', title:'RICO Conspiracy (Modifier)', level:'Capital', jail:null, fine:150000, modifier:true, rico:true, desc:'Organized agreement to commit an illegal act (sentence: JUDGE).' },
      { code:'(10)02', title:'RICO Murder (Modifier)', level:'Capital', jail:null, fine:500000, modifier:true, rico:true, desc:'Unlawful killing as part of a criminal organization (sentence: JUDGE).' },
      { code:'(10)03', title:'RICO Robbery (Modifier)', level:'Capital', jail:null, fine:100000, modifier:true, rico:true, desc:'Taking property by force as part of a criminal organization (sentence: JUDGE).' },
      { code:'(10)04', title:'RICO Bribery (Modifier)', level:'Capital', jail:null, fine:75000, modifier:true, rico:true, desc:'Bribery as part of a criminal organization (sentence: JUDGE).' },
      { code:'(10)05', title:'RICO Trafficking (Modifier)', level:'Capital', jail:null, fine:80000, modifier:true, rico:true, desc:'Trafficking 16oz+ as part of a criminal organization (sentence: JUDGE).' },
      { code:'(10)06', title:'RICO Kidnapping (Modifier)', level:'Capital', jail:null, fine:50000, modifier:true, rico:true, desc:'Kidnapping as part of a criminal organization (sentence: JUDGE).' },
    ];

    const PENAL_BY_CODE = {}; PENAL_CODE.forEach((c) => { PENAL_BY_CODE[c.code] = c; });
    const penalByCode = (code) => PENAL_BY_CODE[code] || null;
    const PENAL_LEVEL_TINT = {
      Felony: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
      Misdemeanor: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
      Infraction: 'text-slate-300 bg-white/5 border-white/10',
      Capital: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20',
    };
    // Sentence formatting — months → "Xy Ym", or JUDGE for capital/null.
    function penalSentence(months) {
      if (months == null) return 'JUDGE';
      const y = Math.floor(months / 12), m = months % 12;
      return (y ? y + 'y ' : '') + (m || !y ? m + 'mo' : '').trim() || '0mo';
    }
    // Sum a case's charges ([{code,count}]) → { months, fine, judge }.
    function penalTotals(charges) {
      let months = 0, fine = 0, judge = false;
      (charges || []).forEach((ch) => {
        const c = penalByCode(ch.code); if (!c) return;
        const n = Math.max(1, ch.count || 1);
        if (c.jail == null) judge = true; else months += c.jail * n;
        if (c.fine != null) fine += c.fine * n;
      });
      return { months, fine, judge };
    }
    const penalSearch = (q) => {
      q = String(q || '').trim().toLowerCase();
      if (!q) return PENAL_CODE;
      return PENAL_CODE.filter((c) => (c.code + ' ' + c.title + ' ' + c.level + ' ' + (c.desc || '')).toLowerCase().includes(q));
    };
    // Recommend charges by keyword overlap between case text and each charge's
    // title+description. Returns the top scored matches (codes only).
    function penalRecommend(text, limit) {
      const hay = String(text || '').toLowerCase();
      if (hay.trim().length < 3) return [];
      const STOP = new Set(['the','and','for','with','was','were','that','this','from','have','has','are','his','her','him','them','they','you','your','any','all','out','not','but','who','how','one','two','about','into','than','then','when','what','will','would','could','their','there','been','being','also','such','each','some']);
      const scored = PENAL_CODE.map((c) => {
        const terms = (c.title + ' ' + (c.desc || '')).toLowerCase().match(/[a-z]{3,}/g) || [];
        let score = 0; const seen = new Set();
        terms.forEach((t) => { if (STOP.has(t) || seen.has(t)) return; seen.add(t); if (hay.includes(t)) score += (t.length > 5 ? 2 : 1); });
        return { code: c.code, score };
      }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score);
      return scored.slice(0, limit || 6).map((x) => x.code);
    }

    /* ---- Penal Code reference view (Reference tab) ---------------------------
       Read-only searchable statute catalog for every role; same PENAL_CODE data
       the charge picker uses, so the two can never drift apart. */
    function renderPenalView() {
      const list = $('#penal-list'); if (!list) return;
      const q = ($('#penal-search') ? $('#penal-search').value : '').trim();
      const rows = penalSearch(q);
      const cnt = $('#penal-count'); if (cnt) cnt.textContent = rows.length + ' / ' + PENAL_CODE.length + ' STATUTES';
      list.innerHTML = rows.length ? rows.map((c) => `
        <div class="evidence-card rounded-xl border border-white/10 bg-ink-900 px-4 py-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-slate-200"><span class="font-mono font-semibold text-blue-300">${esc(c.code)}</span> ${esc(c.title)}${c.rico ? ' <span class="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300">RICO</span>' : ''}</p>
            <p class="t-readout text-[11px] text-slate-400"><span class="rounded border px-1.5 py-0.5 ${PENAL_LEVEL_TINT[c.level] || ''}">${esc(c.level)}</span> ${penalSentence(c.jail)}${c.fine != null ? ' · ' + fmtUSD(c.fine) : ''}</p>
          </div>
          ${c.desc ? `<p class="mt-1 text-xs text-slate-500">${esc(c.desc)}</p>` : ''}
        </div>`).join('') : '<p class="t-readout p-6 text-center text-sm text-slate-500">NO STATUTE MATCH // REFINE SEARCH.</p>';
    }
    function onEnterPenal() {
      renderPenalView();
      const se = $('#penal-search');
      if (se && !se.dataset.wired) { se.dataset.wired = '1'; se.addEventListener('input', (typeof debounce === 'function' ? debounce(renderPenalView, 120) : renderPenalView)); }
    }

/* penal.js — San Andreas Penal Code catalog + helpers (Titles 1–4). Reference
   data for attaching charges to cases (cases.charges jsonb = [{code,count}]).
   Classic script, shared global scope. Up-to-date 20/01/2026.
   Flags: stack = stackable (Ⓢ) · arrest = arrest required (**) · rico = RICO-eligible
   predicate (murder/kidnapping/robbery/extortion/arson/bribery/laundering). jail in
   months; null jail = JUDGE/Capital sentence. */
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
      { code:'(4)23', title:'Contempt of Court', level:'Misdemeanor', jail:null, fine:null, stack:true, desc:'Being disruptive or disrespectful in court.' },
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

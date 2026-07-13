# CID Portal — New User Guide

Welcome to the **CID Portal**, the live case-management system for the San Andreas Criminal Investigation Division. This guide walks a first-time member from signing in to running their first case.

---

## Introduction

The CID Portal is a private, real-time investigation workspace. Everything in it is **live and shared**: when another detective updates a case, adds a suspect, or posts an announcement, your screen updates within seconds — no refresh needed. The portal covers the full life of an investigation:

- **Cases** — the central record: evidence, reports, tasks, charges, sign-off and court packets.
- **Intelligence** — the people, gangs, vehicles, places and networks behind those cases.
- **Command** — dashboards, announcements, roster, heatmaps and approvals for leadership.
- **Reference** — the Penal Code, division SOPs, and this guide (Reference → User Guide).
- **Oversight** — your personal desk, the division calendar, weekly shift reports and the audit log.

What you can see and change depends on your **role and bureau** — the server enforces this, so you'll simply never see records that aren't yours to see.

---

## Getting Started

### Signing in

1. Open the portal. You'll land on the **CID Portal — Secure Access** screen.
2. Pick one of three ways in:
   - Click **Continue with Discord** (most members use this),
   - Click **Continue with Google**, or
   - Type your email and click **Email link** — you'll get a one-time sign-in link in your inbox ("Magic link sent — check your inbox.").
> **Denied access?** If Command has denied your login you'll see an **Access denied** screen with the reason instead of the request form — contact Command if you think it's a mistake. Command can deny or restore a person's access from **Manage Officer → Danger zone**.

3. First time here? After signing in you'll be asked **which role you're applying for** — **CID**, **DOJ**, or **Judiciary**. Your choice only decides which application form you see; it never grants access. Pick **CID** for detective work, **DOJ** for prosecutor roles (Assistant District Attorney, District Attorney, Attorney General), or **Judiciary** for Judge.
   - **CID applicants** fill in display name, badge number, your **one permanent department** (Los Santos, Blaine County or State Bureau — JTF is joint-case-only, not a home department), the CID role you're requesting (Detective or Senior Detective), and a short reason — then **Submit Request**. Command reviews it.
   - **DOJ / Judiciary applicants** fill in display name, an optional **Badge / Bar / Court identifier**, the justice role, and a reason — then **Submit Request**. A District Attorney, Attorney General, or the project owner reviews it (a Judge or Attorney General request needs owner approval). There is no CID bureau to choose.
   In every case the reviewer can approve as-is, approve with a different role, send it back for a correction (you'll see their note, edit, and resubmit), or reject it. You stay locked out until a request is approved; once it is, reload and you're in. Justice-only members land in the **Justice portal**; CID members get the full CID portal.

### Legal requests — warrants and subpoenas

CID members file legal requests from the **Legal Requests** tab (under Cases):

1. **File Warrant Request** or **File Subpoena** (or, on a finalized arrest-warrant report, click **Submit for Legal Review**). Pick the case, the suspect/recipient from the Persons registry (warrants and player subpoenas) or type a business/entity name, fill the justification, and — for subpoenas — the type-specific fields.
2. On the draft's **Packet** tab, add the supporting items the reviewers should see (evidence, attachments, finalized reports, media, links). Reviewers see **only** what you select — never the whole case.
3. **Submit for CID review.** A **packet preview** opens first: a requirements checklist, your selected items cross-checked against their live sources (anything missing or not yet finalized is flagged), and a reminder that reviewers receive **only the packet** — never access to the rest of the case. Confirm to submit; a supervisor then approves it (and it routes automatically to the bureau's DOJ prosecutor) or returns it for revision.
4. From there it moves through the DOJ (**ADA → DA/AG or Judge**) and, for warrants, always a **Judge**. You'll get notifications at each step and can watch progress on the request's **Review History** tab.
5. Once approved, an authorized CID officer records **issue**, then **execution/return** (warrants) or **service/compliance** (subpoenas) on the **Fulfilment** tab. Materials received under a subpoena are logged back to the case as evidence/attachments.

> **Never lose work:** the warrant/subpoena forms keep a draft on this device as you type. If your browser closes mid-edit, reopening the form shows a **Restore draft** banner (only when your device copy is newer than what's already saved) — restore or discard it; it clears itself when you save or submit. You can also find any request again from the global search box — type its request number or title (sealed requests stay hidden from anyone not involved).

DOJ and Judge members work their queues in the **Justice portal**: prosecutors review the immutable packet, add notes, return to CID, or advance the request; Judges review the exact submitted version and approve, deny, or return it. Sealed requests are visible only to the people directly involved.

### First five minutes after approval

- Click your **name card** at the bottom of the left sidebar (or your name in the top bar) to open **My Profile** — set your display name, badge number and avatar, link Discord for DMs, and review your account. Your work is attributed by your display name and badge.
- The **Appearance** control opens the same page's Appearance tab — pick your accent color and compact/comfortable density (saved on this device).
- Open **My Desk** (Oversight section) — this is your personal to-do view and the best page to start every session on.

---

## Main Interface Navigation

### The left sidebar (desktop)

The sidebar groups all 29 screens into **5 categories**:

| Category | What's inside |
|---|---|
| **Command** | Dashboard, Analytics, Announcements, Heatmap, Roster & Commendations |
| **Cases** | Case Files, Operations, Attachments, RICO |
| **Intelligence** | Persons, BOLO Board, Gangs, Places, Vehicles, Indicators, Network, Narcotics, Ballistics, M.O. Detector, Media Vault, Records |
| **Reference** | Penal Code, SOPs & Library, User Guide |
| **Oversight** | My Desk, Calendar, Shift Reports, Audit Log (sortable, filterable, exports to CSV) |

Click a **category** to jump to its first screen; a **sub-tab strip** appears under the header to switch between the screens inside that category (the crowded Intelligence strip labels its tools **Registries · Analysis · Archive** so the right one is easier to spot). Colored dots on the Command button are live counters (pending member approvals, unread announcements, items waiting on you).

### The header (top bar)

- **Search everything…** — the global search box. Press **/** to focus it, or **Ctrl-K** (**⌘K** on Mac) anywhere to open the search palette. It finds cases, people, gangs, vehicles (by plate), places, penal codes, legal requests (by request number or title) and more; press **↑/↓** then **Enter** to jump straight to a result. It also runs **commands**: type "new case", "loa", "sign out" or "go to heatmap" and hit Enter — the everyday actions appear as soon as the palette opens.
- **Bell icon** — your notifications (mentions, sign-off events, tracker approvals). Click one to jump to its case.
- **Access chip** — hover to see exactly what your role lets you do.
- **Set LOA / Clear LOA** — mark yourself on leave; sign-off routing will skip you while you're away.
- **Sign out** — ends your session.

### On your phone

The sidebar becomes a **bottom navigation bar** with the same 5 categories; a dot on Command means something needs your attention.

---

## Core Features Step-by-Step

### Open and read a case

1. Go to **Cases → Case Files**.
2. Use the search box or status filters to find the case, then **click its card**.
3. Inside, work through the tabs: **Overview** (assignments & stats), **Graph** (the investigation link chart), **Evidence**, **Reports**, **Tasks**, **Charges**, **Chat** (case room with @mentions), **Timeline**, **Files**, **Intel** (linked people/gangs/places), **RICO**, and **Sign-off**. When you write an investigative report, the **Evidence / Property** section has **Add from case evidence** and **Add from case attachments** pickers — they list only what's already logged on this case's Evidence tab or attachments, and added entries show as removable chips. Click a saved report to open it **right in the tab**: referenced evidence expands to its logged details, attachments open their file link, and matching names jump to that person's profile. **Finalize** asks for confirmation and seals the report (contents lock); bureau leads and above can **Reopen** a sealed report to make it editable again. Nothing sealed is ever lost: a sealed report shows its **Signatures** (including earlier seals from before a reopen, marked as superseded), and the **Versions** button lists every sealed version — open one to read exactly what the report said when it was signed. Warrant reports get a status selector (draft → signed → executed → returned) that feeds the BOLO board and person profiles.
4. The **Timeline** tab opens with a zoomable chronology band — every event on its own lane (evidence, reports, tasks, sign-off). **Scroll to zoom** in on a busy day, **drag to pan**, and hover any dot for the details.

### Create a case

1. On **Case Files**, click **New Case**.
2. Fill in the title, bureau, and summary — or click a **template** chip to prefill them. Templates with a ☑ number also carry a task checklist.
3. Click **Save**. The case gets an auto-numbered ID (like `SAB-9000041`), appears for your bureau instantly, and any template checklist tasks are already waiting on its **Tasks** tab.

### Run a joint case across departments

When a case involves more than one department, the case lead (or Command) can click **Make This a Joint Case** on the case. The case keeps its originating department and gains a **JTF** tag, and you pick the members from other departments in a searchable list (by name or badge, filterable by department). Each member gets a **temporary joint-case role** — JTF Case Lead, Co-Lead, Joint Investigator, Support Investigator, Department Liaison, or Read-Only Member — and optionally an access **expiry date**. That grants them access to *this case only*: their permanent department and rank never change, and they don't see your department's other cases. Members can be added or removed later (removal takes effect immediately, history is kept), and **End Joint-Case Status** closes all temporary access at once. Everyone involved is notified and every step is audit-logged.

### Move a case through its life

- Drag a case card between the status columns on the board, **or** open the case and change **Status**.
- When investigation is done, open the **Sign-off** tab and click **Submit for sign-off**. It routes automatically: bureau lead → deputy director → director. You'll get a notification at every step, and returned cases land in **My Desk → Returned or in-flight sign-off**.
- Need the paperwork? In the case, open the **Case packet** dialog and click **Download PDF**, **Download DOCX** or **Download Markdown** for the full record — the PDF comes letterheaded and paginated, ready for court.

### Log intelligence

- **A person:** Intelligence → Persons → **+ New Person**. Click a person's **Profile** to open their full profile page — identity card, warrants, vehicles, properties, linked cases, media and notes (shareable link, with dossier export).
- **A vehicle:** Intelligence → Vehicles → **+ New Vehicle** — plate, model, owner. Click a vehicle's **Profile** for its full page — details, owner (linked to their person profile), gang tie, notes, and every case the plate or owner appears in. The registry also flags plates that appear across multiple cases.
- **A gang:** Intelligence → Gangs → pick or create a gang, then use **Add member** and **Add Turf** inside it.
- **A hard identifier:** Intelligence → Indicators → **+ New Indicator** — log a burner phone, bank account, weapon serial, alias or address against its case. The registry deconflicts automatically: if the same value is already logged on another case, both cases get a ⚡ **Deconfliction alert** naming each other (a case you can't access shows as 🔒 restricted — coordinate through its bureau lead).
- **Link intel to a case:** open the case → **Intel** tab → link persons/gangs/places so everything cross-references.

### See the case as a link chart

Open a case → **Graph** tab. The case sits at the center; suspects, witnesses, gangs, places, evidence, vehicles, reports and warrants orbit it, connected by labeled relationships (**owns**, **seen at**, **member of**, **mentioned in**…). Drag nodes to arrange, scroll to zoom, and **click any node** for its details and a jump link. The chart builds itself from the case's Intel links, evidence and reports — nothing extra to maintain.

You can also work the case from the chart itself: **🔗 Link intel** (top-left) connects a person, gang or place without leaving the graph, and a linked node's panel has **Unlink from case**. Click a person and **Show their other cases** to see where else they surface. Your dragged arrangement is remembered per case on this device — **↺ Reset layout** brings back the automatic ring.

### Attach photos, videos and files

1. Go to **Cases → Attachments** (or a case's **Files** tab).
2. Type or pick the **case number**, click **📎 Attach file**, and choose one or more files (images, video, audio, PDF).
3. Click any attachment to preview it in place. Files are hosted externally; only the link is stored with the case.

### Follow what matters to you

- On any case, person profile, or vehicle, click the **☆ Follow** button.
- Followed items appear in **My Desk → Following**, with an amber **updated** chip whenever something changed since you last looked. Click an item to open it (that marks it seen), or click **Mark all seen**.

### Work your desk

**My Desk** (Oversight) shows, in one screen: sign-offs waiting on **you**, your returned cases, due follow-ups, stale cases, your open tasks, recent @mentions, your followed items, notifications and draft reports. If the Command dot in the nav is lit, this is where the work is.

### Announce to the division (command staff)

**Command → Announcements → + New Announcement.** Pick the **audience**: Everyone (`@everyone` — Deputy Director and above), Command, My Department, a specific department, or specific members (just the people you mention). The composer previews exactly how many active members will be notified and asks you to confirm before publishing; every recipient gets one notification (and a Discord DM where linked). Editing an announcement never re-notifies anyone unless you explicitly tick **Notify recipients about this update**.

### Read the division's pulse — analytics

**Command → Analytics** turns the live records into trends: stat tiles for **open cases**, the **clearance rate**, **average days to close** and **active BOLOs**; weekly bars of cases **opened vs closed**; an **evidence logged** trend line; and a **caseload by detective** chart. Hover any bar for exact numbers. Everything is computed from the cases you're allowed to see, so leadership and detectives each get their own true picture.

### See what's due — the calendar

**Oversight → Calendar** shows the month at a glance: 📌 case follow-ups, ☑️ open task deadlines, and 📝 shift-report weeks. Days in red have overdue items; click any day to see its items and jump straight to them.

Wherever a date matters, the portal shows the same small **deadline chip** — on a case task's due date, a case's follow-up, a joint member's access expiry, and a warrant or subpoena deadline. It turns amber when the deadline is close and red once it has passed, using the same wording everywhere (**Due / Overdue**, **Expires / Expired**).

### Check the security wall (portal owner)

The Owner Portal has a **Security Testing** section (Monitor → Security Testing) showing the latest results of the live security test suites, the health of the dedicated test accounts, and any leftover test data from a crashed run. The results are posted by the test runs themselves (from CI or a developer machine) — the portal only ever *reads* sanitized summaries. Your browser never runs privileged tests and never sees test credentials.

### File your weekly shift report

1. Go to **Oversight → Shift Reports** and click **+ This week’s report**.
2. Pick the week — the form **auto-fills** a rollup of the cases you led and evidence you logged that week.
3. Add your summary and click **Save**. One report per week; you can edit yours later.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| *"…signed in but not yet approved"* | Normal for new accounts — ask a Command member to approve you, then reload. |
| A page says **Sign in to view…** after you were away | Your session expired — sign back in; your drafts and settings are kept on this device. |
| You can't see a case a colleague mentions | It belongs to another bureau. Access is enforced server-side; ask the case lead or your bureau lead. |
| **Save failed / Delete failed** toast | The server refused the write (usually permissions). The message says why — nothing was silently lost. |
| **Upload failed** on Attachments/Media | Check the file type (image/video/audio/PDF) and your connection, then retry — each file uploads independently. |
| Search finds nothing | Try fewer letters (search is typo-tolerant), or a plate/case-number fragment. Press **Ctrl-K / ⌘K** for the full palette. |
| Edits you made elsewhere aren't showing | The portal is live, but a laggy connection can delay it — a banner appears when you're offline; click **Refresh** on My Desk or reload. |
| You closed a modal and lost your text | Modals with unsaved changes warn you first — click **Cancel** in that warning to keep writing. Drafts of long forms are kept per device. |
| Clicked **Delete** by accident | Most deletions show an **Undo** toast for a few seconds. Click it. If it's gone, ask Command — records are audit-logged. |

---

*Questions or ideas? Use **Feedback** (in the sidebar) — it goes straight to the portal owner, and you can watch your suggestion's status change as it's triaged.*

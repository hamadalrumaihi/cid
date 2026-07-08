/** The in-app copy of docs/USER-GUIDE.md, adapted for src/lib/markdown
 *  (no --- rules or italics). Keep the two in sync when either changes. */
export const USER_GUIDE_MD = `Welcome to the **CID Portal**, the live case-management system for the San Andreas Criminal Investigation Division. This guide walks a first-time member from signing in to running their first case.


## Introduction

The CID Portal is a private, real-time investigation workspace. Everything in it is **live and shared**: when another detective updates a case, adds a suspect, or posts an announcement, your screen updates within seconds — no refresh needed. The portal covers the full life of an investigation:

- **Cases** — the central record: evidence, reports, tasks, charges, sign-off and court packets.
- **Intelligence** — the people, gangs, vehicles, places and networks behind those cases.
- **Command** — dashboards, announcements, roster, heatmaps and approvals for leadership.
- **Reference** — the Penal Code, division SOPs, and this guide (Reference → User Guide).
- **Oversight** — your personal desk, weekly shift reports and the audit log.

What you can see and change depends on your **role and bureau** — the server enforces this, so you'll simply never see records that aren't yours to see.


## Getting Started

### Signing in

1. Open the portal. You'll land on the **CID Portal — Secure Access** screen.
2. Pick one of three ways in:
   - Click **Continue with Discord** (most members use this),
   - Click **Continue with Google**, or
   - Type your email and click **Email link** — you'll get a one-time sign-in link in your inbox ("Magic link sent — check your inbox.").
3. First time here? After signing in you'll see: "…signed in but not yet approved." That's normal — a Command member must activate your profile. Ping your supervisor, then just reload once they've approved you.

### First five minutes after approval

- Click your **name card** at the bottom of the left sidebar to open **My Profile** — set your display name and badge number so your work is attributed correctly.
- Click the **Appearance** control in the sidebar to pick your accent color and compact/comfortable density.
- Open **My Desk** (Oversight section) — this is your personal to-do view and the best page to start every session on.


## Main Interface Navigation

### The left sidebar (desktop)

The sidebar groups all 26 screens into **5 categories**:

| Category | What's inside |
|---|---|
| **Command** | Dashboard, Announcements, Heatmap, Roster & Commendations |
| **Cases** | Case Files, Operations, Attachments, RICO |
| **Intelligence** | Persons, BOLO Board, Gangs, Places, Vehicles, Network, Narcotics, Ballistics, M.O. Detector, Media Vault, Records |
| **Reference** | Penal Code, SOPs & Library, User Guide |
| **Oversight** | My Desk, Shift Reports, Audit Log |

Click a **category** to jump to its first screen; a **sub-tab strip** appears under the header to switch between the screens inside that category. Colored dots on the Command button are live counters (pending member approvals, unread announcements, items waiting on you).

### The header (top bar)

- **Search everything…** — the global search box. Press **/** to focus it, or **Ctrl-K** (**⌘K** on Mac) anywhere to open the search palette. It finds cases, people, gangs, vehicles (by plate), places, penal codes and more; press **↑/↓** then **Enter** to jump straight to a result.
- **Bell icon** — your notifications (mentions, sign-off events, tracker approvals). Click one to jump to its case.
- **Access chip** — hover to see exactly what your role lets you do.
- **Set LOA / Clear LOA** — mark yourself on leave; sign-off routing will skip you while you're away.
- **Sign out** — ends your session.

### On your phone

The sidebar becomes a **bottom navigation bar** with the same 5 categories; a dot on Command means something needs your attention.


## Core Features Step-by-Step

### Open and read a case

1. Go to **Cases → Case Files**.
2. Use the search box or status filters to find the case, then **click its card**.
3. Inside, work through the tabs: **Overview** (assignments & stats), **Evidence**, **Reports**, **Tasks**, **Charges**, **Chat** (case room with @mentions), **Timeline**, **Files**, **Intel** (linked people/gangs/places), **RICO**, and **Sign-off**.

### Create a case

1. On **Case Files**, click **New Case**.
2. Fill in the title, bureau, and summary (a template can prefill these), then click **Save**.
3. The case gets an auto-numbered ID (like \`SAB-9000041\`) and appears for your bureau instantly.

### Move a case through its life

- Drag a case card between the status columns on the board, **or** open the case and change **Status**.
- When investigation is done, open the **Sign-off** tab and click **Submit for sign-off**. It routes automatically: bureau lead → deputy director → director. You'll get a notification at every step, and returned cases land in **My Desk → Returned or in-flight sign-off**.
- Need the paperwork? In the case, open the **Case packet** dialog and click **Download DOCX** or **Download Markdown** for the full record.

### Log intelligence

- **A person:** Intelligence → Persons → **+ New Person**. Click any person's card to open their full intel profile (cases, gang ties, vehicles, dossier export).
- **A vehicle:** Intelligence → Vehicles → **+ New Vehicle** — plate, model, owner. The registry automatically flags plates that appear across multiple cases.
- **A gang:** Intelligence → Gangs → pick or create a gang, then use **Add member** and **Add Turf** inside it.
- **Link intel to a case:** open the case → **Intel** tab → link persons/gangs/places so everything cross-references.

### Attach photos, videos and files

1. Go to **Cases → Attachments** (or a case's **Files** tab).
2. Type or pick the **case number**, click **📎 Attach file**, and choose one or more files (images, video, audio, PDF).
3. Click any attachment to preview it in place. Files are hosted externally; only the link is stored with the case.

### Follow what matters to you

- On any case, person profile, or vehicle, click the **☆ Follow** button.
- Followed items appear in **My Desk → Following**, with an amber **updated** chip whenever something changed since you last looked. Click an item to open it (that marks it seen), or click **Mark all seen**.

### Work your desk

**My Desk** (Oversight) shows, in one screen: sign-offs waiting on **you**, your returned cases, due follow-ups, stale cases, your open tasks, recent @mentions, your followed items, notifications and draft reports. If the Command dot in the nav is lit, this is where the work is.

### File your weekly shift report

1. Go to **Oversight → Shift Reports** and click **+ This week’s report**.
2. Pick the week — the form **auto-fills** a rollup of the cases you led and evidence you logged that week.
3. Add your summary and click **Save**. One report per week; you can edit yours later.


## Troubleshooting

| Symptom | Fix |
|---|---|
| "…signed in but not yet approved" | Normal for new accounts — ask a Command member to approve you, then reload. |
| A page says **Sign in to view…** after you were away | Your session expired — sign back in; your drafts and settings are kept on this device. |
| You can't see a case a colleague mentions | It belongs to another bureau. Access is enforced server-side; ask the case lead or your bureau lead. |
| **Save failed / Delete failed** toast | The server refused the write (usually permissions). The message says why — nothing was silently lost. |
| **Upload failed** on Attachments/Media | Check the file type (image/video/audio/PDF) and your connection, then retry — each file uploads independently. |
| Search finds nothing | Try fewer letters (search is typo-tolerant), or a plate/case-number fragment. Press **Ctrl-K / ⌘K** for the full palette. |
| Edits you made elsewhere aren't showing | The portal is live, but a laggy connection can delay it — a banner appears when you're offline; click **Refresh** on My Desk or reload. |
| You closed a modal and lost your text | Modals with unsaved changes warn you first — click **Cancel** in that warning to keep writing. Drafts of long forms are kept per device. |
| Clicked **Delete** by accident | Most deletions show an **Undo** toast for a few seconds. Click it. If it's gone, ask Command — records are audit-logged. |


Questions or ideas? Use **Feedback** (in the sidebar) — it goes straight to the portal owner, and you can watch your suggestion's status change as it's triaged.
`

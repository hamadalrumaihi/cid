// discord-notify — DMs a CID member via a Discord bot (deployed to project `cid`).
// Requires secret DISCORD_BOT_TOKEN; the bot must share a server with the recipient
// and the recipient must allow DMs. Looks up profiles.discord_id with the service
// role. JWT-protected by default and additionally verifies the caller is active
// and that a matching in-app notification was just created.
//
// Titles + Discord categories come from ./titles.json — a byte-identical copy of
// src/lib/notificationTitles.json (scripts/sync-notification-titles.mjs; the
// `check:notif-titles` gate fails when they drift). A kind whose entry says
// `destination: 'portal'` is skipped before anything else. The recipient's opt-in
// (user_prefs key 'notif_discord', {categories: string[]}) is read with the
// service role: a missing row means every category; a type whose category is
// not in the list is skipped; an unmapped type is 'other' and always sent —
// so every decision-like kind MUST sit in a real category (see the JSON).
// DM text: title + identifiers (case / request / FI number, detective); the
// free-text `reason` is forwarded only for the REASON_OK kinds below.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import titles from './titles.json' with { type: 'json' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

type TitleEntry = { title: string; category: string; destination?: 'portal'; mutable?: true; priority?: string };
const TITLES = titles as Record<string, TitleEntry>;
/** The opt-in categories the profile UI offers — derived from titles.json
 *  exactly as lib/notifications DISCORD_CATEGORIES is: every category with at
 *  least one kind that is not portal-only, excluding 'other'. Anything else
 *  is 'other' (always sent). */
const OPT_IN_CATEGORIES = new Set(
  Object.values(TITLES).filter((e) => e.destination !== 'portal').map((e) => e.category).filter((c) => c !== 'other'),
);

const clean = (v: unknown) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
/** The ONLY types whose free-text `reason` may leave the portal in a DM.
 *  Every other kind (review notes, surveillance / legal / SIB decision text,
 *  suggestion verdicts …) DMs identifiers only — the words stay in-app. */
const REASON_OK = new Set(['chat_mention', 'mention', 'note_mention', 'access_requested', 'member_approved']);
const dmBody = (type: string, payload: Record<string, unknown>) => {
  const parts = [clean(payload.case_number), clean(payload.request_number), clean(payload.submission_no), clean(payload.detective)];
  if (REASON_OK.has(type)) parts.push(clean(payload.reason));
  return parts.filter(Boolean).join(' — ');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { user_id, type, payload } = await req.json();
    if (!user_id || !type) return json({ error: 'missing user_id/type' }, 400);
    const entry = TITLES[type];
    if (!entry?.title) return json({ error: 'unsupported notification type' }, 400);
    // Portal-only kinds (the CI compartment) never leave the portal: no
    // auth, profile, notification or preference lookup happens for them.
    if (entry.destination === 'portal') return json({ skipped: 'portal-only' });
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'missing authorization' }, 401);
    const token = Deno.env.get('DISCORD_BOT_TOKEN');
    if (!token) return json({ skipped: 'no DISCORD_BOT_TOKEN configured' });

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: authRes, error: authErr } = await supa.auth.getUser(jwt);
    if (authErr || !authRes?.user?.id) return json({ error: 'invalid authorization' }, 401);
    const callerId = authRes.user.id;
    const { data: caller } = await supa.from('profiles').select('active').eq('id', callerId).maybeSingle();
    if (!caller?.active) return json({ error: 'inactive caller' }, 403);

    const recentCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    // create_notification() stamps the caller into payload.actor_id (there is
    // no created_by column on notifications — the old filter matched nothing
    // and silently blocked every DM).
    let q = supa.from('notifications')
      .select('id,payload')
      .eq('user_id', user_id)
      .eq('type', type)
      .eq('payload->>actor_id', callerId)
      .gte('created_at', recentCutoff)
      .order('created_at', { ascending: false })
      .limit(1);
    if (payload?.case_id) q = q.eq('payload->>case_id', String(payload.case_id));
    const { data: notif } = await q.maybeSingle();
    if (!notif?.id) return json({ error: 'matching notification not found' }, 403);
    // The DM text comes from the stored notification row, never from the
    // request body. Note the row is NOT a sanitised source: create_notification
    // stores the caller's `reason` verbatim (capped at 500 chars), so dmBody
    // only forwards it for the REASON_OK kinds and sends identifiers otherwise.
    const stored = (notif.payload ?? {}) as Record<string, unknown>;

    const { data: prof } = await supa.from('profiles').select('active,discord_id').eq('id', user_id).maybeSingle();
    if (!prof?.active) return json({ skipped: 'recipient inactive' });
    const did = prof?.discord_id;
    if (!did) return json({ skipped: 'no discord_id for user' });

    // Opt-in categories (P7-07). A missing row = every category; an unmapped
    // type ('other') is never muted.
    const category = OPT_IN_CATEGORIES.has(entry.category) ? entry.category : 'other';
    if (category !== 'other') {
      const { data: pref } = await supa.from('user_prefs').select('value')
        .eq('user_id', user_id).eq('key', 'notif_discord').maybeSingle();
      const cats = (pref?.value as { categories?: unknown } | null)?.categories;
      if (Array.isArray(cats) && !cats.includes(category)) return json({ skipped: 'category muted' });
    }

    const h = { Authorization: `Bot ${token}`, 'content-type': 'application/json' };
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST', headers: h, body: JSON.stringify({ recipient_id: String(did) }),
    });
    if (!dmRes.ok) return json({ error: 'dm_open_failed', status: dmRes.status, detail: await dmRes.text() }, 502);
    const dm = await dmRes.json();
    const body = dmBody(type, stored);
    const content = `**${entry.title}**${body ? `\n${body}` : ''}`.slice(0, 1900);
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST', headers: h, body: JSON.stringify({ content }),
    });
    if (!msgRes.ok) return json({ error: 'send_failed', status: msgRes.status, detail: await msgRes.text() }, 502);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// discord-announce — one server-side, rate-limited Discord DM sweep for a
// just-published announcement. The browser calls this ONCE with {announce_id};
// recipients are read back from the notifications the publish_announcement()
// RPC already created (so Discord delivery can never disagree with the portal
// fan-out), and each active recipient with a linked discord_id gets one DM.
// Failures are recorded in the response and never affect the portal records.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });
const clean = (v: unknown) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { announce_id } = await req.json();
    if (!announce_id) return json({ error: 'missing announce_id' }, 400);
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

    const { data: ann } = await supa.from('announcements')
      .select('id,title,author_id,created_at').eq('id', announce_id).maybeSingle();
    if (!ann) return json({ error: 'announcement not found' }, 404);
    if (ann.author_id !== callerId) return json({ error: 'only the author may trigger Discord delivery' }, 403);

    // Recipients = the in-app notifications the publish RPC just wrote.
    const recentCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: notifs } = await supa.from('notifications')
      .select('user_id')
      .eq('type', 'announcement')
      .eq('payload->>announce_id', String(announce_id))
      .gte('created_at', recentCutoff)
      .limit(500);
    const userIds = Array.from(new Set((notifs || []).map((n) => n.user_id)));
    if (!userIds.length) return json({ skipped: 'no recent recipients for this announcement' });

    const { data: profs } = await supa.from('profiles')
      .select('id,active,discord_id').in('id', userIds);
    const targets = (profs || []).filter((p) => p.active && p.discord_id);

    const h = { Authorization: `Bot ${token}`, 'content-type': 'application/json' };
    const content = `**📣 New announcement**\n${clean(ann.title)}`.slice(0, 1900);
    let sent = 0; let failed = 0;
    for (const t of targets) {
      try {
        const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
          method: 'POST', headers: h, body: JSON.stringify({ recipient_id: String(t.discord_id) }),
        });
        if (!dmRes.ok) { failed++; continue; }
        const dm = await dmRes.json();
        const msgRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
          method: 'POST', headers: h, body: JSON.stringify({ content }),
        });
        if (msgRes.ok) sent++; else failed++;
      } catch { failed++; }
      await sleep(350); // stay well under Discord rate limits
    }
    return json({ ok: true, recipients: userIds.length, dm_capable: targets.length, sent, failed });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

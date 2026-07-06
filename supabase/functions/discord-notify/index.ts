// discord-notify — DMs a CID member via a Discord bot (deployed to project `cid`).
// Requires secret DISCORD_BOT_TOKEN; the bot must share a server with the recipient
// and the recipient must allow DMs. Looks up profiles.discord_id with the service
// role. JWT-protected by default and additionally verifies the caller is active
// and that a matching in-app notification was just created.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

const titles: Record<string, string> = {
  access_requested: 'Case access requested',
  access_granted: 'Case access granted',
  access_denied: 'Case access denied',
  member_approved: 'CID access approved',
  signoff_waiting: 'Sign-off needed',
  signoff_approved: 'Sign-off approved',
  signoff_denied: 'Sign-off denied',
  signoff_changes: 'Changes requested',
  signoff_escalated: 'Sign-off escalated',
  signoff_heads_up: 'Deputy approved a case',
  announcement: 'New announcement',
  mention: 'You were mentioned',
  chat_mention: 'You were mentioned',
  case_stale: 'Case needs attention',
  tracker_pending: 'Tracker awaiting co-sign',
  tracker_authorized: 'Tracker authorized',
  case_assigned: 'Case assigned',
  report_finalized: 'Report finalized',
  rico_ready: 'RICO elements satisfied',
};
const clean = (v: unknown) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
const dmBody = (type: string, payload: Record<string, unknown>) =>
  [clean(payload.case_number), clean(payload.reason || payload.detective)].filter(Boolean).join(' — ');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { user_id, type, payload } = await req.json();
    if (!user_id || !type) return json({ error: 'missing user_id/type' }, 400);
    if (!titles[type]) return json({ error: 'unsupported notification type' }, 400);
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
    let q = supa.from('notifications')
      .select('id')
      .eq('user_id', user_id)
      .eq('type', type)
      .eq('created_by', callerId)
      .gte('created_at', recentCutoff)
      .order('created_at', { ascending: false })
      .limit(1);
    if (payload?.case_id) q = q.eq('payload->>case_id', String(payload.case_id));
    const { data: notif } = await q.maybeSingle();
    if (!notif?.id) return json({ error: 'matching notification not found' }, 403);

    const { data: prof } = await supa.from('profiles').select('active,discord_id').eq('id', user_id).maybeSingle();
    if (!prof?.active) return json({ skipped: 'recipient inactive' });
    const did = prof?.discord_id;
    if (!did) return json({ skipped: 'no discord_id for user' });

    const h = { Authorization: `Bot ${token}`, 'content-type': 'application/json' };
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST', headers: h, body: JSON.stringify({ recipient_id: String(did) }),
    });
    if (!dmRes.ok) return json({ error: 'dm_open_failed', status: dmRes.status, detail: await dmRes.text() }, 502);
    const dm = await dmRes.json();
    const body = dmBody(type, payload || {});
    const content = `**${titles[type]}**${body ? `\n${body}` : ''}`.slice(0, 1900);
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST', headers: h, body: JSON.stringify({ content }),
    });
    if (!msgRes.ok) return json({ error: 'send_failed', status: msgRes.status, detail: await msgRes.text() }, 502);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

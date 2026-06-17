// discord-notify — DMs a CID member via a Discord bot (deployed to project `cid`).
// Requires secret DISCORD_BOT_TOKEN; the bot must share a server with the recipient
// and the recipient must allow DMs. Looks up profiles.discord_id with the service
// role. JWT-protected by default (only signed-in members can invoke).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { user_id, title, body } = await req.json();
    if (!user_id) return json({ error: 'missing user_id' }, 400);
    const token = Deno.env.get('DISCORD_BOT_TOKEN');
    if (!token) return json({ skipped: 'no DISCORD_BOT_TOKEN configured' });

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prof } = await supa.from('profiles').select('discord_id').eq('id', user_id).maybeSingle();
    const did = prof?.discord_id;
    if (!did) return json({ skipped: 'no discord_id for user' });

    const h = { Authorization: `Bot ${token}`, 'content-type': 'application/json' };
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST', headers: h, body: JSON.stringify({ recipient_id: String(did) }),
    });
    if (!dmRes.ok) return json({ error: 'dm_open_failed', status: dmRes.status, detail: await dmRes.text() }, 502);
    const dm = await dmRes.json();
    const content = `**${title || 'CID Portal'}**\n${body || ''}`.slice(0, 1900);
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
      method: 'POST', headers: h, body: JSON.stringify({ content }),
    });
    if (!msgRes.ok) return json({ error: 'send_failed', status: msgRes.status, detail: await msgRes.text() }, 502);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

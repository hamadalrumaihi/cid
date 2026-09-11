// health.probe — shared probes (worker, supabase, configured service URLs)
// plus a Redis PING when REDIS_URL is set. Detail never carries URLs.
import { healthProbe, type KindHandler } from '../jobCore.ts';
import { env } from '../deps.ts';

export const kind = 'health.probe';
export const queue = 'health';

export const handler: KindHandler = async (ctx) => {
  const base = (await healthProbe(ctx)) as { services: string[] };
  const redisUrl = env('REDIS_URL');
  if (!redisUrl) return base;
  const { Redis } = await import('ioredis');
  const client = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 5000, lazyConnect: true });
  const started = Date.now();
  let status: 'healthy' | 'degraded' | 'offline' = 'offline';
  try {
    await client.connect();
    await client.ping();
    const latency = Date.now() - started;
    status = latency > 2000 ? 'degraded' : 'healthy';
  } catch {
    status = 'offline';
  } finally {
    client.disconnect();
  }
  const latency_ms = Date.now() - started;
  await ctx.deps.supa.from('service_health_events').insert([{ service: 'redis', status, latency_ms, detail: {} }]);
  return { services: [...base.services, `redis:${status}`] };
};

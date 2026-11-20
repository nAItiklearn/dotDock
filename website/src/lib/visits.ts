/**
 * The anonymous visit counter. One number in Redis (Upstash, from the Vercel Marketplace): a browser that has not
 * counted today asks to add one (POST), every other page view only reads it (GET). Nothing else is stored or sent:
 * no IP address, no cookie, no identifier; the browser remembers only the day it last counted (localStorage).
 * Without Redis credentials the endpoint answers 503 and the page keeps the counter hidden: no number is ever invented.
 *
 * This file has no imports on purpose, so the tests can run it directly and a mocked client can stand in for Redis.
 */

/** The one Redis key that holds the count. */
export const VISITS_KEY = "dotdock:visits";

/** The two methods of the Redis client the counter uses. */
export interface RedisLike {
  incr(key: string): Promise<number>;
  get(key: string): Promise<unknown>;
}

export interface RedisEnv {
  readonly KV_REST_API_URL?: string | undefined;
  readonly KV_REST_API_TOKEN?: string | undefined;
  readonly UPSTASH_REDIS_REST_URL?: string | undefined;
  readonly UPSTASH_REDIS_REST_TOKEN?: string | undefined;
}

export interface RedisCredentials {
  readonly url: string;
  readonly token: string;
}

/**
 * Credentials from the environment. The Vercel Marketplace integration sets the KV_REST_API_* pair, a direct
 * Upstash database the UPSTASH_REDIS_REST_* pair; the first complete pair wins.
 */
export function redisCredentials(env: RedisEnv): RedisCredentials | null {
  const pairs: [string | undefined, string | undefined][] = [
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
  ];
  for (const [url, token] of pairs) {
    if (url && token) return { url, token };
  }
  return null;
}

export interface VisitsReply {
  readonly status: number;
  readonly body: { readonly visits: number } | { readonly error: string };
}

/** Handles one request: POST counts a visit and returns the total, GET returns the total. */
export async function handleVisits(method: string, client: RedisLike | null): Promise<VisitsReply> {
  if (method !== "GET" && method !== "POST") return { status: 405, body: { error: "method not allowed" } };
  if (!client) return { status: 503, body: { error: "counter not configured" } };
  try {
    if (method === "POST") return { status: 200, body: { visits: await client.incr(VISITS_KEY) } };
    const stored = Number(await client.get(VISITS_KEY));
    return { status: 200, body: { visits: Number.isFinite(stored) ? stored : 0 } };
  } catch {
    return { status: 502, body: { error: "counter unavailable" } };
  }
}

/** The whole route: credentials from the environment, a client made by `connect`, the reply as a Response. */
export async function respond(method: string, env: RedisEnv, connect: (credentials: RedisCredentials) => RedisLike): Promise<Response> {
  const credentials = redisCredentials(env);
  const reply = await handleVisits(method, credentials ? connect(credentials) : null);
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

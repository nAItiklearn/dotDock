// Run with `pnpm test` (Node's built-in test runner; Node 22.18+ runs TypeScript directly).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VISITS_KEY, handleVisits, redisCredentials, respond, type RedisLike } from "../src/lib/visits.ts";

/** A Redis stand-in that records every call and keeps its numbers in memory. */
function mockRedis(start?: number): RedisLike & { calls: string[]; store: Map<string, number> } {
  const store = new Map<string, number>();
  if (start !== undefined) store.set(VISITS_KEY, start);
  const calls: string[] = [];
  return {
    calls,
    store,
    async incr(key) {
      calls.push(`incr ${key}`);
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async get(key) {
      calls.push(`get ${key}`);
      return store.get(key) ?? null;
    },
  };
}

describe("redisCredentials", () => {
  it("reads the Vercel Marketplace pair", () => {
    assert.deepEqual(redisCredentials({ KV_REST_API_URL: "https://kv", KV_REST_API_TOKEN: "k" }), { url: "https://kv", token: "k" });
    assert.deepEqual(redisCredentials({ DOCK_DOCK_KV_REST_API_URL: "https://dd", DOCK_DOCK_KV_REST_API_TOKEN: "d" }), { url: "https://dd", token: "d" });
  });
  it("reads the Upstash pair", () => {
    assert.deepEqual(redisCredentials({ UPSTASH_REDIS_REST_URL: "https://up", UPSTASH_REDIS_REST_TOKEN: "u" }), { url: "https://up", token: "u" });
  });
  it("prefers the Marketplace pair when both are set", () => {
    const env = { KV_REST_API_URL: "https://kv", KV_REST_API_TOKEN: "k", UPSTASH_REDIS_REST_URL: "https://up", UPSTASH_REDIS_REST_TOKEN: "u" };
    assert.equal(redisCredentials(env)?.url, "https://kv");
  });
  it("never mixes a URL from one pair with a token from the other", () => {
    assert.equal(redisCredentials({ KV_REST_API_URL: "https://kv", UPSTASH_REDIS_REST_TOKEN: "u" }), null);
  });
  it("is null when nothing is set", () => {
    assert.equal(redisCredentials({}), null);
  });
});

describe("handleVisits", () => {
  it("POST adds one visit and returns the new total", async () => {
    const redis = mockRedis(41);
    const reply = await handleVisits("POST", redis);
    assert.deepEqual(reply, { status: 200, body: { visits: 42 } });
    assert.deepEqual(redis.calls, [`incr ${VISITS_KEY}`]);
  });
  it("GET reads the total and changes nothing", async () => {
    const redis = mockRedis(42);
    const reply = await handleVisits("GET", redis);
    assert.deepEqual(reply, { status: 200, body: { visits: 42 } });
    assert.equal(redis.store.get(VISITS_KEY), 42);
    assert.deepEqual(redis.calls, [`get ${VISITS_KEY}`]);
  });
  it("GET on an empty database is zero, not an error", async () => {
    assert.deepEqual(await handleVisits("GET", mockRedis()), { status: 200, body: { visits: 0 } });
  });
  it("answers 200 with no number without a client, so the page hides the counter and logs no error", async () => {
    for (const method of ["GET", "POST"]) {
      assert.deepEqual(await handleVisits(method, null), { status: 200, body: { available: false } });
    }
  });
  it("refuses other methods", async () => {
    const redis = mockRedis(1);
    assert.equal((await handleVisits("DELETE", redis)).status, 405);
    assert.deepEqual(redis.calls, []);
  });
  it("answers 502 when Redis fails, and never a made-up number", async () => {
    const broken: RedisLike = {
      async incr() {
        throw new Error("down");
      },
      async get() {
        throw new Error("down");
      },
    };
    for (const method of ["GET", "POST"]) {
      const reply = await handleVisits(method, broken);
      assert.equal(reply.status, 502);
      assert.ok(!("visits" in reply.body));
    }
  });
});

describe("respond", () => {
  it("is a JSON response that is never cached", async () => {
    const redis = mockRedis(7);
    const res = await respond("POST", { KV_REST_API_URL: "https://kv", KV_REST_API_TOKEN: "k" }, () => redis);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { visits: 8 });
  });
  it("says the counter is not available without credentials, and never connects", async () => {
    let connected = false;
    const res = await respond("GET", {}, () => {
      connected = true;
      return mockRedis();
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { available: false });
    assert.equal(connected, false);
  });
  it("hands the credentials to the connector", async () => {
    let seen: unknown;
    await respond("GET", { UPSTASH_REDIS_REST_URL: "https://up", UPSTASH_REDIS_REST_TOKEN: "u" }, (c) => {
      seen = c;
      return mockRedis(3);
    });
    assert.deepEqual(seen, { url: "https://up", token: "u" });
  });
});

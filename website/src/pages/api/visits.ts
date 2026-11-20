import type { APIRoute } from "astro";
import { Redis } from "@upstash/redis";
import { respond } from "../../lib/visits";

/** The only on-demand route of the site: the anonymous visit counter (see src/lib/visits.ts). */
export const prerender = false;

const connect = (credentials: { url: string; token: string }) => new Redis(credentials);

export const GET: APIRoute = () => respond("GET", process.env, connect);
export const POST: APIRoute = () => respond("POST", process.env, connect);

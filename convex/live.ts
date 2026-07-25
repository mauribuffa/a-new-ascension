import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** A tab is considered online if it has checked in within this window. */
export const STALE_MS = 45_000;

/* ---------------------------------------------------------------------------
   Abuse limits.

   These mutations are public and unauthenticated — the Convex deployment URL
   ships inside the page, so anyone can call them directly. Without limits the
   counters and leaderboard can be inflated in a loop, on our quota. The rules:

     · the leaderboard only accepts the 11 real album tracks (allowlist), and
       the display title comes from here, never from the caller
     · a play only counts if it comes from a session that is actually present,
       and at most once per PLAY_COOLDOWN_MS for that session
     · heartbeats that arrive faster than HEARTBEAT_MIN_MS are ignored
     · the presence table is capped, so churning new sessions cannot grow it
       (or the visitor counter) without bound
--------------------------------------------------------------------------- */
const HEARTBEAT_MIN_MS = 8_000;
const PLAY_COOLDOWN_MS = 20_000;
const MAX_PRESENCE = 500;

const TRACK_TITLES: Record<string, string> = {
  "astral-body": "Astral Body",
  "all-about-the-hits": "All About the Hits",
  "bridge-diving": "Bridge Diving",
  "on-a-big-illusion": "On a Big Illusion",
  "my-own-goliath": "My Own Goliath",
  "cinema-geek": "Cinema Geek",
  "resurrected": "Resurrected",
  "air-traffic-controller": "Air Traffic Controller",
  "chronograph": "Chronograph",
  "where-the-heart-is": "Where the Heart is",
  "beyond-the-edge-of-time": "Beyond the Edge of Time",
};

/**
 * Called on load and then on an interval by each open tab.
 * Returns true the first time a session is seen, so the client knows it was
 * counted as a new visitor.
 */
export const heartbeat = mutation({
  args: {
    sessionId: v.string(),
    country: v.string(),
    code: v.string(),
    track: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (existing) {
      // Ignore floods; the client only needs to check in every 15s.
      if (now - existing.lastSeen < HEARTBEAT_MIN_MS && existing.track === args.track) {
        return { isNew: false, throttled: true };
      }
      await ctx.db.patch(existing._id, {
        track: args.track,
        country: args.country,
        code: args.code,
        lastSeen: now,
      });
      return { isNew: false, throttled: false };
    }

    // Cap the floor so churning fresh sessionIds can't grow the table or the
    // visitor counter without bound.
    const live = await ctx.db
      .query("presence")
      .withIndex("by_lastSeen", (q) => q.gt("lastSeen", now - STALE_MS))
      .take(MAX_PRESENCE + 1);
    if (live.length > MAX_PRESENCE) {
      return { isNew: false, throttled: true };
    }

    await ctx.db.insert("presence", { ...args, lastSeen: now });
    await ctx.db.insert("joins", {
      country: args.country,
      code: args.code,
      at: now,
    });

    const counter = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", "visitors"))
      .unique();
    if (counter) {
      await ctx.db.patch(counter._id, { value: counter.value + 1 });
    } else {
      await ctx.db.insert("counters", { key: "visitors", value: 1 });
    }

    return { isNew: true };
  },
});

/** Best-effort clean exit on tab close; the reaper is the real safety net. */
export const leave = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/**
 * Global leaderboard increment.
 *
 * The title is looked up here rather than accepted from the caller, so no
 * arbitrary rows can be written. A play only counts when it comes from a
 * session that is currently present, and at most once per cooldown.
 */
export const bumpPlay = mutation({
  args: { sessionId: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const title = TRACK_TITLES[args.slug];
    if (!title) return { ok: false, reason: "unknown track" };

    const session = await ctx.db
      .query("presence")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!session) return { ok: false, reason: "no live session" };

    const now = Date.now();
    if (session.lastPlayAt && now - session.lastPlayAt < PLAY_COOLDOWN_MS) {
      return { ok: false, reason: "cooling down" };
    }
    await ctx.db.patch(session._id, { lastPlayAt: now });

    const row = await ctx.db
      .query("plays")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { count: row.count + 1 });
    } else {
      await ctx.db.insert("plays", { slug: args.slug, title, count: 1 });
    }
    return { ok: true };
  },
});

/**
 * Everything the cabinet needs, in one reactive subscription. Convex re-runs
 * this automatically whenever any table it reads changes, so the client never
 * polls.
 */
export const state = query({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;

    const present = (
      await ctx.db
        .query("presence")
        .withIndex("by_lastSeen", (q) => q.gt("lastSeen", cutoff))
        .collect()
    ).filter((p) => p.lastSeen > cutoff);

    // group visitors by country
    const byCountry = new Map<string, { country: string; code: string; n: number }>();
    for (const p of present) {
      const hit = byCountry.get(p.code);
      if (hit) hit.n += 1;
      else byCountry.set(p.code, { country: p.country, code: p.code, n: 1 });
    }

    // what the world is listening to right now
    const byTrack = new Map<string, number>();
    for (const p of present) {
      if (p.track) byTrack.set(p.track, (byTrack.get(p.track) ?? 0) + 1);
    }

    const recentJoins = await ctx.db
      .query("joins")
      .withIndex("by_at")
      .order("desc")
      .take(6);

    const top = await ctx.db.query("plays").collect();
    top.sort((a, b) => b.count - a.count);

    const visitors = await ctx.db
      .query("counters")
      .withIndex("by_key", (q) => q.eq("key", "visitors"))
      .unique();

    return {
      online: present.length,
      countries: [...byCountry.values()].sort((a, b) => b.n - a.n),
      worldwide: [...byTrack.entries()]
        .map(([title, n]) => ({ title, n }))
        .sort((a, b) => b.n - a.n),
      recentJoins: recentJoins.map((j) => ({
        country: j.country,
        code: j.code,
        at: j.at,
      })),
      topPlays: top.slice(0, 5).map((p) => ({ title: p.title, count: p.count })),
      visitors: visitors?.value ?? 0,
    };
  },
});

/**
 * Deletes tabs that stopped checking in.
 *
 * This exists because Convex queries are reactive to *data*, not to the passage
 * of time. Filtering on `lastSeen` at read time is not enough on its own: when
 * somebody closes their tab, nothing writes, so no subscription would re-run and
 * everyone else's "players online" would stay stale. Deleting the row is the
 * write that pushes the update out.
 */
export const reap = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    const stale = await ctx.db
      .query("presence")
      .withIndex("by_lastSeen", (q) => q.lte("lastSeen", cutoff))
      .take(200);
    for (const row of stale) await ctx.db.delete(row._id);

    // keep the ticker table from growing without bound
    const oldJoins = await ctx.db
      .query("joins")
      .withIndex("by_at", (q) => q.lt("at", Date.now() - 86_400_000))
      .take(200);
    for (const row of oldJoins) await ctx.db.delete(row._id);
  },
});

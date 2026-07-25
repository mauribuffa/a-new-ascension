import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per open tab. Rows are kept alive by a heartbeat mutation and
  // reaped by a cron once they go stale — see convex/crons.ts for why the
  // reaper is required rather than just filtering on lastSeen at read time.
  presence: defineTable({
    sessionId: v.string(),
    country: v.string(), // display name, e.g. "Argentina"
    code: v.string(), // ISO-3166 alpha-2, e.g. "AR" (flag derived client-side)
    track: v.union(v.string(), v.null()), // what this visitor is hearing right now
    lastSeen: v.number(),
    lastPlayAt: v.optional(v.number()), // rate-limits leaderboard writes per session
  })
    .index("by_session", ["sessionId"])
    .index("by_lastSeen", ["lastSeen"]),

  // Append-only ticker feed: "PLAYER 2 JOINED — ARGENTINA".
  joins: defineTable({
    country: v.string(),
    code: v.string(),
    at: v.number(),
  }).index("by_at", ["at"]),

  // Global leaderboard, one row per track.
  plays: defineTable({
    slug: v.string(),
    title: v.string(),
    count: v.number(),
  }).index("by_slug", ["slug"]),

  // Single-row counters (currently just "visitors").
  counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index("by_key", ["key"]),
});

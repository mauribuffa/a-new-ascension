import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Reaping stale presence rows is what makes "players online" go *down*.
// Without this write, nothing would invalidate the `live.state` subscription
// when somebody closes their tab. See the note on `reap` in convex/live.ts.
crons.interval("reap stale presence", { seconds: 30 }, internal.live.reap, {});

export default crons;

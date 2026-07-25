/* ============================================================
   LIVE — the arcade floor
   Presence, visitor counts and a global leaderboard over Convex.

   Deliberately decoupled from the jukebox engine: this module listens for
   `ana:track` / `ana:play` events on `document` and owns its own UI. If no
   PUBLIC_CONVEX_URL was set at build time it does nothing at all, and the
   cabinet behaves exactly as it does offline.
   ============================================================ */
import { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const URL_ = document.body.dataset.convex || "";
const panel = document.getElementById("floor");

if (!URL_) {
  // No backend configured — hide the live panel and stay out of the way.
  if (panel) panel.remove();
} else {
  boot();
}

/* ---------- where in the world, without ever touching an IP ---------- */
// IANA timezone -> ISO-3166 alpha-2. Country *names* and flag emoji are both
// derived from this code by the browser, so no lookup tables are needed.
const TZ = {
  "America/Argentina/Buenos_Aires":"AR","America/Argentina/Cordoba":"AR","America/Argentina/Mendoza":"AR",
  "America/Argentina/Salta":"AR","America/Argentina/Tucuman":"AR","America/Argentina/Ushuaia":"AR",
  "America/Sao_Paulo":"BR","America/Bahia":"BR","America/Fortaleza":"BR","America/Manaus":"BR","America/Recife":"BR",
  "America/Santiago":"CL","America/Bogota":"CO","America/Lima":"PE","America/Caracas":"VE","America/La_Paz":"BO",
  "America/Montevideo":"UY","America/Asuncion":"PY","America/Guayaquil":"EC","America/Panama":"PA",
  "America/Costa_Rica":"CR","America/Guatemala":"GT","America/El_Salvador":"SV","America/Tegucigalpa":"HN",
  "America/Managua":"NI","America/Havana":"CU","America/Santo_Domingo":"DO","America/Puerto_Rico":"PR",
  "America/Mexico_City":"MX","America/Monterrey":"MX","America/Tijuana":"MX","America/Cancun":"MX",
  "America/New_York":"US","America/Detroit":"US","America/Chicago":"US","America/Denver":"US","America/Phoenix":"US",
  "America/Los_Angeles":"US","America/Anchorage":"US","Pacific/Honolulu":"US","America/Indiana/Indianapolis":"US",
  "America/Toronto":"CA","America/Vancouver":"CA","America/Edmonton":"CA","America/Winnipeg":"CA","America/Halifax":"CA",
  "Europe/London":"GB","Europe/Dublin":"IE","Europe/Lisbon":"PT","Europe/Madrid":"ES","Europe/Paris":"FR",
  "Europe/Brussels":"BE","Europe/Amsterdam":"NL","Europe/Berlin":"DE","Europe/Zurich":"CH","Europe/Vienna":"AT",
  "Europe/Rome":"IT","Europe/Prague":"CZ","Europe/Warsaw":"PL","Europe/Budapest":"HU","Europe/Bucharest":"RO",
  "Europe/Athens":"GR","Europe/Sofia":"BG","Europe/Belgrade":"RS","Europe/Zagreb":"HR","Europe/Copenhagen":"DK",
  "Europe/Oslo":"NO","Europe/Stockholm":"SE","Europe/Helsinki":"FI","Europe/Tallinn":"EE","Europe/Riga":"LV",
  "Europe/Vilnius":"LT","Europe/Kyiv":"UA","Europe/Kiev":"UA","Europe/Moscow":"RU","Europe/Istanbul":"TR",
  "Africa/Cairo":"EG","Africa/Lagos":"NG","Africa/Nairobi":"KE","Africa/Johannesburg":"ZA","Africa/Casablanca":"MA",
  "Africa/Accra":"GH","Africa/Tunis":"TN","Africa/Algiers":"DZ",
  "Asia/Jerusalem":"IL","Asia/Dubai":"AE","Asia/Riyadh":"SA","Asia/Tehran":"IR","Asia/Karachi":"PK",
  "Asia/Kolkata":"IN","Asia/Calcutta":"IN","Asia/Dhaka":"BD","Asia/Bangkok":"TH","Asia/Jakarta":"ID",
  "Asia/Singapore":"SG","Asia/Kuala_Lumpur":"MY","Asia/Manila":"PH","Asia/Hong_Kong":"HK","Asia/Shanghai":"CN",
  "Asia/Taipei":"TW","Asia/Seoul":"KR","Asia/Tokyo":"JP","Asia/Ho_Chi_Minh":"VN",
  "Australia/Sydney":"AU","Australia/Melbourne":"AU","Australia/Brisbane":"AU","Australia/Perth":"AU",
  "Australia/Adelaide":"AU","Pacific/Auckland":"NZ","Pacific/Fiji":"FJ",
};

function whereAmI() {
  let code = "";
  try {
    code = TZ[Intl.DateTimeFormat().resolvedOptions().timeZone] || "";
  } catch (e) { /* ignore */ }
  if (!code) {
    // Fall back to the locale's region, inferring one if the tag omits it
    // ("es" -> ES). Less accurate than the timezone, but better than nothing.
    try {
      const loc = new Intl.Locale(navigator.language);
      code = (loc.region || loc.maximize().region || "").toUpperCase();
    } catch (e) { /* ignore */ }
  }
  if (!/^[A-Z]{2}$/.test(code)) return { code: "??", country: "Somewhere" };
  let country = code;
  try {
    country = new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch (e) { /* ignore */ }
  return { code, country };
}

export function flagOf(code) {
  if (!/^[A-Z]{2}$/.test(code)) return "🏳";
  return code.replace(/./g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

/* ---------- boot ---------- */
function boot() {
  const client = new ConvexClient(URL_);
  const me = whereAmI();

  // One identity per tab, stable across reloads.
  let sessionId = sessionStorage.getItem("ana_sid");
  if (!sessionId) {
    sessionId = (crypto.randomUUID && crypto.randomUUID()) ||
      String(Math.random()).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("ana_sid", sessionId);
  }

  let currentTrack = null;
  let seenJoin = 0;      // newest join timestamp already shown in the ticker
  let firstPayload = true;

  const beat = () =>
    client.mutation(api.live.heartbeat, {
      sessionId, country: me.country, code: me.code, track: currentTrack,
    }).catch(() => {});

  beat();
  const timer = setInterval(beat, 15_000);

  // Report what this visitor is listening to, and score it globally.
  document.addEventListener("ana:track", (e) => {
    currentTrack = (e.detail && e.detail.title) || null;
    beat();
    // The server resolves the title from the slug and enforces a per-session
    // cooldown, so we only send the slug.
    if (e.detail && e.detail.slug) {
      client.mutation(api.live.bumpPlay, {
        sessionId, slug: e.detail.slug,
      }).catch(() => {});
    }
  });
  document.addEventListener("ana:stop", () => { currentTrack = null; beat(); });

  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    client.mutation(api.live.leave, { sessionId }).catch(() => {});
  });

  client.onUpdate(api.live.state, {}, (s) => {
    render(s);
    // Announce arrivals, but don't replay history on the first payload.
    const newest = s.recentJoins[0];
    if (firstPayload) {
      firstPayload = false;
      seenJoin = newest ? newest.at : Date.now();
      return;
    }
    for (const j of [...s.recentJoins].reverse()) {
      if (j.at > seenJoin) announce(j);
    }
    if (newest) seenJoin = Math.max(seenJoin, newest.at);
  });
}

/* ---------- UI ---------- */
const $ = (id) => document.getElementById(id);

function render(s) {
  if (!panel) return;
  panel.hidden = false;
  $("floorOnline").textContent = s.online;
  $("floorTotal").textContent = s.visitors.toLocaleString();

  $("floorFlags").innerHTML = "";
  for (const c of s.countries.slice(0, 12)) {
    const el = document.createElement("span");
    el.className = "flag";
    el.title = `${c.country} — ${c.n} online`;
    el.textContent = flagOf(c.code) + (c.n > 1 ? c.n : "");
    $("floorFlags").appendChild(el);
  }

  const ww = $("floorWorld");
  ww.innerHTML = "";
  if (!s.worldwide.length) {
    ww.innerHTML = '<div class="qempty">NOBODY IS PLAYING ANYTHING</div>';
  } else {
    for (const w of s.worldwide.slice(0, 4)) {
      const d = document.createElement("div");
      d.className = "wwrow";
      d.innerHTML = '<span class="wwt"></span><span class="wwn">' +
        (w.n > 1 ? w.n + " LISTENING" : "1 LISTENING") + "</span>";
      d.querySelector(".wwt").textContent = w.title;
      ww.appendChild(d);
    }
  }

  // global leaderboard, alongside the local one
  const g = $("hsGlobal");
  if (g) {
    g.innerHTML = "";
    s.topPlays.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "hsrow";
      d.innerHTML = '<span class="rank">' + (i + 1) +
        ["ST","ND","RD","TH","TH"][i] + '</span><span class="hst"></span>' +
        '<span class="hsc">×' + p.count + "</span>";
      d.querySelector(".hst").textContent = p.title;
      g.appendChild(d);
    });
    if (!s.topPlays.length) {
      g.innerHTML = '<div class="qempty">NO PLAYS WORLDWIDE YET</div>';
    }
  }
}

/** "PLAYER 2 JOINED — ARGENTINA" across the cabinet marquee. */
let announceBusy = false;
const pending = [];
function announce(join) {
  pending.push(join);
  if (!announceBusy) drain();
}
function drain() {
  const el = $("ticker");
  const join = pending.shift();
  if (!el || !join) { announceBusy = false; return; }
  announceBusy = true;
  el.textContent = `PLAYER JOINED — ${join.country.toUpperCase()} ${flagOf(join.code)}`;
  el.classList.add("on");
  document.dispatchEvent(new CustomEvent("ana:joinsound"));
  setTimeout(() => {
    el.classList.remove("on");
    setTimeout(drain, 400);
  }, 3400);
}

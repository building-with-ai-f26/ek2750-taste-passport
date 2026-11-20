// Taste Passport — local prototype server.
// Run with: node --env-file=.env app/server.js   then open http://localhost:3000
//
// This file does five things:
//   1. Serves the web page (app/index.html).
//   2. POST /api/taste   — asks the AI what you love/dislike about each place.
//   3. POST /api/guide   — asks the AI for a city guide based on your taste.
//   4. POST /api/split   — splits a spoken sentence into a place name and a note.
//   5. POST /api/booking — finds a restaurant's real table booking page with one web search.
// Your OpenRouter key is only used here, never sent to the browser.

const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-5.5";
// Web search lets the AI look up current places in the destination, on top of what it already knows.
// Set WEB_SEARCH=off in .env to turn it off (cheaper, but picks come from memory only).
const WEB_SEARCH = process.env.WEB_SEARCH !== "off";
const SEARCH_MAX = Number(process.env.WEB_SEARCH_MAX || 1); // most searches per guide; each one adds cost

if (!API_KEY || API_KEY.includes("replace-with-your-key")) {
  console.error("Missing OPENROUTER_API_KEY. Add it to .env and start with: node --env-file=.env app/server.js");
  process.exit(1);
}

// ---------- AI helper ----------

// When OpenRouter fails, the real reason (e.g. out of credit, key problem) goes to the server log only.
// Visitors get a plain message, so account details never reach the browser.
function aiServiceError(status, data) {
  console.error(`  OpenRouter error ${status}: ${data.error?.message || "no message"}`);
  return new Error("The AI service had a problem. Please try again in a minute.");
}

// Sends one prompt to OpenRouter and returns the reply parsed as JSON.
// With { webSearch: true } the AI may search the web (up to SEARCH_MAX times) before answering.
async function askAI(system, user, { webSearch = false } = {}) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Taste Passport (local prototype)",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 12000, // a guide with web search uses about 5,000–8,000; this caps the cost of any single call
      usage: { include: true }, // asks OpenRouter to report the cost of this call
      ...(webSearch && { tools: [{ type: "openrouter:web_search", parameters: { max_uses: SEARCH_MAX } }] }),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw aiServiceError(res.status, data);

  const cost = data.usage?.cost;
  console.log(`  ${MODEL}${webSearch ? " · web search on" : ""} · ${data.usage?.prompt_tokens} in / ${data.usage?.completion_tokens} out tokens · $${cost ?? "?"}`);

  if (data.choices?.[0]?.finish_reason === "length") console.error("  reply was cut off because it hit max_tokens");

  // The model is told to reply with JSON only; grab the {...} part in case it adds extra text.
  const text = data.choices?.[0]?.message?.content || "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    if (start === -1 || end === -1) throw new Error("no JSON found");
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    // Show where the reply broke, so we can see why (e.g. extra text or citations mixed into the JSON).
    const pos = Number(err.message.match(/position (\d+)/)?.[1] ?? 0) + Math.max(start, 0);
    console.error(`  reply wasn't valid JSON (${err.message}). Text around the problem: …${text.slice(Math.max(pos - 120, 0), pos + 80).replace(/\n/g, "⏎")}…`);
    const formatError = new Error("The AI reply wasn't in the expected format. Try again.");
    formatError.raw = text; // kept so askAIWithRetry can try to repair it
    throw formatError;
  }
}

// Same as askAI, but if the reply comes back as broken JSON, sends it back once (no web search,
// so it's fast and costs under a cent) and asks for the same content as valid JSON.
async function askAIWithRetry(system, user, options) {
  try {
    return await askAI(system, user, options);
  } catch (err) {
    if (!err.raw) throw err;
    console.log("  repairing a broken reply");
    return askAI(
      "You fix broken JSON. Return the same content as valid JSON only, no other text. Keep every field and value; only fix the formatting (quotes, commas, brackets) and remove anything that isn't part of the JSON.",
      err.raw
    );
  }
}

// ---------- Prompts ----------

const TASTE_SYSTEM = `You help people understand their own taste in places (restaurants, bars, cafes, hotels, shops).
For each place, read the person's short note and list what they love about it (for favorites) or dislike about it (for dislikes).

Rules:
- 2 to 4 short phrases per place, each under 8 words, in plain everyday language.
- Stay grounded in the note. You may add what is widely known about the place only if it clearly fits the note.
- Be specific (e.g. "counter seating facing the kitchen", "special without being expensive", "too loud to talk"). Never generic (e.g. "good food", "nice vibe").
- Add one more trait that starts with "Crowd: " and says plainly and specifically who typically goes there: their age, style, budget, and whether they are mostly locals or visitors (e.g. "Crowd: affluent, fashionable locals dressing up for a big night", "Crowd: young artists and musicians on a budget"). Be honest but never insulting.
- Write everything in English.
- Reply with JSON only, no other text, in this shape:
{"places":[{"name":"...","kind":"love" or "dislike","traits":["...","..."]}]}
Keep the places in the same order and with the same names you were given.`;

const GUIDE_SYSTEM = `You are a travel guide who recommends places based on a person's personal taste profile.
You will get their home city, the places they love and dislike at home (what they love or dislike about each, and the crowd that goes there), a destination, and what the trip is for.

Return:
- 1 to 2 neighborhoods to stay in
- 5 places to eat
- 3 places to drink

First, match neighborhoods: for each favorite, note which neighborhood of their home city it is in. Then name the neighborhood in the destination that plays the same role for the same crowd (the place where the same kind of people live, go out and spend time). Choose where to stay, and most of the picks, from these matching neighborhoods.

How to pick:
- Each pick should be where the same crowd that goes to one of their favorites would go in the destination, for the same reason they love that favorite. Think: "what is the destination's version of this place, for these people?"
- Usually tie a pick to one favorite. Use two only when a place clearly fits both.
- Neighborhoods to stay in: where that crowd spends its time in the destination, and where a visitor can actually stay.
- Write the reason as one line naming the favorite and the specific reason, like "Because you love the counter seating at Place X." Only name places from their list. Never generic (e.g. "great food", "popular spot").
- Never recommend anything that matches what they said in their dislikes.
- No single neighborhood should have more than 60% of the eat and drink picks.
- "eat" is for places people mainly go to for a meal; "drink" is for bars and places people mainly go to for drinks.
- Never list the same place twice.
- Only recommend real places you are confident exist in the destination. Do not invent places.
- Fit the picks to what the trip is for.
- If you can search the web, use it (at most ${SEARCH_MAX} ${SEARCH_MAX === 1 ? "search" : "searches"}) to check where the crowd from their favorites actually lives and goes out in the destination today, and to check that your picks exist, are open, and are in the neighborhood you say. Search in English and in the destination's language when useful. Still reply with JSON only.
- Do not include prices, price levels, opening hours, addresses, phone numbers, ratings, or reservation details. Name and neighborhood only.
- Reply with JSON only, no other text, in this shape:
{"areaMatches":[{"favorite":"...","homeNeighborhood":"...","destinationNeighborhood":"..."}],
 "neighborhoods":[{"name":"...","reason":"...","basedOn":"<favorite place name>"}],
 "eat":[{"name":"...","neighborhood":"...","reason":"...","basedOn":"<favorite place name>"}],
 "drink":[{"name":"...","neighborhood":"...","reason":"...","basedOn":"<favorite place name>"}]}`;

const SPLIT_SYSTEM = `Someone spoke a short description of one place (a restaurant, bar, cafe, hotel or shop) in their home city, and speech-to-text turned it into text.
Split it into the place's name and their note about it.

Rules:
- "name": just the place's name. Speech-to-text often misspells names; if it clearly sounds like a well-known place in their home city, use that place's correct spelling (e.g. "bemelman's bar" → "Bemelmans Bar", "she on famous foods" → "Xi'an Famous Foods"). If you're not sure, keep what they said. If they didn't say a name, use "".
- "note": everything else they said about the place, in their own words. Only remove filler like "um", "so", "I'd say" and the name itself. Don't add, summarize or rewrite anything.
- Reply with JSON only, no other text: {"name":"...","note":"..."}`;

// ---------- Request handlers ----------

async function handleTaste(body) {
  const { homeCity, places } = body;
  const loves = (places || []).filter((p) => p.kind === "love");
  const dislikes = (places || []).filter((p) => p.kind === "dislike");
  if (loves.length < 5 || dislikes.length < 2) throw new Error("Add at least 5 favorites and 2 dislikes.");

  const user =
    `Home city: ${homeCity || "not given"}\n\n` +
    places.map((p) => `- [${p.kind}] ${p.name}: ${p.note}`).join("\n");
  return askAI(TASTE_SYSTEM, user);
}

// ---------- Booking links ----------
// For one restaurant, does a single web search and picks the page where people can book a table
// (e.g. OpenTable, Resy, SevenRooms, or the restaurant's own booking page). The link is only used
// if it is one of the pages the search actually returned, so the AI can't make one up.
const BOOKING_SYSTEM = `Search the web once for this restaurant's online table booking page.
Write the search query in the main language of the restaurant's city, including that language's word for reservation (e.g. "reservation" in London, "rezervasyon" in Istanbul, "reserva" in Madrid), so you find the restaurant's own pages rather than travel guides.
Return two links:
- "booking": the result where people can actually book a table: a booking platform page for this exact restaurant (e.g. OpenTable, Resy, SevenRooms, Tock, TheFork) or the restaurant's own reservations page. It must be the exact URL of one of the search results. If none is a booking page, use "".
- "website": the restaurant's own official website (its own domain, not a listing on another site). Use a search result if one is its website; otherwise give the official website only if you are confident of it; else "".
Never use review sites, guides, blogs, maps or social media for either (e.g. Tripadvisor, Michelin Guide, Time Out, Yelp, Google, Instagram).
Reply with JSON only: {"booking":"...","website":"..."}`;
const NOT_BOOKING = ["tripadvisor.", "yelp.", "guide.michelin.", "timeout.com", "google.", "instagram.com", "facebook.com", "wikipedia.", "trip.com", "foursquare.", "zomato."];
const trimSlash = (url) => url.replace(/\/+$/, "");

// Lowercase without accents, so "Mürver" and "murver" match.
const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase();

// True only for an https address whose name points to the public internet. Blocks this computer
// (localhost) and private networks, so nobody can use our server to peek at machines behind it.
async function isPublicHttps(u) {
  if (u.protocol !== "https:" || (u.port && u.port !== "443")) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  return addresses.length > 0 && addresses.every(({ address }) => isPublicIP(address));
}

function isPublicIP(ip) {
  if (ip.toLowerCase().startsWith("::ffff:")) {
    // IPv4 written as IPv6: check the IPv4 part, and refuse the hex spelling (e.g. ::ffff:7f00:1) outright.
    ip = ip.slice(7);
    if (!net.isIPv4(ip)) return false;
  }
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
  }
  const low = ip.toLowerCase();
  return !(low === "::" || low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80"));
}

// Checks a website the AI suggested: it must be a public https page that loads
// and mentions the restaurant's name. This stops made-up addresses.
async function websiteLooksReal(url, name) {
  try {
    // Follow up to 3 redirects by hand, checking every address, so a redirect can't lead to a private one.
    let u = new URL(url);
    let res;
    for (let hops = 0; ; hops++) {
      if (hops > 3 || !(await isPublicHttps(u))) return false;
      res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0" } });
      const next = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !next) break;
      u = new URL(next, u);
    }
    if (!res.ok) return false;
    const page = plain((await res.text()).slice(0, 300000));
    const generic = ["restaurant", "restoran", "lokantasi", "cafe", "bar", "the", "and", "meyhane", "london", "istanbul"];
    const words = plain(name).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !generic.includes(w));
    return words.length > 0 && words.some((w) => page.includes(w));
  } catch {
    return false;
  }
}

async function handleBooking(body) {
  const { name, neighborhood, destination } = body;
  if (!name || !destination) throw new Error("Missing restaurant or city.");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", "X-Title": "Taste Passport (local prototype)" },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-5.5", // always the cheap model: this is a simple pick-from-a-list job
      max_tokens: 500,
      usage: { include: true },
      messages: [
        { role: "system", content: BOOKING_SYSTEM },
        { role: "user", content: [name, neighborhood, destination].filter(Boolean).join(", ") },
      ],
      tools: [{ type: "openrouter:web_search", parameters: { engine: "perplexity", max_uses: 1, max_results: 5 } }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw aiServiceError(res.status, data);

  // The pages the search actually returned, and the links the AI picked.
  const message = data.choices?.[0]?.message || {};
  const found = (message.annotations || []).map((a) => a.url_citation?.url).filter(Boolean).map(trimSlash);
  let picked = {};
  const text = message.content || "";
  try { picked = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch {}
  const allowed = (url) => typeof url === "string" && url.startsWith("http") && !NOT_BOOKING.some((site) => url.includes(site));

  // Booking page: only if the search really returned it.
  const booking = allowed(picked.booking) && found.includes(trimSlash(picked.booking)) ? picked.booking : null;
  // Website: fine if the search returned it; otherwise open it and check it names the restaurant.
  let website = null;
  if (!booking && allowed(picked.website)) {
    const inResults = found.includes(trimSlash(picked.website));
    if (inResults || (await websiteLooksReal(picked.website, name))) website = picked.website;
  }

  console.log(`  links for ${name}: ${booking ? `booking ${booking}` : website ? `website ${website}` : "none found"} · $${data.usage?.cost ?? "?"}`);
  return { url: booking, website };
}

// Splits one spoken sentence like "Carbone, I love the spicy rigatoni" into a name and a note.
async function handleSplit(body) {
  const text = (body.text || "").trim();
  if (!text) throw new Error("Nothing was heard. Try again.");
  if (text.length > 2000) throw new Error("That was too long. Try one place at a time.");
  const user = `Home city: ${body.homeCity || "not given"}\nThis is a place they ${body.kind === "dislike" ? "dislike" : "love"}.\nWhat they said: ${text}`;
  const result = await askAI(SPLIT_SYSTEM, user);
  return { name: String(result.name || "").trim(), note: String(result.note || "").trim() };
}

const MAX_AREA_SHARE = 0.6; // no neighborhood should have more than 60% of the eat + drink picks
const listOf = (list) => (Array.isArray(list) ? list : []);
const pickCount = (guide) => listOf(guide.eat).length + listOf(guide.drink).length;

// Returns a list of plain-English problems with a guide (empty list = good).
function guideProblems(guide) {
  const problems = [];
  const eat = listOf(guide.eat).length;
  const drink = listOf(guide.drink).length;
  if (eat < 4 || drink < 2 || listOf(guide.neighborhoods).length < 1) {
    problems.push(`It had ${eat} places to eat and ${drink} places to drink; return 5 places to eat and 3 places to drink.`);
  }
  // Count picks per area. "Kadıköy (Moda)" and "Kadıköy" count as the same area.
  const areas = {};
  for (const p of [...listOf(guide.eat), ...listOf(guide.drink)]) {
    const area = String(p.neighborhood || "").split(/[(,]/)[0].trim();
    if (area) areas[area] = (areas[area] || 0) + 1;
  }
  const total = pickCount(guide);
  for (const [area, n] of Object.entries(areas)) {
    if (total && n / total > MAX_AREA_SHARE) {
      problems.push(`${n} of ${total} eat and drink picks are in ${area}; keep it to 60% or less by moving some to other neighborhoods that fit this person.`);
    }
  }
  return problems;
}

async function handleGuide(body) {
  const { homeCity, places, destination, purpose } = body;
  if (!destination || !purpose) throw new Error("Add a destination and what the trip is for.");
  if (!Array.isArray(places) || !places.every((p) => p && Array.isArray(p.traits))) throw new Error("Read your taste first, then make the guide.");

  const describe = (kind) =>
    places
      .filter((p) => p.kind === kind)
      .map((p) => `- ${p.name}: ${p.traits.join("; ")}`)
      .join("\n");
  const user =
    `Home city: ${homeCity || "not given"}\n\n` +
    `PLACES THEY LOVE (and why):\n${describe("love")}\n\n` +
    `PLACES THEY DISLIKE (and why) — avoid anything like these:\n${describe("dislike")}\n\n` +
    `Destination: ${destination}\nWhat the trip is for: ${purpose}`;

  let guide = await askAIWithRetry(GUIDE_SYSTEM, user, { webSearch: WEB_SEARCH });

  // Check the guide against two product rules, and if either fails, ask the AI once more
  // and say exactly what to fix: (1) enough picks, (2) no area has more than 60% of them.
  let problems = guideProblems(guide);
  if (problems.length) {
    console.log(`  guide needs fixing (${problems.join(" ")}), asking again`);
    const retry = await askAIWithRetry(
      GUIDE_SYSTEM,
      user + `\n\nYour last answer had these problems: ${problems.join(" ")} Fix them and return the full guide again.`,
      { webSearch: WEB_SEARCH }
    );
    // Keep the retry unless it's worse (more problems, or fewer picks with the same problems).
    const retryProblems = guideProblems(retry);
    if (retryProblems.length < problems.length || (retryProblems.length === problems.length && pickCount(retry) > pickCount(guide))) guide = retry;
  }

  // Enforce the size limits and mark every pick as unverified (we don't check places exist yet).
  const clean = (list, max) => (Array.isArray(list) ? list.slice(0, max) : []).map((p) => ({ ...p, verified: false }));
  return {
    areaMatches: Array.isArray(guide.areaMatches) ? guide.areaMatches : [],
    neighborhoods: clean(guide.neighborhoods, 2),
    eat: clean(guide.eat, 5),
    drink: clean(guide.drink, 3),
  };
}

// ---------- Web server ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100_000) {
        reject(new Error("Request too large"));
        req.destroy(); // stop reading, so a huge upload can't fill the server's memory
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("Invalid JSON")); }
    });
  });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const routes = { "/api/taste": handleTaste, "/api/guide": handleGuide, "/api/split": handleSplit, "/api/booking": handleBooking };

// ---------- Rate limits (protect the OpenRouter bill) ----------
// Every /api/ request counts, whether or not it reaches the AI. A guide counts as 4, because one guide
// request can make up to 4 AI calls with web search (fix-up retries); everything else counts as 1.
// 1. Per visitor: at most 25 in 10 minutes. One full run (voice for 10 places, taste reading,
//    guide, 5 booking links) is about 20, so a real person rarely hits this.
// 2. Whole app: at most 400 a day from everyone together (about 20 full runs, roughly $1; at worst
//    about $4 if it were all guides), a backstop in case someone gets around the per-visitor limit.
// Counts live in memory, so they reset when the server restarts.
const COST = { "/api/guide": 4 };
const VISITOR_LIMIT = Number(process.env.VISITOR_LIMIT || 25); // raise locally for the persona script
const VISITOR_WINDOW_MS = 10 * 60 * 1000;
const DAILY_LIMIT = 400;
const visitors = new Map(); // visitor IP -> { count, resetAt }
let daily = { count: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 };

// On Render the visitor's IP arrives in the X-Forwarded-For header; locally it's the direct connection.
function visitorIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return forwarded ? forwarded.split(",")[0].trim() : req.socket.remoteAddress;
}

// Returns null if the request may go ahead, or { seconds, message } if it's over a limit.
function checkRateLimit(req) {
  const cost = COST[req.url] || 1;
  const now = Date.now();
  if (now > daily.resetAt) daily = { count: 0, resetAt: now + 24 * 60 * 60 * 1000 };
  if (daily.count + cost > DAILY_LIMIT) {
    return { seconds: Math.ceil((daily.resetAt - now) / 1000), message: "Taste Passport is taking a break for today. Please try again tomorrow." };
  }
  const ip = visitorIP(req);
  let v = visitors.get(ip);
  if (!v || now > v.resetAt) v = { count: 0, resetAt: now + VISITOR_WINDOW_MS };
  if (v.count + cost > VISITOR_LIMIT) {
    const seconds = Math.ceil((v.resetAt - now) / 1000);
    return { seconds, message: `You've made a lot of requests. Please wait ${Math.ceil(seconds / 60)} minutes and try again.` };
  }
  v.count += cost;
  daily.count += cost;
  visitors.set(ip, v);
  return null;
}

// Forget visitors whose 10 minutes are up, so the list doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, v] of visitors) if (now > v.resetAt) visitors.delete(ip);
}, VISITOR_WINDOW_MS).unref();

http
  .createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff", // browsers must treat the page as exactly what we say it is
        "X-Frame-Options": "DENY", // other sites can't show our page inside theirs to trick clicks
        "Referrer-Policy": "strict-origin-when-cross-origin", // links out don't reveal full page addresses
      });
      return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    }
    const handler = routes[req.url];
    if (req.method === "POST" && handler) {
      const limited = checkRateLimit(req);
      if (limited) {
        console.log(`${req.url} blocked by rate limit (429)`);
        res.setHeader("Retry-After", String(limited.seconds));
        return sendJSON(res, 429, { error: limited.message });
      }
      try {
        console.log(`${req.url}`);
        sendJSON(res, 200, await handler(await readBody(req)));
      } catch (err) {
        console.error("  error:", err.message);
        sendJSON(res, 400, { error: err.message });
      }
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  })
  // 0.0.0.0 = accept connections from outside this computer (needed on Render; locally it changes nothing).
  .listen(PORT, "0.0.0.0", () => console.log(`Taste Passport running at http://localhost:${PORT} (model: ${MODEL}, web search: ${WEB_SEARCH ? `on, up to ${SEARCH_MAX}` : "off"})`));

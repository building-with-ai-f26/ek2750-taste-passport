// Taste Passport — local prototype server.
// Run with: node --env-file=.env app/server.js   then open http://localhost:3000
//
// This file does four things:
//   1. Serves the web page (app/index.html).
//   2. POST /api/taste  — asks the AI what you love/dislike about each place.
//   3. POST /api/guide  — asks the AI for a city guide based on your taste.
//   4. POST /api/split  — splits a spoken sentence into a place name and a note.
// Your OpenRouter key is only used here, never sent to the browser.

const http = require("http");
const fs = require("fs");
const path = require("path");

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
      max_tokens: 6000, // a full guide uses about 3,000; this caps the cost of any single call
      usage: { include: true }, // asks OpenRouter to report the cost of this call
      ...(webSearch && { tools: [{ type: "openrouter:web_search", parameters: { max_uses: SEARCH_MAX } }] }),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenRouter error ${res.status}`);

  const cost = data.usage?.cost;
  console.log(`  ${MODEL}${webSearch ? " · web search on" : ""} · ${data.usage?.prompt_tokens} in / ${data.usage?.completion_tokens} out tokens · $${cost ?? "?"}`);

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
- 3 to 5 places to eat
- 2 to 3 places to drink

First, match neighborhoods: for each favorite, note which neighborhood of their home city it is in. Then name the neighborhood in the destination that plays the same role for the same crowd (the place where the same kind of people live, go out and spend time). Choose where to stay, and most of the picks, from these matching neighborhoods.

How to pick:
- Each pick should be where the same crowd that goes to one of their favorites would go in the destination, for the same reason they love that favorite. Think: "what is the destination's version of this place, for these people?"
- Usually tie a pick to one favorite. Use two only when a place clearly fits both.
- Neighborhoods to stay in: where that crowd spends its time in the destination, and where a visitor can actually stay.
- Write the reason as one line naming the favorite and the specific reason, like "Because you love the counter seating at Place X." Only name places from their list. Never generic (e.g. "great food", "popular spot").
- Never recommend anything that matches what they said in their dislikes.
- Don't put more than half of the eat and drink picks in one neighborhood.
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

// Splits one spoken sentence like "Carbone, I love the spicy rigatoni" into a name and a note.
async function handleSplit(body) {
  const text = (body.text || "").trim();
  if (!text) throw new Error("Nothing was heard. Try again.");
  if (text.length > 2000) throw new Error("That was too long. Try one place at a time.");
  const user = `Home city: ${body.homeCity || "not given"}\nThis is a place they ${body.kind === "dislike" ? "dislike" : "love"}.\nWhat they said: ${text}`;
  const result = await askAI(SPLIT_SYSTEM, user);
  return { name: String(result.name || "").trim(), note: String(result.note || "").trim() };
}

async function handleGuide(body) {
  const { homeCity, places, destination, purpose } = body;
  if (!destination || !purpose) throw new Error("Add a destination and what the trip is for.");

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

  // If the guide came back too short, ask the AI once more and say exactly what was missing.
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  if (count(guide.eat) < 3 || count(guide.drink) < 2 || count(guide.neighborhoods) < 1) {
    console.log(`  guide too short (${count(guide.eat)} eat, ${count(guide.drink)} drink), asking again`);
    const retry = await askAIWithRetry(
      GUIDE_SYSTEM,
      user + `\n\nYour last answer was too short: it had ${count(guide.eat)} places to eat and ${count(guide.drink)} places to drink. Return at least 3 places to eat and at least 2 places to drink.`,
      { webSearch: WEB_SEARCH }
    );
    // Keep whichever answer has more picks.
    if (count(retry.eat) + count(retry.drink) > count(guide.eat) + count(guide.drink)) guide = retry;
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
      if (data.length > 100_000) reject(new Error("Request too large"));
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

const routes = { "/api/taste": handleTaste, "/api/guide": handleGuide, "/api/split": handleSplit };

http
  .createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    }
    const handler = routes[req.url];
    if (req.method === "POST" && handler) {
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
  .listen(PORT, () => console.log(`Taste Passport running at http://localhost:${PORT} (model: ${MODEL}, web search: ${WEB_SEARCH ? `on, up to ${SEARCH_MAX}` : "off"})`));

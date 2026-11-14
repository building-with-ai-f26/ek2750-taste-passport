// Taste Passport — local prototype server.
// Run with: node --env-file=.env app/server.js   then open http://localhost:3000
//
// This file does three things:
//   1. Serves the web page (app/index.html).
//   2. POST /api/taste  — asks the AI what you love/dislike about each place.
//   3. POST /api/guide  — asks the AI for a city guide based on your taste.
// Your OpenRouter key is only used here, never sent to the browser.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-5.5";

if (!API_KEY || API_KEY.includes("replace-with-your-key")) {
  console.error("Missing OPENROUTER_API_KEY. Add it to .env and start with: node --env-file=.env app/server.js");
  process.exit(1);
}

// ---------- AI helper ----------

// Sends one prompt to OpenRouter and returns the reply parsed as JSON.
async function askAI(system, user) {
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
      usage: { include: true }, // asks OpenRouter to report the cost of this call
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenRouter error ${res.status}`);

  const cost = data.usage?.cost;
  console.log(`  ${MODEL} · ${data.usage?.prompt_tokens} in / ${data.usage?.completion_tokens} out tokens · $${cost ?? "?"}`);

  // The model is told to reply with JSON only; grab the {...} part in case it adds extra text.
  const text = data.choices?.[0]?.message?.content || "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The AI reply wasn't in the expected format. Try again.");
  return JSON.parse(text.slice(start, end + 1));
}

// ---------- Prompts ----------

const TASTE_SYSTEM = `You help people understand their own taste in places (restaurants, bars, cafes, hotels, shops).
For each place, read the person's short note and list what they love about it (for favorites) or dislike about it (for dislikes).

Rules:
- 2 to 4 short phrases per place, each under 8 words, in plain everyday language.
- Stay grounded in the note. You may add what is widely known about the place only if it clearly fits the note.
- Be specific (e.g. "counter seating facing the kitchen", "special without being expensive", "too loud to talk"). Never generic (e.g. "good food", "nice vibe").
- Reply with JSON only, no other text, in this shape:
{"places":[{"name":"...","kind":"love" or "dislike","traits":["...","..."]}]}
Keep the places in the same order and with the same names you were given.`;

const GUIDE_SYSTEM = `You are a travel guide who recommends places based on a person's personal taste profile.
You will get their home city, the places they love and dislike at home with the reasons why, a destination, and what the trip is for.

Work in three steps.

STEP 1: Understand the whole person first.
Look across ALL their favorites together and write a taste summary:
- "vibe": one or two sentences describing the kind of places this person likes overall.
- "patterns": 3 to 5 things that show up in several of their favorites (e.g. "small and unfussy", "a creative crowd", "dressed-up glamour", "cheap and fast").
- "avoid": 3 to 5 things to stay away from, taken from their dislikes and the reasons they gave.
A single favorite that doesn't match the rest is an exception, not the main taste. Don't build the guide around it.

STEP 2: Pick places that fit the whole summary.
Return 2 neighborhoods to stay in, 3 to 5 places to eat, and 2 to 3 places to drink.
- Only recommend real places you are confident exist in the destination. Do not invent places.
- Every pick must fit the overall vibe and patterns, not just one favorite. Write the reason as one short line that names the pattern it fits, and mention one or two of THIS person's favorites it's like, e.g. "Small, unfussy counter spot, like <favorite A> and <favorite B>." Only name places from their list. Never generic (e.g. "great food", "popular spot").
- Choose neighborhoods the way a local with this person's taste would, not the way a guidebook would. Don't default to the most famous tourist areas unless they truly fit this person.
- Use specific neighborhood names a local would use (e.g. a single neighborhood, not a whole district that contains several).
- Never list the same place twice.
- Spread the eat and drink picks across at least 3 different neighborhoods, with no more than half of them in any one neighborhood. Keep some picks near where they're staying so the trip is practical.
- Fit the picks to what the trip is for.
- Do not include prices, price levels, opening hours, addresses, phone numbers, ratings, or reservation details. Name and neighborhood only.

STEP 3: Check before you answer.
Go through every pick and compare it with the "avoid" list. If a place is known for anything on that list (e.g. loud, sceney, touristy, pricey, divey), replace it with one that fits. Also check that you have at least 3 places to eat, at least 2 places to drink, and at least 3 different neighborhoods.

Reply with JSON only, no other text, in this shape:
{"tasteSummary":{"vibe":"...","patterns":["..."],"avoid":["..."]},
 "neighborhoods":[{"name":"...","reason":"...","basedOn":"<one or two favorite place names>"}],
 "eat":[{"name":"...","neighborhood":"...","reason":"...","basedOn":"<one or two favorite place names>"}],
 "drink":[{"name":"...","neighborhood":"...","reason":"...","basedOn":"<one or two favorite place names>"}]}`;

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

  let guide = await askAI(GUIDE_SYSTEM, user);

  // If the guide came back too short, ask the AI once more and say exactly what was missing.
  const count = (list) => (Array.isArray(list) ? list.length : 0);
  if (count(guide.eat) < 3 || count(guide.drink) < 2 || count(guide.neighborhoods) < 1) {
    console.log(`  guide too short (${count(guide.eat)} eat, ${count(guide.drink)} drink), asking again`);
    const retry = await askAI(
      GUIDE_SYSTEM,
      user + `\n\nYour last answer was too short: it had ${count(guide.eat)} places to eat and ${count(guide.drink)} places to drink. Return at least 3 places to eat and at least 2 places to drink.`
    );
    // Keep whichever answer has more picks.
    if (count(retry.eat) + count(retry.drink) > count(guide.eat) + count(guide.drink)) guide = retry;
  }

  // Enforce the size limits and mark every pick as unverified (we don't check places exist yet).
  const clean = (list, max) => (Array.isArray(list) ? list.slice(0, max) : []).map((p) => ({ ...p, verified: false }));
  return {
    tasteSummary: guide.tasteSummary || null,
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

const routes = { "/api/taste": handleTaste, "/api/guide": handleGuide };

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
  .listen(PORT, () => console.log(`Taste Passport running at http://localhost:${PORT} (model: ${MODEL})`));

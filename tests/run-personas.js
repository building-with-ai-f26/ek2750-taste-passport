// Runs every persona in tests/personas/ through the app, for London and Istanbul,
// and writes the guides into one Markdown file you can read and score.
//
// 1. Start the app in one terminal:   node --env-file=.env app/server.js
// 2. In another terminal run:         node tests/run-personas.js baseline
//    ("baseline" is just a label for the results file; use e.g. "after-prompt-fix" next time.)
//
// Each full run (3 personas x 2 cities) makes 12 AI calls, about $0.02 in total.

const fs = require("fs");
const path = require("path");

const APP = process.env.APP_URL || "http://localhost:3000";
const DESTINATIONS = ["London", "Istanbul"];
const label = process.argv[2] || "run";

async function post(url, body) {
  const res = await fetch(APP + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Turns one section of the guide into a Markdown table with empty score columns.
function table(title, picks) {
  let out = `**${title}**\n\n| Pick | Why the app chose it | Real place? | Would they like it? | Clashes with a dislike? |\n|---|---|---|---|---|\n`;
  for (const p of picks) {
    const where = p.neighborhood ? ` (${p.neighborhood})` : "";
    out += `| ${p.name}${where} | ${p.reason} | | | |\n`;
  }
  return out + "\n";
}

async function main() {
  const dir = path.join(__dirname, "personas");
  const personas = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

  const date = new Date().toISOString().slice(0, 10);
  let md = `# Persona run: ${label} (${date})\n\nFill in the three right-hand columns with yes / no. Target: at least 7 of 10 picks each persona would like, and zero clashes with a dislike.\n\n`;

  for (const persona of personas) {
    const places = [...persona.places, ...persona.dislikes];
    console.log(`${persona.persona}: reading taste...`);
    const taste = await post("/api/taste", { homeCity: persona.homeCity, places });

    md += `## ${persona.persona}\n\n${persona.about}\n\n**What the app thinks they like:**\n\n`;
    for (const p of taste.places) md += `- ${p.kind === "love" ? "Loves" : "Dislikes"} ${p.name}: ${p.traits.join("; ")}\n`;
    md += "\n";

    for (const destination of DESTINATIONS) {
      console.log(`  ...guide for ${destination}`);
      const guide = await post("/api/guide", { homeCity: persona.homeCity, places: taste.places, destination, purpose: persona.purpose });
      md += `### ${destination}\n\n` + table("Stay", guide.neighborhoods) + table("Eat", guide.eat) + table("Drink", guide.drink);
      md += `Score: __ of ${guide.neighborhoods.length + guide.eat.length + guide.drink.length} picks they'd like · __ dislike clashes · __ places that don't exist\n\n`;
    }
  }

  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${date}-${label}.md`);
  fs.writeFileSync(file, md);
  console.log(`\nSaved: ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error("Failed:", err.message, "\n(Is the app running at " + APP + "?)");
  process.exit(1);
});

# Taste Passport
Turns the places you love at home into a personalized travel guide for a new city.

## Rules
- Small changes. Commit after each working step with a clear message.
- Never commit secrets. Keys live in .env, which is listed in .gitignore.
- Before saying "done", run the app and tell me how you verified it.
- Keep docs/index.html (Product Page with PRD and build log) up to date.
- If a task gets big or confusing, stop and propose a smaller slice.
- Only build what I ask for in the current task. Don't add extra features.
- I'm new to coding, so explain what you changed in plain English.

## Project structure
```
app/
  server.js        Node server (no packages). Serves the page and calls OpenRouter.
                   POST /api/taste  → reads what you love/dislike about each place (+ the crowd)
                   POST /api/guide  → makes the city guide (with web search)
  index.html       The app's single page: places form → taste cards → trip → guide.
docs/
  index.html       Product Page on GitHub Pages: PRD, prototype screenshots, costs, build log.
  images/          Screenshots used on the Product Page.
tests/
  personas.md      Three test personas (Mara, Brooke, Sam) to copy into the app by hand.
  personas/*.json  Same personas as data, used by the script below.
  run-personas.js  Runs every persona through the app for London and Istanbul.
  results/         One Markdown file per run, with empty score columns to fill in.
.env.example       Template for .env (copy it, add your key).
```
Not used by the app: `Intent.md`, `Plan.md`, `journal/`, `SPONSOR_MEMO.md` (course templates).

## Set up (first time)
1. Install Node.js 20 or newer (`node --version` to check). There are no packages to install.
2. Copy the settings template: `cp .env.example .env`
3. Put a real OpenRouter key in `.env` (`OPENROUTER_API_KEY=sk-or-v1-...`). Make sure the key has credit and a spending limit above a few dollars.

## Run locally
- Start: `node --env-file=.env app/server.js`, then open http://localhost:3000
- The terminal prints the model, whether web search is on, and the tokens and cost of every AI call.
- Stop with Ctrl+C. Restart after changing `server.js` or `.env`.

## Settings (in .env)
- `OPENROUTER_MODEL`: default `anthropic/claude-haiku-5.5`.
- `WEB_SEARCH_MAX`: web searches per guide, default `1`. `WEB_SEARCH=off` turns search off.
- Default is Haiku + 1 search, about $0.015 per user run (one taste reading + one guide).
- Tested alternative: Sonnet + 1 search (`OPENROUTER_MODEL=anthropic/claude-sonnet-5.5`), about $0.11 per run, slightly better picks in some cities.

## Test with personas
1. Start the app (above).
2. In a second terminal: `node tests/run-personas.js <label>`, e.g. `node tests/run-personas.js after-my-change`
3. Read `tests/results/<date>-<label>.md` and score each pick. A full run costs about $0.10 on the default settings.
- To test another model without touching `.env`, run a second server on another port, e.g.
  `env OPENROUTER_MODEL=anthropic/claude-sonnet-5.5 PORT=3001 node --env-file=.env app/server.js`
  then `APP_URL=http://localhost:3001 node tests/run-personas.js sonnet-test`

## What we learned about prompts (don't undo these)
- Keep picks tied to specific favorites and the crowd that goes there. Abstract taste summaries ("polished, buzzy") made picks generic and made different people's guides look alike.
- No blanket rules like "central", "not touristy" or "walkable". Every steer must come from the person's own places, notes and dislikes.
- Don't put example words in prompts that the AI could copy into someone's profile (e.g. "sceney").

## Weekly build (due Monday noon)
- Add a build log entry covering what works, what I learned, what broke or changed, costs, and hours.

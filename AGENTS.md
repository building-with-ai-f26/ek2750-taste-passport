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

## Rules from real mistakes
- Wait for my answer before acting on a choice that's mine, including commits and pushes. A yes for
  one thing doesn't cover the next. (Nov 20: the agent started to commit and push without being
  asked, and a safety check stopped it. Later the same day, it wrote rules into this file before I
  had picked them.)
- Don't add blanket rules to the AI prompts like "stay central" or "not touristy". Every steer must
  come from the person's own places, notes and dislikes. (Nov 14: these rules sent Brooke's London
  guide away from Chelsea, Kensington and Soho, the areas her crowd actually goes.)
- Before any paid run (persona script, live AI calls), say what it will cost and wait for my OK.
  Never re-run a paid run just to see its output again; read the saved results file. (Nov 14–15:
  the agent re-ran the same paid persona runs 2–3 times in a row to re-read results, adding to a
  $3.61 week.)

## Project structure
```
app/
  server.js        Node server (no packages). Serves the page and calls OpenRouter.
                   POST /api/taste   → reads what you love/dislike about each place (+ the crowd)
                   POST /api/guide   → makes the city guide (with web search), then checks it:
                                       5 eat / 3 drink, no neighborhood over 60%, retries once if not
                   POST /api/split   → voice input: splits "Carbone, I love the rigatoni" into name + note
                   POST /api/booking → finds a restaurant's real booking page (one search per restaurant),
                                       falls back to its own website; only uses links the search returned
  index.html       The app's single page: places form (typed or spoken) → taste cards → trip → guide
                   with Map / Book a table / Website / Find a hotel links.
                   Optional account (Supabase, email + password): save places per home city,
                   guides saved as trips. Talks to Supabase directly with the public key;
                   Row Level Security keeps each person's rows private. Guests use it as before.
docs/
  index.html       Product Page on GitHub Pages: PRD, prototype screenshots, costs, build log.
  images/          Screenshots used on the Product Page.
tests/
  personas.md      Three test personas (Mara, Brooke, Sam) to copy into the app by hand.
  personas/*.json  Same personas as data, used by the script below.
  run-personas.js  Runs every persona through the app for London and Istanbul.
  results/         One Markdown file per run, with empty score columns to fill in.
  rate-limit-test.sh  Security test: 30 calls in a row should hit 429 (free, no AI calls).
  account-isolation-test.js  Security test: Account B can't read/change Account A's data (free).
                   Run: node --env-file=tests/.env.test tests/account-isolation-test.js
                   (tests/.env.test holds the two throwaway test accounts; git ignores it)
supabase/
  schema.sql       The database: place_lists + trips, Row Level Security on both. Already run
                   once in Supabase's SQL Editor; any change to the database goes here first.
.env.example       Template for .env (copy it, add your key).
package.json       No packages. Tells Render to use Node 20+ and how to start the app.
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
- Default is Haiku + 1 search: about $0.018 for the taste reading + guide, plus about $0.028 for the
  booking link searches (always Haiku, 5 restaurants), so about $0.05 per user run in total.
- Tested alternative: Sonnet + 1 search (`OPENROUTER_MODEL=anthropic/claude-sonnet-5.5`), about $0.11 per run for the guide alone, slightly better picks in some cities.
- Rate limits (in `server.js`): each visitor gets 25 `/api/` requests per 10 minutes, and the whole app
  400 a day; after that the server answers `429`. A guide request counts as 4 (it can make up to 4 AI
  calls). Counts reset when the server restarts. Security details: `SECURITY.md`.
  Test for free: `bash tests/rate-limit-test.sh` (live site) or `bash tests/rate-limit-test.sh http://localhost:3000`.
  It sends 30 empty POSTs to `/api/split`, which fail input checks before any AI call. Afterwards your
  network is blocked from the AI features for 10 minutes.
  One persona-script run counts 27 (3 taste + 6 guides × 4), over the limit: see "Test with personas".
- Voice input needs Chrome, Safari or Edge (the browser does speech-to-text). The speak button doesn't appear in Firefox.

## Test with personas
1. Start the app with a higher per-visitor limit, because one run counts 27 against the usual 25:
   `env VISITOR_LIMIT=100 node --env-file=.env app/server.js` (never set this on Render).
2. In a second terminal: `node tests/run-personas.js <label>`, e.g. `node tests/run-personas.js after-my-change`
3. Read `tests/results/<date>-<label>.md` and score each pick. A full run costs about $0.10 on the default settings.
- To test another model without touching `.env`, run a second server on another port, e.g.
  `env OPENROUTER_MODEL=anthropic/claude-sonnet-5.5 PORT=3001 node --env-file=.env app/server.js`
  then `APP_URL=http://localhost:3001 node tests/run-personas.js sonnet-test`

## What we learned about prompts (don't undo these)
- Keep picks tied to specific favorites and the crowd that goes there. Abstract taste summaries ("polished, buzzy") made picks generic and made different people's guides look alike.
- No blanket rules like "central", "not touristy" or "walkable". Every steer must come from the person's own places, notes and dislikes.
- Don't put example words in prompts that the AI could copy into someone's profile (e.g. "sceney").

## Shipping (live app on Render)
Live app: https://taste-passport-7jya.onrender.com
The live app runs on Render's free web service. Render deploys whatever is on `main` on GitHub,
not what is on this laptop.

First time only (Esra does these in the Render dashboard; the agent never touches the dashboard):
1. dashboard.render.com → New → Web Service → connect `building-with-ai-f26/ek2750-taste-passport`.
2. Language: Node. Branch: `main`. Build command: `npm install` (not `yarn install`: Render's Node 26
   has no yarn, and the build fails with status 127, "command not found").
   Start command: `node app/server.js`. Instance type: Free.
3. Environment Variables: add `OPENROUTER_API_KEY` using a separate key made just for the live app,
   with a small credit limit. Never paste the local `.env` key.
4. Deploy and watch the build log until it says it is live, then open the onrender.com link on a phone.
5. Keep it awake: in a free uptime pinger (UptimeRobot or cron-job.org, Esra's own account), check the
   onrender.com link every 5–10 minutes. It only loads the page, so it costs no AI money and sends no
   PostHog events. One always-awake free service uses about 744 of Render's 750 free hours a month.

Every change after that:
1. Run the app locally (`node --env-file=.env app/server.js`) and click through the changed part.
2. Show Esra the diff and wait for "commit". Commit and push only when Esra says so.
3. After the push, Render redeploys on its own (a few minutes). Open the live URL and check the change.
4. Tell Esra what is live and what you checked.
- If the live site breaks, copy the error from Render's Logs tab before changing code.
- Free Render services sleep after 15 idle minutes; the first visit after that takes about a minute.

## Ask me first
Stop and ask Esra before doing any of these:
- Committing or pushing to GitHub (pushing to `main` changes the live site).
- Deleting files, data or git history (`rm`, `git reset --hard`, force push).
- Changing the database: new tables, policies or SQL of any kind. Write it in `supabase/schema.sql`,
  show Esra, and Esra runs it in Supabase. Never delete users' rows or turn Row Level Security off.
- Anything with keys, secrets or permissions: `.env`, Render environment variables, OpenRouter keys,
  repo settings.
- Anything that costs money: running the persona script, repeated live AI calls, switching to a
  pricier model or raising `WEB_SEARCH_MAX`. Say the expected cost first.

## Weekly build (due Monday noon)
- Add a build log entry covering what works, what I learned, what broke or changed, costs, and hours.

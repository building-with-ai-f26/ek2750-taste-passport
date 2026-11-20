# Security audit

Taste Passport · Build 3 · Beginner lane · audited November 20, 2026

Live app: https://taste-passport-7jya.onrender.com (Render free web service)

## My kind of app

**App with sign-in** (optional), plus AI.

- **Guests** can use the whole app without an account: they type or speak their places, and my server
  sends them to OpenRouter (Claude Haiku 5.5 plus web search) and returns a guide. Guests save nothing.
- **Signed-in people** (email + password through Supabase) can save their places for each home city,
  with their taste reading, and every guide they make is saved as a trip.
- **Data:** Supabase (Postgres, free plan) with two tables, `place_lists` and `trips`. Both have
  **Row Level Security on**, and every policy says the same thing: a signed-in person can read, add,
  change and delete only their own rows. Visitors who aren't signed in get nothing. The table design
  is in `supabase/schema.sql`.
- **Keys:** the OpenRouter key lives only on the server (Render's environment variables). The page
  holds two public keys that are meant to be public: Supabase's publishable key (`sb_publishable_…`;
  Row Level Security decides what it can do) and PostHog's `phc_` key. Supabase's secret key isn't
  used anywhere.

Hosting: Render free web service (Node, no packages).

## What I checked

| # | Check | How | Result |
|---|---|---|---|
| 1 | Access control (app with sign-in): Account B tries to read Account A's data | `node --env-file=tests/.env.test tests/account-isolation-test.js` signs in two throwaway test accounts. A saves a place list and a trip, then B tries to read, change, delete and forge them | **12/12 passed (Nov 20).** B sees 0 of A's rows (also when asking by A's trip id), B's edit and delete change 0 rows, B saving a trip under A's account is refused (`403`), A's data is unchanged. Not signed in: reading and saving are refused (`401`). Screenshot submitted. |
| 1b | Access control: AI routes | `bash tests/rate-limit-test.sh` sends 30 requests in a row to `/api/split` on the live site | **Live, Nov 20:** calls 1–25 allowed, calls 26–30 got `429 Too Many Requests`. The requests are empty, so the test never reaches the AI and costs $0. |
| 2 | Secret keys stay on the server | Searched every file in the repo, the full git history, and the live page for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_` and my own key | Only placeholders in the repo (`.env.example`, setup notes in `AGENTS.md`). `.env` and `tests/.env.test` (the test accounts) are ignored by git and were never committed. **Live page: no secret keys,** only the public Supabase and PostHog keys. Asking the live site for `/.env`, `/app/server.js` or `/package.json` returns 404. |
| 3 | File storage private | — | Doesn't apply: the app stores no files. |
| 4 | Production out of my agent's reach | **Ask me first** list in `AGENTS.md`; manual backup | The agent must ask before committing or pushing (a push to `main` changes the live site), deleting anything, changing the database (it writes SQL in `supabase/schema.sql` and I run it myself), touching keys or settings, or spending money. **Backup:** Supabase's free plan has no automatic backups, so I exported both tables as CSV from the Table Editor on Nov 20 and keep them outside the repo. |
| 5 | Spending caps and rate limits | Rate limits in `server.js`; key limits on OpenRouter; caps in the database | AI routes: 25 requests per visitor per 10 minutes (a guide counts as 4) and 400 a day for the whole app. The live app uses its own OpenRouter key with a **$5 limit**; auto top-up is off. Database writes: at most 20 saved cities and 100 trips per account, and size limits on every saved field, so one account can't fill the free 500 MB database. |
| 6 | Dependencies | `npm audit` | **0 vulnerabilities.** The server uses no outside packages. The page loads one library, Supabase's, from a CDN pinned to version 2.119.0 with an integrity check, so the browser refuses a changed copy. |
| 7 | Agent security review | Asked Claude Code to read the server and page code and try to break the app, twice: before accounts and after | 7 issues found, all fixed and tested (below). |

## What I found

The agent review (check 7) found:

1. **No rate limit.** Anyone could call the AI routes endlessly and run up my OpenRouter bill.
2. **Huge uploads could fill the server's memory.** The server refused requests over 100 KB but kept
   reading the rest of the upload anyway.
3. **The server could be pointed at private addresses (SSRF).** To check that a restaurant website is
   real, the server opens the site the AI suggests. A visitor could type a trick restaurant name to steer
   the AI toward an internal address. The old check missed several private ranges (for example 172.16–31.x
   and IPv6 local addresses) and followed redirects without checking where they went.
4. **OpenRouter error messages went straight to the browser.** These can include account details, such
   as being out of credit.
5. **A guide request with missing data showed a raw code error** instead of a plain message.
6. **No basic security headers** on the page (protection against content-type confusion, other sites
   framing the page, and leaking full page addresses).
7. **Saved trips trusted their links (found after adding accounts).** A reopened trip puts its booking
   and website links back on the page straight from the database. Someone who edited their own saved
   trip through the database could plant a `javascript:` link. It could only affect their own account,
   but it's blocked now.

Checked and fine:
- **Account isolation:** Row Level Security on both tables, tested with two accounts (check 1).
- **Injected code on the page (XSS):** everything the AI writes and everything loaded from the database
  goes on the page as plain text, never as HTML. Map and search links are built with proper encoding.
- **Files:** the server only ever serves `app/index.html`, so nobody can ask it for other files (like `.env`).
- **The API key:** only used in server code. The browser only talks to my own `/api/` routes and to Supabase.

## What I fixed

| Issue | Fix | Tested |
|---|---|---|
| 1. No rate limit | Per-visitor limit (25 per 10 min, guide = 4) and app-wide daily limit (400), answering `429` with a friendly message and a `Retry-After` header | 30 calls → `429` from call 26, locally and live |
| 2. Huge uploads | The server stops reading as soon as a request passes 100 KB | Sent a 3 MB upload; the connection was cut and the server kept running |
| 3. Private addresses | Every website check looks up where the address really points and refuses localhost, private networks, link-local and cloud metadata addresses, non-https and odd ports. Redirects are followed by hand (at most 3), checking each one | 13/13 address tests passed (e.g. `127.0.0.1`, `10.x`, `172.20.x`, `192.168.x`, `169.254.169.254`, `[::1]`, `[::ffff:127.0.0.1]`, `2130706433`) |
| 4. Error details | OpenRouter's real error goes to the server log only; visitors see "The AI service had a problem. Please try again in a minute." | Called with a fake key: the browser got the plain message, the log got the real 401 |
| 5. Raw code error | The guide route checks that a taste reading was sent first | Got "Read your taste first, then make the guide." |
| 6. Headers | Page sent with `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` | Checked in the browser (PostHog still loads) and on the live site |
| 7. Saved trip links | Links from saved trips are shown only if they are normal `http(s)` web links; anything else falls back to the Google search link | Opened a test trip with planted `javascript:` links: none appeared, normal links still worked |

## What is left

- **Anyone can sign up with any email.** Email confirmation is off, so sign-up works instantly for
  testers (Supabase's free plan only sends a few emails an hour). Someone could sign up with an email
  that isn't theirs, but the account would hold only what they themselves saved.
- **Database writes have no per-visitor rate limit.** Signed-in people write to Supabase directly, so my
  server's rate limit doesn't cover them. The per-account caps (20 cities, 100 trips), size limits and
  Supabase's own sign-up limits keep this small.
- **Free Supabase projects pause after a week with no activity.** Data stays safe, but sign-in stops
  working until I un-pause the project in the dashboard. The uptime pinger keeps Render awake, not Supabase.
- **Rate limit counts reset on every restart.** Each deploy, or Render waking the app up, starts the
  counts from zero. The OpenRouter $5 cap is the real backstop.
- **A determined person can get around the per-visitor limit** by changing their internet address. The
  app-wide daily limit and the OpenRouter cap still limit the damage (at most about $4 a day).
- **One visitor can use up the daily limit for everyone**, and then the app shows a "taking a break
  for today" message until the next day. I accept this in exchange for a hard ceiling on cost.
- **DNS rebinding:** a website's address is checked and then fetched separately, so an attacker who
  controls a domain could in theory switch its address in between. The server only learns yes/no from
  that fetch, so the risk is low.
- **Prompt injection:** a visitor can steer the AI with what they type, but only into their own guide.
  It's shown as plain text, so it can't run code or affect anyone else.
- **The live OpenRouter key expires** in early February 2027. After that the app shows "The AI service
  had a problem" until I make a new key and update it in Render.

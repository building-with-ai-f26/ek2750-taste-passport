# Security audit

Taste Passport · Build 3 · Beginner lane · audited November 20, 2026

Live app: https://taste-passport-7jya.onrender.com (Render free web service)

## My kind of app

**AI app, no database.** Taste Passport has no sign-in and saves nothing: no database, no files, no
accounts. A visitor types or speaks their places, and the server sends them to OpenRouter (Claude Haiku 5.5,
plus web search) and returns a guide. The only secret is the OpenRouter API key. It lives on the server
and is never sent to the browser. The other key in the page is PostHog's `phc_` key, which is meant to be
public.

Hosting: Render free web service (Node, no packages).

## What I checked

| # | Check | How | Result |
|---|---|---|---|
| 1 | Access control (AI app, no database): rate limit | `bash tests/rate-limit-test.sh` sends 30 requests in a row to `/api/split` on the live site | **Live, Nov 20:** calls 1–25 allowed, calls 26–30 got `429 Too Many Requests` (screenshot submitted). The requests are empty, so the test never reaches the AI and costs $0. |
| 2 | Secret keys stay on the server | Searched every file in the repo, the full git history, and the live page for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_` and my own key | Only placeholders in the repo (`.env.example`, setup notes in `AGENTS.md`). `.env` is in `.gitignore` and was never committed. **Live page: nothing found.** The only key there is PostHog's public `phc_` key. Asking the live site for `/.env`, `/app/server.js` or `/package.json` returns 404. |
| 3 | File storage private | — | Doesn't apply: the app stores no files. |
| 4 | Production out of my agent's reach | Added an **Ask me first** list to `AGENTS.md` | The agent must ask before committing or pushing (a push to `main` changes the live site), deleting anything, touching keys or settings, or spending money. No database, so there's nothing to back up. |
| 5 | Spending caps and rate limits | Rate limits in `server.js`; key limits on OpenRouter | Per visitor: 25 requests per 10 minutes (a guide counts as 4). Whole app: 400 a day. The live app uses its own OpenRouter key (`taste-passport-live`) with a **$5 limit**, kept only in Render's environment variables. My laptop key has a separate $10 limit. Auto top-up is off, so OpenRouter can't charge more than my prepaid balance. |
| 6 | Dependencies | `npm audit` | **0 vulnerabilities.** The app uses no outside packages, only Node's built-in `http`, `fs`, `path`, `dns` and `net`. |
| 7 | Agent security review | Asked Claude Code to read the server and page code and try to break the app | Found 6 issues, listed below. All fixed and tested. |

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

Checked and fine:
- **Injected code on the page (XSS):** everything the AI writes is put on the page as plain text, never
  as HTML. Map and search links are built with proper encoding. Booking and website links must start with
  `http`, and booking links must be pages the web search actually returned.
- **Files:** the server only ever serves `app/index.html`, so nobody can ask it for other files (like `.env`).
- **The API key:** only used in server code. The browser only talks to my own `/api/` routes.

## What I fixed

| Issue | Fix | Tested |
|---|---|---|
| 1. No rate limit | Per-visitor limit (25 per 10 min, guide = 4) and app-wide daily limit (400), answering `429` with a friendly message and a `Retry-After` header | 30 calls → `429` from call 26; 7 guide calls → `429` on the 7th |
| 2. Huge uploads | The server stops reading as soon as a request passes 100 KB | Sent a 3 MB upload; the connection was cut and the server kept running |
| 3. Private addresses | Every website check now looks up where the address really points and refuses localhost, private networks, link-local and cloud metadata addresses, non-https and odd ports. Redirects are followed by hand (at most 3), checking each one | 13/13 address tests passed (e.g. `127.0.0.1`, `10.x`, `172.20.x`, `192.168.x`, `169.254.169.254`, `[::1]`, `[::ffff:127.0.0.1]`, `2130706433`) |
| 4. Error details | OpenRouter's real error goes to the server log only; visitors see "The AI service had a problem. Please try again in a minute." | Called with a fake key: the browser got the plain message, the log got the real 401 |
| 5. Raw code error | The guide route checks that a taste reading was sent first | Got "Read your taste first, then make the guide." |
| 6. Headers | Page sent with `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` | Checked in the browser (PostHog still loads) and on the live site |

## What is left

- **Rate limit counts reset on every restart.** Each deploy, or Render waking the app up, starts the
  counts from zero. That's fine for a class project, and the OpenRouter spending cap is the real backstop.
- **A determined person can get around the per-visitor limit** by faking or changing their internet
  address. The app-wide daily limit and the OpenRouter cap still limit the damage (at most about $4 a
  day if all 400 were guide requests).
- **One visitor can use up the daily limit for everyone**, and then the app shows a "taking a break
  for today" message until the next day. I accept this in exchange for a hard ceiling on cost.
- **DNS rebinding:** a website's address is checked and then fetched separately, so an attacker who
  controls a domain could in theory switch its address in between. The only thing the server learns from
  that fetch is yes/no (does the page mention the restaurant), so the risk is low.
- **Prompt injection:** a visitor can steer the AI with what they type, but only into their own guide.
  It's shown as plain text, so it can't run code or affect anyone else.
- **The live key expires** in early February 2027. After that the app shows "The AI service had a
  problem" until I make a new key and update it in Render.

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

## Run locally
- Needs Node.js 20+ (no packages to install) and a real `OPENROUTER_API_KEY` in `.env`.
- Start: `node --env-file=.env app/server.js`, then open http://localhost:3000
- Model: `anthropic/claude-haiku-5.5` by default; override with `OPENROUTER_MODEL` in `.env`.
- The server prints the token count and cost of each AI call in the terminal.

## Weekly build (due Monday noon)
- Add a build log entry covering what works, what I learned, what broke or changed, costs, and hours.

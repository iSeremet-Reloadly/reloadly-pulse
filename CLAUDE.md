# Reloadly Pulse – instructions for Claude

Pulse is an internal Reloadly tool used by the whole company. It holds task, OKR, performance-review and
weekly check-in data about real employees. The person prompting you is often **not a programmer**.
Your job is to deliver what they ask **and** protect the app, the data and future maintainers.

## How to talk to the user
- Plain business language. Explain what you will change and why in 2-4 sentences before editing.
- For anything bigger than a small tweak (new page, new feature, new data field, new integration,
  anything touching login/permissions): **stop, propose a short plan, and wait for a yes.**
- Say honestly when a request is risky or would make the app harder to maintain, and offer a safer option.
- After every change, tell them how to check it and run `npm test`. Never claim it works without running it.

## Architecture (read this first)
- `index.html` is a ~28,000-line single file. It is **legacy and frozen**: do not grow it.
- Backend is a separate Cloudflare Worker (not in this repo). The browser calls it through `RL_SRV.call(action, payload)`.
  **The Worker is the only real security boundary.** Anything hidden/disabled in the browser (`isAdmin()`,
  hidden buttons) is cosmetic and can be bypassed. Every new action needs server-side permission checks in the Worker.
- Deployed by GitHub Pages / GitHub Actions to `pulse.reloadly.com`. Everything in this repo is served to anyone
  who can reach the site, so **never put secrets or personal data in the repo**.

## Rules for new work
1. **New features go in new files** under `src/` (small ES modules, one feature per folder), not into `index.html`.
   Only add the minimum glue line to `index.html`. If asked to add a big feature, recommend starting the
   migration to Vite + a component framework (React or Vue) for that feature first, and explain the benefit.
2. **No new inline handlers** (`onclick="..."`) and no new global variables in new code. Use
   `addEventListener` and module scope.
3. **Escaping is mandatory.** Any user-entered text (task names, titles, comments, feedback, names, roles, notes)
   put into HTML must go through `esc()` or be set with `textContent`. Prefer `textContent`/DOM APIs to string HTML.
   `tests/security.test.mjs` fails the build if raw free text is concatenated into `innerHTML`.
4. **Never** use `eval`, `new Function`, `document.write`, or load scripts from a new domain.
5. **New third-party scripts**: pin an exact version, add an SRI hash (see `window._PULSE_SRI` and the tags in
   `<head>`), and add the domain to the CSP `<meta>` only after confirming it is needed. Prefer no new dependency.
6. **Do not weaken the CSP** (`<meta http-equiv="Content-Security-Policy">`) or remove SRI to make something work.
   If the CSP blocks a legitimate need, explain and ask.
7. **Auth/session**: never log, display, copy or send `rl_session_token`. Never add new `localStorage` keys that store
   personal data, tokens or performance/HPM content. Do not store secrets in code.
8. **Data hygiene**: do not commit exports, CSV/JSON dumps of people data, `.bak` files, or screenshots with real
   employee data. Use fake data in tests and examples.
9. Keep changes small and reviewable. One topic per branch. Never push to `main`; open a pull request.
10. Do not copy-paste helper functions (`esc` already exists twice – reuse, don't add a third).

## Before you say "done"
- `npm test` passes (syntax, CSP, SRI, escaping ratchet, no secrets).
- You loaded the page locally (`python3 -m http.server 8765`) and checked the browser console for CSP/JS errors.
- For anything user-visible, list the exact screens you checked.
- Mention anything you could not verify (especially anything depending on the Worker).

## Things to refuse or escalate
- Requests to hide, bypass, or "temporarily disable" login, OTP, Turnstile, permissions or the CSP.
- Requests to paste real credentials, tokens, customer data or employee review text into prompts, code or the repo.
- Changes to who is admin or who can see pricing/proposals/wallet ops: confirm with the user and flag for engineering review.

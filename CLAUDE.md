# CLAUDE.md

This file gives Claude Code project-level context. Claude Code reads it automatically on every session in this repo.

## Project: Reloadly Operational Performance OS

A single-file (`index.html`, ~245 KB / ~1,800 lines) static web app deployed via GitHub Pages at https://reloadly-tasks.github.io/task-manager/. Combines task management, OKR tracking, and performance reviews for Reloadly's ~23-person team. Persistence is browser `localStorage` only — no backend, no build step, no tests, no runtime dependencies (everything inline).

## Files in this repo
- `index.html` — the entire app (HTML + inline CSS + inline JS)
- `index.html.html` — historical backup; ignore unless explicitly asked
- `HANDOFF.md` — narrative project history (read for context)
- `README.md` — short description
- `CLAUDE.md` — this file

## How to make changes
1. Edit `index.html` directly. There is no build.
2. Validate JS syntax before committing:
   ```bash
   node -e "const h=require('fs').readFileSync('index.html','utf8'); new Function(h.split('<script>')[1].split('</script>')[0])"
   ```
   Should exit cleanly. Any error means the JS is broken — fix before committing.
3. Verify the file isn't accidentally doubled. Each of these MUST print `1`:
   ```bash
   grep -c '<!DOCTYPE html>' index.html
   grep -c 'var SCORECARD_DEF' index.html
   ```
4. `git add index.html && git commit -m "..." && git push`. GitHub Pages republishes automatically. CDN propagation takes 30–60 seconds. User verifies on the live site with a hard refresh (Cmd/Ctrl+Shift+R).

## Critical data model (read before touching anything)
- **Tasks** live in a global `data` object keyed by department:
  `data.Management`, `data.Operations`, `data.Finance`, `data.Engineering`, `data.Sales` — each an array.
  - `DEPTS` lists those five names.
  - `CFG` holds per-dept `{p: prefix, col: color}` (e.g. prefix `OPS` → IDs `OPS-001`).
- **Task fields:** `id`, `name` (NOT `title`), `assignee` (string; first name OR full name; labeled **"DRI"** in the UI), `priority`, `status` (one of `Done`, `In Progress`, `Not Started`, `Blocked`, `Under Review`), `due`, `startDate`, `progress`, `notes`, `lastUpdated`, `createdAt`.
- **OKR links:** stored as `{ krId: [taskId, ...] }` — KR → tasks, NOT the reverse.
- **Reviews** in `rl_perf`. `reviewee` is stored as an **email**; tasks store `assignee` as a **name**. Map between them via `USER_REGISTRY[email].name`.
- `currentUser = {name: 'Dren Lubovci', dept: 'Management'}`.

## Useful globals already defined in `index.html`
- `render()` — main task board
- `renderMyTasks()` — My Tasks view (call after creating/editing a self-assigned task)
- `renderOKR()` — OKR tracker
- `renderPerf()` — Performance module (call on modal-close to refresh edits)
- `renderOrgTree()` — Org Tree
- `loadData()` / `autoSave()` — read/write tasks to localStorage
- `nextId(dept)` — generate next task ID for a department
- `logEntry(msg, type)` — write to activity log
- `toast(msg, type)` — flash a UI toast
- `esc()` — HTML-escape a string (use on all user input rendered to DOM)

## localStorage keys
`rl_tasks_v4`, `rl_okr_links`, `rl_okr_active_quarter`, `rl_okr_Q*_YYYY`, `rl_perf`, `rl_perf_view`, `rl_profile_extras_v1`, `rl_log_v1`, `rl_archived`, `rl_pwd_store`, `rl_user_email`, `rl_theme`.

## DO NOT
- Do not introduce a build step, `package.json`, framework, or external dependency. This must remain a single-file static app.
- Do not assume task fields are `title` / `owner` / `assignees`. They are `name` / `assignee`.
- Do not invert OKR links — they are KR-keyed.
- Do not delete `HANDOFF.md`, `README.md`, or `index.html.html`.
- Do not duplicate the file (the most common breakage). After any large edit, run the grep checks above.
- Avoid adding new `confirm()` / `alert()` calls — they break automated testing. The existing ones are fine to leave.

## Code conventions
- Vanilla JS, ES5-ish style. `var`, `function(){}`, no arrow functions where surrounding code uses `function`.
- Inline styles via `el.style.cssText = '...'`.
- Class/ID names are terse (`ie`, `nht`, `hdr`, `tw`, `psub`, `th-info`, etc.) — search the existing `<style>` block before inventing new ones.
- All functions are top-level inside the single `<script>` block. New helpers go in the same flat scope.
- Tooltips: reuse `.th-info` + body-level `#th-tooltip` event delegation. Don't build new tooltip systems.

## Recent commits (newest first)
- `affd572` — Added `HANDOFF.md` (doc only, no code change)
- `50b61ec` — Notes hover-expand, add-task from My Tasks, OKR-link filter (DRI only), rename Assignee → DRI
- `0e05c72` — Fixed review-modal crash; rewrote evidence section against the real `data[dept]` model
- `2216165` — Added ⓘ tooltip next to each objective % explaining the calculation
- `08598d5` — Profile-modal close re-renders Performance page so edits show immediately
- `73ec12e` — Activity Log search focus-loss fix (refactored to `refreshLogList`)
- `6fec828` — Phases 4+6+10+15 (Evidence, Comments, Activity Log filters, Profiles + Org Tree)

## Outstanding items
- Two test tasks to clean up: `MGT-005` ("Verify add-from-mytasks works") and `MGT-004` ("George Misses"). User will delete manually since deletion uses native `confirm()`.
- Cosmetic: skill/DRI chips render with a leading space if the user types a space after a comma. `.trim()` would fix it; not pressing.

## Not buildable here (would need a backend)
- Real AI performance intelligence
- RBAC / SSO / MFA
- Server-side audit and analytics
- Cross-device data sync (localStorage is per-browser)

## When the user asks for a change
1. Skim `index.html` for the relevant function/section before writing code. Don't guess at function or field names — search first.
2. Make the change as a targeted edit, not a rewrite.
3. Run both validation checks (syntax + dedupe greps) before committing.
4. Use a descriptive commit message, e.g. `"OKR tracker: sort objectives by progress desc"`.
5. After pushing, remind the user it takes ~55 seconds for the CDN to update and that they need a hard refresh.

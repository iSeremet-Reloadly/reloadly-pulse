# Strategic Execution Architecture — Design Document

**Project:** Reloadly Operational Performance OS → Strategic Execution & Organizational Intelligence Infrastructure
**Owner:** Dren Lubovci (COO)
**Status:** Draft v0.1 — for review
**Target end-state:** Multi-tenant web app hosted on Reloadly domain, backed by a Reloadly-managed service
**Bridge state:** Single-file `index.html` extended in-place to validate UX and seed the data model, then migrated to backend

---

## 0. Purpose of this document

Before we write a line of new product code, this document fixes three things:

1. **The target architecture** — what the product looks like when it runs on Reloadly infrastructure.
2. **The bridge plan** — how we get there from the current 1,796-line single-file localStorage app without breaking the live deployment.
3. **The decision register** — every open question that needs your input before engineering can commit to a phase.

No code changes ship from this document directly. It's the contract we agree on first; commits follow each approved phase.

---

## 1. Product positioning (recap)

This stops being a task manager and becomes the **strategic execution layer** of Reloadly:

- Strategy cascades top-down (Company → Department → Team → Individual)
- Innovation flows bottom-up (proposal → review → promotion)
- Execution attaches to outcomes (Initiative → KR → Objective)
- Leadership sees the whole graph: ownership, progress, risk, blockers, alignment gaps

**The platform answers, at any moment:** Are teams aligned? Are objectives executable? Which initiatives support strategy? What is blocked? Which KRs are at risk? Where is workload concentrated? Which objectives lack ownership?

---

## 2. The seven-layer execution hierarchy

We standardize the data model on a strict seven-layer graph. Each node has a **type**, a **parent** (or parents — see §2.3), an **owner**, an **execution state**, and a **health score**.

```
L1  COMPANY OBJECTIVE        (set by exec team, quarterly/annual)
  └── L2  DEPARTMENT OBJECTIVE   (owned by dept head)
        └── L3  TEAM OBJECTIVE        (owned by team lead — optional layer)
              └── L4  INDIVIDUAL OBJECTIVE  (owned by individual contributor)
                    └── L5  KEY RESULT            (measurable, time-bound)
                          └── L6  INITIATIVE / PROJECT   (execution wrapper)
                                └── L7  TASK                  (operational unit)
```

### 2.1 Layer responsibilities

| Layer | Set by | Cadence | Required fields beyond core | Purpose |
|---|---|---|---|---|
| L1 Company Objective | Exec / CEO / COO | Annual + Quarterly | `themeId`, `narrative`, `successDefinition` | Strategic direction |
| L2 Department Objective | Dept head | Quarterly | `parentCompanyObjectiveIds[]` | Translate strategy into dept scope |
| L3 Team Objective | Team lead (optional) | Quarterly | `parentDeptObjectiveIds[]` | Used only if dept is large enough to need it (Engineering, Operations) |
| L4 Individual Objective | Individual + manager | Quarterly | `parentObjectiveIds[]` (any of L1/L2/L3) | Personal commitment aligned upward |
| L5 Key Result | Owner of parent objective | Quarterly | `metric{name, baseline, target, unit, direction}`, `confidence`, `progressPct` | Measurable outcome |
| L6 Initiative | KR owner or proposer | Variable (days–quarters) | `parentKrIds[]`, `workloadEstimateDays`, `startDate`, `dueDate`, `state` | Bundle of work that moves a KR |
| L7 Task | Initiative owner / contributor | Days | `parentInitiativeId`, `dept`, `assignee`, `status`, `progress`, `due` | The unit that closes work — **this is the existing `data[dept][]` shape** |

### 2.2 Core fields shared by every node

```
id              : string  (typed ID: CO-, DO-, TO-, IO-, KR-, IN-, plus existing TASK ids)
type            : enum    (CompanyObjective | DepartmentObjective | TeamObjective |
                            IndividualObjective | KeyResult | Initiative | Task)
title           : string
description     : string  (markdown allowed)
ownerEmail      : string  (single accountable owner)
contributorEmails : string[]
parentIds       : string[]  (multi-parent supported — see §2.3)
childIds        : string[]  (denormalized for fast traversal)
quarter         : string    (e.g. "Q3-2026") — null for evergreen
state           : enum   (Draft | Proposed | Aligned | Active | AtRisk | Blocked |
                          Done | Cancelled | Archived)
progressPct     : 0..100
confidence      : 0..100 (KR/Initiative only)
createdBy, createdAt, updatedAt, lastTouchedAt
tags            : string[]
linkedReviewIds : string[]  (back-reference to perf reviews citing this node)
```

### 2.3 The "multi-parent" decision

A single node can roll up to **multiple parents**. Example: an Initiative "Implement webhook reconciliation" supports both an Engineering Stability KR and an Operational Efficiency KR. The graph is a DAG, not a tree.

**Rules:**
- Edges have a `weight` (0–1) so a contribution to two parents doesn't double-count progress
- Each child sums `weight` ≤ 1 across all parents (enforced on save)
- The cascade visualization picks a *primary parent* (highest weight) for layout, but the mindmap shows all edges

### 2.4 Existing-data migration (what changes in the current app)

| Current state | New state | Migration |
|---|---|---|
| `rl_okr_Q*_YYYY` stores objectives + KRs as a flat list, single tier | Becomes the L1 Company Objective tier | Each existing objective becomes a `CompanyObjective`; its KRs become `KeyResult` nodes with `parentIds = [companyObjId]` |
| `rl_okr_links` maps `krId → [taskId]` | Becomes the KR→Task edge, but now via implicit Initiatives | For each linked KR, generate one default Initiative `IN-AUTO-<krId>` and reparent tasks under it (user can split later) |
| `data[dept][]` tasks | Stay as L7 Tasks | Add `parentInitiativeId` field; default `null` until linked. Tasks remain editable from the existing board. |
| No dept objectives exist yet | New L2 tier, empty initially | Migration creates one placeholder DO per existing dept owner so cascade isn't broken |

**Migration must be reversible.** We ship a `localStorage` key `rl_strategic_v1_migrated_at` and keep `rl_tasks_v4`, `rl_okr_*`, `rl_okr_links` intact. The new model reads through a shim until the user confirms stability.

---

## 3. The two flows

### 3.1 Top-down (strategy cascade)

```
Exec creates L1 Company Objective
  → assigns dept owners
  → each dept owner creates L2 Dept Objective, links parentIds = [L1 id]
    → team lead (if applicable) creates L3
      → IC creates L4 Individual Objective linked to L1/L2/L3
        → KR added, must specify metric + target
          → KR owner adds Initiative(s) (cannot leave KR empty — see §5)
            → Initiative owner adds Task(s)
```

**Hard rule:** A node cannot leave Draft state without at least one downward link (except L7 Tasks). A KR with zero Initiatives is flagged red. A Company Objective with zero Dept Objectives is flagged red.

### 3.2 Bottom-up (proposal & promotion)

Any user can create a node in **Proposed** state. The system runs an alignment pass:

```
User creates Initiative "Automate webhook reconciliation"
  → System computes alignment candidates:
      - tag overlap with existing KRs
      - text similarity (term-frequency cosine, computed client-side until backend ships)
      - dept-of-author × dept-of-objective
      - historical co-occurrence (initiatives previously linked to same KR family)
  → Surfaces top 5 candidate parents to user
  → User selects 1+ proposed parents → state becomes "Aligned (pending review)"
  → Owner of selected parent KR is notified
  → They Approve / Reject / Re-map → state becomes "Active" or returns to "Proposed"
```

**Promotion path:** a Proposed Initiative that attracts ≥N contributor signals (votes, manager endorsements, manager-marked "strategic") can be promoted to a Dept or Company Objective by an exec.

**Roles needed to enforce this** — see §6 (RBAC).

---

## 4. Mindmap — the visualization that has to exist

The strategic alignment mindmap is a core feature, not a side panel. It is the **default view of the OKR module** post-migration.

### 4.1 Visual model

- **Nodes** sized by execution weight (sum of child task workload-days)
- **Color** by health: green (on-track), amber (at-risk), red (blocked/overdue), grey (no execution attached)
- **Edge thickness** by contribution weight (§2.3)
- **Edge style:** solid for primary parent, dashed for secondary parents
- **Layout:** hierarchical force-directed — L1 at center, L7 at leaves; user can flip to dept-centric or person-centric layout

### 4.2 Node types and badges

| Node | Badge | Hover-info |
|---|---|---|
| L1 Company Objective | ★ | Quarter, owner, % rollup, # downstream KRs, % aligned |
| L2 Department Objective | dept color | Dept, owner, # KRs, health |
| L3 Team Objective | team label | Team, lead, # KRs |
| L4 Individual Objective | avatar | Person, manager |
| L5 Key Result | metric chip (e.g. "↓30%") | Baseline → current → target, confidence, owner |
| L6 Initiative | ◇ | Workload-days, % complete, due, blockers |
| L7 Task | dot | dept color, status, due, assignee |
| Risk | ⚠ overlay | Risk type, severity, owner |
| Dependency | → with hazard icon | Blocking node id, age of block |
| Milestone | flag | Date, completion criterion |

### 4.3 Interactions

- **Zoom & pan** (cmd-scroll, drag)
- **Expand/collapse** children per node
- **Drag-and-drop reparent** (creates an edge proposal that the target node's owner must approve — never silent)
- **Right-click → Trace upward** (highlights path from this node to all ancestors)
- **Right-click → Trace downward** (highlights the execution subtree)
- **Right-click → Find orphans** (highlights nodes in the subtree with `childIds = []` below the level they should have one)
- **Filter bar:** dept · owner · quarter · health · type · search
- **Layout switch:** strategic (default), dept-centric, person-centric, time-axis (gantt-like rollup), risk-only
- **Disconnected view:** show only nodes with no parent above their required level — the "orphan finder"

### 4.4 Click → drill-in panel

Clicking a node opens a right-side panel (not a modal — modals break the spatial context):

```
[Header]    title, type chip, owner avatar, state pill, quarter
[Metrics]   progress %, confidence, health score, alignment score
[Lineage]   parents (clickable), children (clickable), siblings count
[Execution] linked initiatives (L5/L6) or tasks (L6/L7), with status
[Risks]     risk list with severity + owner + age
[Comments]  threaded discussion (reuse existing comment infra from perf reviews)
[Activity]  audit log
[Reviews]   referencing performance reviews (back-link)
```

### 4.5 Rendering choice

For the bridge state: SVG with a hand-rolled hierarchical layout (no D3 dep — CLAUDE.md forbids deps). Up to ~300 nodes renders fine in plain SVG; the data this org will produce in 2026 stays well under that.

For the backend state: switch to a Canvas/WebGL renderer (Cytoscape.js or Sigma.js) once we cross ~500 nodes or once we want multi-user real-time cursors.

---

## 5. Execution Planning Engine — preventing empty OKRs

A KR cannot be marked Active unless it satisfies:

| Requirement | Why |
|---|---|
| ≥ 1 Initiative attached | No KR with zero execution |
| Metric defined: baseline, target, unit, direction | Measurability |
| Owner set | Accountability |
| Due quarter set | Time-boxing |
| Workload-days estimate per Initiative | Forecasting + capacity check |

An Initiative cannot be marked Active unless:

| Requirement | Why |
|---|---|
| ≥ 1 Task attached OR explicit "single-step initiative" flag | No black-box initiatives |
| Owner set | Accountability |
| Start + due dates set | Forecasting |
| Workload-days estimate | Capacity check |

Validation runs on `state → Active` transition and is non-bypassable except by `role=Exec` with a logged override (audit trail).

---

## 6. Roles, permissions, and the RBAC question

The current app has `currentUser` but no roles. The strategic system needs explicit roles:

| Role | Can | Notes |
|---|---|---|
| `exec` | Create L1; promote bottom-up to L1/L2; override execution-readiness gates | CEO, COO |
| `dept_head` | Create L2 in their dept; approve/reject incoming proposals targeting their L2 | One per dept |
| `team_lead` | Create L3 in their team | Optional layer |
| `manager` | Approve their report's L4; comment on any node | Same as manager field on profile today |
| `contributor` | Create L4 for self; create Proposed initiatives; create tasks under initiatives they own | Everyone |
| `viewer` | Read-only | For board members, external auditors |

Until we migrate to a backend, roles live in `USER_REGISTRY[email].role`. The current `role` field there is job title (e.g. "Senior Engineer") — we add a new field `systemRole` to avoid breaking the existing display.

---

## 7. Heuristics layer (the "AI" placeholder)

Per the constraint discussion, "AI strategic intelligence" is server-side and ships later. The bridge state ships **deterministic heuristics** that look and feel like AI guidance but are explainable rule outputs. We label them "Insights," not "AI."

### 7.1 Heuristics included from day one

| Insight | Rule | Triggers when |
|---|---|---|
| **Orphan KR** | KR has 0 initiatives | KR active without children |
| **Stalled initiative** | No task `lastUpdated` movement in 14 days | Operational drift |
| **Overloaded owner** | Sum of workload-days assigned > 1.4× available capacity in quarter | Burnout risk |
| **Disconnected objective** | L2/L3/L4 has no `parentIds` traceable to L1 | Strategy gap |
| **Duplicate initiative** | Title token overlap > 0.6 AND same dept AND overlapping quarter | Wasted effort |
| **At-risk KR** | `confidence < 50` AND `progressPct < expectedProgressByDate` | Forecast miss |
| **Weak metric** | Metric target = baseline, or unit missing, or direction missing | Unmeasurable KR |
| **No owner** | `ownerEmail` null on Active node | Accountability gap |
| **Capacity collision** | Two initiatives owned by same person both due in same week with combined workload > 5 days | Schedule conflict |
| **Dependency chain at risk** | Any upstream blocker > 7 days old | Cascade risk |

### 7.2 Where real AI plugs in later

Real LLM-backed analysis (semantic alignment, narrative summarization of execution health, suggested rewrites of weak KRs, similarity clustering of initiatives across quarters) gets a server endpoint:

```
POST /v1/insights/analyze
  body: { scope: "objective"|"dept"|"company", id, quarter }
  returns: { insights: [{type, severity, narrative, suggestedAction, citations[]}] }
```

The client UI for insights is built now; the implementation is heuristic now and LLM-backed later. Same API shape from the client's perspective.

---

## 8. Scoring — alignment, execution readiness, risk

Each node carries three scores, recomputed on save:

### 8.1 Alignment Score (0–100)

Measures how well this node ties into strategy.

```
alignmentScore =
  40 × (has at least one parent traceable to L1 ? 1 : 0)
+ 20 × (parents are in same quarter or evergreen ? 1 : 0)
+ 20 × (ownerEmail set ? 1 : 0)
+ 20 × (tag overlap with parents > 0.3 ? 1 : 0)
```

### 8.2 Execution Readiness Score (0–100)

Measures whether this node can actually be delivered.

```
executionReadinessScore =
  25 × (children count ≥ required minimum ? 1 : 0)
+ 25 × (all children have ownerEmail ? 1 : 0)
+ 20 × (all children have due dates within parent's quarter ? 1 : 0)
+ 15 × (workload-days estimate exists ? 1 : 0)
+ 15 × (metric fully defined ? 1 : 0)   // KR-only; for non-KR, scored as 1
```

### 8.3 Risk Level (Low / Medium / High)

Composite of:

- progress velocity (current % vs. expected % given quarter elapsed)
- blocker count
- owner capacity utilization
- dependency chain depth
- last-touched age

Thresholds: <30% deviation = Low, 30–60% = Medium, >60% = High.

### 8.4 Display

Three scores show as a single chip strip on every node card and at the top of the drill-in panel. Hovering each shows the rule breakdown — every score is explainable.

---

## 9. Backend architecture (target state on Reloadly infra)

Since this will live on Reloadly domain and servers, the long-term architecture is:

### 9.1 Topology

```
[Reloadly SSO] ─ users
                │
                ▼
   ┌────────────────────────────┐
   │   strategy.reloadly.com    │  (or operations.reloadly.com)
   │     Next.js / React SPA    │
   └─────────────┬──────────────┘
                 │ HTTPS JSON
                 ▼
   ┌────────────────────────────┐
   │   strategy-api             │  (Node.js / Go / Python service)
   │   - REST + websockets      │
   │   - Auth via Reloadly SSO  │
   │   - LLM provider proxy     │
   └─────┬───────────┬──────────┘
         │           │
         ▼           ▼
   ┌──────────┐  ┌─────────────────┐
   │ Postgres │  │  Anthropic API  │
   │ + audit  │  │  (insights)     │
   │   log    │  └─────────────────┘
   └──────────┘
```

### 9.2 Auth

Reloadly SSO (Okta / Google Workspace, whichever Reloadly already uses for internal apps). No password store in the app. JWT-based session. RBAC enforced server-side using the `systemRole` field on the user record.

### 9.3 DB schema (Postgres)

```
nodes (id PK, type, title, description, owner_email, quarter, state,
       progress_pct, confidence, alignment_score, execution_readiness_score,
       risk_level, metric_json, created_by, created_at, updated_at)
edges (parent_id FK, child_id FK, weight, primary boolean, created_at)
risks (id PK, node_id FK, severity, type, narrative, owner_email, created_at, resolved_at)
comments (id PK, node_id FK, author_email, body, created_at, parent_comment_id)
audit_log (id PK, actor_email, node_id, action, before_json, after_json, ts)
users (email PK, name, dept, role, system_role, manager_email, archived, …)
quarters (id PK, label, start_date, end_date, locked)
insights_cache (node_id FK, scope, computed_at, payload_json)
```

### 9.4 API surface (sketch)

```
GET    /v1/nodes?type&dept&owner&quarter&state
POST   /v1/nodes
GET    /v1/nodes/:id
PATCH  /v1/nodes/:id
POST   /v1/nodes/:id/state            // state transitions, validated server-side
POST   /v1/nodes/:id/edges            // attach/detach parents
POST   /v1/nodes/:id/comments
GET    /v1/graph?root&depth           // for mindmap rendering
POST   /v1/insights/analyze           // §7.2
GET    /v1/quarters
POST   /v1/quarters/:id/lock
GET    /v1/audit?node=…&since=…
```

### 9.5 Real-time

Websocket channel per quarter: any node update fans out to subscribed clients so leaders see the mindmap update live during planning sessions.

### 9.6 Data migration from localStorage to the backend

When a user signs in to the hosted app for the first time, the SPA detects a local export file (we ship an "Export to Strategy Cloud" button in the bridge app), POSTs the dump to `/v1/migrate/import`, and the server reconciles. Users on multiple browsers can each export — server dedups by node id.

---

## 10. Phased delivery

### Phase 0 — ship the pending trim/escape patch as the seed commit  (½ day)

The 5-line cosmetic + XSS-escape patch from the prior session gets bundled into the first commit of the strategic work, with commit message `"Pre-strategic-arch: trim assignee/skill whitespace; XSS-escape Talent Directory chips"`. Validates the workflow end-to-end on the live site before bigger changes.

### Phase 1 — data model + migration (single-file, 3–5 days)

- Introduce typed IDs (`CO-`, `DO-`, `TO-`, `IO-`, `KR-`, `IN-`)
- New `localStorage` keys: `rl_strat_nodes_v1`, `rl_strat_edges_v1`
- Migration runs idempotently on load: existing OKRs → L1, existing KRs → L5, existing task-links → auto-Initiatives + edges
- No new UI yet — the existing OKR module renders from the new shape via a shim
- Validation: existing OKR page still works, no data loss, can roll back by deleting the new keys

### Phase 2 — cascade tree view (single-file, 3–5 days)

- New tab in the nav: **Strategy**
- Vertical cascade tree (L1 → L7) — read-only first, edit second
- Filters: quarter, dept, owner
- Three score chips on every node, hover-explains
- Heuristics §7.1 fire and surface as a sidebar list

### Phase 3 — execution planning engine + state machine (single-file, 3–5 days)

- Enforce §5 rules on `state → Active`
- New planning modal for KRs (metric, target, baseline, direction, unit)
- New planning modal for Initiatives (workload-days, start, due, dependencies)
- "Empty OKR" warnings everywhere

### Phase 4 — mindmap (single-file, 5–8 days)

- SVG hierarchical layout
- §4.2 node types, §4.3 interactions
- §4.4 drill-in panel
- Layout switches (strategic / dept / person / risk)
- This is the largest single-file phase — likely the breaking point for the "single-file rule"

### Phase 5 — bottom-up flow (single-file, 2–4 days)

- Proposal state, alignment suggestions (rule-based)
- Approve / reject / re-map UI on parent owner's dashboard
- Promotion path to higher tiers

### Phase 6 — heuristics + scoring polish (single-file, 2 days)

- All §7.1 insights firing
- Insights dashboard view
- Capacity / workload roll-up by person and dept

### Phase 7 — backend split-off begins (Reloadly infra, multi-week)

- Stand up `strategy-api` service in Reloadly infra
- Postgres schema §9.3
- Reloadly SSO wiring
- Bridge-app export → backend import
- Single-file static app shifts to a "data viewer" mode, then is retired

### Phase 8 — backend feature parity + retire single-file (multi-week)

- All mindmap interactions hit the backend
- Real LLM insights wired in via §7.2
- Audit log moves server-side
- Multi-user real-time via websockets
- Old static app gets a banner: "moved to strategy.reloadly.com"

### Phase 9 — beyond MVP

- Capacity planning (capacity per person × quarter)
- Cross-quarter portfolio view
- External stakeholder shareable links (read-only)
- Slack / email digests
- Performance-review integration (current `rl_perf` data folds in)

---

## 11. Open decisions (need your input before any phase starts)

| # | Decision | Default if you don't decide |
|---|---|---|
| D1 | Do we include Team-level (L3) from day one, or skip it and add later? | Include but optional — render only if any Team Objective exists |
| D2 | Multi-parent edges (§2.3) — ship with weights from v1, or v1 single-parent and weights in v2? | Ship single-parent in v1; weights in v2 |
| D3 | Hosted domain when we cut over: `strategy.reloadly.com`? `ops.reloadly.com`? Something else? | `strategy.reloadly.com` placeholder |
| D4 | Which Reloadly SSO provider do we wire to? | Need confirmation — Okta / Google Workspace / custom |
| D5 | Postgres or another DB? | Postgres (defaulting — change if Reloadly stack standardizes elsewhere) |
| D6 | Real LLM provider for §7.2 — Anthropic, OpenAI, or Reloadly-hosted self-managed? | Anthropic Claude (matches existing infra you're using to build this) |
| D7 | Quarter boundary policy — strict calendar, or fiscal Reloadly quarters? | Calendar Q1/Q2/Q3/Q4 |
| D8 | Do we allow non-employees (board / advisors) as viewers, or staff-only? | Staff-only at launch |
| D9 | RBAC enforcement during bridge state — strict, or warning-only? | Warning-only in bridge, strict on backend |
| D10 | When (if ever) do we delete the legacy `rl_okr_*` keys? | After 60 days of clean operation on `rl_strat_*` |

---

## 12. What does NOT get built

To prevent scope drift, these are explicitly **not in this architecture**:

- Issue tracker (we won't compete with Linear / Jira — initiatives link out)
- Real-time document editing inside the tool (use Notion / Google Docs)
- Calendar / scheduling (use Google Calendar)
- Time tracking (workload-days are estimates, not actuals)
- HRIS / payroll (current `USER_REGISTRY` stays as a reference, not a source of truth)
- 1:1 meeting notes (could live in Phase 9, not earlier)
- Goal-setting templates (no SMART-goal forced wizard — too prescriptive)

---

## 13. Risks to this architecture

| Risk | Mitigation |
|---|---|
| Single-file constraint breaks at Phase 4 (mindmap) | Plan the split to backend earlier if the file exceeds 350 KB or 2,500 lines |
| Migration loses existing OKR data | Migration is additive — old keys preserved for 60 days, exportable to JSON |
| Adoption fails because UI feels heavy | Phase 2's cascade view ships read-only first; we measure use before forcing planning gates |
| RBAC needs change after launch | Roles defined in one place (`systemRole`), so policy edits are config not refactor |
| LLM insights produce noise | Heuristics ship first and prove the format; LLM only swaps in once heuristic output is trusted |
| Single owner per node misses reality | `contributorEmails[]` handles shared work without changing the accountability model |

---

## 14. Success criteria (how we know this worked)

- ≥ 95% of active OKRs have at least one Initiative attached within 4 weeks of Phase 3 launch
- ≥ 80% of Initiatives have at least one Task within 6 weeks
- Zero L1 Company Objectives with no L2 children after Phase 5
- Median age of "Blocked" state on a node trends down quarter over quarter
- Leadership uses the mindmap (not the spreadsheet export) as the primary planning artifact in the next quarterly planning cycle
- Time from "proposed initiative" → "aligned and approved" drops below 5 working days

---

## 15. Immediate next steps

This document needs your read-through and a decision on at least D1, D3, D6, D7, D9 (§11). Once those are settled:

1. I open the GitHub web editor in your Chrome and we commit the Phase 0 trim/escape patch as the seed commit (closes out the prior workflow loop).
2. I draft the Phase 1 data-model PR diff against `index.html` for your review — still no large rewrites until you approve the diff.
3. After Phase 1 is live and the migration is verified clean for a week, we plan Phase 2.

No code beyond Phase 0 ships from this document. Each phase gets its own diff, its own validation, its own approval.

---

*End of design doc — v0.1.*

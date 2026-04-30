# Blink (Sibrox) — Project Context

@../SibroxVault/Codex-context/sibrox-overview.md

---

## Architecture (current)

Blink runs real x402 + Circle Gateway settlement on Arc Testnet. The
public deployment is real, not simulation.

- **Backend** is deployed on Fly.io at `https://blink-prod-backend.fly.dev`
  (`backend/fly.toml` + `backend/Dockerfile`). The same `server.js` runs
  there as locally on `:3001` — `@circlefin/x402-batching/server`
  middleware, billed routes `/api/insure/charging` and
  `/api/insure/battery`. Deploy with
  `flyctl deploy --build-arg CLOUDSMITH_TOKEN=<token>`.
- **Frontend** on Netlify points at the Fly backend in production, preview,
  and branch-deploy contexts (`netlify.toml`). `VITE_DEMO_MODE` is **not**
  forced anymore — the public site transacts for real against Arc Testnet.
  Set `VITE_DEMO_MODE=true` in the Netlify UI for any branch you want to
  flip back to client-only fakes.
- **`frontend/src/pages/LiveDemo.tsx` (route `/live`) is the canonical
  customer flow.** `InsuracleDashboard.tsx` (route `/`) is a parallel
  legacy flow. Changes touching policy lifecycle should land in LiveDemo.
- **Two admin views exist**: `/admin/gateway` (legacy
  `InsuracleDashboardAdmin.tsx`) and `/admin` (new
  `admin/AdminLayout.tsx` with `MetricsPanel`, `PolicyInspector`,
  `Replay`, `PolicyExport`). MetricsPanel calls `/admin/metrics`, which
  is **not implemented in `server.js`** — adding it is open work.
- **Policy analytics live in `frontend/src/lib/policyAnalyticsStore.ts`**
  (in-memory module store). Both LiveDemo and InsuracleDashboard push to
  it on policy completion; `InsuracleDashboardAdmin` reads from it.

### Gotcha: GatewayClient authorisation validity must be widened

`frontend/src/lib/gatewayClient.ts:101` calls
`widenAuthorizationValidity(client)` after constructing the SDK's
`GatewayClient`. This monkey-patches `createPaymentPayload` to sign with
1-year `validAfter`/`validBefore` offsets instead of the SDK defaults
(`-600s`, `+345600s`).

Without this patch, every `/api/insure/*` call returns
`402 {"error":"Payment verification failed","reason":"authorization_validity_too_short"}`
because Circle's facilitator (`POST /v1/x402/verify`) requires ~14 days
of remaining validity, but the SDK's hardcoded `maxTimeoutSeconds = 4
days` (server SDK lines 400/501/528 of `@circlefin/x402-batching@1.1.0`)
falls short and is not configurable. Verified via direct facilitator
calls on 2026-04-30.

The patch is self-contained, fully typed, and documented in
`gatewayClient.ts`. Remove it only when Circle ships an SDK that lets
the seller advertise `maxTimeoutSeconds >= 1209600` and a vanilla
`client.pay()` returns 200.

---

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy to keep main context window clean

- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution
- **Always dispatch independent subagents in parallel** — single message, multiple Agent tool calls. Serial dispatch is a bug, not a choice. If 2+ agents have no shared state, they run concurrently.

### 3. Self-Improvement Loop

- After ANY correction from the user: update 'tasks/lessons.md' with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to 'tasks/todo.md' with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review to 'tasks/todo.md'
6. **Capture Lessons**: Update 'tasks/lessons.md' after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
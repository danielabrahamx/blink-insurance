# Activity Log

## 2026-04-30

### README.md — fix misleading `netlify.toml` key-files entry
- **Before:** `` `netlify.toml` — flips `VITE_DEMO_MODE=true` in production ``
- **After:** `` `netlify.toml` — pins backend URL for all deploy contexts; simulation mode off by default (set `VITE_DEMO_MODE=true` in the Netlify UI per-branch to flip back to client-only fakes) ``
- **Why:** `netlify.toml` never sets `VITE_DEMO_MODE=true` — it must be toggled manually in the Netlify UI. The old line implied it was hardcoded on in production, which is the opposite of reality.

### CLAUDE.md — remove stale "not implemented" note for `/admin/metrics`
- **Before:** `MetricsPanel calls /admin/metrics, which is **not implemented in server.js** — adding it is open work.`
- **After:** `MetricsPanel calls /admin/metrics, implemented at server.js:142.`
- **Why:** The route exists and is implemented. The note was left over from an earlier state of the codebase.

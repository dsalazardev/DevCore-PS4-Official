## Context

See `proposal.md` - Why for motivation. Constraints that shape this design:

- `core.js`, `mem.js`, `int64.js`, `rpc_worker.js` are third-party SLOPKIT
  files and must stay byte-identical. The engine can only consume their
  existing hooks: `establishPrimitive({ onEvent })` (`core.js:288-291`,
  `1253`) and `installWindowP(carrier, { onEvent })` (`mem.js:408-415`,
  `753-754`).
- `core.js` owns browser state that the UI must not disturb: it stores the
  serialized graph in `history.state` (`core.js:616`, `689`) and clears it on
  release (`core.js:1315`), creates a `<textarea>` and a hidden barrier
  `<div>` with a forced reflow (`core.js:571`, `1013-1028`), and uses
  `sessionStorage` keys (`core.js:500`, `1028`, `1265`).
- `chain_poops.js` already has the pattern this design formalizes: `mark()`
  (UI + beacon) vs `trace()` (beacon only, `:62`) and a `PRIMITIVE_LOUD`
  filter for engine events (`:178-182`). `chain_lapse.js` marks everything
  (`:294-297`).
- AppCache matches exact URLs including query strings, which is why the
  manifest carries both `core.js` and `core.js?v=10`; an update is
  all-or-nothing, so a single wrong path breaks offline delivery.
- The console's WebKit executes `BigInt`, `MessageChannel` (`core.js:1248`)
  and `?.` (`core.js:514`), so it is a relatively modern engine; visual
  ambition is still bounded by GPU and memory cost, not syntax.

## Goals / Non-Goals

**Goals:**

- One emission path for engine events, consumable with or without a UI.
- Hardware log contract unchanged: same tags, same order, same details.
- UI render cost removed from the exploit's synchronous path.
- Manifest drift detectable before publishing; the tool proves a move did not
  edit a file (digest equality).
- Lapse behaves like poops: single core module instance, promotion telemetry
  visible.

**Non-Goals:**

- No change to exploit logic, ROP chains, heap strategy or offsets.
- No change to `payload.bin`, `patches/*.bin` or the SLOPKIT file contents.
- No bundler, transpiler, framework, web font or CDN.
- No beacon batching in this change (kept synchronous; batching is a later
  decision with hardware evidence).
- No new firmware support and no relocation of `payload.bin` / `patches/`.

## Decisions

### D1. A tiny plain emitter, not `EventTarget`/`CustomEvent`

`js/engine/events.js` exposes `on(type, handler)` / `emit(type, payload)` over
a plain object registry, with no DOM dependency and per-handler try/catch.
Payloads are plain objects.

Alternatives: `EventTarget` + `CustomEvent` (allocates DOM event objects and
couples the engine to DOM semantics), an external pub/sub library (forbidden
by the zero-dependency constraint). A plain registry is the smallest thing
that satisfies exception isolation and headless execution.

### D2. Chains keep `mark()/check()/state()/post()` as thin wrappers

The 374 existing call sites in `chain_lapse.js` and `chain_poops.js` do not
move. Only the bodies change:

```text
mark(tag, detail) --> emit("log", {tag, detail, level:"info", attempt?})
check(name, ok)   --> emit(ok ? "stage-proof-ok" ... ) / counters + emit("progress")
check(false)      --> emit("error", {tag:"PROOF-FAIL", name, detail})
state(text, cls)  --> emit("ui-status", {text, cls})
post(tag, detail) --> emit("telemetry", {tag, detail})
```

`terse()`/`PROSE` stay per chain, because their compaction rules genuinely
differ (`chain_lapse.js:22-28` vs `chain_poops.js:27-43`), and poops posts
raw detail while lapse posts the compacted one. Unifying that silently would
change hardware logs; the wrapper preserves each chain's behavior.

Alternatives: rename every call site to `emit(...)` (large, risky diff),
monkey-patch (impossible across ES module bindings).

### D3. Phase 0 keeps a temporary in-chain compatibility subscriber

Phase 0 must be hardware-verifiable on its own, but the UI modules land in
Phase 1. So in Phase 0 each chain registers one small subscriber that performs
the existing DOM update (`#out` / `#state`) through the emitter and is
removed in Phase 1 when `js/ui/logview.js` and `js/ui/status.js` replace it.

Alternative: introduce UI modules in Phase 0 (larger diff, violates the
agreed phase boundary). The transitional subscriber is explicitly listed as a
Phase 1 deletion in `tasks.md`.

### D4. Render deferred, flush on terminal events

UI subscribers buffer and flush on a timer (`setTimeout`, ~100 ms) plus an
immediate flush when an `error`, `safe_to_exit` or `reboot_required` event
arrives and on `pagehide`. The beacon stays synchronous in Phase 0, so the
evidence stream is unchanged while DOM work leaves the hot path.

Alternatives: keep synchronous rendering (today's O(n^2) `innerHTML`
rebuild), microtask flush (a burst of 100+ events still renders eagerly). The
timer amortizes bursts; the terminal flush guarantees the final state is
visible even if the page is torn down.

### D5. Event payload schema

Stable, additive-only shape:

```text
{ type, ts, tag?, detail?, level?("info"|"quiet"), stage?(1..10),
  attempt?, name?, pass?, fail?, reason?, summary?, state? }
```

`tag` remains the primary hardware identifier; `type` is a second axis for
routing and must not rename tags. `stage_start` is emitted at stage entry and
`stage_success` only after that stage's proofs pass (stages 1-2 get explicit
markers they lack today).

### D6. Lapse import fixed to `./core.js?v=10`; promotion telemetry added

Change `chain_lapse.js:1` to the `?v=10` specifier used by `mem.js:6` and
`chain_poops.js:4`, register `onEvent` on `installWindowP`, and log
`PAIR-STATUS` like `chain_poops.js:215-219`. One module instance means
`releaseFakeCell()` (`mem.js:662`) reaches the live instance and the fake
cell's ~137 MB is released as intended.

Alternative: change `mem.js`/`chain_poops.js` to the plain specifier -
rejected (edits SLOPKIT, and poops works today). Promotion stays attempted by
default for lapse as it is today; if hardware logs show instability after the
release path activates, the fallback is poops' explicit opt-in
(`?pair=1`-style gate), which is a small follow-up.

### D7. Path policy for the Phase 2 move

```text
document-relative (document is loaded from root):
  fetch("payload.bin"), fetch("patches/<fw>.bin")   -> stay at root
  new Worker("rpc_worker.js")                        -> "js/engine/rpc_worker.js"
module-relative (resolved against the importing module):
  "./core.js?v=10", "./int64.js", ...                -> move together to js/engine/
HTML entry points: stay at root (FALLBACK + manifest anchors)
```

Alternatives: move assets to `data/` (four extra fetch edits for no gain),
absolute `/` paths (break project-page hosting), `import.meta.url`-based
worker URL (works but adds untested syntax to the console path).

### D8. Manifest tool: Node ESM, write by default, `--check` for CI

`tools/appcache-manifest.mjs`, zero dependencies, runs on the dev machine and
GitHub Actions:

```text
default   : recompute digests in place, preserve entry order
--check   : write nothing; exit non-zero on drift, missing file, or
            unlisted runtime file
rules     : strip "?query" for the filesystem path; core.js and
            core.js?v=10 hash the same file; runtime allowlist for
            orphan detection; dev files (AGENTS.md, openspec/**, tools/**,
            .github/**, README.md, LICENSE) are never manifest entries
```

Alternatives: PowerShell/Python (platform-specific or absent in CI), an npm
package (banned), git hooks (bypassable).

### D9. CSS and rendering constraints (PS4 WebKit)

Two stylesheets: `assets/css/base.css` (layout, flex column, log viewer
structure) and `assets/css/theme.css` (dark glass/cyberpunk: static
gradients, borders, `box-shadow`, custom properties). Rules:

- No web fonts (system stack only), no CDN, no external images beyond the
  local logo; all stylesheet and image URLs are manifest entries.
- No `backdrop-filter`/large blurs or animated glow on big surfaces; GPU
  budget goes to the exploit's own work.
- Log viewer appends one node per line with a FIFO cap and auto-scroll only
  when already at the bottom; it never rebuilds the full list.
- Interaction stays click + keydown (the `index.html:74-83` pattern) so a
  controller or remote can drive it; no hover-only affordances.
- UI storage keys are namespaced (`devcore-ui:*`); the UI never calls
  `localStorage.clear()` (poops' reboot gate lives in `ps4lab_committed_boot`)
  and never uses history APIs.

### D10. README aligns to `fw_status`, not the reverse

`ps4_offsets.js` `fw_status` is the evidence record; the README table is
updated to it (11.00 / 11.50 / 13.00 proven; 12.00 verified-vs-dump but
UNTESTED; 12.02 and 12.52 share those rows; 12.50 asserted table,
UNVERIFIED). No offset or status value changes.

## Risks / Trade-offs

- [Transitional in-chain subscriber persists past Phase 1] -> It is an
  explicit Phase 1 deletion task with a grep-based exit check (`outEl`/
  `stateEl` must not remain in `chain_*.js`).
- [Deferred flush loses the last lines on a hard crash] -> Terminal events
  flush immediately, and `pagehide` flushes; the beacon already received the
  lines synchronously.
- [Fixing the specifier activates the release path and JSC may collect
  mid-run] -> Lapse has no triple-free race like poops; verify `PAIR-UP
  released=N` on 11.00 and 12.02 first; fallback is the opt-in promotion gate.
- [Emitter payload allocation inside heap-sensitive windows] -> Payload
  objects replace the string/`innerHTML`/XHR work the same call sites already
  do; net synchronous work decreases. Hardware runs are the gate.
- [AppCache all-or-nothing update fails on one bad path] -> One manifest
  revision per phase, `--check` before publishing, digest equality proves
  byte-identical moves.
- [UI touches `document.body` while core.js relies on its own nodes] -> UI
  attaches inside existing containers and never replaces the body; constraint
  captured in the `exploit-event-bridge` spec.

## Migration Plan

1. **Phase 0** (single revision): add `js/engine/events.js`,
   `js/engine/telemetry.js`, rewire the four wrappers in both chains, add the
   transitional subscriber, fix the `?v=10` import and add promotion
   telemetry, align the README, add `tools/appcache-manifest.mjs`. Update
   `cache.appcache` (both `core.js` entries unchanged only if no content
   changed; new JS files added) and run `--check`.
2. **Phase 1** (single revision): add `js/ui/*` and `assets/css/*`, remove the
   transitional subscriber and the inline `<style>` blocks, delegate
   `index.html`. Manifest revision adds CSS/UI entries and updates the three
   HTML digests.
3. **Phase 2** (single revision): move engine files and the logo
   byte-identically, update worker strings and shell imports, rewrite every
   manifest entry and `FALLBACK` line together. Manifest revision is the
   deployment unit.
4. **Verification per phase**: `node tools/appcache-manifest.mjs --check`
   locally, then hardware runs on 11.00 and 13.00 reading `PROOF-*`,
   `PAIR-*` and terminal events; first-run and offline second-run on console.
5. **Rollback**: each phase is one commit; revert and re-publish the previous
   manifest revision. AppCache picks up the reverted manifest on the next
   load (the manifest itself is served no-cache).

## Open Questions

- Beacon batching (one request per N events) - safe to decide later with
  hardware evidence; the synchronous behavior is preserved for now.
- Whether to add a CI workflow that runs `--check` - the flag exists either
  way; CI wiring is additive and can land after Phase 0.
- Final visual treatment details (palette, exact gradients, toast placement)
  - reversible styling within the `theme.css` contract.

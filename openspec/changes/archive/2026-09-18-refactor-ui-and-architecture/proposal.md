## Why

The exploit engine currently reaches into the page UI and telemetry directly:
every `mark()` in `chain_lapse.js` / `chain_poops.js` rebuilds the whole log
via `outEl.innerHTML` (O(n^2) rendering) and fires one XHR beacon, synchronously
inside the same execution that is sensitive to heap layout. Nothing separates
"engine" from "view", so a UI change is a risk to the exploit and vice versa.
Three known defects compound this: `chain_lapse.js:1` imports `./core.js`
without the `?v=10` specifier that `mem.js` and `chain_poops.js` use (the
module-map split leaves the fake cell's ~137 MB pinned and hides promotion
telemetry), the README support table contradicts `fw_status` for four
firmwares, and `cache.appcache` SHA-256 entries are maintained by hand. The
engine is proven on 11.00/11.50/13.00, which makes now the safe point to
separate concerns and automate manifest hygiene in phases that can each be
verified on hardware.

## What Changes

**Phase 0 - critical fixes and event infrastructure (no file moves):**

- Add `js/engine/events.js` (DOM-agnostic emitter: event types, stable payload
  schema) and `js/engine/telemetry.js` (the `post("t")` beacon as a subscriber
  sink).
- Rewrite only the bodies of `mark()` / `check()` / `state()` / `post()` in
  both chains as thin wrappers over the emitter; all 374 existing call sites
  stay untouched and the per-chain `terse()`/`PROSE` behavior is preserved.
- Fix `chain_lapse.js:1` to `./core.js?v=10`, give `installWindowP` its
  `onEvent` callback and log `PAIR-STATUS`/`PAIR-UP` (parity with poops), and
  add the missing `stage_start` markers for stages 1-2.
- Align the README "Tested on hardware" table with `fw_status` in
  `ps4_offsets.js` (12.00, 12.02, 12.50 and 12.52 are UNTESTED).
- Add `tools/appcache-manifest.mjs` (zero-dependency Node script) that
  recomputes every `cache.appcache` SHA-256 entry and supports `--check` for
  non-writing verification.

**Phase 1 - UI extraction and modernization:**

- Add `js/ui/logview.js`, `js/ui/status.js`, `js/ui/toast.js`,
  `js/ui/detect.js`; `index.html` delegates firmware detection, AppCache
  bootstrap and routing to `js/ui/detect.js`.
- Add `assets/css/base.css` and `assets/css/theme.css` (dark
  glass/cyberpunk styling with native CSS only: static gradients, borders,
  shadows; no CDN fonts, no heavy blur on large surfaces); remove the inline
  `<style>` blocks; replace the fixed `height:calc(100vh - 141px)` log layout
  with a flex column.
- The log viewer appends lines incrementally with a batched flush instead of
  rebuilding `innerHTML` per line.

**Phase 2 - modular reorganization and AppCache rewrite:**

- **BREAKING**: move the engine files to `js/engine/` (byte-identical moves)
  and the logo to `assets/img/`; update the two `new Worker("rpc_worker.js")`
  sites, the shell module imports, all `cache.appcache` entries and
  `FALLBACK` lines in one manifest revision.
- `payload.bin` and `patches/` stay at the repository root (the four relative
  `fetch()` call sites are document-relative and keep working).

## Capabilities

### New Capabilities

- `exploit-event-bridge`: DOM-agnostic event emission from the exploit engine
  — event types (`init`, `stage_start`, `stage_success`, `log`, `error`,
  `safe_to_exit`, `reboot_required`), payload schema, stable hardware log
  tags, exception isolation between engine and UI, and the telemetry beacon
  as a subscriber.
- `offline-delivery`: integrity of the AppCache delivery layer — every
  runtime file listed with a correct lowercase SHA-256 (including both
  `core.js` entries), URL rules for module/worker/`fetch()` paths after
  reorganization, and automated verification via
  `tools/appcache-manifest.mjs --check`.

### Modified Capabilities

- None. `openspec/specs/` is empty; both capabilities above are new.

## Impact

- **Code**: `chain_lapse.js`, `chain_poops.js`, `index.html`,
  `run_lapse.html`, `run_poops.html`, `README.md`, `cache.appcache`; new
  `js/engine/events.js`, `js/engine/telemetry.js`, `js/ui/*.js`,
  `assets/css/*.css`, `assets/img/logo_raw.png`, `tools/appcache-manifest.mjs`.
- **Unchanged by contract**: `core.js`, `mem.js`, `int64.js`, `rpc_worker.js`
  stay byte-identical (SLOPKIT licensing boundary); the engine consumes only
  their existing `onEvent` hooks. `payload.bin`, `patches/*.bin` and
  `logo_raw.png` are never edited (logo is relocated byte-identical).
- **Behavior**: UI and beacon receive the same tags/order through a new
  mediator; lapse now executes the release path and reports pair status;
  firmware support documentation matches `fw_status`; deployment gains a
  verifiable manifest check.
- **Dependencies/systems**: none added. Still zero backend, zero npm runtime,
  no build step. New dev-only Node script is not a runtime file.
- **Verification**: in-page `PROOF-*` / `PAIR-*` / `PAIR-UP released=N` logs
  on hardware 11.00 and 13.00 (the `fw_status=proven` firmwares), plus
  `node tools/appcache-manifest.mjs --check`.

### Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Event wrapper adds work in heap-sensitive windows | Failed or unstable runs | Wrapper does no more synchronous work than today's `mark()`; UI render is deferred; beacon stays synchronous in Phase 0 |
| AppCache update is all-or-nothing | Console serves stale build or `CACHE FAILED` | One manifest revision per phase; `--check` before publishing; files moved byte-identical |
| Fixing the `?v=10` specifier activates the release path (garbage + JSC collection) | Memory profile changes mid-run | Lapse has no triple-free race; hardware-verify `PAIR-UP` on 11.00/12.02 before defaulting; keep promotion policy explicit |
| UI touches shared browser state (`history`, storage, `document.body`) | Exploit breaks silently | Documented constraints: no `pushState`/`replaceState`/hash routing, namespaced storage keys, never `clear()`, never replace body |
| Moving engine files breaks module/worker URLs | Offline load fails | Module imports are module-relative (move together); worker and `fetch()` are document-relative (update 2 worker strings, keep HTML at root) |

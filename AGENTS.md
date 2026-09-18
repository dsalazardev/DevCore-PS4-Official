# AGENTS.md — Developer & AI Operational Guidelines

Operational rules for AI agents and human contributors in this repository.
Read this file before touching any runtime file. When a rule below conflicts
with a generic habit (formatting, refactoring, dependency installation), this
file wins.

## 1. What This Repo Is

- A static WebKit + kernel exploit chain for PlayStation 4 firmware 11.00-13.00.
  It is a PS4 port of SLOPKIT by Jordy, carrying two kernel chains:
  - `lapse` -> firmware 11.00, 11.50, 12.00, 12.02
  - `poops` -> firmware 12.50, 12.52, 13.00
- 100% client-side: everything runs in the console's browser (WebKit/JSC).
  There is no backend, no database, no server-side code, no CDN, and no build
  step. Any static web host can serve it.
- Offline delivery via HTML5 AppCache (`cache.appcache`). `index.html` detects
  the firmware from the User-Agent and routes to `run_lapse.html` or
  `run_poops.html`, which import the matching chain module.
- The run is non-deterministic by design: a failed attempt can crash the
  browser or require a console reboot. Never promise deterministic behavior.
- Licensing is split: MIT covers only the port work (chains, offset tables,
  routing/delivery layer). SLOPKIT files, `payload.bin` and the patch blobs
  are third-party and excluded (see `LICENSE`).

## 2. Golden Rules (Hard Constraints)

- **Never edit frozen binaries**: `payload.bin` (GoldHEN, redistributed
  unmodified), `patches/*.bin` (kernel patch blobs),
  `assets/img/logo_raw.png`.
- **Never edit the third-party SLOPKIT sources**: `js/engine/core.js`,
  `js/engine/mem.js`, `js/engine/int64.js`, `js/engine/rpc_worker.js`. Keep
  them unmodified to preserve the licensing boundary; changes there belong
  upstream or in the chain files.
- **The repository is byte-frozen**: `.gitattributes` pins `* -text` on
  purpose. Never change line endings, reformat, minify, transpile, or add a
  BOM to any file. An EOL translation silently changes a file's SHA-256 and
  breaks AppCache on consoles. Do not run auto-formatters.
- **Keep `cache.appcache` in sync**: it pins a lowercase SHA-256 hex digest
  next to every cached entry.
  - After editing or adding a runtime file, regenerate its hash and update
    the manifest entry. Recompute with `sha256sum <file>` (or
    `Get-FileHash -Algorithm SHA256`; the manifest uses lowercase).
  - The core module has **two entries** - `js/engine/core.js` and
    `js/engine/core.js?v=10` - and both must always carry the same hash.
    Update them together.
  - New runtime files must be listed under `CACHE MANIFEST`; new HTML shells
    also need a `FALLBACK` line. Removing a runtime file means removing its
    entry.
  - Dev/tooling files (`AGENTS.md`, `.github/**`, `openspec/**`,
    `.opencode/**`, `.claude/**`, `README.md`, `LICENSE`) are not runtime
    files and must NOT be added to the manifest.
- **Zero dependencies, zero backend**: do not add a root `package.json`, npm
  runtime libraries, bundlers, CDN links, or server code. The only allowed
  package file is `.opencode/package.json` (agent tooling, git-ignored). All
  `fetch()` calls use relative paths only - `payload.bin`,
  `patches/<firmware>.bin`.
- **Serve correctly or not at all**: `cache.appcache` must be served as
  `text/cache-manifest` with no caching (`.htaccess` handles both on Apache).
  GitHub Pages sets the MIME type but ignores `.htaccess`.

## 3. Architecture & Data Flow

```
PS4 browser (WebKit / JSC)
  |
  |  index.html  -- AppCache bootstrap + User-Agent firmware detection
  |                  <= 12.02 -> lapse    >= 12.50 -> poops
  v
run_lapse.html / run_poops.html          (thin shells, type="module")
  |                                       import js/ui/* + js/engine/chain_*
  v
js/engine/chain_lapse.js / chain_poops.js  (linear stages 1..10, gated + logged)
  |-- core.js         SLOPKIT: addrof/fakeobj -> fake cell in JSC
  |-- mem.js          window.p (read/write) + fake-cell -> real-pair promotion
  |-- int64.js        64-bit (lo, hi) arithmetic
  |-- ps4_offsets.js  per-firmware WebKit gadget / kernel RVA tables
  |-- rpc_worker.js   worker-side read/write helper
  |-- events.js       DOM-free event stream (init/stage/log/error/terminal)
  |
  +-- fetch("payload.bin")          -> GoldHEN payload, mapped RWX and launched
  +-- fetch("patches/<fw>.bin")     -> kernel patch blob, applied + byte-verified

js/ui/{logview,status,toast,detect}.js subscribe to js/engine/events.js; no
engine file touches the DOM.
```

- Post-exploitation order is fixed: root escalation -> sandbox escape
  (`fd_rdir`/`fd_jdir`) -> kernel patch (read back and byte-checked before it
  is enabled) -> payload map + launch. Each step is gated on the previous one
  verifying (`js/engine/chain_lapse.js:209-253` loads the blobs; the payload only runs
  when `kpatched` is true or `?payload=1` forces it).
- The page persists nothing except AppCache and the diagnostic `post()`
  beacon to the relative path `"t"`.

## 4. Code Conventions

- **64-bit arithmetic is mandatory.** Every pointer/value above 32 bits is a
  `new int64(lo, hi)` (`js/engine/int64.js`) with `>>> 0` discipline on both
  words. Never pass a plain `Number` wider than 32 bits where a 64-bit value
  is expected. `js/engine/mem.js` normalizes numeric/object addresses and
  rejects non-canonical ones (`hi > 0xffff`) - keep that validation
  (`js/engine/mem.js:26-30`).
- **Use the published memory API.** `installWindowP()` publishes `window.p`
  with `read1/2/4/8`, `write1/2/4/8` and `leakval`
  (`js/engine/mem.js:733-743`). Wrap every carrier access in
  `aim ... finally restore` so a throw cannot leave the window mis-aimed. If
  a promotion fails and its rollback cannot verify, `window.p` is withdrawn
  by design (`js/engine/mem.js:757-762`) - never re-publish a broken
  primitive.
- **Keep module specifiers consistent.** The engine imports `./core.js?v=10`
  on purpose: the query string is part of the module identity, and a
  mismatched specifier builds a second `core.js` instance - the exact failure
  documented at `js/engine/chain_poops.js:1-3` (pins ~137 MB). All three
  importers (`js/engine/mem.js`, `js/engine/chain_lapse.js`,
  `js/engine/chain_poops.js`) now use the same specifier; keep it that way,
  and update both matching `cache.appcache` entries if it ever changes.
- **Respect stage discipline.** Chains are linear and gated. A stage advances
  only when the previous one has been proven with `check(name, ok, detail)`
  and its progress is visible as a `mark(tag, detail)` line. Never skip a
  stage, silently narrow it, or relax a proof to make a run pass. Teardown and
  restore paths (expm1 `m_function`, worker disarm, thread affinity/priority,
  file descriptors) must run and verify on both success and failure.
- **Keep log tags stable.** `mark()` tags are the contract used to read
  hardware logs; never rename or repurpose an existing tag. The wrappers
  emit through `js/engine/events.js` (`EV.LOG` / `EV.TELEMETRY`) and the UI
  subscribes from `js/ui/*`; the engine itself must stay DOM-free. Keep
  `terse()` compact output intact and add detail behind `?verbose=1`.
- **Error handling.** Annotate failures with named tags (for example
  `KPATCH-FETCH-FAILED`), never swallow a critical failure, and preserve the
  `REBOOT-REQUIRED` vs `SAFE-TO-EXIT` distinction
  (`js/engine/chain_lapse.js:3817-3855`): a dirty teardown must say so
  explicitly, and every run must emit exactly one of `EV.SAFE_TO_EXIT` /
  `EV.REBOOT_REQUIRED`.
- **Style.** 4-space indent, double quotes, semicolons, English comments and
  identifiers only. Constants are `SCREAMING_SNAKE_CASE`; kernel offsets use
  `k_`, WebKit offsets use `wk_`. Keep hex tables aligned, with per-line byte
  pattern comments where known. Stay within the syntax the console browser
  handles (no `??`); `class` and `?.` are already used.

## 5. Firmware & Offsets Rules (`js/engine/ps4_offsets.js`)

- `js/engine/ps4_offsets.js` is the single source of truth for WebKit gadget
  offsets and kernel RVAs. Never hardcode offsets in chain files; read them
  through `offsetsFor()` (`js/engine/ps4_offsets.js:447`), keyed off the
  User-Agent.
- Every firmware block carries an `fw_status` string documenting its proof
  state (`proven`, `UNTESTED-on-hardware`, `verified-vs-dump`, ...). Update it
  truthfully when evidence changes; it is the reference other agents and
  humans trust over prose.
- Keep the `REQUIRED_KEYS` and `OPTIONAL_KEYS` lists
  (`js/engine/ps4_offsets.js:1-27`) in sync with the keys you add or remove.
- Aliases: firmwares that share another row use `alias_of` plus a `kpatch`
  override (`12.02` -> `12.00`, `12.52` -> `12.50`). Only create an alias when
  the sharing is known and documented; never "fix" a mismatch by copying
  values silently.
- Never hardcode `PRISON0` or `ROOTVNODE`: they are read from the live kernel
  (`curproc->ucred->cr_prison`) so a wrong constant cannot exist. Do not
  reintroduce them as table entries.
- Adding firmware coverage requires at minimum: a new `PS4` block (or a
  documented alias), a matching `patches/<fw>.bin` blob, and the
  corresponding `cache.appcache` entry. Never invent RVAs; mark anything not
  independently verified as UNTESTED.

## 6. OpenSpec Workflow & Branching

- OpenSpec lives at `openspec/` (`config.yaml`, schema `spec-driven`):
  `changes/` for active changes, `changes/archive/` for finished ones,
  `specs/` for durable capabilities. Use the CLI - `openspec new change`,
  `openspec status`, `openspec instructions`, `openspec validate`,
  `openspec archive` - and never hand-create a change directory (metadata
  such as `.openspec.yaml` must be scaffolded by the CLI).
- Agent tooling is mirrored across three surfaces and must stay identical:
  - Skills: `.opencode/skills/`, `.claude/skills/`, `.github/skills/`
  - Commands/prompts: `.opencode/commands/opsx-*.md`,
    `.claude/commands/opsx/*.md`, `.github/prompts/opsx-*.prompt.md`
  - Agent config: `.github/agents/openspec.agent.md`
  Any edit to a workflow skill or command must be replicated to every mirror.
- Branches: active development happens on `custom/main` (adds the dev tooling
  on top of `main`); `main` holds the published content. `origin` is
  `dsalazardev/DevCore-PS4-Official` (push target); `upstream` is
  `rawgame4/rawgame4.github.io` - never push there.
- Follow the existing commit style: conventional commits (for example
  `feat(dev-tools): ...`).
- CI is limited to `.github/workflows/copilot-setup-steps.yml`, which only
  installs the OpenSpec CLI. Do not assume tests run in CI.

## 7. Known Inconsistencies & Verification

- **README vs `fw_status`**: aligned in this change - the README table now
  mirrors `js/engine/ps4_offsets.js` (11.00/11.50/13.00 proven;
  12.00/12.02/12.50/12.52 UNTESTED). Keep it that way: `fw_status` and
  hardware logs are the source of truth, never assumptions.
- **Core.js import specifier**: fixed in this change - lapse now imports
  `./core.js?v=10` like the other two importers, so a single module instance
  exists and `releaseFakeCell()` reaches the live fake cell. Verify on
  hardware with the `PAIR-UP` / `PAIR-STATUS` lines; update both
  `cache.appcache` entries if the specifier ever changes.
- **Missing tools**: `tools/checkfw.js` and `tools/addfw.js` are referenced in
  `js/engine/ps4_offsets.js` comments but do not exist in the repository. Do
  not assume they are available; ask before creating them.
- **Diagnostic beacon**: the telemetry sink (`js/engine/telemetry.js`) sends
  an XHR to the relative path `"t"`. There is no such file in the repo; a 404
  there is expected and is not a failure.
- **No local verification harness**: there is no build, test, lint, or
  typecheck step. The only valid evidence is the in-page `PROOF-*`/`mark()`
  log and real hardware runs. Never claim something is "tested" or "fixed"
  without that evidence, and never relax an in-page proof to make a local run
  pass. For planning artifacts, `openspec validate` is the only automated
  check.

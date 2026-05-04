# TODO — codebase improvement backlog

Findings consolidated from the April 2026 review and the May 2026
follow-up audit. Ordered by impact; "do first" items are most likely
to pay back quickly.

## Nice to have

### 1. Per-column icon X positions in the single-row HUD
Per-column icon X positions in `renderHud.js` (`14`, `84`, `154`,
`264`) are still literals — fine today, but if a sixth column ever
lands they should become a single layout array so the gaps are
maintained automatically.

**Impact:** low. Defer until the next column actually lands.

### 2. Collectibles and mana mines share update patterns
Both manage age, lifetime, removal, and call into `stepItemPhysics`.
If a third item type appears, the duplication will bite. Not urgent —
defer until the third type actually arrives (Rule of Three).

## Explicitly skipped

The first-pass agent review flagged several "defensive" items that
aren't worth chasing — recording them here so we don't redo the
analysis:

- **Rope length clamp on attach.** `physics.js` already clamps
  `ropeLen` via `Math.min(ROPE_MAX_LEN, ...)` and initial length uses a
  sane bound.
- **Divide-by-zero guards on platform width.** `buildPlatforms` already
  filters platforms with `w < 3`; guards inside `stepItemPhysics` /
  `main.js` snap logic would be paranoia.
- **Negative-width platform validation.** Platforms are built internally
  from terminal text metrics — malformed data isn't a real threat.
- **Rope anchor inside-platform-bounds assertion.** Cosmetic, no
  gameplay effect.
- **`GameState` class around the mutation-heavy `state` object.** The
  pragmatic mutation pattern is fine for a single-threaded game loop.
  Adding a class boundary would cost more than it earns.

## Done

### April 2026 review
- **Split `src/render.js` into focused modules.** Now `renderHud.js`,
  `renderShield.js`, `renderSplash.js`; `render.js` itself dropped
  from 1042 → ~830 lines.
- **Full-lifecycle tests for scene-driven missions.** `escapeLava.test.js`,
  `meteorShower.test.js`, and `aloneInDark.test.js` cover `onEnter`,
  `update` edge cases, `check`, and the restart/reset path.

### May 2026 audit + refactor
- **`drawCenteredBanner` shared helper** (formerly two near-clones in
  `render.js`). Drop ~80 lines; per-element alpha multipliers preserved
  via `{ rgb, alpha }` colour tuples.
- **`computeFadeAlpha(age, fadeIn, hold, fadeOut)`** in `runStats.js`.
  Trapezoidal fade envelope was duplicated inline in `drawMissionToast`
  and inside `titleBannerAlpha`; now both call into one function.
- **`clonePose(pose)`** in `poses.js`. Replaces the two
  `JSON.parse(JSON.stringify(IDLE))` deep-clone sites in `main.js` and
  `physics.js`.
- **`advanceWalkAnimation(state, dt, frames, speed)`** in `physics.js`.
  Collapses four near-identical walk-cycle branches in `updatePose`
  (water stroke, prone crawl, crouch walk, standing walk) into a single
  helper.
- **`missionTopY(state)` and `resetMissionBase(state)`** in
  `missions/_shared.js`. Replace four duplicated `textOffsetY ||
  effectiveHudHeight` fallbacks (escape-lava, ice-age, meteor-shower,
  shardfall) and the two cookie-cutter `restart*` cleanups
  (escape-lava, meteor-shower).
- **Mission-state contract documented.** `progression.js` header now
  spells out which fields missions may read/mutate and which belong to
  progression alone — closes the "future mission could quietly violate
  the contract" risk.
- **Smoke tests via mock canvas context.** `drawCenteredBanner`,
  `drawShieldAura`, `drawStasisVignette`, `drawEndScreen`, and
  `drawDrillFloorEffect` all run against a recording mock that
  supports paths, gradients, and the full subset of methods these
  helpers use — catches typos and property-access bugs without needing
  a real canvas. (Two of those were private to render.js; exported as
  test-only seams to enable the coverage.)
- **HUD layout magic numbers hoisted.** `TWO_ROW_INSET`,
  `MISSION_CLIP_INSET`, `MISSION_CLIP_HEIGHT`, `SEPARATOR_HALF` in
  `renderHud.js`; `SHIELD_AURA_RADIUS_PADDING` in `render.js`. The
  remaining literals are per-column X positions, still left as
  literals until a layout change actually requires them to move.
- **Replaced `.lock().unwrap()` in `src-tauri/src/lib.rs`** at all
  five call sites (focus / blur / set_hud_tall reads; bounds-poll
  write; text-bounds read in the content-poll loop). Each now uses
  a `match … { Ok(g) => *g, Err(_) => return | continue }` guard so
  a panic-poisoned Mutex is survivable: focus / hud-tall handlers
  silently skip the layout pass, and the poll threads drop the
  iteration and retry on the next tick instead of dragging the
  entire overlay down with them.

## Overall health

Shipping-quality for its scope. Render pipeline is consolidated, pose
animation has no obvious duplication left, the mission lifecycle is
well-tested, and the Rust side no longer has poisoned-Mutex panics on
its hot paths. The only items left are deferred ones (per-column HUD
X positions, collectibles/mines unification) — both of which are best
left until a future change actually demands them.

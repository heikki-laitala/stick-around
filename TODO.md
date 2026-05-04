# TODO — codebase improvement backlog

Findings consolidated from the April 2026 review and the May 2026
follow-up audit. Ordered by impact; "do first" items are most likely
to pay back quickly.

## Do first

### 1. Replace `.lock().unwrap()` in `src-tauri/src/lib.rs`
Four call sites (lines 88, 111, 296, 314) call `.lock().unwrap()` on the
shared bounds Mutex. A panic anywhere under the lock poisons it and
kills the whole overlay on the next tick. Cheap fix:

```rust
if let Ok(guard) = bounds.lock() { /* use guard */ }
// else: skip this tick, try again next poll.
```

**Impact:** safety. Low probability but fatal when it happens.

## Nice to have

### 2. Consolidate remaining HUD/shield magic numbers
Most shield literals (`SHIELD_FADE_IN_DURATION`, `CAST_FLASH_DURATION`)
are already constants in `spells.js`. What's left to hoist:

- HUD row centers `15` / `hudH - 15`, mission-clip y/height (`12`/`24`),
  separator tick half-height `9` (in `renderHud.js`).
- Per-column icon X positions (`14`, `84`, `154`, `264`) — fine as
  literals, but could become a single layout array if a sixth column
  ever lands.
- Shield aura padding `+22 px` (in `renderShield.js`).

**Impact:** tuneability. Next visual pass becomes grep-free.

### 3. Smoke-test the private banner / overlay render paths
`drawCenteredBanner`, `drawShieldAura`, and `drawStasisVignette` now
have smoke tests. Two private helpers in `render.js` still don't:

- `drawEndScreen` (run-summary panel)
- `drawDrillFloorEffect` (long-press-S magic circle)

Both are file-local. Either export them (test-only seam) or wrap in a
single `_test_renderHelpers` re-export in the spirit of `_setNowForTests`.

**Impact:** safety net for refactors; cheap to add now that the
mock-context pattern is in place.

### 4. Collectibles and mana mines share update patterns
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
  `drawShieldAura`, and `drawStasisVignette` all run against a
  recording mock that supports paths, gradients, and the full subset
  of methods these helpers use — catches typos and property-access
  bugs without needing a real canvas.

## Overall health

Shipping-quality for its scope. Render pipeline is consolidated, pose
animation has no obvious duplication left, and the mission lifecycle
is well-tested. Remaining items are maintainability polish and one
real safety fix (`.lock().unwrap()`); none block a release.

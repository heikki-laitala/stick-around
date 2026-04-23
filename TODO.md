# TODO — codebase improvement backlog

Findings from a full-codebase review (April 2026). Ordered by impact;
"do first" items are most likely to pay back quickly.

## Do first

### 1. Hoist shared mission scaffolding (Rule of Three)
`escapeLava`, `meteorShower`, and any future mission repeat:

- HUD-height floor fallback via `textOffsetY || effectiveHudHeight`.
- `renderGameOver(ctx, W, H)` overlay (near-identical copies).
- `restart*(state)` that clears `gameOver`, `currentMissionId`,
  `missionScene`.

Extract to `src/missions/lib.js` with `missionFloorY(state)`,
`renderGameOverOverlay(ctx, W, H)`, `resetMission(state)`.

**Impact:** maintainability. Stops drift between mission files.

### 2. Replace `.lock().unwrap()` in `src-tauri/src/lib.rs`
Four call sites (lines 88, 111, 296, 314) call `.lock().unwrap()` on the
shared bounds Mutex. A panic anywhere under the lock poisons it and
kills the whole overlay on the next tick. Cheap fix:

```rust
if let Ok(guard) = bounds.lock() { /* use guard */ }
// else: skip this tick, try again next poll.
```

**Impact:** safety. Low probability but fatal when it happens.

## Nice to have

### 3. Consolidate newly-added HUD/shield magic numbers
Recent HUD + shield work left literals scattered in `render.js`:

- HUD row centers `15` / `hudH - 15`, separator tick half-height `9`,
  mission clip height `24`, class/spell/inventory icon X positions
  (`14`, `84`, `154`, `274`, `384`).
- Shield aura padding `+22` px, `SHIELD_FADE_IN_DURATION = 0.2`,
  `CAST_FLASH_DURATION = 0.35`.

Move to a `HUD_*` constants block (ideally near `HUD_HEIGHT`) and a
`SHIELD_*` block in `spells.js` or a new `shieldVisuals.js`.

**Impact:** tuneability. Next visual pass becomes grep-free.

### 4. Stop deep-cloning static poses via JSON
`src/physics.js:388` and `src/main.js:38` use
`JSON.parse(JSON.stringify(IDLE))` to copy a small static pose object.
Swap to `{ ...IDLE }` (shallow) or a tiny `clonePose(p)` helper.

**Impact:** code smell only — poses are small and this runs rarely.

### 5. Pose interpolation duplication in `updatePose`
`src/physics.js:330-371` has 3–4 near-identical branches that advance
`walkPh`, wrap to [0, 1), index into a WALK cycle, and lerp poses.
Extract `advanceWalkAnimation(state, speed, frames)`.

**Impact:** maintainability only. Small payoff unless a new pose cycle
is being added.

### 6. Collectibles and mana mines share update patterns
Both manage age, lifetime, removal, and call into
`stepItemPhysics`. If a third item type appears, the duplication will
bite. Not urgent today — defer until the third type actually arrives
(Rule of Three).

### 7. Document the mission-state contract
Missions are expected to only mutate `state.missionScene` and not reach
into `state.score`, `state.mana`, or other gameplay globals. This
convention isn't written down anywhere; a future mission could violate
it quietly. Add a short comment at the top of `src/progression.js` and
inside the mission template.

**Impact:** low today, architectural hygiene as missions multiply.

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

## Done since this list was written

- **Split `src/render.js` into focused modules.** Now
  `renderHud.js` (373), `renderShield.js` (165), `renderSplash.js` (381);
  `render.js` is down from 1042 → 831 lines.
- **Full-lifecycle tests for scene-driven missions.** `escapeLava.test.js`,
  `meteorShower.test.js`, and `aloneInDark.test.js` cover `onEnter`,
  `update` edge cases, `check`, and the restart/reset path.

## Overall health

Shipping-quality for its scope. The two biggest risk surfaces from the
original review — `render.js` size and missing mission-lifecycle tests —
are addressed. Remaining items are maintainability polish and one safety
fix (`.lock().unwrap()`); none block a release.

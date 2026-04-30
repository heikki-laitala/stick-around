import { effectiveHudHeight } from '../constants.js';
import { resetPlayer } from '../physics.js';
import { LIGHTNING_BEAM_WIDTH, LIGHTNING_RANGE } from '../spells.js';
import { renderGameOver, spawnXRange } from './_shared.js';
import {
  drawStars,
  drawEdges,
  drawGuideLines,
  drawShotFlash,
  drawTargetDiagram,
  renderConstellationHud,
} from './constellation/render.js';

/**
 * "Constellation Maker" mission.
 *
 * Stars are pinned to fixed screen-space positions for the duration of
 * the run — they don't ride terminal scroll. Each lightning bolt walks
 * along a ray from the wand tip; if the ray crosses two of the target
 * stars, they get linked. The puzzle is geometric: find a place to
 * stand where the two stars you want to connect lie along a single
 * upward-pointing ray.
 *
 * The goal isn't reflex — it's spatial reasoning. Where you can stand
 * shifts as Claude streams new content (platforms scroll), so a route
 * that worked five seconds ago might require a different perch now.
 * That's the only way the mission interacts with terminal dynamism.
 */

export const CONSTELLATION_DURATION = 90;          // seconds before timeout
export const CONSTELLATION_PRIMER_MANA = 24;       // ~12 shots for 5 edges — small margin
// Bolts are very forgiving — a star within this perpendicular distance
// of the ray counts as on the ray. Wide enough that the player can be
// "close" without being pixel-perfect, so the puzzle is about routing
// to the right perch, not about millimetre aim.
export const STAR_BEAM_TOLERANCE = LIGHTNING_BEAM_WIDTH * 1.1;
export const FLASH_DURATION = 0.6;                 // seconds the success/fail flash lingers
export const STAR_RADIUS = 4.5;

function placeStars(state) {
  // Fan-pattern stars: anchor "A" near the top, with three outliers
  // close to vertical from it. Positions are chosen so each line
  // through the anchor and an outlier, extended down to the prompt
  // row, lands inside the visible text width — i.e. there's always
  // an on-screen perch the player can walk to.
  const { x0, x1 } = spawnXRange(state);
  const w = x1 - x0;
  const top = effectiveHudHeight(state.screenW || 800);
  const at = (id, fx, dy) => ({ id, x: x0 + w * fx, y: top + dy });
  return [
    at('A', 0.50, 60),                             // anchor — top centre
    at('B', 0.40, 140),                            // lower-left of anchor
    at('C', 0.60, 140),                            // lower-right of anchor
    at('D', 0.50, 220),                            // directly below anchor
  ];
}

const TARGET_EDGES = [
  { a: 'A', b: 'B' },
  { a: 'A', b: 'C' },
  { a: 'A', b: 'D' },
  { a: 'D', b: 'B' },
  { a: 'D', b: 'C' },
];

function makeEdges() {
  return TARGET_EDGES.map((e) => ({ a: e.a, b: e.b, drawn: false }));
}

/**
 * Find every target star whose perpendicular distance to the bolt's
 * ray is within tolerance and whose along-distance is within range.
 * Returned in along-ray order so the closest hit is element 0.
 */
export function starsHitByBolt(stars, bolt) {
  if (!bolt || !Array.isArray(stars)) return [];
  const cos = Math.cos(bolt.angle);
  const sin = Math.sin(bolt.angle);
  const hits = [];
  for (const star of stars) {
    const dx = star.x - bolt.x;
    const dy = star.y - bolt.y;
    const along = dx * cos + dy * sin;
    const across = -dx * sin + dy * cos;
    if (along < 0 || along > LIGHTNING_RANGE) continue;
    if (Math.abs(across) > STAR_BEAM_TOLERANCE) continue;
    hits.push({ star, along });
  }
  hits.sort((a, b) => a.along - b.along);
  return hits.map((h) => h.star);
}

function findEdge(edges, idA, idB) {
  return edges.find((e) =>
    !e.drawn && ((e.a === idA && e.b === idB) || (e.a === idB && e.b === idA)),
  );
}

function processBolt(scene, bolt) {
  // Find the first two stars on the ray; that's the candidate pair.
  // Any further stars on the same ray are ignored — one shot, one pair.
  const hits = starsHitByBolt(scene.stars, bolt);
  if (hits.length < 2) {
    scene.flash = { hits, success: false, age: 0, missed: true };
    return;
  }
  const [a, b] = hits;
  const edge = findEdge(scene.edges, a.id, b.id);
  if (edge) {
    edge.drawn = true;
    scene.flash = { from: a, to: b, success: true, age: 0 };
  } else {
    scene.flash = { from: a, to: b, success: false, age: 0 };
  }
}

function ageFlash(scene, dt) {
  if (!scene.flash) return;
  scene.flash.age += dt;
  if (scene.flash.age >= FLASH_DURATION) scene.flash = null;
}

function edgesRemaining(scene) {
  let n = 0;
  for (const e of scene.edges || []) if (!e.drawn) n++;
  return n;
}

export const CONSTELLATION_MISSION = {
  id: 'constellation',
  text: 'Trace the constellation with lightning bolts',
  rewardTitle: 'sky cartographer',
  unlocks: ['constellation-survivor'],

  questSuffix(state) {
    const scene = state.missionScene;
    if (!scene) return '';
    const drawn = (scene.edges || []).filter((e) => e.drawn).length;
    const total = scene.edges?.length || 0;
    const left = Math.max(0, scene.timeLeft || 0);
    return `(${drawn}/${total} · ${left.toFixed(1)}s)`;
  },

  onEnter(state) {
    const scene = state.missionScene;
    if ((state.mana || 0) < CONSTELLATION_PRIMER_MANA) {
      state.mana = CONSTELLATION_PRIMER_MANA;
    }
    scene.timeLeft = CONSTELLATION_DURATION;
    scene.stars = placeStars(state);
    scene.edges = makeEdges();
    scene.flash = null;
    scene.lastBolt = null;                         // tracks which bolt we've already scored
    state.gameOver = false;
    resetPlayer(state);
  },

  check(state) {
    const scene = state.missionScene;
    if (!scene) return false;
    return edgesRemaining(scene) === 0;
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;
    if (state.gameOver) return;

    // A new bolt has appeared — score it once, then mark as seen so we
    // don't double-count over its life. state.lightningBolt becomes
    // null when the bolt expires; the next non-null is a fresh one.
    if (state.lightningBolt && state.lightningBolt !== scene.lastBolt) {
      scene.lastBolt = state.lightningBolt;
      processBolt(scene, state.lightningBolt);
    }

    ageFlash(scene, dt);

    if (edgesRemaining(scene) === 0) return;

    scene.timeLeft = Math.max(0, (scene.timeLeft || 0) - dt);
    if (scene.timeLeft <= 0) {
      state.gameOver = true;
      state.gvx = 0;
      state.gvy = 0;
    }
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;
    drawGuideLines(ctx, scene);
    drawEdges(ctx, scene);
    drawShotFlash(ctx, scene);
    drawStars(ctx, scene.stars);
    drawTargetDiagram(ctx, scene, state.screenW || W);
    renderConstellationHud(ctx, scene, state.screenW || W);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};

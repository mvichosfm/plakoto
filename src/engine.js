// Plakoto (Πλακωτό) rules engine and computer opponent. Pure: no DOM, imported by the
// browser, the AI worker and the node tests.
//
// Coordinates. Each player counts his own path 24 -> 1: point 24 is his starting point,
// 1..6 his home board, 0 = borne off. The two players travel in OPPOSITE directions, so one
// player's point r is the other player's point S(r) = 25 - r (the map is its own inverse): my
// starting point is the opponent's last home point, and his starting point is mine.
// A game is { pos: [white, black], pin: [white, black], off: [w, b] } where pos[p][r] counts
// player p's checkers on his own point r (a pinned checker included) and pin[p][r] = 1 when p's
// checker on his point r is pinned under an opponent checker (it is then his only checker there).
// Absolute board points 0..23 (used only for drawing; the page draws from the human's seat):
// white r -> r - 1, black r -> 24 - r. White starts on 23, black on 0.
//
// Rules implemented (Greek Plakoto, as played in tavli; bkgm.com "Plakoto", Wikipedia "Plakoto"):
// - 15 checkers each, all on the starting point; no hitting.
// - A point holding two or more of the opponent's checkers is closed to me.
// - Landing on a point holding a single opponent checker PINS it: my checker goes on top, his
//   cannot move until every checker of mine has left that point. A point where an opponent
//   checker pins one of mine is closed to me (even though only one of his stands there); a point
//   where I pin his checker is mine, and more of my checkers may join it.
// - Play both dice if possible (four moves on doubles); if only one die can be played it must be
//   the larger one when that is possible. A checker moving both dice stops on the point between,
//   so it can pin there and free that checker again by moving on.
// - Bear off once all 15 are in the home board (a pinned checker of mine inside it counts as
//   home but cannot move; one pinned outside it stops bearing off). Exact die, or a higher die
//   from the highest occupied point (a pinned checker on a higher point counts as occupying it).
// - The mother: my last checker on my starting point. If it is pinned there, I lose double at
//   once - unless the pinner still has checkers on his own starting point. Then play goes on: if
//   he later empties his starting point while my mother is still pinned he wins double; if my
//   side pins his mother too, the game is a tie (no points). Judged after every whole move.
// - Win = 1 point; mars (the loser has borne nothing off) = 2 points; mother = 2 points.

export const WHITE = 0, BLACK = 1;
export const S = (r) => 25 - r;
export const absOf = (p, r) => (p === WHITE ? r - 1 : 24 - r);

export function newGame() {
  const w = new Int8Array(25), k = new Int8Array(25);
  w[24] = 15; k[24] = 15;
  return { pos: [w, k], pin: [new Int8Array(25), new Int8Array(25)], off: [0, 0] };
}

export function cloneGame(g) {
  return {
    pos: [Int8Array.from(g.pos[0]), Int8Array.from(g.pos[1])],
    pin: [Int8Array.from(g.pin[0]), Int8Array.from(g.pin[1])],
    off: g.off.slice(),
  };
}

// Plain arrays (worker messages, JSON) -> a game; missing pin arrays read as "nothing pinned".
export function gameFrom(o) {
  const pin = o.pin || [new Array(25).fill(0), new Array(25).fill(0)];
  return { pos: [Int8Array.from(o.pos[0]), Int8Array.from(o.pos[1])], pin: [Int8Array.from(pin[0]), Int8Array.from(pin[1])], off: o.off.slice() };
}
export const gamePlain = (g) => ({ pos: [Array.from(g.pos[0]), Array.from(g.pos[1])], pin: [Array.from(g.pin[0]), Array.from(g.pin[1])], off: g.off.slice() });

export const expandDice = (d) => (d[0] === d[1] ? [d[0], d[0], d[0], d[0]] : [d[0], d[1]]);

// A view is a game seen from the side to move: mine / opp in their own numbering, mp = my pinned
// checkers (by my point), op = his pinned checkers (by his point).
export function viewOf(g, p) {
  return {
    mine: Int8Array.from(g.pos[p]), opp: Int8Array.from(g.pos[1 - p]),
    mp: Int8Array.from(g.pin[p]), op: Int8Array.from(g.pin[1 - p]),
    myOff: g.off[p], oppOff: g.off[1 - p],
  };
}
export const viewFrom = (o) => ({
  mine: Int8Array.from(o.mine), opp: Int8Array.from(o.opp),
  mp: Int8Array.from(o.mp || new Array(25).fill(0)), op: Int8Array.from(o.op || new Array(25).fill(0)),
  myOff: o.myOff, oppOff: o.oppOff,
});
export const viewPlain = (v) => ({ mine: Array.from(v.mine), opp: Array.from(v.opp), mp: Array.from(v.mp), op: Array.from(v.op), myOff: v.myOff, oppOff: v.oppOff });

// ------------------------------------------------------------------ move legality
function allHome(v) {
  for (let r = 7; r <= 24; r++) if (v.mine[r]) return false;
  return true;
}

// Can I land on my point t (1..24)? Closed when he has two or more there, or when his single
// checker there is pinning mine.
export function canLand(v, t) {
  const o = v.opp[S(t)];
  return o === 0 || (o === 1 && !v.mp[t]);
}

// Target of moving a checker from r with die d (0 = bear off), or -1.
function stepTarget(v, r, d) {
  const t = r - d;
  if (t >= 1) return canLand(v, t) ? t : -1;
  if (!allHome(v)) return -1;
  if (t === 0) return 0;
  for (let q = r + 1; q <= 6; q++) if (v.mine[q]) return -1;
  return 0;
}

// Moves a checker r -> t (0 = off) with the pin bookkeeping and returns a code for undoStep:
// t in the low 5 bits, +32 if it pinned a checker on t, +64 if it freed one on r.
function moveRaw(v, r, t) {
  let code = t;
  v.mine[r]--;
  if (!v.mine[r] && v.op[S(r)]) { v.op[S(r)] = 0; code |= 64; } // my last checker leaves: his checker is free again
  if (t) {
    const q = S(t);
    if (v.opp[q] === 1 && !v.op[q] && !v.mine[t]) { v.op[q] = 1; code |= 32; } // a lone opponent checker: pinned
    v.mine[t]++;
  } else v.myOff++;
  return code;
}

function undoStep(v, r, code) {
  const t = code & 31;
  if (t) { v.mine[t]--; if (code & 32) v.op[S(t)] = 0; } else v.myOff--;
  v.mine[r]++;
  if (code & 64) v.op[S(r)] = 1;
}

// Applies the step and returns its code (>= 0), or returns -1 and leaves v untouched.
function tryStep(v, r, d) {
  if (v.mine[r] - v.mp[r] < 1) return -1; // no checker of mine there that is free to move
  const t = stepTarget(v, r, d);
  if (t < 0) return -1;
  return moveRaw(v, r, t);
}

const without = (arr, i) => arr.slice(0, i).concat(arr.slice(i + 1));

// Most dice that can still be played from v.
function maxPlay(v, rem) {
  let best = 0;
  if (!rem.length) return best;
  for (let i = 0; i < rem.length; i++) {
    const d = rem[i];
    if (rem.indexOf(d) !== i) continue;
    const rest = without(rem, i);
    for (let r = 24; r >= 1; r--) {
      const c = tryStep(v, r, d);
      if (c < 0) continue;
      const n = 1 + maxPlay(v, rest);
      undoStep(v, r, c);
      if (n > best) { best = n; if (best === rem.length) return best; }
    }
  }
  return best;
}

// ------------------------------------------------------------------ interactive turn
// A turn the UI plays one checker step at a time; every step offered keeps the maximum number of
// dice playable, so a finished turn is always a legal play. `T.abs` (optional, set by the page)
// maps own points to the board points it draws; the default is the white-seat absOf.
export function createTurn(g, p, dice) {
  const v = viewOf(g, p);
  const rem = expandDice(dice);
  return { p, dice: dice.slice(), v, rem, M: maxPlay(v, rem), played: [] };
}

export function turnDone(T) { return T.played.length >= T.M; }

export function turnSteps(T) {
  const need = T.M - T.played.length;
  if (need <= 0) return [];
  const out = [];
  const { v, rem } = T;
  const abs = T.abs || ((r) => absOf(T.p, r));
  for (let i = 0; i < rem.length; i++) {
    const d = rem[i];
    if (rem.indexOf(d) !== i) continue;
    const rest = without(rem, i);
    for (let r = 24; r >= 1; r--) {
      const c = tryStep(v, r, d);
      if (c < 0) continue;
      const n = 1 + maxPlay(v, rest);
      undoStep(v, r, c);
      const t = c & 31;
      if (n >= need) out.push({ r, t, d, from: abs(r), to: t ? abs(t) : -1, pin: !!(c & 32), free: !!(c & 64) });
    }
  }
  // Only one die playable in total: it must be the larger one if that is possible.
  if (T.M === 1 && rem.length === 2 && rem[0] !== rem[1]) {
    const hi = Math.max(rem[0], rem[1]);
    if (out.some((s) => s.d === hi)) return out.filter((s) => s.d === hi);
  }
  return out;
}

export function turnPlay(T, step) {
  const legal = turnSteps(T).find((s) => s.r === step.r && s.d === step.d);
  if (!legal) throw new Error(`illegal step ${JSON.stringify(step)}`);
  tryStep(T.v, legal.r, legal.d);
  T.rem.splice(T.rem.indexOf(legal.d), 1);
  T.played.push(legal);
  return legal;
}

// Writes a finished (or partial) turn back into the game.
export function commitTurn(g, T) {
  g.pos[T.p] = Int8Array.from(T.v.mine);
  g.pin[T.p] = Int8Array.from(T.v.mp);
  g.pin[1 - T.p] = Int8Array.from(T.v.op);
  g.off[T.p] = T.v.myOff;
}

// Applies a recorded play ({r, t, d} steps, own numbering; t = 0 bears off) to game g, pins
// included. Used to rebuild positions when replaying saved games; the steps were legal when recorded.
export function applySteps(g, p, steps) {
  const v = viewOf(g, p);
  for (const s of steps) moveRaw(v, s.r, s.t);
  g.pos[p] = v.mine; g.pin[p] = v.mp; g.pin[1 - p] = v.op; g.off[p] = v.myOff;
  return g;
}

// The mother: p's last checker on his starting point, pinned there.
export const motherPinned = (g, p) => g.pos[p][24] === 1 && g.pin[p][24] === 1;

// The result of the position after a whole move, or null while the game goes on:
// { p, points, how: 'off' | 'mother' } or a tie { p: -1, points: 0, how: 'tie', tie: true }.
export function winner(g) {
  if (g.off[0] === 15) return { p: 0, points: g.off[1] === 0 ? 2 : 1, how: 'off' };
  if (g.off[1] === 15) return { p: 1, points: g.off[0] === 0 ? 2 : 1, how: 'off' };
  const m0 = motherPinned(g, 0), m1 = motherPinned(g, 1);
  if (m0 && m1) return { p: -1, points: 0, how: 'tie', tie: true };
  if (m1 && !g.pos[0][24]) return { p: 0, points: 2, how: 'mother' };
  if (m0 && !g.pos[1][24]) return { p: 1, points: 2, how: 'mother' };
  return null;
}

export const pips = (g, p) => { let s = 0; for (let r = 1; r <= 24; r++) s += r * g.pos[p][r]; return s; };

// ------------------------------------------------------------------ full-turn enumeration
function keyOf(v) {
  let a = 0, b = 0;
  for (let r = 1; r <= 24; r++) { if (v.mp[r]) a |= 1 << r; if (v.op[r]) b |= 1 << r; }
  return String.fromCharCode.apply(null, v.mine) + v.myOff + ':' + a + ':' + b;
}

// Every distinct position reachable with a legal full play, with one step list each.
export function finalPositions(v, rem) {
  const leaves = new Map();
  const seen = new Set();
  let maxLen = 0;
  const steps = [];
  const rec = (rest) => {
    // (a node with dice left is visited once per board + dice; one with none left is a leaf
    // de-duplicated by the leaf map below, so it skips the seen-set - most nodes are leaves)
    if (rest.length) {
      const k = keyOf(v) + '|' + rest.join('');
      if (seen.has(k)) return;
      seen.add(k);
    }
    let moved = false;
    for (let i = 0; i < rest.length; i++) {
      const d = rest[i];
      if (rest.indexOf(d) !== i) continue;
      const after = without(rest, i);
      for (let r = 24; r >= 1; r--) {
        const c = tryStep(v, r, d);
        if (c < 0) continue;
        moved = true;
        steps.push({ r, t: c & 31, d });
        rec(after);
        steps.pop();
        undoStep(v, r, c);
      }
    }
    if (!moved && steps.length) { // a play that cannot go further: a candidate (the longest are kept)
      const fk = keyOf(v);
      if (steps.length > maxLen) maxLen = steps.length;
      const prev = leaves.get(fk);
      // the same final position reached by a single step of either die (e.g. the last checker borne
      // off with a 3 or a 5) keeps the LARGER die's step: when only one die can be played that is the
      // only one the interactive turn accepts, so the smaller one's steps could not be replayed (the
      // bug that froze a browser game; inherited from Fevga's engine)
      if (!prev || prev.steps.length < steps.length || (steps.length === 1 && prev.steps.length === 1 && steps[0].d > prev.steps[0].d)) {
        leaves.set(fk, { steps: steps.slice(), mine: Int8Array.from(v.mine), mp: Int8Array.from(v.mp), op: Int8Array.from(v.op), myOff: v.myOff, n: steps.length });
      }
    }
  };
  rec(rem);
  let out = [...leaves.values()].filter((l) => l.n === maxLen);
  if (maxLen === 1 && rem.length === 2 && rem[0] !== rem[1]) {
    const hi = Math.max(rem[0], rem[1]);
    if (out.some((l) => l.steps[0].d === hi)) out = out.filter((l) => l.steps[0].d === hi);
  }
  return out;
}

// ------------------------------------------------------------------ evaluation
// Chance (of 36) that a checker d pips away (1..24) is reached by one roll, ignoring blocks in
// between: REACH[k] = bitmask of distances roll k reaches, ROLLS[k].w its weight out of 1.
const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push({ dice: [a, b], w: a === b ? 1 / 36 : 2 / 36 });
const REACH = ROLLS.map(({ dice: [a, b] }) => {
  let m = 0;
  if (a === b) for (let k = 1; k <= 4; k++) m |= 1 << (a * k);
  else m = (1 << a) | (1 << b) | (1 << (a + b));
  return m;
});
// (memoised: the evaluation asks for the same few shooter patterns millions of times in play-outs)
const HIT_CACHE = new Map();
const hitChance = (mask) => {
  let p = HIT_CACHE.get(mask);
  if (p !== undefined) return p;
  p = 0;
  for (let k = 0; k < ROLLS.length; k++) if (mask & REACH[k]) p += ROLLS[k].w;
  if (HIT_CACHE.size < 200000) HIT_CACHE.set(mask, p);
  return p;
};

// Score of a position for the side whose view it is, in "pips". Antisymmetric:
// evaluate(flip(v)) === -evaluate(v), which the two-ply search relies on.
// Parameters (tuned by self-play, see test/tune.mjs):
// pinBase + pinPip * r = cost of a checker pinned on its own point r (deeper back costs more);
// motherHeld = cost of a pinned mother while the pinner still has checkers on his start;
// blot = weight of (chance of being pinned) x (cost of that pin) for each lone checker;
// motherBlot = cost used for a lone mother instead; mobScale/mobExp/mobCnt shape the penalty for
// k of the six points ahead of a checker being closed; prime = consecutive closed points;
// stack = checkers beyond three on a point; off = per borne-off checker (on top of the pips).
export function makeWeights(q) {
  const mob = [0], prime = [0, 0, 0.5, 2, 5, 9, 15].map((x) => x * q.prime);
  for (let k = 1; k <= 6; k++) mob.push(q.mobScale * Math.pow(k, q.mobExp));
  return { ...q, mob, prime };
}
export const PARAMS = {
  basic: { pinBase: 6, pinPip: 0.5, motherHeld: 40, blot: 0.6, motherBlot: 40, mobScale: 0.3, mobExp: 1.5, mobCnt: 0.1, prime: 0.4, stack: 0.2, off: 1 },
  full: { pinBase: 10, pinPip: 1.0, motherHeld: 70, blot: 1.0, motherBlot: 90, mobScale: 0.5, mobExp: 1.6, mobCnt: 0.2, prime: 0.8, stack: 0.5, off: 1.5 },
  // test/tune.mjs, 2026-10-09: 4 sweeps x 2000 greedy self-play games from `full` -> 74.2% of points vs
  // `full`; a second pass of sweeps starting here found no further change (converged)
  tuned: { pinBase: 10, pinPip: 1, motherHeld: 70, blot: 0.2015, motherBlot: 90, mobScale: 0.5, mobExp: 1.6, mobCnt: 0.2, prime: 0.536, stack: 1.125, off: 1.5 },
};
export const WEIGHTS = { basic: makeWeights(PARAMS.basic), full: makeWeights(PARAMS.full), tuned: makeWeights(PARAMS.tuned) };

const WIN = 10000;

// Is my point t closed to the opponent? (two or more of mine, or mine pinning his checker)
const closedToOpp = (A, Bp, t) => A[t] >= 2 || (A[t] === 1 && Bp[S(t)] === 1);

// The troubles of side A (own numbering, Ap = A's pinned) against side B (Bp = B's pinned):
// cost of A's pinned checkers, risk to A's lone checkers, A's checkers hemmed in by B's closed
// points, A's heavy stacks, and B's closed runs with A checkers still behind them.
function troubles(A, Ap, B, Bp, W) {
  let pinned = 0, risk = 0, hem = 0, stack = 0, prime = 0;
  for (let r = 1; r <= 24; r++) {
    const c = A[r];
    if (!c) continue;
    if (Ap[r]) { pinned += r === 24 ? W.motherHeld : W.pinBase + W.pinPip * r; continue; }
    if (r >= 7 && c > 3) stack += c - 3;
    // a lone free checker that is not itself pinning: B can pin it from behind (his s > S(r))
    if (c === 1 && !Bp[S(r)]) {
      const q = S(r);
      let mask = 0;
      for (let s = q + 1; s <= 24; s++) if (B[s] - Bp[s] > 0) mask |= 1 << (s - q);
      if (mask) risk += hitChance(mask) * (r === 24 ? W.motherBlot : W.pinBase + W.pinPip * r);
    }
    // hemmed in: closed points among the six in front of this checker
    let k = 0;
    for (let d = 1; d <= 6 && r - d >= 1; d++) if (closedToOpp(B, Ap, S(r - d))) k++;
    if (k) hem += W.mob[k] * (1 + W.mobCnt * (Math.min(c, 8) - 1)) * (r <= 6 ? 0.5 : 1);
  }
  // B's runs of closed points with a free A checker still behind them
  let rear = 0;
  for (let r = 24; r >= 1; r--) if (A[r] && !Ap[r]) { rear = r; break; }
  let run = 0;
  for (let r = 1; r <= 25; r++) {
    if (r <= 24 && closedToOpp(B, Ap, S(r))) { run++; continue; }
    if (run >= 2 && rear > r - 1) prime += W.prime[Math.min(run, 6)];
    run = 0;
  }
  return { pinned, risk: risk * W.blot, hem, stack, prime };
}

// The game result for a view (side to move = mine), or null: +points if I have won, -points if
// he has, 0 for a tie. Mirrors winner() from the viewer's side.
export function viewResult(v) {
  if (v.myOff === 15) return v.oppOff === 0 ? 2 : 1;
  if (v.oppOff === 15) return v.myOff === 0 ? -2 : -1;
  const mine = v.mine[24] === 1 && v.mp[24] === 1, his = v.opp[24] === 1 && v.op[24] === 1;
  if (mine && his) return 0;
  if (his && !v.mine[24]) return 2;
  if (mine && !v.opp[24]) return -2;
  return null;
}

export function evaluate(v, W = WEIGHTS.full) {
  const res = viewResult(v);
  if (res !== null) return res * WIN;
  let my = 0, op = 0;
  for (let r = 1; r <= 24; r++) { my += r * v.mine[r]; op += r * v.opp[r]; }
  const a = troubles(v.mine, v.mp, v.opp, v.op, W);
  const b = troubles(v.opp, v.op, v.mine, v.mp, W);
  return (op - my) + W.off * (v.myOff - v.oppOff)
    + (b.pinned - a.pinned) + (b.risk - a.risk) + (b.hem - a.hem) + (b.prime - a.prime) + W.stack * (b.stack - a.stack);
}

// ------------------------------------------------------------------ computer player
export const LEVELS = [
  { level: 1, name: 'Beginner', blurb: 'Moves at random' },
  { level: 2, name: 'Novice', blurb: 'Counts pips, often careless' },
  { level: 3, name: 'Intermediate', blurb: 'Pins and guards sensibly' },
  { level: 4, name: 'Advanced', blurb: 'Weighs every risk of a move' },
  { level: 5, name: 'Expert', blurb: 'Looks at every reply, no mistakes' },
];

// What each level does: W = evaluation weights, noise = std-dev (pips) added to every
// score, random = chance of a random move, topN = two-ply search over the N best candidates.
export const LEVEL_CONFIG = {
  2: { W: WEIGHTS.basic, noise: 5, random: 0.12 },
  3: { W: WEIGHTS.full, noise: 1.5 },
  4: { W: WEIGHTS.tuned, noise: 0 },
  5: { W: WEIGHTS.tuned, noise: 0, topN: 10 },
};

function gauss(rnd) {
  const u = Math.max(1e-9, rnd()), w = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}

const leafView = (v, f) => ({ mine: f.mine, opp: v.opp, mp: f.mp, op: f.op, myOff: f.myOff, oppOff: v.oppOff });

// Expected score of my position f after the opponent's best (greedy) reply, averaged over his 21 rolls.
function replyValue(v, f, W) {
  const lv = leafView(v, f);
  if (viewResult(lv) !== null) return evaluate(lv, W);
  const ov = { mine: Int8Array.from(v.opp), opp: f.mine, mp: Int8Array.from(f.op), op: Int8Array.from(f.mp), myOff: v.oppOff, oppOff: f.myOff };
  let exp = 0;
  for (const roll of ROLLS) {
    const replies = finalPositions(ov, expandDice(roll.dice));
    let best;
    if (!replies.length) best = evaluate(ov, W);
    else {
      best = -Infinity;
      for (const rep of replies) {
        const s = evaluate({ mine: rep.mine, opp: f.mine, mp: rep.mp, op: rep.op, myOff: rep.myOff, oppOff: f.myOff }, W);
        if (s > best) best = s;
      }
    }
    exp -= roll.w * best;
  }
  return exp;
}

/**
 * Picks a full play for player p. Returns the step list ({r, t, d}, own numbering);
 * empty when no move is possible.
 */
export function chooseMove(g, p, dice, level, rnd = Math.random, opts = {}) {
  const v = viewOf(g, p);
  const finals = finalPositions(v, expandDice(dice));
  if (!finals.length) return [];
  if (finals.length === 1 || level <= 1) return finals[Math.floor(rnd() * finals.length)].steps;

  const cfg = { ...LEVEL_CONFIG[level], ...opts };
  if (cfg.random && rnd() < cfg.random) return finals[Math.floor(rnd() * finals.length)].steps;

  const W = cfg.W;
  const scored = finals.map((f) => ({ f, s: evaluate(leafView(v, f), W) + (cfg.noise ? gauss(rnd) * cfg.noise : 0) }));
  scored.sort((a, b) => b.s - a.s);
  if (!cfg.topN) return scored[0].f.steps;

  const top = scored.slice(0, cfg.topN);
  let best = top[0], bestV = -Infinity;
  for (const c of top) {
    const val = replyValue(v, c.f, W);
    if (val > bestV) { bestV = val; best = c; }
  }
  return best.f.steps;
}

// ------------------------------------------------------------------ Mr. Makis (level 10 coach)
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Longest run of my closed points standing in front of a free opponent checker, in MY numbering
// (from = the end nearer my start).
function longestWall(v) {
  let rear = 0; // his rearmost free checker, his numbering
  for (let s = 24; s >= 1; s--) if (v.opp[s] && !v.op[s]) { rear = s; break; }
  let best = { len: 0, from: 0, to: 0 }, run = 0;
  for (let s = 1; s <= 25; s++) {
    if (s <= 24 && s < rear && closedToOpp(v.mine, v.op, S(s))) { run++; continue; }
    if (run > best.len) best = { len: run, from: S(s - run), to: S(s - 1) };
    run = 0;
  }
  return best;
}

// My lone checkers the opponent can pin next roll: [{ r, p (chance 0..1) }], most at risk first.
export function exposedBlots(v) {
  const out = [];
  for (let r = 1; r <= 24; r++) {
    if (v.mine[r] !== 1 || v.mp[r] || v.op[S(r)]) continue;
    const q = S(r);
    let mask = 0;
    for (let s = q + 1; s <= 24; s++) if (v.opp[s] - v.op[s] > 0) mask |= 1 << (s - q);
    if (mask) out.push({ r, p: hitChance(mask) });
  }
  return out.sort((a, b) => b.p - a.p);
}

// Plain facts about a position (side to move = mine) that the coach's explanations quote.
export function positionFacts(v, W = WEIGHTS.tuned) {
  const a = troubles(v.mine, v.mp, v.opp, v.op, W), b = troubles(v.opp, v.op, v.mine, v.mp, W);
  let myPips = 0, oppPips = 0, points = 0, myPinned = 0, oppPinned = 0;
  for (let r = 1; r <= 24; r++) {
    myPips += r * v.mine[r]; oppPips += r * v.opp[r];
    if (v.mine[r] && closedToOpp(v.mine, v.op, r)) points++;
    myPinned += v.mp[r]; oppPinned += v.op[r];
  }
  const blots = exposedBlots(v);
  // contact: some checker of either side still has an opponent checker ahead of it on its path
  let myRear = 0, hisRear = 0;
  for (let r = 24; r >= 1; r--) if (v.mine[r]) { myRear = r; break; }
  for (let s = 24; s >= 1; s--) if (v.opp[s]) { hisRear = s; break; }
  const contact = myRear + hisRear > 25 || myPinned + oppPinned > 0;
  return {
    myPips, oppPips, off: v.myOff, points, myPinned, oppPinned,
    motherAlone: v.mine[24] === 1 && !v.mp[24], motherPinned: v.mine[24] === 1 && !!v.mp[24],
    oppMotherPinned: v.opp[24] === 1 && !!v.op[24], myStart: v.mine[24], oppStart: v.opp[24],
    blots, risk: a.risk, oppRisk: b.risk, meHemmed: a.hem, oppHemmed: b.hem, stack: a.stack,
    wall: longestWall(v), contact, eval: evaluate(v, W),
  };
}

// How many free opponent checkers still have to pass my point r, and how many sit 1-6 pips behind it.
export function blockReach(v, r) {
  const s0 = S(r);
  let behind = 0, near = 0;
  for (let s = s0 + 1; s <= 24; s++) { const n = v.opp[s] - v.op[s]; behind += n; if (s - s0 <= 6) near += n; }
  return { behind, near };
}

function gameOfView(v) {
  return { pos: [Int8Array.from(v.mine), Int8Array.from(v.opp)], pin: [Int8Array.from(v.mp), Int8Array.from(v.op)], off: [v.myOff, v.oppOff] };
}

// Plays the game out from view v (opponent to move) with both sides playing the tuned greedy
// policy; returns points won (+) or lost (-) by "mine" (0 for a tie).
function rollout(v, rnd) {
  const g = gameOfView(v);
  let p = 1;
  for (let turn = 0; turn < 600; turn++) {
    const w = winner(g);
    if (w) return w.p === -1 ? 0 : w.p === 0 ? w.points : -w.points;
    const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    applySteps(g, p, chooseMove(g, p, d, 4, rnd));
    p = 1 - p;
  }
  return 0;
}

/**
 * Winning chances for the board as it stands: `rollouts` play-outs of game `g` with side `toMove`
 * to roll, both sides playing the tuned greedy policy (the same one Mr. Makis's estimates use, so
 * the numbers agree with his). Fractions: `white` / `black` = P(that side wins), `tie` = P(both
 * mothers pinned), `whiteMars` / `blackMars` = P(that side wins double). Estimates, not exact:
 * about +-3 points at 300 play-outs.
 */
export function winChances(g, toMove, { rollouts = 300, seed = 1 } = {}) {
  const w0 = winner(g);
  if (w0) {
    return { white: w0.p === 0 ? 1 : 0, black: w0.p === 1 ? 1 : 0, tie: w0.p === -1 ? 1 : 0, whiteMars: w0.p === 0 && w0.points === 2 ? 1 : 0, blackMars: w0.p === 1 && w0.points === 2 ? 1 : 0, rollouts: 0 };
  }
  let win = 0, lose = 0, wm = 0, bm = 0;
  for (let i = 0; i < rollouts; i++) {
    const rnd = mulberry(seed * 104729 + i);
    const sim = cloneGame(g);
    let p = toMove, r = 0;
    for (let turn = 0; turn < 600; turn++) {
      const w = winner(sim);
      if (w) { r = w.p === -1 ? 0 : w.p === 0 ? w.points : -w.points; break; }
      const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
      applySteps(sim, p, chooseMove(sim, p, d, 4, rnd));
      p = 1 - p;
    }
    if (r > 0) win++; else if (r < 0) lose++;
    if (r === 2) wm++; else if (r === -2) bm++;
  }
  return { white: win / rollouts, black: lose / rollouts, tie: (rollouts - win - lose) / rollouts, whiteMars: wm / rollouts, blackMars: bm / rollouts, rollouts };
}

/**
 * Level-10 analysis of the side to move in view v with remaining dice `rem`: two-ply scores
 * for every legal play, then `rollouts` play-outs each (same dice for every candidate) for the
 * best `top`. Returns candidates best first with win rate, equity and position facts.
 */
export function analyzeView(v, rem, { top = 4, rollouts = 40, seed = 1 } = {}) {
  const W = WEIGHTS.tuned;
  const finals = finalPositions(v, rem);
  const base = positionFacts(v, W);
  if (!finals.length) return { base, cands: [], legal: 0 };
  const pre = finals.map((f) => ({ f, s: evaluate(leafView(v, f), W) })).sort((x, y) => y.s - x.s).slice(0, 30);
  for (const c of pre) c.ply2 = replyValue(v, c.f, W);
  pre.sort((x, y) => y.ply2 - x.ply2);
  const cands = pre.slice(0, finals.length === 1 ? 1 : top).map((c) => candidate(v, c.f, c.ply2, finals.length > 1 ? rollouts : 0, seed));
  if (finals.length > 1) cands.sort((x, y) => (y.eq - x.eq) || (y.ply2 - x.ply2));
  return { base, cands, legal: finals.length, rollouts, considered: pre.length };
}

// One analysed play: `rollouts` play-outs (seeded per index, so every candidate of a position
// sees the same dice) plus the facts the coach's explanations quote. rollouts 0 = no play-outs.
function candidate(v, f, ply2, rollouts, seed, W = WEIGHTS.tuned) {
  const lv = leafView(v, f);
  const res = viewResult(lv);
  let eq = 0, wins = 0;
  for (let i = 0; i < rollouts; i++) {
    const r = res !== null ? res : rollout(lv, mulberry(seed * 7919 + i)); // common random numbers across candidates
    eq += r; if (r > 0) wins++;
  }
  const facts = positionFacts(lv, W);
  const newPts = [], vacated = [], pins = [], freed = [];
  for (let r = 1; r <= 24; r++) {
    const was = v.mine[r] > 0 && closedToOpp(v.mine, v.op, r), now = f.mine[r] > 0 && closedToOpp(f.mine, f.op, r);
    if (!was && now) newPts.push({ r, ...blockReach(lv, r) });
    if (was && !now) vacated.push({ r, ...blockReach(v, r) });
    // his checkers newly pinned / released by this play (r = my numbering of the point)
    if (!v.op[S(r)] && f.op[S(r)]) pins.push({ r, mother: r === 1 && v.opp[24] === 1 });
    if (v.op[S(r)] && !f.op[S(r)]) freed.push({ r });
  }
  return { steps: f.steps, ply2, eq: rollouts ? eq / rollouts : null, win: rollouts ? wins / rollouts : null, result: res, facts, newPts, vacated, pins, freed };
}

// ------------------------------------------------------------------ mistake review
// Reviews the plays `side` made in a recorded game (turns = [{p, dice, steps}], as in records.js).
// Step 1, screenTurns (fast, ~10 ms a turn): the two-ply loss of every turn that had a choice,
// i.e. how much worse the play made scored than the best play, after the opponent's best reply.
// Step 2, reviewTurn (Mr. Makis's play-outs, ~2 s): for one turn, the played move against the
// best few, so the loss can be quoted as win chance.
function positionsBefore(turns) {
  const g = newGame(), out = [];
  for (const t of turns) { out.push(cloneGame(g)); applySteps(g, t.p, t.steps); }
  return out;
}
const finalKey = (f) => Array.from(f.mine).join(',') + '|' + f.myOff + '|' + Array.from(f.mp).join('') + '|' + Array.from(f.op).join('');
function playedFinal(v, steps) {
  const w = { mine: Int8Array.from(v.mine), opp: v.opp, mp: Int8Array.from(v.mp), op: Int8Array.from(v.op), myOff: v.myOff };
  for (const s of steps) moveRaw(w, s.r, s.t);
  return { steps, mine: w.mine, mp: w.mp, op: w.op, myOff: w.myOff };
}

// Puzzles: the final-position key a play leads to (the format test/make-puzzles.mjs stores in
// `keys`), and a play described the way the coach's explanations expect (no play-outs).
export const playKey = (v, steps) => finalKey(playedFinal(v, steps));
export const describePlay = (v, steps) => candidate(v, playedFinal(v, steps), null, 0, 1);

export function screenTurns(turns, side, W = WEIGHTS.tuned) {
  const before = positionsBefore(turns), out = [];
  turns.forEach((t, i) => {
    if (t.p !== side) return;
    const v = viewOf(before[i], side);
    const finals = finalPositions(v, expandDice(t.dice));
    if (finals.length <= 1) return;
    const played = playedFinal(v, t.steps), pk = finalKey(played);
    const pre = finals.map((f) => ({ f, s: evaluate(leafView(v, f), W) })).sort((x, y) => y.s - x.s).slice(0, 10);
    if (!pre.some((c) => finalKey(c.f) === pk)) pre.push({ f: played });
    let best = -Infinity, mine = null;
    for (const c of pre) {
      const val = replyValue(v, c.f, W);
      if (val > best) best = val;
      if (finalKey(c.f) === pk) mine = val;
    }
    out.push({ i, loss: best - mine, legal: finals.length });
  });
  return out;
}

export function reviewTurn(turns, i, { rollouts = 120, top = 3, seed = 1 } = {}) {
  const t = turns[i], g = positionsBefore(turns.slice(0, i + 1))[i], v = viewOf(g, t.p), W = WEIGHTS.tuned;
  const finals = finalPositions(v, expandDice(t.dice));
  const played = playedFinal(v, t.steps), pk = finalKey(played);
  const pre = finals.map((f) => ({ f, s: evaluate(leafView(v, f), W) })).sort((x, y) => y.s - x.s).slice(0, 30);
  for (const c of pre) c.ply2 = replyValue(v, c.f, W);
  pre.sort((x, y) => y.ply2 - x.ply2);
  const picks = pre.slice(0, top);
  const playedPick = picks.find((c) => finalKey(c.f) === pk);
  const cands = picks.map((c) => ({ ...candidate(v, c.f, c.ply2, rollouts, seed), mine: c === playedPick }));
  if (!playedPick) cands.push({ ...candidate(v, played, replyValue(v, played, W), rollouts, seed), mine: true });
  cands.sort((x, y) => (y.eq - x.eq) || (y.ply2 - x.ply2));
  return { i, dice: t.dice.slice(), legal: finals.length, rollouts, base: positionFacts(v, W), best: cands[0], played: cands.find((c) => c.mine), cands };
}

export function rollDice(rnd = Math.random) {
  return [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
}

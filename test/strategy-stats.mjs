// Evidence for strategy.html: node test/strategy-stats.mjs [games=3000] [level=4]
// Self-play at one level (both sides alike, fixed seeds: the numbers reproduce exactly) and the
// figures the guide quotes, printed as JSON. If the engine, weights or levels change, rerun this
// and update the page's DATA block and prose (both languages), then node test/strategy-check.mjs.
import { newGame, chooseMove, applySteps, winner, mulberry, cloneGame } from '../src/engine.js';

const N = +(process.argv[2] || 3000), LV = +(process.argv[3] || 4);
const out = {
  games: N, level: LV, turns: 0, starterWins: 0, decided: 0,
  ends: { single: 0, mars: 0, mother: 0, tie: 0, unfinished: 0 },
  firstPin: { games: 0, pinnerWins: 0 },
  pinBuckets: { '1-6': [0, 0], '7-12': [0, 0], '13-18': [0, 0], '19-24': [0, 0] }, // pinned checker's pips still to go: [pins, pinner won]
  motherAlone: { exposed: 0, pinnedNext: 0, lostGame: 0 },
  motherExposedSides: { sides: 0, wins: 0, never: 0, neverWins: 0 }, // sides whose lone mother ever stood within reach
  pinsAt10: {}, // (my pins - his pins) after each side's 10th turn -> [positions, wins]
  blotsAt10: {}, // my exposed lone checkers after my 10th turn -> [positions, wins]
};
const bucket = (s) => (s <= 6 ? '1-6' : s <= 12 ? '7-12' : s <= 18 ? '13-18' : '19-24');

for (let i = 0; i < N; i++) {
  const rnd = mulberry(90001 + i);
  const g = newGame();
  const first = i % 2;
  let p = first, turn = 0, firstPinBy = -1;
  const pinEvents = [];       // [pinner, bucket]
  const motherEvents = [];    // [side whose lone mother was exposed, turn]
  const everExposed = [false, false];
  const at10 = [null, null];
  let w = null;
  for (; turn < 1000; turn++) {
    w = winner(g); if (w) break;
    const before = cloneGame(g);
    const dice = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    applySteps(g, p, chooseMove(g, p, dice, LV, rnd));
    const o = 1 - p;
    // new pins made by p this turn (on o's points)
    for (let s = 1; s <= 24; s++) if (!before.pin[o][s] && g.pin[o][s]) {
      pinEvents.push([p, bucket(s)]);
      if (firstPinBy < 0) firstPinBy = p;
    }
    // was o's lone mother exposed before this turn, and did p pin it now?
    const exposed = before.pos[o][24] === 1 && !before.pin[o][24];
    if (exposed) {
      let shooter = false;
      for (let s = 2; s <= 13; s++) if (before.pos[p][s] - before.pin[p][s] > 0) shooter = true;
      if (shooter) { everExposed[o] = true; out.motherAlone.exposed++; if (g.pin[o][24]) { out.motherAlone.pinnedNext++; motherEvents.push(o); } }
    }
    // after p's 10th turn
    const myTurnNo = Math.floor(turn / 2) + 1;
    if (myTurnNo === 10 && at10[p] === null) {
      let mine = 0, his = 0, blots = 0;
      for (let s = 1; s <= 24; s++) { mine += g.pin[o][s]; his += g.pin[p][s]; }
      for (let r = 1; r <= 24; r++) {
        if (g.pos[p][r] !== 1 || g.pin[p][r] || g.pin[o][25 - r]) continue;
        let reach = false;
        for (let s = 25 - r + 1; s <= Math.min(24, 25 - r + 12); s++) if (g.pos[o][s] - g.pin[o][s] > 0) reach = true;
        if (reach) blots++;
      }
      at10[p] = { d: Math.max(-3, Math.min(3, mine - his)), blots: Math.min(blots, 4) };
    }
    p = o;
  }
  out.turns += turn;
  if (!w) { out.ends.unfinished++; continue; }
  if (w.p === -1) { out.ends.tie++; continue; }
  out.decided++;
  if (w.p === first) out.starterWins++;
  if (w.how === 'mother') { out.ends.mother++; if (motherEvents.includes(1 - w.p)) out.motherAlone.lostGame++; }
  else if (w.points === 2) out.ends.mars++; else out.ends.single++;
  if (firstPinBy >= 0) { out.firstPin.games++; if (firstPinBy === w.p) out.firstPin.pinnerWins++; }
  for (const [pinner, b] of pinEvents) { out.pinBuckets[b][0]++; if (pinner === w.p) out.pinBuckets[b][1]++; }
  for (let q = 0; q < 2; q++) {
    const M = out.motherExposedSides;
    if (everExposed[q]) { M.sides++; if (w.p === q) M.wins++; } else { M.never++; if (w.p === q) M.neverWins++; }
    if (at10[q]) {
      const k = String(at10[q].d), b = String(at10[q].blots);
      (out.pinsAt10[k] ||= [0, 0])[0]++; if (w.p === q) out.pinsAt10[k][1]++;
      (out.blotsAt10[b] ||= [0, 0])[0]++; if (w.p === q) out.blotsAt10[b][1]++;
    }
  }
}
out.avgTurns = +(out.turns / N).toFixed(1);
const pc = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
const summary = {
  games: N, level: LV, avgTurns: out.avgTurns,
  ends: Object.fromEntries(Object.entries(out.ends).map(([k, v]) => [k, pc(v, N)])),
  starterWins: pc(out.starterWins, out.decided),
  firstPinnerWins: pc(out.firstPin.pinnerWins, out.firstPin.games),
  pinWinByPipsLeft: Object.fromEntries(Object.entries(out.pinBuckets).map(([k, [n, w]]) => [k, { pins: n, pinnerWins: pc(w, n) }])),
  loneMother: { exposedTurns: out.motherAlone.exposed, pinnedNextRoll: pc(out.motherAlone.pinnedNext, out.motherAlone.exposed), motherGamesAfterExposure: out.motherAlone.lostGame },
  motherExposed: { sides: out.motherExposedSides.sides, share: pc(out.motherExposedSides.sides, 2 * out.decided), win: pc(out.motherExposedSides.wins, out.motherExposedSides.sides), winNever: pc(out.motherExposedSides.neverWins, out.motherExposedSides.never) },
  pinBalanceAt10: Object.fromEntries(Object.entries(out.pinsAt10).sort((a, b) => +a[0] - +b[0]).map(([k, [n, w]]) => [k, { n, win: pc(w, n) }])),
  loneCheckersAt10: Object.fromEntries(Object.entries(out.blotsAt10).sort((a, b) => +a[0] - +b[0]).map(([k, [n, w]]) => [k, { n, win: pc(w, n) }])),
};
console.log(JSON.stringify(summary, null, 1));

// Independent legality audit of src/engine.js: node test/legality.mjs [games=60] [synthetic=1500]
//
// A from-scratch Plakoto rules implementation on the ABSOLUTE board (no engine code, no shared
// numbering): 24 cells, each a bottom-to-top list of 'W' / 'B'. White moves from cell 23 down to
// cell 0 and off; black from cell 0 up to cell 23 and off. For every test position x all 21 rolls
// it brute-forces every legal full play and compares the set of resulting boards with
//   1. engine.finalPositions (what the computer chooses from),
//   2. every board reachable by clicking through turnSteps / turnPlay (what the player can do),
//      checking each offered step's squares, no dead ends and T.M,
//   3. the computer's chosen plays (levels 4 and 5 on a sample),
// and compares engine.winner with its own reading of the game result after every play.
// FAILS are printed with the position; exit code 1 on any failure.
// PLAKOTO_ENGINE=<path> audits another engine copy (used to prove the audit catches rule mutants).
import { pathToFileURL } from 'node:url';
const E = await import(process.env.PLAKOTO_ENGINE ? pathToFileURL(process.env.PLAKOTO_ENGINE).href : '../src/engine.js');

const GAMES = +(process.argv[2] || 60), SYNTH = +(process.argv[3] || 1500);

// ------------------------------------------------------------------ reference implementation
const other = (c) => (c === 'W' ? 'B' : 'W');
const dirOf = (c) => (c === 'W' ? -1 : 1);
const homeOf = (c) => (c === 'W' ? [0, 5] : [18, 23]);
const startOf = (c) => (c === 'W' ? 23 : 0);
const top = (cell) => cell[cell.length - 1];

function refLegalStep(B, c, a, d) {
  // returns the target cell (-1 = off) or null
  const cell = B.cells[a];
  if (!cell.length || top(cell) !== c) return null;
  const b = a + dirOf(c) * d;
  if (b >= 0 && b <= 23) {
    const t = B.cells[b];
    if (t.length === 0 || top(t) === c || t.length === 1) return b;
    return null;
  }
  // bearing off: every checker of mine (pinned ones too) inside the home board
  const [h0, h1] = homeOf(c);
  for (let k = 0; k < 24; k++) if ((k < h0 || k > h1) && B.cells[k].includes(c)) return null;
  const dist = c === 'W' ? a + 1 : 24 - a;
  if (d === dist) return -1;
  // a higher die: only when no checker of mine stands farther from home inside the home board
  if (c === 'W') { for (let k = a + 1; k <= 5; k++) if (B.cells[k].includes(c)) return null; }
  else { for (let k = 18; k < a; k++) if (B.cells[k].includes(c)) return null; }
  return -1;
}
function refApply(B, c, a, b) {
  const N = { cells: B.cells.map((x) => x.slice()), off: { ...B.off } };
  N.cells[a].pop();
  if (b === -1) N.off[c]++; else N.cells[b].push(c);
  return N;
}
const refKey = (B) => B.cells.map((cell) => {
  if (!cell.length) return '';
  const t = top(cell);
  if (cell[0] !== t) {
    if (cell.slice(1).some((x) => x !== t) || cell.length < 2) throw new Error('reference: impossible cell ' + cell.join(''));
    return cell[0].toLowerCase() + t + (cell.length - 1);
  }
  if (cell.some((x) => x !== t)) throw new Error('reference: impossible cell ' + cell.join(''));
  return t + cell.length;
}).join('.') + '|' + B.off.W + ',' + B.off.B;

// every legal full play: Map(finalKey -> { steps: [[a, b, d]], board })
function refPlays(B, c, dice) {
  const rem0 = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice();
  const finals = new Map();
  let maxLen = 0;
  const seen = new Set();
  const go = (S, rem, steps) => {
    const k = refKey(S) + '#' + rem.slice().sort().join('');
    if (seen.has(k + '#' + steps.length)) return;
    seen.add(k + '#' + steps.length);
    let any = false;
    for (let i = 0; i < rem.length; i++) {
      if (rem.indexOf(rem[i]) !== i) continue;
      for (let a = 0; a < 24; a++) {
        const b = refLegalStep(S, c, a, rem[i]);
        if (b === null) continue;
        any = true;
        go(refApply(S, c, a, b), rem.slice(0, i).concat(rem.slice(i + 1)), steps.concat([[a, b, rem[i]]]));
      }
    }
    if (!any) {
      if (steps.length > maxLen) maxLen = steps.length;
      const fk = refKey(S);
      if (!finals.has(fk) || finals.get(fk).steps.length < steps.length) finals.set(fk, { steps, board: S });
    }
  };
  go(B, rem0, []);
  let out = [...finals.entries()].filter(([, v]) => v.steps.length === maxLen);
  if (maxLen === 1 && dice[0] !== dice[1]) {
    const hi = Math.max(...dice);
    // keep plays using the larger die; a final reachable both ways counts as "uses the larger" if any way does
    const viaHi = new Set();
    for (let a = 0; a < 24; a++) { const b = refLegalStep(B, c, a, hi); if (b !== null) viaHi.add(refKey(refApply(B, c, a, b))); }
    if (viaHi.size) out = out.filter(([k]) => viaHi.has(k));
  }
  return { maxLen, finals: new Map(out) };
}

// the game result the reference reads off a board after a whole play
function refResult(B) {
  if (B.off.W === 15) return { w: 'W', pts: B.off.B ? 1 : 2 };
  if (B.off.B === 15) return { w: 'B', pts: B.off.W ? 1 : 2 };
  const wStart = B.cells[23], bStart = B.cells[0];
  const wMother = wStart.length >= 2 && wStart[0] === 'W' && wStart[1] === 'B';
  const bMother = bStart.length >= 2 && bStart[0] === 'B' && bStart[1] === 'W';
  const wHas = wStart.filter((x) => x === 'W').length, bHas = bStart.filter((x) => x === 'B').length;
  if (wMother && bMother) return { w: 'tie', pts: 0 };
  if (bMother && wHas === 0) return { w: 'W', pts: 2 };
  if (wMother && bHas === 0) return { w: 'B', pts: 2 };
  return null;
}

// ------------------------------------------------------------------ engine <-> reference
function toRef(g) {
  const cells = Array.from({ length: 24 }, () => []);
  for (let a = 0; a < 24; a++) {
    const rw = a + 1, rb = 24 - a;
    const wc = g.pos[0][rw], bc = g.pos[1][rb];
    if (wc && bc) {
      if (g.pin[0][rw]) { cells[a].push('W'); for (let i = 0; i < bc; i++) cells[a].push('B'); }
      else if (g.pin[1][rb]) { cells[a].push('B'); for (let i = 0; i < wc; i++) cells[a].push('W'); }
      else throw new Error('engine position: both colours on cell ' + a + ' without a pin');
    } else {
      for (let i = 0; i < wc; i++) cells[a].push('W');
      for (let i = 0; i < bc; i++) cells[a].push('B');
    }
  }
  return { cells, off: { W: g.off[0], B: g.off[1] } };
}
function leafGame(g, p, f) {
  const n = E.cloneGame(g);
  n.pos[p] = Int8Array.from(f.mine); n.pin[p] = Int8Array.from(f.mp); n.pin[1 - p] = Int8Array.from(f.op); n.off[p] = f.myOff;
  return n;
}

// ------------------------------------------------------------------ the audit
let fails = 0, comparisons = 0, clicks = 0, chosen = 0, results = 0, replays = 0;
const stats = { pinPlays: 0, blockedSteps: 0, bearOffWithPinHome: 0, noMove: 0, oneDie: 0, largerDieBound: 0, mother: 0, tie: 0 };
const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push([a, b]);
const fail = (msg, g, p, d) => {
  fails++;
  if (fails <= 12) console.log(`FAIL: ${msg}\n  side ${p} dice ${d}\n  ${refKey(toRef(g))}`);
};

function audit(g, p, sample) {
  const B = toRef(g), c = p === 0 ? 'W' : 'B';
  // the engine's result reading must match the reference on this position
  const er = E.winner(g), rr = refResult(B);
  results++;
  const erTxt = er ? (er.p === -1 ? 'tie/0' : `${er.p === 0 ? 'W' : 'B'}/${er.points}`) : 'none';
  const rrTxt = rr ? `${rr.w}/${rr.pts}` : 'none';
  if (erTxt !== rrTxt) fail(`winner ${erTxt} vs reference ${rrTxt}`, g, p, '-');
  if (er) { if (er.how === 'mother') stats.mother++; if (er.how === 'tie') stats.tie++; return; }
  for (const d of ROLLS) {
    comparisons++;
    const ref = refPlays(B, c, d);
    const refSet = new Set(ref.finals.keys());
    // 1. enumeration
    const v = E.viewOf(g, p);
    const fin = E.finalPositions(v, E.expandDice(d));
    // (no legal play: the engine lists nothing, the reference lists the unchanged board)
    const engSet = fin.length ? new Set(fin.map((f) => refKey(toRef(leafGame(g, p, f))))) : new Set([refKey(B)]);
    if (engSet.size !== refSet.size || [...engSet].some((k) => !refSet.has(k))) {
      fail(`finalPositions differ: engine ${engSet.size}, reference ${refSet.size}; engine-only ${[...engSet].filter((k) => !refSet.has(k)).slice(0, 1)} reference-only ${[...refSet].filter((k) => !engSet.has(k)).slice(0, 1)}`, g, p, d);
      continue;
    }
    if (!fin.length) stats.noMove++;
    // every enumerated play's step list (what the computer, Hint and Mr. Makis play) must replay
    // through the interactive turn to the same board - a smaller-die step list once froze a game
    for (const f of fin) {
      replays++;
      try {
        const T = E.createTurn(g, p, d);
        for (const s of f.steps) E.turnPlay(T, { r: s.r, d: s.d });
        const n = E.cloneGame(g); E.commitTurn(n, T);
        if (!E.turnDone(T) || refKey(toRef(n)) !== refKey(toRef(leafGame(g, p, f)))) fail('an enumerated play replays to a different board', g, p, d);
      } catch (e) { fail(`an enumerated play cannot be replayed through the turn: ${e.message}`, g, p, d); }
    }
    if (ref.maxLen === 1) stats.oneDie++;
    // 2. clicking: every node of the interactive turn
    const T0 = E.createTurn(g, p, d);
    if (T0.M !== ref.maxLen) { fail(`T.M ${T0.M} vs reference ${ref.maxLen}`, g, p, d); continue; }
    const clickSet = new Set(), visited = new Set();
    const walk = (T) => {
      const cur = E.cloneGame(g); E.commitTurn(cur, T);
      const curB = toRef(cur);
      if (E.turnDone(T)) { clickSet.add(refKey(curB)); return; }
      const vk = refKey(curB) + '#' + T.rem.slice().sort().join('');
      if (visited.has(vk)) return; // the same board with the same dice left was already walked
      visited.add(vk);
      const steps = E.turnSteps(T);
      if (!steps.length) { fail('dead end: turn not done and no step offered', g, p, d); return; }
      for (const s of steps) {
        clicks++;
        const a = E.absOf(p, s.r), b = s.t ? E.absOf(p, s.t) : -1;
        if (s.from !== a || s.to !== b) fail(`step squares ${s.from}->${s.to} vs ${a}->${b}`, g, p, d);
        const rb = refLegalStep(curB, c, a, s.d);
        if (rb === null || rb !== b) { fail(`offered step ${a}->${b} with ${s.d} is not legal (reference: ${rb})`, cur, p, d); continue; }
        if (s.pin) stats.pinPlays++;
        const T2 = { ...T, v: { ...T.v, mine: Int8Array.from(T.v.mine), mp: Int8Array.from(T.v.mp), op: Int8Array.from(T.v.op) }, rem: T.rem.slice(), played: T.played.slice() };
        E.turnPlay(T2, s);
        walk(T2);
      }
      // squares refused here that the reference allows as single steps are only fine if they cannot lead to a maximal play
      for (let k = 0; k < T.rem.length; k++) for (let a = 0; a < 24; a++) {
        if (refLegalStep(curB, c, a, T.rem[k]) !== null && !steps.some((s) => s.from === a && s.d === T.rem[k])) stats.blockedSteps++;
      }
    };
    walk(T0);
    if (clickSet.size !== refSet.size || [...clickSet].some((k) => !refSet.has(k))) fail(`clickable plays differ: ${clickSet.size} vs reference ${refSet.size}`, g, p, d);
    if (d[0] !== d[1] && ref.maxLen === 1) {
      const lo = refPlays(B, c, d);
      if ([...lo.finals.values()].some((x) => x.steps[0][2] !== Math.max(...d))) stats.largerDieBound++;
    }
    // bear-off positions with a pinned checker of mine at home
    if (B.cells.some((cell, a) => cell[0] === c && cell.length > 1 && a >= homeOf(c)[0] && a <= homeOf(c)[1])) stats.bearOffWithPinHome++;
    // 3. the computer's choice
    if (sample && refSet.size > 1) {
      for (const lv of [4, 5]) {
        const steps = E.chooseMove(g, p, d, lv, Math.random);
        const n = E.applySteps(E.cloneGame(g), p, steps);
        chosen++;
        if (!refSet.has(refKey(toRef(n)))) fail(`level ${lv} chose an illegal play`, g, p, d);
      }
    }
  }
}

// hand-worked positions: game({wPoint: n}, {bPoint: n}, {pinW, pinB, offW, offB}), engine numbering
function game(white, black, o = {}) {
  const g = { pos: [new Int8Array(25), new Int8Array(25)], pin: [new Int8Array(25), new Int8Array(25)], off: [o.offW || 0, o.offB || 0] };
  for (const [r, n] of Object.entries(white)) g.pos[0][r] = n;
  for (const [r, n] of Object.entries(black)) g.pos[1][r] = n;
  for (const r of o.pinW || []) g.pin[0][r] = 1;
  for (const r of o.pinB || []) g.pin[1][r] = 1;
  return g;
}
const HAND = [
  game({ 24: 15 }, { 24: 14, 7: 1 }),                                           // a blot to pin on the way out
  game({ 24: 13, 18: 1, 12: 1 }, { 24: 13, 7: 1, 14: 1 }, { pinB: [7] }),       // white pins black 7
  game({ 24: 14, 18: 1 }, { 24: 14, 7: 1 }, { pinW: [18] }),                   // black's anchor on white 18
  game({ 24: 15 }, { 24: 11, 7: 2, 6: 2 }),                                      // both points between closed
  game({ 13: 1 }, { 24: 13, 23: 2 }, { offW: 14 }),                             // larger die
  game({ 5: 1, 2: 14 }, { 24: 14, 20: 1 }, { pinW: [5] }),                      // pinned at home while bearing off
  game({ 10: 1, 3: 14 }, { 24: 14, 15: 1 }, { pinW: [10] }),                    // pinned outside home: no bear-off
  game({ 24: 1, 10: 14 }, { 3: 1, 5: 14 }),                                      // black can pin white's mother (black's start empty)
  game({ 24: 1, 10: 14 }, { 24: 2, 3: 1, 5: 12 }),                              // the same with the waiver
  game({ 24: 1, 3: 1, 5: 13 }, { 24: 1, 1: 1, 10: 13 }, { pinW: [24] }),        // white can pin black's mother: tie
  game({ 24: 1, 10: 14 }, { 1: 1, 24: 1, 5: 13 }, { pinW: [24] }),              // white mother pinned, waiver, black to empty its start
  game({ 6: 3, 5: 3, 4: 3, 3: 3, 2: 3 }, { 24: 1, 18: 14 }),                    // bearing off beside black's lone mother on white's 1
  game({ 4: 1, 2: 1, 1: 13 }, { 21: 1, 1: 14 }, { pinB: [21], offW: 0 }),       // white pins black at home while bearing off
  game({ 1: 1 }, { 23: 15 }, { offW: 14 }),                                      // last checker: either die bears it off, only the larger may
  game({ 2: 1 }, { 22: 14 }, { offW: 14, offB: 1 }),                             // the same from point 2
];
// fix the counts of the hand positions that are not 15 by design: pad with checkers on far points
for (const g of HAND) for (let p = 0; p < 2; p++) {
  let n = g.off[p]; for (let r = 1; r <= 24; r++) n += g.pos[p][r];
  if (n !== 15) throw new Error(`hand position count ${n}`);
}

const t0 = Date.now();
for (const g of HAND) { audit(g, 0, true); audit(g, 1, true); }

// self-play positions (mixed levels, so blunders and pins both happen)
const rnd = E.mulberry(2026);
let positions = 0;
for (let gi = 0; gi < GAMES; gi++) {
  const g = E.newGame();
  let p = gi % 2;
  const lv = [1, 2, 3, 4][gi % 4];
  for (let n = 0; n < 400 && !E.winner(g); n++) {
    if (n % 3 === 0) { audit(g, p, n % 9 === 0); positions++; }
    E.applySteps(g, p, E.chooseMove(g, p, E.rollDice(rnd), lv, rnd));
    p = 1 - p;
  }
  audit(g, p, false); positions++; // the final position: result reading
}

// synthetic random positions with pins, blots and borne-off checkers
function synthetic() {
  for (let tries = 0; tries < 100; tries++) {
    const g = { pos: [new Int8Array(25), new Int8Array(25)], pin: [new Int8Array(25), new Int8Array(25)], off: [0, 0] };
    const cells = Array.from({ length: 24 }, () => []);
    let okb = true;
    for (const c of ['W', 'B']) {
      const off = rnd() < 0.3 ? Math.floor(rnd() * 14) : 0;
      g.off[c === 'W' ? 0 : 1] = off;
      const homeOnly = rnd() < 0.3;
      for (let k = 0; k < 15 - off; k++) {
        const [h0, h1] = homeOf(c);
        let a = homeOnly ? h0 + Math.floor(rnd() * 6) : Math.floor(rnd() * 24);
        if (rnd() < 0.15) a = startOf(c);
        cells[a].push(c);
      }
    }
    // a cell with both colours is legal only as one checker pinned under the other colour
    for (const cell of cells) {
      const w = cell.filter((x) => x === 'W').length, b = cell.length - w;
      if (w && b) {
        if (w === 1 && rnd() < 0.5) { cell.length = 0; cell.push('W'); for (let i = 0; i < b; i++) cell.push('B'); }
        else if (b === 1) { cell.length = 0; cell.push('B'); for (let i = 0; i < w; i++) cell.push('W'); }
        else if (w === 1) { cell.length = 0; cell.push('W'); for (let i = 0; i < b; i++) cell.push('B'); }
        else { okb = false; break; }
      }
    }
    if (!okb) continue;
    for (let a = 0; a < 24; a++) {
      const cell = cells[a], rw = a + 1, rb = 24 - a;
      for (const x of cell) g.pos[x === 'W' ? 0 : 1][x === 'W' ? rw : rb]++;
      if (cell.length > 1 && cell[0] !== top(cell)) g.pin[cell[0] === 'W' ? 0 : 1][cell[0] === 'W' ? rw : rb] = 1;
    }
    return g;
  }
  return E.newGame();
}
for (let i = 0; i < SYNTH; i++) { const g = synthetic(); audit(g, i % 2, i % 25 === 0); positions++; }

console.log(`${HAND.length} hand positions, ${positions} game/synthetic positions; ${comparisons} position x roll comparisons, ${clicks} clickable steps checked, ${replays} enumerated plays replayed, ${chosen} computer choices, ${results} result readings`);
console.log(`rules exercised: ${JSON.stringify(stats)}`);
console.log(`${fails ? fails + ' FAILURES' : '0 failures'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);

// Rule tests for src/engine.js: node test/rules.mjs
// Positions are written in the engine's numbering: each side counts its own path 24 (start) -> 1,
// and my point r is the opponent's point S(r) = 25 - r.
import {
  newGame, createTurn, turnSteps, turnPlay, turnDone, commitTurn, finalPositions, viewOf,
  expandDice, evaluate, S, absOf, chooseMove, winner, cloneGame, applySteps, gamePlain, gameFrom,
} from '../src/engine.js';

let fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) passes++;
  else { fails++; console.log('FAIL:', msg); }
}
const fmt = (steps) => steps.map((s) => `${s.r}>${s.t}/${s.d}`).sort().join(' ');

// game({ point: count }, { point: count }, { offW, offB, pinW: [points], pinB: [points] })
function game(white, black, o = {}) {
  const g = { pos: [new Int8Array(25), new Int8Array(25)], pin: [new Int8Array(25), new Int8Array(25)], off: [o.offW || 0, o.offB || 0] };
  for (const [r, n] of Object.entries(white)) g.pos[0][r] = n;
  for (const [r, n] of Object.entries(black)) g.pos[1][r] = n;
  for (const r of o.pinW || []) g.pin[0][r] = 1;
  for (const r of o.pinB || []) g.pin[1][r] = 1;
  const tw = g.pos[0].reduce((a, b) => a + b, 0) + g.off[0], tb = g.pos[1].reduce((a, b) => a + b, 0) + g.off[1];
  if (tw !== 15 || tb !== 15) throw new Error(`bad fixture ${tw}/${tb}`);
  for (let p = 0; p < 2; p++) for (let r = 1; r <= 24; r++) {
    if (g.pin[p][r] && (g.pos[p][r] !== 1 || !g.pos[1 - p][S(r)])) throw new Error(`bad pin fixture ${p}:${r}`);
    if (g.pos[p][r] && g.pos[1 - p][S(r)] && !g.pin[p][r] && !g.pin[1 - p][S(r)]) throw new Error(`mixed point without a pin ${p}:${r}`);
  }
  return g;
}
// plays a list of [r, d] steps for side p through the interactive API and commits it
function play(g, p, dice, steps) {
  const T = createTurn(g, p, dice);
  for (const [r, d] of steps) turnPlay(T, { r, d });
  if (!turnDone(T)) throw new Error('turn not finished');
  commitTurn(g, T);
  return T;
}

// coordinate maps: opposite directions
ok(S(S(7)) === 7 && S(24) === 1 && S(1) === 24 && S(13) === 12, 'S(r) = 25 - r is an involution');
ok(absOf(0, 24) === 23 && absOf(1, 1) === 23 && absOf(1, 24) === 0 && absOf(0, 1) === 0, 'white starts on black\'s last point and vice versa');

// 1. Opening: any checker from the start, both dice; one checker may run both.
{
  const T = createTurn(newGame(), 0, [6, 5]);
  ok(T.M === 2, 'opening 6-5 plays both dice');
  ok(fmt(turnSteps(T)) === '24>18/6 24>19/5', `opening first steps: ${fmt(turnSteps(T))}`);
  const f = finalPositions(viewOf(newGame(), 0), expandDice([6, 5]));
  ok(f.length === 2, `opening 6-5: two results (one runner 24>13 or two checkers) - got ${f.length}`);
  ok(createTurn(newGame(), 1, [3, 3]).M === 4, 'doubles play four times');
}

// 2. Pinning: landing on a lone opponent checker pins it; the pinned checker cannot move.
{
  const g = game({ 24: 15 }, { 24: 14, [S(18)]: 1 }); // black's lone checker on white's 18 (black 7)
  const T = createTurn(g, 0, [6, 1]);
  const s6 = turnSteps(T).find((s) => s.r === 24 && s.d === 6);
  ok(s6 && s6.t === 18 && s6.pin, 'white lands on the lone black checker and pins it');
  turnPlay(T, { r: 24, d: 6 }); turnPlay(T, { r: 24, d: 1 });
  commitTurn(g, T);
  ok(g.pin[1][7] === 1 && g.pos[1][7] === 1 && g.pos[0][18] === 1, 'black 7 is pinned under white 18');
  const B = createTurn(g, 1, [2, 1]);
  ok(!turnSteps(B).some((s) => s.r === 7), 'the pinned checker has no move');
}

// 3. Two or more opponent checkers close a point; a lone pinner closes it too (an "anchor").
{
  const g = game({ 24: 15 }, { 24: 13, [S(18)]: 2 });
  ok(!turnSteps(createTurn(g, 0, [6, 5])).some((s) => s.t === 18), 'two black checkers close white\'s 18');
  // white's checker on 18 is pinned under one black checker: 18 stays closed to white
  const h = game({ 24: 14, 18: 1 }, { 24: 14, [S(18)]: 1 }, { pinW: [18] });
  const T = createTurn(h, 0, [6, 5]);
  ok(!turnSteps(T).some((s) => s.t === 18), 'a single pinning checker closes the point');
  ok(!turnSteps(T).some((s) => s.r === 18), 'white\'s pinned checker cannot move');
  // and black, on top, may bring more checkers there
  const B = createTurn(h, 1, [6, 5]);
  ok(B.v.mine[7] === 1 && createTurn(game({ 24: 14, 18: 1 }, { 24: 13, 13: 1, [S(18)]: 1 }, { pinW: [18] }), 1, [6, 5]).M === 2
    && turnSteps(createTurn(game({ 24: 14, 18: 1 }, { 24: 13, 13: 1, [S(18)]: 1 }, { pinW: [18] }), 1, [6, 5])).some((s) => s.r === 13 && s.t === 7), 'the pinner\'s side may join its point');
}

// 4. A point where I pin is mine: more of my checkers may join it; it stays pinned while one remains.
{
  const g = game({ 24: 14, 18: 1 }, { 24: 14, [S(18)]: 1 }, { pinB: [S(18)] });
  const T = createTurn(g, 0, [6, 6]);
  ok(turnSteps(T).some((s) => s.r === 24 && s.t === 18 && !s.pin), 'white joins its own pinning point');
  turnPlay(T, { r: 24, d: 6 });
  turnPlay(T, { r: 18, d: 6 }); // one of the two leaves: still pinned
  ok(T.v.op[S(18)] === 1, 'black stays pinned while a white checker remains on top');
  const st = turnSteps(T).find((s) => s.r === 18 && s.d === 6);
  ok(st && st.free, 'the last white checker leaving frees black');
  turnPlay(T, { r: 18, d: 6 });
  ok(T.v.op[S(18)] === 0, 'black is free again');
  turnPlay(T, { r: 24, d: 6 }); // white lands on 18 again: the freed black checker is pinned again
  ok(T.v.op[S(18)] === 1, 'landing on the freed checker pins it again');
}

// 5. One checker playing both dice stops on the point between: it pins there and frees it by
//    moving on; a closed point between blocks the combined move.
{
  const g = game({ 24: 15 }, { 24: 14, [S(18)]: 1 });
  const T = createTurn(g, 0, [6, 5]);
  turnPlay(T, { r: 24, d: 6 });
  ok(T.v.op[S(18)] === 1, 'touch-down pins');
  turnPlay(T, { r: 18, d: 5 });
  ok(T.v.op[S(18)] === 0 && T.v.mine[13] === 1, 'moving on frees the checker again');
  const shut = game({ 24: 15 }, { 24: 11, [S(18)]: 2, [S(19)]: 2 });
  ok(createTurn(shut, 0, [6, 5]).M === 0, 'both points between closed: no move at all');
  ok(finalPositions(viewOf(shut, 0), [6, 5]).length === 0, 'enumeration agrees: no legal play');
}

// 6. Only one die playable: it must be the larger. Here 13>7 and 13>8 are each legal, but no
//    play uses both (7>2 and 8>2 are closed, and nothing is home yet).
{
  const g = game({ 13: 1 }, { 24: 13, [S(2)]: 2 }, { offW: 14 });
  const T = createTurn(g, 0, [6, 5]);
  ok(T.M === 1, 'only one die can be played');
  ok(fmt(turnSteps(T)) === '13>7/6', `must be the larger die: ${fmt(turnSteps(T))}`);
  const f = finalPositions(viewOf(g, 0), [6, 5]);
  ok(f.length === 1 && f[0].steps[0].d === 6, 'enumeration agrees on the larger die');
  // ...but if only the smaller can be played, it is played
  const h = game({ 13: 1 }, { 24: 11, [S(2)]: 2, [S(7)]: 2 }, { offW: 14 });
  ok(fmt(turnSteps(createTurn(h, 0, [6, 5]))) === '13>8/5', 'the smaller die when the larger cannot move');
  // the last checker, either die bears it off: the computer's play must be the larger die's, so the
  // interactive turn can replay it (a 3 here froze a browser game - and Fevga's engine has the same flaw)
  const last = game({ 1: 1 }, { 23: 15 }, { offW: 14 });
  for (const lv of [1, 4, 5]) {
    const steps = chooseMove(last, 0, [3, 5], lv);
    let replayed = true;
    try { const L = createTurn(last, 0, [3, 5]); for (const s of steps) turnPlay(L, s); replayed = turnDone(L); } catch { replayed = false; }
    ok(steps.length === 1 && steps[0].d === 5 && replayed, `level ${lv}: last checker borne off with the larger die and replayable (${JSON.stringify(steps)})`);
  }
}

// 7. Bearing off: not before all 15 are home; exact; a higher die from the highest point only.
{
  const notHome = game({ 7: 1, 6: 14 }, { 24: 15 });
  ok(!turnSteps(createTurn(notHome, 0, [6, 5])).some((s) => s.t === 0), 'no bearing off with a checker on 7');
  const g = game({ 3: 2, 1: 13 }, { 12: 15 }); // (black away from white's 1 and 3)
  ok(fmt(turnSteps(createTurn(g, 0, [6, 5]))) === '3>0/5 3>0/6', `higher die only from the highest point: ${fmt(turnSteps(createTurn(g, 0, [6, 5])))}`);
  const ex = game({ 6: 15 }, { 24: 15 });
  ok(createTurn(ex, 0, [6, 6]).M === 4 && turnSteps(createTurn(ex, 0, [6, 6])).every((s) => s.t === 0), 'double 6 bears off four from 6');
  const mixed = game({ 6: 1, 2: 14 }, { 24: 15 });
  ok(!turnSteps(createTurn(mixed, 0, [5, 1])).some((s) => s.r === 2 && s.d === 5 && s.t === 0), 'a 5 cannot bear off from 2 while 6 is occupied');
}

// 8. Bearing off with pinned checkers: one pinned outside the home board stops it; one pinned
//    inside counts as home but cannot move, and it occupies its point for the higher-die rule.
{
  const out = game({ 10: 1, 3: 14 }, { 24: 14, [S(10)]: 1 }, { pinW: [10] });
  ok(!turnSteps(createTurn(out, 0, [3, 3])).some((s) => s.t === 0), 'a checker pinned on 10 stops bearing off');
  const inside = game({ 5: 1, 2: 14 }, { 24: 14, [S(5)]: 1 }, { pinW: [5] });
  const T = createTurn(inside, 0, [2, 1]);
  ok(turnSteps(T).some((s) => s.r === 2 && s.d === 2 && s.t === 0), 'with the pinned checker inside, others bear off');
  ok(!turnSteps(T).some((s) => s.r === 5), 'the pinned home checker cannot move');
  ok(createTurn(inside, 0, [6, 6]).M === 0, 'a 6 cannot bear off from 2 while a pinned checker stands on 5');
}

// 9. The mother. White's last checker on its start (white 24 = black 1) pinned by black.
{
  // a) black has nothing left on its own start: black wins double at once
  const a = game({ 24: 1, 10: 14 }, { 3: 1, 5: 14 });
  play(a, 1, [2, 1], [[3, 2], [5, 1]]);
  const w = winner(a);
  ok(w && w.p === 1 && w.points === 2 && w.how === 'mother', `mother pinned with the pinner's start empty: double (${JSON.stringify(w)})`);
  // b) black still has checkers on its start: the rule is waived and play goes on...
  const b = game({ 24: 1, 10: 14 }, { 24: 2, 3: 1, 5: 12 });
  play(b, 1, [2, 1], [[3, 2], [5, 1]]);
  ok(b.pin[0][24] === 1 && winner(b) === null, 'waived while the pinner still has checkers on his start');
  // ...until black empties its start with the mother still pinned: black wins double then
  play(b, 0, [1, 1], [[10, 1], [10, 1], [10, 1], [10, 1]]);
  ok(winner(b) === null, 'white moves, still no result');
  play(b, 1, [6, 6], [[24, 6], [24, 6], [18, 6], [18, 6]]);
  const wb = winner(b);
  ok(wb && wb.p === 1 && wb.how === 'mother' && wb.points === 2, 'black empties its start: mother rule applies, black wins double');
  // c) both mothers pinned: a tie
  const c = game({ 24: 1, 3: 1, 5: 13 }, { 24: 1, 1: 1, 10: 13 }, { pinW: [24] });
  ok(winner(c) === null, 'white mother pinned but black still has its mother on its start: game on');
  play(c, 0, [2, 1], [[3, 2], [5, 1]]);
  const wc = winner(c);
  ok(wc && wc.p === -1 && wc.tie && wc.points === 0, `both mothers pinned: a tie (${JSON.stringify(wc)})`);
  // d) judged at the end of the move: pinning the mother and moving on is no result
  const d = game({ 24: 1, 10: 14 }, { 3: 1, 2: 14 });
  play(d, 1, [2, 1], [[3, 2], [1, 1]]);
  ok(d.pin[0][24] === 0 && winner(d) === null, 'a mother pinned with the first die and freed with the second: no result');
  // e) two checkers on the start are a block, not a mother
  const e = game({ 24: 2, 10: 13 }, { 3: 1, 5: 14 });
  ok(!turnSteps(createTurn(e, 1, [2, 1])).some((s) => s.r === 3 && s.d === 2), 'two checkers on the start cannot be pinned');
}

// 10. Results: single win, mars.
{
  const g = game({ 1: 1 }, { 23: 15 }, { offW: 14 }); // (black's 24 would be white's 1)
  play(g, 0, [1, 2], [[1, 2]]);
  ok(JSON.stringify(winner(g)) === JSON.stringify({ p: 0, points: 2, how: 'off' }), 'mars: the loser bore nothing off');
  const h = game({ 1: 1 }, { 23: 14 }, { offW: 14, offB: 1 });
  play(h, 0, [1, 2], [[1, 2]]);
  ok(winner(h).points === 1, 'single win when the loser has borne off');
}

// 11. No legal move at all.
{
  const g = game({ 24: 15 }, { [S(23)]: 2, [S(22)]: 2, [S(21)]: 2, [S(20)]: 2, [S(19)]: 2, [S(18)]: 2, 24: 3 });
  const T = createTurn(g, 0, [3, 4]);
  ok(T.M === 0 && turnDone(T) && turnSteps(T).length === 0, 'fully blocked: nothing to play');
}

// 12. Evaluation is antisymmetric (two-ply search depends on it), pins included.
{
  const g = game({ 24: 6, 20: 2, 15: 3, 9: 1, 4: 2, 3: 1 }, { 24: 5, 19: 3, [S(9)]: 1, 11: 3, 4: 2, 2: 1 }, { pinB: [S(9)] });
  const a = evaluate(viewOf(g, 0)), b = evaluate(viewOf(g, 1));
  ok(Math.abs(a + b) < 1e-9, `evaluate antisymmetric (${a} vs ${b})`);
}

// 13. Random playouts never break invariants, and the interactive turn agrees with the enumeration.
{
  let rs = 12345;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  let games = 0, mismatch = 0;
  const outcomes = { off: 0, mother: 0, tie: 0 };
  for (let n = 0; n < 60; n++) {
    const g = newGame();
    let p = n % 2, turns = 0;
    while (!winner(g) && turns < 2000) {
      const dice = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
      const finals = finalPositions(viewOf(g, p), expandDice(dice));
      const T = createTurn(g, p, dice);
      const len = finals.length ? finals[0].steps.length : 0;
      if (len !== T.M) mismatch++;
      while (!turnDone(T)) {
        const st = turnSteps(T);
        if (!st.length) { mismatch++; break; }
        turnPlay(T, st[Math.floor(rnd() * st.length)]);
      }
      commitTurn(g, T);
      for (let q = 0; q < 2; q++) {
        let tot = g.off[q];
        for (let r = 1; r <= 24; r++) {
          if (g.pos[q][r] < 0) mismatch++;
          tot += g.pos[q][r];
          if (g.pin[q][r] && (g.pos[q][r] !== 1 || !g.pos[1 - q][S(r)])) mismatch++;
          if (g.pos[q][r] && g.pos[1 - q][S(r)] && !g.pin[q][r] && !g.pin[1 - q][S(r)]) mismatch++;
        }
        if (tot !== 15) mismatch++;
      }
      p = 1 - p; turns++;
    }
    const w = winner(g);
    if (w) { games++; outcomes[w.how]++; }
  }
  ok(mismatch === 0, `random playouts consistent (mismatches: ${mismatch})`);
  ok(games === 60, `random games all finish (${games}/60: ${JSON.stringify(outcomes)})`);
}

// 14. A recorded game (dice + steps per turn) replays to the identical final position, pins
//     included, also through JSON (that is how saved games are stored) and the worker's plain arrays.
{
  let rs = 777;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const g = newGame(); const turns = []; let p = 0, n = 0, pinsSeen = 0;
  while (!winner(g) && n++ < 2000) {
    const dice = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    const steps = chooseMove(g, p, dice, 3, rnd);
    turns.push({ p, dice, steps: steps.map(({ r, t, d }) => ({ r, t, d })) });
    applySteps(g, p, steps);
    pinsSeen += g.pin[0].reduce((a, b) => a + b, 0) + g.pin[1].reduce((a, b) => a + b, 0);
    p = 1 - p;
  }
  const rec = JSON.parse(JSON.stringify({ turns }));
  const r = newGame();
  for (const t of rec.turns) applySteps(r, t.p, t.steps);
  const same = (x, y) => JSON.stringify(gamePlain(x)) === JSON.stringify(gamePlain(y));
  ok(same(r, g) && !!winner(r), `recorded game replays to the same final position (${rec.turns.length} turns, pins seen ${pinsSeen})`);
  ok(same(gameFrom(JSON.parse(JSON.stringify(gamePlain(g)))), g), 'plain-array round trip keeps the pins');
}

// 15. .vbg files: export -> import round-trips; damaged or tampered files are refused.
{
  const { toVbg, parseVbg, vbgFileName } = await import('../src/records.js');
  let rs = 99;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const g = newGame(); const turns = []; let p = 0;
  while (!winner(g)) {
    const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
    const st = chooseMove(g, p, d, 3, rnd);
    turns.push({ p, dice: d, steps: st.map(({ r, t, d: die }) => ({ r, t, d: die })) });
    applySteps(g, p, st); p = 1 - p;
  }
  const rec = { name: 'Lesson / test', date: 1790000000000, level: 4, human: 0, opening: [5, 3], turns, result: { winner: 'cpu', points: 9 } };
  const text = toVbg(rec), back = parseVbg(text);
  ok(back.rec && back.rec.turns.length === turns.length && back.rec.imported, '.vbg round-trips');
  const w = winner(g);
  ok(back.rec.result.points === w.points && back.rec.result.winner === (w.p === 0 ? 'you' : 'cpu') && back.rec.result.how === w.how, 'result recomputed from the moves, not taken from the file');
  ok(vbgFileName(rec) === 'Lesson test.vbg', `safe file name (${vbgFileName(rec)})`);
  ok(JSON.parse(text).format === 'plakoto-vbg', 'Plakoto files carry their own format name');
  ok(!!parseVbg(text.replace('plakoto-vbg', 'fevga-vbg')).error, 'a Fevga game file is refused');
  const tamper = (f) => { const d = JSON.parse(text); f(d.game); return parseVbg(JSON.stringify(d)).error; };
  ok(!!tamper((x) => { x.turns[10].steps[0].t = 0; }), 'illegal move refused');
  ok(!!tamper((x) => { x.turns[5].dice = [6, 6]; }), 'changed dice refused');
  ok(!!tamper((x) => { x.turns.splice(3, 1); }), 'removed move refused');
  ok(!!tamper((x) => { x.turns.push(x.turns[0]); }), 'moves after the end refused');
  ok(!!parseVbg('not json').error && !!parseVbg('{"a":1}').error, 'non-game files refused');
  const short = { ...rec, turns: turns.slice(0, 20), resigned: true };
  const r2 = parseVbg(toVbg(short)).rec;
  ok(r2.result && r2.result.resigned && r2.result.winner === 'cpu' && r2.result.points === 2, 'resigned game keeps its double win');
  const single = { ...short, result: { winner: 'cpu', points: 1, resigned: true } };
  ok(parseVbg(toVbg(single)).rec.result.points === 1, 'single-loss concession keeps its 1 point');
  const odd = JSON.parse(toVbg(short)); odd.game.resignPoints = 7;
  ok(parseVbg(JSON.stringify(odd)).rec.result.points === 2, 'hostile resignPoints clamped to double');
  ok(parseVbg(toVbg({ ...rec, resigned: true })).rec.result.resigned === undefined, 'a resigned flag cannot override a finished board');
}

// 15b. Games that end by the mother rule and in a tie read back from .vbg with that result.
{
  const { toVbg, parseVbg, resultText } = await import('../src/records.js');
  // scripted: both sides walk one checker at a time 24 -> 20 with double ones until only the mothers are left
  const g = newGame(), turns = [];
  const seq = (p, dice, steps) => { const T = play(g, p, dice, steps); turns.push({ p, dice, steps: T.played.map(({ r, t, d }) => ({ r, t, d })) }); };
  for (let k = 0; k < 14; k++) { seq(0, [1, 1], [[24, 1], [23, 1], [22, 1], [21, 1]]); seq(1, [1, 1], [[24, 1], [23, 1], [22, 1], [21, 1]]); }
  ok(g.pos[0][24] === 1 && g.pos[1][24] === 1, 'scripted: both sides down to their mothers');
  const rec = { name: 'm', date: 1, level: 3, human: 0, opening: null, turns };
  ok(parseVbg(toVbg(rec)).rec.result === null, 'unfinished scripted game reads back as unfinished');
  seq(0, [6, 6], [[24, 6], [18, 6], [20, 6], [14, 6]]); // white's mother leaves (24>12), and 20>8: white's start is empty
  seq(1, [6, 6], [[20, 6], [14, 6], [8, 6], [20, 6]]);  // black 20>2 and 20>14; black's mother stays alone on its start
  ok(winner(g) === null, 'no result yet');
  seq(0, [4, 3], [[8, 4], [4, 3]]);                     // white 8>4>1: lands on black's start and pins its mother
  const w = winner(g);
  ok(w && w.how === 'mother' && w.p === 0 && w.points === 2, `mother pinned by a side with an empty start: double (${JSON.stringify(w)})`);
  const back = parseVbg(toVbg({ ...rec, turns })).rec;
  ok(back.result && back.result.winner === 'you' && back.result.how === 'mother' && back.result.points === 2, 'a mother win reads back from .vbg as a mother win');
  ok(resultText(back) === 'player won +2 (mother pinned)', `mother result text (${resultText(back)})`);
  ok(resultText({ result: { winner: 'tie', points: 0, how: 'tie' } }) === 'tie — both mothers pinned', 'tie result text');
}

// 16. Mistake review: an Expert's own plays screen at zero loss; a random player's do not;
//     reviewTurn measures the move actually played.
{
  const { screenTurns, reviewTurn } = await import('../src/engine.js');
  const playGame = (lv0, seed) => {
    let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
    const g = newGame(), turns = []; let p = 0;
    while (!winner(g) && turns.length < 600) {
      const d = [1 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 6)];
      const steps = chooseMove(g, p, d, p === 0 ? lv0 : 4, rnd);
      turns.push({ p, dice: d, steps: steps.map(({ r, t, d: die }) => ({ r, t, d: die })) });
      applySteps(g, p, steps); p = 1 - p;
    }
    return turns;
  };
  const expert = screenTurns(playGame(5, 11), 0);
  ok(expert.length > 5 && expert.every((x) => Math.abs(x.loss) < 1e-9), `Expert's plays screen at zero loss (${expert.length} turns)`);
  ok(expert.every((x) => x.legal > 1), 'only turns with a choice are screened');
  const turns = playGame(1, 7), rand = screenTurns(turns, 0);
  ok(rand.some((x) => x.loss > 1) && rand.every((x) => x.loss >= -1e-9), 'a random player shows clear losses, never negative');
  const worst = rand.sort((a, b) => b.loss - a.loss)[0];
  const r = reviewTurn(turns, worst.i, { rollouts: 30, top: 2, seed: 1 });
  const g0 = newGame(); for (let k = 0; k < worst.i; k++) applySteps(g0, turns[k].p, turns[k].steps);
  const after = applySteps(cloneGame(g0), 0, turns[worst.i].steps);
  const pAfter = applySteps(cloneGame(g0), 0, r.played.steps);
  ok(JSON.stringify(gamePlain(after)) === JSON.stringify(gamePlain(pAfter)), 'reviewTurn reports the move actually played');
  ok(r.best.eq >= r.played.eq && r.cands[0] === r.best, 'reviewTurn ranks the best candidate first');
}

// 17. Puzzles (src/puzzles.js, generated): every stored answer is legal through the interactive
//     turn API, lands on its stored key, is among the accepted keys; the best wrong move is not
//     accepted; the legal-play count and the >= 10-point gap hold; ids run 1..N.
{
  const { PUZZLES } = await import('../src/puzzles.js');
  const { playKey, viewFrom } = await import('../src/engine.js');
  const bad = [];
  PUZZLES.forEach((q, n) => {
    if (!q || q.id !== n + 1) { bad.push(`#${n + 1}: missing or misnumbered`); return; }
    const v0 = viewFrom(q);
    const g = { pos: [v0.mine, v0.opp], pin: [v0.mp, v0.op], off: [q.myOff, q.oppOff] };
    const v = viewOf(g, 0);
    try {
      const T = createTurn(g, 0, q.dice);
      for (const s of q.best) turnPlay(T, { r: s.r, d: s.d });
      if (!turnDone(T)) bad.push(`#${q.id}: answer does not use every playable die`);
      if (playKey(v, T.played) !== q.key || playKey(v, q.best) !== q.key) bad.push(`#${q.id}: answer lands elsewhere`);
    } catch (e) { bad.push(`#${q.id}: answer is not legal (${e.message})`); }
    if (!q.keys.includes(q.key)) bad.push(`#${q.id}: answer not among the accepted keys`);
    if (q.keys.includes(playKey(v, q.second))) bad.push(`#${q.id}: the wrong move is accepted`);
    if (finalPositions(v, expandDice(q.dice)).length !== q.legal) bad.push(`#${q.id}: legal count`);
    if (q.win[0] - q.win[1] < 0.1 - 1e-9) bad.push(`#${q.id}: gap below 10 points`);
    if (![1, 2, 3, 4].includes(q.tier)) bad.push(`#${q.id}: tier`);
  });
  ok(PUZZLES.length >= 12 && !bad.length, `${PUZZLES.length} puzzles valid${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`);
}

// 18. Winning chances (Settings > Show winning chances) and the computer conceding (.vbg round-trip)
{
  const { winChances } = await import('../src/engine.js');
  const { toVbg, parseVbg, resultText } = await import('../src/records.js');
  const start = winChances(newGame(), 0, { rollouts: 120, seed: 3 });
  ok(start.white > 0.35 && start.white < 0.75 && Math.abs(start.white + start.black + start.tie - 1) < 1e-9, `opening position is fairly even (${Math.round(start.white * 100)}% white, ${Math.round(start.tie * 100)}% ties)`);
  const g1 = newGame(); g1.pos[0].fill(0); g1.pos[0][1] = 1; g1.off[0] = 14;
  const lop = winChances(g1, 0, { rollouts: 60, seed: 3 });
  ok(lop.white === 1 && lop.blackMars === 0, 'a board one move from bearing off the last checker is a certain win');
  const g2 = cloneGame(g1); g2.off[0] = 15; g2.pos[0][1] = 0;
  ok(winChances(g2, 1).white === 1 && winChances(g2, 1).rollouts === 0, 'a finished game reports its result without play-outs');
  const rec = { name: 't', date: 1, level: 3, human: 0, opening: null, turns: [], resigned: true, result: { winner: 'you', points: 2, resigned: true } };
  const back = parseVbg(toVbg(rec)).rec;
  ok(back.result.winner === 'you' && back.result.points === 2 && back.result.resigned, 'computer-conceded game round-trips through .vbg');
  const rec2 = { ...rec, result: { winner: 'cpu', points: 1, resigned: true } };
  ok(parseVbg(toVbg(rec2)).rec.result.winner === 'cpu', 'player-admitted game still round-trips');
  ok(resultText(rec).startsWith('computer conceded'), 'result text names the computer\'s concession');
}

// 19. .vbs settings files: round-trip, clamping of hostile values, refusal of other files
{
  const { toVbs, parseVbs } = await import('../src/records.js');
  const setup = { level: 4, color: 1, light: 0.6, lamp: true, freeCam: false, view: [40, 60, 100], theme: 'olive', numbers: false, trails: false, round: true, total: true, odds: true, muted: true, autoEnd: true, quick: true, autoRoll: true, forced: false, openingPlay: true, match: true };
  const back = parseVbs(toVbs(setup, [{ name: 'Night', s: setup }]));
  ok(JSON.stringify(back.setup) === JSON.stringify(setup) && back.favourites.length === 1 && back.favourites[0].name === 'Night', '.vbs round-trips');
  const evil = parseVbs(JSON.stringify({ format: 'plakoto-vbs', version: 1, setup: { level: 99, color: 'x', light: 1e9, view: [1e9, 0, 0], theme: { a: 1 }, lamp: 'yes', extra: '<script>' }, favourites: [{ name: 42, s: null }, 'junk'] }));
  ok(evil.setup.level === 3 && evil.setup.color === 0 && evil.setup.light === 1.6 && evil.setup.view === null && evil.setup.theme === 'walnut' && evil.setup.lamp === false && !('extra' in evil.setup), 'hostile values clamped or dropped');
  ok(evil.favourites.length === 0, 'unreadable favourites dropped');
  ok(evil.setup.quick === false, 'quick move is off unless exactly true (older files lack it)');
  ok(evil.setup.autoRoll === false, 'auto-roll is off unless exactly true (older files lack it)');
  ok(evil.setup.forced === true, 'forced moves play themselves unless exactly false (older files lack it)');
  ok(!!parseVbs('{"format":"plakoto-vbg","version":1}').error && !!parseVbs('nope').error, 'non-settings files refused');
}

// 20. records: resigned games read as conceded
{
  const { resultText } = await import('../src/records.js');
  ok(resultText({ result: { winner: 'cpu', points: 2, resigned: true } }) === 'you admitted the loss, computer +2', 'resigned result text');
  ok(resultText({ result: { winner: 'you', points: 2, how: 'off' } }) === 'you won +2 (mars)', 'mars result text');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

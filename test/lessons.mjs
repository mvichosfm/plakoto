// Proves the guided lessons against the real engine: every position is a valid Plakoto position,
// the scripted answer is a legal play that satisfies the goal, the goal is not met by every play
// (so it tests something), and the claims the lesson text makes about the rules actually hold.
// Run: node test/lessons.mjs
import { createTurn, turnPlay, turnSteps, turnDone, finalPositions, commitTurn, winner, S, expandDice } from '../src/engine.js';
import { LESSONS, lessonBoard, lessonSteps, boardFrom } from '../src/lessons.js';

let passes = 0, fails = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('FAIL: ' + msg); } };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const L = Object.fromEntries(LESSONS.map((l) => [l.id, l]));
const game = (q) => ({ pos: [Int8Array.from(q.mine), Int8Array.from(q.opp)], pin: [Int8Array.from(q.mp), Int8Array.from(q.op)], off: [q.myOff, q.oppOff] });
const turnOf = (l) => { const q = lessonBoard(l); return createTurn(game(q), 0, q.dice); };
const has = (T, from, d) => turnSteps(T).some((s) => s.r === 25 - from && s.d === d);

ok(LESSONS.length === 9, 'nine lessons');
ok(new Set(LESSONS.map((l) => l.id)).size === LESSONS.length, 'lesson ids are unique');

for (const l of LESSONS) {
  const q = lessonBoard(l);
  // a valid position: fifteen checkers a side; a point holds both colours only as a pin
  ok(sum(q.mine) + q.myOff === 15, `${l.id}: 15 of mine`);
  ok(sum(q.opp) + q.oppOff === 15, `${l.id}: 15 of the computer's`);
  let clash = 0, badPin = 0;
  for (let r = 1; r <= 24; r++) {
    if (q.mine[r] && q.opp[S(r)] && !q.mp[r] && !q.op[S(r)]) clash++;
    if (q.mp[r] && (q.mine[r] !== 1 || !q.opp[S(r)])) badPin++;
    if (q.op[r] && (q.opp[r] !== 1 || !q.mine[S(r)])) badPin++;
  }
  ok(clash === 0, `${l.id}: no point held by both sides without a pin`);
  ok(badPin === 0, `${l.id}: every pinned checker is alone under an opponent`);
  ok(q.dice.length === 2 && q.dice.every((d) => d >= 1 && d <= 6), `${l.id}: dice`);
  ok(l.goal.every((s) => s >= 1 && s <= 24), `${l.id}: goal points are real`);
  ok(typeof l.teach === 'string' && typeof l.task === 'string' && typeof l.win === 'string' && typeof l.miss === 'string', `${l.id}: all texts present`);

  // the scripted answer is legal, step by step, completes the turn and meets the goal
  const T = turnOf(l);
  let legalAnswer = true;
  try { for (const st of lessonSteps(l.answer)) turnPlay(T, st); } catch { legalAnswer = false; }
  ok(legalAnswer && turnDone(T), `${l.id}: the answer is a legal complete play`);
  ok(l.check(T.v), `${l.id}: the answer meets the goal`);

  // the goal is a real test: some legal complete play misses it (where more than one play exists)
  const v0 = lessonBoard(l);
  const view = { mine: Int8Array.from(v0.mine), opp: v0.opp, mp: Int8Array.from(v0.mp), op: Int8Array.from(v0.op), myOff: v0.myOff, oppOff: v0.oppOff };
  const finals = finalPositions(view, expandDice(v0.dice));
  const good = finals.filter((f) => l.check({ mine: f.mine, opp: v0.opp, mp: f.mp, op: f.op, myOff: f.myOff, oppOff: v0.oppOff }));
  ok(finals.length >= 1 && good.length >= 1, `${l.id}: ${good.length}/${finals.length} legal plays meet the goal`);
  if (!['larger', 'mars', 'bearoff'].includes(l.id)) ok(good.length < finals.length, `${l.id}: the goal is not met by every play (${good.length}/${finals.length})`);
}

// --- the claims the texts make
{ // boardFrom puts the computer's checkers where the player sees them (its own point = the shown number)
  const b = boardFrom({ mine: { 1: 15 }, opp: { 24: 15 } });
  ok(b.mine[24] === 15 && b.opp[24] === 15, 'boardFrom: starts are each side\'s own point 24');
  ok(25 - 24 === 1 && S(1) === 24, 'the computer\'s start (shown 24) is the player\'s engine point 1');
}
{ // direction: any checker may move, there is no runner rule
  const T = turnOf(L.direction);
  turnPlay(T, turnSteps(T)[0]);
  ok(turnSteps(T).some((s) => s.r === 24) && turnSteps(T).some((s) => s.r !== 24), 'direction: after one die another checker may still leave the start');
}
{ // pin: landing on 9 pins; moving on frees it
  const T = turnOf(L.pin);
  const st = turnSteps(T).find((s) => s.r === 25 - 4 && s.d === 5);
  ok(st && st.pin, 'pin: 4 -> 9 with the 5 pins the lone checker');
  turnPlay(T, { r: 25 - 4, d: 5 });
  const on = turnSteps(T).find((s) => s.r === 25 - 9 && s.d === 2);
  ok(on && on.free, 'pin: moving on from 9 with the 2 would set it free (as the text warns)');
}
{ // closed: 5 + 3 = 8 (two checkers) and 5 + 5 = 10 (a pinner) are closed; the pinned 10 cannot move
  const T = turnOf(L.closed);
  ok(!has(T, 5, 3) && !has(T, 5, 5), 'closed: the checker on 5 has no move');
  ok(!turnSteps(T).some((s) => s.r === 25 - 10), 'closed: the pinned checker on 10 cannot move');
  ok(has(T, 1, 5) && has(T, 1, 3), 'closed: checkers on 1 may move');
}
{ // hold: after 7 -> 9 one checker may leave 9 and the pin holds
  const T = turnOf(L.hold);
  turnPlay(T, { r: 25 - 7, d: 2 });
  const leave = turnSteps(T).find((s) => s.r === 25 - 9 && s.d === 4);
  ok(leave && !leave.free, 'hold: with two on 9, one may leave and the pin holds');
}
{ // larger: only one die is playable, and it is the 6
  const T = turnOf(L.larger);
  ok(T.M === 1, 'larger: only one die can be played');
  ok(turnSteps(T).length >= 1 && turnSteps(T).every((s) => s.d === 6), 'larger: the only die offered is the larger');
}
{ // doubles: four moves
  ok(turnOf(L.doubles).M === 4, 'doubles: four moves to play');
}
{ // mother: the answer wins double on the spot (the lesson ends before the game would)
  const q = lessonBoard(L.mother), g = game(q), T = createTurn(g, 0, q.dice);
  for (const st of lessonSteps(L.mother.answer)) turnPlay(T, st);
  commitTurn(g, T);
  const w = winner(g);
  ok(w && w.p === 0 && w.how === 'mother' && w.points === 2, 'mother: pinning the lone mother with an empty start is a double win');
  // and the waiver the text describes: with a checker of mine still on my start, the same pin does not end the game
  const q2 = boardFrom({ mine: { 1: 1, 18: 4, 19: 5, 20: 4, 21: 1 }, opp: { 24: 1, 3: 7, 4: 7 } });
  const g2 = game({ ...q2, dice: [4, 3] }), T2 = createTurn(g2, 0, [4, 3]);
  turnPlay(T2, { r: 25 - 21, d: 3 }); turnPlay(T2, { r: 25 - 18, d: 4 });
  commitTurn(g2, T2);
  ok(g2.pin[1][24] === 1 && winner(g2) === null, 'mother: waived while my own start is not empty');
}
{ // bearoff: the 6 cannot be played (pinned checker furthest back); only the 2, and it bears off from 23
  const T = turnOf(L.bearoff);
  ok(T.M === 1 && turnSteps(T).every((s) => s.d === 2), 'bearoff: only the 2 can be played');
  ok(turnSteps(T).some((s) => s.r === 2 && s.t === 0), 'bearoff: the 2 bears off from 23');
  ok(!turnSteps(T).some((s) => s.r === 6), 'bearoff: the pinned checker on 19 cannot move');
}
{ // mars: three checkers left, the computer has none off, so bearing them off is a mars
  const q = lessonBoard(L.mars), g = game(q), T = createTurn(g, 0, q.dice);
  ok(q.oppOff === 0 && q.myOff === 12 && T.M === 3, 'mars: three to bear off, the computer has none off');
  for (const st of lessonSteps(L.mars.answer)) turnPlay(T, st);
  commitTurn(g, T);
  ok(winner(g).points === 2, 'mars: the answer is a double win');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

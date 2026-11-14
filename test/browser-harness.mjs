// Browser harness (dev server only; test/ is never published). In the page's console:
//   const H = await import('/test/browser-harness.mjs');
//   await H.playGame({ seat: 0, humanLevel: 2, cpuLevel: 3 })
// plays a whole game through the page - the human side driven by the engine at humanLevel through
// playPath / done, the computer by the page itself - and after every committed turn compares the
// 3D board (window.__plakoto.stackColours / offStacks: pinned checkers at the bottom of their stack)
// with the engine's game state. Animations are stepped with __plakoto.advance, so it also works
// while the preview pane is hidden.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the expected bottom-to-top colours of each board point (0..23, drawn from the human's seat)
export function expectedStacks(P, g) {
  const H = P.human, out = [];
  for (let a = 0; a < 24; a++) {
    const rr = [H === 0 ? a + 1 : 24 - a, H === 1 ? a + 1 : 24 - a];
    const wc = g.pos[0][rr[0]], bc = g.pos[1][rr[1]];
    out.push(g.pin[1][rr[1]] ? 'B' + 'W'.repeat(wc) : g.pin[0][rr[0]] && bc ? 'W' + 'B'.repeat(bc) : 'W'.repeat(wc) + 'B'.repeat(bc));
  }
  return out;
}

export async function playGame({ seat = 0, humanLevel = 2, cpuLevel = 3, maxChecks = 400 } = {}) {
  const P = window.__plakoto;
  P.setTimeScale(0.01);
  P.setLevel(cpuLevel);
  if (P.human !== seat) document.querySelector(`#seat button[data-color="${seat}"]`).click(); else P.startGame();
  let checks = 0, lastLen = -1, pinsSeen = 0, guard = 0, started = null, stuck = 0, lastSig = '';
  const mismatches = [];
  const compare = (n) => {
    lastLen = n; checks++;
    const e = expectedStacks(P, P.g), s = P.stackColours;
    pinsSeen += s.filter((x) => x.length > 1 && x[0] !== x[x.length - 1]).length;
    for (let a = 0; a < 24; a++) if (e[a] !== s[a]) mismatches.push({ turn: n, a, e: e[a], s: s[a] });
    const off = P.offStacks;
    if (off[0] !== P.g.off[0] || off[1] !== P.g.off[1]) mismatches.push({ turn: n, off, g: P.g.off.slice() });
  };
  while (guard++ < 60000) {
    P.advance(0.3);
    await sleep(2);
    const ph = P.phase, n = P.record ? P.record.turns.length : 0;
    const sig = ph + n + (P.T ? P.T.played.length : -1) + P.busy;
    if (sig === lastSig) { if (++stuck > 3000) return { stuckAt: sig, turns: n, mismatches, nMismatch: mismatches.length }; } else { stuck = 0; lastSig = sig; }
    if (!P.busy && n !== lastLen && (!P.T || (ph === 'human-move' && P.T.played.length === 0))) compare(n);
    if (ph === 'over' || checks > maxChecks) break;
    if (P.busy) continue;
    if (ph === 'opening' || ph === 'human-roll') { P.roll(); continue; }
    if (ph === 'human-move') {
      const T = P.T;
      if (T.M === 0) continue;
      if (T.played.length === 0 && started !== T) {
        started = T;
        const steps = P.engine.chooseMove(P.engine.cloneGame(P.g), P.human, P.curDice, humanLevel);
        P.playPath(steps.map((s) => ({ ...s, from: P.A(P.human, s.r), to: s.t ? P.A(P.human, s.t) : -1 })));
      } else if (T.played.length >= T.M) P.done();
    }
  }
  P.advance(1);
  compare(-2);
  return { phase: P.phase, turns: P.record && P.record.turns.length, result: P.record && P.record.result, checks, pinsSeen, mismatches: mismatches.slice(0, 10), nMismatch: mismatches.length, title: document.getElementById('ovTitle').textContent };
}

// where every checker is drawn, as sorted 'colour:x,y,z' (the picture itself, not the stack counts)
function checkerSpots(P) {
  const out = [];
  P.three.scene.traverse((o) => {
    const u = o.userData;
    if (u && u.rest && u.ao && typeof u.p === 'number') out.push(`${u.p}:${o.position.x.toFixed(2)},${o.position.y.toFixed(2)},${o.position.z.toFixed(2)}`);
  });
  return out.sort();
}
function inFlight(P) {
  let n = 0;
  P.three.scene.traverse((o) => { if (o.userData && o.userData.rest && o.userData.anim > 0) n++; });
  return n;
}
async function settle(P, sec) { for (let t = 0; t < sec; t += 0.5) { P.advance(0.5); await sleep(2); } }

//   await H.handover()
// hands the board over while a checker is in the air - a new game during the human's move, and
// leaving a replay during a replayed move - and checks that every checker is then drawn where
// the new layout put it. ok = no stray checker in either case.
export async function handover() {
  const P = window.__plakoto;
  P.setTimeScale(0.01);
  const stray = (ref, now) => now.filter((s) => !ref.includes(s));
  if (P.replay) P.exitReplay();

  // 1. New game while the human's checker is moving
  P.startGame(); await settle(P, 8);
  const refNew = checkerSpots(P);
  P.setGame([Array.from(P.g.pos[0]), Array.from(P.g.pos[1])], [0, 0], 'human-roll');
  P.forceDice([3, 1]);
  P.roll();
  for (let i = 0; i < 400 && !(P.phase === 'human-move' && !P.busy); i++) { P.advance(0.3); await sleep(2); }
  const s = P.legal.find((x) => x.r === 24 && x.d === 3);
  P.playPath([{ ...s, from: P.A(P.human, s.r), to: P.A(P.human, s.t) }]);
  P.advance(0.1);
  const flyingNewGame = inFlight(P);
  P.startGame(); await settle(P, 8);
  const strayNewGame = stray(refNew, checkerSpots(P));

  // 2. Leaving a replay while a replayed checker is moving (the record lives in memory only)
  const rec = { id: 'handover', date: Date.now(), human: P.human, level: 3, opening: null, result: null, turns: [
    { p: 0, dice: [3, 1], steps: [{ r: 24, t: 21, d: 3 }, { r: 24, t: 23, d: 1 }] },
    { p: 1, dice: [4, 2], steps: [{ r: 24, t: 20, d: 4 }, { r: 24, t: 22, d: 2 }] },
  ] };
  P.enterReplay(rec); P.exitReplay(); await settle(P, 2);
  const refLive = checkerSpots(P);
  P.enterReplay(rec); P.replayJump(1); P.replayStep();
  let flyingReplayExit = 0;
  for (let i = 0; i < 2000 && !(flyingReplayExit = inFlight(P)); i++) { P.advance(0.05); await sleep(2); }
  P.exitReplay(); await settle(P, 4);
  const strayReplayExit = stray(refLive, checkerSpots(P));

  const ok = flyingNewGame > 0 && flyingReplayExit > 0 && !strayNewGame.length && !strayReplayExit.length && !inFlight(P);
  return { ok, flyingNewGame, flyingReplayExit, strayNewGame, strayReplayExit, checkers: refNew.length, stillAnimating: inFlight(P) };
}

//   H.toastCheck()
// the toast (load errors, why a move is refused) must be painted above the sheets, use the width a
// portrait phone has, and stay clear of the move bar on a landscape phone. Run it at 1280x800,
// 360x640 and 780x360: ok = every check that applies to the current window size holds.
export function toastCheck() {
  const t = document.getElementById('toast');
  // (its .25s transition stands still while the preview pane is hidden, and max-width would keep the
  //  previous window size's value after a resize)
  t.style.transition = 'none';
  const z = +getComputedStyle(t).zIndex, zSheet = +getComputedStyle(document.getElementById('settings')).zIndex;
  const text = t.textContent, shown = t.classList.contains('show');
  // (the longest reason main.js gives for a refused move)
  t.textContent = 'That move would leave a die unplayed — you must play both dice when you can (or the larger one, if only one can be played)';
  t.classList.add('show');
  const r = t.getBoundingClientRect(), bar = document.getElementById('bar').getBoundingClientRect();
  t.textContent = text;
  if (!shown) t.classList.remove('show');
  t.getBoundingClientRect();
  t.style.transition = '';
  const w = innerWidth, h = innerHeight, portrait = w <= 700 && h > 500, landscape = h <= 500;
  const aboveSheets = z > zSheet;
  const wide = !portrait || r.width >= w - 40;
  const clearOfBar = !landscape || r.right <= bar.left;
  const inWindow = r.left >= 0 && r.right <= w && document.documentElement.scrollWidth <= w;
  return { ok: aboveSheets && wide && clearOfBar && inWindow, aboveSheets, wide, clearOfBar, inWindow, z, zSheet,
    window: [w, h], toast: [Math.round(r.left), Math.round(r.right), Math.round(r.width)], barLeft: Math.round(bar.left) };
}

//   await H.tabOrderCheck()
// a closed sheet (welcome, rules, games, puzzles, settings, game over) must not keep its controls
// in the Tab order or keep the keyboard focus, and must still open at once. It closes the open
// sheets, opens Rules, goes Rules > About (the welcome screen takes the focus) and closes that.
// ok = no Tab stop is left inside a closed sheet and the focus is not inside one.
export async function tabOrderCheck() {
  const $ = (id) => document.getElementById(id);
  const open = (id) => !$(id).classList.contains('hidden');
  // (their fade stands still while the preview pane is hidden: take every sheet to its end state)
  const settle = async () => {
    for (let i = 0; i < 2; i++) {
      await sleep(250);
      for (const a of document.getAnimations()) if (a.effect && a.effect.target && a.effect.target.closest('.modal')) a.finish();
    }
  };
  if (open('hero')) $('heroPlay').click();
  for (const [sheet, close] of [['rules', 'closeRules'], ['games', 'closeGames'], ['puzzles', 'closePuzzles'], ['settings', 'closeSettings']]) if (open(sheet)) $(close).click();
  await settle();
  $('rulesBtn').click();
  const rulesOpens = getComputedStyle($('rules')).visibility === 'visible';
  $('rulesAbout').click();
  const heroTakesFocus = getComputedStyle($('hero')).visibility === 'visible' && document.activeElement === $('heroPlay');
  $('heroPlay').click();
  await settle();
  // (the browser takes the focus off a control that left the Tab order at its next rendering step)
  const inClosed = () => !!(document.activeElement && document.activeElement.closest('.modal.hidden'));
  for (let i = 0; i < 40 && inClosed(); i++) await sleep(50);
  const stops =[...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter((e) =>
    !e.disabled && e.tabIndex >= 0 && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible');
  const closed = stops.filter((e) => e.closest('.modal.hidden'));
  const bySheet = {};
  for (const e of closed) { const id = e.closest('.modal.hidden').id; bySheet[id] = (bySheet[id] || 0) + 1; }
  const a = document.activeElement, focusInClosed = inClosed();
  return { ok: closed.length === 0 && !focusInClosed && rulesOpens && heroTakesFocus, tabStops: stops.length, inClosedSheets: closed.length, bySheet,
    focusInClosed, focusOn: a ? a.id || a.tagName : null, rulesOpens, heroTakesFocus };
}

//   await H.keyChecks()
// the game keys must not act behind an open sheet, and Esc must close the sheet: with Rules or
// Puzzles open Space must not roll the dice, Esc closes each of them, Esc on the Puzzles sheet
// during a puzzle closes the sheet first and leaves the puzzle only at the next press, and with
// no sheet open Space still rolls. ok = all of them hold.
export async function keyChecks() {
  const P = window.__plakoto;
  const $ = (id) => document.getElementById(id);
  const open = (id) => !$(id).classList.contains('hidden');
  const key = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  P.setTimeScale(0.01);
  if (P.replay) P.exitReplay();
  if (open('hero')) $('heroPlay').click();
  for (const [sheet, close] of [['rules', 'closeRules'], ['games', 'closeGames'], ['puzzles', 'closePuzzles'], ['settings', 'closeSettings']]) if (open(sheet)) $(close).click();
  P.startGame(); await settle(P, 8);
  // the human to roll, nothing moving (also stops a throw that an earlier check let through)
  const toRoll = () => P.setGame([Array.from(P.g.pos[0]), Array.from(P.g.pos[1])], [0, 0], 'human-roll');
  const waiting = () => P.phase === 'human-roll' && !P.busy;

  // 1. Rules open: Space does nothing, Esc closes the sheet
  toRoll();
  $('rulesBtn').click();
  key(' ');
  const rolledBehindRules = !waiting();
  key('Escape');
  const rulesClosedByEsc = !open('rules');
  if (open('rules')) $('closeRules').click();

  // 2. Puzzles open: Space does nothing, Esc closes the sheet
  toRoll();
  $('puzzlesBtn').click();
  key(' ');
  const rolledBehindPuzzles = !waiting();
  key('Escape');
  const puzzlesClosedByEsc = !open('puzzles');
  if (open('puzzles')) $('closePuzzles').click();

  // 3. the Puzzles sheet during a puzzle: Esc closes the sheet, the next Esc leaves the puzzle
  toRoll();
  $('puzzlesBtn').click();
  document.querySelector('#puzzles .pz-tile').click();
  const puzzleStarted = !!P.puzzle;
  $('puzzlesBtn').click();
  key('Escape');
  const escKeepsPuzzle = !!P.puzzle && !open('puzzles');
  if (open('puzzles')) $('closePuzzles').click();
  key('Escape');
  const secondEscLeavesPuzzle = !P.puzzle;

  // 4. no sheet open: Space still rolls
  toRoll();
  key(' ');
  const rollsWithNoSheet = P.busy === true;
  toRoll();

  const ok = !rolledBehindRules && rulesClosedByEsc && !rolledBehindPuzzles && puzzlesClosedByEsc && puzzleStarted && escKeepsPuzzle && secondEscLeavesPuzzle && rollsWithNoSheet;
  return { ok, rolledBehindRules, rulesClosedByEsc, rolledBehindPuzzles, puzzlesClosedByEsc, puzzleStarted, escKeepsPuzzle, secondEscLeavesPuzzle, rollsWithNoSheet };
}

//   await H.staleCpuTurn()
// a new game started in the short pause between two steps of a move the page plays by itself -
// the computer's turn, and a forced move played for the human - must end that move quietly: the
// stale turn may not go on to read the turn the new game has cleared. Runs at the real time scale
// (the new game has to land inside a 0.12 s pause). ok = both pauses were hit and nothing threw.
export async function staleCpuTurn() {
  const P = window.__plakoto;
  const rejections = [];
  const onReject = (e) => rejections.push(String((e.reason && e.reason.message) || e.reason));
  window.addEventListener('unhandledrejection', onReject);
  if (P.replay) P.exitReplay();
  P.setTimeScale(1);
  // one step of the turn is played and its checker has landed: the pause before the next step
  const inPause = (ph) => P.phase === ph && P.busy && !!P.T && P.T.played.length === 1 && P.T.M === 2 && !inFlight(P);

  // 1. the computer's turn: the human plays 3-1, the computer answers 4-2
  P.startGame(); await settle(P, 8);
  P.setGame([Array.from(P.g.pos[0]), Array.from(P.g.pos[1])], [0, 0], 'human-roll');
  P.forceDice([3, 1], [4, 2]);
  P.roll();
  for (let i = 0; i < 2000 && !(P.phase === 'human-move' && !P.busy); i++) { P.advance(0.1); await sleep(2); }
  const steps = P.engine.chooseMove(P.engine.cloneGame(P.g), P.human, P.curDice, 3);
  P.playPath(steps.map((s) => ({ ...s, from: P.A(P.human, s.r), to: s.t ? P.A(P.human, s.t) : -1 })));
  for (let i = 0; i < 2000 && !(P.phase !== 'human-move' || (!P.busy && P.T.played.length >= P.T.M)); i++) { P.advance(0.1); await sleep(2); }
  if (P.phase === 'human-move') P.done();
  let cpuPause = false;
  for (let i = 0; i < 6000 && P.phase === 'cpu' && !(cpuPause = inPause('cpu')); i++) { P.advance(0.05); await sleep(1); }
  P.startGame();
  await sleep(600);

  // 2. a forced move: the human's last two checkers on 2 and 3 with a 6-5 (both orders end the same)
  await settle(P, 8);
  const pos = [new Array(25).fill(0), new Array(25).fill(0)], off = [0, 0];
  pos[P.human][2] = 1; pos[P.human][3] = 1; off[P.human] = 13;
  pos[1 - P.human][24] = 15;
  P.setGame(pos, off, 'human-roll');
  P.forceDice([6, 5]);
  P.roll();
  let forcedPause = false, left = false;
  for (let i = 0; i < 6000 && !left && !(forcedPause = inPause('human-move')); i++) {
    P.advance(0.05); await sleep(1);
    left = P.phase !== 'human-roll' && P.phase !== 'human-move'; // (not played as a forced move: Settings switch off)
  }
  P.startGame();
  await sleep(600);

  window.removeEventListener('unhandledrejection', onReject);
  P.setTimeScale(0.01);
  await settle(P, 8);
  return { ok: cpuPause && forcedPause && rejections.length === 0, cpuPause, forcedPause, rejections };
}

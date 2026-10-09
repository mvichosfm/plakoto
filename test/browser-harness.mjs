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

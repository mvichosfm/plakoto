// The guided lessons (Learn): nine short scripted positions on the real board, each introducing
// one rule of Plakoto. Pure data + goal checks, no DOM - main.js plays them through the normal turn
// machinery (the way puzzles are played) and test/lessons.mjs proves every position, answer and
// check against the engine.
//
// Everything here is written in the numbering a player SEES (records.shown): point 1 is the
// player's start (bottom left), 1-12 run left to right along the near rail, 13-24 right to left
// along the far rail, home is 19-24 (top left) and bearing off is "after 24". The computer travels the other way round: it starts on the player's
// 24 and its home is the player's 1-6, so a computer checker on shown point s stands on its OWN
// point s. The engine counts the player's side the other way (r = 25 - shown); boardFrom /
// lessonSteps convert.

const rOf = (shown) => 25 - shown; // the player's own engine point for a shown point

// { mine: { shown: count }, opp: { shown: count }, minePinned: [shown], oppPinned: [shown], myOff,
// oppOff } -> an engine view (mine / opp each in its own numbering, mp / op their pinned checkers,
// as puzzles.js stores them). A pinned checker is its side's only checker on that point.
export function boardFrom({ mine, opp, minePinned = [], oppPinned = [], myOff = 0, oppOff = 0 }) {
  const m = new Int8Array(25), o = new Int8Array(25), mp = new Int8Array(25), op = new Int8Array(25);
  for (const [s, n] of Object.entries(mine)) m[rOf(+s)] += n;
  for (const [s, n] of Object.entries(opp)) o[+s] += n; // the computer's own point is the shown number
  for (const s of minePinned) mp[rOf(s)] = 1;
  for (const s of oppPinned) op[s] = 1;
  return { mine: m, opp: o, mp, op, myOff, oppOff };
}

// [{from, to, d}] in shown numbers (to: 'off' bears off) -> engine steps [{r, t, d}]
export const lessonSteps = (answer) => answer.map(({ from, to, d }) => ({ r: rOf(from), t: to === 'off' ? 0 : rOf(to), d }));

export const LESSONS = [
  {
    id: 'direction', title: 'The board and the two ways round',
    mine: { 1: 15 }, opp: { 24: 15 }, dice: [2, 1], goal: [4],
    teach: `<p>You are the ivory checkers and all fifteen start on <b>point 1</b>, bottom left. You travel <b>1 to 12 along the near rail (left to right), then 13 to 24 along the far rail (right to left)</b>; your home is <b>19–24</b>, top left. The computer goes the <b>other way round</b>: it starts on your <b>24</b>, top left — inside your home — and its home is your <b>1–6</b>, bottom left. Every checker of yours meets every checker of its head-on. The gold numbers on the rails stay on during the lessons.</p>`,
    task: `You rolled <b>2–1</b>. Move one checker 3 points forward, to the glowing point <b>4</b>. Click a glowing checker, then a point — or drag the checker there.`,
    check: (v) => v.mine[rOf(4)] === 1 && v.mine[rOf(1)] === 14,
    answer: [{ from: 1, to: 3, d: 2 }, { from: 3, to: 4, d: 1 }],
    win: `<p>Yes: 1 → 3 with the 2, 3 → 4 with the 1. Each die moves a checker that many points along your way round; you choose how to spend the dice.</p>`,
    miss: `<p>Not quite: the goal is one checker on point 4 and the other fourteen still on 1. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'pin', title: 'Pinning: plakoto',
    mine: { 1: 14, 4: 1 }, opp: { 24: 14, 9: 1 }, dice: [5, 2], goal: [9],
    teach: `<p>There is <b>no hitting</b>. Instead, a checker that lands on a <b>single</b> opposing checker sits on top of it and <b>pins</b> it — <i>plakoto</i>, "pressed flat". The pinned checker cannot move until every one of your checkers has left that point, and while you sit there the point is <b>yours</b>.</p>`,
    task: `The computer left a lone checker on <b>9</b>. You rolled <b>5–2</b>: land on it with the 5 (4 → 9) and keep it pinned — play the 2 with another checker.`,
    check: (v) => v.op[9] === 1,
    answer: [{ from: 4, to: 9, d: 5 }, { from: 1, to: 3, d: 2 }],
    win: `<p>Pinned. That checker had 9 pips still to travel and now it waits for you. Watch out: moving on from 9 with the 2 (9 → 11) would have set it free again.</p>`,
    miss: `<p>The computer's checker on 9 should end the move pinned under yours — land on it with the 5 and use the 2 elsewhere. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'closed', title: 'Closed points',
    mine: { 1: 13, 5: 1, 10: 1 }, minePinned: [10], opp: { 24: 12, 8: 2, 10: 1 }, dice: [5, 3], goal: [9],
    teach: `<p>A point is <b>closed</b> to you when the computer has <b>two or more</b> checkers on it — or when one of its checkers is <b>pinning</b> one of yours there. Closed points never light up. Here the computer holds 8 with two checkers and pins your checker on 10.</p>`,
    task: `You rolled <b>5–3</b>. Your checker on 5 is stuck: 5 + 3 = 8 and 5 + 5 = 10 are both closed, and the pinned one on 10 cannot move at all. Bring one checker from 1 to <b>9</b> instead.`,
    check: (v) => v.mine[rOf(9)] >= 1,
    answer: [{ from: 1, to: 6, d: 5 }, { from: 6, to: 9, d: 3 }],
    win: `<p>Right: 1 → 6 → 9 (or 1 → 4 → 9). Two checkers make a point safe from pins, and a single pinning checker is just as solid — it cannot be pinned back.</p>`,
    miss: `<p>The goal is a checker on point 9 — one checker from 1 using both dice. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'hold', title: 'Holding a pin',
    mine: { 1: 13, 7: 1, 9: 1 }, opp: { 24: 14, 9: 1 }, oppPinned: [9], dice: [4, 2], goal: [9],
    teach: `<p>A pin lasts only while at least one of your checkers stays on that point. Bring a <b>second</b> checker onto it and the pin survives even when one of them moves on — and the point stays closed to the computer.</p>`,
    task: `You pin the computer's checker on <b>9</b>. You rolled <b>4–2</b>: bring the checker from 7 onto 9 with the 2, and play the 4 with a checker from 1.`,
    check: (v) => v.op[9] === 1 && v.mine[rOf(9)] >= 2,
    answer: [{ from: 7, to: 9, d: 2 }, { from: 1, to: 5, d: 4 }],
    win: `<p>Two on 9: the pinned checker stays put whatever you do with one of them. Pins far back on the computer's way round — your 13–24, just after its start — hurt it most: a checker pinned there still has nearly the whole board to travel.</p>`,
    miss: `<p>End with two of your checkers on 9 and the computer's checker still pinned: 7 → 9 with the 2, and the 4 from point 1. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'larger', title: 'Both dice — or the larger',
    mine: { 12: 1 }, myOff: 14, opp: { 24: 13, 23: 2 }, dice: [6, 5], goal: [18],
    teach: `<p>You must play <b>both dice</b> whenever that is possible (all four on a double). If only <b>one</b> die can be played, it has to be the <b>larger</b> one.</p>`,
    task: `Your last checker stands on 12 and you rolled <b>6–5</b>. 12 + 6 + 5 = 23, which the computer holds, so you cannot play both. Move the checker and see which die the game lets you use.`,
    check: (v) => v.mine[rOf(18)] === 1,
    answer: [{ from: 12, to: 18, d: 6 }],
    win: `<p>The 6. 12 → 17 with the 5 is open too, but when only one die can be played it must be the larger one, so the game only offers the 6.</p>`,
    miss: `<p>The checker should end on 18, played with the 6. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'doubles', title: 'Doubles play four times',
    mine: { 1: 13, 12: 1, 15: 1 }, opp: { 24: 15 }, dice: [3, 3], goal: [21],
    teach: `<p>A double is played <b>four times</b>: a 3–3 gives you four moves of 3, split between your checkers however you like.</p>`,
    task: `You rolled <b>3–3</b>. Take the checker on 12 to <b>21</b> (12 → 15 → 18 → 21 uses three of the 3s), then play the fourth 3 anywhere.`,
    check: (v) => v.mine[rOf(21)] >= 1 && !v.mine[rOf(12)],
    answer: [{ from: 12, to: 15, d: 3 }, { from: 15, to: 18, d: 3 }, { from: 18, to: 21, d: 3 }, { from: 15, to: 18, d: 3 }],
    win: `<p>Twelve pips in one roll. Notice the game kept the count for you — it said how many moves were still to play.</p>`,
    miss: `<p>The checker from 12 should reach point 21 in three steps of 3. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'mother', title: 'The mother',
    mine: { 18: 5, 19: 5, 20: 4, 21: 1 }, opp: { 24: 1, 3: 7, 4: 7 }, dice: [4, 3], goal: [24],
    teach: `<p>The <b>mother</b> is a side's <b>last checker on its starting point</b>. Pin it there and its side <b>loses double at once</b> — unless the pinner still has checkers on its own starting point; then play goes on, and the pinner wins double the moment its own start is empty. If both mothers end up pinned, the game is a <b>tie</b>. So: never leave your mother alone where the computer can reach it.</p>`,
    task: `The computer's mother stands alone on its start, your <b>24</b>, and your own starting point is empty. You rolled <b>4–3</b>: pin it — 21 → 24 with the 3.`,
    check: (v) => v.op[24] === 1 && !v.mine[24],
    answer: [{ from: 21, to: 24, d: 3 }, { from: 18, to: 22, d: 4 }],
    win: `<p><b>The mother is pinned</b> and your start is empty: in a game that is a double win on the spot. Keep your own mother company — leave the start with your last two checkers together when you can.</p>`,
    miss: `<p>Land on the computer's lone checker on 24 (21 → 24 with the 3). Press <b>Try again</b>.</p>`,
  },
  {
    id: 'bearoff', title: 'Bearing off',
    mine: { 19: 1, 20: 3, 22: 3, 23: 4, 24: 4 }, minePinned: [19], opp: { 19: 1, 3: 7, 4: 7 }, dice: [6, 2], goal: [],
    teach: `<p>When all fifteen are in your home (19–24) you may <b>bear off</b>: a die takes a checker off the point it counts to (a 1 from 24 … a 6 from 19). If that point is empty <b>and nothing of yours stands further back</b>, a larger die takes the furthest-back checker. A checker pinned <b>inside</b> your home still counts as home, but it cannot move — and it still stands further back. One pinned <b>outside</b> your home stops all bearing off.</p>`,
    task: `Your checker on 19 is pinned. You rolled <b>6–2</b>: the 6 cannot be used (19 is pinned, and it is behind everything else), so only the 2 plays. Bear off a checker from <b>23</b> with it.`,
    check: (v) => v.myOff === 1 && v.mine[rOf(23)] === 3,
    answer: [{ from: 23, to: 'off', d: 2 }],
    win: `<p>One off. The 6 was lost to the pin — the computer knew what it was doing when it pinned you at the back of your home.</p>`,
    miss: `<p>Bear off one checker from 23 with the 2. Press <b>Try again</b>.</p>`,
  },
  {
    id: 'mars', title: 'Mars: a double win',
    mine: { 24: 3 }, myOff: 12, opp: { 7: 5, 8: 5, 9: 5 }, dice: [1, 1], goal: [],
    teach: `<p>A win scores <b>1 point</b>. If you bear off all fifteen before the computer has borne off <b>a single checker</b> it is a <b>mars</b>, worth <b>2 points</b> — the same as pinning a mother.</p>`,
    task: `You have 12 checkers off, three left on 24, and the computer has none off. You rolled <b>1–1</b>: bear off all three.`,
    check: (v) => v.myOff === 15,
    answer: [{ from: 24, to: 'off', d: 1 }, { from: 24, to: 'off', d: 1 }, { from: 24, to: 'off', d: 1 }],
    win: `<p><b>Mars!</b> Fifteen off while the computer has none: two points. That is every rule. Play a game, try the puzzles, or read the strategy guide to start winning on purpose.</p>`,
    miss: `<p>Bear off all three checkers from 24, one per 1. Press <b>Try again</b>.</p>`,
  },
];

// a lesson's board as an engine puzzle-style record (what puzzleGame / pzView expect)
export const lessonBoard = (L) => ({ ...boardFrom(L), dice: L.dice.slice() });

import { test, eq, ok, no, throws, section } from './harness.js';
import { JOKER, DEUCE, ACE, THREE, cardValue } from '../src/engine/cards.js';
import {
  createGame, applyMove, initialMeldMinimum, canTakePile, pileBlockedReason,
  hasCanasta, teamCanastas, meldedValue, scoreTeam, redThreeScore, topDiscard,
} from '../src/engine/game.js';

section('Canasta game');

let seq = 0;
const c = (rank, suit = 'S') => ({ id: `g${seq++}`, rank, suit });
const joker = () => c(JOKER, 'X');
const ids = (...cards) => cards.map((x) => x.id);

const game = (opts = {}) => createGame({ seed: 1, ...opts });

// Total cards visible anywhere in the state.
const census = (s) =>
  s.players.reduce((n, p) => n + p.hand.length, 0) +
  s.stock.length + s.discard.length +
  s.teams.reduce((n, t) => n + t.redThrees.length +
    Object.values(t.melds).reduce((m, meld) => m + meld.length, 0), 0);

// Puts a player in mid-turn with a chosen hand, so a rule can be aimed at.
function rig(mutate, opts) {
  const s = game(opts);
  mutate(s);
  return s;
}

// ------------------------------------------------------------ setup

test('four hands of eleven, and a discard pile is started', () => {
  const s = game();
  eq(s.players.length, 4);
  for (const p of s.players) eq(p.hand.length, 11, 'hand size');
  ok(s.discard.length >= 1, 'a card was turned up');
  eq(s.phase, 'draw');
  eq(s.turn, 0);
});

test('partners sit opposite each other', () => {
  const s = game();
  eq(s.players.map((p) => p.team), [0, 1, 0, 1]);
});

test('all 108 cards are accounted for after the deal', () => {
  eq(census(game({ seed: 7 })), 108);
});

test('red threes never sit in a hand', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = game({ seed });
    const inHand = s.players.flatMap((p) => p.hand)
      .filter((x) => x.rank === THREE && (x.suit === 'H' || x.suit === 'D'));
    eq(inHand.length, 0, `seed ${seed}: red threes were banked instead`);
  }
});

test('a wild or red three turned up freezes the pile', () => {
  // Force the turn-up by seeding many deals and checking the invariant holds.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const s = game({ seed });
    const buried = s.discard.slice(0, -1);
    if (buried.length > 0) ok(s.frozen, `seed ${seed}: buried cards mean a frozen pile`);
  }
});

// ------------------------------------------------------------ turn structure

test('you must draw before you can discard', () => {
  const s = game();
  throws(() => applyMove(s, { type: 'discard', card: s.players[0].hand[0].id }), 'draw',
    'discarding first');
});

test('you cannot draw twice in a turn', () => {
  const s = applyMove(game(), { type: 'draw' });
  eq(s.phase, 'play');
  throws(() => applyMove(s, { type: 'draw' }), 'already drawn');
});

test('drawing then discarding passes the turn on', () => {
  let s = applyMove(game(), { type: 'draw' });
  eq(s.players[0].hand.length, 13, 'drew two');
  s = applyMove(s, { type: 'discard', card: s.players[0].hand[0].id });
  eq(s.turn, 1, 'next player');
  eq(s.phase, 'draw');
  // Two in and one out, so a hand grows by a card every turn.
  eq(s.players[0].hand.length, 12, 'up one on where it started');
});

test('the deck is conserved across a full turn', () => {
  let s = game({ seed: 3 });
  s = applyMove(s, { type: 'draw' });
  s = applyMove(s, { type: 'discard', card: s.players[0].hand[0].id });
  eq(census(s), 108);
});

// ------------------------------------------------------------ opening meld

test('the opening meld minimum climbs with the score', () => {
  eq(initialMeldMinimum(-50), 15, 'in the hole');
  eq(initialMeldMinimum(0), 50);
  eq(initialMeldMinimum(1499), 50);
  eq(initialMeldMinimum(1500), 90);
  eq(initialMeldMinimum(2999), 90);
  eq(initialMeldMinimum(3000), 120);
});

test('an opening meld below the minimum is refused', () => {
  const eights = [c(8, 'S'), c(8, 'H'), c(8, 'D')];
  const s = rig((x) => { x.phase = 'play'; x.players[0].hand = [...eights, c(9, 'S')]; });
  throws(() => applyMove(s, { type: 'meld', groups: [ids(...eights)] }), 'must be worth 50',
    'three eights is only 30');
});

test('an opening meld that clears the minimum goes down', () => {
  const aces = [c(ACE, 'S'), c(ACE, 'H'), c(ACE, 'D')];
  const s = rig((x) => { x.phase = 'play'; x.players[0].hand = [...aces, c(9, 'S'), c(10, 'H')]; });
  const after = applyMove(s, { type: 'meld', groups: [ids(...aces)] });
  eq(after.teams[0].melds[ACE].length, 3, 'three aces on the table');
  ok(after.teams[0].hasMelded, 'the partnership has opened');
  eq(meldedValue(after.teams[0]), 60);
});

test('once opened, small melds are fine', () => {
  const aces = [c(ACE, 'S'), c(ACE, 'H'), c(ACE, 'D')];
  const fours = [c(4, 'S'), c(4, 'H'), c(4, 'D')];
  let s = rig((x) => { x.phase = 'play'; x.players[0].hand = [...aces, ...fours, c(9, 'S'), c(10, 'H')]; });
  s = applyMove(s, { type: 'meld', groups: [ids(...aces)] });
  s = applyMove(s, { type: 'meld', groups: [ids(...fours)] });
  eq(s.teams[0].melds[4].length, 3, 'fifteen points is allowed after opening');
});

test('an opening meld may be spread over several groups', () => {
  const kings = [c(13, 'S'), c(13, 'H'), c(13, 'D')];
  const queens = [c(12, 'S'), c(12, 'H'), c(12, 'D')];
  const s = rig((x) => { x.phase = 'play'; x.players[0].hand = [...kings, ...queens, c(9, 'S'), c(10, 'H')]; });
  const after = applyMove(s, { type: 'meld', groups: [ids(...kings), ids(...queens)] });
  eq(meldedValue(after.teams[0]), 60, 'two melds of 30 clear the 50 together');
});

test('you cannot meld a card you do not hold', () => {
  const s = rig((x) => { x.phase = 'play'; });
  throws(() => applyMove(s, { type: 'meld', groups: [['nope-1', 'nope-2', 'nope-3']] }),
    'do not hold');
});

// ------------------------------------------------------------ laying off

test('a single card can extend a meld already on the table', () => {
  const aces = [c(ACE, 'S'), c(ACE, 'H'), c(ACE, 'D')];
  const spare = c(ACE, 'C');
  let s = rig((x) => { x.phase = 'play'; x.players[0].hand = [...aces, spare, c(9, 'S'), c(10, 'H')]; });
  s = applyMove(s, { type: 'meld', groups: [ids(...aces)] });
  s = applyMove(s, { type: 'meld', groups: [ids(spare)] });
  eq(s.teams[0].melds[ACE].length, 4, 'the fourth ace joined the meld');
});

test('a wild card can be laid onto a meld already down', () => {
  const wild = joker();
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].melds[8] = [c(8, 'S'), c(8, 'H'), c(8, 'D')];
    x.teams[0].hasMelded = true;
    x.players[0].hand = [wild, c(9, 'S'), c(10, 'H')];
  });
  const after = applyMove(s, { type: 'meld', groups: [{ to: 8, cards: ids(wild) }] });
  eq(after.teams[0].melds[8].length, 4, 'the joker joined the eights');
});

test('a wild card with no named meld is refused rather than guessed at', () => {
  const wild = joker();
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].melds[8] = [c(8, 'S'), c(8, 'H'), c(8, 'D')];
    x.teams[0].hasMelded = true;
    x.players[0].hand = [wild, c(9, 'S')];
  });
  throws(() => applyMove(s, { type: 'meld', groups: [ids(wild)] }), 'which meld');
});

test('a lay-off that would break the meld is refused', () => {
  const meld = [c(8, 'S'), c(8, 'H'), joker(), joker(), c(DEUCE, 'S')];
  const extra = joker();
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].melds[8] = meld;
    x.teams[0].hasMelded = true;
    x.players[0].hand = [extra, c(9, 'S')];
  });
  throws(() => applyMove(s, { type: 'meld', groups: [{ to: 8, cards: ids(extra) }] }), 'at most 3',
    'a fourth wild');
});

test('you cannot add to a meld your side has not made', () => {
  const spare = c(8, 'H');
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].hasMelded = true;
    x.players[0].hand = [spare, c(9, 'S')];
  });
  throws(() => applyMove(s, { type: 'meld', groups: [{ to: 8, cards: ids(spare) }] }), 'no meld');
});

// ------------------------------------------------------------ the discard pile

test('a black three on top blocks the pile', () => {
  const s = rig((x) => { x.discard = [c(9, 'H'), c(THREE, 'S')]; });
  ok(pileBlockedReason(s).includes('black three'));
  no(canTakePile(s).ok);
});

test('a wild on top blocks the pile', () => {
  const s = rig((x) => { x.discard = [c(9, 'H'), joker()]; });
  ok(pileBlockedReason(s).includes('wild'));
});

test('an unfrozen pile can be taken with a natural pair', () => {
  const top = c(ACE, 'H');
  const pair = [c(ACE, 'S'), c(ACE, 'D')];
  const s = rig((x) => {
    x.frozen = false;
    x.discard = [c(9, 'H'), c(5, 'C'), top];
    x.players[0].hand = [...pair, c(9, 'S')];
  });
  ok(canTakePile(s).ok, 'the pair lets you take it');

  const after = applyMove(s, { type: 'takePile', groups: [ids(top, ...pair)] });
  eq(after.teams[0].melds[ACE].length, 3, 'the top card was melded at once');
  eq(after.discard.length, 0, 'the pile is gone');
  ok(after.players[0].hand.some((x) => x.rank === 9 && x.suit === 'H'), 'the rest came to hand');
  eq(after.phase, 'play');
});

test('an unfrozen pile can also be taken with a natural and a wild', () => {
  const s = rig((x) => {
    x.frozen = false;
    x.discard = [c(9, 'H'), c(ACE, 'H')];
    x.players[0].hand = [c(ACE, 'S'), joker(), c(9, 'S')];
  });
  eq(canTakePile(s).mode, 'natural-plus-wild');
});

test('a frozen pile demands two natural cards', () => {
  const withWild = rig((x) => {
    x.frozen = true;
    x.discard = [c(9, 'H'), c(ACE, 'H')];
    x.players[0].hand = [c(ACE, 'S'), joker(), c(9, 'S')];
  });
  no(canTakePile(withWild).ok, 'a wild will not do');
  ok(canTakePile(withWild).reason.includes('frozen'));

  const withPair = rig((x) => {
    x.frozen = true;
    x.discard = [c(9, 'H'), c(ACE, 'H')];
    x.players[0].hand = [c(ACE, 'S'), c(ACE, 'D'), c(9, 'S')];
  });
  ok(canTakePile(withPair).ok, 'two naturals will');
});

test('taking the pile still has to clear the opening minimum', () => {
  const top = c(8, 'H');
  const pair = [c(8, 'S'), c(8, 'D')];
  const s = rig((x) => {
    x.frozen = false;
    x.discard = [c(9, 'H'), top];
    x.players[0].hand = [...pair, c(9, 'S')];
  });
  throws(() => applyMove(s, { type: 'takePile', groups: [ids(top, ...pair)] }), 'must be worth 50',
    'three eights is 30');
});

test('a second meld can ride along to clear the opening minimum', () => {
  const top = c(8, 'H');
  const pair = [c(8, 'S'), c(8, 'D')];
  const kings = [c(13, 'S'), c(13, 'H'), c(13, 'D')];
  const s = rig((x) => {
    x.frozen = false;
    x.discard = [c(9, 'H'), c(5, 'C'), top];
    x.players[0].hand = [...pair, ...kings, c(9, 'S')];
  });
  // Three eights alone is 30, which is short. The kings make up the rest.
  const after = applyMove(s, {
    type: 'takePile',
    groups: [ids(...kings), ids(top, ...pair)],
  });
  eq(after.teams[0].melds[8].length, 3, 'the eights went down');
  eq(after.teams[0].melds[13].length, 3, 'and the kings alongside them');
  eq(after.discard.length, 0, 'the pile was taken');
});

test('the pile can be taken by adding the top card to a meld already down', () => {
  const top = c(8, 'H');
  const s = rig((x) => {
    x.frozen = false;
    x.discard = [c(9, 'H'), c(5, 'C'), top];
    x.teams[0].melds[8] = [c(8, 'S'), c(8, 'D'), c(8, 'C')];
    x.teams[0].hasMelded = true;
    x.players[0].hand = [c(4, 'S'), c(9, 'S')];
  });
  eq(canTakePile(s).mode, 'add-to-meld');
  // Nothing is spent from hand: the top card simply joins the eights.
  const after = applyMove(s, { type: 'takePile', groups: [{ to: 8, cards: ids(top) }] });
  eq(after.teams[0].melds[8].length, 4);
  eq(after.players[0].hand.length, 4, 'two cards held plus the two from the pile');
});

test('the top card of the pile must be melded straight away', () => {
  const top = c(ACE, 'H');
  const kings = [c(13, 'S'), c(13, 'H'), c(13, 'D'), c(13, 'C')];
  const s = rig((x) => {
    x.frozen = false;
    x.discard = [c(9, 'H'), top];
    x.players[0].hand = [...kings, c(ACE, 'S'), c(ACE, 'D')];
  });
  throws(() => applyMove(s, { type: 'takePile', groups: [ids(...kings)] }), 'straight away');
});

test('discarding a wild freezes the pile', () => {
  const wild = joker();
  let s = rig((x) => { x.phase = 'play'; x.frozen = false; x.players[0].hand = [wild, c(9, 'S')]; });
  s = applyMove(s, { type: 'discard', card: wild.id });
  ok(s.frozen, 'the pile is frozen behind a wild');
});

test('taking the pile clears the freeze', () => {
  const top = c(ACE, 'H');
  const pair = [c(ACE, 'S'), c(ACE, 'D')];
  const s = rig((x) => {
    x.frozen = true;
    x.discard = [c(9, 'H'), top];
    x.players[0].hand = [...pair, c(9, 'S')];
  });
  const after = applyMove(s, { type: 'takePile', groups: [ids(top, ...pair)] });
  no(after.frozen, 'a taken pile starts fresh');
});

// ------------------------------------------------------------ going out

test('going out needs a canasta', () => {
  const last = c(9, 'S');
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].hasMelded = true;
    x.teams[0].melds[8] = [c(8, 'S'), c(8, 'H'), c(8, 'D')];   // only three
    x.players[0].hand = [last];
  });
  no(hasCanasta(s.teams[0]), 'three is not a canasta');
  throws(() => applyMove(s, { type: 'discard', card: last.id }), 'canasta');
});

test('a canasta lets you go out and ends the hand', () => {
  const last = c(9, 'S');
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].hasMelded = true;
    x.teams[0].melds[8] = Array.from({ length: 7 }, () => c(8, 'S'));
    x.players[0].hand = [last];
    x.players.forEach((p, i) => { if (i > 0) p.hand = []; });
  });
  eq(teamCanastas(s.teams[0]).length, 1);
  const after = applyMove(s, { type: 'discard', card: last.id });
  ok(after.handOver, 'the hand is over');
  eq(after.outPlayer, 0);
  ok(after.lastHandScores[0].goOut > 0, 'the going-out bonus was paid');
});

test('melding your last card goes out too', () => {
  const aces = [c(ACE, 'S'), c(ACE, 'H'), c(ACE, 'D')];
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].hasMelded = true;
    x.teams[0].melds[8] = Array.from({ length: 7 }, () => c(8, 'S'));
    x.players[0].hand = [...aces];
    x.players.forEach((p, i) => { if (i > 0) p.hand = []; });
  });
  const after = applyMove(s, { type: 'meld', groups: [ids(...aces)] });
  ok(after.handOver, 'the hand ended on the meld');
});

test('black threes go down only as you go out', () => {
  const threes = [c(THREE, 'S'), c(THREE, 'C'), c(THREE, 'S')];
  const blocked = rig((x) => {
    x.phase = 'play';
    x.teams[0].hasMelded = true;
    x.players[0].hand = [...threes, c(9, 'S')];
  });
  throws(() => applyMove(blocked, { type: 'meld', groups: [ids(...threes)] }), 'go out');

  const going = rig((x) => {
    x.phase = 'play';
    x.teams[0].hasMelded = true;
    x.teams[0].melds[8] = Array.from({ length: 7 }, () => c(8, 'S'));
    x.players[0].hand = [...threes];
    x.players.forEach((p, i) => { if (i > 0) p.hand = []; });
  });
  ok(applyMove(going, { type: 'meld', groups: [ids(...threes)] }).handOver, 'allowed on the way out');
});

// ------------------------------------------------------------ scoring

test('a natural canasta is worth 500 on top of its cards', () => {
  const s = rig((x) => {
    x.teams[0].hasMelded = true;
    x.teams[0].melds[8] = Array.from({ length: 7 }, () => c(8, 'S'));
    x.players.forEach((p) => { p.hand = []; });
  });
  const score = scoreTeam(s, s.teams[0], { wentOut: false, concealed: false });
  eq(score.melded, 70, 'seven eights');
  eq(score.bonuses, 500, 'natural canasta');
  eq(score.total, 570);
});

test('cards left in hand are deducted', () => {
  const s = rig((x) => {
    x.teams[0].hasMelded = true;
    x.teams[0].melds[8] = Array.from({ length: 7 }, () => c(8, 'S'));
    x.players[0].hand = [joker(), c(ACE, 'S')];    // 50 + 20
    x.players[2].hand = [];
    x.players[1].hand = []; x.players[3].hand = [];
  });
  const score = scoreTeam(s, s.teams[0], { wentOut: false, concealed: false });
  eq(score.inHand, -70);
  eq(score.total, 70 + 500 - 70);
});

test('red threes pay 100 each, and 800 for all four', () => {
  const two = rig((x) => {
    x.teams[0].hasMelded = true;
    x.teams[0].redThrees = [c(THREE, 'H'), c(THREE, 'D')];
  });
  eq(redThreeScore(two, two.teams[0]), 200);

  const all = rig((x) => {
    x.teams[0].hasMelded = true;
    x.teams[0].redThrees = [c(THREE, 'H'), c(THREE, 'D'), c(THREE, 'H'), c(THREE, 'D')];
  });
  eq(redThreeScore(all, all.teams[0]), 800, 'the full set');
});

test('red threes count against a partnership that never melded', () => {
  const s = rig((x) => {
    x.teams[0].hasMelded = false;
    x.teams[0].redThrees = [c(THREE, 'H'), c(THREE, 'D')];
  });
  eq(redThreeScore(s, s.teams[0]), -200, 'a penalty without a meld');
});

test('going out having melded nothing before pays the concealed bonus', () => {
  // Seven aces and a black three, all laid in one turn by a side with nothing
  // on the table: that is a concealed hand.
  const aces = Array.from({ length: 7 }, (_, i) => c(ACE, 'SHDC'[i % 4]));
  const s = rig((x) => {
    x.phase = 'play';
    x.players[0].hand = [...aces];
    x.players.forEach((p, i) => { if (i > 0) p.hand = []; });
  });
  const after = applyMove(s, { type: 'meld', groups: [ids(...aces)] });
  ok(after.handOver, 'the hand ended');
  eq(after.lastHandScores[0].goOut, 200, 'concealed pays double');
});

test('going out after melding on an earlier turn pays the plain bonus', () => {
  const last = c(9, 'S');
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].hasMelded = true;                 // melded on some previous turn
    x.openedThisTurn = false;
    x.teams[0].melds[ACE] = Array.from({ length: 7 }, () => c(ACE, 'S'));
    x.players[0].hand = [last];
    x.players.forEach((p, i) => { if (i > 0) p.hand = []; });
  });
  const after = applyMove(s, { type: 'discard', card: last.id });
  eq(after.lastHandScores[0].goOut, 100, 'not concealed');
});

test('an opponent melding does not affect the concealed bonus', () => {
  const aces = Array.from({ length: 7 }, (_, i) => c(ACE, 'SHDC'[i % 4]));
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[1].hasMelded = true;                 // the other side is well underway
    x.teams[1].melds[9] = [c(9, 'S'), c(9, 'H'), c(9, 'D')];
    x.players[0].hand = [...aces];
    x.players.forEach((p, i) => { if (i > 0) p.hand = []; });
  });
  const after = applyMove(s, { type: 'meld', groups: [ids(...aces)] });
  eq(after.lastHandScores[0].goOut, 200, 'still concealed');
});

test('hand scores are banked and the minimum is recalculated', () => {
  const last = c(9, 'S');
  const s = rig((x) => {
    x.phase = 'play';
    x.teams[0].hasMelded = true;
    x.teams[0].melds[ACE] = Array.from({ length: 7 }, () => c(ACE, 'S'));  // 140 + 500
    x.players[0].hand = [last];
    x.players.forEach((p, i) => { if (i > 0) p.hand = []; });
  });
  const after = applyMove(s, { type: 'discard', card: last.id });
  ok(after.teams[0].score >= 740, `banked ${after.teams[0].score}`);
  eq(after.teams[0].minimum, 50, 'still under 1500');
});

// Rules audit against Classic Canasta, 20 Aug 2026.
//
// Each case here was written to fail first, against a rule the engine got
// wrong. They are kept as regression cover.

import { test, eq, ok, no, section } from './harness.js';
import { THREE, DEUCE, JOKER } from '../src/engine/cards.js';
import { createGame, applyMove, canTakePile } from '../src/engine/game.js';

section('Rules audit');

let seq = 0;
const c = (rank, suit = 'S') => ({ id: `a${seq++}`, rank, suit });
const ids = (...cards) => cards.map((x) => x.id);

// A red three buried in the pile is still a bonus card. Taking the pile must
// bank it, not deal it into the taker's hand where it would score against them.
test('a red three buried in the discard pile is banked, not taken into hand', () => {
  const s = createGame({ seed: 1 });
  const redThree = c(THREE, 'H');
  const top = c(5, 'D');
  s.discard = [redThree, c(9, 'C'), top];
  s.frozen = false;
  s.teams[0].hasMelded = true;   // past the opening minimum; not what this case is about

  const mine = [c(5, 'S'), c(5, 'C')];
  s.players[0].hand = [...mine, c(8, 'H'), c(12, 'S')];
  s.turn = 0;
  s.phase = 'draw';

  const next = applyMove(s, { type: 'takePile', groups: [ids(...mine, top)] });

  const strays = next.players[0].hand.filter((x) => x.id === redThree.id);
  eq(strays.length, 0, 'the red three should not be sitting in the hand');
  eq(next.teams[0].redThrees.length, 1, 'the red three should be banked to the team');
});

// Going out with a final discard is still going out, so black threes may go
// down on that turn even though one card stays in hand for the discard.
test('black threes can be melded when going out with a final discard', () => {
  const s = createGame({ seed: 2, config: { canastasToGoOut: 1 } });
  const blacks = [c(THREE, 'S'), c(THREE, 'C'), c(THREE, 'S')];
  const last = c(9, 'H');

  s.teams[0].melds = { 5: [c(5, 'S'), c(5, 'H'), c(5, 'D'), c(5, 'C'), c(5, 'S'), c(5, 'H'), c(5, 'D')] };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [...blacks, last];
  s.turn = 0;
  s.phase = 'play';

  const melded = applyMove(s, { type: 'meld', groups: [ids(...blacks)] });
  eq(melded.teams[0].melds.B3.length, 3, 'the black threes went down');

  const out = applyMove(melded, { type: 'discard', card: last.id });
  ok(out.handOver, 'discarding the last card goes out');
  eq(out.outPlayer, 0);
});

// ------------------------------------------------ the stock running out

// Rigs a state with an empty stock, a chosen top card and a chosen hand.
function stockGone({ top, hand, melds = null }) {
  const s = createGame({ seed: 3 });
  s.stock = [];
  s.discard = [c(9, 'C'), top];
  s.frozen = false;
  s.players[0].hand = hand;
  s.turn = 0;
  s.phase = 'draw';
  if (melds) { s.teams[0].melds = melds; s.teams[0].hasMelded = true; }
  return s;
}

test('with the stock gone and the pile useless, the hand ends and nobody is out', () => {
  const s = stockGone({ top: c(9, 'D'), hand: [c(5, 'S'), c(12, 'H')] });
  const next = applyMove(s, { type: 'draw' });
  ok(next.handOver, 'the hand ended');
  eq(next.outPlayer, null, 'nobody went out');
});

test('with the stock gone, a player who can take the pile may not just draw', () => {
  const s = stockGone({ top: c(9, 'D'), hand: [c(9, 'S'), c(9, 'H'), c(12, 'H')] });
  let message = '';
  try { applyMove(s, { type: 'draw' }); } catch (e) { message = e.message; }
  ok(message.includes('stock is gone'), `expected the stock message, got: ${message}`);
});

test('with the stock gone, passing up a takeable pile ends the hand', () => {
  const s = stockGone({ top: c(9, 'D'), hand: [c(9, 'S'), c(9, 'H'), c(12, 'H')] });
  const next = applyMove(s, { type: 'pass' });
  ok(next.handOver, 'the hand ended');
  eq(next.outPlayer, null);
});

test('with the stock gone, a pile that fits your own meld is compulsory', () => {
  const s = stockGone({
    top: c(9, 'D'),
    hand: [c(12, 'H'), c(4, 'S')],
    melds: { 9: [c(9, 'S'), c(9, 'H'), c(9, 'C')] },
  });
  let message = '';
  try { applyMove(s, { type: 'pass' }); } catch (e) { message = e.message; }
  ok(message.includes('compulsory'), `expected a refusal to pass, got: ${message}`);
});

test('while the stock holds cards, passing is not a legal move', () => {
  const s = createGame({ seed: 4 });
  let message = '';
  try { applyMove(s, { type: 'pass' }); } catch (e) { message = e.message; }
  ok(message.includes('stock still has cards'), `got: ${message}`);
});

// ------------------------------------------------ asking to go out

// A player one card from out, whose side already has a canasta.
function readyToGoOut() {
  // About asking a partner, not about the house minimum, so one canasta.
  const s = createGame({ seed: 5, config: { canastasToGoOut: 1 } });
  const last = c(9, 'H');
  s.teams[0].melds = { 5: [c(5, 'S'), c(5, 'H'), c(5, 'D'), c(5, 'C'), c(5, 'S'), c(5, 'H'), c(5, 'D')] };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [last];
  s.turn = 0;
  s.phase = 'play';
  return { s, last };
}

test('a partner who says no stops you going out this turn', () => {
  const { s, last } = readyToGoOut();
  const asked = applyMove(s, { type: 'askPartner' });
  eq(asked.permission.asker, 0);
  eq(asked.permission.partner, 2, 'the partner sits opposite');

  const answered = applyMove(asked, { type: 'answerPartner', yes: false });
  eq(answered.permission.answer, 'no');

  let message = '';
  try { applyMove(answered, { type: 'discard', card: last.id }); } catch (e) { message = e.message; }
  ok(message.includes('said no'), `expected the refusal to bind, got: ${message}`);
});

test('a partner who says yes lets you go out', () => {
  const { s, last } = readyToGoOut();
  const asked = applyMove(s, { type: 'askPartner' });
  const answered = applyMove(asked, { type: 'answerPartner', yes: true });
  const out = applyMove(answered, { type: 'discard', card: last.id });
  ok(out.handOver, 'the hand ended');
  eq(out.outPlayer, 0);
});

test('you only get to ask once, and only after drawing', () => {
  const { s } = readyToGoOut();
  const asked = applyMove(s, { type: 'askPartner' });
  let message = '';
  try { applyMove(asked, { type: 'askPartner' }); } catch (e) { message = e.message; }
  ok(message.includes('already asked'), `got: ${message}`);

  const early = createGame({ seed: 6 });
  let second = '';
  try { applyMove(early, { type: 'askPartner' }); } catch (e) { second = e.message; }
  ok(second.includes('after you have drawn'), `got: ${second}`);
});

// ------------------------------------------------ moves made over a network

test('a move stamped with the wrong seat is refused', () => {
  const s = createGame({ seed: 9 });          // North to play
  let message = '';
  try { applyMove(s, { type: 'draw', by: 2 }); } catch (e) { message = e.message; }
  ok(message.includes("turn"), `expected a turn complaint, got: ${message}`);

  const fine = applyMove(s, { type: 'draw', by: 0 });
  eq(fine.phase, 'play', 'the seat whose turn it is may play');
});

test('an unstamped move is still accepted, so a local game needs no seats', () => {
  const s = createGame({ seed: 9 });
  eq(applyMove(s, { type: 'draw' }).phase, 'play');
});

test('only the partner who was asked may answer', () => {
  const { s } = readyToGoOut();
  const asked = applyMove(s, { type: 'askPartner', by: 0 });
  let message = '';
  try { applyMove(asked, { type: 'answerPartner', yes: true, by: 1 }); } catch (e) { message = e.message; }
  ok(message.includes('partner who was asked'), `got: ${message}`);

  const proper = applyMove(asked, { type: 'answerPartner', yes: true, by: 2 });
  eq(proper.permission.answer, 'yes');
});

// Found by four computers playing a hundred hands: a frozen pile, the stock
// gone, and the top card matching a meld the player's own side had down. The
// pile was compulsory and simultaneously impossible to take, which left the
// player no legal move whatsoever.
test('a frozen pile you cannot take is not compulsory, however well it fits', () => {
  const s = createGame({ seed: 21 });
  s.stock = [];
  s.frozen = true;
  const top = c(9, 'D');
  s.discard = [c(4, 'S'), top];
  s.teams[0].melds = { 9: [c(9, 'S'), c(9, 'H'), c(9, 'C')] };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [c(12, 'H'), c(9, 'S')];   // one natural nine, not two
  s.turn = 0;
  s.phase = 'draw';

  const next = applyMove(s, { type: 'pass' });
  ok(next.handOver, 'passing was allowed and the hand ended');
  eq(next.outPlayer, null);
});

// ------------------------------------------------ drawing two from the stock

test('a turn draws two cards from the stock', () => {
  const s = createGame({ seed: 31 });
  const before = s.players[0].hand.length;
  const next = applyMove(s, { type: 'draw' });
  eq(next.players[0].hand.length, before + 2, 'two cards came across');
  eq(next.phase, 'play');
});

test('a red three among the two is banked and replaced, so two still arrive', () => {
  const s = createGame({ seed: 32 });
  const before = s.players[0].hand.length;
  const banked = s.teams[0].redThrees.length;
  // The stock is drawn from the end, so this deals 8S, then a red three, then 9C.
  s.stock = [c(9, 'C'), c(THREE, 'H'), c(8, 'S')];
  s.turn = 0;
  s.phase = 'draw';

  const next = applyMove(s, { type: 'draw' });
  eq(next.players[0].hand.length, before + 2, 'still two cards in hand');
  eq(next.teams[0].redThrees.length, banked + 1, 'and the three went to the bank');
  eq(next.stock.length, 0, 'which took the last of the stock');
});

test('a stock with one card left gives up that card and play carries on', () => {
  const s = createGame({ seed: 33 });
  const before = s.players[0].hand.length;
  s.stock = [c(8, 'S')];
  s.turn = 0;
  s.phase = 'draw';

  const next = applyMove(s, { type: 'draw' });
  no(next.handOver, 'one card short is not the end of the hand');
  eq(next.players[0].hand.length, before + 1, 'the player took what there was');
  eq(next.phase, 'play');
});

test('the classic single draw is still there for the asking', () => {
  const s = createGame({ seed: 34, config: { drawCount: 1 } });
  const before = s.players[0].hand.length;
  eq(applyMove(s, { type: 'draw' }).players[0].hand.length, before + 1);
});

// ------------------------------------- going out, and what it costs the others

// Seven of a rank is a canasta. Natural unless a wild is asked for.
const canasta = (rank, { wild = false } = {}) => {
  const cards = [];
  for (let i = 0; i < (wild ? 6 : 7); i++) cards.push(c(rank, i % 2 ? 'H' : 'S'));
  if (wild) cards.push(c(DEUCE, 'D'));
  return cards;
};

test('one canasta is no longer enough to go out', () => {
  const s = createGame({ seed: 41 });
  const last = c(9, 'H');
  s.teams[0].melds = { 5: canasta(5) };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [last];
  s.turn = 0;
  s.phase = 'play';

  let message = '';
  try { applyMove(s, { type: 'discard', card: last.id }); } catch (e) { message = e.message; }
  ok(message.includes('2 canastas'), `expected the two-canasta rule, got: ${message}`);
});

test('two canastas and you are away', () => {
  const s = createGame({ seed: 42 });
  const last = c(9, 'H');
  s.teams[0].melds = { 5: canasta(5), 8: canasta(8) };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [last];
  s.turn = 0;
  s.phase = 'play';

  const out = applyMove(s, { type: 'discard', card: last.id });
  ok(out.handOver, 'the hand ended');
  eq(out.outPlayer, 0);
});

// Builds a finished hand: seat 0 goes out, and the other side is caught with
// `holding` worth of cards over `melded` on the table plus whatever canastas.
function caughtWith({ holding, tableRank = 4, canastas = [] }) {
  const s = createGame({ seed: 43 });
  s.teams[0].melds = { 5: canasta(5), 8: canasta(8) };
  s.teams[0].hasMelded = true;

  const melds = {};
  for (const rank of canastas) melds[rank] = canasta(rank);
  melds[tableRank] = [c(tableRank, 'S'), c(tableRank, 'H'), c(tableRank, 'D')];
  s.teams[1].melds = melds;
  s.teams[1].hasMelded = true;

  s.teams[0].redThrees = [];
  s.teams[1].redThrees = [];
  s.players[1].hand = holding;
  s.players[3].hand = [];
  s.players[2].hand = [];
  s.players[0].hand = [c(9, 'H')];
  s.turn = 0;
  s.phase = 'play';
  return applyMove(s, { type: 'discard', card: s.players[0].hand[0].id });
}

test('leftover cards come off the table, not off the bottom of the column', () => {
  // Three fours on the table is 15. Caught holding a king, worth 10.
  const out = caughtWith({ holding: [c(13, 'S')] });
  const losers = out.lastHandScores[1];
  eq(losers.melded, 15, 'the table is still reported in full');
  eq(losers.cost, -10, 'and the ten it cost is shown against it');
  eq(losers.broken, 0, 'no canasta needed breaking');
  eq(losers.total, 5, '15 on the table less the 10 in hand');
});

test('a canasta is broken to cover what the table cannot, and its whole bonus goes', () => {
  // 15 on the table plus a natural canasta of nines, and caught holding 100.
  const out = caughtWith({ holding: [c(1, 'S'), c(1, 'H'), c(1, 'D'), c(1, 'C'), c(13, 'S')], canastas: [9] });
  const losers = out.lastHandScores[1];

  eq(-losers.inHand, 90, 'four aces and a king');
  eq(losers.broken, 1, 'the canasta was broken');
  // 15 of table points, then the canasta's whole 500 for the remaining 75.
  // 15 in fours plus the canasta's own seventy in nines is 85 of table points,
  // then the canasta's whole 500 to cover the last five.
  eq(losers.melded, 85, 'the fours and the nines');
  eq(losers.cost, -585, 'the table paid 85 and the canasta paid all 500 of itself');
  // Reported table and bonus stay whole; the cost carries the damage.
  eq(losers.total, losers.melded + losers.bonuses + losers.redThrees + losers.cost);
  eq(losers.total, 0, '85 + 500 - 585');
});

test('the side that went out is not punished this way', () => {
  const out = caughtWith({ holding: [c(13, 'S')] });
  const winners = out.lastHandScores[0];
  eq(winners.caught, false);
  eq(winners.cost, -0, 'their own hands were empty');
  ok(winners.total > 1000, `two canastas and the going-out bonus: ${winners.total}`);
});

test('a dead deck catches both sides, not neither', () => {
  const s = createGame({ seed: 44 });
  s.stock = [];
  s.discard = [c(9, 'D')];
  s.frozen = true;
  s.players[0].hand = [c(13, 'S'), c(12, 'H')];
  s.turn = 0;
  s.phase = 'draw';

  const out = applyMove(s, { type: 'draw' });
  ok(out.handOver, 'the hand ended with nobody out');
  eq(out.outPlayer, null);
  for (const side of out.lastHandScores) eq(side.caught, true, 'both sides pay out of the table');
});

test('on a dead deck each side pays for its own hand out of its own table', () => {
  const s = createGame({ seed: 45 });
  s.stock = [];
  s.discard = [c(9, 'D')];
  s.frozen = true;                       // and nobody holds two natural nines
  s.teams[0].redThrees = [];
  s.teams[1].redThrees = [];

  // One side has fifteen on the table and is caught holding ten.
  s.teams[0].melds = { 4: [c(4, 'S'), c(4, 'H'), c(4, 'D')] };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [c(13, 'S')];
  s.players[2].hand = [];

  // The other never melded at all, and is caught holding a hundred.
  s.players[1].hand = [c(1, 'S'), c(1, 'H'), c(1, 'D'), c(1, 'C'), c(8, 'S'), c(8, 'H')];
  s.players[3].hand = [];

  s.turn = 0;
  s.phase = 'draw';
  const out = applyMove(s, { type: 'draw' });

  const [melders, holders] = out.lastHandScores;
  eq(melders.cost, -10, 'the king came off their table');
  eq(melders.total, 5, '15 on the table less the 10 in hand');

  // A side with nothing on the table pays anyway, and goes under.
  eq(-holders.inHand, 100, 'four aces and two eights');
  eq(holders.cost, -100, 'the whole hundred is charged');
  eq(holders.total, -100, 'and takes them negative');
});

test('a debt bigger than everything on the table takes the score under', () => {
  // Fifteen on the table, no canasta to break, and caught holding a hundred.
  const out = caughtWith({ holding: [c(1, 'S'), c(1, 'H'), c(1, 'D'), c(1, 'C'), c(8, 'S'), c(8, 'H')] });
  const losers = out.lastHandScores[1];
  eq(losers.melded, 15);
  eq(losers.broken, 0, 'there was no canasta to break');
  eq(losers.cost, -100, 'the whole hand is charged, not just what the table could bear');
  eq(losers.total, -85, '15 on the table less 100 in hand');
});

test('breaking a canasta costs the whole bonus, and only the overshoot is extra', () => {
  // 85 of table points and a natural canasta, caught holding 90. The table
  // pays 85, the canasta is broken for the last 5, and 495 of it is wasted.
  const out = caughtWith({ holding: [c(1, 'S'), c(1, 'H'), c(1, 'D'), c(1, 'C'), c(13, 'S')], canastas: [9] });
  const losers = out.lastHandScores[1];
  eq(-losers.inHand, 90);
  eq(losers.broken, 1);
  eq(losers.cost, -585, '90 owed plus the 495 of the canasta nobody needed');
  eq(losers.total, 0, '85 + 500 - 585');
});

// ------------------------------------------------ freezing, reported from play

// Rigs the exact sequence described: a wild is discarded to freeze the pile,
// the next player throws an ordinary card onto it, and the player after that
// tries to take it.
function frozenThenDiscarded({ freezeWith, thenDiscard, holding }) {
  const s = createGame({ seed: 51 });
  s.discard = [c(6, 'C'), c(10, 'D')];      // a couple of cards already down
  s.frozen = false;
  s.turn = 0;
  s.phase = 'play';
  s.players[0].hand = [freezeWith, c(8, 'S'), c(9, 'S')];

  // Seat 0 freezes it.
  let next = applyMove(s, { type: 'discard', card: freezeWith.id, by: 0 });

  // Seat 1 draws and throws the next card on top.
  next.players[1].hand = [thenDiscard, c(12, 'S'), c(11, 'S')];
  next.phase = 'play';
  next = applyMove(next, { type: 'discard', card: thenDiscard.id, by: 1 });

  // Seat 2 comes to it holding whatever we were given.
  next.players[2].hand = holding;
  return next;
}

test('a wild card discarded freezes the pile and blocks it outright', () => {
  const after = frozenThenDiscarded({
    freezeWith: c(DEUCE, 'H'), thenDiscard: c(7, 'S'), holding: [],
  });
  ok(after.frozen, 'the pile is frozen');
});

test('a frozen pile will not go to one natural card and a wild', () => {
  const after = frozenThenDiscarded({
    freezeWith: c(DEUCE, 'H'),
    thenDiscard: c(7, 'S'),
    holding: [c(7, 'H'), c(JOKER, 'X'), c(12, 'D')],   // one seven and a joker
  });
  const check = canTakePile(after, 2);
  no(check.ok, `expected a refusal, got: ${JSON.stringify(check)}`);
  ok(check.reason.includes('frozen'), check.reason);
});

test('a frozen pile goes only to two natural cards of the rank', () => {
  const after = frozenThenDiscarded({
    freezeWith: c(DEUCE, 'H'),
    thenDiscard: c(7, 'S'),
    holding: [c(7, 'H'), c(7, 'D'), c(12, 'D')],
  });
  const check = canTakePile(after, 2);
  ok(check.ok, `two natural sevens should take it: ${JSON.stringify(check)}`);
  eq(check.mode, 'frozen-pair');
});

test('a frozen pile is not opened by a meld your side already has', () => {
  // Unfrozen, a matching meld on the table takes the pile with nothing in hand.
  // Frozen, it must not.
  const after = frozenThenDiscarded({
    freezeWith: c(DEUCE, 'H'),
    thenDiscard: c(7, 'S'),
    holding: [c(12, 'D')],
  });
  after.teams[0].melds = { 7: [c(7, 'S'), c(7, 'H'), c(7, 'C')] };
  after.teams[0].hasMelded = true;

  const check = canTakePile(after, 2);   // seat 2 is on team 0
  no(check.ok, `a frozen pile must stay shut: ${JSON.stringify(check)}`);
});

test('two deuces in hand do not take a deuce off the top of the pile', () => {
  const after = frozenThenDiscarded({
    freezeWith: c(9, 'C'),                 // freeze is irrelevant here
    thenDiscard: c(DEUCE, 'S'),            // a wild sits on top
    holding: [c(DEUCE, 'H'), c(DEUCE, 'D'), c(12, 'D')],
  });
  const check = canTakePile(after, 2);
  no(check.ok, `a wild on top blocks the pile: ${JSON.stringify(check)}`);
  ok(check.reason.includes('wild'), check.reason);
});

// -------------------------------------------------------- the action log

test('the log says how the pile was won, and never what was drawn', () => {
  const s = createGame({ seed: 61 });
  s.discard = [c(6, 'C'), c(7, 'D')];
  s.frozen = true;
  s.teams[0].hasMelded = true;   // past the opening minimum; not what this tests
  s.players[0].hand = [c(7, 'H'), c(7, 'S'), c(12, 'D'), c(11, 'S')];
  s.turn = 0;
  s.phase = 'draw';

  const after = applyMove(s, {
    type: 'takePile', by: 0,
    groups: [[s.players[0].hand[0].id, s.players[0].hand[1].id, s.discard[1].id]],
  });

  const entry = after.log[after.log.length - 1].move;
  eq(entry.type, 'takePile');
  eq(entry.mode, 'frozen-pair', 'it records that a frozen pile was taken with two naturals');
  eq(entry.count, 2, 'and how many cards came across');
  eq(entry.top, '7D', 'and which card was on top');
});

test('the log marks the discard that freezes the pile', () => {
  const s = createGame({ seed: 62 });
  const wild = c(DEUCE, 'H');
  s.players[0].hand = [wild, c(9, 'S'), c(10, 'S')];
  s.turn = 0;
  s.phase = 'play';

  const after = applyMove(s, { type: 'discard', card: wild.id, by: 0 });
  const entry = after.log[after.log.length - 1].move;
  eq(entry.type, 'discard');
  eq(entry.card, '2H');
  eq(entry.froze, true, 'the freeze is recorded so the board can say so');
});

test('a draw reports its count and its red threes, never its cards', () => {
  const s = createGame({ seed: 63 });
  const after = applyMove(s, { type: 'draw', by: 0 });
  const entry = after.log[after.log.length - 1].move;
  eq(entry.type, 'draw');
  eq(entry.cards, 2, 'two drawn');
  ok('reds' in entry, 'red threes are counted');
  // The whole point: nothing in here identifies a card that went into a hand.
  no(JSON.stringify(entry).includes('id'), 'no card identity leaks into the log');
});

// ------------------------------------------------------ red threes, replaced

test('a red three dealt into a hand is banked and replaced there and then', () => {
  // Every seat still holds a full hand, and no red three is in any of them.
  for (const seed of [71, 72, 73, 74, 75]) {
    const s = createGame({ seed });
    for (const p of s.players) {
      eq(p.hand.length, s.config.handSize, `seed ${seed}: ${p.name} has a full hand`);
      eq(p.hand.filter((x) => x.rank === THREE && (x.suit === 'H' || x.suit === 'D')).length, 0,
        `seed ${seed}: no red three sitting in ${p.name}'s hand`);
    }
  }
});

test('a red three drawn from the stock is replaced, so the hand still grows by two', () => {
  const s = createGame({ seed: 76 });
  const before = s.players[0].hand.length;
  const banked = s.teams[0].redThrees.length;
  // Drawn from the end: an eight, then a red three, then a nine, then a ten.
  s.stock = [c(10, 'C'), c(9, 'C'), c(THREE, 'D'), c(8, 'S')];
  s.turn = 0;
  s.phase = 'draw';

  const after = applyMove(s, { type: 'draw', by: 0 });
  eq(after.players[0].hand.length, before + 2, 'two real cards arrived');
  eq(after.teams[0].redThrees.length, banked + 1, 'and the three went to the bank');
  eq(after.stock.length, 1, 'three cards left the stock to deliver two');
});

test('a red three taken with the discard pile is banked and NOT replaced', () => {
  const s = createGame({ seed: 77 });
  const redThree = c(THREE, 'H');
  const top = c(5, 'D');
  // The only way a red three reaches the pile: turned up at the start of the
  // hand, and buried when the next card was turned on top of it.
  s.discard = [redThree, top];
  s.frozen = true;
  s.teams[0].hasMelded = true;
  const banked = s.teams[0].redThrees.length;

  const mine = [c(5, 'S'), c(5, 'C')];
  s.players[0].hand = [...mine, c(8, 'H'), c(12, 'S')];
  s.turn = 0;
  s.phase = 'draw';

  const before = s.players[0].hand.length;
  const after = applyMove(s, {
    type: 'takePile', by: 0, groups: [[...mine.map((x) => x.id), top.id]],
  });

  eq(after.teams[0].redThrees.length, banked + 1, 'the three was banked');
  eq(after.players[0].hand.filter((x) => x.id === redThree.id).length, 0, 'and is not in hand');
  // Four in hand, minus the two melded, plus the one other pile card. No
  // replacement card was drawn for the three.
  eq(after.players[0].hand.length, before - 2, 'nothing was drawn to replace it');
  eq(after.stock.length, s.stock.length, 'the stock was never touched');
});

// ------------------------------- taking the pile onto a meld already down

// Reported from play: a side with sevens down, a seven on top of an unfrozen
// pile, and the board refusing with "you do not hold one of those cards".
function pileOntoMeld({ meld, hand, frozen = false }) {
  const s = createGame({ seed: 81 });
  const top = c(7, 'D');
  s.discard = [c(9, 'C'), c(4, 'S'), top];
  s.frozen = frozen;
  s.teams[0].melds = { 7: meld };
  s.teams[0].hasMelded = true;
  s.players[0].hand = hand;
  s.turn = 0;
  s.phase = 'draw';
  return { s, top };
}

test('a seven on the pile goes onto your own sevens, with nothing in hand', () => {
  const { s, top } = pileOntoMeld({
    meld: [c(7, 'S'), c(7, 'H'), c(7, 'C')],
    hand: [c(12, 'D'), c(11, 'S'), c(8, 'H')],
  });

  const check = canTakePile(s, 0);
  ok(check.ok, `the board offers it: ${JSON.stringify(check)}`);
  eq(check.mode, 'add-to-meld');

  const after = applyMove(s, { type: 'takePile', by: 0, groups: [{ to: 7, cards: [top.id] }] });
  eq(after.teams[0].melds[7].length, 4, 'the seven joined the meld');
  eq(after.discard.length, 0, 'and the pile came across');
  eq(after.players[0].hand.length, 3 + 2, 'the other two pile cards are in hand');
});

test('a finished canasta is closed and takes nothing more', () => {
  const canastaOfSevens = [c(7, 'S'), c(7, 'H'), c(7, 'D'), c(7, 'C'), c(7, 'S'), c(7, 'H'), c(7, 'D')];
  const { s, top } = pileOntoMeld({
    meld: canastaOfSevens,
    hand: [c(12, 'D'), c(11, 'S'), c(8, 'H')],
  });

  const check = canTakePile(s, 0);
  no(check.ok, `a closed canasta must not open the pile: ${JSON.stringify(check)}`);

  let message = '';
  try { applyMove(s, { type: 'takePile', by: 0, groups: [{ to: 7, cards: [top.id] }] }); }
  catch (e) { message = e.message; }
  ok(message.length > 0, 'and the move itself is refused');
});

test('a closed canasta of sevens shuts the rank, even holding two sevens', () => {
  const canastaOfSevens = [c(7, 'S'), c(7, 'H'), c(7, 'D'), c(7, 'C'), c(7, 'S'), c(7, 'H'), c(7, 'D')];
  const mine = [c(7, 'S'), c(7, 'C')];
  const { s } = pileOntoMeld({
    meld: canastaOfSevens,
    hand: [...mine, c(12, 'D'), c(8, 'H')],
  });

  // Melds are one to a rank. With the canasta closed there is nowhere for
  // another seven to go, however many are held, so the pile is not available.
  const check = canTakePile(s, 0);
  no(check.ok, `the rank is shut: ${JSON.stringify(check)}`);
  ok(check.reason.includes('closed'), check.reason);
});

test('you cannot quietly add to a closed canasta by melding either', () => {
  const s = createGame({ seed: 82 });
  s.teams[0].melds = { 8: [c(8, 'S'), c(8, 'H'), c(8, 'D'), c(8, 'C'), c(8, 'S'), c(8, 'H'), c(8, 'D')] };
  s.teams[0].hasMelded = true;
  const spare = c(8, 'C');
  s.players[0].hand = [spare, c(12, 'D'), c(11, 'S'), c(4, 'H')];
  s.turn = 0;
  s.phase = 'play';

  let message = '';
  try { applyMove(s, { type: 'meld', by: 0, groups: [{ to: 8, cards: [spare.id] }] }); }
  catch (e) { message = e.message; }
  ok(message.toLowerCase().includes('closed'), `expected the canasta to be closed, got: ${message}`);
});

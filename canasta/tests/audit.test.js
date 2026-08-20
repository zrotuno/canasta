// Rules audit against Classic Canasta, 20 Aug 2026.
//
// Each case here was written to fail first, against a rule the engine got
// wrong. They are kept as regression cover.

import { test, eq, ok, no, section } from './harness.js';
import { THREE } from '../src/engine/cards.js';
import { createGame, applyMove } from '../src/engine/game.js';

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
  const s = createGame({ seed: 2 });
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
  const s = createGame({ seed: 5 });
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

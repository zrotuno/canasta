// A computer Canasta player.
//
// One pure function: given a game and a seat, say what that seat should do.
// It holds no state, touches no network and knows nothing about Firestore,
// which is what lets whole games be played inside the test harness.
//
// It aims to play like a decent club player rather than a champion. It keeps
// pairs together, holds its wild cards for canastas, takes the pile when the
// pile is worth taking, tries not to hand the opposition the rank they are
// collecting, and goes out when going out is on.

import {
  isWild, isNatural, isBlackThree, cardValue,
} from '../engine/cards.js';
import { CANASTA_SIZE, meldError } from '../engine/melds.js';
import {
  canTakePile, mustTakePile, topDiscard, teamIndexOf, canGoOut, applyMove,
} from '../engine/game.js';

// How big a pile has to be before it is worth taking on size alone.
const PILE_WORTH_TAKING = 5;

// A hand this cheap is happy for its partner to go out.
const HAPPY_TO_GO_OUT = 45;

// Cards kept back once the partnership is open, so there is still something to
// take the pile with and something to think about.
const RESERVE = 4;

// Below this much stock the hand is nearly over, and hoarding stops paying.
const ENDGAME = 15;

// ------------------------------------------------------------------ helpers

const handOf = (state, seat) => state.players[seat].hand;
const teamOf = (state, seat) => state.teams[teamIndexOf(seat)];

// Melds are keyed by rank, so a rank is meldable if it is neither wild nor a
// three. Threes never form ordinary melds.
const meldableRank = (card) => isNatural(card);

// Groups the meldable cards of a hand by rank.
function byRank(cards) {
  const out = new Map();
  for (const card of cards) {
    if (!meldableRank(card)) continue;
    if (!out.has(card.rank)) out.set(card.rank, []);
    out.get(card.rank).push(card);
  }
  return out;
}

const wildsOf = (cards) => cards.filter(isWild)
  // Deuces are spent before jokers: both stand in for anything, but a joker is
  // worth fifty and is the better card to be holding at the end.
  .sort((a, b) => cardValue(a) - cardValue(b));

const pointsOf = (cards) => cards.reduce((n, c) => n + cardValue(c), 0);

// ------------------------------------------------------------ laying down

// Every rank the hand could put down on its own, cheapest first. Used when
// opening, where the question is only how to clear the minimum.
function naturalGroups(cards) {
  const out = [];
  for (const [rank, group] of byRank(cards)) {
    if (group.length >= 3) out.push({ rank, cards: group });
  }
  return out.sort((a, b) => pointsOf(b.cards) - pointsOf(a.cards));
}

// Picks groups that together clear the opening minimum, or returns null when
// the hand simply cannot open. Naturals are spent first and wild cards are
// only brought in when the naturals fall short, because a wild held back is
// worth far more later.
function openingPlan(cards, minimum, { alreadyLaid = 0, exclude = new Set() } = {}) {
  const usable = cards.filter((c) => !exclude.has(c.id));
  const chosen = [];
  let points = alreadyLaid;

  for (const group of naturalGroups(usable)) {
    if (points >= minimum) break;
    chosen.push({ to: null, cards: group.cards.map((c) => c.id) });
    points += pointsOf(group.cards);
  }

  if (points < minimum) {
    // Still short. A pair plus a wild card is a legal meld, so spend the
    // cheapest wilds on the most valuable pairs until the bar is cleared.
    const used = new Set(chosen.flatMap((g) => g.cards));
    const spare = wildsOf(usable.filter((c) => !used.has(c.id)));
    const pairs = [...byRank(usable.filter((c) => !used.has(c.id)))]
      .filter(([, group]) => group.length === 2)
      .sort((a, b) => pointsOf(b[1]) - pointsOf(a[1]));

    for (const [, pair] of pairs) {
      if (points >= minimum || spare.length === 0) break;
      const wild = spare.shift();
      chosen.push({ to: null, cards: [...pair.map((c) => c.id), wild.id] });
      points += pointsOf(pair) + cardValue(wild);
    }
  }

  return points >= minimum ? chosen : null;
}

// What to lay down on a turn where the partnership is already open: anything
// that extends a meld on the table, plus any fresh natural triplet.
//
// Wild cards are kept back unless one completes a canasta, which is where the
// points actually are.
function extendingPlan(state, seat) {
  const team = teamOf(state, seat);
  const hand = handOf(state, seat);
  const groups = [];
  const used = new Set();

  for (const [rankKey, meld] of Object.entries(team.melds)) {
    if (rankKey === 'B3') continue;
    const rank = Number(rankKey);
    const matches = hand.filter((c) => c.rank === rank && isNatural(c) && !used.has(c.id));
    if (matches.length === 0) continue;
    matches.forEach((c) => used.add(c.id));
    groups.push({ to: rank, cards: matches.map((c) => c.id) });
  }

  // A wild card that finishes a canasta is worth spending; one that merely
  // pads a meld is not.
  for (const [rankKey, meld] of Object.entries(team.melds)) {
    if (rankKey === 'B3') continue;
    const rank = Number(rankKey);
    const added = groups.find((g) => g.to === rank);
    const size = meld.length + (added ? added.cards.length : 0);
    const short = CANASTA_SIZE - size;
    if (short <= 0 || short > 1) continue;

    const wild = wildsOf(hand.filter((c) => !used.has(c.id)))[0];
    if (!wild) continue;
    if (meldError([...meld, wild])) continue;
    used.add(wild.id);
    if (added) added.cards.push(wild.id);
    else groups.push({ to: rank, cards: [wild.id] });
  }

  for (const group of naturalGroups(hand.filter((c) => !used.has(c.id)))) {
    if (team.melds[group.rank]) continue;
    group.cards.forEach((c) => used.add(c.id));
    groups.push({ to: null, cards: group.cards.map((c) => c.id) });
  }

  return groups;
}

// A partnership without a canasta may not go out, and a player who melds down
// to a single card cannot legally discard it either. So unless going out is
// genuinely available, two cards always stay in hand.
function trimToLegal(state, seat, groups) {
  const hand = handOf(state, seat);
  const team = teamOf(state, seat);
  const laying = groups.reduce((n, g) => n + g.cards.length, 0);
  const left = hand.length - laying;

  if (left === 0 && canGoOut(state, team)) return groups;   // going out, and allowed to

  // Two cards is the legal floor. A player who melds down to it every turn can
  // never take the discard pile again -- that wants two matching cards in hand
  // -- so once the partnership is open the computer keeps a working reserve.
  //
  // The reserve is dropped once the stock is nearly gone: cards held at the
  // end of a hand are deducted rather than banked, and there is no longer time
  // to make anything of them.
  const legalFloor = canGoOut(state, team) ? 1 : 2;
  const hoard = team.hasMelded && state.stock.length > ENDGAME;
  const keep = hoard ? Math.max(legalFloor, RESERVE) : legalFloor;
  if (left >= keep) return groups;

  // Give cards back, cheapest group last, until enough remain in hand.
  const trimmed = [...groups];
  let short = keep - left;
  while (short > 0 && trimmed.length) {
    const group = trimmed[trimmed.length - 1];
    const give = Math.min(short, group.cards.length);
    group.cards = group.cards.slice(0, group.cards.length - give);
    short -= give;
    if (group.cards.length === 0) trimmed.pop();
  }
  // A group of fewer than three cards is only legal onto an existing meld.
  return trimmed.filter((g) => g.to !== null || g.cards.length >= 3);
}

// ---------------------------------------------------------- the discard

// Lower is likelier to be thrown. The numbers are only ever compared with
// each other, so they are chosen for their order rather than their size.
function discardScore(state, seat, card) {
  const hand = handOf(state, seat);
  const team = teamOf(state, seat);
  const opponents = state.teams[1 - teamIndexOf(seat)];
  const sameRank = hand.filter((c) => c.rank === card.rank && c.id !== card.id);

  // A wild card is never thrown away while anything else will do.
  if (isWild(card)) return 10000;

  // A black three cannot be melded until you go out, and sitting on top of the
  // pile it stops the next player taking it. It is the ideal thing to throw,
  // and more so the bigger the pile.
  if (isBlackThree(card)) return -200 - state.discard.length * 2;

  let score = cardValue(card);

  // Keep what the partnership can use.
  if (team.melds[card.rank]) score += 400;
  score += sameRank.length * 60;

  // Do not hand the opposition the rank they are collecting: on an unfrozen
  // pile that gives them the whole thing.
  if (opponents.melds[card.rank]) score += state.frozen ? 60 : 300;

  // A big pile makes every discard more dangerous, so lean harder on ranks
  // nobody has shown an interest in.
  if (state.discard.length >= PILE_WORTH_TAKING && sameRank.length === 0) score -= 20;

  return score;
}

function pickDiscard(state, seat) {
  const hand = handOf(state, seat);
  return [...hand].sort((a, b) => discardScore(state, seat, a) - discardScore(state, seat, b))[0];
}

// ------------------------------------------------------------ the pile

// The cards that would have to go down to claim the top card, or null if the
// pile cannot be taken at all. Includes any extra melds needed to open.
function pileGroups(state, seat) {
  const top = topDiscard(state);
  const hand = handOf(state, seat);
  const team = teamOf(state, seat);
  const naturals = hand.filter((c) => c.rank === top.rank && isNatural(c));
  const wilds = wildsOf(hand);

  let topGroup = null;
  if (!state.frozen && team.melds[top.rank]) {
    topGroup = { to: top.rank, cards: [top.id] };
  } else if (naturals.length >= 2) {
    topGroup = { to: null, cards: [top.id, naturals[0].id, naturals[1].id] };
  } else if (!state.frozen && naturals.length >= 1 && wilds.length >= 1) {
    topGroup = { to: null, cards: [top.id, naturals[0].id, wilds[0].id] };
  }
  if (!topGroup) return null;

  if (team.hasMelded) return [topGroup];

  // Opening on the pile: only the top card and cards from hand count toward
  // the minimum, so the rest of the meld may have to come from hand as well.
  const used = new Set(topGroup.cards);
  const laid = pointsOf([top, ...hand.filter((c) => used.has(c.id))]);
  if (laid >= team.minimum) return [topGroup];

  const extra = openingPlan(hand, team.minimum, { alreadyLaid: laid, exclude: used });
  return extra ? [...extra, topGroup] : null;
}

// Taking the pile is the biggest swing in Canasta, but a pile of two is not
// worth unfreezing yourself for.
function worthTakingPile(state, seat, groups) {
  if (mustTakePile(state, seat)) return true;

  const team = teamOf(state, seat);
  const pile = state.discard.length;
  const laying = groups.reduce((n, g) => n + g.cards.length, 0);

  if (!team.hasMelded) return true;              // opening on the pile is always good
  if (pile >= PILE_WORTH_TAKING) return true;
  return laying >= 3 && pile >= 3;
}

// ------------------------------------------------------------------ moves

// Would this seat be glad for its partner to go out? A cheap hand costs
// nothing when the hand ends; an expensive one is a reason to say wait.
function willingToGoOut(state, seat) {
  const hand = handOf(state, seat);
  return pointsOf(hand) <= HAPPY_TO_GO_OUT || hand.length <= 3;
}

function chooseDraw(state, seat) {
  const check = canTakePile(state, seat);
  if (check.ok) {
    const groups = pileGroups(state, seat);
    if (groups && worthTakingPile(state, seat, groups)) return { type: 'takePile', groups };
  }
  // With the stock gone and the pile refused, the hand ends here.
  if (state.stock.length === 0) return { type: 'pass' };
  return { type: 'draw' };
}

function choosePlay(state, seat) {
  const team = teamOf(state, seat);
  const hand = handOf(state, seat);

  const plan = team.hasMelded
    ? extendingPlan(state, seat)
    : (openingPlan(hand, team.minimum) ?? []);

  const groups = trimToLegal(state, seat, plan);

  // Holding cards back can pull an opening meld under the minimum again, and
  // an opening that falls short is refused outright, so it waits a turn.
  if (groups.length && !team.hasMelded) {
    const laid = groups.reduce((n, g) => n
      + pointsOf(g.cards.map((id) => hand.find((c) => c.id === id)).filter(Boolean)), 0);
    if (laid < team.minimum) return { type: 'discard', card: pickDiscard(state, seat).id };
  }

  if (groups.length) return { type: 'meld', groups };

  return { type: 'discard', card: pickDiscard(state, seat).id };
}

// What the computer actually plays.
//
// Whatever this returns is about to be written into a log that every phone at
// the table replays, so a move the engine would refuse does not merely lose a
// trick: it stops the game dead for everybody, on every device. The choice is
// therefore tried against the engine first, and there is always a dull legal
// move to fall back on. Two hundred hands of self-play have never needed the
// fallback, which is exactly the sort of confidence worth insuring against.
export function chooseSafeMove(state, seat) {
  const candidates = [];
  const first = chooseMove(state, seat);
  if (first) candidates.push(first);

  if (state.turn === seat && !state.handOver) {
    if (state.phase === 'draw') {
      candidates.push({ type: 'draw' }, { type: 'pass' });
    } else {
      // Cheapest cards first, so the safety net costs as little as possible.
      for (const card of [...handOf(state, seat)].sort((a, b) => cardValue(a) - cardValue(b))) {
        candidates.push({ type: 'discard', card: card.id });
      }
    }
  }

  for (const move of candidates) {
    try {
      applyMove(state, { ...move, by: seat });
      return move;
    } catch { /* try the next one */ }
  }
  return null;
}

// The whole of the computer player. Returns a move without its `by` stamp, or
// null when this seat has nothing to do.
export function chooseMove(state, seat) {
  if (!state || state.handOver || state.gameOver) return null;

  // Answering a partner comes before anything else: the table is waiting.
  const asked = state.permission;
  if (asked && asked.answer === null && asked.partner === seat) {
    return { type: 'answerPartner', yes: willingToGoOut(state, seat) };
  }

  if (state.turn !== seat) return null;
  return state.phase === 'draw' ? chooseDraw(state, seat) : choosePlay(state, seat);
}

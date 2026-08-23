// Meld rules.
//
// A meld is three or more cards of one rank. Wilds may stand in, but a meld
// always needs at least two natural cards and never carries more than three
// wilds. Threes are excluded entirely: red threes are bonuses, black threes
// only ever go down when a player goes out.

import { isWild, isNatural, isBlackThree, isRedThree, cardValue, THREE } from './cards.js';

export const CANASTA_SIZE = 7;
export const MIN_MELD = 3;
export const MAX_WILDS = 3;
export const MIN_NATURALS = 2;

export const naturalsIn = (cards) => cards.filter(isNatural);
export const wildsIn = (cards) => cards.filter(isWild);

// The rank a meld is built on, or null if its naturals disagree.
export function meldRank(cards) {
  const ranks = new Set(naturalsIn(cards).map((c) => c.rank));
  return ranks.size === 1 ? [...ranks][0] : null;
}

// Returns null when the meld is legal, or a human-readable reason when it is
// not. A reason string beats a bare false: the UI shows it verbatim.
export function meldError(cards) {
  if (!Array.isArray(cards) || cards.length < MIN_MELD) {
    return `A meld needs at least ${MIN_MELD} cards.`;
  }
  if (cards.some(isRedThree)) return 'Red threes are bonuses and are never melded.';
  if (cards.some(isBlackThree)) return blackThreeError(cards);

  const naturals = naturalsIn(cards);
  const wilds = wildsIn(cards);

  if (naturals.length < MIN_NATURALS) return `A meld needs at least ${MIN_NATURALS} natural cards.`;
  if (wilds.length > MAX_WILDS) return `A meld may hold at most ${MAX_WILDS} wild cards.`;
  if (meldRank(cards) === null) return 'Every natural card in a meld must be the same rank.';
  if (naturals.length + wilds.length !== cards.length) return 'That meld contains a card it cannot use.';

  return null;
}

// Black threes are legal only as a going-out meld, and never with wilds.
// Wilds are checked first so a joker is reported as the wild it is, rather
// than as a rank that does not match.
function blackThreeError(cards) {
  if (cards.some(isWild)) return 'A black three meld cannot contain wild cards.';
  if (!cards.every((c) => c.rank === THREE)) return 'Black threes cannot be mixed with other ranks.';
  return null;
}

export const isBlackThreeMeld = (cards) => cards.length > 0 && cards.every(isBlackThree);

export const isValidMeld = (cards) => meldError(cards) === null;

// Adding to a meld already on the table has to leave it legal too -- and a
// finished canasta takes nothing more. It is closed the moment it is complete,
// which is a house rule: the classic game lets you keep piling cards on.
export function addToMeldError(meld, cards) {
  if (isCanasta(meld)) return 'That canasta is closed. Nothing more goes onto it.';
  return meldError([...meld, ...cards]);
}

export const canAddToMeld = (meld, cards) => addToMeldError(meld, cards) === null;

export const meldPoints = (cards) => cards.reduce((sum, c) => sum + cardValue(c), 0);

export const isCanasta = (cards) => cards.length >= CANASTA_SIZE;
export const isNaturalCanasta = (cards) => isCanasta(cards) && wildsIn(cards).length === 0;

// 500 for a canasta made of naturals, 300 once a wild is in it.
export function canastaBonus(cards) {
  if (!isCanasta(cards)) return 0;
  return isNaturalCanasta(cards) ? 500 : 300;
}

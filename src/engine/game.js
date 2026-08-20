// Spite and Malice rules engine.
//
// Pure state machine: no UI, no network, no timers. Every move goes through
// applyMove, which validates first and returns a NEW state. Keeping it pure is
// what lets the same code run a local game, drive an AI, or sit behind a server
// that referees two remote players.

import { buildDeck, makeRng, shuffle, isWild, QUEEN, ACE, TWO, LOWEST_WILD_RANK } from './cards.js';

export const DEFAULT_CONFIG = {
  // Two separate decks with two separate jobs: one is the draw stock players
  // refill their hands from, the other is dealt out as the payoff piles.
  drawDeck: { deckCount: 1, jokersPerDeck: 2 },    // 54 cards
  payoffDeck: { deckCount: 1, jokersPerDeck: 2 },  // 54 cards, split between players
  payoffSize: null,   // null splits the payoff deck evenly; a number deals that many each
  handSize: 5,
  buildPiles: 4,      // shared centre piles, built A -> Q
  discardPiles: 4,    // personal side stacks; playing here ends your turn

  // House rules.
  // Standard play: aces and twos must be the real card, so piles can stall
  // waiting for one. Turn this on and wilds cover them too, which opens piles
  // far more freely and makes for a noticeably faster game.
  wildsAsLowRanks: false,
  // Holding a playable ace or two obliges you to play it before ending a turn.
  forceLowCards: true,
};

export function createGame({ config = {}, seed = Date.now(), players = ['Player 1', 'Player 2'] } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const rng = makeRng(seed);

  const draw = shuffle(buildDeck(cfg.drawDeck), rng);
  const payoffStock = shuffle(buildDeck(cfg.payoffDeck), rng);

  // An unspecified payoff size just divides the payoff deck evenly.
  const payoffSize = cfg.payoffSize ?? Math.floor(payoffStock.length / players.length);
  if (payoffSize < 1) throw new Error('Payoff deck is too small to deal anyone a pile.');
  if (payoffStock.length < players.length * payoffSize) {
    throw new Error(
      `Payoff deck too small: ${payoffStock.length} cards cannot deal ` +
      `${players.length} piles of ${payoffSize}.`
    );
  }

  const seats = players.map((name, i) => ({
    id: i,
    name,
    payoff: payoffStock.splice(0, payoffSize),
    hand: [],
    discards: Array.from({ length: cfg.discardPiles }, () => []),
  }));

  // Whatever the payoff deal did not use joins the draw stock rather than
  // being wasted, then hands come off the top.
  if (payoffStock.length) {
    draw.push(...payoffStock);
    shuffle(draw, rng);
  }
  if (draw.length < players.length * cfg.handSize) {
    throw new Error(`Draw deck too small to deal ${players.length} hands of ${cfg.handSize}.`);
  }
  for (const seat of seats) seat.hand = draw.splice(0, cfg.handSize);

  return {
    config: { ...cfg, payoffSize },
    seed,
    players: seats,
    build: Array.from({ length: cfg.buildPiles }, () => []),
    draw,
    completed: [],      // finished build piles, recycled when draw runs dry
    turn: 0,
    winner: null,
    log: [],
  };
}

// ---------------------------------------------------------------- queries

export const currentPlayer = (s) => s.players[s.turn];

// The rank a build pile will accept next: an empty pile wants an Ace.
export const nextRankFor = (pile) => (pile.length === 0 ? ACE : pile.length + 1);

// A wild fits any unfinished pile from the three upward. Aces and twos have to
// be the real card unless the wildsAsLowRanks house rule is switched on.
export function canPlayOnBuild(card, pile, config = DEFAULT_CONFIG) {
  if (pile.length >= QUEEN) return false;
  const need = nextRankFor(pile);
  if (isWild(card)) return config.wildsAsLowRanks || need >= LOWEST_WILD_RANK;
  return card.rank === need;
}

// Aces and twos in hand are compulsory: you may not end your turn while one of
// them still has a pile to go on. Wilds are never forced even when they are
// allowed to cover low ranks -- spending a wild stays your choice. Returns the
// hand indices currently under obligation so the UI can flag them.
export function forcedPlayIndices(state, player = currentPlayer(state)) {
  if (!state.config.forceLowCards) return [];
  return player.hand.reduce((out, card, i) => {
    if (card.rank !== ACE && card.rank !== TWO) return out;
    const playable = state.build.some((pile) => canPlayOnBuild(card, pile, state.config));
    return playable ? [...out, i] : out;
  }, []);
}

function topOf(pile) {
  return pile.length ? pile[pile.length - 1] : null;
}

// Every source a player may legally play FROM this turn.
function sources(player) {
  const out = [];
  const payoffTop = topOf(player.payoff);
  if (payoffTop) out.push({ zone: 'payoff', index: 0, card: payoffTop });
  player.hand.forEach((card, index) => out.push({ zone: 'hand', index, card }));
  player.discards.forEach((pile, index) => {
    const top = topOf(pile);
    if (top) out.push({ zone: 'discard', index, card: top });
  });
  return out;
}

export function getLegalMoves(state) {
  if (state.winner !== null) return [];
  const player = currentPlayer(state);
  const moves = [];

  for (const src of sources(player)) {
    state.build.forEach((pile, buildIndex) => {
      if (canPlayOnBuild(src.card, pile, state.config)) {
        moves.push({ type: 'play', from: src.zone, index: src.index, to: buildIndex });
      }
    });
  }

  // With a forced card outstanding the turn cannot be ended, so no discards are
  // offered. Other plays stay legal: you keep control of the order you play in.
  if (forcedPlayIndices(state, player).length > 0) return moves;

  player.hand.forEach((_, handIndex) => {
    player.discards.forEach((_, discardIndex) => {
      moves.push({ type: 'discard', index: handIndex, to: discardIndex });
    });
  });

  return moves;
}

// ---------------------------------------------------------------- mutation

function drawUp(state, player) {
  while (player.hand.length < state.config.handSize) {
    if (state.draw.length === 0) {
      if (state.completed.length === 0) break;   // genuinely out of cards
      state.draw = shuffle(state.completed, makeRng(state.seed + state.log.length));
      state.completed = [];
    }
    player.hand.push(state.draw.shift());
  }
}

function takeFrom(state, player, zone, index) {
  if (zone === 'hand') return player.hand.splice(index, 1)[0];
  if (zone === 'payoff') return player.payoff.pop();
  if (zone === 'discard') return player.discards[index].pop();
  throw new Error(`Unknown source zone: ${zone}`);
}

export function applyMove(state, move) {
  if (state.winner !== null) throw new Error('Game is already over.');

  const next = structuredClone(state);
  const player = currentPlayer(next);

  if (move.type === 'play') {
    const src = { hand: player.hand[move.index], payoff: topOf(player.payoff),
                  discard: topOf(player.discards[move.index] ?? []) }[move.from];
    if (!src) throw new Error(`No card at ${move.from}[${move.index}].`);

    const pile = next.build[move.to];
    if (!pile) throw new Error(`No build pile ${move.to}.`);
    if (!canPlayOnBuild(src, pile, next.config)) {
      throw new Error(`${src.id} cannot go on build pile ${move.to}.`);
    }

    const card = takeFrom(next, player, move.from, move.index);
    // A wild is locked to the rank it fills, so the pile stays readable.
    pile.push({ ...card, playedAs: isWild(card) ? nextRankFor(pile) : card.rank });
    next.log.push({ turn: next.turn, move });

    // A pile completed at Queen is cleared and recycled back into the stock.
    if (pile.length >= QUEEN) {
      next.completed.push(...pile.splice(0, pile.length));
    }

    if (move.from === 'payoff' && player.payoff.length === 0) {
      next.winner = player.id;
      return next;
    }

    // Emptying your hand earns a fresh one and the turn continues.
    if (player.hand.length === 0) drawUp(next, player);
    return next;
  }

  if (move.type === 'discard') {
    const forced = forcedPlayIndices(next, player);
    if (forced.length > 0) {
      const card = player.hand[forced[0]];
      const name = card.rank === ACE ? 'ace' : 'two';
      throw new Error(`You must play the ${name} in hand (slot ${forced[0]}) before discarding.`);
    }

    const card = player.hand[move.index];
    if (!card) throw new Error(`No card in hand at ${move.index}.`);
    const pile = player.discards[move.to];
    if (!pile) throw new Error(`No discard pile ${move.to}.`);

    pile.push(player.hand.splice(move.index, 1)[0]);
    next.log.push({ turn: next.turn, move });

    next.turn = (next.turn + 1) % next.players.length;
    drawUp(next, currentPlayer(next));
    return next;
  }

  throw new Error(`Unknown move type: ${move.type}`);
}

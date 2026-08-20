// Canasta rules engine: four players, two partnerships, classic rules.
//
// Pure state machine. Every move goes through applyMove, which validates first
// and returns a NEW state, so the same code can drive a local board, a bot, or
// a server refereeing remote players.
//
// A turn is two phases. In 'draw' you must either take one card from the stock
// or take the whole discard pile. In 'play' you may lay melds down and must
// finish by discarding, unless you go out.

import {
  buildDeck, makeRng, shuffle, cardValue, isWild, isRedThree, isBlackThree, isNatural, label,
} from './cards.js';
import {
  meldError, meldPoints, meldRank, canastaBonus, isCanasta, isBlackThreeMeld, canAddToMeld, MAX_WILDS,
} from './melds.js';

export const DEFAULT_CONFIG = {
  handSize: 11,
  targetScore: 5000,
  goOutBonus: 100,
  concealedBonus: 200,
  redThreeValue: 100,
  allRedThreesValue: 800,
};

// A partnership's opening meld has to clear a bar that rises with its score.
export function initialMeldMinimum(score) {
  if (score < 0) return 15;
  if (score < 1500) return 50;
  if (score < 3000) return 90;
  return 120;
}

export const teamIndexOf = (playerIndex) => playerIndex % 2;
export const currentPlayer = (s) => s.players[s.turn];
export const currentTeam = (s) => s.teams[teamIndexOf(s.turn)];
export const topDiscard = (s) => (s.discard.length ? s.discard[s.discard.length - 1] : null);

const byId = (cards, id) => cards.find((c) => c.id === id);

// ---------------------------------------------------------------- setup

export function createGame({
  config = {}, seed = Date.now(),
  players = ['North', 'East', 'South', 'West'],
  scores = [0, 0],
  firstPlayer = 0,          // rotates each hand so the lead moves round the table
} = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (players.length !== 4) throw new Error('Canasta seats exactly four players.');

  const rng = makeRng(seed);
  const stock = shuffle(buildDeck(), rng);

  const teams = [0, 1].map((id) => ({
    id,
    melds: {},          // rank -> cards; black threes live under key 'B3'
    redThrees: [],
    score: scores[id],
    minimum: initialMeldMinimum(scores[id]),
    hasMelded: false,
  }));

  const seats = players.map((name, i) => ({
    id: i, name, team: teamIndexOf(i), hand: [],
  }));

  const state = {
    config: cfg, seed, players: seats, teams,
    stock, discard: [], frozen: false,
    turn: firstPlayer % 4, phase: 'draw',
    tookPileThisTurn: false,
    meldedThisTurn: false,
    // True when the partnership put its very first meld down this turn, which
    // is what makes going out in the same turn a concealed hand.
    openedThisTurn: false,
    // Set while a player has asked their partner for leave to go out.
    permission: null,
    handOver: false, outPlayer: null, gameOver: false,
    lastHandScores: null, log: [],
  };

  // Deal, replacing any red three dealt into a hand as it appears.
  for (let n = 0; n < cfg.handSize; n++) {
    for (const seat of seats) drawInto(state, seat);
  }

  // Turn the first card. Wilds and red threes freeze the pile and another
  // card is turned on top of them.
  while (state.stock.length) {
    const card = state.stock.pop();
    state.discard.push(card);
    if (isWild(card) || isRedThree(card)) state.frozen = true;
    else break;
  }

  return state;
}

// Draws one card, banking red threes and drawing again in their place.
// Returns false only when the stock has run dry.
function drawInto(state, seat) {
  for (;;) {
    if (state.stock.length === 0) return false;
    const card = state.stock.pop();
    if (isRedThree(card)) {
      state.teams[seat.team].redThrees.push(card);
      continue;
    }
    seat.hand.push(card);
    return true;
  }
}

// ---------------------------------------------------------------- queries

export const teamMelds = (team) => Object.values(team.melds);
export const teamCanastas = (team) => teamMelds(team).filter(isCanasta);
export const hasCanasta = (team) => teamCanastas(team).length > 0;

// Card values on the table, before any bonus.
export const meldedValue = (team) => teamMelds(team).reduce((n, m) => n + meldPoints(m), 0);

// The pile is untouchable while a black three or a wild sits on top of it.
export function pileBlockedReason(state) {
  const top = topDiscard(state);
  if (!top) return 'The discard pile is empty.';
  if (isBlackThree(top)) return 'A black three blocks the pile.';
  if (isWild(top)) return 'A wild card blocks the pile.';
  return null;
}

// What the player must hold to take the pile, given the top card.
// Frozen: two natural cards of that rank, always.
// Unfrozen: two cards of that rank (a wild may be one of them), or an
// existing team meld of that rank to add it to.
export function canTakePile(state, playerIndex = state.turn) {
  const blocked = pileBlockedReason(state);
  if (blocked) return { ok: false, reason: blocked };

  const top = topDiscard(state);
  const hand = state.players[playerIndex].hand;
  const team = state.teams[teamIndexOf(playerIndex)];

  const naturals = hand.filter((c) => c.rank === top.rank && isNatural(c));
  const wilds = hand.filter(isWild);

  if (state.frozen) {
    return naturals.length >= 2
      ? { ok: true, mode: 'frozen-pair' }
      : { ok: false, reason: 'The pile is frozen: you need two natural cards matching the top card.' };
  }
  if (team.melds[top.rank]) return { ok: true, mode: 'add-to-meld' };
  if (naturals.length >= 2) return { ok: true, mode: 'pair' };
  if (naturals.length >= 1 && wilds.length >= 1) return { ok: true, mode: 'natural-plus-wild' };

  return { ok: false, reason: 'You cannot use the top card, so the pile is not yours to take.' };
}

// With the stock gone, a player whose side can simply lay the top card on a
// meld it already has is obliged to take the pile rather than end the hand.
export function mustTakePile(state, playerIndex = state.turn) {
  if (state.stock.length > 0) return false;
  if (pileBlockedReason(state)) return false;
  const team = state.teams[teamIndexOf(playerIndex)];
  const top = topDiscard(state);
  return Boolean(team.melds[top.rank]) && canAddToMeld(team.melds[top.rank], [top]);
}

// ---------------------------------------------------------------- melding

// A group is either a bare list of card ids, whose target meld is read off the
// natural cards in it, or { to, cards } naming the meld explicitly. The
// explicit form is what lets a lone wild card join a meld already down.
export function normalizeGroups(groups = []) {
  return groups.map((g) => (Array.isArray(g)
    ? { to: null, ids: g }
    : { to: g.to ?? null, ids: g.cards ?? g.ids ?? [] }));
}

// Applies entries to a team's melds. Returns the points laid down, or throws
// with the reason it is illegal.
function layGroups(team, entries, { goingOut }) {
  let laid = 0;

  for (const { to, cards } of entries) {
    if (cards.length === 0) throw new Error('An empty meld cannot be laid down.');

    if (to === 'B3' || (to === null && isBlackThreeMeld(cards))) {
      if (!goingOut) throw new Error('Black threes may only be melded as you go out.');
      const error = meldError(cards);
      if (error) throw new Error(error);
      team.melds.B3 = [...(team.melds.B3 ?? []), ...cards];
      laid += meldPoints(cards);
      continue;
    }

    let rank = to;
    if (rank === null) {
      rank = meldRank(cards);
      if (rank === null) {
        throw new Error(cards.every(isWild)
          ? 'Say which meld the wild card is joining.'
          : 'Every natural card in a meld must be the same rank.');
      }
    }

    const existing = team.melds[rank];
    if (to !== null && !existing) throw new Error(`Your side has no meld of that rank to add to.`);

    const combined = [...(existing ?? []), ...cards];
    const error = meldError(combined);
    if (error) throw new Error(error);

    team.melds[rank] = combined;
    laid += meldPoints(cards);
  }

  return laid;
}

// Pulls the named cards out of a hand, failing loudly rather than silently
// melding a card the player does not hold.
function takeFromHand(hand, ids) {
  const taken = [];
  for (const id of ids) {
    const index = hand.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('You do not hold one of those cards.');
    taken.push(hand.splice(index, 1)[0]);
  }
  return taken;
}

// ---------------------------------------------------------------- moves

export function applyMove(state, move) {
  if (state.handOver) throw new Error('The hand is over.');
  const next = structuredClone(state);
  const player = currentPlayer(next);
  const team = currentTeam(next);

  // A move made over the network says which seat made it. Every move but the
  // answer to a question belongs to the player whose turn it is, and that is
  // checked here rather than in the board, so a stale phone or a second tap
  // cannot play somebody else's turn for them.
  if (move.by !== undefined && move.type !== 'answerPartner' && move.by !== next.turn) {
    throw new Error(`It is ${player.name}'s turn, not yours.`);
  }

  switch (move.type) {
    case 'draw': return doDraw(next, player);
    case 'pass': return doPass(next);
    case 'takePile': return doTakePile(next, player, team, move);
    case 'meld': return doMeld(next, player, team, move);
    case 'discard': return doDiscard(next, player, team, move);
    case 'askPartner': return doAskPartner(next, player);
    case 'answerPartner': return doAnswerPartner(next, move);
    default: throw new Error(`Unknown move type: ${move.type}`);
  }
}

function doDraw(next, player) {
  if (next.phase !== 'draw') throw new Error('You have already drawn this turn.');

  // Once the stock is gone the hand lives on the discard pile alone: the only
  // way to keep playing is to take it, and the hand ends the moment somebody
  // cannot or will not.
  if (next.stock.length === 0) {
    if (canTakePile(next).ok) {
      throw new Error('The stock is gone. Take the discard pile, or pass to end the hand.');
    }
    return endHand(next, null);
  }

  // False here means the stock ran dry banking red threes, last card included.
  if (!drawInto(next, player)) return endHand(next, null);
  next.phase = 'play';
  next.log.push({ turn: next.turn, move: { type: 'draw' } });
  return next;
}

// Declining the pile once the stock is gone, which ends the hand with nobody
// out. Refused while the top card fits a meld already on your side's table --
// that pile is compulsory.
function doPass(next) {
  if (next.phase !== 'draw') throw new Error('You can only pass instead of drawing.');
  if (next.stock.length > 0) throw new Error('The stock still has cards, so you must draw or take the pile.');
  if (mustTakePile(next)) {
    throw new Error('The top card goes onto a meld of yours, so the pile is compulsory.');
  }
  next.log.push({ turn: next.turn, move: { type: 'pass' } });
  return endHand(next, null);
}

// ------------------------------------------------- asking to go out

export const partnerOf = (playerIndex) => (playerIndex + 2) % 4;

// Asking is optional, but the answer binds you, so it may only be asked once
// and only during your own play phase.
function doAskPartner(next, player) {
  if (next.phase !== 'play') throw new Error('Ask your partner during your turn, after you have drawn.');
  if (next.permission) throw new Error('You have already asked this turn.');
  next.permission = { asker: player.id, partner: partnerOf(player.id), answer: null };
  next.log.push({ turn: next.turn, move: { type: 'askPartner' } });
  return next;
}

function doAnswerPartner(next, move) {
  if (!next.permission) throw new Error('Nobody has asked to go out.');
  if (move.by !== undefined && move.by !== next.permission.partner) {
    throw new Error('Only the partner who was asked can answer.');
  }
  if (next.permission.answer !== null) throw new Error('That question has already been answered.');
  if (typeof move.yes !== 'boolean') throw new Error('Answer yes or no.');
  next.permission.answer = move.yes ? 'yes' : 'no';
  next.log.push({ turn: next.turn, move: { type: 'answerPartner', yes: move.yes } });
  return next;
}

// A refusal binds: having asked and been told no, you may not go out this turn.
function refuseIfDenied(next, player) {
  const p = next.permission;
  if (p && p.asker === player.id && p.answer === 'no') {
    throw new Error('Your partner said no, so you cannot go out this turn.');
  }
}

function doTakePile(next, player, team, move) {
  if (next.phase !== 'draw') throw new Error('The pile can only be taken instead of drawing.');

  const check = canTakePile(next);
  if (!check.ok) throw new Error(check.reason);

  const top = topDiscard(next);
  const entries = normalizeGroups(move.groups);
  if (!entries.some((g) => g.ids.includes(top.id))) {
    throw new Error('The top card of the pile must be melded straight away.');
  }

  // The player takes the whole pile, but only the top card and cards from
  // hand may count toward an opening meld.
  const pile = next.discard.splice(0, next.discard.length);
  const rest = pile.filter((c) => c.id !== top.id);
  // A red three buried in the pile is a bonus like any other: it is banked on
  // the spot, and unlike one drawn from the stock it is not replaced.
  const buriedReds = rest.filter(isRedThree);
  const fromPile = rest.filter((c) => !isRedThree(c));
  player.hand.push(top);

  const wasFirstMeld = !team.hasMelded;
  const built = entries.map((g) => ({ to: g.to, cards: takeFromHand(player.hand, g.ids) }));

  // A frozen pile demands two natural cards from hand alongside the top card.
  if (next.frozen) {
    const group = built.find((g) => g.cards.some((c) => c.id === top.id));
    const naturals = group.cards.filter((c) => c.id !== top.id && c.rank === top.rank && isNatural(c));
    if (naturals.length < 2) {
      throw new Error('The pile is frozen: you need two natural cards matching the top card.');
    }
  }

  const laid = layGroups(team, built, { goingOut: false });
  if (wasFirstMeld && laid < team.minimum) {
    throw new Error(`Your first meld must be worth ${team.minimum}; that is only ${laid}.`);
  }

  team.hasMelded = true;
  if (wasFirstMeld) next.openedThisTurn = true;
  team.redThrees.push(...buriedReds);
  player.hand.push(...fromPile);
  next.frozen = false;
  next.phase = 'play';
  next.tookPileThisTurn = true;
  next.meldedThisTurn = true;
  next.log.push({ turn: next.turn, move: { type: 'takePile', count: pile.length } });
  return next;
}

function doMeld(next, player, team, move) {
  if (next.phase !== 'play') throw new Error('Draw before you meld.');

  const entries = normalizeGroups(move.groups);
  if (entries.length === 0) throw new Error('Nothing was selected to meld.');

  const wasFirstMeld = !team.hasMelded;
  const selected = entries.reduce((n, g) => n + g.ids.length, 0);
  // Going out is melding the whole hand, or melding all but the one card you
  // then discard. Both count as "as you go out" for black threes.
  const remaining = player.hand.length - selected;
  const goingOut = remaining === 0 || (remaining === 1 && hasCanasta(team));

  const built = entries.map((g) => ({ to: g.to, cards: takeFromHand(player.hand, g.ids) }));
  const laid = layGroups(team, built, { goingOut });

  if (wasFirstMeld && laid < team.minimum) {
    throw new Error(`Your first meld must be worth ${team.minimum}; that is only ${laid}.`);
  }

  team.hasMelded = true;
  if (wasFirstMeld) next.openedThisTurn = true;
  next.meldedThisTurn = true;
  next.log.push({ turn: next.turn, move: { type: 'meld', laid } });

  // Melding your last card goes out, provided the partnership has a canasta.
  if (player.hand.length === 0) {
    refuseIfDenied(next, player);
    if (!hasCanasta(team)) throw new Error('You need a canasta before going out.');
    return endHand(next, player.id);
  }
  return next;
}

function doDiscard(next, player, team, move) {
  if (next.phase !== 'play') throw new Error('Draw before you discard.');

  const card = byId(player.hand, move.card);
  if (!card) throw new Error('You do not hold that card.');

  // Going out on the discard needs a canasta, same as melding out.
  const goingOut = player.hand.length === 1;
  if (goingOut) {
    refuseIfDenied(next, player);
    if (!hasCanasta(team)) throw new Error('You need a canasta before going out.');
  }

  takeFromHand(player.hand, [move.card]);
  next.discard.push(card);
  if (isWild(card)) next.frozen = true;
  next.log.push({ turn: next.turn, move: { type: 'discard', card: label(card) } });

  if (goingOut) return endHand(next, player.id);

  next.turn = (next.turn + 1) % next.players.length;
  next.phase = 'draw';
  next.tookPileThisTurn = false;
  next.meldedThisTurn = false;
  next.openedThisTurn = false;
  next.permission = null;
  return next;
}

// ---------------------------------------------------------------- scoring

// Red threes are worth 100 apiece and 800 for the set -- but they count
// against a partnership that never got a meld down.
export function redThreeScore(state, team) {
  const n = team.redThrees.length;
  if (n === 0) return 0;
  const value = n === 4 ? state.config.allRedThreesValue : n * state.config.redThreeValue;
  return team.hasMelded ? value : -value;
}

export function scoreTeam(state, team, { wentOut, concealed }) {
  const melded = meldedValue(team);
  const bonuses = teamMelds(team).reduce((n, m) => n + canastaBonus(m), 0);
  const reds = redThreeScore(state, team);
  const inHand = state.players
    .filter((p) => p.team === team.id)
    .reduce((n, p) => n + p.hand.reduce((s, c) => s + cardValue(c), 0), 0);
  const out = wentOut ? (concealed ? state.config.concealedBonus : state.config.goOutBonus) : 0;

  return {
    melded, bonuses, redThrees: reds, goOut: out, inHand: -inHand,
    total: melded + bonuses + reds + out - inHand,
  };
}

function endHand(next, outPlayerId) {
  next.handOver = true;
  next.outPlayer = outPlayerId;

  const outTeam = outPlayerId === null ? null : teamIndexOf(outPlayerId);
  // Concealed: the partnership had nothing down before this turn and its whole
  // hand went out in it. Counting meld entries in the log would have counted
  // the opponents' melds too.
  const concealed = outPlayerId !== null && next.openedThisTurn;

  next.lastHandScores = next.teams.map((team) =>
    scoreTeam(next, team, { wentOut: team.id === outTeam, concealed: concealed && team.id === outTeam }));

  next.teams.forEach((team, i) => {
    team.score += next.lastHandScores[i].total;
    team.minimum = initialMeldMinimum(team.score);
  });

  next.gameOver = next.teams.some((t) => t.score >= next.config.targetScore);
  return next;
}

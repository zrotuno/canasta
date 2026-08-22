// The heckler.
//
// Reads the last thing that happened and says something about it. Aimed at the
// play and never at the player: a hand can be called stupid, a person cannot.
//
// The line is picked from the position of the event in the log rather than at
// random, so every phone at the table shows the same one. Four people laughing
// at four different jokes is not the same as four people laughing.

const FREEZE = [
  (t) => `Look at ${t.player}, freezing the pile already. Someone has been saving that wild card like a family heirloom.`,
  (t) => `${t.player} freezes it. Nothing says confidence like making sure nobody else gets to play.`,
  (t) => `Frozen by ${t.player}. A bold move from somebody currently not winning.`,
  (t) => `${t.player} has locked the pile. Everybody please thank ${t.player} for making this slower.`,
  (t) => `Ice cold from ${t.player}. Shame about the rest of the hand.`,
];

const TAKE_PILE = [
  (t) => `${t.victim} hands ${t.player} ${t.count} cards. Genuinely generous. Genuinely catastrophic.`,
  (t) => `${t.player} takes ${t.count} off ${t.victim}. ${t.victim}, your partner is watching, and they have questions.`,
  (t) => `${t.count} cards to ${t.player}, gift-wrapped by ${t.victim}. Hope that discard felt good at the time.`,
  (t) => `${t.victim} just donated ${t.count} cards to the opposition. Fifty years of cards and it comes to this.`,
  (t) => `${t.player} scoops ${t.count}. ${t.victim} is now the least popular person at this table.`,
];

// Nobody to blame when the pile is only the card the deal turned up.
const TAKE_PILE_BLAMELESS = [
  (t) => `${t.player} takes ${t.count} off the table. No one to blame but the deal.`,
  (t) => `${t.count} cards to ${t.player} and not a single person to hold responsible. Disappointing.`,
];

const NATURAL_CANASTA = [
  (t) => `${t.player} lays a natural canasta. Seven cards, no wilds, no help, no humility.`,
  (t) => `Natural canasta for ${t.player}. Everybody else, please clap.`,
  (t) => `A clean seven from ${t.player}. Insufferable, and entirely deserved.`,
  (t) => `${t.player} made that look easy. It is not easy. ${t.player} knows it is not easy.`,
  (t) => `Natural canasta, ${t.player}. Five hundred points and a whole new personality.`,
];

const WENT_OUT = [
  (t) => `${t.player} is out. Everybody else, start counting the damage.`,
  (t) => `And that is the hand. ${t.player} is going to be unbearable about this.`,
  (t) => `${t.player} goes out. The rest of you are just holding evidence now.`,
  (t) => `Out goes ${t.player}. Three people quietly furious, one insufferably pleased.`,
  (t) => `${t.player} went out. Put your cards down slowly and think about what you have done.`,
];

const BROKE_CANASTA = [
  (t) => `${t.team} smashed a canasta to settle the bill. Five hundred points, spent like pocket change.`,
  (t) => `A canasta broken by ${t.team}. That one is going to come up at Christmas.`,
  (t) => `${t.team} tore up a canasta to cover their hand. Genuinely difficult to watch.`,
  (t) => `That canasta died so ${t.team} could pay a debt. Nobody won anything here.`,
  (t) => `${t.team} broke a canasta. Somewhere a rulebook is quietly weeping.`,
];

const CAUGHT = [
  (t) => `${t.team} caught holding ${t.points}. That is going to leave a mark.`,
  (t) => `${t.points} points still in hand for ${t.team}. Collecting is not the same as playing.`,
  (t) => `${t.team} are holding ${t.points} and the music has stopped.`,
  (t) => `Caught with ${t.points}, ${t.team}. Perhaps meld something next time.`,
  (t) => `${t.points} in hand. ${t.team} treated those cards like a savings account, and the bank has closed.`,
];

const DEAD_DECK = [
  () => `The stock is gone and nobody got out. Four people, one deck, no winners.`,
  () => `Deck is dead. Everybody counts. Nobody enjoys it.`,
  () => `The stock ran dry. That hand ended exactly the way it deserved to.`,
];

// A hand worth being mocked for holding.
const A_LOT = 120;

const pick = (lines, at, facts) => lines[Math.abs(at) % lines.length](facts);

const nameOf = (game, seat) =>
  (seat === null || seat === undefined || !game.players[seat] ? null : game.players[seat].name);

const teamNameOf = (game, teamId) =>
  game.players.filter((p) => p.team === teamId).map((p) => p.name).join(' & ');

// Something to say about a move on the board, or null for the great majority
// of moves, which deserve no comment whatsoever.
export function tauntForMove(entry, game, at) {
  const m = entry.move;
  const player = nameOf(game, entry.turn);

  // A natural canasta outranks everything else on the table.
  const natural = (m.made ?? []).find((x) => x.natural);
  if (natural && player) return pick(NATURAL_CANASTA, at, { player });

  if (m.type === 'takePile' && player) {
    const victim = nameOf(game, m.from);
    return victim && victim !== player
      ? pick(TAKE_PILE, at, { player, victim, count: m.count })
      : pick(TAKE_PILE_BLAMELESS, at, { player, count: m.count });
  }

  if (m.type === 'discard' && m.froze && player) return pick(FREEZE, at, { player });

  return null;
}

// Something to say about the hand that has just finished. Ranked by how much
// it will be talked about afterwards, not by how important it is.
export function tauntForHandEnd(entry, game, at) {
  const m = entry.move;

  const brokeIndex = (m.broken ?? []).findIndex((n) => n > 0);
  if (brokeIndex >= 0) {
    return pick(BROKE_CANASTA, at, { team: teamNameOf(game, brokeIndex) });
  }

  const caught = m.caught ?? [];
  const worst = caught.indexOf(Math.max(...caught));
  if (caught.length && caught[worst] >= A_LOT) {
    return pick(CAUGHT, at, { team: teamNameOf(game, worst), points: caught[worst] });
  }

  if (m.out === null) return pick(DEAD_DECK, at, {});

  const player = nameOf(game, m.out);
  return player ? pick(WENT_OUT, at, { player }) : null;
}

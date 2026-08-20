// Turning a move log back into a game.
//
// This is the whole trick behind playing on four phones: the document in
// Firestore holds a seed and a list of moves, and this rebuilds the game from
// them. Same seed, same moves, same engine, same game — on every device.
//
// Deliberately knows nothing about Firebase, so it runs in the test harness.

import { createGame, applyMove } from '../engine/game.js';

export const NEW_HAND = 'newHand';

const SEAT_NAMES = ['North', 'East', 'South', 'West'];

export const seatNames = (seats = []) =>
  SEAT_NAMES.map((fallback, i) => seats[i]?.name || fallback);

// Each hand deals from its own seed so a game is still one document, and the
// lead moves round the table hand by hand.
const handGame = (seed, names, hand, scores) => createGame({
  seed: seed + hand,
  players: names,
  scores,
  firstPlayer: hand % 4,
});

// Returns the current state, which hand it belongs to, and — if a move in the
// log could not be applied — the reason, with the state left as it was just
// before. A stuck game is far better than a blank screen, and every player
// gets stuck in exactly the same place.
export function rebuild({ seed, seats = [], moves = [] }) {
  const names = seatNames(seats);
  let hand = 0;
  let state = handGame(seed, names, 0, [0, 0]);

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    try {
      if (move.type === NEW_HAND) {
        if (!state.handOver) throw new Error('The hand is still being played.');
        hand += 1;
        state = handGame(seed, names, hand, state.teams.map((t) => t.score));
      } else {
        state = applyMove(state, move);
      }
    } catch (e) {
      return { state, hand, applied: i, error: `Move ${i + 1} (${move.type}): ${e.message}` };
    }
  }

  return { state, hand, applied: moves.length, error: null };
}

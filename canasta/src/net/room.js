// The whole of the networking: a Firestore document per game.
//
// The document holds a seed and an ordered list of moves, nothing else. Every
// player's browser runs the same engine over the same seed and the same moves
// and therefore holds the same game, so there is no server code to write and
// no second implementation of the rules to keep honest.
//
// Firebase is loaded from its own CDN as ES modules. This project has no build
// step and this machine has no Node, so `npm install` is not on the table.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const db = getFirestore(initializeApp(firebaseConfig));
const roomRef = (code) => doc(db, 'games', code);

// Letters that survive being read aloud across a noisy room. No I, O, S, or Z.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRTUVWXY';

export function newCode() {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  }
  return out;
}

// This browser's identity, so a seat can tell its owner from everybody else.
// Survives a refresh, which is what makes reconnecting work.
export function myId() {
  let id = localStorage.getItem('canasta.playerId');
  if (!id) {
    id = `p${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('canasta.playerId', id);
  }
  return id;
}

export const SEAT_NAMES = ['North', 'East', 'South', 'West'];

export async function createRoom(code = newCode()) {
  await setDoc(roomRef(code), {
    seed: Math.floor(Math.random() * 2 ** 31),
    createdAt: Date.now(),
    seats: [null, null, null, null],
    moves: [],
    started: false,
  });
  return code;
}

// Leaves the lobby. The deal itself is not a move: the hand is dealt by the
// seed, so starting is only a matter of saying the table is no longer filling.
export async function startGame(code) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new Error('That game code does not exist.');
    if (snap.data().seats.some((s) => !s)) throw new Error('Canasta wants all four seats filled.');
    tx.update(roomRef(code), { started: true });
  });
}

export async function roomExists(code) {
  return (await getDoc(roomRef(code))).exists();
}

// Sits down, or moves seats. One player holds at most one seat, so any seat
// this browser already occupies is vacated in the same transaction — that is
// what lets four people swap around between hands.
export async function claimSeat(code, seat, name) {
  const id = myId();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new Error('That game code does not exist.');

    const seats = [...snap.data().seats];
    if (seats[seat] && seats[seat].id !== id) {
      throw new Error(`${seats[seat].name} is already sitting there.`);
    }
    for (let i = 0; i < seats.length; i++) {
      if (seats[i] && seats[i].id === id) seats[i] = null;
    }
    seats[seat] = { id, name: name.trim() || SEAT_NAMES[seat] };
    tx.update(roomRef(code), { seats });
  });
}

export async function leaveSeat(code) {
  const id = myId();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return;
    const seats = snap.data().seats.map((s) => (s && s.id === id ? null : s));
    tx.update(roomRef(code), { seats });
  });
}

// Firestore stores no array directly inside another array, so a move's meld
// groups always travel in their object form. The engine accepts both.
function forTransport(move) {
  if (!move.groups) return { ...move };
  return {
    ...move,
    groups: move.groups.map((g) => (Array.isArray(g)
      ? { to: null, ids: [...g] }
      : { to: g.to ?? null, ids: [...(g.cards ?? g.ids ?? [])] })),
  };
}

// Appends a move, but only if the log is still the length the caller thought
// it was. Two players acting at the same instant cannot both win, so the
// clients can never disagree about the order things happened in.
export async function sendMove(code, move, expectedIndex) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new Error('That game code does not exist.');

    const moves = snap.data().moves ?? [];
    if (moves.length !== expectedIndex) {
      throw new Error('The table moved on while you were deciding. Catching up.');
    }
    tx.update(roomRef(code), { moves: [...moves, forTransport(move)] });
  });
}

// Watches a room. Calls back with the raw document on every change, including
// the first, and returns the function that stops watching.
export function watchRoom(code, onChange, onError = console.error) {
  return onSnapshot(roomRef(code), (snap) => {
    if (!snap.exists()) return onError(new Error('That game has gone.'));
    onChange({ code, ...snap.data() });
  }, onError);
}

// Wipes the log back to an empty game, keeping the players where they sit.
// The seed moves on so the next deal is a different one.
export async function restart(code) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) return;
    tx.update(roomRef(code), {
      moves: [],
      started: false,
      seed: Math.floor(Math.random() * 2 ** 31),
    });
  });
}

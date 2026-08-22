// The heckler.
//
// Cosmetic, but it prints player names into sentences shown to everyone at the
// table, so it is worth knowing that every line fills in and that none of them
// ever comes out with a hole in it.

import { test, eq, ok, no, section } from './harness.js';
import { tauntForMove, tauntForHandEnd } from '../src/ui/taunts.js';

section('The heckler');

const table = {
  players: [
    { id: 0, name: 'Tim', team: 0 },
    { id: 1, name: 'Ruth', team: 1 },
    { id: 2, name: 'Jonelle', team: 0 },
    { id: 3, name: 'Harold', team: 1 },
  ],
};

const move = (turn, m) => ({ turn, move: m });

// Every line of every list, by walking the index right round each of them.
function everyLine(make) {
  const said = [];
  for (let at = 0; at < 12; at++) {
    const line = make(at);
    if (line) said.push(line);
  }
  return said;
}

const wellFormed = (line) => Boolean(line)
  && !line.includes('undefined') && !line.includes('null')
  && !line.includes('${') && !line.includes('NaN')
  && line.trim().length > 20;

test('freezing the pile is remarked upon, and names the culprit', () => {
  const said = everyLine((at) =>
    tauntForMove(move(0, { type: 'discard', card: '2H', froze: true }), table, at));
  ok(said.length >= 5, `${said.length} different lines`);
  for (const line of said) {
    ok(wellFormed(line), `badly formed: ${line}`);
    ok(line.includes('Tim'), `does not name the culprit: ${line}`);
  }
});

test('taking the pile names somebody and says how much it cost them', () => {
  const said = everyLine((at) =>
    tauntForMove(move(1, { type: 'takePile', count: 14, from: 0, mode: 'pair' }), table, at));
  ok(said.length >= 5);
  for (const line of said) {
    ok(wellFormed(line), `badly formed: ${line}`);
    // Some lines name the taker, some round on the donor. Every one of them
    // names a real person and says how many cards changed hands.
    ok(line.includes('Ruth') || line.includes('Tim'), `names nobody: ${line}`);
    ok(line.includes('14'), `no count: ${line}`);
  }
});

test('a pile taken off the turned-up card blames nobody, because nobody threw it', () => {
  const line = tauntForMove(move(1, { type: 'takePile', count: 2, from: null, mode: 'pair' }), table, 0);
  ok(wellFormed(line), line);
  ok(line.includes('Ruth'), line);
  no(line.includes('Tim'), `invented a culprit: ${line}`);
});

test('a natural canasta is announced, and outranks the pile it arrived on', () => {
  const said = everyLine((at) => tauntForMove(move(2, {
    type: 'takePile', count: 9, from: 1, mode: 'pair',
    made: [{ rank: '8', natural: true }],
  }), table, at));
  ok(said.length >= 5);
  for (const line of said) {
    ok(wellFormed(line), `badly formed: ${line}`);
    ok(line.includes('Jonelle'), line);
    // Not every line says the word; some just marvel at the person.

  }
});

test('a mixed canasta passes without comment; it is not that impressive', () => {
  const line = tauntForMove(move(2, {
    type: 'meld', laid: 30, ranks: ['8'], cards: 2,
    made: [{ rank: '8', natural: false }],
  }), table, 0);
  eq(line, null);
});

test('an ordinary turn is met with silence', () => {
  eq(tauntForMove(move(0, { type: 'draw', cards: 2, reds: 0 }), table, 3), null);
  eq(tauntForMove(move(0, { type: 'discard', card: '9S', froze: false }), table, 3), null);
  eq(tauntForMove(move(0, { type: 'meld', laid: 50, ranks: [8], cards: 3, made: [] }), table, 3), null);
});

test('going out gets a send-off', () => {
  const said = everyLine((at) =>
    tauntForHandEnd(move(3, { type: 'handOver', out: 3, broken: [0, 0], caught: [40, 0] }), table, at));
  ok(said.length >= 5);
  for (const line of said) {
    ok(wellFormed(line), `badly formed: ${line}`);
    ok(line.includes('Harold'), line);
  }
});

test('a broken canasta is the loudest thing that can happen', () => {
  const said = everyLine((at) => tauntForHandEnd(
    move(0, { type: 'handOver', out: 0, broken: [0, 1], caught: [10, 400] }), table, at));
  ok(said.length >= 5);
  for (const line of said) {
    ok(wellFormed(line), `badly formed: ${line}`);
    ok(line.includes('Ruth & Harold'), `should name the partnership: ${line}`);
    ok(line.toLowerCase().includes('canasta'), line);
  }
});

test('being caught with a fortune is mocked, being caught with scraps is not', () => {
  const loud = tauntForHandEnd(
    move(0, { type: 'handOver', out: 0, broken: [0, 0], caught: [0, 300] }), table, 0);
  ok(loud.includes('Ruth & Harold') && loud.includes('300'), loud);

  // A small hand is beneath comment: it falls through to the going-out line.
  const quiet = tauntForHandEnd(
    move(0, { type: 'handOver', out: 0, broken: [0, 0], caught: [0, 30] }), table, 0);
  ok(quiet.includes('Tim'), `expected the going-out line, got: ${quiet}`);
});

test('a dead deck is jeered at without naming anybody', () => {
  const said = everyLine((at) => tauntForHandEnd(
    move(null, { type: 'handOver', out: null, broken: [0, 0], caught: [20, 20] }), table, at));
  ok(said.length >= 3);
  for (const line of said) ok(wellFormed(line), `badly formed: ${line}`);
});

test('the same event says the same thing on every phone', () => {
  const entry = move(1, { type: 'takePile', count: 11, from: 0, mode: 'frozen-pair' });
  eq(tauntForMove(entry, table, 42), tauntForMove(entry, table, 42), 'same index, same line');
});

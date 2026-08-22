# Handoff — Canasta, Fifty Years

Updated 21 August 2026, end of the second working session.
Read this first when picking the project back up.

**Deadline: 28 August 2026.** A gift for Tim and Jonelle, whose fiftieth
wedding anniversary is 18 September 2026. Rule accuracy outranks everything
else: they have played Canasta for fifty years and will catch a wrong rule.

## Where it stands

| | |
|---|---|
| Live | <https://zrotuno.github.io/canasta/> — permanent link, never changes |
| Repo | <https://github.com/zrotuno/canasta> — every push to `main` deploys in ~20s |
| Tests | 128, all passing, at `/canasta/tests/` |
| Database | Firestore `canasta-2d40e`, rules published and verified |

Finished and playable. Four people on four phones, or fewer people and some
computers. Installs to a home screen on iPhone and Android.

## The house rules, as settled with the user

Do not "fix" these toward standard Canasta. `canasta/README.md` is the
authority; trust it over memory.

- **draw two** from the stock, discard one, so hands grow a card a turn
- **two decks** (108 cards). They were shown data that three plays better and
  chose two: it is how the family plays at home
- **two canastas** before a side may go out
- a side **caught with cards pays out of its table**: card points, then whole
  canasta bonuses, then red threes, then goes negative. Nothing is forgiven. A
  canasta broken to cover 5 points forfeits all 500, and that overshoot is the
  *only* way this differs from ordinary subtraction
- the same penalty catches **both** sides when the stock dies with nobody out
- natural canasta 500, mixed 300, all four red threes 800
- red threes are replaced when drawn from the stock and when dealt, and **not**
  replaced when they arrive with the discard pile. That last is the only case
  that can occur, since a red three never reaches a hand and so is never
  discarded

## What exists

**Engine** — six rule bugs found and fixed over the two sessions, each with a
test that failed first. Red threes buried in the pile; black threes on a
going-out discard; the stock running out; melding down to one card with no
legal move left; a frozen pile that was compulsory *and* impossible; moves
applied as the current player whoever sent them.

**Multiplayer** — a seed and a move log in one Firestore document, replayed by
every phone. No server, no second copy of the rules. Two browsers driven
through a whole hand ended on byte-identical state.

**Computer players** — fill any empty chair; a player can hand their seat over
and take it back. Every phone races to write their moves and the transaction
picks a winner, so nothing hosts them. `src/ai/player.js` is pure.

**Action log** — "What happened" panel on the board, newest first, whole hand,
scrollable. Says *how* a pile was won and whether a discard froze it. Reports
how many cards were drawn and never which; there is a test asserting no card
identity ever reaches the log.

**The heckler** — `src/ui/taunts.js`. Large text floating above the pile on a
freeze, a pile take, or a natural canasta, and a verdict on the handover
screen for going out, being caught with 120+, breaking a canasta, or a dead
deck. Five lines each, savage, aimed at the play and never the player. The
line is picked from the event's index in the log so every phone shows the
same one. It holds six seconds rather than strictly until the next action,
because a computer plays a whole turn in under a second.

## Settled, do not re-investigate

**The frozen pile is not broken.** The user reported an opposing team taking a
frozen pile immediately. Five tests reproduce the exact scenario and the engine
refuses every illegal route: one natural plus a wild, an existing meld of that
rank, two deuces against a wild on top. The likely explanation is that taking a
pile empties it, so the next discard starts a fresh unfrozen pile. The action
log will now say which route was used if it happens again.

## What to do next, in order

1. **Live test on four real phones.** Still never done. Four people, twenty
   minutes, and the highest-value task remaining by some distance.
2. **Party-proofing.** Bad wifi, a phone sleeping mid-turn, two people tapping
   at once, someone force-quitting Safari.
3. **Ask Tim and Jonelle:** can you go out concealed on a turn where you took
   the discard pile? Published rules disagree, it is worth 100 points, the
   engine currently says yes, and this has been open since day one.
4. **Verify the API key restriction** saved in the Google Cloud console
   (Application restrictions → Websites). The GitHub secret-scanning alert was
   closed as a false positive on the understanding it would be done.

Left until after the party on purpose: binding seats to Firebase anonymous
auth. The app and engine already stop a player acting as another seat; only a
hand-crafted request could.

## Things that will waste your time if you do not know them

- **No Node and no Python.** No build step, no `npm install`. Firebase loads
  from its CDN as ES modules. Keep it that way.
- **Tests run in a browser**, not a terminal: `/canasta/tests/`. The page title
  reads PASS or FAIL and the console logs `TEST_SUMMARY`.
- **The shell eats `${...}`, `$(...)` and backticks.** This cost time four
  separate times across two sessions, in `perl -0pi -e "..."` and in `sed`,
  producing silent corruption like `197609'seat-swap')` and template literals
  with the middles missing. **Use the Edit tool for anything containing a
  template literal, a `$(`, or a backtick.** Single-quote the program if you
  must use `sed`.
- **The service worker is off on localhost** on purpose. It once served an
  hour-old engine. If an edit seems not to apply, check
  `navigator.serviceWorker.controller` first.
- **Firestore rules pin the exact field list** of a game document. A new field
  means the user must republish `canasta/firestore.rules` by hand in the
  console — only they can do that.
- **The AI is the best test here.** `chooseMove` is pure, so two hundred
  self-played hands run in a second, and it has found two rule bugs no unit
  test would have. Run it after any engine change.
- **Rig test hands above the opening minimum.** Three low cards is 15 against a
  50-point minimum, and this has produced a false failure four times. Set
  `hasMelded = true` when the case is not about opening.

## Running it

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

- Game: <http://localhost:8080/canasta/>
- Tests: <http://localhost:8080/canasta/tests/>
- Self-play: `canasta/tools/bot.js`, or import `src/ai/player.js` and loop
  `chooseMove` through `applyMove`.

Committing to `main` deploys. The user does not want to run git themselves.

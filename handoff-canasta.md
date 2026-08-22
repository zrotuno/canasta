# Handoff — Canasta, Fifty Years

Written 21 August 2026, at the end of the first two days of work.
Read this first when picking the project back up.

**Deadline: 28 August 2026.** A gift for Tim and Jonelle, whose fiftieth
wedding anniversary is 18 September 2026. Rule accuracy outranks everything
else: they have played Canasta for fifty years and will catch a wrong rule.

## Where it stands

| | |
|---|---|
| Live | <https://zrotuno.github.io/canasta/> — permanent link, never changes |
| Repo | <https://github.com/zrotuno/canasta> — every push to `main` deploys in ~20s |
| Tests | 106, all passing, at `/canasta/tests/` |
| Database | Firestore project `canasta-2d40e`, rules published and verified |

The game is finished and playable. Four people on four phones, or fewer people
and some computers. It installs to a home screen on iPhone and Android.

## What was built

**The engine** was already there on day one and was mostly right. Six rule bugs
were found and fixed, each with a test that failed first:

- red threes buried in the discard pile were dealt into the taker's hand
- black threes could not be melded when going out with a final discard
- the stock running out ended the hand instead of continuing on the pile
- melding down to one card left a player with no legal move at all
- a frozen pile matching your own meld was compulsory *and* impossible to take
- the engine applied any move as the current player, whoever actually sent it

**Multiplayer** is a seed and a move log in one Firestore document. Every phone
replays it through the same engine, so there is no server and no second copy of
the rules. Verified: two browsers driven through a whole hand ended on
byte-identical state.

**Computer players** fill any empty chair, and a player can hand their seat over
and take it back. Every phone races to write the computers' moves and the
append transaction picks a winner, so no phone hosts them.

**The house rules** the family actually plays, all confirmed by the user:

- draw **two** from the stock, discard one, so hands grow
- two decks (108 cards) — *not* three, this was asked and settled
- **two canastas** required before a side may go out
- a side caught with cards pays out of its table: card points, then whole
  canasta bonuses, then red threes, then goes negative. A canasta broken to
  cover 5 points forfeits all 500 — that overshoot is the only way this differs
  from ordinary subtraction
- the same penalty applies to **both** sides when the stock dies with nobody out
- natural canasta 500, mixed 300, all four red threes 800 (these were already
  correct and needed no change)

`canasta/README.md` documents every rule as implemented. Trust it over memory.

## What to do next, in order

1. **Live test on four real phones.** The one thing never done. It needs four
   people and twenty minutes, and it is the highest-value remaining task.
2. **Party-proofing.** Bad wifi, a phone sleeping mid-turn, two people tapping
   at once, someone force-quitting Safari.
3. **Ask Tim and Jonelle one open question:** can you go out concealed on a turn
   where you took the discard pile? Published rules disagree, it is worth 100
   points, and the engine currently says yes. This has been open since day one.
4. **Verify the API key restriction** in the Google Cloud console got saved
   (Application restrictions → Websites, plus optionally Cloud Firestore API).
   The GitHub secret-scanning alert was closed as a false positive on the
   understanding it would be done.

Deliberately left until after the party: binding seats to Firebase anonymous
auth, so a hand-crafted request cannot play as another seat. The app and engine
already prevent it; only the raw protocol allows it.

## Things that will waste your time if you do not know them

- **No Node and no Python on this machine.** No build step, no `npm install`.
  Firebase loads from its CDN as ES modules. Keep it that way.
- **Tests run in a browser**, not a terminal: `/canasta/tests/`. The page title
  says PASS or FAIL and the console prints `TEST_SUMMARY`.
- **The service worker is disabled on localhost** on purpose. It once spent an
  hour serving an older engine than the one on disk. If a change seems not to
  take, that is the first suspect — check `navigator.serviceWorker.controller`.
- **`perl -0pi -e "..."` in bash eats `$(`, `${` and backticks.** Three separate
  substitutions were mangled that way. Use the Edit tool for anything with a
  template literal in it.
- **Firestore rules validate the exact field list** of a game document. Adding a
  field to the document means republishing `canasta/firestore.rules` by hand in
  the console, which only the user can do.
- **The AI is the best test the project has.** `chooseMove` is pure, so two
  hundred hands of self-play run in a second and have found two real rule bugs.
  Run it after any engine change.

## Running it

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

- Game: <http://localhost:8080/canasta/>
- Tests: <http://localhost:8080/canasta/tests/>
- Self-play, from the console on either page: see `canasta/tools/bot.js`, or
  import `src/ai/player.js` and loop `chooseMove` through `applyMove`.

Committing to `main` deploys. The user does not want to run git themselves.

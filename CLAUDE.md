# DEV

Two browser card games, no build step and no toolchain. **This machine has no
Node and no Python**: nothing here may need `npm install`, and libraries load
from a CDN as ES modules.

- `canasta/` — Canasta, Fifty Years. The live project. Read
  **`handoff-canasta.md`** before working on it, and `canasta/README.md` for
  the rules exactly as implemented.
- `src/`, `index.html` at the root — an older Spite and Malice game. Not under
  active development.

## Running and testing

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Canasta at <http://localhost:8080/canasta/>, its tests at
<http://localhost:8080/canasta/tests/>. **Tests run in the browser**, not a
terminal: the page title reads PASS or FAIL and the console logs
`TEST_SUMMARY`. Run them after every change.

Canasta deploys to <https://zrotuno.github.io/canasta/> on every push to
`main`, in about twenty seconds. The user asked not to have to run git; commit
and push for them.

## House rules matter more than correctness in the abstract

Canasta is built to one family's rules, not the textbook. Draw two, two decks,
two canastas to go out, and a caught side pays out of its table. Check
`canasta/README.md` before "fixing" anything that looks wrong.

## Traps

- **The shell eats `${...}`, `$(...)` and backticks**, in `perl -0pi -e "..."`
  and in `sed` alike. It corrupts files silently. **Use the Edit tool for
  anything containing a template literal, a `$(`, or a backtick.**
- **Rig test hands above the opening minimum.** Three low cards is 15 against a
  50-point minimum, which has produced a false failure four times now. Set
  `hasMelded = true` when the case is not about opening.
- **The service worker is deliberately off on localhost.** It once served an
  hour-old engine. If an edit seems not to apply, check
  `navigator.serviceWorker.controller` first.
- **Firestore rules pin the exact field list** of a game document. A new field
  means the user must republish `canasta/firestore.rules` by hand.
- **`src/ai/player.js` is pure**, so two hundred self-played hands run in a
  second. It has already found two rule bugs no unit test would have. Use it.

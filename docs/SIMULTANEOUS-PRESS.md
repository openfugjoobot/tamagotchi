# Simultaneous button presses (SELECT+NEXT = A+C), end-to-end

Status: implemented (branch `feat/simultaneous-press`, base `b51afc7`).

## Problem

The server owns the pet, and the browser only relays discrete
`{t:"press", btn}` events. The server's `PetEmulator.press()` enqueues one
button per click and materialises each as an **isolated** down→up hold
(400 ms down, 400 ms up), *one button at a time*. Two buttons therefore can
**never** be LOW in the same sampled frame.

The real P1 firmware samples the button matrix per frame. Its **sound toggle
is A+C held together** (SELECT+NEXT) and several clock-set / menu actions are
two-button combinations. With the sequential model those combinations never
reach the ROM: pressing A then C is not the same as A+C.

### Proof against the real ROM (P1, `public/emu/rom0.bin`)

Engage the mute (A+C) right after the clock-set, then neglect the pet ~15 min
and count piezo activity:

| input            | `emu_en()` highs | `emu_take_buzzer()` latches |
|------------------|------------------|-----------------------------|
| none             | 98               | 113                         |
| **A+C together** | **0**            | **1**  → sound muted        |
| A then C (seq)   | 99               | 112  → unchanged, no toggle |

Both pins must be LOW *in the same frame* for the toggle to register.

## Fix

Carry the **button down/up state** on the wire, and give the server a
**held-set** input model that can assert any combination of buttons at once —
while keeping the time-exploit invariant (buttons never mint emulated time).

### Protocol (`ws.ts` ↔ `net/live.ts`)

- `{t:"btn", btn, down}` — an explicit edge: `down:true` asserts, `down:false`
  releases. Several buttons may be asserted at once.
- `{t:"press", btn}` stays accepted (legacy/back-compat): the server treats it
  as a self-contained tap (`down` then a deferred `up`), exactly as before.

### Server model (`server/src/emulator.ts`)

`press(btn, down?)`:
- `down === undefined` → **legacy tap**: assert now, defer the release by at
  least `PRESS_HOLD_MS` (a full down→up cycle, as today).
- `down === true` → assert and hold until an explicit release.
- `down === false` → release; but a button is never released before its
  minimum hold (`PRESS_HOLD_MS`) has been paid, so a quick tap still reaches
  the ROM as a distinct edge.

`step(ms)` walks the owed real-time budget in segments, applying edges as they
become due and running the CPU with the *actual* held-set asserted. The
**total** steps stay exactly `floor(owedUnits / TS_PER_STEP)` — input only
changes *when* the CPU runs and *which pins* are LOW, never *how much* time is
granted. A hold/gap not fully paid within a call continues on the next `step`.

Overlap is therefore real: `down(A)` then `down(C)` with both released later
holds A and C LOW across the same frames → the ROM sees A+C.

### Client (`src/main.ts`)

The client already tracks pressed logical buttons. It now forwards **both**
edges: `live.pressDown(btn)` on pointer/key down and `live.pressUp(btn)` on the
global release path, so a physical two-finger press (A+C) is sent as two
overlapping holds.

## Verification

- Unit (`tests/emu-simultaneous-press.test.ts`) — real ROM: A+C together mutes
  the piezo, A-then-C does not; the hold path grants no extra emulated time.
- Protocol (`tests/server-ws.test.ts`, `tests/live-client.test.ts`) — explicit
  down/up edges forwarded, simultaneity preserved through hub and client.
- End-to-end (`tests/server-simultaneous-e2e.test.ts`) — the real entrypoint,
  real `PetEmulator`, real P1 ROM: `{t:"btn"}` down(A)+down(C) over a raw WS
  client leaves two pins held at once.
- Regression (`tests/emu-time-exploit.test.ts`) — stays green: no extra time.

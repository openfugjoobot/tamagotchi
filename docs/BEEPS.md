# Beeps — measured behaviour (2026-10-17)

Probe: `tests/emu-beep-probe.test.ts`, 2 simulated days without feeding, 0.2 s
sampling (plus a finer 0.05 s pass for burst structure). Host: fugjoo, node
v26.10.0, P1-ROM `rom0.bin`, WASM `public/emu/tamalib.wasm`.

This replaces the unverified spec **Anhang A4** ("not measured this session").

## Measured numbers

- `emu_take_buzzer()` fired: **680** times over 2 simulated days (0.2 s sampling)
  — first beeps at t = 0, 15.6, 16.0, 16.2, 16.6, 16.8, 17.2, 17.6, 17.8, 18.2 …
- `emu_en()` was high for **685** samples over the same run.
- At 0.05 s sampling the same run yields **878** latch events; the latch fires
  once per piezo burst (878 latches ≈ 840 bursts, ~1.05 per burst). The 0.2 s
  figure (680) undercounts because a whole burst can fit inside one sample.
- Piezo frequencies observed: **23 406 Hz, 27 307 Hz, 32 768 Hz**.
- Burst duration: min 0.05 s, max 2.45 s, average **0.16 s**. A burst is a
  two-tone chirp: a short ~27 307 Hz blip immediately followed by a longer
  ~23 406 Hz tone, then the buzzer is off again.
- Burst cadence in the steady state (hours 5–11): bursts arrive in clusters of
  8–14 chirps (chirp-to-chirp gap 0.1–0.45 s), then a long quiet gap of
  114 s – 2 985 s. That is **36–54 latch events per simulated hour**, i.e. a beep
  cluster roughly every few minutes.

Latch events per simulated hour (0.05 s sampling):

| Hour | 0 | 1 | 2–4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12–47 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Latches | 527 | 73 | 0 | 36 | 36 | 36 | 36 | 54 | 36 | 44 | **0** |

Hour 0 (527) is the boot/setup churn right after the clock is set, including a
latch at t = 0. It is not representative of a running pet.

## On death

The pet dies at **41 200 s** (≈ 11.44 h into the neglect run) — the angel frame
diff hits 0 there (death detection: `isAngelFrame`, see Anhang A3).

- The buzzer goes **silent at death and stays silent**: hours 12–47 after death
  produce **0** latch events (verified over a full 48 h run).
- The last latch ever observed fires at **41 204.1 s** — the tail of the final
  burst straddles the death instant, so the buzzer settles within ~4 s of death.
  No beep follows.

## Conclusion

The buzzer latch **does fire** — `emu_take_buzzer()` is a usable, debounceable
signal, so the fallback to raw `emu_en()` edge detection is **not** needed. The
server path in Task 4/7 reads the latch as designed.

Implications for the debounce window:

- Beeps cluster in short bursts with multi-minute gaps, so a per-pet debounce of
  `DEBOUNCE_MS = 60_000` (Task 7) is safe: it cannot swallow two distinct
  attention bursts, since the observed quiet gap is ≥ 114 s.
- Beeps stop at death, so no extra death-muting is required — the latch simply
  goes quiet once the angel frame appears.

## Sampler cadence: why the LCD tick is too coarse (2026-10-17)

The live beep level (`emu_freq()`/`emu_en()`) was originally sampled only on the
LCD tick (125 ms). Re-measured on the same host/ROM, ~200 s of a running pet,
ground truth at 5 ms sampling: **36 chirp bursts**, duration min **50 ms**, max
225 ms, avg 136 ms — **18 of 36 bursts are shorter than 125 ms**. Simulating a
diff-only sampler at each cadence against that ground truth:

| Sampler interval | Bursts detected (of 36) | Avg latency | Max latency |
| --- | --- | --- | --- |
| 125 ms (original tick) | **27 (75 %)** | **57 ms** | **125 ms** |
| 62.5 ms | 33 (92 %) | 31 ms | 60 ms |
| 30 ms | 36 (100 %) | 16 ms | 30 ms |
| **20 ms (shipped)** | **36 (100 %)** | **12 ms** | **20 ms** |

At 125 ms a quarter of the chirps never reach the browser and the rest lag up to
one tick. The shipped **`BUZZER_SAMPLE_MS = 20 ms`** dedicated sampler
(`server/src/ws.ts` `sampleBuzzers()`, driven from `server/src/main.ts`) captures
every burst within ~12 ms. It is **state-read only** — it never takes an emulator
step, so it grants no emulated time.

Separately, the client (`src/emu/audio.ts`) now **re-articulates** a repeated
identical tone: a fresh on-edge restarts the oscillator (phase reset) instead of
only bumping the gain, so two equal chirps are heard as two chirps, not one
continuous tone.

## Lossless tone-event stream (2026-10-17)

Even at 20 ms a *level* sampler is not lossless: a chirp that starts and ends
between two samples is gone. The HAL glue now records **every** piezo transition
into a 512-slot ring (`emu/src/glue.c`, read by `PetEmulator.takeToneEvents()`),
and the server forwards the ordered stream as `{t:"tones", ev:[{at,freq,play},…]}`.

Measured on the real P1 ROM (same host, clock-set, then a running pet):

- The ROM writes its buzzer registers in a tight poll loop: **7 329 141 writes**
in 200 s, against **786 real chirp bursts**. Recording every write would be a
write avalanche, not a recording — so the glue keeps only genuine `(freq, play)`
**transitions**.
- After collapsing to transitions: **2349 events / 20 min**, with at most **2**
returned in a single 125 ms tick read (max batch observed at 20 ms sampling: 58).
The 512-slot ring never overflows in normal operation.
- A measured chirp is preserved exactly as a **two-tone chirp**: a ~1.7 ms
`27307` blip (`set_frequency` off → on → off) immediately followed by a ~7 ms
`23406` tone (`set_frequency` off → on → off). Transition timestamps rise strictly.
- Frequencies seen as transitions: `27307`, `23406`, `32768`, `20480`, `16384`,
`13653`, `11703` — the full ROM tone set (docs/BEEPS.md above).
- **No hanging tone on batch supersede:** of 53 consecutive 20 ms batches, **0**
end audible while the next begins audible, so cancelling an old replay plan can
never leave the piezo stuck on.

The client (`src/emu/tone-replay.ts`) turns each event's `at` into a wall-clock
delay relative to the batch anchor (`at - at0`, µs → ms) and drives the same
`emu/audio.ts` piezo, so a burst plays back with its real duration and shape —
not collapsed to a click and not shifted by network latency.

/* Glue: HAL-Implementierung + Exporte für TamaLIB → WASM */
#include "tamalib.h"
#include "hw.h"

#define ROM_BYTES 16384
#define ROM_WORDS (ROM_BYTES / 2)

static unsigned char rom_raw[ROM_BYTES];
static u12_t rom_prog[ROM_WORDS];
static u8_t lcd_buf[LCD_WIDTH * LCD_HEIGHT];
static u8_t icon_buf[ICON_NUM];
static u32_t buzzer_freq = 0;
static bool_t buzzer_en = 0;
static bool_t buzzer_latch = 0;
static timestamp_t now_us = 0;

/*
 * Verlustfreier Ton-Ereignisring.
 *
 * Jeder HAL-Aufruf, der den Piezo veraendert (set_frequency/play_frequency),
 * wird als (Zeitstempel, Frequenz, Enable) aufgezeichnet. Der bisherige Pfad
 * liefert nur den *Pegel* (buzzer_freq/buzzer_en) und ein Latch (buzzer_latch),
 * das vom Abtaster konsumiert wird; beides ist verlustbehaftet: ein Chirp, der
 * zwischen zwei Abtastungen beginnt und endet, ist verschwunden, bevor er
 * gelesen wird. Der Ring haelt die exakte Reihenfolge und Dauer fest.
 *
 * Der Ring fasst TONE_RING_CAP Eintraege; laeuft er voll, ueberschreibt die
 * aeltesten Eintraege (der Leser holt jeweils alles ab, was seit dem letzten
 * Aufruf dazukam). Der Zeiger wird nur von einem einzigen Leser (dem Server)
 * vorgespult, daher genuegt ein einfacher Schreib-/Lese-Index.
 */
#define TONE_RING_CAP 512

typedef struct {
  u32_t ts;    /* Emulatorzeit in us (now_us) zum Zeitpunkt der Aenderung */
  u32_t freq;  /* zuletzt gesetzte Frequenz in dHz (0 = noch keine) */
  u32_t play;  /* 1 = hörbar, 0 = still */
} tone_ev_t;

static tone_ev_t tone_ring[TONE_RING_CAP];
static u32_t tone_head = 0;   /* naechster Schreibplatz */
static u32_t tone_tail = 0;   /* aeltester noch nicht gelesener Eintrag */

static void tone_push(u32_t play) {
  tone_ring[tone_head].ts = now_us;
  tone_ring[tone_head].freq = buzzer_freq;
  tone_ring[tone_head].play = play;
  tone_head = (tone_head + 1u) % TONE_RING_CAP;
  /* Voll: aeltesten Eintrag verwerfen, damit der Ring nie ueberlaeuft. */
  if (tone_head == tone_tail) tone_tail = (tone_tail + 1u) % TONE_RING_CAP;
}

/*
 * Letzter aufgezeichneter Zustand (freq, play). Das ROM schreibt seine
 * Buzzer-Register in einer engen Poll-Schleife: dieselbe (freq, play)-Kombi
 * wiederholt sich millionenfach, ohne dass sich der Klang aendert. Nur eine
 * echte *Transition* ist ein Ton-Ereignis — ein Push bei jedem Write waere
 * nicht verlustfrei, sondern eine Lawine redundanter Eintraege (gemessen: 7,3
 * Mio. Writes in 200 s gegen 786 echte Bursts am selben ROM). Wir zeichnen
 * deshalb nur auf, wenn sich (freq, play) gegenueber dem letzten Eintrag
 * aendert; die Reihenfolge und die exakten Zeitstempel der Uebergaenge bleiben
 * erhalten.
 */
static u32_t tone_last_freq = 0;
static u32_t tone_last_play = 0;
static bool_t tone_have_last = 0;

static void tone_emit(u32_t play) {
  if (tone_have_last && tone_last_freq == buzzer_freq && tone_last_play == play) return;
  tone_have_last = 1;
  tone_last_freq = buzzer_freq;
  tone_last_play = play;
  tone_push(play);
}

/* ---- HAL ---- */
static void *h_malloc(u32_t size) { (void)size; return 0; }
static void h_free(void *p) { (void)p; }
static void h_halt(void) {}
static bool_t h_is_log_enabled(log_level_t level) { (void)level; return 0; }
static void h_log(log_level_t level, char *buff, ...) { (void)level; (void)buff; }
static void h_sleep_until(timestamp_t ts) { now_us = ts; }
static timestamp_t h_get_timestamp(void) { return now_us; }
static void h_update_screen(void) {}
static void h_set_lcd_matrix(u8_t x, u8_t y, bool_t val) {
  if (x < LCD_WIDTH && y < LCD_HEIGHT) lcd_buf[y * LCD_WIDTH + x] = val ? 1 : 0;
}
static void h_set_lcd_icon(u8_t icon, bool_t val) { if (icon < ICON_NUM) icon_buf[icon] = val ? 1 : 0; }
static void h_set_frequency(u32_t freq) {
  buzzer_freq = freq;
  /* Nur ein tatsaechlicher Wechsel ist ein Ton-Ereignis (kein Doppel bei
   * wiederholtem Schreiben derselben Frequenz durch das ROM). */
  tone_emit(buzzer_en);
}
static void h_play_frequency(bool_t en) {
  buzzer_en = en;
  if (en) buzzer_latch = 1;
  tone_emit(en);
}
static int h_handler(void) { return 0; }

static hal_t hal = {
  h_malloc, h_free, h_halt, h_is_log_enabled, h_log,
  h_sleep_until, h_get_timestamp, h_update_screen,
  h_set_lcd_matrix, h_set_lcd_icon, h_set_frequency, h_play_frequency, h_handler,
};

/* ---- Exporte ---- */
void emu_rom_byte(u32_t i, u32_t v) { if (i < ROM_BYTES) rom_raw[i] = (unsigned char)v; }

void emu_init(void) {
  for (u32_t i = 0; i < ROM_WORDS; i++) {
    /* ROM liegt 16-bit big-endian pro Instruktion vor */
    rom_prog[i] = (u12_t)(((unsigned short)rom_raw[i * 2] << 8) | (unsigned short)rom_raw[i * 2 + 1]) & 0xFFF;
  }
  tamalib_register_hal(&hal);
  tamalib_init(rom_prog, 0, 32768);
  tamalib_set_exec_mode(EXEC_MODE_RUN);
}

void emu_step(void) { tamalib_step(); }
void emu_step_n(u32_t n) { for (u32_t i = 0; i < n; i++) tamalib_step(); }
void emu_advance(u32_t us) { now_us += us; }
void emu_set_button(u32_t btn, u32_t state) {
  tamalib_set_button((button_t)btn, state ? BTN_STATE_PRESSED : BTN_STATE_RELEASED);
}
u8_t *emu_lcd(void) { return lcd_buf; }
u8_t *emu_icons(void) { return icon_buf; }
u32_t emu_freq(void) { return buzzer_freq; }
u32_t emu_en(void) { return buzzer_en; }
u32_t emu_take_buzzer(void) { u32_t v = buzzer_latch; buzzer_latch = 0; return v; }
u32_t emu_now(void) { return now_us; }
u32_t emu_lcd_pixels(void) {
  u32_t n = 0;
  for (u32_t i = 0; i < LCD_WIDTH * LCD_HEIGHT; i++) n += lcd_buf[i] ? 1u : 0u;
  return n;
}

/* ---- Verlustfreier Ton-Ereignisring ---- */

u32_t emu_tone_head(void) { return tone_head; }
u32_t emu_tone_tail(void) { return tone_tail; }
/* Zeitstempel des aeltesten nicht gelesenen Ereignisses (us); 0 wenn leer. */
u32_t emu_tone_ts(u32_t slot) { return slot < TONE_RING_CAP ? tone_ring[slot].ts : 0; }
u32_t emu_tone_freq(u32_t slot) { return slot < TONE_RING_CAP ? tone_ring[slot].freq : 0; }
u32_t emu_tone_play(u32_t slot) { return slot < TONE_RING_CAP ? tone_ring[slot].play : 0; }
/* Liest alle ausstehenden Ereignisse ab: die Gelesen-Marke rueckt auf head. */
u32_t emu_tone_consume(void) { tone_tail = tone_head; return tone_tail; }

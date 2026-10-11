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
static timestamp_t now_us = 0;

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
static void h_set_frequency(u32_t freq) { buzzer_freq = freq; }
static void h_play_frequency(bool_t en) { buzzer_en = en; }
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
void emu_advance(u32_t us) { now_us += us; }
void emu_set_button(u32_t btn, u32_t state) {
  tamalib_set_button((button_t)btn, state ? BTN_STATE_PRESSED : BTN_STATE_RELEASED);
}
u8_t *emu_lcd(void) { return lcd_buf; }
u8_t *emu_icons(void) { return icon_buf; }
u32_t emu_freq(void) { return buzzer_freq; }
u32_t emu_en(void) { return buzzer_en; }
u32_t emu_now(void) { return now_us; }

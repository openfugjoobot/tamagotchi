// Alle localStorage-Schlüssel an einer Stelle – verhindert Kollisionen.
/** Alter Schluessel vor dem P1/P2-Umbau. Bleibt fuer die Migration erhalten. */
export const EMU_KEY_LEGACY = "tamagotchi.emu.v1";
export const EMU_KEY_P1 = "tamagotchi.emu.v1.p1";
export const EMU_KEY_P2 = "tamagotchi.emu.v1.p2";
/** Zuletzt gewaehltes Geraet. */
export const DEVICE_KEY = "tamagotchi.device";
export const SOUND_KEY = "tamagotchi.sound";
export const SHELL_KEY = "tamagotchi.shell";
export const BG_KEY = "tamagotchi.bg";
export const NOTIFY_KEY = "tamagotchi.notify";
/** Einmaliger Install-Hinweis wurde weggeklickt. */
export const DISMISS_KEY = "tamagotchi.install.dismissed";
/** Google-ID-Token. localStorage, damit die Anmeldung das Schliessen des Tabs
 *  ueberlebt; die Gueltigkeit wird ueber die exp-Claim geprueft. */
export const IDTOKEN_KEY = "tamagotchi.idtoken.v1";

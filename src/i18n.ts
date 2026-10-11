export type Lang = "de" | "en" | "it";
export const LANGS: Lang[] = ["de", "en", "it"];
export const LANG_KEY = "***";

type Dict = Record<string, string>;

const DICT: Record<Lang, Dict> = {
  en: {
    loading: "loading …",
    catchingUp: "catching up …",
    menu: "Menu",
    shell: "Shell",
    background: "Background",
    sound: "Sound",
    notifications: "Notifications",
    guide: "Guide",
    restart: "Restart",
    language: "Language",
    install: "Install app",
    on: "on",
    off: "off",
    play: "← Play",
    modalTitle: "Restart?",
    modalBody: "Your current progress will be discarded and a new egg begins.",
    cancel: "Cancel",
    restartBtn: "Restart",
    footerFirmware: "firmware via",
    guideEyebrow: "Tamagotchi P1",
    guideTitle: "How to play",
    guideSub: "Your egg hatches in a few minutes. Feed it, play with it, tidy up after it — and watch it grow. It saves as you go.",
    iconsTitle: "The menu",
    iconsLead: "SELECT scrolls through it, CONFIRM picks, NEXT backs out.",
    step1: "Set the clock. CONFIRM moves between the fields, SELECT changes the value.",
    step2: "Wait for the hatch. The egg cracks open after about five minutes.",
    step3: "Feed it. Pick the bowl with SELECT, then CONFIRM — a meal or a snack.",
    step4: "Look after it. Lights off while it sleeps, a bath when it's messy, medicine when it's unwell, a gentle scold when it's naughty.",
    notifyTitle: "Your Tamagotchi needs you",
    notifyBody: "It's calling — feed it, clean up or play.",
    installTitle: "Install as app",
    installBody: "Add to your home screen for fullscreen & offline.",
    installBtn: "Install",
    installLater: "Later",
    icons: "Food,Light,Game,Medicine,Bath,Status,Discipline,Attention",
  },
  de: {
    loading: "lädt …",
    catchingUp: "Aufholen …",
    menu: "Menü",
    shell: "Gehäuse",
    background: "Hintergrund",
    sound: "Ton",
    notifications: "Benachrichtigungen",
    guide: "Anleitung",
    restart: "Neu starten",
    language: "Sprache",
    install: "App installieren",
    on: "an",
    off: "aus",
    play: "← Spielen",
    modalTitle: "Wirklich neu starten?",
    modalBody: "Der aktuelle Stand wird verworfen und ein neues Ei beginnt.",
    cancel: "Abbrechen",
    restartBtn: "Neu starten",
    footerFirmware: "Firmware via",
    guideEyebrow: "Tamagotchi P1",
    guideTitle: "So spielst du",
    guideSub: "Dein Ei schlüpft in ein paar Minuten. Füttere es, spiele mit ihm, räume hinter ihm auf – und sieh zu, wie es wächst. Es speichert automatisch.",
    iconsTitle: "Das Menü",
    iconsLead: "SELECT blättert durch, CONFIRM wählt, NEXT geht zurück.",
    step1: "Uhr stellen. CONFIRM wechselt die Felder, SELECT ändert den Wert.",
    step2: "Schlüpfen abwarten. Nach rund fünf Minuten platzt das Ei auf.",
    step3: "Füttern. Mit SELECT zum Napf, dann CONFIRM – Mahlzeit oder Snack.",
    step4: "Kümmern. Licht aus beim Schlafen, baden wenn es schmutzig ist, Medizin bei Krankheit, sanft schimpfen wenn es frech ist.",
    notifyTitle: "Dein Tamagotchi braucht dich",
    notifyBody: "Es ruft – füttere, räume auf oder spiele.",
    installTitle: "Als App installieren",
    installBody: "Zum Home-Bildschirm hinzufügen für Vollbild & offline.",
    installBtn: "Installieren",
    installLater: "Später",
    icons: "Futter,Licht,Spiel,Medizin,Bad,Status,Disziplin,Aufmerksamkeit",
  },
  it: {
    loading: "caricamento …",
    catchingUp: "recupero …",
    menu: "Menu",
    shell: "Scocca",
    background: "Sfondo",
    sound: "Audio",
    notifications: "Notifiche",
    guide: "Guida",
    restart: "Riavvia",
    language: "Lingua",
    install: "Installa app",
    on: "on",
    off: "off",
    play: "← Gioca",
    modalTitle: "Riavviare?",
    modalBody: "I progressi attuali verranno eliminati e inizierà un nuovo uovo.",
    cancel: "Annulla",
    restartBtn: "Riavvia",
    footerFirmware: "firmware via",
    guideEyebrow: "Tamagotchi P1",
    guideTitle: "Come si gioca",
    guideSub: "Il tuo uovo si schiude in pochi minuti. Nutrilo, gioca con lui, pulisci – e guardalo crescere. Salva da solo.",
    iconsTitle: "Il menu",
    iconsLead: "SELECT scorre, CONFIRM seleziona, NEXT torna indietro.",
    step1: "Imposta l'orologio. CONFIRM cambia campo, SELECT cambia il valore.",
    step2: "Aspetta la schiusa. L'uovo si apre dopo circa cinque minuti.",
    step3: "Nutrilo. Con SELECT vai alla ciotola, poi CONFIRM – pasto o snack.",
    step4: "Prenditene cura. Luce spenta quando dorme, bagno quando è sporco, medicina se sta male, un rimprovero se è monello.",
    notifyTitle: "Il tuo Tamagotchi ha bisogno di te",
    notifyBody: "Ti sta chiamando – dagli da mangiare, pulisci o gioca.",
    installTitle: "Installa come app",
    installBody: "Aggiungi alla schermata home per schermo intero e offline.",
    installBtn: "Installa",
    installLater: "Dopo",
    icons: "Cibo,Luce,Gioco,Medicina,Bagno,Stato,Disciplina,Attenzione",
  },
};

export function currentLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "de" || v === "en" || v === "it") return v;
  } catch { /* ignore */ }
  const n = (navigator.language || "en").slice(0, 2).toLowerCase();
  return n === "de" ? "de" : n === "it" ? "it" : "en";
}

export function setLang(l: Lang): void {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
}

export function t(key: string): string {
  const l = currentLang();
  return DICT[l][key] ?? DICT.en[key] ?? key;
}

export function iconNames(): string[] {
  return t("icons").split(",");
}

/** Wendet alle [data-i18n]/[data-i18n-aria] im Dokument an. */
export function applyI18n(root: Document | HTMLElement = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria!));
  });
}

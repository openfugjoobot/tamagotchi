export type Lang = "de" | "en" | "it";
export const LANGS: Lang[] = ["de", "en", "it"];

type Dict = Record<string, string>;

const DICT: Record<Lang, Dict> = {
  en: {
    loading: "loading …",
    menu: "Menu",
    shell: "Shell",
    background: "Background",
    sound: "Sound",
    notifications: "Notifications",
    guide: "Guide",
    restart: "Restart",
    install: "Install app",
    on: "on",
    off: "off",
    play: "← Play",
    modalTitle: "Restart?",
    modalBody: "Your current progress will be discarded and a new egg begins.",
    cancel: "Cancel",
    restartBtn: "Restart",
    account: "Account",
    accountHint: "Sign in and continue playing on any device.",
    signedInAs: "Signed in as",
    accountSynced: "Your progress is saved to your account automatically.",
    signOut: "Sign out",
    deleteData: "Delete cloud data",
    deleteAccount: "Delete account",
    deleteAccountTitle: "Delete account?",
    deleteAccountBody: "Your cloud save and the save in this browser are deleted — your pet starts over. This cannot be undone.",
    deleteAccountBtn: "Delete",
    privacyTitle: "Account & data",
    privacyBody: "Playing needs no account: your pet is saved in this browser. If you sign in with Google, only your account ID, your email address (for display) and the save file are stored on our side. Signing out and \u201cDelete cloud data\u201d remove them again.",
    footerFirmware: "firmware via",
    footerSource: "source",
    guideEyebrow: "Tamagotchi P1",
    guideTitle: "How to play",
    guideSub: "Your egg hatches in a few minutes. Feed it, play with it, tidy up after it — and watch it grow. It saves as you go.",
    iconsTitle: "The menu",
    iconsLead: "SELECT scrolls through it, CONFIRM picks, NEXT backs out.",
    step1: "<b>Set the clock.</b> CONFIRM moves between the fields, SELECT changes the value.",
    step2: "<b>Wait for the hatch.</b> The egg cracks open after about five minutes.",
    step3: "<b>Feed it.</b> Pick the bowl with SELECT, then CONFIRM — a meal or a snack.",
    step4: "<b>Look after it.</b> Lights off while it sleeps, a bath when it's messy, medicine when it's unwell, a gentle scold when it's naughty.",
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
    menu: "Menü",
    shell: "Gehäuse",
    background: "Hintergrund",
    sound: "Ton",
    notifications: "Benachrichtigungen",
    guide: "Anleitung",
    restart: "Neu starten",
    install: "App installieren",
    on: "an",
    off: "aus",
    play: "← Spielen",
    modalTitle: "Wirklich neu starten?",
    modalBody: "Der aktuelle Stand wird verworfen und ein neues Ei beginnt.",
    cancel: "Abbrechen",
    restartBtn: "Neu starten",
    account: "Konto",
    accountHint: "Melde dich an und spiel auf jedem Gerät weiter.",
    signedInAs: "Angemeldet als",
    accountSynced: "Dein Stand wird automatisch im Konto gesichert.",
    signOut: "Abmelden",
    deleteData: "Cloud-Daten löschen",
    deleteAccount: "Konto löschen",
    deleteAccountTitle: "Konto löschen?",
    deleteAccountBody: "Dein Cloud-Spielstand und der Spielstand in diesem Browser werden gelöscht — das Tier fängt neu an. Das lässt sich nicht rückgängig machen.",
    deleteAccountBtn: "Löschen",
    privacyTitle: "Konto & Daten",
    privacyBody: "Zum Spielen brauchst du kein Konto: dein Tier liegt in diesem Browser. Meldest du dich mit Google an, liegen bei uns nur deine Konto-ID, deine E-Mail-Adresse (zur Anzeige) und der Spielstand. „Abmelden“ und „Cloud-Daten löschen“ entfernen beides wieder.",
    footerFirmware: "Firmware via",
    footerSource: "Quellcode",
    guideEyebrow: "Tamagotchi P1",
    guideTitle: "So spielst du",
    guideSub: "Dein Ei schlüpft in ein paar Minuten. Füttere es, spiele mit ihm, räume hinter ihm auf – und sieh zu, wie es wächst. Es speichert automatisch.",
    iconsTitle: "Das Menü",
    iconsLead: "SELECT blättert durch, CONFIRM wählt, NEXT geht zurück.",
    step1: "<b>Uhr stellen.</b> CONFIRM wechselt die Felder, SELECT ändert den Wert.",
    step2: "<b>Schlüpfen abwarten.</b> Nach rund fünf Minuten platzt das Ei auf.",
    step3: "<b>Füttern.</b> Mit SELECT zum Napf, dann CONFIRM – Mahlzeit oder Snack.",
    step4: "<b>Kümmern.</b> Licht aus beim Schlafen, baden wenn es schmutzig ist, Medizin bei Krankheit, sanft schimpfen wenn es frech ist.",
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
    menu: "Menu",
    shell: "Scocca",
    background: "Sfondo",
    sound: "Audio",
    notifications: "Notifiche",
    guide: "Guida",
    restart: "Riavvia",
    install: "Installa app",
    on: "on",
    off: "off",
    play: "← Gioca",
    modalTitle: "Riavviare?",
    modalBody: "I progressi attuali verranno eliminati e inizierà un nuovo uovo.",
    cancel: "Annulla",
    restartBtn: "Riavvia",
    account: "Account",
    accountHint: "Accedi e continua a giocare su qualsiasi dispositivo.",
    signedInAs: "Connesso come",
    accountSynced: "I progressi vengono salvati automaticamente nel tuo account.",
    signOut: "Esci",
    deleteData: "Elimina dati cloud",
    deleteAccount: "Elimina account",
    deleteAccountTitle: "Eliminare l'account?",
    deleteAccountBody: "Il salvataggio nel cloud e quello in questo browser vengono eliminati — l'animale ricomincia. Azione irreversibile.",
    deleteAccountBtn: "Elimina",
    privacyTitle: "Account e dati",
    privacyBody: "Per giocare non serve un account: il tuo animale resta in questo browser. Se accedi con Google, da noi restano solo l'ID dell'account, l'indirizzo e-mail (per la visualizzazione) e il salvataggio. “Esci” e “Elimina dati cloud” li rimuovono.",
    footerFirmware: "firmware via",
    footerSource: "codice",
    guideEyebrow: "Tamagotchi P1",
    guideTitle: "Come si gioca",
    guideSub: "Il tuo uovo si schiude in pochi minuti. Nutrilo, gioca con lui, pulisci – e guardalo crescere. Salva da solo.",
    iconsTitle: "Il menu",
    iconsLead: "SELECT scorre, CONFIRM seleziona, NEXT torna indietro.",
    step1: "<b>Imposta l'orologio.</b> CONFIRM cambia campo, SELECT cambia il valore.",
    step2: "<b>Aspetta la schiusa.</b> L'uovo si apre dopo circa cinque minuti.",
    step3: "<b>Nutrilo.</b> Con SELECT vai alla ciotola, poi CONFIRM – pasto o snack.",
    step4: "<b>Prenditene cura.</b> Luce spenta quando dorme, bagno quando è sporco, medicina se sta male, un rimprovero se è monello.",
    notifyTitle: "Il tuo Tamagotchi ha bisogno di te",
    notifyBody: "Ti sta chiamando – dagli da mangiare, pulisci o gioca.",
    installTitle: "Installa come app",
    installBody: "Aggiungi alla schermata home per schermo intero e offline.",
    installBtn: "Installa",
    installLater: "Dopo",
    icons: "Cibo,Luce,Gioco,Medicina,Bagno,Stato,Disciplina,Attenzione",
  },
};

/** Sprache aus der Browsersprache (de/it, sonst en). */
export function currentLang(): Lang {
  const n = (navigator.language || "en").slice(0, 2).toLowerCase();
  return n === "de" ? "de" : n === "it" ? "it" : "en";
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
  // Für Strings mit Markup (z. B. <b>…) – nur vertrauenswürdige eigene Dict-Werte.
  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml!;
    el.innerHTML = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria!));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.dataset.i18nTitle!));
  });
}

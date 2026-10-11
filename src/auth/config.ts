/**
 * Google-OAuth-Client-ID (öffentlich, kein Secret).
 * Leer lassen = Konto-Funktion ist aus (kein UI, keine Requests).
 * Anlegen: Google Cloud Console → APIs & Dienste → Anmeldedaten → OAuth-Client-ID
 * (Typ „Webanwendung"), erlaubter JavaScript-Ursprung https://tamagotchi.fugjoo.com
 */
export const GOOGLE_CLIENT_ID = "";

export const AUTH_ENABLED = GOOGLE_CLIENT_ID.trim().length > 0;

/** Eigener Endpunkt (same-origin, siehe worker/). */
export const SAVE_API = "/api/save";

import { createSignal } from "solid-js";

import type { StoredSignal } from "./stored-signals";
import { createStoredSignal } from "./StoredSignalsContext";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** LocalStorage key for the user's theme choice. */
const THEME_PREFERENCE_KEY = "oblik.theme";

/*
 * Shared theme state, driven by Solid reactivity:
 * - The user's override is the app-wide stored signal (`StoredSignalsProvider`
 *   registry: same key ⇒ same signal for every caller) — no listener of its
 *   own, changes flow through signals.
 * - The system default is the only event-driven input: one matchMedia
 *   "change" listener feeds a signal so reactive scopes re-run when the OS
 *   preference flips.
 * The DOM attribute (`<html data-theme>`) is a downstream write, never an
 * input — consumers read `resolveTheme()` instead of observing it.
 */
const prefersLightQuery = window.matchMedia("(prefers-color-scheme: light)");
const [systemPrefersLight, setSystemPrefersLight] = createSignal(prefersLightQuery.matches);
prefersLightQuery.addEventListener("change", () =>
  setSystemPrefersLight(prefersLightQuery.matches),
);

/** The app-wide stored user preference ("system" default). */
export function themePreference(): StoredSignal<ThemePreference> {
  return createStoredSignal<ThemePreference>(THEME_PREFERENCE_KEY, { defaultValue: "system" });
}

/** Reactive merge of the user's override and the system default. Call inside a
 * reactive scope: tracks both the stored preference and the system signal. */
export function resolveTheme(): ResolvedTheme {
  const pref = themePreference().value();
  if (pref !== "system") return pref;
  return systemPrefersLight() ? "light" : "dark";
}

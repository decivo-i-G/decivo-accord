/**
 * Appearance: Light is the default (decivo v6 is white). Dark and System are a choice in the
 * settings, stored in the `theme` cookie like the language and written onto `<html data-theme>` on
 * the server, so the first paint already has the right colours.
 */
export type ThemeChoice = 'light' | 'dark' | 'system'

export const THEME_CHOICES: ThemeChoice[] = ['light', 'dark', 'system']

export const THEME_COOKIE = 'theme'

export function themeFrom(value: string | undefined): ThemeChoice {
  return value === 'dark' || value === 'system' ? value : 'light'
}

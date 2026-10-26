/** Translator of the `register` namespace, as far as a mode name needs it (client and server alike). */
interface Translate {
  (key: string): string
  has: (key: string) => boolean
}

/** A mode's name for people: `dark` → „Dunkel“ for the register's usual contexts, Figma's names as they are. */
export function modeName(t: Translate, mode: string): string {
  const key = `tokens.modes.names.${mode}`
  return t.has(key) ? t(key) : mode
}

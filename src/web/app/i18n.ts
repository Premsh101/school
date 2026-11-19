// Every piece of UI text goes through t(). English is the key, so adding Hindi later
// means filling the `hi` dictionary; nothing else changes.

type Dictionary = Record<string, string>;
const dictionaries: Record<string, Dictionary> = {
  en: {},
  hi: {}, // to be filled when Hindi is added
};
let language = 'en';

export function setLanguage(lang: string): void {
  if (lang in dictionaries) language = lang;
}

/** t('Hello {name}', { name: 'Asha' }) → 'Hello Asha' */
export function t(text: string, values?: Record<string, string | number>): string {
  const translated = dictionaries[language]?.[text] ?? text;
  if (!values) return translated;
  return translated.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

// src/translations.ts
// Minimalistický, ale plně funkční překladový modul

// Lokální typ jazyka – není navázaný na src/types.ts, aby nevznikly cykly importů
export type Language = "en" | "cs";

type TranslationDict = {
  settings: string;
  // sem si můžeš postupně přidávat další klíče
};

export const translations: Record<Language, TranslationDict> = {
  en: {
    settings: "Settings",
  },
  cs: {
    settings: "Nastavení",
  },
};

// Helper hook – jednoduchá verze, aby se dal případně používat v komponentách
export function useTranslation(lang: Language) {
  const dict = translations[lang] ?? translations.en;

  const t = (key: keyof TranslationDict): string => {
    return dict[key] ?? key;
  };

  return { t, lang };
}
// src/translations.ts
// Minimalistický, ale plně funkční překladový modul
export const translations = {
    en: {
        settings: "Settings",
    },
    cs: {
        settings: "Nastavení",
    },
};
// Helper hook – jednoduchá verze, aby se dal případně používat v komponentách
export function useTranslation(lang) {
    const dict = translations[lang] ?? translations.en;
    const t = (key) => {
        return dict[key] ?? key;
    };
    return { t, lang };
}

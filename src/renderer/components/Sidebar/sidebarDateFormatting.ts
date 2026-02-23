const UI_DATE_LOCALE: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
};

interface FormatSidebarRelativeDateArgs {
  dateString: string;
  language: string;
  t: (key: string) => string;
}

export function formatSidebarRelativeDate({ dateString, language, t }: FormatSidebarRelativeDateArgs): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  const uiDateLocale = UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en;

  if (diffDays === 0) {
    return date.toLocaleTimeString(uiDateLocale, { hour: 'numeric', minute: '2-digit' });
  }

  if (diffDays === 1) {
    return t('sidebar.chat.yesterday');
  }

  if (diffDays < 7) {
    return date.toLocaleDateString(uiDateLocale, { weekday: 'short' });
  }

  return date.toLocaleDateString(uiDateLocale, { month: 'short', day: 'numeric' });
}

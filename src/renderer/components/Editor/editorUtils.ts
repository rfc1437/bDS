export const UI_DATE_LOCALE: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
};

/** Get display name for media: prefer title over originalName */
export function getMediaDisplayName(media: { title?: string; originalName: string }): string {
  return media.title || media.originalName;
}

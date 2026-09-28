import i18next, { type i18n } from 'i18next';
import { en } from './locales/en';
import { vi } from './locales/vi';

export type Lang = 'vi' | 'en';

export const resources = { vi, en };

/** A separate, synchronously initialized instance; main and renderer each own one. */
export function createI18n(lang: Lang): i18n {
  const inst = i18next.createInstance();
  void inst.init({
    lng: lang,
    fallbackLng: 'vi',
    resources,
    ns: Object.keys(vi),
    defaultNS: 'common',
    initAsync: false, // the i18next 24+ name of initImmediate
    interpolation: { escapeValue: false },
  });
  return inst;
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: typeof vi;
  }
}

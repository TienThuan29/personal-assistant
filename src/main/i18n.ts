import { createI18n, type Lang } from '../shared/i18n';

/** Main-process instance: errors now, tray and toasts later. */
export const i18n = createI18n('vi');

export const setLanguage = (lang: Lang): void => void i18n.changeLanguage(lang);

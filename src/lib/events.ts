/**
 * Uygulama genelinde kullanilan, dışarıya açık olmayan olay adlari.
 * Böylece `App` ve `AppLayout` birbirini doğrudan import etmeden
 * ayni kanaldan haberlesir.
 */

/** Google oturumu kurulduğunda/degistiginde yayilir. */
export const ACCOUNT_CHANGED_EVENT = 'jmc:account-changed'

/** AI sağlayıcı anahtarı veya ayarı değiştiğinde yayılır. */
export const PROVIDERS_CHANGED_EVENT = 'jmc:providers-changed'

/** Otomatik senkronizasyon aralığı değiştiğinde yayılır. */
export const AUTOSYNC_CHANGED_EVENT = 'jmc:autosync-changed'

/** Varsayılan yapay zekâ çalışma modu değiştiğinde yayılır. */
export const AI_MODE_CHANGED_EVENT = 'jmc:aimode-changed'
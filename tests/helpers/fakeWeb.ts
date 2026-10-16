/**
 * fakeWeb.ts
 * ---------------------------------------------------------------------------
 * Anahtarsiz web arama kaynaklarini testler icin sahteler.
 *
 * Bu modul SADECE testlerde kullanilir. `toolDispatcher` bu modulu
 * DOGRUDAN IMPORT ETMEZ; `vi.mock` ile yerine gecer.
 *
 * NEDEN GEREKLI
 * -------------
 * Onceki testler gercek internete cikiyordu. Ag olmayan bir makinede
 * test kirmizi olur, bir arama motorunun sayfa yapisini degistirmesi
 * kodun hatasi gibi gorunurdu. Ayrica test, uygulamanin gercekten
 * DOGRULANMASI gereken davranisini (kaynak zincirinde geri dus) olcmek
 * yerine yalnizca "internetten bir sey geldi mi" olcuyordu.
 *
 * KULLANIM
 * --------
 * Bu dosya, testin EN BASINDA ve servisler import edilmeden ONCE
 * yuklenmelidir; `vi.mock` kaldirilabilir (hoist) davranisi ancak o
 * surece uygulanir.
 */
import { vi } from 'vitest'

/** Sahte `providerHttp.request` cagrisi. Test icinde `mockImplementation` ile surulur. */
export const requestSpy = vi.fn(async (_url: string, _options?: unknown) => ({}) as any)

vi.mock('../../electron/services/httpClient', async () => {
  const actual = await vi.importActual<typeof import('../../electron/services/httpClient')>(
    '../../electron/services/httpClient',
  )
  return {
    ...actual,
    googleHttp: { request: requestSpy, paginate: requestSpy },
    providerHttp: { request: requestSpy },
  }
})
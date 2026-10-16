# Geliştirici Rehberi

> Mimari, kurallar, testler ve katkı rehberi.

---

## 1. Mimari

```
electron/                          Ana süreç (Node)
  main.ts                          IPC noktası, pencere, yaşam döngüsü
  preload.ts                       contextBridge — tek açık yüzey
  config/oauth.ts                  Derleme anında gömülü istemci kimliği
  services/
    authService.ts                 OAuth PKCE akışı, loopback sunucu
    storageService.ts              AES şifreli yerel depo
    vaultService.ts                Anahtar kasası + DLP maskeleme
    keyringService.ts              İşletim sistemi anahtar deposu
    classroomService.ts            Classroom REST uçları
    driveService.ts                Drive indirme / yükleme
    toolDispatcher.ts              Asistan araçlarının yürütülmesi
    updateService.ts               Otomatik güncelleme
    ai/aiOrchestrator.ts           Sağlayıcılar, akışlar, araç döngüsü

src/                               Arayüz (React)
  App.tsx                          Kök + modal yönetimi
  layouts/AppLayout.tsx            Üç bölgeli ana düzen
  components/                      Paylaşılan bileşenler
  features/                        Özellik modalları
  themes/, i18n/                   Tema ve çeviri

types/jmc.ts                       Tüm paylaşılan tipler (tek kaynak)
tests/                             Vitest testleri
scripts/                           İkon üretimi, sürüm betiği
```

### Güvenlik sınırları

| Sınır | Kural |
| --- | --- |
| Renderer → Ana | Yalnızca `preload.ts` içindeki kanallar |
| Depo anahtarları | `ALLOWED_SETTING_KEYS` beyaz listesi; dışındaki reddedilir |
| Gizli değerler | Kasada; renderer'a **hiçbir zaman** karakter gitmez |
| Konsol/IPC çıktısı | `vaultService.redact()` — bilinen anahtar biçimleri maskelenir |
| OAuth | PKCE + loopback; `client_secret` hiçbir yerde saklanmaz |

---

## 2. Komutlar

```bash
pnpm dev          # geliştirme sunucusu
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm icons        # ikonları yeniden üret
pnpm build        # tsc + vite build + electron-builder --dir
pnpm build:win    # Windows paketleri
pnpm build:release# yayın adresiyle otomatik guncelleme paketi
pnpm clean        # çıktı klasörlerini sil
```

**Doğrulama sırası** (bir değişiklik tamamlanmış sayılmadan önce):

```bash
pnpm typecheck && pnpm test && pnpm build:win
```

---

## 3. Testler

```
tests/
  aiModelCatalog.test.ts   Model filtresi, tekillestirme, sıralama
  aiOrchestrator.test.ts   Anahtar yönetimi, sağlayıcı davranışı
  aiToolLoop.test.ts       Gerçek araç döngüsü (sahte SSE ile)
  authService.test.ts      OAuth akışı, hata açıklamaları
  classroomService.test.ts Okuma uçları
  classroomWrites.test.ts  Teslim / geri alma gövde doğruluğu
  exportService.test.ts    Dışa aktarma biçimleri
  keyRedaction.test.ts     DLP maskeleme
  storageService.test.ts   Şifreli depo
  themeAndI18n.test.ts     Tema ve çeviri bütünlüğü
  toolDispatcher.test.ts   Araç yürütme ve izinler
  helpers/                 Electron taklidi, sahte ağ
```

**Hiçbir test gerçek internete çıkmaz.** Ağ çağrıları
`providerHttp` üzerinden sahte yanıtlarla değiştirilir
(`tests/helpers/fakeWeb.ts`).

### Test yazarken

- Bir davranışı değiştiriyorsanız, **önce** testi yazın
- Test adı davranışı anlatır, uygulamayı değil:
  - ✅ `"turnIn gövdesi addAttachments içermiyor"`
  - ❌ `"testTurnIn2"`
- Yorum bloğu **neden** bu davranışın var olduğunu açıklasın; ne
  yaptığını zaten kod söyler

---

## 4. Kurallar

### Değişmezler

1. **Sabit veri yazma.** Model listeleri, kapsam listeleri ve sağlayıcı
   adresleri ya kullanıcıdan ya sunucudan gelir. “Örnek” değer
   kodda durmaz; örnek `null` ya da boştur.
2. **Sır ile kimlik ayrımı.** OAuth istemci kimliği gizli **değildir**
   ve depoda tutulur. `client_secret` gizlidir ve hiç saklanmaz.
3. **Tek noktadan doğrulama.** İzin listeleri, kapsam listeleri ve
   sağlayıcı listeleri tek kaynaktan gelir; arayüzün kendi kopyası
   olmaz. (Bu kural iki kez ihlal edilmişti: `isCustom` listesi ve
   `!**/node_modules/**/*` kuralı.)
4. **Hata yutma yok.** `catch {}` yalnızca “bu yolun devamı
   imkânsız” olduğunda kabul edilir ve yorumu yazılır. Aksi hâlde
   `reportSyncFailure` gibi bir bildirim yolu kullanılır.

### Yazım

- Türkçe arayüz metni, Türkçe hata mesajı
- Yorumlar Türkçe; kod tanımlayıcıları İngilizce
- Emoji **kullanılmaz** — arayüzde SVG ikon kullanılır
- Uzun koşullu zincirlerde yorum, ne olduğunu değil **neden** olduğunu açıklar

---

## 5. Bilinen tuzaklar

### DLP yeşil değil ama olması gereken değerler

`redact()` kasadaki her değeri maskeler. Google istemci kimliği bir
kez kasadaydı ve `([REDACTED]...)` olarak ekrana yansıyordu. Artık
depoda tutuluyor ve `NEVER_REDACT_KEYS` ikinci bir emniyet bariyi.

**Kural:** Bir değeri kasaya koymadan önce “bu gerçekten gizli mi?”
sorusunu sorun. Değilse koymayın; koyacaksanız nedenini yazın.

### Loopback sunucu zaman aşımı

Onay ekranı 2 dakikadan uzun sürerse tarayıcı 404 alır. `AUTH_TIMEOUT_MS`
10 dakika, sonrasında `AUTH_GRACE_MS` (5 dk) boyunca sunucu açık kalır.
`closeActiveServer()` her iki sayacı da temizler; temizlemezse eski
geri çağırma yeni sunucuyu öldürür.

### `files` kuralı

`electron-builder.yml` içindeki `files` listesine
`!**/node_modules/**/*` **yazılmaz**. Bu kural çalışma zamanı
bağımlılıklarını da dışlar ve paketlenmiş uygulama
`require('electron-updater')` yapamaz. `electron-builder` üretim
bağımlılıklarını zaten kendisi alır.

### Emoji / rozetler

`<select>` içindeki metinlere ikon konulamaz. Arayüzde ikon
gösterecekse **özel bir bileşen** gerekir (`ModelPicker`). Emoji,
`<option>` içinde karakter olarak basılır ve isletim sistemi
fontuna bağlı çizilir.

---

## 6. Yeni sağlayıcı ekleme

1. `types/jmc.ts` → `ProviderBrand` içine marka anahtarı
2. `src/components/icons/ProviderIcon.tsx` → `BRANDS` içine
   `mono`, `from`, `to`, `glyph`
3. `electron/services/ai/aiOrchestrator.ts` → `BUILTIN_PROVIDER_IDS`
   ve `initDefaultProviders()` içine kayıt
4. `models: []` bırakın — liste açılışta sunucudan gelir
5. Arayüzde **hiçbir şey** değiştirmeye gerek yoktur:
   `PROVIDER_LINKS` yalnızca rehber metni taşır, `keyUrl` ana
   süreçten gelir; `isCustom` veriden okur

### Aynı işlemi unutmayın

İkinci bir sağlayıcı listesi tutan her yer arayüzde aranır. Yeni
sağlayıcı eklerken `grep -n "provider" src/` çalıştırıp ikinci bir
listenin oluşmadığını doğrulayın.

---

## 7. OAuth kapsamı değişikliği

`electron/services/authService.ts` → `BASE_SCOPES`. Her satırın
yorumu **hangi ucu kapsadığını** söyler ve bu zorunludur.

Yeni kapsam eklerken:

1. Google'ın referans sayfasından o ucun “Authorization scopes”
   bölümünü okuyun — tahmin etmeyin
2. Kapsamlar birbirini **kapsamaz**; `classroom.courses.readonly`
   `classroom.topics.readonly`'yi karşılamaz
3. Salt okunur kapsamların Google incelemesinde maliyeti düşüktür;
   hassas kapsamlardan kaçının

Ayrıntılı denetim: [CLASSROOM-API.md](CLASSROOM-API.md)

---

## 8. Sürüm ve yayın

Sürüm numarası `package.json` içindedir. `pnpm build:release`
geçersiz sürümü, eksik ikonu ve şifresiz yayın adresini reddeder.

Yayın adresi, kapsam denetimi, imzalama:
[KURULUM.md](KURULUM.md)

---

## 9. Katkı

1. Depo çatalı
2. `pnpm install`
3. `pnpm typecheck && pnpm test` — yeşil olmadan ilerlemeyin
4. Değişikliği **tek konuda** tutun
5. Davranış değiştiyse test ekleyin
6. Açıklama, neyi değil **neden** yaptığını anlatır
# Kurulum ve Dağıtım Rehberi

> Bu belge **başka birine uygulamayı nasıl vereceğini** ve
> **yeni sürümü nasıl yayınlayacağını** adım adım anlatır.
> "Dosya taşımak zorunda mıyım?" sorusunun cevabı burada.

---

## 1. Tek cevap

| Soru | Cevap |
| --- | --- |
| Başkasına nasıl veririm? | **Tek `.exe` dosyası** gönder. Kullanıcı çift tıklar, sihirbazı izler, biter. |
| Kaldırma nasıl olur? | Kurulum sihirbazı ayrı bir **kaldırıcı** bırakır. `Denetim Masası → Programlar` üzerinden tek tık. |
| Yeni sürümü nasıl dağıtırım? | Aynı `.exe` dosyasını yeni sürüm numarasıyla üretip yayın klasörüne koy. Kullanıcıların uygulaması **kendisi güncellenir**. |
| Dosya taşımak gerekir mi? | **Hayır** — güncelleme açıksa hiç gerekmez. |

---

## 2. Hangi paketi kime gönderebilirim?

Derleme iki ayrı tür paket üretir. İkisi de aynı uygulamadır.

### 2.1 `JustMyClass-Setup-<sürüm>-x64.exe` — Kurulum sihirbazı (önerilen)

Kurulum sihirbazı şunları **tek tek sorar**; hiçbir şey varsayılan
gizli kalmaz:

| Adım | Ne sorar | Varsayılan |
| --- | --- | --- |
| 1 | Bu bilgisayara mı, tüm kullanıcılara mı? | Yalnızca bu kullanıcı (yönetici şifresi **gerekmez**) |
| 2 | Nereye kurulsun? | `Program Files\JustMyClass` — **değiştirilebilir** |
| 3 | Masaüstü kısayolu? | Açık / kapalı — **kullanıcı seçer** |
| 4 | Başlat menüsü kısayolu? | Açık / kapalı — **kullanıcı seçer** |
| 5 | Kurulumu başlat? | Bitince uygulamayı çalıştır (kapatılabilir) |

Ayrıca:

- **Arayüz dili:** Türkçe veya İngilizce — sistem diline göre otomatik seçilir.
- **Kaldırma:** Denetim Masası → Programlar ve Özellikler → Kaldır.
- **Onarım:** Kurulum yanlış yere giderse aynı `.exe`'yi yeniden
  çalıştırmak uygulamayı yeni konuma taşır.

> ⚠️ **Kaldırma verilerinizi silmez.** API anahtarlarınız, indirdiğiniz
> dosyalar ve ayarlarınız kalır. Bu bilinçli bir tasarım kararıdır:
> bir kazada yeniden kurulum, anahtarlarınızı ve indirmelerinizi
> kaybettirmemelidir. Verileri silmek isterseniz uygulama içinde
> **Ayarlar → Gizlilik ve Güvenlik → Tüm verileri temizle**.

### 2.2 `JustMyClass-Portable-<sürüm>.exe` — Kurulum gerektirmeyen

Kurulum yapılmaz. Çift tıkla çalışır. Kurumsal bilgisayarlarda veya
kurulum yetkisi olmayan makinelerde kullanışlıdır.

Kısayol oluşturulmaz; **Başlat menüsüne eklenmez**; kaldırma sihirbazı
kurulmaz — dosyayı silmek yeterlidir.

> Taşınabilir sürümde veriler yine kullanıcının profil klasöründe
> saklanır, exe'nin yanında değil. Böylece USB'den çalıştırdığınızda
> veriler USB'ye karışmaz.

---

## 3. Derleme

```bash
# Bağımlılıklar (pnpm kullanılıyor)
pnpm install

# İkonları üret (yoksa atlanır — ikon depoda var)
pnpm icons

# Sadece Windows paketleri
pnpm build:win

# Windows + macOS + Linux
pnpm build:all

# Otomatik güncelleme destekli yayın (aşağıya bak)
pnpm build:release
```

Çıktılar `release/` klasörüne yazılır.

### 3.1 Boyut beklentisi

| Öğe | Yaklaşık boyut |
| --- | --- |
| Kurulum sihirbazı (`.exe`) | **75 MB** |
| Taşınabilir (`.exe`) | 75 MB |
| Açılmış uygulama klasörü | 192 MB |
| `app.asar` (uygulama kodu) | 2,4 MB |

Kurulum dosyasının büyük olmasının nedeni Electron'un kendisidir
(Chromium ~150 MB). Her sürümde aynı Electron çekirdeği gönderilir.
`--dir` yerine `--dir` paketi kullanmak, `--dir` + `--dir` üretmekten
daha küçük sonuç vermez; tek kazanç darbeye paketlerini
`release/win-unpacked` içine çıkarmaktır.

---

## 4. Otomatik güncelleme

### 4.1 Nasıl çalışır

```
  SEN (geliştirici)                       KULLANICI
  ────────────────                        ────────
  pnpm build:release
      ↓
  release/JustMyClass-Setup-1.1.0-x64.exe ──┐
  release/latest.yml                        ├─→ Aynı klasöre YÜKLE
                                             │
                                             ↓
                                        Bu adresi Ayarlar →
                                        Güncelleme'ye yazar (bir kez)
                                             ↓
                                        Her açılışta arka planda
                                        kontrol edilir
                                             ↓
                                        "Güncelleme hazır" → İndir → Kur
```

### 4.2 Adım 1 — Yayın klasörünü seç

Sürüm dosyalarının yükleneceği **herkese açık bir HTTPS klasörü**
gerekir. Şunların hepsi çalışır:

| Seçenek | Not |
| --- | --- |
| GitHub Releases | Depo özel olsa bile **herkese açık bir sürüm** yayınlayabilirsiniz; dosya indirilebilir olduğu için yeterlidir. |
| Netlify / Vercel / Cloudflare Pages | Statik dosya; en hızlı çözüm |
| Kendi sunucunuz | İki dosyayı bir klasöre kopyalayın |
| S3 / R2 / Backblaze | Nesne deposu; CDN önüne konabilir |

**HTTPS zorunludur.** Electron, şifresiz adresten güncelleme yapmayı
reddeder. Bu bir kısıt değil, korumadır: güncellenen dosya
değiştirilebilirse biri kullanıcıya sahte bir sürüm gönderebilir.

### 4.3 Adım 2 — Sürüm numarasını artır

```bash
# package.json
"version": "1.1.0"
```

Biçim **kesinlikle** `MAJOR.MINOR.PATCH` olmalıdır. Betik, geçersiz
bir sürümde derlemeyi durdurur — çünkü karşılaştırılamayan sürüm
numarası, kullanıcıya "güncelleme var" deyip hiçbir şey göstermemeye
yol açar.

### 4.4 Adım 3 — Derle ve yayınla

```powershell
# PowerShell
$env:UPDATE_FEED_URL = "https://cdn.ornek.com/justmyclass/surumler"
pnpm build:release
```

Betik şunları **sırayla doğrular** ve ilk hatada durdurur:

1. Sürüm numarası geçerli mi?
2. İkon dosyaları var mı?
3. `UPDATE_FEED_URL` tanımlı mı?
4. Adres geçerli bir URL mi?
5. Adres **HTTPS** mi?
6. Adres bir klasör mü (site kökü değil mi)?

Sonra `release/` altına installer ve `latest.yml` üretir.

### 4.5 Adım 4 — Kullanıcıya adresi ver

Kullanıcı **Ayarlar → Güncelleme** ekranında bu adresi bir kez yazar:

```
https://cdn.ornek.com/justmyclass/surumler
```

Kaydedildikten sonra uygulama her açılışta arka planda kontrol eder.
Yeni sürüm varsa tek tıkla indirilip kurulur.

### 4.6 Kanal davranışı

| Durum | Kullanıcı ne görür |
| --- | --- |
| Adres boş | "Otomatik güncelleme kapalı" — hiçbir ağ trafiği olmaz |
| Adres yazılmamış, kontrol | Buton pasif; açıklama görünür |
| Yeni sürüm yok | "Uygulama güncel (1.1.0)" |
| Yeni sürüm var | Sürüm numarası + **İndir** düğmesi |
| İndirme sürüyor | Yüzde + MB göstergesi |
| İndirme bitti | **Kur ve yeniden başlat** |
| Hata | Somut neden: DNS, HTTPS, 404, ağ engeli |

Güncelleme **otomatik indirilmez**. Kullanıcının onayı istenir.
Onay verilmedikçe indirme başlamaz.

---

## 5. İmzalı kurulum

İmzasız `.exe` çalıştırıldığında Windows SmartScreen uyarısı gösterir:

> "Windows, bilgisayarınız için uyumluluk konusundan emin değil. Bu
> uygulamayı güvenliğinizi tehlikeye atmadan çalıştırmak istediğinizden
> emin değiliz."

Bu **doğru davranıştır**: kod imzanız yoksa uyarı doğrudur.

### 5.1 Ücretsiz seçenek — kendi sertifikasınız (önerilir)

`signtool` ile **kendi oluşturduğunuz** kod imzalama sertifikası:

```bash
# 1) Sertifika isteyin (OV/EV sertifikaları Code Signing içindir)
# 2) PFX olarak indirin (parola korumalı)
# 3) Sürüm kontrol edin:
signtool verify /pa /v sertifika.pfx

# 4) Derleyin
CSC_LINK="C:\...\sertifika.pfx" pnpm build:win
```

`electron-builder`, `CSC_LINK` ortam değişkeni varsa otomatik imzalar.

### 5.2 Ücretiz seçenek — `azuresigntool`

```bash
pnpm add -D azure-cli
az login
az extension add --name azure-sign
az blob upload ...
pnpm build:win
```

### 5.3 SmartScreen uyarısını azaltmak

Kod imzası olmadan SmartScreen uyarısını azaltmanın **desteklenen tek
yolu yoktur**. SmartScreen "akıllı ekran" geri bildirimi toplar;
yeterince çok kullanıcı "çalıştır yine de" dediğinde uyarı zamanla
kalkar. Bu süreci hızlandırmanın meşru yolu imza almaktır.

---

## 6. Sürüm numarası kuralları

`MAJOR.MINOR.PATCH`:

| Kısım | Ne zaman artar |
| --- | --- |
| `MAJOR` | Veri modeli değişirse, kaldırma başarısız olabiliyorsa, ayarlar taşınamıyorsa |
| `MINOR` | Yeni özellik, geriye uyumlu |
| `PATCH` | Hata düzeltme, davranış aynı |

Pratikte `1.4.0` → `1.4.1` → `1.5.0` → `2.0.0` sırasıyla kullanılır.

---

## 7. Sık karşılaşılan sorunlar

| Belirti | Sebep | Çözüm |
| --- | --- | --- |
| Kurulumda "Windows korumanız PC'nizde uyarı verdi" | İmzasız `.exe` | Yukarıdaki *More info → Run anyway* ya da imza alın |
| Kurulumda hata, dosya kullanımda | Uygulama çalışıyor | Uygulamayı kapatıp yeniden çalıştırın |
| Uygulama açılmıyor, konsol hatası | `app.asar` içinde `node_modules` eksik | `files` kuralına `!**/node_modules/**/*` gibi bir dışlama **yazmayın** |
| Güncelleme "Sunucuya ulaşılamadı" | DNS | Adresi tarayıcıda açıp deneyin |
| Güncelleme "sürüm dosyası bulunamadı" | `latest.yml` yanlış yerde | Dosya adı tam olarak `latest.yml` olmalı, sürüm klasörünün kökünde |
| Güncelleme "güvenlik sertifikası geçersiz" | HTTPS sertifikası | Sertifika zincirini düzeltin (Let's Encrypt `fullchain.pem` kullanın) |
| Güncelleme sessizce çalışmıyor | Adres boş | Ayarlar → Güncelleme'de adresi yazın |

---

## 8. İkonlar

Depoda **gerçek ikon dosyaları** vardır:

```
build/icon.ico      16 · 24 · 32 · 48 · 64 · 128 · 256   (Windows)
build/icon.png      512 × 512
build/tray.png      64 × 64
```

Bunlar `scripts/generate-icons.mjs` ile üretilir. Betik harici
bağımlılık kullanmaz; logoyu vektörel olarak çizer ve PNG/ICO
kodlayıcısını kendi içinde yazar.

Logoyu değiştirmek için `scripts/generate-icons.mjs` içindeki
`drawLogo()` fonksiyonunu düzenleyip `pnpm icons` çalıştırın.

---

## 9. Temizlik

```bash
pnpm clean
```

`dist/`, `dist-renderer/`, `dist-electron/` ve `release/` klasörlerini
siler. `node_modules` korunur.
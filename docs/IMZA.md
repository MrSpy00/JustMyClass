# Kod İmzalama (SmartScreen) Rehberi

> **Kısa cevap:** SmartScreen uyarısını kaldırmanın **tek** yolu, bir sertifika
> kuruluşundan (CA) kod imzalama sertifikası satın almaktır. Bu belge o yolu
> uçtan uca anlatır ve projede hazırlanmış otomasyonu devreye alır.

---

## 1. Neden uyarı çıkıyor?

Bir `.exe` indirildiğinde Windows iki şey bakar:

| Kontrol | Sonuç |
| --- | --- |
| **Authenticode imzası var mı?** | Yoksa → kullanıcı adı/şirket doğrulanamaz |
| **Bu yayıcıyı Windows "tanıyor" mu?** (SmartScreen itibarı) | Yeni/yüksek hacimli yayıcı → "Windows korumanızı sağlıyor" uyarısı |

İmzasız bir dosyada ikisi de elenir. Bu **kasıtlı** bir güvenlik kontrolüdür ve
uygulama tarafından kapatılamaz.

### Kesin olarak yapılmayacaklar

Aşağıdakiler bir "çözüm" **değildir**; bazıları tehlikelidir:

- ❌ **Kullanıcının bilgisayarında SmartScreen'i kapatmak** — kullanıcının
  güvenlik ayarını izinsiz değiştirmektir. `electron-builder`'ın gömülü
  kodla registry/policy yazması antivirüsleri tetikler ve uygulamayı
  antivirüs dostu olmaktan çıkarır.
- ❌ **Kendin imzaladığınız (self-signed) sertifika** — Windows bunu
  güvenilmez olarak işaretler. Kullanıcı "Bilinmeyen yayıcı" uyarısını
  **kaldırmaz**, üstüne kendi uyarısını ekler. SmartScreen için daha kötüdür.
- ❌ **SmartScreen'e `reputation` kazandırmaya çalışmak** — yalnızca
  gerçek, yayımlanmış, imzalı yazılımlarla ve zamanla mümkündür.

---

## 2. Sertifika satın alma

| Tür | Fiyat aralığı | SmartScreen güveni |
| --- | --- | --- |
| **EV (Extended Validation)** | ~$250–500/yıl | **Neredeyse anında** — Microsoft HWID doğrulaması yapar |
| **OV (Organization Validation)** | ~$70–200/yıl | Birkaç hafta / birkaç yüz indirme |

**JustMyClass için öneri:** Kullanıcı tabanınız büyükse ve uyarıyı ilk
sürümden itibaren görmemek istiyorsanız **EV**. Dağıtım düşükse ve maliyet
öncelikliyse **OV** da kabul edilebilir.

### Olası sağlayıcılar

- DigiCert (en yaygın, EV için referans)
- Sectigo / COMODO
- GlobalSign
- SSL.com

> Satın alma kararı ve ödeme sizin işinizdir; bu depo üzerinden ödeme
> yapamayız.

### Gerekli evrak (genelde)

- Şirket/kişi kimlik belgesi (şahıs ise TC kimlik)
- Vergi levhası / resmi kayıt belgesi
- Doğrulanabilir bir telefon numarası (CA arar)
- **İmza sirküleri** — Apple Developer Program'ı ya da Microsoft
  hesabınız varsa oradan alınabilir

---

## 3. Projeye bağlama

CA'dan aldığınız sertifikayı **`.pfx`** (PKCS#12) olarak dışa aktarın.
Sonra iki ortam değişkenini tanımlayın:

### Yerel (PowerShell)

```powershell
$env:CSC_LINK         = "C:\sertifikalar\justmyclass-code-signing.pfx"
$env:CSC_KEY_PASSWORD = "<pfx parolası>"
npm run build:win
```

### GitHub Actions (önerilen)

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Değer |
| --- | --- |
| `CSC_LINK` | `.pfx` dosyasının **base64** içeriği |
| `CSC_KEY_PASSWORD` | pfx parolası |

Base64'e çevirmek (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\...\cert.pfx")) -replace '\s',''
```

`electron-builder`, `CSC_LINK` base64 verirse dosyaya indirip kullanır.
Bu yüzden Actions dosyasında tek bir iş yeter.

> İsteğe bağlı `CSC_PUBLISHER_NAME` secret'ı: sertifikanın `Issued to`
> alanındaki adı elle geçirmek isterseniz. Tanımlanmazsa electron-builder
> adı otomatik okur.

---

## 4. Otomatik doğrulama

`npm run build:win` **imzalıysa doğrular, imzasızsa açıklar**:

```
JustMyClass - Windows paketleme
  -   surum      : 0.0.1
  OK   sertifika bulundu, paketler IMZALI uretilecek

Imza dogrulamasi
  OK   release\JustMyClass-Setup-0.0.1-x64.exe  CN=aegisSoft, O=aegisSoft
  OK   release\JustMyClass-Portable-0.0.1.exe    CN=aegisSoft, O=aegisSoft
  OK   release\win-unpacked\JustMyClass.exe      CN=aegisSoft, O=aegisSoft
  OK   release\win-unpacked\resources\elevate.exe CN=aegisSoft, O=aegisSoft

  OK   Tum paketler gecerli imzali: 4/4
```

İmzalama **istendiği hâlde** herhangi bir paket imzasız çıkarsa betik
**çıkış kodu 1** ile durur. Yani "imzalı sandım, imzasız çıktı" durumu
CI'da kırmızıya döner, sessizce yayınlanmaz.

Yalnızca doğrulamak için:

```bash
npm run verify:sign
```

---

## 5. `latest.yml` ve otomatik güncelleme

`electron-builder` imzali bir derlemede `latest.yml` içine
`publisherName` yazar. `electron-updater` bunu okuyup indirdiği kurulum
dosyasının **doğru yayıcı tarafından imzalandığını doğrular**; değilse
kurulumu reddeder. Yani imzalama otomatik güncellemeyi de koruma altına alır.

### Dikkat: `publisherName`'i elle yazmayın

`electron-builder.yml` içinde `win.signtoolOptions.publisherName` **sabit**
yazılırsa, electron-builder bunu **sertifika olmasa bile** `latest.yml`'e
koyar. `electron-updater` `publisherName` görünce imzasız güncellemeleri
reddeder ve **otomatik güncelleme sessizce çalışmaz**.

Bu yüzden projede:

- `electron-builder.yml` → `publisherName` **yok** (bilinçli)
- `scripts/build-win.mjs` → değeri **yalnızca imzalama gerçekten yapılırken**
  komut satırından geçirir (`-c.win.signtoolOptions.publisherName=...`)

Kaynak: `app-builder-lib/out/publish/PublishManager.js` ve
`app-builder-lib/out/codeSign/windowsSignToolManager.js` —
`computedPublisherName` sertifikayı kontrol etmeden yapılandırma değerini
döndürür.

---

## 6. Zaman damgası (timestamp)

İmza, `electron-builder.yml` içinde şu sunucuya damgalanır:

```yaml
timeStampServer: http://timestamp.digicert.com
```

Bu, sertifika süresi dolduğunda bile **imzanın geçerli sayılmasını** sağlar.
Kullanıcının 5 yıl sonra eski sürümü çalıştırıp güncellemesi gerektiğinde
imza doğrulaması patlamaz. Bu sunucu herhangi bir CA sertifikasını kabul eder.

---

## 7. Kontrol listesi

Satın alma sonrası:

- [ ] `.pfx` dosyanız var
- [ ] `CSC_LINK` ve `CSC_KEY_PASSWORD` tanımlı
- [ ] `npm run build:win` çalıştırıldı ve "Tum paketler gecerli imzali" yazdı
- [ ] `npm run verify:sign` ile tekrar doğrulandı
- [ ] `release/latest.yml` içinde `publisherName` **var**
- [ ] Dosyaya sağ tık → Özellikler → Sayısal İmzalar → yayıcı adı doğru
- [ ] GitHub Actions secrets eklendi (CI ile de derleniyorsa)
- [ ] Yeni paketler release'e yüklendi
- [ ] SmartScreen itibarı için ilk indirmeler birkaç gün izlenmeli

---

## 8. Yaygın sorunlar

| Belirti | Sebep | Çözüm |
| --- | --- | --- |
| `no signing info identified, signing is skipped` | `CSC_LINK` yok veya dosya bulunamıyor | Yolun tırnak içinde yazıldığından ve dosyanın var olduğundan emin olun |
| Sertifika ne pfx ne de Windows deposuna yüklenmiyor | Sertifika kurulmamış | `certmgr.msc` ile kontrol edin; ya da `signtool sign /a` ile depodaki sertifikayı kullanın |
| İmza başarılı ama SmartScreen yine de uyarıyor | Sertifika yeni, itibar henüz oluşmadı | Normal. İndirme hacmi arttıkça azalır. EV sertifika bunu büyük ölçüde hızlandırır |
| İmza "Valid" ama Windows "Unknown publisher" diyor | `publisherName` eşleşmiyor | `CSC_PUBLISHER_NAME` ile sertifikanın `Issued to` değerini tam olarak verin |
| CI'da imza çalışmıyor | Secret base64 değil, ham metin | `CSC_LINK`'i base64'e çevirin (bkz. §3) |
| `latest.yml` güncelleme çalışmıyor | `publisherName` yazıldı ama paket imzasız | `electron-builder.yml`'de elle `publisherName` olmadığından emin olun (§5) |
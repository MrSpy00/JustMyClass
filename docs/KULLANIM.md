# Kullanım Kılavuzu

> JustMyClass'ın ne yaptığı, nerede çalıştığı ve verilerinizin nerede
> durduğunun tamamı. Kurulum için → [KURULUM.md](KURULUM.md).

---

## 1. Uygulama ne yapar?

JustMyClass, Google Classroom verisini **doğrudan Google API'lerinden**
çeker, cihazınızda şifreli olarak saklar ve size kendi arama motoru,
veri modeli ve çalışma alanıyla sunar.

Google'ın web arayüzünün bir kabuğu **değildir**:

| | Classroom web | JustMyClass |
| --- | --- | --- |
| Veri konumu | Google'ın sunucuları | Yalnızca sizin cihazınız |
| Arama | Sunucu tarafı, sınırlı | Cihazda, anında, tüm alanlarda |
| Çalışma zamanı | İnternet bağlantısı şart | Bağlantı yoksa arayüz ve önbellek çalışır |
| Asistan | Yok | Kendi anahtarınızla, seçtiğiniz sağlayıcıda |
| Toplu işlem | Sınırlı | Dışa aktarma, toplu senkron, toplu indirme |

### Neleri yapmaz

- Ödev puanı veya not girişi yapmaz — hiçbir sunucuya yazmaz
- Sınıf oluşturmaz, duyuru yayınlamaz, öğrenci eklemez
- Öğrenci verisini hiçbir model sağlayıcısına **otomatik** göndermez
- Kişisel `@gmail.com` hesaplarında çalışmaz (Classroom yalnızca
  Workspace for Education hesaplarında vardır)

---

## 2. İlk çalıştırma

Uygulama ilk açıldığında **kurulum sihirbazı** karşınıza çıkar:

1. **Ne yaptığımız** — kapsam ve sınırlar
2. **Verilerim nerede** — somut klasör yolu ve şifreleme
3. **Google bağlantısı** — tek tıkla
4. **Yapay zekâ anahtarı** — isteğe bağlı
5. **Hazırız** — sonraki adımlar

Sihirbazı istediğiniz zaman yeniden açabilirsiniz:
**Hakkında → Kurulum sihirbazını aç**.

### Google bağlantısı

1. **Google ile devam et** düğmesine basın.
2. Varsayılan tarayıcınızda Google onay ekranı açılır.
3. İstediğiniz hesabı seçin ve izinleri onaylayın.
4. Tarayıcı sekmesi kendiliğinden kapanır; uygulamaya dönülür.

**Yapmanız gereken başka hiçbir şey yoktur.** Google Cloud projesi
kurmak, istemci kimliği almak veya bir şey yapılandırmak gerekmez.

> Onay ekranında bir kapsam listede görünüyorsa ve orada olmasını
> istemediğiniz bir şey varsa, o satırda **“İzin ver”** demeyin.
> Kapsamların tamamı ve neden gerekli oldukları:
> [CLASSROOM-API.md](CLASSROOM-API.md)

### Google bağlantısı başarısız olursa

| Ekrandaki mesaj | Anlamı | Yapmanız gereken |
| --- | --- | --- |
| `OAuth istemcisi bulunamadı` | Google, istemciyi tanımıyor | Uygulama geliştiricisine bildirin |
| `Erişim engellendi` | Onay ekranı yayınlanmamış ya da hesap türü uygun değil | Geliştiriciye bildirin |
| `Giriş tamamlanmadı (10 dakika)` | Onay ekranında beklenmişsiniz | Sekmeyi açık bırakın; "İzin ver" deyin |
| `Bu siteye ulaşılamıyor / 127.0.0.1 bağlanmayı reddetti` | Yerel geri dönüş sunucusu kapandı | Yeni sekme açın; sorun çözüldüyse giriş tamamlanır |

Sonuncusu eski sürümlerde sık görülen bir hataydı: onay ekranı
zaman aşımına uğrayınca uygulama geri dönüş sunucusunu kapatıyordu.
Artık 10 dakika bekleniyor ve süre dolarsa sunucu **açık kalıyor**.

---

## 3. Arayüz

### Üç bölge

```
┌──────────────────┬──────────────────────────┬─────────────────┐
│                  │                          │                 │
│  DERSLER         │   İÇERİK                 │   ASİSTAN       │
│                  │                          │                 │
│  • Ders listesi  │  • Ödev listesi          │  • Sohbet       │
│  • Konular       │  • Teslim durumu          │  • Model seçici │
│  • Ödev filtresi │  • Materyaller            │  • Araç izni    │
│                  │  • Not / teslim görünümü │  • Dosya ekleme │
│                  │                          │                 │
└──────────────────┴──────────────────────────┴─────────────────┘
```

Sol ve sağ panellerin **genişliği sürüklenerek ayarlanabilir** ve
tercihiniz kaydedilir.

### Klavye

| Tuş | İşlev |
| --- | --- |
| `Ctrl/⌘ + K` | Komut paleti |
| `Escape` | Açık pencereyi kapat |
| `↑` `↓` | Model listesinde gezin |
| `Enter` | Seçili modeli kullan |
| `→` `←` | Kurulum sihirbazında ilerle |

---

## 4. Model seçici

Asistan panelinin üstündeki **tek kontrol** hem sağlayıcı hem model
seçer.

- **Sağlayıcı sütunu:** marka ikonu, kullanılabilir model sayısı.
  Anahtarı girilen sağlayıcılar **en üstte**; yerel sunucular ortada;
  anahtarsızlar en altta.
- **Model sütunu:** arama kutusu, **Favoriler** ve **Diğer modeller**
  grupları.
- Her satırda yetenek ikonları:
  - 🧠 → **Beyin** = akıl yürütme
  - ⚡ → **Yıldırım** = araç çağırma
  - 👁 → **Göz** = görsel ve PDF girdisi
- Yıldıza tıklayarak favoriye ekleyip çıkarabilirsiniz. Favoriler
  kalıcıdır ve her zaman en üstte görünür.

### Modeller neden güncel?

Uygulama açılışında **anahtarı olan tüm sağlayıcıların model listesi
doğrudan sunucularından çekilir**. Gömülü, bayat bir liste yoktur.
Anahtar girdiğiniz anda da o sağlayıcının listesi hemen tazelenir.

Listede yalnızca **sohbet için kullanılabilir** modeller görünür.
Şunlar elenir: metinden sese (TTS), görsel üretim (Nano Banana, Imagen),
ses/video (Lyria, Veo), robotiks, arama derinliği, gömülü araç
kullanan (Computer Use) ve gömülü (embedding) modeller.

### Favorileri neden ayrı bir liste yok?

Eskiden model seçicinin altında her model için bir yıldız çipi
seriliyordu; 40 modelde panel 40 satır uzuyordu. Artık favoriler
listenin **içinde**, ayrı bir grup olarak duruyor.

---

## 5. Asistan

### Çalışma biçimi

Asistan tamamen **kendidir** — hiçbir işlem için onay sormaz.
Mesajınıza göre:

1. Eklediğiniz dosyaların **içeriğini** okur (adını değil)
2. Classroom verisinden ilgili kaynakları çeker
3. Gerekirse web araması yapar
4. Yanıtı üretir

### Dosya ekleme

Sohbet kutusundaki `+` düğmesiyle veya sürükle-bırak ile dosya
ekleyebilirsiniz.

- **Metin dosyaları** içeriğiyle birlikte modele gönderilir
- **Görseller** yalnızca görsel destekleyen modellerde eklenebilir
- **PDF'ler** metin olarak çıkarılır. Bir PDF'in metni
  çıkarılamıyorsa (örneğin tarama görüntüsü) modele **açıkça söylenir**
  ve dosya adını görüp içeriği uydurmaz

### İnternet araması

İki kademeli çalışır:

1. **Sağlayıcı anahtarı varsa** (Tavily veya Brave Search) arama
   aracı etkinleşir
2. **Anahtar yoksa** anahtarsız kaynaklar denenir: DuckDuckGo,
   Wikipedia, doğrudan HTML arama

Her iki yol da başarısız olursa nedeni açıkça söylenir.

### Durdurma

Üretim sırasında **Durdur** düğmesi belirir. Basıldığında istek
istemciye iptal sinyali gönderilir; yarım kalan yanıt ekranda
kalır, uygulama donmaz.

---

## 6. Ayarlar

| Sekme | İçerik |
| --- | --- |
| **Sağlayıcılar** | 22 sağlayıcı, anahtar yönetimi, model listesi, bağlantı testi |
| **Görünüm** | Temalar, yoğunluk, panel genişlikleri |
| **Hesaplar** | Google oturumu, hesap yetenekleri, izinler |
| **Senkronizasyon** | Otomatik senkron aralığı, önbellek, dışa aktarma |
| **Araçlar** | Asistan araç izinleri, anahtarsız arama durumu |
| **Dil** | Arayüz dili ve bölge biçimi |
| **Güncelleme** | Sürüm, otomatik güncelleme yayın adresi |
| **Gizlilik** | Şifreleme durumu, tüm verileri temizle |

---

## 7. Verileriniz

### Nerede durur

```
%APPDATA%\JustMyClass\     (Windows)
~/Library/Application Support/JustMyClass/   (macOS)
~/.config/JustMyClass/     (Linux)
```

Uygulama → Ayarlar → Gizlilik bölümünde **tam yol** yazar.

### Şifreleme

| Ne | Nasıl |
| --- | --- |
| Google belirteçleri | İşletim sistemi kasası (Windows: DPAPI) |
| API anahtarları | Aynı kasa |
| Ders / ödev / teslim verisi | AES-GCM, anahtar kasada sarmalanmış |

Anahtar dosyası sabit bir paroladan türetilmez.

### API anahtarları arayüze dönmez

Anahtarların karakterleri renderer'a **hiçbir zaman** gönderilmez.
Arayüz yalnızca:

- anahtar var mı / yok mu,
- geri döndürülemez bir parmak izi (son 4 karakter hash'i)

bilgisini görür.

Ayrıca tüm IPC yanıtları bir **DLP katmanından** geçer: bilinen
API anahtarı biçimleri (`sk-`, `AIza`, `ghp_`, `tvly-`, `xoxb-` …)
ve kasadaki gerçek anahtarlar otomatik olarak `[REDACTED]` ile
maskelenir. Bu yüzden hata mesajı ya da ekran görüntüsü anahtar
sızdıramaz.

> Google OAuth **istemci kimliği** bu maskeden muaftır: kimlik gizli
> değildir, OAuth URL'inde düz metin olarak tarayıcıya gider.

### Kaldırma verileri silmez

Programı kaldırdığınızda anahtarlarınız ve indirmeleriniz kalır.
Kalıcı olarak silmek için: **Ayarlar → Gizlilik → Tüm verileri
temizle**.

---

## 8. Dışa aktarma

**Ayarlar → Senkronizasyon → Dışa aktarma**:

| Biçim | Ne için |
| --- | --- |
| **CSV** | Excel / Sheets'te analiz |
| **JSON** | Tam veri dökümü, başka araçlara aktarım |
| **Markdown** | Not alışverişi, çalışma arşivi |
| **Anki** | Aralıklı tekrar için flash kartları |

---

## 9. Sorun giderme

### Genel teşhis

Hakkında ekranında **Tanılama bilgisini kopyala** düğmesi, sürüm,
platform, şifreleme durumu ve kasa özeti içeren bir metin kopyalar.
Bunu bir hata bildirimine ekleyin.

### Sık karşılaşılanlar

| Belirti | Sebep | Çözüm |
| --- | --- | --- |
| Ders listesi boş | Google bağlantısı yok | Hesaplar sekmesinden bağlanın |
| Kişisel gmail ile boş ekran | Classroom kişisel hesapta yok | Workspace for Education hesabı kullanın |
| Asistan "sağlayıcı bulunamadı" diyor | Anahtar yok | Sağlayıcılar sekmesinden anahtar girin |
| Model listesi eski | Anahtar girileli çok olmuş | Model seçicideki yenile düğmesi |
| Panel çok dar | Sürüklenmiş genişlik | Panel sınırını sürükleyin; en az 420 px |
| Dosya okunmuyor | PDF metin çıkarılamıyor | Model bunu söyler; dosyayı metne çevirip yapıştırın |

### Günlükler

Günlükler uygulama veri klasöründedir. Anahtar hiçbir zaman
günlüğe yazılmaz (DLP katmanı); yine de bir sorunu paylaşmadan önce
günlüğü kontrol edin.

---

## 10. Klavye kısayolları

| Kısayol | İşlev |
| --- | --- |
| `Ctrl/⌘ + K` | Komut paleti |
| `Ctrl/⌘ + ,` | Ayarlar |
| `Escape` | Açık pencereyi kapat |
| `Ctrl/⌘ + Enter` | Sohbeti gönder |
| `↑ ↓` | Model listesinde gezin |
| `Enter` | Model seç |
| `Home` / `End` | Listenin başı / sonu |

---

## İlgili belgeler

- [KURULUM.md](KURULUM.md) — kurulum, dağıtım, otomatik güncelleme
- [CLASSROOM-API.md](CLASSROOM-API.md) — kapsam denetimi ve API yetenekleri
- [GELISTIRICI.md](GELISTIRICI.md) — mimari, test, katkı
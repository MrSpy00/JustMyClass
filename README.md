# JustMyClass

> **Google Classroom için yerel öncelikli, yapay zekâ destekli masaüstü çalışma alanı.**
> Bağımsız, güvenli ve yüksek performanslı bir Electron + React 19 + TypeScript uygulaması.

[![Release](https://img.shields.io/badge/Release-v0.0.1-brightgreen.svg)](https://github.com/MrSpy00/JustMyClass/releases/tag/v0.0.1)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Geliştirici](https://img.shields.io/badge/Geliştirici-MrSpy-red.svg)](https://github.com/MrSpy00)
[![Repository](https://img.shields.io/badge/GitHub-MrSpy00%2FJustMyClass-black.svg)](https://github.com/MrSpy00/JustMyClass)
[![Electron](https://img.shields.io/badge/Electron-35-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg)](https://www.typescriptlang.org/)

---

## 🌟 Öne Çıkan Özellikler

- **Yerel Öncelikli Mimari (Local-First):** Verileriniz (sınıflar, duyurular, ödevler, rubrikler, teslimler ve taslaklar) yerel cihazınızda işletim sistemi seviyesinde AES-256-GCM ile şifrelenerek saklanır.
- **22+ Yapay Zekâ Sağlayıcısı & Kesintisiz Araç Yürütme:** Google Gemini, Anthropic Claude, OpenAI, Groq, DeepSeek, xAI, Mistral, Ollama ve yerel modeller. Araç çağrıları (tool calls) artık **her sağlayıcının kendi yerel protokolü** ile yürütülür; model "yapacağım" deyip ham JSON basıp durmaz.
- **Zengin Dosya & Medya Görüntüleyici:**
  - **PDF:** Gerçek akış çözümleme (Flate / LZW-sonrası / ASCII85 / RunLength), CP1252-WinAnsi ve Türkçe karakter kodlamaları, `ToUnicode` CMap desteği. Tırnak/tire yoğun sayfalar dahil **hiçbir metin satırı kaybolmaz**.
  - **DOCX / ODT:** Paragraflar, listeler, tablolar, sekme ve satır kırılmaları, kısa tire ve özel karakterler dönüştürülerek okunur.
  - **PPTX / ODP:** Slaytlar **tek tek** gezinilir (kaydırmalı veya tek tek mod). Sıralama `presentation.xml` + paket ilişkilerinden gelir; yeniden düzenlenmiş sunumlarda dosya adı sırası yanıltmaz. Başlıklar gerçek başlık yer tutucularından okunur, `_rels` klasörleri "slayt" sanmaz.
  - **XLSX / XLSM:** Sayfa adları paket ilişkilerinden çözülür, ortak metinler (`sharedStrings`) hücrelere bağlanır — ekranda `0`, `1` ham indeksleri görünmez.
  - **Kod & Metin:** Prism.js tabanlı, tema uyumlu syntax highlighting, satır numaralandırması, metin içi arama ve yatay kaydırma.
  - **Görseller:** PNG/JPEG/GIF/BMP/WEBP/TIFF/SVG boyutları okunur; indirme, "Varsayılan uygulamada aç", "Klasörde göster" ve yapay zekâya doğrudan görsel/OCR analizi.
  - **Bağlantılar:** Metin içindeki tüm bağlantılar (normal, YouTube dahil) güvenli biçimde tıklanabilir. YouTube bağlantıları uygulama içinde oynatılır; ayrıca "Tarayıcıda İzle", "Bağlantıyı Kopyala" ve "Classroom'da Aç" seçenekleri sunulur.
- **Veri Asla Silinmez:** Şifreli depo veya anahtar kasası okunamaz hale gelirse uygulama dosyayı **silmez**; `.unreadable.<zaman>.bak` olarak yedekler, yazma işlemlerini durdurur ve Ayarlar > Gizlilik > **Depolama sağlığı** panelinde açık bir açıklama gösterir.
- **Akıllı ve Çakışmasız Panel Yerleşimi:** Yan paneller (Dersler ve Yapay Zekâ Asistanı) kapatıldığında üst yardımcı şerit üzerinden tek tıkla geri açılabilir; hiçbir buton veya içerik örtüşmez, altında kaybolmaz.
- **Kusursuz Windows Entegrasyonu:** Başlangıç, protokol, kaldırma ve DMG ekranlarında ad **yalnızca ve tam olarak** `JustMyClass` olarak görünür (sürüm numarası eklenmez).
- **Siyah & Mor Yetkilendirme Sayfaları:** Google Classroom OAuth 2.0 PKCE bağlantısı sırasında hem başarılı hem hata ekranı aynı siyah + mor tasarım dilini kullanır.
- **GitHub Releases Otomatik Güncelleme:** Sürüm bilgisi doğrudan GitHub Releases API'sinden okunur; indirme ve kurma desteklenir. Kullanıcıya **asla iç dosya adı** (`latest.yml` vb.) gösterilmez — hatalar düz Türkçe cümlelere çevrilir.
- **16 Semantik Tema & Çift Dil:** Türkçe ve İngilizce tam dil desteği, yüksek kontrast ve modern çalışma alanı estetiği.

---

## 🔒 Güvenlik Modeli

| Konu | Uygulama & Koruma Düzeyi |
| --- | --- |
| **Ana Anahtar** | Uygulamaya özel rastgele 32 bayt (AES-256). Sabit parola veya depodaki tuzlardan türetilmez. |
| **Anahtar Kasası** | Electron `safeStorage` ile işletim sistemi kasasına sarılır: Windows **DPAPI**, macOS **Keychain**, Linux **libsecret**. |
| **Veri Şifreleme** | Sınıflar, ödevler, rubrikler, teslimler, taslaklar ve ayarlar **AES-256-GCM** ile şifrelenir. |
| **API Anahtarları** | Anahtar karakterleri arayüze hiçbir zaman düz metin aktarılmaz; yalnızca SHA-256 parmak izi gösterilir. |
| **İçerik Yönlendirme (CSP)** | Oturum seviyesinde sıkı CSP: `default-src 'none'`, `object-src 'none'`, `connect-src 'none'`, üretimde satır içi script engeli. |
| **Ağ İzolasyonu** | Web ve API istekleri yalnızca ana süreçte (`electron/main`) kontrollü HTTP istemcisiyle yürütülür; renderer süreci yalıtılmıştır. |
| **Sıfır Sızıntı Politikası** | Açık kaynak deposunda hiçbir gizli anahtar, `.env` dosyası veya kişisel belirteç yer almaz. |

---

## 💾 Veri Güvenliği ve Kurtarma

Uygulama verisi **tek bir çözümlenmiş klasörden** yönetilir
(`electron/services/dataDir.ts`). Çözümleme sırası:

1. `app.getPath('userData')` — normal durum
2. `app.getPath('appData')/JustMyClass`
3. `~/ .jmc_data`
4. `os.tmpdir()/JustMyClass` — son çare

Kritik noktalar:

- **Kurulum klasörü asla veri deposu olarak kullanılmaz.** `process.cwd()` hiçbir yerde veri yolu olarak geçmez (Program Files gibi yazılamaç klasörlerde veri "kaybolması" sorununun kök nedeniydi).
- **Veri içeren klasör her zaman önceliklidir.** Bir aday yazılabilir ama boşsa, veri barındıran diğer aday seçilir; aksi hâlde uygulama "boş" açılır ve veri kaybolmuş gibi görünür.
- **Kurulum (uninstall) verileri silmez.** Hem NSIS betiği hem de paket yapılandırması, kaldırma sırasında `%APPDATA%\JustMyClass` klasörünü **silmez**. Kaldırmak istemiyorsanız verileriniz durur.
- **Çıkış yapmak verileri silmez.** Oturumu kapatmak yalnızca Google oturumunu sonlandırır; yerel sınıf/ödev verisi korunur.
- **Bozuk depoda veri yok edilmez.** Okunamayan şifreli dosya `.unreadable.<zaman>.<neden>.bak` olarak yedeklenir, yeni anahtar yazılmaz, yazma işlemleri engellenir ve kullanıcı bilgilendirilir.

Tanı bilgisi **Ayarlar → Gizlilik → Depolama sağlığı** bölümünde görülebilir: sürüm, çalışma modu, veri klasörü yolu, anahtar dosyası konumu ve olası sorunlar.

---

## 📦 Kurulum ve İndirme

En güncel sürümleri [GitHub Releases](https://github.com/MrSpy00/JustMyClass/releases) sayfasından indirebilirsiniz:

| Paket | Açıklama |
| --- | --- |
| **`JustMyClass-Setup-0.0.1-x64.exe`** | **Önerilen Kurulum Sihirbazı:** Kurulum dizinini, masaüstü/başlat menüsü kısayollarını ayarlar ve otomatik kaldırıcı ile gelir. Kaldırma verilerinizi **silmez**. |
| **`JustMyClass-Portable-0.0.1.exe`** | **Taşınabilir Sürüm:** Kurulum gerektirmez, USB bellekten veya doğrudan çift tıklanarak çalıştırılabilir. |

---

## 🤖 Desteklenen Yapay Zekâ Sağlayıcıları

JustMyClass, 22 farklı yapay zekâ sağlayıcısını destekler. Sağlayıcı anahtarınızı girdiğiniz anda modeller doğrudan ilgili sağlayıcının güncel API'sinden anlık çekilir; kullanılamayan modeller listeden düşer.

| Sağlayıcı | Kimlik | Model Tipleri / Notlar |
| --- | --- | --- |
| **Google Gemini** | `gemini` | Gemini 3.x Flash / Flash-Lite ve 3.1 Pro önizleme (Google AI Studio'dan ücretsiz anahtar). **Kapatılmış** 2.0 ve 1.5 serileri kaldırıldı. |
| **Anthropic** | `anthropic` | Claude 3.7 Sonnet, Claude 3.5 Haiku, Claude 3 Opus |
| **OpenAI** | `openai` | GPT-4o, GPT-4o-mini, o1, o3-mini |
| **Groq** | `groq` | Llama 3.3 70B, DeepSeek R1 Distill (Ultra hızlı çıkarım, ücretsiz katman) |
| **DeepSeek** | `deepseek` | DeepSeek-V3 (`deepseek-chat`), DeepSeek-R1 |
| **xAI** | `xai` | Grok-2 |
| **Mistral AI** | `mistral` | Mistral Large, Codestral, Pixtral |
| **OpenRouter** | `openrouter` | Tek API anahtarı ile yüzlerce modele erişim |
| **Ollama** | `ollama` | **Yerel (Local):** API anahtarı gerektirmez, kendi donanımınızda çevrimdışı çalışır |
| **LM Studio** | `lmstudio` | **Yerel (Local):** Yerel OpenAI uyumlu sunucu |
| **llama.cpp** | `llamacpp` | **Yerel (Local):** Hafif C++ yerel çıkarım sunucusu (`/v1` uç noktası) |
| *ve diğerleri...* | `cerebras`, `together`, `siliconflow`, `novita`, `fireworks`, `nvidia`, `alibaba`, `moonshot`, `zhipu`, `venice` | |

### Araç (Tool) Çağrısı Desteği

| Sağlayıcı | Protokol |
| --- | --- |
| Gemini | `functionCall` + `thoughtSignature` (önceki tur imzasıyla birlikte geri oynatılır) |
| Anthropic | `tool_use` / `tool_result` blokları, doğru `index` eşlemesiyle akış (SSE) |
| OpenAI | `tool_calls` / `role: "tool"` mesajları |

Model metin içinde araç çağrısı JSON'u basmaya çalışırsa ham JSON kullanıcıya gösterilmez; bunun yerine açıklayıcı bir bilgilendirme akışa yazılır. Araç desteklemeyen modeller için çağrı mekanizması kapalıdır.

---

## 🎓 Google Classroom Bağlantısı

Google Classroom entegrasyonu standart OAuth 2.0 PKCE akışıyla, tarayıcı üzerinden güvenli bir şekilde yapılır:

1. Uygulamayı ilk kez açtığınızda veya Ayarlar > Hesaplar sekmesinden "Google ile Bağlan" butonuna tıklayın.
2. Açılan tarayıcı sekmesinde okul/eğitim Workspace hesabınızı seçin.
3. İstenen salt-okunur ders ve ödev erişim izinlerini onaylayın.
4. Başarılı onay sonrası uygulama otomatik olarak sınıflarınızı ve ödevlerinizi yerel diskinize senkronize eder.

Oturum kalıcı olarak saklanır; uygulamayı kapatıp yeniden açtığınızda tekrar giriş yapmanız gerekmez. Senkronizasye hataları sol üstteki şeritte görünür ve **X** düğmesiyle kapatılabilir; ders/ödev listesi hataları ile senkronizasyo hataları ayrı ayrı yönetilir.

---

## 🛠️ Geliştirici Ortamı (Development)

Projeyi yerel ortamınızda kaynak koddan derlemek veya katkıda bulunmak için:

### Gereksinimler

- **Node.js**: v20.0.0 veya üzeri
- **pnpm**: v9.0.0 veya üzeri

```bash
# Depoyu klonlayın
git clone https://github.com/MrSpy00/JustMyClass.git
cd JustMyClass

# Bağımlılıkları yükleyin
pnpm install

# Geliştirme modunu başlatın
pnpm dev

# Tip denetimi ve testleri çalıştırın
pnpm typecheck
pnpm test

# Windows Setup ve Portable paketlerini derleyin
pnpm build:win
```

Windows kullanıcıları için kök dizindeki `build.bat` aracı ile tüm adımlar menüden yürütülebilir:

```bat
build.bat dev       # Geliştirme sunucusunu açar
build.bat test      # Typecheck + Vitest testlerini koşturur
build.bat build     # Kurulum ve taşınabilir exe derlemelerini alır
```

### Test Kapsamı

176 Vitest testi, saf Node.js (harici bağımlılık yok) ayıklayıcılarını ve veri
servislerini kapsar:

| Test dosyası | Kapsam |
| --- | --- |
| `tests/documentExtraction.test.ts` | PDF/DOCX/XLSX/PPTX çözümleme, ZIP merkezi dizini, görsel ölçüleri |
| `tests/dataDir.test.ts` | Veri klasörü çözümlemesi, `process.cwd()` yasağı, veri içeren klasör önceliği |
| `tests/storageService.test.ts` | Bozuk depo **korunur** (silinmez) |
| `tests/vaultService.test.ts` | Bozuk kasa **korunur** (silinmez) |
| `tests/authService.test.ts` | Çıkış yapmak veri silmez |
| `tests/updateService.test.ts` | Güncelleme hata mesajlarında iç dosya adı sızmaz |

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında açık kaynak olarak lisanslanmıştır.
Copyright (c) 2026 MrSpy.
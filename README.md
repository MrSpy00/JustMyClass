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
- **22+ Yapay Zekâ Sağlayıcısı & Kesintisiz Araç Yürütme:** Google Gemini, Anthropic Claude, OpenAI, Groq, DeepSeek, xAI, Mistral, Ollama ve yerel modeller. Akıllı araç yürütme (tool execution) döngüsü ve ağ bağlantı hatalarında otomatik kurtarma.
- **Zengin Dosya & Medya Görüntüleyici:**
  - **PDF & Dokümanlar:** Bounded akış çözümleyici ve okunabilirlik filtresiyle bozuk ikili karakterler süzülür, temiz metin ve yerleşik önizleme sağlanır.
  - **Kod & Metin:** Prism.js tabanlı syntax highlighting, satır numaralandırması, metin içi arama ve tekilleştirilmiş kusursuz gösterim.
  - **YouTube & Web Bağlantıları:** Doğrudan uygulama içinde YouTube oynatıcı, tarayıcıda tek tıkla açma ve panoya bağlantı kopyalama (gereksiz indirme butonları yer almaz).
  - **Google Drive Dosyaları:** Tek tıkla İndirilenler klasörüne indirme, dosya açma ve klasörde gösterme entegrasyonu.
- **Akıllı ve Çakışmasız Panel Yerleşimi:** Yan paneller (Dersler ve Yapay Zekâ Asistanı) kapatıldığında üst yardımcı şerit üzerinden tek tıkla geri açılabilir; hiçbir buton veya içerik örtüşmez, altında kaybolmaz.
- **Kusursuz Windows Entegrasyonu:** Windows başlangıç ve tarayıcı protokol onaylarında yalnızca net ve sade `"JustMyClass"` olarak görünür.
- **Karanlık Mor (Amethyst) & Siyah Yetkilendirme Sayfası:** Google Classroom OAuth 2.0 PKCE bağlantısı sırasında şık, göz alıcı siyah ve mor temalı geri dönüş ekranı.
- **GitHub Releases Otomatik Güncelleme:** Resmi depodan (`MrSpy00/JustMyClass`) `latest.yml` ve kurulum dosyalarını denetler, doğrudan indirme ve kurma desteği sunar.
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

## 📦 Kurulum ve İndirme

En güncel sürümleri [GitHub Releases](https://github.com/MrSpy00/JustMyClass/releases) sayfasından indirebilirsiniz:

| Paket | Açıklama |
| --- | --- |
| **`JustMyClass-Setup-0.0.1-x64.exe`** | **Önerilen Kurulum Sihirbazı:** Kurulum dizinini, masaüstü/başlat menüsü kısayollarını ayarlar ve otomatik kaldırıcı ile gelir. |
| **`JustMyClass-Portable-0.0.1.exe`** | **Taşınabilir Sürüm:** Kurulum gerektirmez, USB bellekten veya doğrudan çift tıklanarak çalıştırılabilir. |

---

## 🤖 Desteklenen Yapay Zekâ Sağlayıcıları

JustMyClass, 22 farklı yapay zekâ sağlayıcısını destekler. Sağlayıcı anahtarınızı girdiğiniz anda modeller doğrudan ilgili sağlayıcının güncel API'sinden anlık çekilir:

| Sağlayıcı | Kimlik | Model Tipleri / Notlar |
| --- | --- | --- |
| **Google Gemini** | `gemini` | Gemini 2.0 Flash, Gemini 1.5 Pro, Flash-Lite (Google AI Studio'dan ücretsiz anahtar alınabilir) |
| **Anthropic** | `anthropic` | Claude 3.7 Sonnet, Claude 3.5 Haiku, Claude 3 Opus |
| **OpenAI** | `openai` | GPT-4o, GPT-4o-mini, o1, o3-mini |
| **Groq** | `groq` | Llama 3.3 70B, DeepSeek R1 Distill (Ultra hızlı çıkarım, ücretsiz katman) |
| **DeepSeek** | `deepseek` | DeepSeek-V3, DeepSeek-R1 |
| **xAI** | `xai` | Grok-2 |
| **Mistral AI** | `mistral` | Mistral Large, Codestral, Pixtral |
| **OpenRouter** | `openrouter` | Tek API anahtarı ile yüzlerce modele erişim |
| **Ollama** | `ollama` | **Yerel (Local):** API anahtarı gerektirmez, kendi donanımınızda çevrimdışı çalışır |
| **LM Studio** | `lmstudio` | **Yerel (Local):** Yerel OpenAI uyumlu sunucu |
| **llama.cpp** | `llamacpp` | **Yerel (Local):** Hafif C++ yerel çıkarım sunucusu |
| *ve diğerleri...* | `cerebras`, `together`, `siliconflow`, `novita`, `fireworks`, `nvidia`, `alibaba`, `moonshot`, `zhipu`, `venice` |

---

## 🎓 Google Classroom Bağlantısı

Google Classroom entegrasyonu standart OAuth 2.0 PKCE akışıyla, tarayıcı üzerinden güvenli bir şekilde yapılır:
1. Uygulamayı ilk kez açtığınızda veya Ayarlar > Hesaplar sekmesinden "Google ile Bağlan" butonuna tıklayın.
2. Açılan tarayıcı sekmesinde okul/eğitim Workspace hesabınızı seçin.
3. İstenen salt-okunur ders ve ödev erişim izinlerini onaylayın.
4. Başarılı onay sonrası uygulama otomatik olarak sınıflarınızı ve ödevlerinizi yerel diskinize senkronize eder.

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

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında açık kaynak olarak lisanslanmıştır.  
Copyright (c) 2026 MrSpy.
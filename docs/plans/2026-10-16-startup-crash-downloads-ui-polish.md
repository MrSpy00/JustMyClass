# JustMyClass - Başlatma Hatası Onarımı, Akıllı İndir/Aç Buton Sistemi, Alt-Orta Bildirimler ve Premium UI İyileştirme Planı

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Uygulamanın açılışındaki `-300 ERR_INVALID_URL` çökmesini tamamen gidermek, İndirilenler klasörünü disk düzeyinde kontrol ederek "İndir" butonunun otomatik ve akıllı bir şekilde "Aç" ve "Klasörde Göster" butonlarına dönüşmesini sağlamak, tüm bildirim/toast pencerelerini metin girişini engellemeyecek şekilde ekranın alt ortasına almak, tasarım keskinliğini yumuşatarak premium bir UI/UX deneyimi sunmak, güncelleme algoritmasını çoklu doğrulamalı hale getirmek ve 0.0.1 sürümü için güncel buildleri GitHub'a yüklemek.

**Architecture:**
- **Pencere & Yükleme Katmanı:** `electron/main.ts` içerisinde paketlenmiş mod kontrolü güçlendirilir, `process.env.VITE_DEV_SERVER_URL` paketli uygulamada kesinlikle devre dışı bırakılır, `did-fail-load` yalnızca ana pencere (`isMainFrame === true`) için sınırlandırılır ve `url.pathToFileURL` ile güvenli yerel dosya yükleme geri dönüşü eklenir.
- **İndirme ve Dosya Varlık Servisi:** Electron ana sürecine `downloads:checkFileStatus` IPC kanalı eklenir. Dosya disk üzerinde (kullanıcının İndirilenler klasöründe) mevcutsa dosya yolu ve boyut doğrulanarak bildirilir; arayüzdeki butonlar statik değil reaktif olarak "İndir" ➔ "Aç" + "Klasörde Göster" moduna geçer.
- **Bildirim & Toast Mimarisi:** `App.tsx` ve diğer bileşenlerdeki bildirimler `bottom-6 right-6` yerine `bottom-6 left-1/2 -translate-x-1/2` ile ekranın alt-orta konumuna, zarif pill biçiminde, blur ve yumuşak gölgelerle yerleştirilir.
- **UI Yumuşatma & Tasarım:** `index.css` ve `themeConfig.ts` sınır yarıçapları (radius), gölge katmanları ve kenarlık kontrastları yumuşatılır; keskin hatlar yerine modern, soft geçişli kartlar ve butonlar uygulanır.

**Tech Stack:** Electron 35, React 19, TypeScript 5.8, Tailwind CSS v4, Lucide Icons, Vitest, electron-builder.

---

### Görev 1: Başlatma Çökmesi (-300 ERR_INVALID_URL) Kesin Onarımı
### Görev 2: Akıllı İndir / Aç Buton Dönüşüm Sistemi (Disk Kontrollü)
### Görev 3: Bildirimleri Ekranın Alt Ortasına Taşıma
### Görev 4: Tasarım & UI Keskinliğini Yumuşatma (Soft & Smooth Premium)
### Görev 5: Gelişmiş, Doğrulamalı ve Dayanıklı Güncelleme Algoritması
### Görev 6: Testler, Derleme, Git Push ve 0.0.1 GitHub Release Güncellemesi

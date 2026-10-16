# Google Classroom API Kapsam Denetimi

> Bu belge, uygulamanın istediği OAuth kapsamlarını **Google'ın resmî
> referansıyla tek tek karşılaştırır**, eksikleri ve kullanılmayanları
> gösterir, ve eklenebilecek yetenekleri listeler.

**Denetim tarihi:** 16 Ekim 2026
**Dayanak:** `developers.google.com/workspace/classroom/reference/rest/v1/*`
— her uç sayfasındaki "Authorization scopes" bölümü.

---

## 1. Uygulamanın gerçekte çağırdığı uçlar

`electron/services/classroomService.ts` ve `driveService.ts` içindeki
her `GET`/`POST`/`PATCH` aşağıdadır.

| # | Uç | Yöntem | İstenen kapsam | Durum |
| --- | --- | --- | --- | --- |
| 1 | `/v1/courses` (`courseWorkStates` ile) | GET | `classroom.courses.readonly` | ✅ |
| 2 | `/v1/courses/{id}/announcements` | GET | `classroom.announcements.readonly` | ✅ |
| 3 | `/v1/courses/{id}/topics` | GET | `classroom.topics.readonly` | ✅ *(düzeltildi)* |
| 4 | `/v1/courses/{id}/teachers` | GET | `classroom.rosters.readonly` | ✅ |
| 5 | `/v1/courses/{id}/students` | GET | `classroom.rosters.readonly` | ✅ |
| 6 | `/v1/courses/{id}/courseWork` | GET | `classroom.coursework.me` | ✅ |
| 7 | `/v1/courses/{id}/courseWork/{id}/rubrics` | GET | `classroom.coursework.me` | ✅ |
| 8 | `…/studentSubmissions?userId=me` | GET | `classroom.coursework.me` | ✅ |
| 9 | `…/studentSubmissions` (tümü) | GET | `classroom.coursework.students.readonly` | ✅ *(yükseltilmiş)* |
| 10 | `…/studentSubmissions/{id}` | GET | `classroom.coursework.students.readonly` | ✅ *(yükseltilmiş)* |
| 11 | `…/studentSubmissions/{id}` | PATCH | `classroom.coursework.me` | ✅ |
| 12 | `…/studentSubmissions:turnIn` | POST | `classroom.coursework.me` | ✅ |
| 13 | `…/studentSubmissions:reclaim` | POST | `classroom.coursework.me` | ✅ |
| 14 | `/v1/courses/{id}/courseWorkMaterials` | GET | `classroom.courseworkmaterials.readonly` | ✅ *(düzeltildi)* |
| 15 | `/v1/files` (yükleme) | POST | `drive.file` | ✅ |
| 16 | `/v1/files/{id}` | GET | `drive.readonly` | ✅ |
| 17 | `/v1/files/{id}/export` | GET | `drive.readonly` | ✅ |
| 18 | `oauth2/v3/userinfo` | GET | `openid`, `userinfo.*` | ✅ |

---

## 2. Bulunan ve düzeltilen iki eksik kapsam

### 2.1 `classroom.topics.readonly` — **yoktu**

`GET /v1/courses/{id}/topics` çağrılıyordu ama gerekli kapsam
`classroom.topics.readonly`. `classroom.courses.readonly` bunu
**kapsamaz** — Classroom API her kaynak için ayrı kapsam ister ve
kapsamlar birbirinin yerine geçmez.

Sonuç: Konu listesi 403 alıyordu, o bölüm sessizce boş kalıyordu.

**Eklenen kapsam:** `https://www.googleapis.com/auth/classroom.topics.readonly`
— salt okunur, hassas değil.

### 2.2 `classroom.courseworkmaterials.readonly` — **yoktu**

`GET /v1/courses/{id}/courseWorkMaterials` çağrılıyordu ama gerekli
kapsam `classroom.courseworkmaterials.readonly`. Bu da
`classroom.courses.readonly` ile kapsanmaz.

Sonuç: Ders materyalleri 403 alıyordu; ödevlere iliştirilmiş
 materyaller hiç görünmüyordu.

**Eklenen kapsam:**
`https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly`
— salt okunur, hassas değil.

---

## 3. İstenen kapsamların tamamı

### Temel kapsamlar (`BASE_SCOPES`)

| Kapsam | Ne için | Hassas mı |
| --- | --- | --- |
| `openid` | Kimlik akışı; `email` alanının dolması için zorunlu | Hayır |
| `userinfo.profile` | Hesap adı, fotoğraf | Hayır |
| `userinfo.email` | E-posta; üniversite/şube çözümlemesi | Hayır |
| `classroom.courses.readonly` | Ders listesi ve devam durumu | Hayır |
| `classroom.announcements.readonly` | Duyurular | Hayır |
| `classroom.coursework.me` | Kendi ödevin, rubrikler, **teslim ve geri alma** | Hayır |
| `classroom.student-submissions.me.readonly` | Kendi notların/teslimlerin okunması | Hayır |
| `classroom.courseworkmaterials.readonly` | Ders materyalleri | Hayır |
| `classroom.topics.readonly` | Konular | Hayır |
| `classroom.rosters.readonly` | Öğrenci ve öğretmen listeleri | Hayır |
| `drive.readonly` | Ders dosyalarını okuma, dışa aktarma | Hayır |
| `drive.file` | **Yalnızca bu uygulamanın oluşturduğu** Drive dosyalarına yazma | Hayır |

### Yükseltilmiş kapsamlar (`ELEVATED_SCOPES`, isteğe bağlı)

| Kapsam | Ne için | Hassas mı |
| --- | --- | --- |
| `classroom.coursework.students.readonly` | Ödevin **tüm** öğrenci teslimlerini okuma | Hayır |
| `classroom.student-submissions.students.readonly` | Öğrenci teslimlerini geniş kapsamda okuma | Hayır |

### Dikkat çeken nokta: teslim için ayrı yazma kapsamı **gerekmez**

İlk bakışta “ödev teslim etmek” bir yazma yetkisi gerektiriyor gibi
görünür. Google'ın referansı bunu açıkça doğrular:

| Uç | Kabul edilen kapsamlar |
| --- | --- |
| `courseWork.studentSubmissions.turnIn` | `classroom.coursework.me` |
| `courseWork.studentSubmissions.reclaim` | `classroom.coursework.me` |
| `courseWork.studentSubmissions.patch` | `classroom.coursework.me`, `classroom.coursework.students` |

`classroom.coursework.me` **“View and manage your course work”**
kapsamıdır: kendi ödevinizi oluşturma, teslim etme, geri alma ve
puanını görme yetkilerini kapsar. Dolayısıyla `classroom.coursework`
(korunmuş/hassas) kapsamı **istenmemektedir**.

**Sonuç:** Not değiştirme, sınıf yönetme veya başkasının ödevine
erişme yetkisi yoktur. Yazma yetkisi yalnızca sizin kendi
tesliminizle sınırlıdır.

---

## 4. Google’ın “izin verilen eylemler” metni doğru mu?

Google onay ekranında şu satırı gösterir:

> “Bu, JustMyClass uygulamasının şunları yapmasına olanak tanır:”

Bu liste **uygulamanın değil, istediği kapsamların** tanımıdır ve
kapsam listesinden otomatik üretilir. Uygulamanın gerçekten yaptığı
eylemlerle bire bir örtüşmez — çünkü Google yalnızca “hangi izin
verildi” bilgisini görür, “hangi ekranlarda ne yapıldı” bilgisini
göremez.

Örnek: `classroom.rosters.readonly` için Google “öğrenci ve öğretmen
listelerini görme” der. Bu doğrudur ve tam olarak kullanılan şeydir.

### Denetimde eksik bulunan kapsamlar

| Kapsam | Ne zaman gerekli |
| --- | --- |
| `classroom.courses` (yazma) | Sınıf oluşturma/yeniden adlandırma/silme — **uygulama yapmıyor** |
| `classroom.announcements` (yazma) | Duyuru yayınlama — **uygulama yapmıyor** |
| `classroom.coursework.students` (yazma) | Başkasının teslimine **not yazma** — **uygulama yapmıyor ve yapmamalı** |
| `classroom.rosters` (yazma) | Öğrenci ekleme/çıkarma — **uygulama yapmıyor** |
| `classroom.topics` (yazma) | Konu oluşturma — **uygulama yapmıyor** |
| `drive` (tam) | Tüm Drive dosyalarına erişim — **yalnızca `drive.file` yeterli** |

Bu kapsamların hiçbiri istenmez. İstenmeleri hem Google incelemesini
zorlaştırır hem de kullanıcıya “uygulama neden notlarımı
değiştirebiliyor?” sorusu doğurur.

---

## 5. Eklenebilecek yetenekler

Aşağıdakiler **yalnızca isteğe bağlı**dır. Hiçbiri eklenmedi; eklenmesi
gereken durumlar belirtilmiştir.

### 5.1 Eklenebilir — salt okunur, düşük maliyetli

| Yetenek | Uç | Gerekli kapsam | Ne sağlar |
| --- | --- | --- | --- |
| **Ödev not geçmişi** | `courseWork.studentSubmissions` (`history`) | `coursework.students.readonly` | Teslim geçmişi ve not değişiklikleri |
| **Ders kodu ile katılma teklifi** | `invitations.list` | `classroom.courses` (yazma) | Davet koduyla ders arama |
| **Sınıf dışı ödevler** | `courses.courseWork.list` (`courseWorkStates=CREATED`) | `classroom.coursework.me` | Henüz başlanmamış ödevleri de gösterme |
| **Ödev ek yorumları** | `studentSubmissions.assignedGrade.answer.submissionComments` | mevcut kapsamlar | Öğretmen notlarının tam metni |
| **Not kriterleri** | `courses.courseWork.rubrics` (tam) | mevcut kapsamlar | Rubrik kriterlerinin puan aralıkları |
| **Ödev ek dosyaları** | `courseWork.addOnAttachments` | mevcut kapsamlar | Materyal listesi zaten geliyor |
| **Öğrenci grupları** | `courses.studentGroups` | `classroom.rosters` | Grup ödevlerinde grup üyeliği |
| **Puan dönemleri** | `courses.gradingPeriods` | `classroom.courses.readonly` | Not dönemi takvimi |

### 5.2 Düşünülmesi gerekenler — yazma yetkisi ister

| Yetenek | Gerekli kapsam | Risk değerlendirmesi |
| --- | --- | --- |
| Duyuru okundu işaretleme | `classroom.announcements` | Düşük risk, ama çoğu kullanıcı için değer düşük |
| Ödev taslağı oluşturma | `classroom.coursework.me` | **Zaten var** — `coursework.me` kapsar |
| Teslimi geri alma | `classroom.coursework.me` | **Zaten var** |

### 5.3 Önerilmeyenler

| Yetenek | Neden |
| --- | --- |
| Not yazma (`coursework.students` yazma) | Öğretmen rolü karışmasına yol açar; öğrenci aracı değildir |
| Sınıf yönetimi | Kapsamı çok geniş, kullanıcı değeri belirsiz |
| Drive tam erişim (`drive`) | `drive.readonly` + `drive.file` yeterli; `drive` gereksiz yüzlerce dosyayı açar |
| Takvim / Gmail | Kapsam dışı; `classroom.meetings` ekranı için ayrı değerlendirme gerekir |

---

## 6. Kişisel @gmail.com hesapları

Google Classroom, **yalnızca Workspace for Education** kuruluşlarında
vardır. Kişisel `@gmail.com` hesabına giriş yapıldığında:

- Onay ekranı görünür ve kabul edilir,
- Token alınır,
- Ancak `classroom.googleapis.com` **boş liste** döner veya
  403 döner.

Uygulama bu durumu özel bir ekranla karşılar
(`accountCapability`), “Google Classroom kullanılamıyor” başlığıyla
ve Ayarlar bağlantısıyla. Bu bir hata değil, platform kısıtıdır.

---

## 7. Denetimi tekrarlama

Bir kapsam eklendiğinde veya bir uç eklendiğinde bu üç adımı tekrarlayın:

1. `electron/services/authService.ts` → `BASE_SCOPES` içindeki her
   satırın yorumu, **hangi ucu kapsadığını** söyler. Yeni bir satır
   eklerken bu yorum zorunludur.
2. Yeni ucun Google referans sayfasındaki “Authorization scopes”
   bölümüne bakın; kapsamı tahmin etmeyin.
3. `GET` çağrılarında eksik kapsam sessizce **boş liste** üretir —
   `403` hatası bile gelmeyebilir. Bu yüzden kapsam denetimi
   ayrıca yapılmalıdır.

---

## Özet

| Soru | Cevap |
| --- | --- |
| İstenen kapsamlar eksiksiz mi? | **Evet** — bu denetimde bulunan iki eksik (`topics`, `courseworkmaterials`) giderildi. |
| Gereksiz/hassas kapsam var mı? | **Hayır** — hepsi salt okunur; tek yazma yetkisi `drive.file` ve kendi ödev tesliminizle sınırlı. |
| Onay ekranındaki “izin verilen eylemler” doğru mu? | Evet, ancak bu **izinlerin** tanımıdır; uygulamanın gerçekte yaptığı eylemlerin alt kümesidir ve tam olarak kullanılanlar yukarıda listelidir. |
| Daha fazlası kullanılabilir mi? | Evet — §5’teki salt okunur yetenekler eklenebilir; maliyetleri düşüktür. |
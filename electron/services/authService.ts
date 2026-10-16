import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import { Account } from '../../types/jmc'
import { VaultService } from './vaultService'
import { StorageService } from './storageService'
import {
  getInjectedGoogleClientId,
  getInjectedGoogleClientSecret,
  describeClientIdSource,
} from '../config/oauth'

/** OAuth geri cagirma sunucusu icin guvenli bekleme suresi (120 saniye). */
/**
 * OAuth geri donus sunucusunun beklenecegi sure.
 *
 * ONCEKI DEGER: 120 saniye. BU COZUMDU.
 *
 * Sorun su yasamanin birbirine bagli olmasi:
 *   1. Kullanici "Google ile devam et" der, tarayici acilir.
 *   2. Google onay ekranini gosterir. Bu ekran JUSTMyClass icin
 *      ~8 kapsam listeler, ogrencinin okuyup anlamasi zaman alir.
 *      Korunmus (restricted) kapsamlar icin ek bir dogrulama ekrani
 *      daha gelir.
 *   3. Sure dolunca `finish()` -> `closeActiveServer()` -> **yerel
 *      sunucu kapanir**, ama promise reddedilir ve kullaniciya hata
 *      gosterilir.
 *   4. Kullanici onay ekraninda "Izin ver" tusuna basar.
 *   5. Google `http://127.0.0.1:<port>/oauth/callback` adresine
 *      yonlendirir. Kimse dinlemiyor ->
 *      **ERR_CONNECTION_REFUSED / "Bu siteye ulaşılamıyor"**.
 *
 * Yani kullaniciya iki farkli, birbiriyle baglantısiz hata gorunuyor
 * ve gercek nedeni (suresi doldu) ikincisi saniliyor.
 *
 * Cozum: sure 10 dakikaya cikarildi VE zaman asimi olsa bile sunucu
 * bir "sonra" sure boyunca ACIK kalir; gec gelen bir yonlendirme
 * calismaya devam eder. Kullanici onay ekraninda ne kadar kalirsa
 * kalsin giris tamamlanir.
 */
const AUTH_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Zaman asimi sonrasi sunucunun acik kalacagi ek sure.
 *
 * Yukaridaki senaryonun 4. adimini kurtarir: kullanici "Izin ver"
 * dedikten sonra gec yonlendirme calismaya devam eder.
 */
const AUTH_GRACE_MS = 5 * 60 * 1000

export interface UniversityInfo {
  institution: string
  domain: string
  isEdu: boolean
  isEduTr: boolean
  country?: string
}

function formatTitleCaseWords(str: string): string {
  return str
    .split(/[-_.]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/**
 * E-posta veya barindirilan alan adi (hosted domain) uzerinden
 * universite / kurum bilgisini uluslararasi ve yerel duzeyde cozumler.
 * Turkiye (.edu.tr), ABD & Kuresel (.edu), Ingiltere (.ac.uk), Kanada (.ca),
 * Almanya (.de), Isvicre (.ch), Japonya (.ac.jp), Avustralya (.edu.au), Singapur (.edu.sg)
 * ve tum dunya universitelerini kapsar.
 */
export function resolveUniversityInfo(email: string, hostedDomain?: string): UniversityInfo {
  const rawDomain = (hostedDomain || email.split('@')[1] || '').toLowerCase().trim()
  const domain = rawDomain.replace(/^www\./, '')

  // Alt alan adlarini (ogr., student., alumni., cs., mail., vb.) ana kurum alanina normalize et
  const SUBDOMAIN_STRIP = /^(ogr|student|students|alumni|alumnus|mail|posta|std|stu|cs|ee|math|eng|webmail|my|post|college)\./i
  let baseDomain = domain
  while (SUBDOMAIN_STRIP.test(baseDomain)) {
    baseDomain = baseDomain.replace(SUBDOMAIN_STRIP, '')
  }

  const isEduTr = domain.endsWith('.edu.tr') || baseDomain.endsWith('.edu.tr')

  const knownUniversities: Record<string, { name: string; country: string }> = {
    // ---- Türkiye Üniversiteleri (.edu.tr / .edu) ----
    'itu.edu.tr': { name: 'İstanbul Teknik Üniversitesi (İTÜ)', country: 'TR' },
    'metu.edu.tr': { name: 'Orta Doğu Teknik Üniversitesi (ODTÜ)', country: 'TR' },
    'odtu.edu.tr': { name: 'Orta Doğu Teknik Üniversitesi (ODTÜ)', country: 'TR' },
    'boun.edu.tr': { name: 'Boğaziçi Üniversitesi', country: 'TR' },
    'gazi.edu.tr': { name: 'Gazi Üniversitesi', country: 'TR' },
    'hacettepe.edu.tr': { name: 'Hacettepe Üniversitesi', country: 'TR' },
    'ankara.edu.tr': { name: 'Ankara Üniversitesi', country: 'TR' },
    'ege.edu.tr': { name: 'Ege Üniversitesi', country: 'TR' },
    'deu.edu.tr': { name: 'Dokuz Eylül Üniversitesi', country: 'TR' },
    'yildiz.edu.tr': { name: 'Yıldız Teknik Üniversitesi (YTÜ)', country: 'TR' },
    'ytu.edu.tr': { name: 'Yıldız Teknik Üniversitesi (YTÜ)', country: 'TR' },
    'marmara.edu.tr': { name: 'Marmara Üniversitesi', country: 'TR' },
    'istanbul.edu.tr': { name: 'İstanbul Üniversitesi', country: 'TR' },
    'bilkent.edu.tr': { name: 'İhsan Doğramacı Bilkent Üniversitesi', country: 'TR' },
    'ku.edu.tr': { name: 'Koç Üniversitesi', country: 'TR' },
    'sabanciuniv.edu': { name: 'Sabancı Üniversitesi', country: 'TR' },
    'anadolu.edu.tr': { name: 'Anadolu Üniversitesi', country: 'TR' },
    'akdeniz.edu.tr': { name: 'Akdeniz Üniversitesi', country: 'TR' },
    'cukurova.edu.tr': { name: 'Çukurova Üniversitesi', country: 'TR' },
    'erciyes.edu.tr': { name: 'Erciyes Üniversitesi', country: 'TR' },
    'sakarya.edu.tr': { name: 'Sakarya Üniversitesi', country: 'TR' },
    'uludag.edu.tr': { name: 'Bursa Uludağ Üniversitesi', country: 'TR' },
    'ktu.edu.tr': { name: 'Karadeniz Teknik Üniversitesi (KTÜ)', country: 'TR' },
    'gtu.edu.tr': { name: 'Gebze Teknik Üniversitesi (GTÜ)', country: 'TR' },
    'iyte.edu.tr': { name: 'İzmir Yüksek Teknoloji Enstitüsü (İYTE)', country: 'TR' },
    'tobb.edu.tr': { name: 'TOBB Ekonomi ve Teknoloji Üniversitesi', country: 'TR' },
    'medipol.edu.tr': { name: 'İstanbul Medipol Üniversitesi', country: 'TR' },
    'yeditepe.edu.tr': { name: 'Yeditepe Üniversitesi', country: 'TR' },
    'bahcesehir.edu.tr': { name: 'Bahçeşehir Üniversitesi', country: 'TR' },
    'ozyegin.edu.tr': { name: 'Özyeğin Üniversitesi', country: 'TR' },
    'khas.edu.tr': { name: 'Kadir Has Üniversitesi', country: 'TR' },
    'aybu.edu.tr': { name: 'Ankara Yıldırım Beyazıt Üniversitesi', country: 'TR' },
    'tau.edu.tr': { name: 'Türk-Alman Üniversitesi', country: 'TR' },
    'gsu.edu.tr': { name: 'Galatasaray Üniversitesi', country: 'TR' },
    'msgsu.edu.tr': { name: 'Mimar Sinan Güzel Sanatlar Üniversitesi', country: 'TR' },
    'selcuk.edu.tr': { name: 'Selçuk Üniversitesi', country: 'TR' },
    'firat.edu.tr': { name: 'Fırat Üniversitesi', country: 'TR' },
    'inonu.edu.tr': { name: 'İnönü Üniversitesi', country: 'TR' },
    'ogu.edu.tr': { name: 'Eskişehir Osmangazi Üniversitesi', country: 'TR' },
    'pau.edu.tr': { name: 'Pamukkale Üniversitesi', country: 'TR' },
    'kocaeli.edu.tr': { name: 'Kocaeli Üniversitesi', country: 'TR' },

    // ---- ABD & Küresel (.edu) ----
    'harvard.edu': { name: 'Harvard University', country: 'US' },
    'mit.edu': { name: 'Massachusetts Institute of Technology (MIT)', country: 'US' },
    'stanford.edu': { name: 'Stanford University', country: 'US' },
    'berkeley.edu': { name: 'University of California, Berkeley (UC Berkeley)', country: 'US' },
    'princeton.edu': { name: 'Princeton University', country: 'US' },
    'yale.edu': { name: 'Yale University', country: 'US' },
    'columbia.edu': { name: 'Columbia University', country: 'US' },
    'cornell.edu': { name: 'Cornell University', country: 'US' },
    'cmu.edu': { name: 'Carnegie Mellon University (CMU)', country: 'US' },
    'caltech.edu': { name: 'California Institute of Technology (Caltech)', country: 'US' },
    'uchicago.edu': { name: 'University of Chicago', country: 'US' },
    'upenn.edu': { name: 'University of Pennsylvania (Penn)', country: 'US' },
    'jhu.edu': { name: 'Johns Hopkins University', country: 'US' },
    'ucla.edu': { name: 'University of California, Los Angeles (UCLA)', country: 'US' },
    'nyu.edu': { name: 'New York University (NYU)', country: 'US' },
    'umich.edu': { name: 'University of Michigan', country: 'US' },
    'utexas.edu': { name: 'University of Texas at Austin', country: 'US' },
    'washington.edu': { name: 'University of Washington', country: 'US' },
    'gatech.edu': { name: 'Georgia Institute of Technology (Georgia Tech)', country: 'US' },
    'illinois.edu': { name: 'University of Illinois Urbana-Champaign (UIUC)', country: 'US' },
    'purdue.edu': { name: 'Purdue University', country: 'US' },
    'northwestern.edu': { name: 'Northwestern University', country: 'US' },
    'duke.edu': { name: 'Duke University', country: 'US' },
    'brown.edu': { name: 'Brown University', country: 'US' },
    'dartmouth.edu': { name: 'Dartmouth College', country: 'US' },
    'usc.edu': { name: 'University of Southern California (USC)', country: 'US' },
    'ucsd.edu': { name: 'University of California San Diego (UCSD)', country: 'US' },
    'wisc.edu': { name: 'University of Wisconsin-Madison', country: 'US' },

    // ---- İngiltere (.ac.uk) ----
    'ox.ac.uk': { name: 'University of Oxford', country: 'GB' },
    'oxford.ac.uk': { name: 'University of Oxford', country: 'GB' },
    'cam.ac.uk': { name: 'University of Cambridge', country: 'GB' },
    'cambridge.ac.uk': { name: 'University of Cambridge', country: 'GB' },
    'imperial.ac.uk': { name: 'Imperial College London', country: 'GB' },
    'ucl.ac.uk': { name: 'University College London (UCL)', country: 'GB' },
    'ed.ac.uk': { name: 'University of Edinburgh', country: 'GB' },
    'manchester.ac.uk': { name: 'University of Manchester', country: 'GB' },
    'kcl.ac.uk': { name: "King's College London", country: 'GB' },
    'lse.ac.uk': { name: 'London School of Economics (LSE)', country: 'GB' },
    'bristol.ac.uk': { name: 'University of Bristol', country: 'GB' },
    'warwick.ac.uk': { name: 'University of Warwick', country: 'GB' },
    'glasgow.ac.uk': { name: 'University of Glasgow', country: 'GB' },
    'southampton.ac.uk': { name: 'University of Southampton', country: 'GB' },
    'bham.ac.uk': { name: 'University of Birmingham', country: 'GB' },
    'leeds.ac.uk': { name: 'University of Leeds', country: 'GB' },
    'sheffield.ac.uk': { name: 'University of Sheffield', country: 'GB' },

    // ---- İsviçre (.ch) ----
    'ethz.ch': { name: 'ETH Zurich (Eidgenössische Technische Hochschule Zürich)', country: 'CH' },
    'epfl.ch': { name: 'EPFL (École Polytechnique Fédérale de Lausanne)', country: 'CH' },
    'uzh.ch': { name: 'University of Zurich', country: 'CH' },
    'unige.ch': { name: 'University of Geneva', country: 'CH' },

    // ---- Kanada (.ca, .edu.ca) ----
    'utoronto.ca': { name: 'University of Toronto', country: 'CA' },
    'ubc.ca': { name: 'University of British Columbia (UBC)', country: 'CA' },
    'mcgill.ca': { name: 'McGill University', country: 'CA' },
    'uwaterloo.ca': { name: 'University of Waterloo', country: 'CA' },
    'ualberta.ca': { name: 'University of Alberta', country: 'CA' },
    'umontreal.ca': { name: 'Université de Montréal', country: 'CA' },
    'mcmaster.ca': { name: 'McMaster University', country: 'CA' },
    'ucalgary.ca': { name: 'University of Calgary', country: 'CA' },

    // ---- Almanya (.de) ----
    'tum.de': { name: 'Technical University of Munich (TUM)', country: 'DE' },
    'lmu.de': { name: 'LMU Munich (Ludwig-Maximilians-Universität)', country: 'DE' },
    'uni-heidelberg.de': { name: 'Heidelberg University', country: 'DE' },
    'hu-berlin.de': { name: 'Humboldt University of Berlin', country: 'DE' },
    'fu-berlin.de': { name: 'Free University of Berlin', country: 'DE' },
    'rwth-aachen.de': { name: 'RWTH Aachen University', country: 'DE' },
    'uni-bonn.de': { name: 'University of Bonn', country: 'DE' },
    'uni-tuebingen.de': { name: 'University of Tübingen', country: 'DE' },
    'kit.edu': { name: 'Karlsruhe Institute of Technology (KIT)', country: 'DE' },

    // ---- Fransa (.fr, .eu) ----
    'sorbonne-universite.fr': { name: 'Sorbonne Université', country: 'FR' },
    'polytechnique.edu': { name: 'École Polytechnique', country: 'FR' },
    'universite-paris-saclay.fr': { name: 'Université Paris-Saclay', country: 'FR' },
    'ens.psl.eu': { name: 'ENS Paris (École Normale Supérieure)', country: 'FR' },
    'sciencespo.fr': { name: 'Sciences Po Paris', country: 'FR' },

    // ---- Hollanda & Belçika (.nl, .be) ----
    'tudelft.nl': { name: 'Delft University of Technology (TU Delft)', country: 'NL' },
    'uva.nl': { name: 'University of Amsterdam', country: 'NL' },
    'uu.nl': { name: 'Utrecht University', country: 'NL' },
    'tue.nl': { name: 'Eindhoven University of Technology', country: 'NL' },
    'leidenuniv.nl': { name: 'Leiden University', country: 'NL' },
    'kuleuven.be': { name: 'KU Leuven', country: 'BE' },

    // ---- İskandinavya (.se, .fi, .no, .dk) ----
    'kth.se': { name: 'KTH Royal Institute of Technology', country: 'SE' },
    'lu.se': { name: 'Lund University', country: 'SE' },
    'uu.se': { name: 'Uppsala University', country: 'SE' },
    'ki.se': { name: 'Karolinska Institutet', country: 'SE' },
    'helsinki.fi': { name: 'University of Helsinki', country: 'FI' },
    'aalto.fi': { name: 'Aalto University', country: 'FI' },
    'uio.no': { name: 'University of Oslo', country: 'NO' },
    'ku.dk': { name: 'University of Copenhagen', country: 'DK' },

    // ---- Avustralya & Yeni Zelanda (.edu.au, .ac.nz) ----
    'unimelb.edu.au': { name: 'University of Melbourne', country: 'AU' },
    'sydney.edu.au': { name: 'University of Sydney', country: 'AU' },
    'unsw.edu.au': { name: 'UNSW Sydney', country: 'AU' },
    'anu.edu.au': { name: 'Australian National University (ANU)', country: 'AU' },
    'uq.edu.au': { name: 'University of Queensland', country: 'AU' },
    'monash.edu.au': { name: 'Monash University', country: 'AU' },
    'uwa.edu.au': { name: 'University of Western Australia', country: 'AU' },
    'adelaide.edu.au': { name: 'University of Adelaide', country: 'AU' },
    'uts.edu.au': { name: 'University of Technology Sydney (UTS)', country: 'AU' },
    'auckland.ac.nz': { name: 'University of Auckland', country: 'NZ' },
    'otago.ac.nz': { name: 'University of Otago', country: 'NZ' },

    // ---- Asya (.jp, .cn, .sg, .kr, .in, .hk) ----
    'u-tokyo.ac.jp': { name: 'University of Tokyo', country: 'JP' },
    'kyoto-u.ac.jp': { name: 'Kyoto University', country: 'JP' },
    'osaka-u.ac.jp': { name: 'Osaka University', country: 'JP' },
    'titech.ac.jp': { name: 'Tokyo Institute of Technology', country: 'JP' },
    'waseda.jp': { name: 'Waseda University', country: 'JP' },
    'tsinghua.edu.cn': { name: 'Tsinghua University', country: 'CN' },
    'pku.edu.cn': { name: 'Peking University', country: 'CN' },
    'fudan.edu.cn': { name: 'Fudan University', country: 'CN' },
    'sjtu.edu.cn': { name: 'Shanghai Jiao Tong University', country: 'CN' },
    'zju.edu.cn': { name: 'Zhejiang University', country: 'CN' },
    'nus.edu.sg': { name: 'National University of Singapore (NUS)', country: 'SG' },
    'ntu.edu.sg': { name: 'Nanyang Technological University (NTU)', country: 'SG' },
    'smu.edu.sg': { name: 'Singapore Management University (SMU)', country: 'SG' },
    'snu.ac.kr': { name: 'Seoul National University', country: 'KR' },
    'kaist.ac.kr': { name: 'KAIST', country: 'KR' },
    'yonsei.ac.kr': { name: 'Yonsei University', country: 'KR' },
    'korea.ac.kr': { name: 'Korea University', country: 'KR' },
    'iitb.ac.in': { name: 'IIT Bombay', country: 'IN' },
    'iitd.ac.in': { name: 'IIT Delhi', country: 'IN' },
    'iitm.ac.in': { name: 'IIT Madras', country: 'IN' },
    'iisc.ac.in': { name: 'Indian Institute of Science (IISc)', country: 'IN' },
    'hku.hk': { name: 'University of Hong Kong (HKU)', country: 'HK' },
    'cuhk.edu.hk': { name: 'Chinese University of Hong Kong', country: 'HK' },

    // ---- Latin Amerika & Afrika (.br, .mx, .ar, .za) ----
    'usp.br': { name: 'Universidade de São Paulo (USP)', country: 'BR' },
    'unicamp.br': { name: 'Universidade Estadual de Campinas (Unicamp)', country: 'BR' },
    'unam.mx': { name: 'Universidad Nacional Autónoma de México (UNAM)', country: 'MX' },
    'itesm.mx': { name: 'Tecnológico de Monterrey (ITESM)', country: 'MX' },
    'uba.ar': { name: 'Universidad de Buenos Aires (UBA)', country: 'AR' },
    'uct.ac.za': { name: 'University of Cape Town', country: 'ZA' },
    'wits.ac.za': { name: 'University of the Witwatersrand', country: 'ZA' },
  }

  // 1. Doğrudan veya normalize edilmiş alan adıyla eşleşme kontrolü
  const matched = knownUniversities[baseDomain] || knownUniversities[domain]
  if (matched) {
    return {
      institution: matched.name,
      domain,
      isEdu: true,
      isEduTr: matched.country === 'TR' || isEduTr,
      country: matched.country,
    }
  }

  // 2. Türkiye (.edu.tr) jenerik çözümleyici
  if (baseDomain.endsWith('.edu.tr')) {
    const prefix = baseDomain.replace('.edu.tr', '')
    const formatted = formatTitleCaseWords(prefix) + ' Üniversitesi'
    return {
      institution: formatted,
      domain,
      isEdu: true,
      isEduTr: true,
      country: 'TR',
    }
  }

  // 3. ABD & Küresel (.edu) jenerik çözümleyici
  if (baseDomain.endsWith('.edu')) {
    const prefix = baseDomain.replace('.edu', '')
    const formatted = formatTitleCaseWords(prefix) + ' University'
    return {
      institution: formatted,
      domain,
      isEdu: true,
      isEduTr: true,
      country: 'US',
    }
  }

  // 4. İngiltere (.ac.uk) jenerik çözümleyici
  if (baseDomain.endsWith('.ac.uk')) {
    const prefix = baseDomain.replace('.ac.uk', '')
    const formatted = formatTitleCaseWords(prefix) + ' University'
    return {
      institution: `${formatted} (UK)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'GB',
    }
  }

  // 5. Avustralya (.edu.au)
  if (baseDomain.endsWith('.edu.au')) {
    const prefix = baseDomain.replace('.edu.au', '')
    return {
      institution: `${formatTitleCaseWords(prefix)} University (Australia)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'AU',
    }
  }

  // 6. Çin (.edu.cn)
  if (baseDomain.endsWith('.edu.cn')) {
    const prefix = baseDomain.replace('.edu.cn', '')
    return {
      institution: `${formatTitleCaseWords(prefix)} University (China)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'CN',
    }
  }

  // 7. Japonya (.ac.jp)
  if (baseDomain.endsWith('.ac.jp')) {
    const prefix = baseDomain.replace('.ac.jp', '')
    return {
      institution: `${formatTitleCaseWords(prefix)} University (Japan)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'JP',
    }
  }

  // 8. Singapur (.edu.sg)
  if (baseDomain.endsWith('.edu.sg')) {
    const prefix = baseDomain.replace('.edu.sg', '')
    return {
      institution: `${formatTitleCaseWords(prefix)} University (Singapore)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'SG',
    }
  }

  // 9. Güney Kore (.ac.kr / .edu.kr)
  if (baseDomain.endsWith('.ac.kr') || baseDomain.endsWith('.edu.kr')) {
    const prefix = baseDomain.replace(/\.(ac|edu)\.kr$/, '')
    return {
      institution: `${formatTitleCaseWords(prefix)} University (Korea)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'KR',
    }
  }

  // 10. Hindistan (.ac.in / .edu.in)
  if (baseDomain.endsWith('.ac.in') || baseDomain.endsWith('.edu.in')) {
    const prefix = baseDomain.replace(/\.(ac|edu)\.in$/, '')
    return {
      institution: `${formatTitleCaseWords(prefix)} University (India)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'IN',
    }
  }

  // 11. Brezilya (.edu.br)
  if (baseDomain.endsWith('.edu.br')) {
    const prefix = baseDomain.replace('.edu.br', '')
    return {
      institution: `${formatTitleCaseWords(prefix)} Universidade (Brasil)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'BR',
    }
  }

  // 12. Kanada (.edu.ca)
  if (baseDomain.endsWith('.edu.ca')) {
    const prefix = baseDomain.replace('.edu.ca', '')
    return {
      institution: `${formatTitleCaseWords(prefix)} University (Canada)`,
      domain,
      isEdu: true,
      isEduTr: false,
      country: 'CA',
    }
  }

  // 13. Avrupa genelinde uni-* kalıbı (örn: uni-bonn.de, univ-paris.fr)
  if (/^(uni|univ)[-_.]/i.test(baseDomain)) {
    const clean = baseDomain.replace(/\.[a-z]{2,}$/i, '')
    return {
      institution: `${formatTitleCaseWords(clean)} University`,
      domain,
      isEdu: true,
      isEduTr: false,
    }
  }

  // 14. Genel uluslararası akademi uzantıları (.ac.* / .edu.*)
  if (/\.(edu|ac)\.[a-z]{2}$/i.test(baseDomain)) {
    const clean = baseDomain.replace(/\.(edu|ac)\.[a-z]{2}$/i, '')
    return {
      institution: `${formatTitleCaseWords(clean)} University`,
      domain,
      isEdu: true,
      isEduTr: false,
    }
  }

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return {
      institution: 'Google Bireysel Hesabı',
      domain,
      isEdu: false,
      isEduTr: false,
    }
  }

  return {
    institution: domain ? `${domain} Kurumsal Hesabı` : 'Google Hesabı',
    domain,
    isEdu: false,
    isEduTr: false,
  }
}

/**
 * Google Cloud OAuth Desktop Client ID'sinin formatini dogrular.
 * Yer tutucu (placeholder) degerleri ve gecersiz kaliplari eler.
 */
export function isValidGoogleClientId(clientId?: string | null): boolean {
  if (!clientId) return false
  const trimmed = clientId.trim()
  if (trimmed.length < 20) return false
  if (trimmed.includes('justmyclassdesktopapp')) return false
  return /^\d{6,}-[a-zA-Z0-9_\-\.]{4,}\.apps\.googleusercontent\.com$/.test(trimmed)
}

function tryReadEnvValue(key: string): string | undefined {
  if (process.env[key] && process.env[key]!.trim().length > 0) {
    return process.env[key]!.trim()
  }
  const candidateFiles = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
  ]
  for (const f of candidateFiles) {
    if (fs.existsSync(f)) {
      try {
        const text = fs.readFileSync(f, 'utf8')
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const regex = new RegExp(`^${key}\\s*=\\s*(["']?)(.*?)\\1$`)
          const match = trimmed.match(regex)
          if (match && match[2]?.trim()) {
            return match[2].trim()
          }
        }
      } catch {
        /* yoksay */
      }
    }
  }
  return undefined
}

/**
 * Derleme aninda gomulen resmi masaustu istemcisi (RFC 8252).
 *
 * Kaynak kodda istemci kimligi veya secret BULUNMAZ. Deger
 * `electron/config/oauth.ts` tarafindan `.env` / ortam degiskeninden
 * okunup ikilinin icine gomulur. Boylece ogrenciler Google Cloud
 * Console ile ugrasmadan tek tikla giris yapabilir; degistirmek icin
 * kodu degil yalnizca derleme ortamini degistirmek yeterlidir.
 *
 * Bu akis bir "public istemci"dir (PKCE + loopback redirect), dolayisiyla
 * client_secret GONDERILMEZ. Bir Desktop istemcisinin secret'i her
 * pakette zaten cikarilabilir oldugu icin gomulmesi guvenlik degeri
 * saglamaz, yalnizca projeye kotu niyetli erisim riski yaratir.
 */
export function getBundledClientId(): string {
  return getInjectedGoogleClientId()
}

export function getBundledClientSecret(): string {
  return getInjectedGoogleClientSecret()
}

/** Istemci kimliginin nereden geldiğini belirler (tanilama ekrani icin). */
export function getBundledClientIdSource(): 'build' | 'env' | 'local' | 'none' {
  return describeClientIdSource()
}

export class AuthService {
  private vaultService: VaultService
  private storageService: StorageService
  private currentOAuthServer: http.Server | null = null
  private authTimeout: NodeJS.Timeout | null = null
  /**
   * Zaman asimi sonrasi sunucunun kapanacagi ek sayac.
   *
   * `closeActiveServer()` bunu da temizler. Temizlenmezse, 5 dakika
   * sonra tetiklenen eski geri cagirma yeni bir giris denemesinin
   * sunucusunu kapatir ve kullanici yine ERR_CONNECTION_REFUSED alir.
   */
  private authGraceTimer: NodeJS.Timeout | null = null
  private pendingAuthReject: ((err: Error) => void) | null = null

  /** Devam eden bir yetkilendirme var mi? (cift tiklamayi onlemek icin) */
  private isAuthInFlight(): boolean {
    return this.currentOAuthServer !== null
  }

  /**
   * Her girişte istenen temel kapsamlar.
   *
   * DENETIM (Google Classroom REST referansı ile tek tek karşılaştırıldı)
   * --------------------------------------------------------------------
   * Her kapsamın bir "neden" satırı vardır. Google'ın uç başına
   * gerektirdiği kapsam listesi referans sayfalarından alınmıştır;
   * tahmin yoktur. Yazılımdaki her `GET/PATCH/POST` ucu buradaki
   * bir satırla eşleşir.
   *
   * DÜZELTİLEN EKSİK KAPSAMLAR
   * --------------------------
   * `classroom.topics.readonly` ve `classroom.courseworkmaterials.readonly`
   * kodda çağrılıyordu ama İSTENMİYORDU. İkisi de `classroom.courses.readonly`
   * ile kapsanmaz — Classroom API her kaynak için ayrı kapsam ister ve
   * kapsamlar birbirinin yerine geçmez. Sonuç: konu listesi ve ders
   * materyalleri 403 alıyor, o bölümler sessizce boş kalıyordu.
   *
   * İkisi de salt-okunur, hassas olmayan, Google incelemesinde
   * "hassas" sayılmayan kapsamlardır: eklemenin inceleme maliyeti
   * düşüktür ve eksik olmalarının maliyeti yüksektir.
   */
  public static readonly BASE_SCOPES = [
    // Kimlik. `openid` olmadan `oauth2/v3/userinfo` çağrısında `email`
    // alanı boş dönebilir ve üniversite/şube çözümlemesi bozulur.
    'openid',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',

    // Dersler + devam edilen ders listesi (courseWorkStates).
    // -> GET /v1/courses
    'https://www.googleapis.com/auth/classroom.courses.readonly',

    // Duyurular.
    // -> GET /v1/courses/{courseId}/announcements
    'https://www.googleapis.com/auth/classroom.announcements.readonly',

    // Kendi odevlerim: teslim, geri alma, rubrik, ödev listesi,
    // ödev materyalleri, kendi teslimimi okuma ve değiştirme.
    // -> GET  /v1/courses/{courseId}/courseWork
    // -> GET  /v1/courses/{courseId}/courseWork/{id}/rubrics
    // -> GET  .../studentSubmissions?userId=me
    // -> PATCH .../studentSubmissions/{id}
    // -> POST .../studentSubmissions:turnIn
    // -> POST .../studentSubmissions:reclaim
    'https://www.googleapis.com/auth/classroom.coursework.me',

    // Kendi teslimlerim (ayrı tutulur çünkü coursework.me zaten kapsar;
    // ancak açıklık için ayrı istenmesi Google'ın önerisidir ve
    // gelecekte coursework.me daraltılırsa bağımsız kalır).
    'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',

    // Ders materyalleri. courses.readonly BUNU KAPSAMAZ.
    // -> GET /v1/courses/{courseId}/courseWorkMaterials
    'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',

    // Konular. courses.readonly BUNU DA KAPSAMAZ.
    // -> GET /v1/courses/{courseId}/topics
    'https://www.googleapis.com/auth/classroom.topics.readonly',

    // Öğrenci ve öğretmen listeleri (ödev atama listesi için).
    // -> GET /v1/courses/{courseId}/students
    // -> GET /v1/courses/{courseId}/teachers
    'https://www.googleapis.com/auth/classroom.rosters.readonly',

    // Ders dosyalarını okuma + yalnızca bu uygulamanın oluşturduğu
    // dosyalara yazma (teslim eki yükleme).
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ]

  /**
   * Ek kapsamlar (ogretmen gorunumu icin).
   *
   * Bilerek "restricted" turunden `classroom.coursework.students`
   * KULLANILMAZ: bu kapsam Google OAuth dogrulamasinda ek video ve
   * guvenlik degerlendirmesi gerektirir. Salt-okunur varyantlar ayni
   * islevi gorur ve yalnizca "sensitive" sinifinda yer alir.
   */
  public static readonly ELEVATED_SCOPES = [
    'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
    'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  ]

  public static readonly REQUIRED_SCOPES = [...AuthService.BASE_SCOPES]

  constructor(vaultService: VaultService, storageService: StorageService) {
    this.vaultService = vaultService
    this.storageService = storageService
  }

  // ---- PKCE (RFC 8252) --------------------------------------------------
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url')
  }

  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url')
  }

  /**
   * Yerel ortamda veya masaüstünde bulunan `client_secret_*.json`
   * dosyasını tespit edip istemci kimliğini ve gizli anahtarını şifreli kasaya aktarır.
   *
   * Kaynak kod içinde HİÇBİR şahsi gizli anahtar düz metin olarak yer almaz.
   */
  public tryAutoDetectDesktopCredentials(): boolean {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return false
    }
    const existingId = this.getClientId()
    const hasSecret = Boolean(this.getClientSecret() || getBundledClientSecret())
    if (existingId && hasSecret) {
      return true
    }
    const searchDirs: string[] = []
    try {
      const desktop = app?.getPath('desktop')
      if (desktop && fs.existsSync(desktop)) searchDirs.push(desktop)
    } catch {
      /* yut */
    }
    const home = process.env.USERPROFILE || process.env.HOME
    if (home) {
      const homeDesktop = path.join(home, 'Desktop')
      if (fs.existsSync(homeDesktop) && !searchDirs.includes(homeDesktop)) {
        searchDirs.push(homeDesktop)
      }
    }
    searchDirs.push(process.cwd())

    for (const dir of searchDirs) {
      try {
        const files = fs.readdirSync(dir)
        for (const file of files) {
          if (file.startsWith('client_secret_') && file.endsWith('.json')) {
            const fullPath = path.join(dir, file)
            const text = fs.readFileSync(fullPath, 'utf8')
            const res = this.importGoogleCredentialsJson(text)
            if (res.success) {
              console.log('[AuthService] Yerel Google kimlik dosyası güvenli kasaya aktarıldı:', file)
              return true
            }
          }
        }
      } catch {
        /* yut */
      }
    }
    return false
  }

  /**
   * Google OAuth istemci kimliğini saklar.
   */
  public setClientId(clientId: string): void {
    this.storageService.setSetting('google.clientId', clientId.trim())
  }

  public getClientId(): string | null {
    const stored = this.storageService.getSetting<string | null>('google.clientId', null)
    return typeof stored === 'string' && stored.trim().length > 0 ? stored.trim() : null
  }

  /**
   * Google OAuth İstemci Gizli Anahtarını (Client Secret) şifreli kasaya (`vaultService`) kaydeder.
   */
  public setClientSecret(clientSecret: string): void {
    const trimmed = clientSecret.trim()
    if (trimmed.length > 0) {
      this.vaultService.setKey('google_client_secret', trimmed)
    } else {
      this.vaultService.deleteKey('google_client_secret')
    }
  }

  public getClientSecret(): string | null {
    const stored = this.vaultService.getKey('google_client_secret')
    return typeof stored === 'string' && stored.trim().length > 0 ? stored.trim() : null
  }

  /**
   * Kullanıcının girdiği özel istemci kimliğini ve gizli anahtarını temizleyerek
   * derlemeye/ortama (.env) gömülü varsayılan kimliğe geri döner.
   */
  public resetCustomClient(): void {
    this.storageService.setSetting('google.clientId', '')
    this.vaultService.deleteKey('google_client_secret')
  }

  /**
   * Etkin istemci kimliginin cozumlenme sirasi:
   *
   *   1) Kullanicinin kasasina girdigi kendi istemcisi (ileri kullanicilar)
   *   2) Derleme aninda (.env'den) gomulen kimlik (normal kullanicinin yolu)
   *   3) Bu makinede otomatik bulunan `client_secret_*.json` dosyasi
   */
  public getActiveClientId(): string {
    const custom = this.getClientId()
    if (custom && custom.trim().length > 0) return custom.trim()

    const bundled = getBundledClientId()
    if (bundled && bundled.trim().length > 0) return bundled.trim()

    this.tryAutoDetectDesktopCredentials()
    const detected = this.getClientId()
    if (detected && detected.trim().length > 0) return detected.trim()

    return getBundledClientId()
  }

  /**
   * Etkin OAuth istemci gizli anahtarını (client_secret) çözümler.
   * Google Cloud "Desktop app" (installed) OAuth 2.0 istemcileri token
   * takasında (`https://oauth2.googleapis.com/token`) PKCE ile birlikte
   * `client_secret` parametresini de zorunlu tutar.
   */
  public getActiveClientSecret(): string {
    const customSecret = this.getClientSecret()
    if (customSecret) return customSecret

    if (!this.isUsingCustomClientId()) {
      const bundledSecret = getBundledClientSecret()
      if (bundledSecret) return bundledSecret
    }

    this.tryAutoDetectDesktopCredentials()
    const detectedSecret = this.getClientSecret()
    if (detectedSecret) return detectedSecret

    return this.isUsingCustomClientId() ? '' : getBundledClientSecret()
  }

  public hasClientSecret(): boolean {
    return this.getActiveClientSecret().trim().length > 0
  }

  /**
   * Etkin istemci kimliginin kaynagini dondurur. Tanilama ekraninda
   * "bu kimlik nereden geliyor?" sorusunu cevaplamak icin kullanilir.
   */
  public getClientIdOrigin(): 'custom' | 'build' | 'none' {
    const custom = this.getClientId()
    const bundled = getBundledClientId()
    if (custom && custom.trim().length > 0 && custom.trim() !== bundled) return 'custom'
    if (describeClientIdSource() !== 'none') return 'build'
    if (custom && custom.trim().length > 0) return 'custom'
    return 'none'
  }

  public isUsingCustomClientId(): boolean {
    const custom = this.getClientId()
    const bundled = getBundledClientId()
    return !!(custom && custom.trim().length > 0 && custom.trim() !== bundled)
  }

  /**
   * Istemci kimligi dogrulaması ve tanilama.
   */
  public validateClientId(clientId?: string): {
    valid: boolean
    activeClientId: string
    isCustom: boolean
    isPlaceholder: boolean
    origin: 'custom' | 'build' | 'none'
    hasClientSecret: boolean
    error?: string
  } {
    const target = clientId !== undefined ? clientId.trim() : this.getActiveClientId()
    const isCustom = this.isUsingCustomClientId()
    const valid = isValidGoogleClientId(target)
    const bundled = getBundledClientId()
    const hasSecret = this.hasClientSecret()

    const origin: 'custom' | 'build' | 'none' =
      target && target === bundled ? (describeClientIdSource() !== 'none' ? 'build' : 'custom') : target ? 'custom' : 'none'

    let error: string | undefined
    if (!target) {
      error =
        'Bu uygulama derlenirken Google istemci kimliği gömülmemiş. ' +
        'Geliştirici olarak `.env` dosyasında `JMC_GOOGLE_CLIENT_ID` ve `JMC_GOOGLE_CLIENT_SECRET` değişkenlerini tanımlayıp yeniden derleyin.'
    } else if (!valid) {
      error =
        'Geçersiz istemci kimliği biçimi. Beklenen: <sayılar>-<karakterler>.apps.googleusercontent.com'
    }

    return {
      valid,
      activeClientId: target,
      isCustom,
      isPlaceholder: false,
      origin,
      hasClientSecret: hasSecret,
      error,
    }
  }

  // ---- Token yasam dongusu ---------------------------------------------

  /**
   * OAuth token uc noktasina POST yapar.
   *
   * Google Masaüstü (Desktop / installed) OAuth istemcileri token takası
   * (`authorization_code`) ve yenileme (`refresh_token`) sırasında
   * `client_secret` parametresini zorunlu tutar. Etkin `client_secret`
   * varsa isteğe otomatik eklenir.
   */
  private async postToken(body: URLSearchParams): Promise<any> {
    if (!body.get('client_secret')) {
      const secret = this.getActiveClientSecret()
      if (secret) {
        body.set('client_secret', secret)
      } else {
        body.delete('client_secret')
      }
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(20_000),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(this.explainTokenError(json, res.status))
    }
    return json
  }

  /**
   * Google token uc noktasindan gelen ham hatayi, kullaniciya ne
   * yapmasi gerektigini soyleyen Turkce bir mesaja cevirir.
   */
  private explainTokenError(json: any, status: number): string {
    const code: string = typeof json?.error === 'string' ? json.error : ''
    const description: string =
      typeof json?.error_description === 'string' ? json.error_description : ''

    const isSecretMissing = /client_secret\s+is\s+missing/i.test(description)
    if (isSecretMissing) {
      return (
        'Google OAuth İstemci Gizli Anahtarı (client_secret) eksik.\n\n' +
        'Google Cloud OAuth istemciniz token takası için `client_secret` bekliyor. Çözüm:\n' +
        '  • Geliştirici ortamındaysanız `.env` dosyasında `JMC_GOOGLE_CLIENT_SECRET` değerinin tanımlı olduğundan emin olun.\n' +
        '  • Özel istemci kullanıyorsanız Google Cloud Console\'dan indirdiğiniz `client_secret_*.json` dosyasını içe aktarın veya İstemci Gizli Anahtarını (Client Secret) girin.'
      )
    }

    switch (code) {
      case 'invalid_client':
      case 'unauthorized_client': {
        return (
          'Google istemci kimliği veya gizli anahtarı kabul edilmedi (invalid_client).\n\n' +
          'Kontrol edilecekler:\n' +
          '  • `.env` dosyasındaki `JMC_GOOGLE_CLIENT_ID` ve `JMC_GOOGLE_CLIENT_SECRET` değerlerinin birbiriyle eşleştiğinden emin olun.\n' +
          '  • Özel istemci kullanıyorsanız `client_secret_*.json` dosyasını yeniden içe aktarın veya varsayılan istemciye sıfırlayın.'
        )
      }

      case 'invalid_grant':
        return (
          'Google oturumunun süresi doldu veya onay iptal edildi.\n\n' +
          'Lütfen oturumu kapatıp yeniden giriş yapın.'
        )

      case 'redirect_uri_mismatch':
        return (
          'Geri dönüş adresi eşleşmedi.\n\n' +
          'Masaüstü istemcilerinde `http://127.0.0.1:<port>/oauth/callback` kullanılır; ' +
          'Google Cloud istemci ayarlarında loopback adres tanımlı olmalıdır.'
        )

      case 'invalid_scope':
        return (
          'İstenen izinler bu istemci için onaylanmamış.\n\n' +
          'Google Cloud projesinde Google Classroom API etkin ve istenen kapsamlar ' +
          'OAuth onay ekranında tanımlı olmalıdır.'
        )

      case 'access_denied':
        return (
          'Erişim reddedildi.\n\n' +
          'Uygulamanın "Testte" yayın durumundaysa, hesabınızın test kullanıcısı olarak ' +
          'eklenmiş olması gerekir. "Yayında" ise onay ekranı doğrulanmış olmalıdır.'
        )

      case 'slow_down':
      case 'ratelimit':
        return 'Çok fazla deneme yapıldı. Lütfen birkaç dakika bekleyip tekrar deneyin.'

      case 'temporarily_unavailable':
        return 'Google hizmetleri geçici olarak erişilemiyor. Lütfen birazdan tekrar deneyin.'

      default:
        break
    }

    if (status === 401) {
      return 'Google istemci kimliği kabul edilmedi (401). Kimlik bilgileri ekranından istemci durumunu kontrol edin.'
    }
    if (status === 403) {
      return 'Google bu işleme izin vermedi (403). Projenizde ilgili API etkin mi kontrol edin.'
    }
    if (status === 429) {
      return 'Çok fazla istek gönderildi (429). Lütfen kısa süre sonra tekrar deneyin.'
    }
    return description || code || `Google isteği başarısız oldu (HTTP ${status}).`
  }

  public async refreshAccessToken(): Promise<string | null> {
    const refreshToken = this.vaultService.getKey('google_refresh_token')
    if (!refreshToken) return null

    try {
      const data = await this.postToken(
        new URLSearchParams({
          client_id: this.getActiveClientId(),
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      )
      if (data.access_token) {
        this.vaultService.setKey('google_access_token', data.access_token)
        return data.access_token as string
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('invalid_grant')) {
        this.vaultService.deleteKey('google_refresh_token')
        this.vaultService.deleteKey('google_access_token')
        this.storageService.setAccount(null)
        return null
      }
      console.error('[AuthService] Token yenilenemedi:', message)
    }
    return null
  }

  // ---- Giris ve Iptal Islemleri -----------------------------------------
  public cancelLogin(): boolean {
    if (this.currentOAuthServer || this.authTimeout || this.pendingAuthReject) {
      if (this.pendingAuthReject) {
        this.pendingAuthReject(new Error('Giriş işlemi iptal edildi.'))
        this.pendingAuthReject = null
      }
      this.closeActiveServer()
      return true
    }
    return false
  }

  public async loginWithGoogle(extraScopes: string[] = []): Promise<Account> {
    const existing = this.storageService.getAccount()
    if (existing && this.vaultService.getKey('google_access_token')) {
      return existing
    }

    const activeClientId = this.getActiveClientId()
    if (!isValidGoogleClientId(activeClientId)) {
      const origin = this.getClientIdOrigin()
      throw new Error(
        origin === 'none'
          ? 'MISSING_OR_INVALID_CLIENT_ID: Bu uygulama derlenirken Google istemci kimliği gömülmemiş. ' +
              'Geliştirici olarak `JMC_GOOGLE_CLIENT_ID` ortam değişkenini tanımlayıp yeniden derleyin.'
          : 'MISSING_OR_INVALID_CLIENT_ID: Kayıtlı Google istemci kimliğinin biçimi geçersiz. ' +
              'Beklenen biçim: <sayılar>-<karakterler>.apps.googleusercontent.com',
      )
    }

    const granted = [
      ...AuthService.BASE_SCOPES,
      // Yalnizca beyaz listedeki ek kapsamlar eklenir; renderer'in
      // gonderdigi herhangi bir kapsam dogrudan kabul edilmez.
      ...extraScopes.filter(s => AuthService.ELEVATED_SCOPES.includes(s)),
    ]

    // AKTIF BIR DENEME VARSA YENISINI BASLATMA.
    //
    // Onceki surum burada `closeActiveServer()` ile var olan sunucuyu
    // KAPATIYORDU. Kullanici dugmeye iki kez bastiginda (kaynakli iki
    // tik, ya da React StrictMode'un iki kez cagirilmasi) birinci
    // tarayici sekmesinin portu dinlenmez oluyor ve kullanici "Izin
    // ver" dediginde ERR_CONNECTION_REFUSED aliyordu.
    //
    // Simdi ikinci cagri sessizce ilk denemeyi YOK EDMEZ; kullaniciya
    // acik bir mesajla reddedilir ve ilk sekme calismaya devam eder.
    if (this.isAuthInFlight()) {
      throw new Error(
        'Google girişi zaten başlatıldı.\n\n' +
          'Tarayıcıda açılan Google sekmesine geçip orada "İzin ver" düğmesine basın. ' +
          'Bu pencereyi kapatmak istiyorsanız "İptal" düğmesini kullanın.',
      )
    }

    return new Promise<Account>((resolve, reject) => {
      this.pendingAuthReject = reject
      const codeVerifier = this.generateCodeVerifier()
      this.vaultService.setKey('oauth_code_verifier', codeVerifier)
      const codeChallenge = this.generateCodeChallenge(codeVerifier)
      const state = crypto.randomBytes(24).toString('hex')

      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        this.pendingAuthReject = null
        this.closeActiveServer()
        fn()
      }

      const server = http.createServer((req, res) => {
        const host = (req.headers.host || '').split(':')[0]
        if (host !== '127.0.0.1' && host !== 'localhost') {
          res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Geçersiz Host')
          return
        }
        if (!req.url?.startsWith('/oauth/callback')) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('Not found')
          return
        }

function escapeHtml(str: string): string {
  return str.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] || c))
}

function buildAuthSuccessHtml(account: Account): string {
  const safeName = escapeHtml(account.displayName || 'Google Kullanıcısı')
  const safeEmail = escapeHtml(account.email || '')
  const safeInst = account.institution ? escapeHtml(account.institution) : ''

  const institutionHtml = safeInst
    ? `<div class="institution-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
        <span>${safeInst}</span>
      </div>`
    : ''

  const avatarHtml = account.photoUrl
    ? `<img src="${escapeHtml(account.photoUrl)}" class="avatar" alt="" referrerpolicy="no-referrer" />`
    : `<div class="avatar">${safeName.charAt(0).toUpperCase()}</div>`

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bağlantı Kuruldu - JustMyClass</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #080B11;
      color: #E6EDF7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      position: relative;
      overflow: hidden;
    }
    .ambient {
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, rgba(99, 102, 241, 0.08) 50%, transparent 70%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 0;
    }
    .card {
      position: relative;
      z-index: 1;
      max-width: 460px;
      width: 100%;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-radius: 24px;
      padding: 40px 32px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05);
      animation: enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes enter {
      from { opacity: 0; transform: translateY(16px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .icon-wrapper {
      position: relative;
      width: 72px;
      height: 72px;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-bg {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      animation: pulse 2.4s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.08); opacity: 0.4; }
    }
    .check-svg {
      position: relative;
      z-index: 2;
      width: 40px;
      height: 40px;
    }
    .check-circle {
      stroke-dasharray: 130;
      stroke-dashoffset: 130;
      animation: drawCircle 0.7s cubic-bezier(0.65, 0, 0.45, 1) forwards;
    }
    .check-mark {
      stroke-dasharray: 40;
      stroke-dashoffset: 40;
      animation: drawCheck 0.4s 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
    }
    @keyframes drawCircle { to { stroke-dashoffset: 0; } }
    @keyframes drawCheck { to { stroke-dashoffset: 0; } }
    h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #F8FAFC;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 13.5px;
      color: #94A3B8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .profile-pill {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 12px 16px;
      margin-bottom: 20px;
      text-align: left;
    }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      background: #0284C7;
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 600;
      font-size: 14px;
      flex-shrink: 0;
    }
    .profile-info { min-width: 0; flex: 1; }
    .profile-name {
      font-size: 13.5px;
      font-weight: 600;
      color: #F1F5F9;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .profile-email {
      font-size: 12px;
      color: #64748B;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .institution-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(14, 165, 233, 0.12);
      border: 1px solid rgba(14, 165, 233, 0.25);
      color: #38BDF8;
      font-size: 11.5px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 20px;
      margin-bottom: 24px;
    }
    .status-notice {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.22);
      border-radius: 14px;
      padding: 14px 16px;
      margin-bottom: 22px;
      text-align: left;
    }
    .status-notice svg {
      flex-shrink: 0;
      color: #10B981;
    }
    .status-notice p {
      font-size: 13px;
      line-height: 1.5;
      color: #E2E8F0;
      margin: 0;
    }
    .status-notice strong {
      color: #38BDF8;
      font-weight: 600;
    }
    .footer-hint {
      font-size: 12px;
      color: #64748B;
      margin-bottom: 18px;
      line-height: 1.4;
    }
    .actions {
      display: flex;
      justify-content: center;
      gap: 10px;
    }
    .btn {
      padding: 11px 24px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: none;
    }
    .btn-primary {
      background: linear-gradient(135deg, #0284C7, #0369A1);
      color: #ffffff;
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.3);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #0369A1, #075985);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(2, 132, 199, 0.4);
    }
  </style>
</head>
<body>
  <div class="ambient"></div>
  <div class="card">
    <div class="icon-wrapper">
      <div class="icon-bg"></div>
      <svg class="check-svg" viewBox="0 0 52 52" fill="none">
        <circle class="check-circle" cx="26" cy="26" r="23" stroke="#10B981" stroke-width="3" stroke-linecap="round"/>
        <path class="check-mark" d="M16 26l7 7 13-13" stroke="#10B981" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <h1>Bağlantı Başarıyla Kuruldu</h1>
    <p class="subtitle">Google Classroom hesabınız doğrulandı ve JustMyClass çalışma alanınıza bağlandı.</p>

    ${institutionHtml}

    <div class="profile-pill">
      ${avatarHtml}
      <div class="profile-info">
        <div class="profile-name">${safeName}</div>
        <div class="profile-email">${safeEmail}</div>
      </div>
    </div>

    <div class="status-notice">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <p>Bu tarayıcı sekmesini kapatıp doğrudan <strong>JustMyClass</strong> masaüstü uygulamanıza dönebilirsiniz.</p>
    </div>

    <p class="footer-hint">Uygulama penceremiz otomatik olarak öne gelecektir.</p>

    <div class="actions">
      <a href="justmyclass://auth-success" class="btn btn-primary">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        <span>JustMyClass'e Dön</span>
      </a>
    </div>
  </div>
</body>
</html>`
}

function buildAuthErrorHtml(title: string, message: string): string {
  const safeTitle = escapeHtml(title)
  const safeMsg = escapeHtml(message)

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} - JustMyClass</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #080B11;
      color: #E6EDF7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 460px;
      width: 100%;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(239, 68, 68, 0.2);
      backdrop-filter: blur(24px);
      border-radius: 24px;
      padding: 40px 32px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      border-radius: 50%;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      display: grid;
      place-items: center;
      color: #F87171;
    }
    h1 { font-size: 20px; font-weight: 700; color: #F8FAFC; margin-bottom: 10px; }
    p { font-size: 13px; color: #94A3B8; line-height: 1.5; margin-bottom: 20px; }
    .msg-box {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px;
      font-family: monospace;
      font-size: 11.5px;
      color: #FCA5A5;
      word-break: break-all;
      margin-bottom: 24px;
      text-align: left;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 12px;
      border-radius: 12px;
      background: #EF4444;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      border: none;
      cursor: pointer;
    }
    .btn:hover { background: #DC2626; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    </div>
    <h1>${safeTitle}</h1>
    <p>Oturum açma isteği tamamlanamadı. Lütfen uygulamaya dönüp tekrar deneyin.</p>
    <div class="msg-box">${safeMsg}</div>
    <button type="button" class="btn" onclick="window.close()">Sekmeyi Kapat</button>
  </div>
</body>
</html>`
}

        void (async () => {
          try {
            const url = new URL(req.url ?? '', `http://127.0.0.1`)
            const code = url.searchParams.get('code')
            const incomingState = url.searchParams.get('state')
            const error = url.searchParams.get('error')

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(buildAuthErrorHtml('Giriş İptal Edildi', error))
              finish(() => reject(new Error(`Google yetkilendirmesi iptal edildi: ${error}`)))
              return
            }

            if (incomingState !== state || !code) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(buildAuthErrorHtml('Güvenlik Doğrulaması Başarısız', 'Güvenlik kodu uyuşmuyor. Lütfen uygulamayı kapatıp yeniden deneyin.'))
              finish(() => reject(new Error('Güvenlik doğrulaması başarısız oldu.')))
              return
            }

            const addr = server.address()
            const port = typeof addr === 'object' && addr ? addr.port : 0

            const tokens = await this.postToken(
              new URLSearchParams({
                client_id: activeClientId,
                code,
                code_verifier: codeVerifier,
                grant_type: 'authorization_code',
                redirect_uri: `http://127.0.0.1:${port}/oauth/callback`,
              }),
            )

            const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
              signal: AbortSignal.timeout(20_000),
            })
            if (!profileRes.ok) throw new Error('Profil bilgisi alınamadı.')
            const profile = await profileRes.json()

            if (tokens.refresh_token) {
              this.vaultService.setKey('google_refresh_token', tokens.refresh_token)
            }
            this.vaultService.setKey('google_access_token', tokens.access_token)

            const email = String(profile.email || '').trim().toLowerCase()
            const hostedDomain = profile.hd
              ? String(profile.hd).trim().toLowerCase()
              : (email.split('@')[1] || '').toLowerCase()
            const university = resolveUniversityInfo(email, hostedDomain)
            const displayName = profile.name || email.split('@')[0] || 'Google Kullanıcısı'
            const givenName = profile.given_name || displayName.split(' ')[0]
            const familyName = profile.family_name || displayName.split(' ').slice(1).join(' ')

            const account: Account = {
              id: profile.sub,
              googleSub: profile.sub,
              email,
              displayName,
              givenName,
              familyName,
              photoUrl: profile.picture,
              hostedDomain: university.domain,
              institution: university.institution,
              role: 'STUDENT',
              grantedScopes: tokens.scope ? tokens.scope.split(' ') : granted,
              lastAuthAt: new Date().toISOString(),
            }
            this.storageService.setAccount(account)

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(buildAuthSuccessHtml(account))
            finish(() => resolve(account))
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Bilinmeyen hata'
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(buildAuthErrorHtml('Yetkilendirme Hatası', errMsg))
            finish(() => reject(err instanceof Error ? err : new Error(errMsg)))
          }
        })()
      })

      server.requestTimeout = AUTH_TIMEOUT_MS
      server.headersTimeout = AUTH_TIMEOUT_MS
      server.on('error', err => finish(() => reject(err)))

      this.currentOAuthServer = server
      this.authTimeout = setTimeout(() => {
        // Zaman asimi: kullaniciya bildir ama SUNUCUYU KAPATMA.
        //
        // Onceki surumde burada `finish()` cagriliyordu ve o da
        // `closeActiveServer()` ile dinlemeyi sonlandiriyordu. Kullanici
        // onay ekraninda "Izin ver" dediginde ERR_CONNECTION_REFUSED
        // aliyordu.
        //
        // Simdi yalnizca promise reddedilir; sunucu `AUTH_GRACE_MS`
        // boyunca dinlemeye devam eder, boylece gec gelen yonlendirme
        // calisir ve kullanicinin tarayici sekmesindeki ekranda
        // "Basarili" yazar.
        this.vaultService.deleteKey('oauth_code_verifier')
        this.pendingAuthReject = null
        if (this.authTimeout) {
          clearTimeout(this.authTimeout)
          this.authTimeout = null
        }
        graceTimer = setTimeout(() => this.closeActiveServer(), AUTH_GRACE_MS)
        this.authGraceTimer = graceTimer
        reject(
          new Error(
            'Giriş 10 dakika içinde tamamlanmadı.\n\n' +
              'Tarayıcıdaki Google sekmesini kapatıp yeniden deneyebilirsiniz. ' +
              'Yoksa sekmeyi açık bırakın: onay ekranında "İzin ver" dediğinizde ' +
              'giriş yine tamamlanır.',
          ),
        )
      }, AUTH_TIMEOUT_MS)

      let graceTimer: NodeJS.Timeout | null = null

      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', activeClientId)
        authUrl.searchParams.set('redirect_uri', `http://127.0.0.1:${port}/oauth/callback`)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', granted.join(' '))
        authUrl.searchParams.set('code_challenge', codeChallenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')
        authUrl.searchParams.set('state', state)
        authUrl.searchParams.set('access_type', 'offline')
        authUrl.searchParams.set('include_granted_scopes', 'true')
        // `consent` DEĞERİ: onay ekranını her girişte zorla gösterir ve
        // kullanıcıyı her seferinde "İzin ver" ekranıyla uğraştırırdı.
        // `select_account` yalnızca hesap seçimini zorlar; Google daha önce
        // verilmiş onayı sessizce yeniler. Böylece ilk girişten sonra
        // giriş saniyeler sürer.
        authUrl.searchParams.set('prompt', 'select_account')

        void shell.openExternal(authUrl.toString())
      })
    })
  }

  private closeActiveServer(): void {
    if (this.authTimeout) {
      clearTimeout(this.authTimeout)
      this.authTimeout = null
    }
    // GRACE sayaci da temizlenir. Aks halde `AUTH_GRACE_MS` boyunca
    // `closeActiveServer()` yeniden tetiklenir ve yeni bir giris denemesinin
    // sunucusunu kapatir.
    if (this.authGraceTimer) {
      clearTimeout(this.authGraceTimer)
      this.authGraceTimer = null
    }
    if (this.currentOAuthServer) {
      try {
        this.currentOAuthServer.close()
        this.currentOAuthServer.closeAllConnections?.()
      } catch {
        /* yoksay */
      }
      this.currentOAuthServer = null
    }
  }

  public async logout(wipeCache = false): Promise<boolean> {
    this.cancelLogin()
    const refreshToken = this.vaultService.getKey('google_refresh_token')
    if (refreshToken) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refreshToken }),
          signal: AbortSignal.timeout(10_000),
        })
      } catch {
        /* ag hatasi iptali engellememeli */
      }
    }

    this.vaultService.deleteKey('google_refresh_token')
    this.vaultService.deleteKey('google_access_token')
    this.vaultService.deleteKey('oauth_code_verifier')
    this.storageService.setAccount(null)
    // Oturum kapatıldığında o hesaba ait sınıf, ödev ve teslim verileri her zaman sıfırlanır!
    this.storageService.resetClassroomData()

    if (wipeCache) {
      this.vaultService.deleteKey('google_client_secret')
      this.storageService.wipeLocalCache()
    }
    return true
  }

  /**
   * Google Cloud Console'dan indirilen JSON kimlik dosyasını veya metnini ayrıştırıp
   * Masaüstü İstemci Kimliğini (Client ID) ve Gizli Anahtarını (Client Secret) kaydeder.
   */
  public importGoogleCredentialsJson(jsonContent: string): {
    success: boolean
    clientId?: string
    hasClientSecret?: boolean
    error?: string
  } {
    try {
      const parsed = typeof jsonContent === 'string' ? JSON.parse(jsonContent.trim()) : jsonContent
      const creds = parsed.installed || parsed.web || parsed
      const clientId = creds.client_id || creds.clientId
      if (!clientId || typeof clientId !== 'string') {
        return { success: false, error: 'JSON içinde geçerli bir "client_id" bulunamadı.' }
      }
      if (!isValidGoogleClientId(clientId)) {
        return { success: false, error: 'JSON içindeki client_id formatı geçersiz.' }
      }
      this.setClientId(clientId)
      const clientSecret = creds.client_secret || creds.clientSecret
      if (typeof clientSecret === 'string' && clientSecret.trim().length > 0) {
        this.setClientSecret(clientSecret.trim())
      }
      return {
        success: true,
        clientId: clientId.trim(),
        hasClientSecret: this.hasClientSecret(),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'JSON ayrıştırılamadı.' }
    }
  }

  /**
   * Tarayıcıdan kopyalanan yetkilendirme kodunu veya geri dönüş URL'sini
   * alarak OAuth belirteçlerine çevirir (yerel sunucu port engelleri durumunda alternatif).
   */
  public async completeAuthWithCode(rawCodeOrUrl: string, redirectUri?: string, codeVerifier?: string): Promise<Account> {
    let code = rawCodeOrUrl.trim()
    let finalRedirectUri = redirectUri
    if (code.includes('code=')) {
      try {
        const parsedUrl = new URL(code.startsWith('http') ? code : `http://${code}`)
        code = parsedUrl.searchParams.get('code') || code
        if (!finalRedirectUri) {
          finalRedirectUri = `${parsedUrl.origin}${parsedUrl.pathname}`
        }
      } catch {
        // düz metin olarak devam et
      }
    }

    const activeClientId = this.getActiveClientId()
    if (!isValidGoogleClientId(activeClientId)) {
      throw new Error('Google Cloud İstemci Kimliği (Client ID) geçerli değil.')
    }

    const verifier = codeVerifier || this.vaultService.getKey('oauth_code_verifier') || ''
    const params = new URLSearchParams({
      client_id: activeClientId,
      code,
      grant_type: 'authorization_code',
      redirect_uri: finalRedirectUri || 'http://127.0.0.1/oauth/callback',
    })
    if (verifier) {
      params.set('code_verifier', verifier)
    }

    const tokens = await this.postToken(params)
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!profileRes.ok) throw new Error('Profil bilgisi alınamadı.')
    const profile = await profileRes.json()

    if (tokens.refresh_token) {
      this.vaultService.setKey('google_refresh_token', tokens.refresh_token)
    }
    this.vaultService.setKey('google_access_token', tokens.access_token)
    this.vaultService.deleteKey('oauth_code_verifier')

    const email = String(profile.email || '').trim().toLowerCase()
    const hostedDomain = profile.hd
      ? String(profile.hd).trim().toLowerCase()
      : (email.split('@')[1] || '').toLowerCase()
    const university = resolveUniversityInfo(email, hostedDomain)
    const displayName = profile.name || email.split('@')[0] || 'Google Kullanıcısı'
    const givenName = profile.given_name || displayName.split(' ')[0]
    const familyName = profile.family_name || displayName.split(' ').slice(1).join(' ')

    const account: Account = {
      id: profile.sub,
      googleSub: profile.sub,
      email,
      displayName,
      givenName,
      familyName,
      photoUrl: profile.picture,
      hostedDomain: university.domain,
      institution: university.institution,
      role: 'STUDENT',
      grantedScopes: tokens.scope ? tokens.scope.split(' ') : AuthService.REQUIRED_SCOPES,
      lastAuthAt: new Date().toISOString(),
    }
    this.storageService.setAccount(account)
    return account
  }


  /**
   * Giris tanilama bilgisi.
   *
   * Kullanici "neden giremiyorum?" sorusunu arayuzden cevaplayabilsin
   * diye tasarlanmistir. GIZLI DEGER ICERMEZ: istemci kimligi yalnizca
   * kisaltilmis bicimde, token'lar yalnizca varlik bilgisi olarak doner.
   */
  public getDiagnostics(): {
    clientIdValid: boolean
    clientIdOrigin: 'custom' | 'build' | 'none'
    clientIdPreview: string
    usingCustomClientId: boolean
    hasClientSecret: boolean
    signedIn: boolean
    accountEmail: string
    institution: string
    hasAccessToken: boolean
    hasRefreshToken: boolean
    grantedScopes: string[]
    missingScopes: string[]
  } {
    const clientId = this.getActiveClientId()
    const account = this.storageService.getAccount()
    const grantedScopes = account?.grantedScopes ?? []
    const granted = new Set(grantedScopes)

    return {
      clientIdValid: isValidGoogleClientId(clientId),
      clientIdOrigin: this.getClientIdOrigin(),
      // Kimligin tamamini arayuze gondermeyiz; tanilama icin yeterli.
      clientIdPreview: clientId ? `${clientId.slice(0, 22)}…` : '',
      usingCustomClientId: this.isUsingCustomClientId(),
      hasClientSecret: this.hasClientSecret(),
      signedIn: !!(account && this.vaultService.getKey('google_access_token')),
      accountEmail: account?.email ?? '',
      institution: account?.institution ?? '',
      hasAccessToken: !!this.vaultService.getKey('google_access_token'),
      hasRefreshToken: !!this.vaultService.getKey('google_refresh_token'),
      grantedScopes,
      missingScopes: AuthService.REQUIRED_SCOPES.filter(s => !granted.has(s)),
    }
  }

  /**
   * Hesabin Classroom'a erisebilir olup olmadigini kontrol eder.
   *
   * Google Classroom yalnizca Workspace for Education kurumsal
   * hesaplarinda kullanilabilir; bireysel @gmail.com hesaplarinda
   * API her zaman yetkisiz doner. Bunu arayuze onceden bildirmek,
   * kullaniciya "tekrar senkronize et" gibi yanlis bir yol gostermekten
   * cok daha iyidir.
   */
  public getAccountCapability(): {
    canUseClassroom: boolean
    reason: 'workspace' | 'personal-gmail' | 'unknown' | 'signed-out'
    detail: string
  } {
    const account = this.storageService.getAccount()
    if (!account) {
      return {
        canUseClassroom: false,
        reason: 'signed-out',
        detail: 'Henüz bir Google hesabıyla bağlanılmadı.',
      }
    }

    const email = (account.email || '').toLowerCase()
    if (email.endsWith('@gmail.com') || email.endsWith('@googlemail.com')) {
      return {
        canUseClassroom: false,
        reason: 'personal-gmail',
        detail:
          'Google Classroom yalnızca okul/üniversite hesaplarında (Workspace for Education) kullanılabilir. ' +
          'Bireysel @gmail.com hesabıyla ders verisi alınamaz — bu bir uygulama hatası değildir, ' +
          'Google bu hizmeti bireysel hesaplara açmaz.\n\n' +
          'Üniversitenizin öğrenci e-posta adresiyle giriş yapın. ' +
          'Yapay zeka asistanı ve sohbet özellikleri ise her Google hesabıyla kullanılabilir.',
      }
    }

    if (account.hostedDomain || account.institution) {
      return {
        canUseClassroom: true,
        reason: 'workspace',
        detail: `${account.institution} kurumsal hesabı algılandı.`,
      }
    }

    return {
      canUseClassroom: true,
      reason: 'unknown',
      detail: 'Kurumsal hesap algılanamadı; Classroom erişimi denenecek.',
    }
  }
}

/**
 * pdfTextRepair.ts
 * ---------------------------------------------------------------------------
 * PDF çıkarımında veya bazı PDF üreticilerinde (InDesign, Word, Chrome Print vb.)
 * her bir glifin ayrı ayrı konumlandırılması sonucu harfler arasına düşen sahte
 * boşlukları tespit edip doğal Türkçe/İngilizce kelimelere dönüştürür.
 */

export function repairPdfSpacedText(line: string): string {
  if (!line || line.length < 4) return line

  // 1) HTML/XML etiketleri: "< h t m l >", "< / h e a d >", "< / h t m l >" vb.
  let res = line.replace(/<\s*([/!?]?\s*[a-zA-Z0-9_-]+(?:\s+[/a-zA-Z0-9_-]+)*)\s*>/g, (_, inner) => {
    return `<${inner.replace(/\s+/g, '')}>`
  })

  // 2) Parantez içi tekil harf dizileri: "( L i n k l e r )", "( D B )"
  res = res.replace(/\(\s*([A-Za-zÇĞİÖŞÜa-zçğıöşü0-9](?:\s+[A-Za-zÇĞİÖŞÜa-zçğıöşü0-9])+)\s*\)/g, (_, inner) => {
    return `(${inner.replace(/\s+/g, '')})`
  })

  // 3) Çizgi, iki nokta, parantez gibi belirteçlerle ayrılmış token dizilerini incele
  const rawTokens = res.split(/\s+/)
  if (rawTokens.length < 3) return res

  const singleCharCount = rawTokens.filter(t => t.length === 1 && /[A-Za-zÇĞİÖŞÜa-zçğıöşü0-9]/.test(t)).length
  if (singleCharCount < 3) return res

  const isLower = (c: string) => /^[a-zçğıöşü]$/.test(c)
  const isUpper = (c: string) => /^[A-ZÇĞİÖŞÜ]$/.test(c)
  const isDigit = (c: string) => /^[0-9]$/.test(c)

  const COMMON_UPPER_WORDS = new Set([
    'HTML', 'HTML5', 'CSS', 'CSS3', 'JS', 'DB', 'SQL', 'PHP', 'API', 'REST', 'JSON', 'XML',
    'BST', 'FORM', 'VERİLERİNİN', 'GÖNDERİMİ', 'VE', 'VERİTABANI', 'BAĞLANTISI', 'ELEMANLARI',
    'BÖLÜMÜ', 'TABLO', 'TABLOLAR', 'LİSTE', 'LİSTELER', 'METİN', 'BAŞLIK', 'ETİKETLERİ',
    'DERS', 'HAFTA', 'ÖDEV', 'PROJE', 'SINAV', 'İÇİNDEKİLER', 'NOTLAR', 'GİRİŞ', 'SONUÇ'
  ])

  const outTokens: string[] = []
  let buffer: string[] = []

  const flushBuffer = () => {
    if (buffer.length === 0) return
    if (buffer.length === 1) {
      outTokens.push(buffer[0])
      buffer = []
      return
    }

    let currentWord = buffer[0]
    for (let i = 1; i < buffer.length; i++) {
      const prevChar = currentWord[currentWord.length - 1]
      const currChar = buffer[i]

      // Noktalama ayrımı
      if (/^[·—:;,!?]$/.test(currChar)) {
        if (/^[:;,!?]$/.test(currChar)) {
          outTokens.push(currentWord + currChar)
          currentWord = buffer[++i] ?? ''
        } else {
          outTokens.push(currentWord)
          outTokens.push(currChar)
          currentWord = buffer[++i] ?? ''
        }
        continue
      }
      if (/^[·—]$/.test(prevChar)) {
        outTokens.push(currentWord)
        currentWord = currChar
        continue
      }

      // Kural A: Küçük harften Büyük harfe geçiş kesinlikle YENİ KELİMEDİR
      // Örn: 'm' -> 'E' (Tüm Etiketler), 'k' -> 'K' (Örnek Kullanım)
      if (isLower(prevChar) && isUpper(currChar)) {
        outTokens.push(currentWord)
        currentWord = currChar
        continue
      }

      // Kural B: 've' gibi kısa bağlaçların tespiti
      if (
        currChar === 'v' &&
        buffer[i + 1] === 'e' &&
        (i + 2 === buffer.length || isUpper(buffer[i + 2]) || /^[·—:;,!?]$/.test(buffer[i + 2]))
      ) {
        outTokens.push(currentWord)
        currentWord = 've'
        i++
        continue
      }

      // Kural C: Tamamen büyük harfli kelime sınırları
      if (isUpper(prevChar) && isUpper(currChar)) {
        if (COMMON_UPPER_WORDS.has(currentWord)) {
          outTokens.push(currentWord)
          currentWord = currChar
          continue
        }
      }

      // Kural D: Büyük harf serisinden sonra gelen küçük harf bağlacı / kelime
      if (currentWord.length >= 2 && /^[A-ZÇĞİÖŞÜ0-9]+$/.test(currentWord) && isLower(currChar)) {
        outTokens.push(currentWord)
        currentWord = currChar
        continue
      }

      // Kural E: Sayı serisinden sonra gelen büyük harf
      if (isDigit(prevChar) && isUpper(currChar)) {
        outTokens.push(currentWord)
        currentWord = currChar
        continue
      }

      currentWord += currChar
    }

    if (currentWord) {
      outTokens.push(currentWord)
    }
    buffer = []
  }

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]
    const isSingleChar = token.length === 1 && /[A-Za-zÇĞİÖŞÜa-zçğıöşü0-9·—:;,!?]/.test(token)
    const isAbbrPiece = /^[A-ZÇĞİÖŞÜa-zçğıöşü]\.$/.test(token)

    if (isSingleChar) {
      buffer.push(token)
    } else if (isAbbrPiece) {
      if (buffer.length > 0) {
        buffer.push(token)
      } else {
        outTokens.push(token)
      }
    } else {
      flushBuffer()
      outTokens.push(token)
    }
  }

  flushBuffer()
  return outTokens.join(' ').replace(/\s+([:;,!?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
}

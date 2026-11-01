# Mariné Car Wash & Lounge — web sitesi v2 teslim notu

Hazırlanma: 1 Kasım 2026
Kapsam: testoweb.com/carwash ön yüzünün yeniden yazımı, tüm görsellerin Gemini ile yeniden üretimi, 9 saniyelik scroll'a bağlı hero videosu.

---

## 1. Neler değişti (kısa)

| Konu | Eski site | Yeni site |
|---|---|---|
| Hero | 108 JPG karelik canvas animasyonu; videonun son karesinde başka bir markanın (BAINSEA) logosu | Gemini Omni 1.1 Flash ile üretilmiş 9 sn / 1080p video, `<video>` etiketiyle scroll'a bağlı; tabelada gerçek Mariné logosu |
| Görseller | Lounge fotoğrafında "BAINSEA" logosu ve "Where Rain Meets the Sea" neon yazısı; kahve fotoğrafında bozuk "CAR WASM" yazısı ve görselin içine gömülü başlık kutusu; araçlarda Mercedes/Porsche logoları | 8 yeni sahne (Gemini 3 Pro Image). Logo yapay zekâya çizdirilmedi; gerçek logo PNG'si perspektifle tabelalara, cama, tuvale ve sadakat kartına yerleştirildi |
| Tipografi | Cinzel + Playfair + Plus Jakarta (üç font), her başlıkta italik vurgulu tek kelime, her bölümün üstünde BÜYÜK HARF etiket | Playfair Display (logodaki yazı tipiyle aynı aile) + Barlow (tabela/trafik yazısı kökenli). Etiket hapı, italik vurgu, gereksiz numara yok |
| Renk | Şablondan kalma "gold" değişkenleri (`--gold-bright`, `--green-*` içinde altın rengi) | Logodan alınan lacivert + turkuaz; tek tutarlı token seti |
| Metin | "Ritüel", "Kusursuz", "Fırçasız. Kireçsiz. Kusursuz." gibi üçlü kalıplar; "sipariş zorunluluğu yoktur" 8 kez tekrar; her madde Baş Harfleri Büyük | Kısa, düz Türkçe. Her bilgi bir kez, gerektiği yerde |
| Fiyatlar | Araç tipine göre sekmeli 3 kart + doğrulanamayan "Çevre ort: ₺600" karşılaştırmaları | Tek bakışta tüm fiyatları gösteren tarife panosu (paket × araç tipi). Rakip fiyat iddiası kaldırıldı (karşılaştırmalı reklam riski) |
| Randevu | Başkalarının adını ve plakasını gösteren "Günün canlı randevu akışı" tablosu; kod ile herkesin iptal edebildiği sorgu ekranı | Boş saat seçimi, doğrulamalı form, KVKK onayı, kayıttan sonra WhatsApp özeti. Canlı tablo ve iptal butonu kaldırıldı (bkz. §4) |
| Asistan | "Mariné AI Assistant" etiketi (aslında kural tabanlı akış), girdi doğrulaması yok | "Hızlı randevu" adıyla aynı akış; plaka/telefon doğrulaması, onay adımı, aynı API |
| Teknik | Tema değiştirici artıkları (Premium / Mariné / Sport), satır içi stiller, `innerHTML` ile sunucu verisi basma (XSS riski), JSON-LD'de yanlış alan adı (premiumcarwash.com) ve olmayan görsel | Tek marka, satır içi stil yok, tüm dinamik metin `textContent` ile; JSON-LD düzeltildi; fontlar sunucuda (Google Fonts'a istek yok) |

## 2. Yükleme

1. Sunucudaki `/carwash/` klasörünün yedeğini alın.
2. Bu paketteki dosyaları `/carwash/` içine kopyalayın:
   `index.html`, `kvkk.html`, `styles.css`, `app.js`, `assets/` klasörü.
3. Artık kullanılmayan eski dosyalar silinebilir:
   `hero-frames-marine/`, `assets/hero-wash-marine-9s.mp4`, `assets/lounge-marine.jpg`, `assets/exterior-marine.jpg`, `assets/lounge-bar-closeup.jpg`, `assets/logo-marine-card.png`.
   `assets/logo-marine-darkbg.png` ve `assets/logo-marine-lightbg.png` yerinde kalmalı (pakette de var).
4. Arka uç (`api/…`) değişmedi; aynı uç noktalar aynı biçimde kullanılıyor.
5. Cloudflare önbelleğini temizleyin (Caching → Purge Everything).

### Yayından önce doldurulacaklar
- `kvkk.html` içindeki sarı işaretli alanlar: şirket unvanı, açık adres, e-posta, barındırma sağlayıcısı, saklama süresi, tarih. **Metin bir şablondur, avukatınıza okutun.**
- Asıl alan adına geçerken `https://testoweb.com/carwash/` ifadesini `index.html` içinde (canonical, og:url, og:image, JSON-LD) toplu değiştirin; `<base href="/carwash/">` satırını yeni yola göre güncelleyin.
- Metinde işletmeden teyit edilmesi gerekenler: "Binanın sahibi biziz…" cümlesi (eski sitedeki iddiadan alındı), Wi-Fi adı `Marine_Lounge`, adres satırı "Sahil Yolu".

## 3. Dosya haritası

```
index.html            ana sayfa
kvkk.html             aydınlatma metni (şablon)
styles.css            tüm stiller
app.js                hero video, randevu, sorgulama, hızlı randevu asistanı
assets/
  logo-marine-darkbg.png / logo-marine-lightbg.png
  video/hero-yikama-9s-1080.mp4   (4,4 MB, masaüstü)
  video/hero-yikama-9s-720.mp4    (2,4 MB, mobil / yavaş bağlantı)
  img/  *-900 / *-1600 .jpg + .webp, hero-poster, og-image, favicon, apple-touch-icon
  fonts/ Playfair Display, Barlow (woff2, Türkçe karakterli alt küme) + OFL lisansları
```

## 4. Arka uçta düzeltilmesi gerekenler (önemli)

Ön yüz bu sorunları gizler ama kapatamaz; API doğrudan çağrılabilir.

1. **`GET api/slots` herkese açık şekilde müşteri adı ve randevu kodu döndürüyor** (`recentBookings[].customerName`, `code`). KVKK açısından risklidir. Bu uçtan yalnızca saat ve boş peron sayısı dönmeli.
2. **`DELETE api/appointments?code=…` kimlik doğrulaması olmadan çalışıyor** (eski ön yüzdeki iptal butonu bu ucu kullanıyordu). Kodlar 4 haneli (`MRN-1042`) ve yukarıdaki uçtan okunabildiği için başkasının randevusu iptal edilebilir. İptal yalnızca yönetim panelinden ya da telefon numarası doğrulamasıyla yapılmalı.
3. **`GET api/lookup` plakayla sorgulamada müşteri adını döndürüyor.** Yalnızca damga sayısı ve randevu tarih/saat bilgisi dönmeli; plaka + telefonun son 4 hanesi gibi ikinci bir doğrulama eklenmeli.
4. **`POST api/appointments` için hız sınırı** (aynı IP'den dakikada birkaç istek) ve sunucu tarafında fiyat hesabı önerilir; fiyat şu an istemciden gönderiliyor.
5. **Video için Range desteği:** Cloudflare/origin `Range` isteğine 206 yerine 200 dönüyor. Ön yüz bunu videoyu bir kez indirip Blob olarak oynatarak çözüyor; yine de origin'de Range açılırsa ilk açılış hızlanır.

## 5. Görseller ve video nasıl üretildi

- **Sahneler:** Gemini 3 Pro Image (Nano Banana Pro), 2K. Her sahnede tabela/tuval/cam/kart yüzeyi boş bırakıldı.
- **Logo:** Yapay zekâ logo harflerini bozduğu için (eski görsellerdeki "CAR WASM" gibi) gerçek PNG logo, ölçülen köşe noktalarına perspektifle oturtuldu; yüzeyin ışığı ve dokusu korunarak (baskı, ışıklı tabela, cam folyo).
- **Hero video:** Gemini Omni 1.1 Flash, 9 sn, 1080p, tek deneme. Başlangıç karesi (köpüklü araç + logolu tabela) ve bitiş karesi (durulanmış araç, Gemini ile düzenlendi) verildi; model aradaki durulamayı üretti. Kamera sabit, logo 9 saniye boyunca bozulmuyor. Sitede sessiz; orijinal sesli sürüm kaynak paketinde.
- **Web için:** H.264, 8 karede bir anahtar kare (scroll'da akıcı ileri-geri sarma için), ses yok, faststart.
- Kaynak paketinde ham Gemini çıktıları, logolu tam boy görseller ve görselleri yeniden üreten Python araçları var.

## 6. Test edilenler

- Chrome, masaüstü 1440×900, mobil 390×844 ve 375×667: hero video scroll ile 0 → 4,5 → 8,2 sn ilerliyor; konsol hatası yok.
- Randevu formu: doğrulama, boş saat seçimi, kayıt, WhatsApp özeti; API kapalıyken WhatsApp'a talep olarak düşme.
- Hızlı randevu asistanı: araç → paket → gün → saat akışı.
- `prefers-reduced-motion`: scroll bağlantısı kapanıyor, video normal hızda bir kez oynuyor, "Videoyu durdur" butonu var.
- Klavye: tüm butonlar ve saat seçimi (ok tuşları) erişilebilir; odak çerçevesi görünür.
- Henüz test edilmedi: gerçek iPhone Safari. iOS'ta video ilk dokunuşta hazırlanacak şekilde ayarlandı; yayından sonra bir iPhone'da kaydırarak kontrol edin.

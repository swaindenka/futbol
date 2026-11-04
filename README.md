# ⚽ Futbol Arena

Tarayıcıda oynanan, **gerçek zamanlı, çok oyunculu** (2–8 kişi, en fazla **4v4**) futbol oyunu.
Saha, bilardo masası gibi **eğik üstten (2.5D)** görünür: kenarlar bant gibidir, top banttan seker;
oyuncular forma desenli pullar olarak görünür.

## Özellikler

**Oynanış**
- Gerçek zamanlı hareket, **depar** (dayanıklılık barı ile)
- **Şarjlı şut**: tuşu basılı tuttukça güç halkası dolar, bırakınca vurur; kısa dokunuşla hafif itme
- **Falso**: şut anında yana koşuyorsan top kavis alır
- **Aşırtma (lob)**: top oyuncuların üstünden geçer, düşeceği yer halka ile gösterilir
- **Akıllı pas**: nişan yönündeki en uygun takım arkadaşına, koşu yönünü hesaba katarak
- **Top sürme**: topu ayağında tutma, rakibe gövde ile karşı koyma
- **Kayarak müdahale**: topa sahip rakibe temiz müdahale; topsuz oyuncuya kayarsan **faul** ve sen yere düşersin
- **Bilardo kılavuzu**: şut/aşırtma doldururken yörünge ve banttan sekmeler önizlenir (kapatılabilir)
- Santra kuralları, **altın gol**, gol limiti, süre seçimi
- 3 zorlukta **botlar** (kaleci, top kovalayan, destek/markaj rolleri) boş yerleri doldurur
- Maç sonu istatistikleri: gol, asist, şut, isabetli pas, top kapma, topa sahip olma, oyuncu puanı ve **MVP**

**Görsel / UX**
- Gece maçı stadyumu: biçilmiş çim, tribünlerde animasyonlu taraftarlar, ışık parlamaları, flaşlar
- Kayan **LED reklam panoları** (gol anında takım renginde "GOOOOL!")
- 3D kale, file **dalgalanması**, yuvarlanan top deseni, sert şutlarda ateş izi, parçacıklar, ekran sarsıntısı
- Gol bandı, konfeti ve **ağır çekim gol tekrarı**
- 10 forma seti (çizgili, yatay çizgili, kuşaklı, yarım), takma ad + forma numarası
- Ses dosyası olmadan WebAudio ile sentezlenen sesler: vuruş, direk, file, düdük, tribün uğultusu
- Emote'lar, oyun içi sohbet, skor tablosu (Tab), mini harita, kamera modları (otomatik / tüm saha / takip), kamera açısı ayarı
- Klavye (WASD ve ok tuşu düzenleri), **fare ile nişan**, **gamepad**, **mobil dokunmatik joystick**
- Oda kodu ve **davet linki** (`?oda=KOD`), açık oda listesi, hızlı maç, sunucusuz **antrenman** modu

## Çalıştırma

Node.js 18+ gerekir.

```bash
npm install
npm start          # http://localhost:3000
```

Aynı ağdaki arkadaşların `http://<bilgisayarının-ip-adresi>:3000` adresinden bağlanabilir.
İnternet üzerinden oynamak için aşağıdaki gibi bir sunucuya yükleyin.

Geliştirme için: `npm run dev` (dosya değişince yeniden başlar), testler için: `npm test`.

## Kontroller

| Eylem | Klavye / Fare | Gamepad |
| --- | --- | --- |
| Hareket | `W A S D` veya ok tuşları | Sol çubuk |
| Depar | `Shift` | LB / LT |
| Şut (basılı tut → bırak) | `Space`, `X` veya sol tık | A / RT |
| Pas | `E` veya `C` | X / RB |
| Aşırtma | `R`, `V` veya sağ tık | Y |
| Kayarak müdahale | `Q` veya `Z` | B |
| Nişan | Fare imleci (ayarlardan yön tuşlarına alınabilir) | Sağ çubuk |
| Sohbet / Emote | `Enter` / `1`–`6` | |
| Skor tablosu, kamera, ses, menü | `Tab`, `F`, `M`, `Esc` | |

## Dağıtım

**Docker**

```bash
docker build -t futbol-arena .
docker run -p 3000:3000 futbol-arena
```

**Render.com** — depodaki `render.yaml` ile "New → Blueprint" seçip depoyu bağlamanız yeterli
(ücretsiz planda çalışır, WebSocket destekler). Railway / Fly.io gibi Node destekleyen her platformda
`npm start` komutu ile çalışır; port `PORT` ortam değişkeninden okunur. Sağlık kontrolü: `GET /health`.

## Mimari

```
public/            Tarayıcı istemcisi (derleme adımı yok, saf ES modülleri)
  shared/          Sunucu ve istemcinin ORTAK kullandığı kod
    physics.js     Deterministik maç simülasyonu (60 Hz)
    bot.js         Bot yapay zekâsı
    stats.js       İstatistikler / puanlama
    protocol.js    Sıkıştırılmış snapshot formatı
  js/game/         Render motoru (Canvas 2D), kamera, efektler, girdi, oturum
  js/ui/           Ekranlar, HUD, modallar
server/            Node.js otoriter oyun sunucusu (ws)
test/              node:test ile fizik ve uçtan uca sunucu testleri
```

- **Otoriter sunucu**: maç sunucuda 60 Hz çalışır, durum 30 Hz ile gönderilir. Hile yapılamaz; botlar sunucuda çalışır.
- **İstemci tahmini + uzlaştırma**: istemci aynı fizik kodunu çalıştırır, kendi girdilerini anında uygular,
  sunucudan gelen her durumda onaylanmamış girdileri yeniden oynatır. Hatalar görsel olarak yumuşatılır;
  böylece yüksek pingte bile kendi oyuncun gecikmesiz hareket eder.
- Oyuncu maç ortasında çıkarsa yerine bot geçer; oda sahibi ayrılırsa sahiplik devredilir.

**Hata ayıklama parametreleri:** `?lag=150` (yapay gecikme, ms), `?server=wss://...` (farklı sunucu), `?oda=KOD` (odaya doğrudan katıl).

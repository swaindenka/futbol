# ⚽ Futbol Arena

Tarayıcıda oynanan, **gerçek zamanlı, çok oyunculu** (2–8 kişi, en fazla **4v4**) futbol oyunu.
Saha, bilardo masası gibi **eğik üstten (2.5D)** görünür: kenarlar bant gibidir, top banttan seker;
oyuncular forma desenli pullar olarak görünür.

## Özellikler

**Oynanış (sade, tek tuş)**
- Sadece **koş** ve **vur**: topa koşarak çarparsan top önünde ilerler (top sürme)
- **Vur** tuşu topu senden uzağa, topun bulunduğu yöne doğru sert gönderir; nişan almak için topun arkasına geçersin
- Tuş basılıyken oyuncunun etrafında beyaz halka çıkar, top değdiği an vuruş olur (gelen topa direkt vuruş)
- Saha kenarları banttır, top duvarlardan seker; oyuncular top bant dibinde sıkışmasın diye çizginin biraz dışına çıkabilir
- Santra kuralları, **altın gol**, gol limiti, süre seçimi
- 3 zorlukta **botlar** (kaleci, top kovalayan, destek rolleri) boş yerleri doldurur
- Maç sonu istatistikleri: gol, asist, şut, topa sahip olma, oyuncu puanı ve **MVP**

**Görsel / UX**
- Gece maçı stadyumu: biçilmiş çim, tribünlerde animasyonlu taraftarlar, ışık parlamaları, flaşlar
- Kayan **LED reklam panoları** (gol anında takım renginde "GOOOOL!")
- 3D kale, file **dalgalanması**, yuvarlanan top deseni, sert şutlarda ateş izi, parçacıklar, ekran sarsıntısı
- Gol bandı, konfeti ve **ağır çekim gol tekrarı**
- 10 forma seti (çizgili, yatay çizgili, kuşaklı, yarım), takma ad + forma numarası
- Ses dosyası olmadan WebAudio ile sentezlenen sesler: vuruş, direk, file, düdük, tribün uğultusu
- Emote'lar, oyun içi sohbet, skor tablosu (Tab), mini harita, kamera modları (otomatik / tüm saha / takip), kamera açısı ayarı
- Klavye (WASD veya ok tuşları), **gamepad**, **mobil dokunmatik joystick + tek VUR tuşu** (saydamlık ve boyut ayarlı)
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

| Eylem | Klavye / Fare | Gamepad | Mobil |
| --- | --- | --- | --- |
| Koş | `W A S D` veya ok tuşları | Sol çubuk | Sol taraf: joystick |
| Vur | `Space`, `X`, `Shift` veya tık | Herhangi bir tuş | Sağdaki **VUR** |
| Sohbet / Emote | `Enter` / `1`–`6` | | 💬 butonu |
| Skor tablosu, kamera, ses, menü | `Tab`, `F`, `M`, `Esc` | | Üst butonlar |

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

# ⚽ Futbol Arena

Tarayıcıda oynanan, **gerçek zamanlı, çok oyunculu** (2–8 kişi, en fazla **4v4**) futbol oyunu.
Saha, bilardo masası gibi **eğik üstten (2.5D)** görünür: kenarlar bant gibidir, top banttan seker;
oyuncular forma desenli pullar olarak görünür.

## Özellikler

**Oynanış (sade, tek tuş)**
- Sadece **koş** ve **vur**: topa koşarak çarparsan top önünde ilerler (top sürme)
- **Vur** tuşu topu senden uzağa, topun bulunduğu yöne doğru sert gönderir; nişan almak için topun arkasına geçersin
- Tuş basılıyken oyuncunun etrafında beyaz halka çıkar, top değdiği an vuruş olur (gelen topa direkt vuruş)
- Top yakınındayken önünde çıkan oklar vuruş yönünü gösterir
- Hafif top kontrolü: top ayağa yapışmaz ama dönüşlerde oyuncuyu hafifçe takip eder
- **Falso (aftertouch):** vuruştan hemen sonra yön tuşunu yana çevirirsen top o yöne kavis alır (hız kaybetmez); düz vuruşlar düz gider. Zor botlar da kendi şutlarını falsoyla hedefe döndürür
- Saha kenarları banttır, top duvarlardan seker; köşeler bilardo masası gibi yuvarlatılmıştır, top köşede sıkışmaz
- Karşılıklı aynı anda vuruşta top bloke olur, asla oyuncunun içinden geçmez
- Her golden sonra kısa kutlama ve **3-2-1 geri sayım**; antrenmanda menü açıkken oyun duraklar
- **Rastgele güçlendirmeler** (oda ayarında sıklık: Kapalı / Az / Normal / **Kaos**): maç sırasında sahada rozetler belirir, üstünden geçen kapar. Rozetin yeri 1 saniye önceden halka ile işaretlenir, ömrü rozetin altındaki halkadan görünür

  | | Güçlendirme | Süre | Etki |
  | --- | --- | --- | --- |
  | 🔥 | **Ateş Topu** | şarj, 10 sn | Sonraki vuruş alevli ve çok sert; önündeki ilk rakibi delip geçer, onu savurup sersemletir |
  | 💥 | **Şok Vuruşu** | şarj, 10 sn | Sonraki vuruşta etrafa şok dalgası: yakındaki rakipler savrulur ve 1 sn sersemler |
  | 🍄 | **Dev** | 9 sn | 1.55 kat büyük, ağır gövde; rakipleri iter, vuruşlar %20 sert |
  | ⚡ | **Hız** | 8 sn | %40 daha hızlı, daha çabuk ivmelenme |
  | 🧲 | **Mıknatıs** | 9 sn | Top ayağa yapışır ve önüne döner; yakındaki yavaş topu ve uzun pasları çeker (şutları tutmaz) |
  | 👻 | **Hayalet** | 7 sn | Oyuncuların içinden geçersin; ayağındaki top da rakiplere çarpmaz, ancak vurarak alınabilir |
  | 🛡️ | **Kalkan** | 12 sn | Kalenin önüne enerji perdesi: ilk şutu geri çevirip kırılır |
  | ❄️ | **Buz** | 4 sn | Rakip takımın tamamı %45 yavaşlar |
  | 🎾 | **Lastik Top** | 10 sn | Top kapan takımın: bantlardan hız kaybetmeden seker, sizin vuruşlarınız %15 sert, rakip topu ayağında tutamaz |
  | ❓ | **Sürpriz Kutu** | – | İçinden rastgele bir güçlendirme ya da (~%25) bir lanet çıkar |
  | 🌀 | *Ters Köşe* (lanet) | 3.5 sn | Kontroller ters döner |
  | 🧊 | *Kaygan* (lanet) | 4.5 sn | Ayaklar buzda gibi kayar |

  Ateş ve Şok vuruş şarjıdır: diğer güçlendirmelerle birlikte taşınır, biri diğerinin yerini alır. Süreler ve güçler, botlarla binlerce eşleştirilmiş simülasyonla (güçlendirmeli / güçlendirmesiz aynı an) dengelendi
- Botlar güçlendirmeleri bilerek kullanır: güçlendirmesi olan bot topa gider, ateş topuyla uzaktan ve defansın içinden vurur, şok vuruşunu kalabalıkta patlatır, mıknatısla topu doğrudan kaleye taşır, hayaletle pas yerine top sürer, ters kontrole bir süre sonra alışır
- **Kurtarış** (kaleye giden şutu gövdeyle kesmek) ve **top kapma** (rakibin ayağındaki topu çalmak) ayrı istatistik, oyuncu puanına katkı yapar; hat-trick anonsu
- Santra kuralları, **altın gol**, gol limiti, süre seçimi
- 3 zorlukta **botlar** (kaleci, top kovalayan, destek rolleri) boş yerleri doldurur
- Maç sonu istatistikleri: gol, asist, şut, kurtarış, top kapma, topa sahip olma, oyuncu puanı ve **MVP**

**Görsel / UX**
- Gece maçı stadyumu: biçilmiş çim, tribünlerde animasyonlu taraftarlar, ışık parlamaları, flaşlar
- Kayan **LED reklam panoları** (gol anında takım renginde "GOOOOL!")
- 3D kale, file **dalgalanması**, yuvarlanan top deseni, sert şutlarda ateş izi, parçacıklar, ekran sarsıntısı
- Gol bandı, konfeti ve **ağır çekim gol tekrarı**
- 10 forma seti (çizgili, yatay çizgili, kuşaklı, yarım), takma ad + forma numarası
- Ses dosyası olmadan WebAudio ile sentezlenen sesler: vuruş ve dokunuş, direk, file, düdük; top kaleye yaklaştıkça yükselen, kıl payı kaçan şutta "ooh" diyen tribün
- Emote'lar, oyun içi sohbet, skor tablosu (Tab), mini harita, kamera modları (otomatik / tüm saha / takip), kamera açısı ayarı
- Güçlendirme çipleri ikon, kalan saniye ve süre çubuğuyla; bitmeye yakın yanıp söner. Oyuncunun üstünde yüzen yazılar (+HIZ, SERSEM!, KURTARIŞ!, KAPTI!), takip kamerasında ekran dışındaki rozetleri gösteren oklar, mini haritada rozet ve kalkanlar
- **Akıcılık:** otomatik grafik kalitesi (kare hızı düşerse kendiliğinden bir kademe düşer), takip kamerası koştuğun yöne hafifçe önden bakar
- Klavye (WASD veya ok tuşları), **gamepad**, **mobil dokunmatik joystick + tek VUR tuşu** (saydamlık ve boyut ayarlı)
- Oda kodu ve **davet linki** (`?oda=KOD`), açık oda listesi, hızlı maç, sunucusuz **antrenman** modu
- Oda lobisinde ve maç menüsünde **Profilim**: takma ad ve forma numarası her an değiştirilebilir

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
| Vur | `Space`, `X` veya tık | Herhangi bir tuş | Sağdaki **VUR** |
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
- **Yeniden bağlanma:** her sekmenin bir oturum anahtarı vardır. Sayfa yenilenirse ya da telefonda uygulamadan çıkılıp dönülürse eski bağlantı hemen kapatılır, oyuncu aynı kimlik, takım ve istatistiklerle (oda sahibiyse sahiplikle) geri döner. Tek kişilik boş oda 30 saniye korunur.

**Hata ayıklama parametreleri:** `?lag=150` (yapay gecikme, ms), `?server=wss://...` (farklı sunucu), `?oda=KOD` (odaya doğrudan katıl).

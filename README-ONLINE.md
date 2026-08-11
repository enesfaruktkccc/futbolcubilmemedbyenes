# Futbolcuyu Bil — v1.4 online/mobile

## Bu sürümde
- mobil ekran için özel alt menü ve soru çözme düzeni
- telefon ekranında kalem/dokunmatik kullanımına uygun büyük cevap alanı ve butonlar
- 500 benzersiz futbolcudan oluşan havuz
- zorluk: AŞIRI KOLAY → KOLAY → ORTA → ZOR → ÇOK ZOR → EFSANE
- her yeni oyunda aynı zorluk aralığı içinde farklı futbolcu sırası
- küçük yazım hataları ve tek isim/soyisim cevapları için esnek cevap sistemi
- canlı sohbet
- Socket.IO ile tüm cihazlar arasında gerçek zamanlı sohbet
- sunucu tarafında canlı ortak sıralama: siteye girip hesabıyla bağlanan herkes sıralamada görünür
- puan/rating değiştikçe tüm oyuncuların sıralaması anlık güncellenir

## İnternete koyma
Bu sürüm Node.js sunucusu ister; sadece `index.html` yüklemek canlı sohbeti ve ortak sıralamayı çalıştırmaz.

1. Bu klasörü bir Node.js hostuna yükle (Render, Railway, Fly.io vb.).
2. `npm install` çalıştır.
3. `npm start` çalıştır. Sunucu `PORT` ortam değişkenini otomatik kullanır.
4. Oluşan public site adresini arkadaşlarına gönder.

Sunucu aynı zamanda `index.html` dosyasını yayınlar ve `/socket.io` üzerinden sohbet + canlı sıralama bağlantısını açar.

## Önemli
- Hesap şifreleri ve oyun ilerlemesi şu an tarayıcıdaki localStorage'da tutuluyor.
- Canlı sıralama sunucu belleğinde tutuluyor; sunucu yeniden başlarsa sıralama sıfırlanır.
- Gerçek kalıcı hesap/rating sistemi için sonraki aşamada PostgreSQL/Supabase gibi bir veritabanına geçmek gerekir.
- Sohbet geçmişi de sunucu dosya sistemine yazılır; ücretsiz/ephemeral hostinglerde yeniden başlatma sonrası dosya kaybolabilir.

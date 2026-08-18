# Futbolcuyu Bil — V2

İstediğimiz koyu futbol temalı, mobil uyumlu ilk büyük oyun motoru.

## Hazır olanlar
- 800 futbolcu havuzu
- Oyun sırası: 40 çok kolay → 40 kolay → 50 orta → 15 zor → 15 çok zor
- Her yeni oyunda her zorluk bandından rastgele ve tekrarsız seçim
- Yazım hatası toleranslı cevap sistemi
- İlk harf / harf açma ipuçları
- Hız + seri + ipucu cezasına bağlı puanlama
- Wikipedia REST → Wikimedia Commons → güvenli fallback görsel zinciri
- Responsive masaüstü/tablet/mobil arayüz
- Yerel demo register/login, leaderboard ve chat
- Supabase için hazır SQL şeması

## Önemli
Bu V2 ana dizindeki eski index.html'i silmez. Test etmek için GitHub Pages adresinde `/v2/` yolunu açabilirsin.
Gerçek canlı register/login, kalıcı leaderboard ve gerçek zamanlı chat için `supabase.sql` çalıştırılıp `config.js` doldurulacak; ardından UI veri katmanı Supabase Auth/Realtime'e geçirilecek.

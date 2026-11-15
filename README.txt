VOXTERRA - NASA EARTH DATA, ON TAPE
==================================

Sekiz NASA veri seti, kasetlere basildi. Kaseti tak, PLAY'e bas: ayni veri
hem goruntu hem ses olarak calar.

KURULUM (tek gereksinim: Python 3)
  1) Terminalde bu klasore gir:

       cd voxterra
       python3 server.py 8132

  2) Tarayicida ac:

       http://127.0.0.1:8132/index.html

Sayfalar (ust menuden):
  CASSETTE DECK      - kaset yayi; ortala, tikla, deck'e tak, PLAY
  3D PLANET          - gercek uydu kuresi; tara, + / - ile yakinlas, bolgeye tikla
  INFORMATION CARDS  - suruklenebilir kart seridi (NASA dossileri)
  3D GALLERY         - yil kapsulleri silindiri (tikla -> o yilin kasetleri)
  HOW IT WORKS       - motorlar, veri kaynaklari, krediler
  FAQ                - kisa sorular ve cevaplar

NOTLAR
  - Kurulum/paket yoneticisi gerekmez. tiles/ ve nasa/ klasorleri paketteyse
    internet olmadan da calisir (offline paket).
  - Ses icin tarayicida bir kez tiklama gerekir (autoplay kilidi).
  - Kasetler NASA verilerini (GISS GISTEMP, SVS 5196, GIBS/AMSR2, MODIS,
    IMERG) kullanir; ilk takista birkac saniye surer, sonrasi onbellekten acilir.
  - Eksik veri dosyalari internet varken: python3 nasa_indir.py

PROJE
  VOXTERRA - ANKATECH

REFERANS
  Niklas Knaack - 3D carousel (3D GALLERY sayfasi)
  https://codepen.io/NiklasKnaack/pen/abrOMLY

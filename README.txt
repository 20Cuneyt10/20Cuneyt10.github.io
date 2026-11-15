EARTH INFO JUKEBOX — NASA SPACE APPS
====================================

Bu klasoru baska bir bilgisayara kopyaladiktan sonra:

  1) Python 3 kurulu olsun (3.9+; baska hicbir sey gerekmiyor)
  2) Terminalde bu klasore gir:

       cd jukebox
       python3 server.py 8132

  3) Tarayicida ac:

       http://127.0.0.1:8132/index.html

Sayfalar (ust menuden):
  CASSETTE DECK      - kaset yayi (deck'e tiklayarak kaset tak, PLAY)
  3D PLANET          - gercek uydu kuresi + bolge sesi
  INFORMATION CARDS  - suruklenebilir kart seridi (NASA dossileri)
  3D GALLERY         - yil kapsulleri silindiri (tikla -> o yilin kasetleri)

NOTLAR
  - Kurulum/paket yoneticisi gerekmez, internet olmadan da calisir
    (tiles/ ve nasa/ klasorleri paketle birlikte geliyorsa).
  - "offline" pakette harita dosyalari (tiles/, tiles_lr/) dahildir.
  - Internet varsa eksik veri dosyalari nasa_indir.py ile indirilebilir.
  - Ses icin tarayicida bir kez tiklama gerekir (autoplay kilidi).
  - Kasetler NASA veri setlerini (GISTEMP, OCO-2, NSIDC, GRACE ...)
    indirip sonifiye eder; ilk takista birkac saniye surer.

REFERANS
  Niklas Knaack — 3D carousel (3D gallery sayfasi)
  https://codepen.io/NiklasKnaack/pen/abrOMLY

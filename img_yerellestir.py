#!/usr/bin/env python3
# Uzak (unsplash) kart/dossier gorsellerini yerelleştirir: img/cards/<ad>.jpg
# Kullanim: python3 img_yerellestir.py
import hashlib, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'img', 'cards')
FILES = ['style.css', 'detail.html']
PAT = re.compile(r'https://images\.unsplash\.com/[^\s"\')]+')


def main():
    os.makedirs(OUT, exist_ok=True)
    mapping = {}
    urls = set()
    for f in FILES:
        txt = open(os.path.join(ROOT, f), encoding='utf-8').read()
        urls.update(PAT.findall(txt))
    urls = sorted(urls)
    print(f'{len(urls)} uzak gorsel bulundu')

    for i, u in enumerate(urls, 1):
        name = u.split('photo-')[1].split('?')[0] if 'photo-' in u else hashlib.md5(u.encode()).hexdigest()[:8]
        fn = f'{i:02d}-{name[:14]}.jpg'
        path = os.path.join(OUT, fn)
        if not os.path.exists(path) or os.path.getsize(path) < 5000:
            req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
            try:
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = r.read()
                if len(data) < 5000:
                    print(f'  ! cok kucuk: {u}')
                    continue
                open(path, 'wb').write(data)
                print(f'  indi {fn} {len(data)//1024} KB')
            except Exception as e:
                print(f'  ! HATA {fn}: {e}')
                continue
        else:
            print(f'  var  {fn}')
        mapping[u] = f'./img/cards/{fn}'

    for f in FILES:
        p = os.path.join(ROOT, f)
        txt = open(p, encoding='utf-8').read()
        for u, local in mapping.items():
            txt = txt.replace(u, local)
        open(p, 'w', encoding='utf-8').write(txt)
        left = len(PAT.findall(txt))
        print(f'{f}: {left} uzak gorsel kaldi')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# nasa/gibs/deck karo onbellegini doldurur: 6 GIBS katmani x 8 donem.
# Kullanim: python3 gibs_cache.py [--force]
import json, os, sys, time, urllib.parse, urllib.request

GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'nasa', 'gibs', 'deck')

# sources.js TAPES ile ayni (kind 'gibs' olanlar)
TAPES = [
    dict(key='ICE',     layer='AMSRU2_Sea_Ice_Concentration_12km',               lat=78, lng=0,   span=90,  year0=2012),
    dict(key='SNOW',    layer='MODIS_Terra_NDSI_Snow_Cover',                     lat=66, lng=-45, span=70,  year0=2000),
    dict(key='LAND',    layer='MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual',   lat=-5, lng=-60, span=60,  year0=2001),
    dict(key='CO2FLUX', layer='Net Ecosystem CO2 Exchange',                      lat=0,  lng=-60, span=120, year0=2015),
    dict(key='RAIN',    layer='IMERG_Precipitation_Rate',                        lat=8,  lng=20,  span=90,  year0=2000),
    dict(key='AEROSOL', layer='MODIS_Terra_Aerosol',                             lat=10, lng=10,  span=90,  year0=2000),
]
ERAS = [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025]


def bbox(t):
    h = t['span'] / 2
    n = min(85, t['lat'] + h); s = max(-85, t['lat'] - h)
    return s, t['lng'] - h, n, t['lng'] + h


def url(t, era, size):
    s, w, n, e = bbox(t)
    q = urllib.parse.urlencode(dict(
        SERVICE='WMS', REQUEST='GetMap', VERSION='1.3.0', CRS='EPSG:4326',
        BBOX=f'{s},{w},{n},{e}', WIDTH=size, HEIGHT=size,
        FORMAT='image/png', LAYERS=t['layer'], TIME=f'{era}-07-01'))
    return f'{GIBS}?{q}'


def fetch(t, era, size, tries=2):
    for i in range(tries):
        try:
            req = urllib.request.Request(url(t, era, size), headers={'User-Agent': 'jukebox/1.0'})
            with urllib.request.urlopen(req, timeout=45) as r:
                b = r.read()
            if b[:4] == b'\x89PNG' and len(b) > 1200:
                return b
        except Exception as e:
            print(f'    ! {e}', flush=True)
        time.sleep(1.5 * (i + 1))
    return None


def main():
    force = '--force' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    ok = fail = skip = 0
    for t in TAPES:
        for era in [e for e in ERAS if e >= t['year0']]:
            p = os.path.join(OUT, f"{t['key']}_{era}.png")
            if not force and os.path.exists(p) and os.path.getsize(p) > 1200:
                skip += 1
                continue
            t0 = time.time()
            b = fetch(t, era, 512) or fetch(t, era, 256)
            if b:
                open(p, 'wb').write(b)
                ok += 1
                print(f"OK   {t['key']:<8} {era}  {len(b)//1024:>4} KB  {time.time()-t0:.1f}s", flush=True)
            else:
                fail += 1
                print(f"FAIL {t['key']:<8} {era}", flush=True)
    print(f'\nbitti: {ok} yeni, {skip} zaten var, {fail} hata', flush=True)
    json.dump({'ok': ok, 'skip': skip, 'fail': fail, 'when': time.strftime('%d.%m.%Y %H:%M')},
              open(os.path.join(OUT, 'cache.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()

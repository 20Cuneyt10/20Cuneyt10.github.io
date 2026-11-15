#!/usr/bin/env python3
"""NASA veri kaynaklarini projeye indirir (offline demo icin).

Kaynaklar (Kaan'in listesi + dogrulanmis ekler):
  - GISTEMP  : kuresel sicaklik anomalisi, SAF SAYI (CSV, 1880->bugun)
  - SVS 5196 : "DYAMOND Global Carbon Dioxide" animasyonu -> KARELER (PNG)
  - Keeling  : CO2 egrisi gorseli (assets.science.nasa.gov)
  - GIBS WMS : NASA katman goruntuleri (yagis, sicaklik, true-color, gece isiklari)
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "nasa"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) earth-jukebox/1.0"}


def get(url, path=None, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
        ctype = r.headers.get("Content-Type", "")
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(data)
    return data, ctype


# ---------------------------------------------------------------- GISTEMP
def gistemp():
    url = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
    data, _ = get(url, OUT / "gistemp" / "GLB.Ts+dSST.csv")
    lines = data.decode("utf-8", "replace").splitlines()
    rows = [l for l in lines if l[:4].isdigit()]
    years = [int(r.split(",")[0]) for r in rows]
    return {"source": "NASA GISS GISTEMP v4", "url": url,
            "file": "gistemp/GLB.Ts+dSST.csv",
            "years": len(rows), "first": years[0] if years else None,
            "last": years[-1] if years else None}


# ------------------------------------------------------------ SVS frames
SVS_BASE = "https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005196/"
SVS_PREFIX = "dyamondPointCloud_12-1-2023b_dyamond_co2_anim_globe_orbit_3x3Hyperwall"


def svs_frames(step=20, keep=36):
    got = []
    idx = 0
    misses = 0
    while idx < 1200 and len(got) < keep and misses < 6:
        name = f"{SVS_PREFIX}.{idx:05d}_web.png"
        try:
            data, ctype = get(SVS_BASE + name, timeout=30)
            if "image" in ctype and len(data) > 4000:
                p = OUT / "svs" / f"f{len(got):03d}.png"
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
                got.append(p.name)
                misses = 0
            else:
                misses += 1
        except Exception:
            misses += 1
        idx += step
    return {"source": "NASA SVS 5196 — DYAMOND Global Carbon Dioxide",
            "url": "https://svs.gsfc.nasa.gov/5196/",
            "dir": "svs", "frames": got, "count": len(got)}


# --------------------------------------------------------------- Keeling
def keeling():
    url = "https://assets.science.nasa.gov/content/dam/science/esd/climate/2023/12/keeling_image_a1.jpg"
    data, _ = get(url, OUT / "co2" / "keeling.jpg", timeout=60)
    return {"source": "NASA CO2 indicator / Keeling curve", "url": url,
            "file": "co2/keeling.jpg", "bytes": len(data)}


# ------------------------------------------------------------- GIBS WMS
GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
LAYERS = [
    # (ad, katman, format, tarih, aciklama)
    ("rain",  "IMERG_Precipitation_Rate", "image/png", "AUTO",
     "GPM IMERG gunluk yagis"),
    ("temp",  "MERRA2_2m_Air_Temperature_Monthly", "image/png", "MONTH",
     "MERRA-2 aylik 2m hava sicakligi"),
    ("truecolor", "VIIRS_NOAA20_CorrectedReflectance_TrueColor", "image/jpeg", "AUTO",
     "VIIRS true-color gunluk"),
    ("lights", "VIIRS_CityLights_2012", "image/jpeg", "STATIC",
     "VIIRS gece isiklari"),
    ("aerosol", "MODIS_Terra_Aerosol", "image/png", "AUTO",
     "MODIS aerosol optik derinlik"),
]


def date_candidates():
    today = time.gmtime()
    days = []
    for k in range(1, 8):
        t = time.gmtime(time.time() - k * 86400)
        days.append(time.strftime("%Y-%m-%d", t))
    months = [time.strftime("%Y-%m-01", time.gmtime(time.time() - k * 30 * 86400)) for k in range(0, 6)]
    return days, months


def gibs():
    days, months = date_candidates()
    out = []
    for name, layer, fmt, kind, desc in LAYERS:
        tried = []
        if kind == "AUTO":
            tried = days
        elif kind == "MONTH":
            tried = months
        else:
            tried = [None]
        saved = None
        for d in tried:
            q = (f"{GIBS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326"
                 f"&BBOX=-60,-180,85,180&WIDTH=1440&HEIGHT=610&FORMAT={fmt}"
                 f"&LAYERS={layer}")
            if d:
                q += f"&TIME={d}"
            try:
                data, ctype = get(q, timeout=60)
                if len(data) < 3000:            # bos/transparan stub
                    continue
                p = OUT / "gibs" / f"{name}.{'jpg' if 'jpeg' in fmt else 'png'}"
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
                saved = {"file": str(p.relative_to(OUT)), "date": d, "bytes": len(data)}
                break
            except Exception as e:
                continue
        out.append({"name": name, "layer": layer, "desc": desc, "saved": saved})
    return {"source": "NASA GIBS WMS", "url": GIBS, "layers": out}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"fetched": time.strftime("%d.%m.%Y %H:%M")}
    for fn in (gistemp, svs_frames, keeling, gibs):
        name = fn.__name__
        try:
            manifest[name] = fn()
            print(f"OK   {name}: {json.dumps(manifest[name], ensure_ascii=False)[:150]}")
        except Exception as e:
            manifest[name] = {"error": str(e)}
            print(f"FAIL {name}: {e}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print("manifest ->", OUT / "manifest.json")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Statik sunucu + yerel tile onbellegi (tam ve hafif/dusuk cozunurluk).

- /            -> globe.html, libs/ vs. gzip + kalici cache
- /tiles/z/x/y.jpg     -> 256px tam cozunurluk (diskte yoksa ArcGIS'ten indirir)
- /tiles_lr/z/x/y.jpg  -> 128px hafif surum (tam tile'dan aninda uretir, ~4x kucuk)

Kullanim: python3 server.py [port]   (varsayilan 8123)
"""
import gzip
import os
import shutil
import sys
import threading
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.join(ROOT, "tiles")
TILES_LR = os.path.join(ROOT, "tiles_lr")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
HOST = os.environ.get("JUKEBOX_HOST", "127.0.0.1")  # LAN icin JUKEBOX_HOST=0.0.0.0
GZIP_TYPES = (".js", ".mjs", ".html", ".css", ".json", ".svg")
ARCGIS = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
LR_SIZE = 128
LR_QUALITY = 62

_GZ = {}
_LOCKS = {}
_LOCKS_GUARD = threading.Lock()
_image_lock = threading.Lock()


def _lock_for(path):
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(path, threading.Lock())


def ensure_full_tile(z, x, y):
    """Tam cozunurluk tile'i diskte yoksa ArcGIS'ten indirir. Yol veya None dondurur."""
    path = os.path.join(TILES, z, x, y + ".jpg")
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        return path
    with _lock_for(path):
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            req = urllib.request.Request(
                ARCGIS.format(z=z, y=y, x=x), headers={"User-Agent": "globe-cache/1.0"}
            )
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read()
            tmp = path + "%d.part" % threading.get_ident()
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, path)
            return path
        except Exception:
            return None


def ensure_lr_tile(z, x, y):
    """128px hafif tile: yoksa tam tile'dan uretir."""
    path = os.path.join(TILES_LR, z, x, y + ".jpg")
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        return path
    with _lock_for(path):
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return path
        src = ensure_full_tile(z, x, y)
        if not src:
            return None
        from PIL import Image

        os.makedirs(os.path.dirname(path), exist_ok=True)
        with _image_lock:
            im = Image.open(src).convert("RGB").resize((LR_SIZE, LR_SIZE), Image.LANCZOS)
            tmp = path + "%d.part" % threading.get_ident()
            im.save(tmp, "JPEG", quality=LR_QUALITY, optimize=True)
        os.replace(tmp, path)
        return path


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def _tile(self, kind, z, x, y):
        path = ensure_lr_tile(z, x, y) if kind == "tiles_lr" else ensure_full_tile(z, x, y)
        if not path:
            self.send_error(504, "tile alinamadi")
            return
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404, "tile yok")
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = self.path.split("?")[0].strip("/").split("/")
        if len(parts) == 4 and parts[0] in ("tiles", "tiles_lr"):
            y = parts[3].split(".")[0]
            if parts[1].isdigit() and parts[2].isdigit() and y.isdigit():
                return self._tile(parts[0], parts[1], parts[2], y)
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    # ---------- statik ----------
    def end_headers(self):
        path = self.path.split("?")[0]
        if path.startswith(("/libs/", "/tiles/")):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            index = os.path.join(path, "index.html")
            if os.path.exists(index):
                path = index
        if not os.path.isfile(path):
            self.send_error(404, "Bulunamadi")
            return None

        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            body = f.read()

        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")
        if ext in GZIP_TYPES and accepts_gzip and len(body) > 1024:
            key = (path, len(body))
            if key not in _GZ:
                _GZ[key] = gzip.compress(body, 9, mtime=0)
            body = _GZ[key]
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Encoding", "gzip")
        else:
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))

        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return _Bytes(body)


class _Bytes:
    def __init__(self, data):
        self._data = data

    def read(self, *a):
        data, self._data = self._data, b""
        return data

    def close(self):
        pass


if __name__ == "__main__":
    # Baska makineden kopyalanan klasorde symlink'ler kirilir: tamir et, yoksa anlasilir hata ver.
    for d in (TILES, TILES_LR):
        if os.path.islink(d) and not os.path.isdir(d):
            os.unlink(d)
        os.makedirs(d, exist_ok=True)
    if os.path.islink(os.path.join(ROOT, "libs")) and not os.path.isdir(os.path.join(ROOT, "libs")):
        os.unlink(os.path.join(ROOT, "libs"))
    libs = os.path.join(ROOT, "libs")
    if not os.path.isfile(os.path.join(libs, "three.module.js")):
        src = os.path.expanduser("~/Desktop/globe/libs")
        if os.path.isdir(src):
            shutil.copytree(src, libs, dirs_exist_ok=True)
            print("libs/ yerel globe klasorunden kopyalandi")
    missing = [f for f in ("libs/three.module.js", "libs/three-globe.min.js",
                           "libs/sonify-dsp.js", "index.html", "boot.js")
               if not os.path.isfile(os.path.join(ROOT, f))]
    if missing:
        sys.exit("HATA: eksik dosya -> " + ", ".join(missing) +
                 "\n(libs/ kopyalanmamis: 'cp -r ~/Desktop/globe/libs .' veya paketle.sh ile zip al)")
    print(f"jukebox: http://{HOST}:{PORT}/   (tile: {TILES})")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

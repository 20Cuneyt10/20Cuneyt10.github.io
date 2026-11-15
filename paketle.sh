#!/usr/bin/env bash
# Jukebox'u tek zip olarak paketle -> baska bilgisayara kopyalanabilir surum.
#   ./paketle.sh            libs dahil, tile yok  (~2 MB, tile'lar internetten iner)
#   ./paketle.sh --tiles    tile onbellegi de dahil (~140 MB, internet gerekmez)
set -euo pipefail
cd "$(dirname "$0")"

OUT_NAME="jukebox-kit.zip"
WITH_TILES=0
[[ "${1:-}" == "--tiles" ]] && WITH_TILES=1

# symlink'leri cozerek kopyala (zip -r symlink'i kendisi gibi saklar, karsi PC'de kirilir)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
DEST="$TMP/jukebox"
mkdir -p "$DEST"

for f in *.js *.html *.css *.py *.sh .gitignore README*; do
  [[ -e "$f" ]] && cp -rL "$f" "$DEST/" || true
done
cp -rL libs nasa img "$DEST/"
rm -f "$DEST/nasa/co2_anim.mp4"
mkdir -p "$DEST/tiles" "$DEST/tiles_lr"
if [[ $WITH_TILES == 1 ]]; then
  cp -rL tiles/. "$DEST/tiles/" 2>/dev/null || true
  cp -rL tiles_lr/. "$DEST/tiles_lr/" 2>/dev/null || true
fi

# simdiki klasorun kendisi symlink iceriyorsa uyar
find . -maxdepth 1 -type l -printf 'UYARI: symlink -> %p\n' || true

rm -f "$OUT_NAME"
( cd "$TMP" && zip -qr - . ) > "$OUT_NAME"
echo "hazir: $(pwd)/$OUT_NAME  ($(du -h "$OUT_NAME" | cut -f1))"
echo "karsi PC'de:  unzip $OUT_NAME && cd jukebox && python3 server.py 8132"

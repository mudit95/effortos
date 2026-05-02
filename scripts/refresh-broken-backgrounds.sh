#!/usr/bin/env bash
#
# Refresh the three video backgrounds that needed re-sourcing:
#   - candle.mp4       (was: 15 KB / 4.9 s / 21 kbps — effectively broken)
#   - snowfall.mp4     (was: 540p / 11 s — too short to loop convincingly)
#   - forest-creek.mp4 (was: 540p / 15 s — too short)
#
# The new sources are CC0 from Pixabay's video CDN. Each is 720p
# (`_medium` size) and ≥30 s, so the loop point is invisible during a
# 25-minute focus session. We re-encode through ffmpeg to:
#   - Strip audio (background videos are silent in FocusMode)
#   - Cap height at 720p (in case Pixabay served larger)
#   - H.264 / CRF 26 (visually transparent at this content; ~3-5 MB ea.)
#   - +faststart so the browser can begin playback before the file is
#     fully buffered
#
# Run from anywhere; the script `cd`s to the repo root automatically.
# Requires: curl, ffmpeg (install via `brew install ffmpeg` if missing).

set -euo pipefail

# Resolve repo root from this script's location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$REPO_ROOT/public/backgrounds"

# Sanity checks — bail loudly rather than silently doing the wrong thing.
if [ ! -d "$TARGET_DIR" ]; then
  echo "❌ $TARGET_DIR does not exist. Run this from the effortos repo." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "❌ curl not found." >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "❌ ffmpeg not found. Install with: brew install ffmpeg" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# (source url, output filename) pairs. The Pixabay video page IDs and
# date paths are pinned so re-runs always pick the same source.
#
# To swap a source: visit the new Pixabay page, look at the <video>
# element's currentSrc — it'll be of the form
#   cdn.pixabay.com/video/<YYYY>/<MM>/<DD>/<id>-<long>_<size>.mp4
# Use _medium (typically 1280x720). _large is 1080p+ if available.
SOURCES=(
  # candle: "Candle, Fire, Flame, Relaxation" — 1:19, dark backdrop, single flame
  "https://cdn.pixabay.com/video/2023/08/31/178507-860033432_medium.mp4|candle.mp4"
  # snowfall: "Fir Trees, Forest, Snow, Snowfall" — 1:00
  "https://cdn.pixabay.com/video/2022/12/18/143414-782363223_medium.mp4|snowfall.mp4"
  # forest-creek: "Nature, Forest, Creek, Stream" — 1:00, mossy creek + cascading water
  "https://cdn.pixabay.com/video/2022/02/13/107586-678540756_medium.mp4|forest-creek.mp4"
)

for entry in "${SOURCES[@]}"; do
  url="${entry%%|*}"
  filename="${entry##*|}"
  raw_path="$TMP_DIR/raw-$filename"
  out_path="$TARGET_DIR/$filename"

  echo "→ Downloading $filename…"
  curl -L --silent --show-error --fail -o "$raw_path" "$url"

  echo "  Re-encoding to 720p H.264, no audio, faststart…"
  ffmpeg -y -loglevel error \
    -i "$raw_path" \
    -an \
    -c:v libx264 \
    -crf 26 \
    -preset slow \
    -pix_fmt yuv420p \
    -movflags +faststart \
    -vf "scale='min(1280,iw)':'-2'" \
    "$out_path"

  size=$(stat -f%z "$out_path" 2>/dev/null || stat -c%s "$out_path")
  size_mb=$(echo "scale=1; $size / 1048576" | bc)
  duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out_path" | awk '{printf "%.1f", $1}')
  resolution=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$out_path")
  echo "  ✓ $filename → $resolution, ${duration}s, ${size_mb} MB"
done

echo ""
echo "✅ Done. The three replacement backgrounds are now in public/backgrounds/."
echo "   Run \`git status public/backgrounds\` to see the diff, then commit + push."
echo ""
echo "Re-enable the candle entry in src/lib/focus-backgrounds.ts after this:"
echo "   uncomment the SEEDED_REMOTE_BACKGROUNDS entry for video-candle"
echo "   (it was removed when the broken file shipped — see comment in catalog)."

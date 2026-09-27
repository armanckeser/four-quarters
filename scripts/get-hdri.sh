#!/usr/bin/env bash
#
# Download the FOUND library environment HDRI into public/hdri/.
#
# CC0 (public domain, no attribution) from Poly Haven. The "reading_room" slug is a
# sunlit reading room; swap the SLUG below for another CC0 interior if you prefer the
# framing — e.g. wooden_lounge, cabin, poly_haven_studio, kiara_interior. Browse at
# https://polyhaven.com/hdris/indoor . 1k is what three's PMREM wants (see LibraryEnvironment.tsx).
#
# The .hdr is large + third-party, so it is gitignored; run this once after cloning.
# Usage: bash scripts/get-hdri.sh

set -euo pipefail

slug="reading_room"
res="1k"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$here/public/hdri"
mkdir -p "$out"

url="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${res}/${slug}_${res}.hdr"
dest="$out/${slug}_${res}.hdr"

echo "Downloading $url"
curl -fL -o "$dest" "$url"
echo "Saved $dest"

# The app loads /hdri/reading_room_1k.hdr (see LibraryEnvironment.tsx HDRI_FILE).
# If you change the slug/res here, update HDRI_FILE to match.

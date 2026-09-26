#!/usr/bin/env bash
#
# Generate PLACEHOLDER sound effects for the machine into public/sfx/.
#
# These are short synthesized cues (ffmpeg sine / noise bursts) so every
# interaction makes a distinct, audible sound out of the box. They are intended to
# be REPLACED with real recorded SFX. The filenames are the contract (see
# src/lib/audio.ts SOUND_FILES) — just drop a real clip over the placeholder.
#
# Good CC0 / royalty-free sources to swap in:
#   - Kenney.nl/assets        (CC0, no attribution) — Interface Sounds, Coin
#   - freesound.org           (filter License = "Creative Commons 0")
#   - pixabay.com/sound-effects (royalty-free, no attribution)
#   - mixkit.co/free-sound-effects
#
# Requires: ffmpeg (tested with 7.1.1).
# Usage: bash scripts/gen-placeholder-sfx.sh

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$here/public/sfx"
mkdir -p "$out"

# Shared encode settings: mono, 44.1k, small mp3.
enc=(-ac 1 -ar 44100 -b:a 96k -y)

# coin drop: bright short blip with a quick decay (a quarter hitting metal). THREE
# variants form a pool (src/lib/audio.ts coinDrop) so repeated drops don't sound looped;
# each placeholder is the same blip detuned slightly so the variants are distinguishable.
for variant in 1 2 3; do
  detune=$((850 + variant * 100))  # 950 / 1050 / 1150 Hz
  ffmpeg -hide_banner -loglevel error \
    -f lavfi -i "sine=frequency=${detune}:duration=0.16" \
    -af "volume=0.6,afade=t=out:st=0.05:d=0.11" \
    "${enc[@]}" "$out/coin-drop-${variant}.mp3"
done

# coin advance: short ratchet tick (the mechanism rotating the next slot into place,
# played just after each coin-drop).
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "anoisesrc=color=white:duration=0.14:amplitude=0.4" \
  -af "highpass=f=900,lowpass=f=5000,volume=0.6,afade=t=out:st=0.04:d=0.10" \
  "${enc[@]}" "$out/coin-advance.mp3"

# handle push: low, blunt thunk (lever pushed in).
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "sine=frequency=150:duration=0.18" \
  -af "volume=0.7,afade=t=out:st=0.04:d=0.14" \
  "${enc[@]}" "$out/handle-push.mp3"

# handle pull: a rising two-tone "ratchet/clunk" (lever pulled back out).
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "sine=frequency=220:duration=0.22" \
  -af "volume=0.6,asetrate=44100*1.4,aresample=44100,afade=t=out:st=0.06:d=0.16" \
  "${enc[@]}" "$out/handle-pull.mp3"

# card take: brief filtered noise "swish" (paper sliding out, ending with a tap). TWO
# variants form a pool (src/lib/audio.ts cardTake) so repeated grabs don't sound looped.
for variant in 1 2; do
  swishdur="0.2${variant}"  # 0.21 / 0.22s so the two placeholders differ slightly
  ffmpeg -hide_banner -loglevel error \
    -f lavfi -i "anoisesrc=color=brown:duration=${swishdur}:amplitude=0.5" \
    -af "highpass=f=600,lowpass=f=4000,volume=0.7,afade=t=in:st=0:d=0.03,afade=t=out:st=0.08:d=0.12" \
    "${enc[@]}" "$out/card-take-${variant}.mp3"
done

# card flip: short noise tick (the print flipping over). The only card-interaction
# sound kept as a placeholder; the card fly-up / fly-home animations play silently.
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "anoisesrc=color=white:duration=0.12:amplitude=0.4" \
  -af "highpass=f=1200,lowpass=f=6000,volume=0.6,afade=t=out:st=0.03:d=0.09" \
  "${enc[@]}" "$out/card-flip.mp3"

echo "Wrote placeholder SFX to $out:"
ls -1 "$out"

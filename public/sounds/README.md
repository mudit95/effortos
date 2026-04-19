# /public/sounds — ambient sound library

The `AmbientSoundToggle` component in `src/components/timer/AmbientSoundToggle.tsx`
tries to load audio files from this folder. Filenames must match exactly
(they're referenced by ID inside the component):

```
rain.mp3
cafe.mp3
fireplace.mp3
forest.mp3
ocean.mp3
thunderstorm.mp3
keyboard.mp3
lofi.mp3
piano.mp3
jazz.mp3
```

**Fallback behaviour**

If a file is missing, the component either falls back to a synthesized
Web-Audio approximation (rain / cafe / fireplace / white / pink / brown
noise) or marks the option as "unavailable" (all other options). So the
app is fully functional even with zero files present — dropping in files
is a pure upgrade.

**Format guidance**

- Prefer `mp3` at 128 kbps for good size/quality tradeoff.
- Target 3–10 minutes per file (the browser loops them seamlessly).
- Keep total `/public/sounds/` under ~15 MB so the Vercel deploy bundle
  stays lean.
- Mono is fine for ambience; stereo only helps for music.

**Where to get royalty-free audio (CC0 / public domain)**

All of these are legally safe to bundle into a commercial product:

- **Pixabay** — <https://pixabay.com/sound-effects/> · CC0-like Pixabay
  Content License (no attribution required). Search: "rain loop", "cafe
  ambience", "fireplace", "ocean waves", "thunderstorm", "forest
  birds", "keyboard typing". For music: "lofi", "piano", "jazz".
- **Freesound** — <https://freesound.org/> · filter by license =
  "Creative Commons 0". Excellent for nature/ambience field recordings.
- **Free Music Archive** — <https://freemusicarchive.org/> · filter by
  license = "CC0" or "Public Domain". Good for music loops.
- **Internet Archive** — <https://archive.org/details/audio> · filter
  to Public Domain. Lots of old instrumental jazz/piano is PD.
- **ccMixter** — <http://ccmixter.org/> · CC-licensed remixes.

**Licenses to avoid**

- YouTube "Audio Library" tracks — fine for YouTube videos, NOT licensed
  for standalone redistribution inside a SaaS product.
- Anything CC-BY-NC or CC-BY-SA — the ShareAlike clause is problematic
  for a commercial product.
- Epidemic Sound, Artlist, etc. — require an active subscription per
  project; not redistributable.

**Simple workflow**

1. Find a loopable file (2–10 min is ideal).
2. Normalise to -16 LUFS so loudness is consistent across sounds
   (Audacity: Effect → Loudness Normalisation, or `ffmpeg -af loudnorm`).
3. Save as `mp3` with the exact filename above.
4. Commit — Vercel will include it in the next deploy. No code changes
   needed; the component auto-detects.

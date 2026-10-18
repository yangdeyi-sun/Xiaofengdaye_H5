# Audio source

These 16 MP3 files are original procedural audio produced by this project.
No third-party samples, recordings, downloads, or external music libraries are used.

Reproducible source: `scripts/generate-audio.mjs` (same repository license as project code).
Three looping arrangements share an eight-bar melody: home (72 s), game (102.4 s), winter (96 s).
Thirteen short cues cover UI, manual actions and events.

To regenerate, install ffmpeg or set FFMPEG_PATH, then run:
`node scripts/generate-audio.mjs --force`

Replace any MP3 with your own recording using the same path to change the sound.
This README is excluded from release builds.

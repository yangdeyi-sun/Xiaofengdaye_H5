/** Original procedural score and cues. No sampled or downloaded recordings.
 * Regenerate with: node scripts/generate-audio.mjs [--force]
 * Requires ffmpeg on PATH or FFMPEG_PATH pointing to its executable.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const encoder = process.env.FFMPEG_PATH || 'ffmpeg';
if (spawnSync(encoder, ['-version'], { stdio: 'ignore' }).status !== 0) {
  throw new Error('Set FFMPEG_PATH or install ffmpeg before generating audio.');
}
const rate = 44100;
const tau = Math.PI * 2;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const tracks = [];

function buffer(seconds) { return new Float32Array(Math.round(rate * seconds) * 2); }
function note(out, at, midi, length, gain, voice = 'bell', pan = 0, loop = false) {
  const frames = out.length / 2, start = Math.round(at * rate), freq = hz(midi);
  const left = Math.sqrt((1 - pan) / 2), right = Math.sqrt((1 + pan) / 2);
  for (let i = 0, end = Math.round(length * rate); i < end; i++) {
    let frame = start + i;
    if (loop) frame = ((frame % frames) + frames) % frames;
    if (frame < 0 || frame >= frames) continue;
    const t = i / rate, phase = tau * freq * t;
    const release = Math.min(1, (length - t) / 0.08);
    let sound;
    if (voice === 'pad') {
      const env = Math.sin(Math.PI * Math.min(1, t / length)) ** 2;
      sound = env * (Math.sin(phase) + 0.16 * Math.sin(phase * 2.002)) / 1.16;
    } else if (voice === 'flute') {
      const env = Math.min(1, t / 0.07) * Math.min(1, (length - t) / 0.22);
      sound = env * Math.exp(-t * 0.8) * (Math.sin(phase + 0.01 * Math.sin(tau * 4 * t)) + 0.08 * Math.sin(phase * 2));
    } else {
      const env = Math.min(1, t / 0.005) * Math.exp(-t * (voice === 'pluck' ? 7 : 4)) * release;
      sound = env * (Math.sin(phase) + 0.24 * Math.exp(-t * 7) * Math.sin(phase * 2) + 0.07 * Math.sin(phase * 3));
    }
    out[frame * 2] += sound * gain * left;
    out[frame * 2 + 1] += sound * gain * right;
  }
}

function save(relative, out, music = false) {
  const destination = path.join(root, 'public/audio/v2', `${relative}.mp3`);
  if (existsSync(destination) && !process.argv.includes('--force')) return;
  let peak = 0;
  for (const sample of out) peak = Math.max(peak, Math.abs(sample));
  // Leave headroom while making the quiet score audible at the game's default music volume.
  const scale = (music ? 0.5 : Math.min(0.78, peak)) / Math.max(peak, 0.001);
  const pcm = Buffer.alloc(out.length * 2);
  for (let i = 0; i < out.length; i++) pcm.writeInt16LE(Math.round(out[i] * scale * 32767), i * 2);
  mkdirSync(path.dirname(destination), { recursive: true });
  const result = spawnSync(encoder, ['-v', 'error', '-y', '-f', 's16le', '-ar', `${rate}`, '-ac', '2', '-i', 'pipe:0',
    '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-ac', music ? '2' : '1', '-b:a', music ? '56k' : '64k', destination],
    { input: pcm, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  tracks.push(`${relative} (${(out.length / 2 / rate).toFixed(2)}s)`);
}

// Shared eight-bar motif, arranged at different tempos and with deliberate rests.
// Notes and their release tails wrap into the next cycle, avoiding a cut at the loop boundary.
const motif = [[76, 79, 81], [79, 76], [74, 76, 79], [72, 74], [76, 79, 84], [81, 79], [76, 74, 72], [74, 76]];
const chords = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]];
for (const [name, bpm, bars, cold] of [['home', 80, 24, false], ['game', 75, 32, false], ['winter', 60, 24, true]]) {
  const beat = 60 / bpm, barLength = beat * 4, out = buffer(bars * barLength);
  for (let bar = 0; bar < bars; bar++) {
    const at = bar * barLength, chord = chords[bar % 4];
    for (const [i, midi] of chord.entries()) note(out, at - beat * 0.4, midi, barLength + beat * 0.8, cold ? 0.085 : 0.065, 'pad', (i - 1) * 0.45, true);
    note(out, at, chord[0] - 12, beat * 2.5, 0.14, 'flute', 0, true);
    // Game score leaves alternate four-bar phrases quiet for long sessions.
    if (name !== 'game' || bar % 8 < 4) {
      motif[bar % 8].forEach((midi, i) => note(out, at + beat * (i + 0.5), midi - (cold ? 12 : 0),
        beat * (cold ? 2.2 : 1.6), name === 'home' ? 0.18 : 0.12, cold ? 'flute' : 'bell', i % 2 ? 0.3 : -0.3, true));
    }
    if (!cold) [0, 2].forEach((b, i) => note(out, at + b * beat, chord[i + 1] + 12, beat, 0.055, 'pluck', i ? 0.5 : -0.5, true));
  }
  save(`bgm/bgm_${name}`, out, true);
}

const cues = {
  'ui/ui_tap': [0.15, [[0, 79, 0.12, 0.3]]],
  'ui/ui_confirm': [0.34, [[0, 72, 0.23, 0.35], [0.09, 79, 0.23, 0.32]]],
  'ui/ui_error': [0.34, [[0, 62, 0.16, 0.28], [0.13, 58, 0.19, 0.25]]],
  'ui/ui_reward': [0.48, [[0, 72, 0.25, 0.32], [0.09, 76, 0.27, 0.3], [0.18, 84, 0.28, 0.28]]],
  'action/act_collect': [0.22, [[0, 84, 0.19, 0.25], [0.025, 91, 0.16, 0.07]]],
  'action/act_build': [0.5, [[0, 48, 0.21, 0.32], [0.07, 60, 0.2, 0.23], [0.19, 76, 0.28, 0.25]]],
  'action/act_upgrade': [0.64, [[0, 72, 0.3, 0.32], [0.11, 76, 0.32, 0.3], [0.24, 79, 0.36, 0.28]]],
  'event/evt_season': [1.25, [[0, 72, 0.7, 0.3], [0.2, 76, 0.8, 0.26], [0.4, 79, 0.8, 0.24]]],
  'event/evt_threat': [1.05, [[0, 55, 0.4, 0.35], [0.28, 62, 0.4, 0.3], [0.56, 55, 0.43, 0.28]]],
  'event/evt_victory': [1.25, [[0, 67, 0.4, 0.3], [0.15, 72, 0.45, 0.3], [0.3, 76, 0.6, 0.28], [0.45, 79, 0.75, 0.25]]],
  'event/evt_achieve': [1.3, [[0, 72, 0.55, 0.28], [0.14, 76, 0.55, 0.28], [0.28, 79, 0.6, 0.26], [0.46, 84, 0.8, 0.22]]],
  'event/evt_swarm': [1.9, [[0, 60, 0.65, 0.3], [0.24, 67, 0.65, 0.28], [0.48, 72, 0.7, 0.26], [0.72, 76, 0.8, 0.24], [0.96, 79, 0.85, 0.22]]],
  'event/evt_offline': [1.4, [[0, 67, 0.6, 0.28], [0.22, 72, 0.65, 0.28], [0.44, 76, 0.65, 0.26], [0.66, 79, 0.68, 0.24]]]
};
for (const [name, [seconds, notes]] of Object.entries(cues)) {
  const out = buffer(seconds);
  for (const [at, midi, length, gain] of notes) note(out, at, midi, length, gain);
  save(name, out);
}
console.log(`Generated ${tracks.length} original audio files:\n${tracks.join('\n')}`);

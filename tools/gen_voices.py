#!/usr/bin/env python3
"""GTPolly voice-acting pipeline: story dialogue -> Qwen3-TTS (offline) -> assets/voice/<lineId>.mp3.

Pipeline
  1. `node tools/dump_lines.mjs` -> CAST voice descriptions + every LINES entry of src/story/ch*.js.
  2. Reference voice per character (built once, cached in build/voices/ref/<char>.wav/.txt/.json):
     Qwen3-TTS-12Hz-1.7B-VoiceDesign speaks REF_TEXT with the cast `voice` description as the instruct.
     Each candidate is sanity-checked numerically (finite, duration, RMS, clipping, long pauses, median F0
     vs. the gender in the description, Whisper transcript vs. REF_TEXT); the first passing candidate wins.
     Rebuilt automatically when the character's `voice` text changes.
  3. Every line is voice-cloned from that reference with Qwen3-TTS-12Hz-1.7B-Base (ICL clone prompt built
     once per character and reused), so a character sounds the same across all lines. Lines are batched per
     character. Each take is checked (speech rate + Whisper word error rate); bad takes are re-rolled and the
     best take is kept. `--mode design` falls back to VoiceDesign per line with the same instruct.
  4. Post-processing: trim leading/trailing silence, shorten over-long pauses, gentle compression, radio
     band-pass for RADIO_FX characters, loudness-normalise to ~-16 LUFS (measured with ffmpeg loudnorm, applied
     as linear gain + peak limiter), encode mono 24 kHz 64 kbps MP3.
  5. assets/voice/manifest.json {lineId: "<lineId>.mp3"} (the game plays 'assets/voice/' + manifest[id]).

Incremental: build/voices/cache.json {lineId: sha1(char + text + voice)}. A line is regenerated only when
its hash changes or its mp3 is missing. Lines that no longer exist are pruned (manifest, cache, mp3) unless a
chapter file failed to import this run. Manifest + cache are written after every batch, so an interrupted run
loses at most one batch. Raw model output is kept in build/voices/raw/<lineId>.flac (`--reprocess` re-runs
post-processing/encoding only).

Usage (model weights / HF cache live in $GTPOLLY_DATA/hf, default ../gtpolly-data/hf)
  PY=../gtpolly-data/.venv-tts/bin/python
  $PY tools/gen_voices.py                          # everything that is new or changed
  $PY tools/gen_voices.py --only c1m1_01,'c2m3_*'  # just these lines (fnmatch patterns ok)
  $PY tools/gen_voices.py --chars polly,june --limit 10
  $PY tools/gen_voices.py --refs-only              # (re)build every cast reference + distinctness report
  $PY tools/gen_voices.py --redo-refs --chars dewey --force   # new reference for Dewey, regenerate his lines
  $PY tools/gen_voices.py --reprocess              # re-run trim/loudness/encode from cached raw takes
  $PY tools/gen_voices.py --dry-run                # show what would be generated
"""
from __future__ import annotations

import argparse
import contextlib
import fnmatch
import gc
import hashlib
import io
import json
import logging
import math
import os
import re
import shutil
import subprocess
import sys
import time
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get('GTPOLLY_DATA', Path(__file__).resolve().parents[2] / 'gtpolly-data'))
os.environ.setdefault('HF_HOME', str(DATA / 'hf'))            # model weights stay outside the repo
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')       # unsupported MPS ops fall back to CPU
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
warnings.filterwarnings('ignore')

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

VOICE_DIR = ROOT / 'assets' / 'voice'
MANIFEST = VOICE_DIR / 'manifest.json'
BUILD = ROOT / 'build' / 'voices'
REF_DIR = BUILD / 'ref'
RAW_DIR = BUILD / 'raw'
TMP_DIR = BUILD / 'tmp'
CACHE = BUILD / 'cache.json'
REPORT = BUILD / 'report.json'
FFMPEG = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
NODE = shutil.which('node') or 'node'

DESIGN_REPO = 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign'
BASE_REPOS = {'1.7b': 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', '0.6b': 'Qwen/Qwen3-TTS-12Hz-0.6B-Base'}
ASR_REPO = 'openai/whisper-large-v3-turbo'
LANGUAGE = 'English'

# Neutral ~12 s sentence every character's reference voice reads (33 words, varied phonemes, one question-ish
# cadence). Changing it invalidates every reference (it is part of the reference hash).
REF_TEXT = ("Morning. I drove in before sunrise, stopped for coffee and gas, and watched the trucks roll down "
            "the highway. Some days are quiet, and some days are not. Let's see which one this is.")

# Loudness / encoding
TARGET_LUFS = -16.0
PEAK_LIMIT_DB = -1.5
MP3_RATE = 24000
MP3_BITRATE = '64k'
# gentle dialogue compression applied to every voice (keeps crest factor sane before normalising)
BASE_FX = 'acompressor=threshold=-22dB:ratio=2.5:attack=6:release=120:makeup=1'
# characters heard over a radio get a band-pass + heavier processing instead
RADIO_FX = {
    # police radio: narrow band, slammed compression, a touch of saturation
    'dispatch': ('highpass=f=330,highpass=f=330,lowpass=f=3200,lowpass=f=3200,'
                 'acompressor=threshold=-26dB:ratio=8:attack=2:release=80:makeup=6,asoftclip=type=atan'),
    # broadcast radio through a car stereo: wider band, punchy broadcast compression
    'dj': 'highpass=f=120,lowpass=f=6800,acompressor=threshold=-24dB:ratio=4:attack=6:release=150:makeup=3',
}

# Quality gates
LINE_ATTEMPTS = 3          # takes per line (best one kept)
REF_ATTEMPTS = 4           # VoiceDesign candidates per reference
MAX_PAUSE = 0.9            # internal silences longer than this (s) are shortened to KEEP_PAUSE
KEEP_PAUSE = 0.6
SIMILAR_VOICES = 0.6       # centred speaker-embedding cosine above which two references are flagged

_t0 = time.time()


def log(msg=''):
    print(msg, flush=True)


# ----------------------------------------------------------------------------------------------- utilities
def sha1(s: str) -> str:
    return hashlib.sha1(s.encode('utf-8')).hexdigest()


def line_hash(char: str, text: str, voice: str) -> str:
    return sha1(f'{char}\n{text}\n{voice}')


def ref_hash(voice: str) -> str:
    return sha1(f'{voice}\n{REF_TEXT}\n{DESIGN_REPO}')


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, obj, indent=1):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(obj, indent=indent, sort_keys=True, ensure_ascii=False) + '\n')
    os.replace(tmp, path)


def seed_for(*parts) -> int:
    return int(sha1(':'.join(map(str, parts)))[:8], 16)


_ONES = ('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen '
         'sixteen seventeen eighteen nineteen').split()
_TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split()


def num_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10 - 2] + ('' if n % 10 == 0 else ' ' + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + ' hundred' + ('' if n % 100 == 0 else ' ' + num_words(n % 100))
    if n < 1_000_000:
        return num_words(n // 1000) + ' thousand' + ('' if n % 1000 == 0 else ' ' + num_words(n % 1000))
    return str(n)


_SPELL = {'ok': 'okay', 'mr': 'mister', 'mrs': 'missus', 'dr': 'doctor', 'st': 'street', 'det': 'detective'}


def norm_words(s: str) -> list[str]:
    s = s.lower().replace('’', "'").replace('‘', "'")
    s = re.sub(r'(\d),(\d{3})', r'\1\2', s)
    s = re.sub(r'\d+', lambda m: f' {num_words(int(m.group(0)))} ' if len(m.group(0)) < 7 else m.group(0), s)
    s = re.sub(r"[^a-z0-9' ]+", ' ', s.replace('-', ' '))
    out = []
    for w in s.split():
        w = w.strip("'")
        if w:
            out.append(_SPELL.get(w, w))
    return out


def word_errors(ref: str, hyp: str) -> tuple[int, int]:
    """(edit distance in words, reference word count); compound-word splits ('kneecaps'/'knee caps') are free."""
    r, h = norm_words(ref), norm_words(hyp)
    if ''.join(r) == ''.join(h):
        return 0, len(r)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)], len(r)


def gender_of(desc: str) -> str | None:
    d = desc.lower()
    if re.search(r'\b(woman|female|girl|lady|grandmother|mother)\b', d):
        return 'f'
    if re.search(r'\b(man|male|gentleman|guy|boy)\b', d):
        return 'm'
    return None


# ------------------------------------------------------------------------------------------ audio processing
def frame_rms(w: np.ndarray, sr: int, hop=0.01) -> tuple[np.ndarray, int]:
    n = int(sr * hop)
    k = len(w) // n
    if k == 0:
        return np.zeros(0), n
    return np.sqrt(np.mean(w[:k * n].reshape(k, n) ** 2, axis=1) + 1e-12), n


def silence_threshold(rms: np.ndarray, db=-40.0) -> float:
    return max(float(np.percentile(rms, 95)) * 10 ** (db / 20), 3e-4) if len(rms) else 3e-4


def trim_silence(w: np.ndarray, sr: int, lead=0.06, tail=0.14, squash=True) -> np.ndarray:
    """Trim leading/trailing silence (+ short pads), shorten internal pauses > MAX_PAUSE, 8 ms fades."""
    w = np.nan_to_num(w.astype(np.float32))
    rms, hop = frame_rms(w, sr)
    if not len(rms):
        return w
    thr = silence_threshold(rms)
    loud = np.where(rms > thr)[0]
    if not len(loud):
        return w[:0]
    s = max(0, loud[0] * hop - int(lead * sr))
    e = min(len(w), (loud[-1] + 1) * hop + int(tail * sr))
    if squash:
        keep, cut_from = [], s
        quiet = rms <= thr
        i = loud[0]
        while i <= loud[-1]:
            if quiet[i]:
                j = i
                while j <= loud[-1] and quiet[j]:
                    j += 1
                if (j - i) * hop > MAX_PAUSE * sr:
                    half = int(KEEP_PAUSE * sr / 2)
                    a, b = i * hop + half, j * hop - half
                    keep.append((cut_from, a))
                    cut_from = b
                i = j
            else:
                i += 1
        keep.append((cut_from, e))
        xf = int(0.005 * sr)
        out = w[keep[0][0]:keep[0][1]].copy()
        for a, b in keep[1:]:
            seg = w[a:b].copy()
            if len(out) > xf and len(seg) > xf:
                ramp = np.linspace(0, 1, xf, dtype=np.float32)
                out[-xf:] = out[-xf:] * (1 - ramp) + seg[:xf] * ramp
                seg = seg[xf:]
            out = np.concatenate([out, seg])
    else:
        out = w[s:e].copy()
    f = min(int(0.008 * sr), len(out) // 4)
    if f > 0:
        out[:f] *= np.linspace(0, 1, f, dtype=np.float32)
        out[-f:] *= np.linspace(1, 0, f, dtype=np.float32)
    return out


def longest_pause(w: np.ndarray, sr: int) -> float:
    rms, hop = frame_rms(w, sr)
    if not len(rms):
        return 0.0
    quiet = rms <= silence_threshold(rms)
    best = run = 0
    for q in quiet:
        run = run + 1 if q else 0
        best = max(best, run)
    return best * hop / sr


def median_f0(w: np.ndarray, sr: int) -> float:
    import librosa
    y = librosa.resample(w, orig_sr=sr, target_sr=16000)
    f0, voiced, _ = librosa.pyin(y, fmin=60, fmax=500, sr=16000, frame_length=1024)
    f0 = f0[voiced] if voiced is not None else f0
    f0 = f0[np.isfinite(f0)]
    return float(np.median(f0)) if len(f0) else float('nan')


def fx_chain(char: str) -> str:
    return RADIO_FX.get(char, BASE_FX)


def encode_mp3(w: np.ndarray, sr: int, char: str, out_mp3: Path) -> dict:
    """Write w through fx + loudness normalisation to out_mp3 (atomic). Returns loudness info."""
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    src = TMP_DIR / (out_mp3.stem + '.wav')
    sf.write(src, w, sr, subtype='FLOAT')
    pre = fx_chain(char)
    # pass 1: measure integrated loudness after the fx chain
    r = subprocess.run([FFMPEG, '-hide_banner', '-nostats', '-i', str(src), '-af',
                        f'{pre},loudnorm=I={TARGET_LUFS}:TP={PEAK_LIMIT_DB}:LRA=20:print_format=json',
                        '-f', 'null', '-'], capture_output=True, text=True)
    blocks = re.findall(r'\{[^{}]*\}', r.stderr)
    measured = None
    if r.returncode == 0 and blocks:
        try:
            measured = float(json.loads(blocks[-1])['input_i'])
        except (ValueError, KeyError):
            measured = None
    if measured is not None and math.isfinite(measured) and measured > -70:
        gain = TARGET_LUFS - measured
    else:  # too short / too quiet for BS.1770 gating: plain RMS normalisation to ~-19 dBFS
        rms = float(np.sqrt(np.mean(w ** 2)) + 1e-9)
        gain = -19.0 - 20 * math.log10(rms)
    gain = float(np.clip(gain, -20, 30))
    limit = 10 ** (PEAK_LIMIT_DB / 20)
    af = (f'{pre},volume={gain:.2f}dB,'
          f'alimiter=limit={limit:.4f}:attack=2:release=60:level=0:latency=1,aresample={MP3_RATE}')
    tmp = out_mp3.with_name(out_mp3.stem + '.tmp.mp3')
    r = subprocess.run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', '-i', str(src), '-af', af,
                        '-ac', '1', '-ar', str(MP3_RATE), '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE,
                        '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', str(tmp)],
                       capture_output=True, text=True)
    src.unlink(missing_ok=True)
    if r.returncode != 0:
        raise RuntimeError(f'ffmpeg encode failed for {out_mp3.name}: {r.stderr[-500:]}')
    os.replace(tmp, out_mp3)
    return {'measured_lufs': None if measured is None else round(measured, 2), 'gain_db': round(gain, 2)}


# ------------------------------------------------------------------------------------------------- models
def pick_device(arg: str) -> str:
    import torch
    if arg != 'auto':
        return arg
    if torch.cuda.is_available():
        return 'cuda:0'
    if torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def pick_dtype(arg: str, device: str):
    import torch
    if arg == 'auto':
        return torch.float32 if device == 'cpu' else torch.bfloat16
    return {'bf16': torch.bfloat16, 'fp16': torch.float16, 'fp32': torch.float32}[arg]


def snapshot(repo: str, **kw) -> str:
    from huggingface_hub import snapshot_download
    try:
        return snapshot_download(repo, local_files_only=True, **kw)
    except Exception:
        log(f'  downloading {repo} -> {os.environ["HF_HOME"]}')
        return snapshot_download(repo, **kw)


def quiet_transformers():
    from transformers.utils import logging as tlog
    tlog.set_verbosity_error()
    logging.getLogger('transformers').setLevel(logging.ERROR)


def load_tts(repo: str, device: str, dtype):
    with contextlib.redirect_stdout(io.StringIO()):   # qwen_tts prints a SoX notice on import
        from qwen_tts import Qwen3TTSModel
    quiet_transformers()
    path = snapshot(repo)
    t = time.time()
    try:
        m = Qwen3TTSModel.from_pretrained(path, device_map=device, dtype=dtype, attn_implementation='sdpa')
    except Exception as e:  # pragma: no cover - attention backend not available
        log(f'  sdpa load failed ({e}); retrying with default attention')
        m = Qwen3TTSModel.from_pretrained(path, device_map=device, dtype=dtype)
    log(f'  loaded {repo} on {device} ({str(dtype).replace("torch.", "")}) in {time.time() - t:.1f}s')
    return m


def free():
    import torch
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def sync(device: str):
    import torch
    if device.startswith('mps'):
        torch.mps.synchronize()
    elif device.startswith('cuda'):
        torch.cuda.synchronize()


class ASR:
    """Whisper transcription used as an intelligibility gate (catches garbled / skipped / extra words)."""

    def __init__(self, device: str):
        import torch
        from transformers import WhisperForConditionalGeneration, WhisperProcessor
        quiet_transformers()
        path = snapshot(ASR_REPO, allow_patterns=['*.json', '*.safetensors', '*.txt', '*.model'])
        self.device = device
        self.dtype = torch.float32 if device == 'cpu' else torch.float16
        self.proc = WhisperProcessor.from_pretrained(path)
        self.model = WhisperForConditionalGeneration.from_pretrained(path, dtype=self.dtype).to(device).eval()
        log(f'  loaded {ASR_REPO} on {device}')

    def __call__(self, wavs: list[np.ndarray], sr: int) -> list[str]:
        import librosa
        import torch
        ys = [librosa.resample(w.astype(np.float32), orig_sr=sr, target_sr=16000) if len(w) else
              np.zeros(1600, np.float32) for w in wavs]
        feats = self.proc(ys, sampling_rate=16000, return_tensors='pt').input_features.to(self.device, self.dtype)
        with torch.inference_mode():
            ids = self.model.generate(feats, language='en', task='transcribe')
        return [t.strip() for t in self.proc.batch_decode(ids, skip_special_tokens=True)]


# ------------------------------------------------------------------------------------------- references
def ref_paths(char: str) -> tuple[Path, Path, Path]:
    return REF_DIR / f'{char}.wav', REF_DIR / f'{char}.txt', REF_DIR / f'{char}.json'


def ref_is_current(char: str, voice: str) -> bool:
    wav, txt, meta = ref_paths(char)
    return wav.exists() and txt.exists() and load_json(meta, {}).get('ref_hash') == ref_hash(voice)


def check_ref(w: np.ndarray, sr: int, voice: str, asr) -> dict:
    dur = len(w) / sr
    finite = bool(np.isfinite(w).all())
    rms = float(np.sqrt(np.mean(w ** 2))) if len(w) else 0.0
    peak = float(np.abs(w).max()) if len(w) else 0.0
    clip = float(np.mean(np.abs(w) > 0.99)) if len(w) else 0.0
    pause = longest_pause(w, sr)
    f0 = median_f0(w, sr) if finite and len(w) else float('nan')
    sex = gender_of(voice)
    problems = []
    if not finite:
        problems.append('nan')
    if not 7.0 <= dur <= 19.0:
        problems.append(f'duration {dur:.1f}s')
    if rms < 0.02:
        problems.append(f'rms {rms:.3f}')
    if clip > 0.001:
        problems.append(f'clipping {clip:.2%}')
    if pause > 1.5:
        problems.append(f'pause {pause:.1f}s')
    if sex == 'm' and not (f0 <= 170):
        problems.append(f'f0 {f0:.0f}Hz for male voice')
    if sex == 'f' and not (f0 >= 145):
        problems.append(f'f0 {f0:.0f}Hz for female voice')
    # how far the pitch is outside the expected range (Hz); used to rank candidates that all fail
    f0_excess = 0.0 if math.isnan(f0) else max(0.0, f0 - 170) if sex == 'm' else max(0.0, 145 - f0) if sex == 'f' else 0.0
    hyp, errs, n = None, 0, len(norm_words(REF_TEXT))
    if asr is not None and finite and len(w):
        hyp = asr([w], sr)[0]
        errs, n = word_errors(REF_TEXT, hyp)
        if errs > max(1, round(0.1 * n)):
            problems.append(f'asr {errs}/{n} words wrong')
    return {'duration': round(dur, 2), 'rms': round(rms, 4), 'peak': round(peak, 3), 'clip': clip,
            'longest_pause': round(pause, 2), 'f0_median': None if math.isnan(f0) else round(f0, 1),
            'gender': sex, 'f0_excess': round(f0_excess, 1), 'asr': hyp, 'asr_errors': errs,
            'problems': problems, 'ok': not problems}


def build_ref(design, char: str, voice: str, asr, attempts: int, device: str) -> dict:
    import torch
    REF_DIR.mkdir(parents=True, exist_ok=True)
    best = None
    for a in range(attempts):
        torch.manual_seed(seed_for('ref', char, a))
        t = time.time()
        wavs, sr = design.generate_voice_design(text=REF_TEXT, instruct=voice, language=LANGUAGE,
                                                max_new_tokens=400)
        sync(device)
        w = trim_silence(wavs[0], sr, lead=0.05, tail=0.3, squash=False)
        m = check_ref(w, sr, voice, asr)
        m['gen_s'] = round(time.time() - t, 2)
        log(f'    {char:<9} take {a + 1}: {m["duration"]:5.1f}s rms {m["rms"]:.3f} f0 {m["f0_median"]}Hz '
            f'asr-err {m["asr_errors"]}  {"OK" if m["ok"] else "; ".join(m["problems"])}  ({m["gen_s"]:.1f}s)')
        key = (len(m['problems']), m['asr_errors'], m['f0_excess'])
        if best is None or key < best[0]:
            best = (key, w, sr, m)
        if m['ok']:
            break
    _, w, sr, m = best
    if not m['ok']:
        log(f'    ! {char}: no candidate passed every check; keeping the best one ({"; ".join(m["problems"])})')
    wav, txt, meta = ref_paths(char)
    sf.write(wav, w, sr, subtype='PCM_16')
    txt.write_text(REF_TEXT + '\n')
    write_json(meta, {**m, 'char': char, 'voice': voice, 'ref_hash': ref_hash(voice), 'model': DESIGN_REPO,
                      'sr': sr})
    return m


def similarity_report(base, chars: list[str]) -> dict:
    """Pairwise similarity of the reference voices: cosine of mean-centred Qwen3-TTS speaker embeddings.

    Raw embeddings share a large common component (every pair scores ~0.98), so the cast mean is removed
    first. Calibration on this model: two clips of the same voice score ~0.65-0.70, so a pair of different
    characters above SIMILAR_VOICES is flagged as probably hard to tell apart.
    """
    import librosa
    embs = {}
    sr_enc = base.model.speaker_encoder_sample_rate
    for c in chars:
        wav = ref_paths(c)[0]
        if not wav.exists():
            continue
        w, sr = sf.read(wav, dtype='float32')
        if sr != sr_enc:
            w = librosa.resample(w, orig_sr=sr, target_sr=sr_enc)
        embs[c] = base.model.extract_speaker_embedding(audio=w, sr=sr_enc).float().cpu().numpy().ravel()
    names = sorted(embs)
    if len(names) < 3:
        return {}
    X = np.stack([embs[n] for n in names])
    X = X - X.mean(0)
    X /= np.linalg.norm(X, axis=1, keepdims=True) + 1e-9
    S = X @ X.T
    sim = {a: {b: round(float(S[i, j]), 3) for j, b in enumerate(names) if j != i} for i, a in enumerate(names)}
    log('  reference distinctness (centred speaker-embedding cosine; same voice ~0.7, lower = more distinct):')
    for a in names:
        b = max(sim[a], key=sim[a].get)
        flag = '   <-- similar' if sim[a][b] > SIMILAR_VOICES else ''
        log(f'    {a:<9} f0 {load_json(ref_paths(a)[2], {}).get("f0_median")!s:>6}Hz  nearest {b:<9} {sim[a][b]:+.2f}{flag}')
    write_json(REF_DIR / 'similarity.json', sim)
    return sim


# ----------------------------------------------------------------------------------------------- lines
def check_line(text: str, w: np.ndarray, sr: int, hyp: str | None) -> dict:
    n = max(1, len(norm_words(text)))
    dur = len(w) / sr
    finite = bool(np.isfinite(w).all())
    rms = float(np.sqrt(np.mean(w ** 2))) if len(w) else 0.0
    wps = n / dur if dur > 0 else 0.0
    problems = []
    if not finite:
        problems.append('nan')
    if dur < 0.3:
        problems.append('empty')
    if rms < 0.005:
        problems.append(f'rms {rms:.4f}')
    lo, hi = (1.3, 5.0) if n >= 4 else (0.4, 6.0)
    if not lo <= wps <= hi:
        problems.append(f'rate {wps:.1f}wps')
    errs = 0
    if hyp is not None:
        errs, n = word_errors(text, hyp)
        n = max(1, n)
        if errs > max(1, round(0.15 * n)):
            problems.append(f'asr {errs}/{n}')
    return {'duration': round(dur, 2), 'words': n, 'wps': round(wps, 2), 'rms': round(rms, 4),
            'asr': hyp, 'asr_errors': errs, 'wer': round(errs / n, 3), 'problems': problems,
            'ok': not problems, 'score': (len(problems), errs, abs(wps - 2.8))}


def synthesize(model, mode: str, items: list[dict], prompts: dict, cast: dict, seed: int, device: str):
    import torch
    texts = [it['text'] for it in items]
    max_words = max(len(norm_words(t)) for t in texts)
    max_new = int(min(2048, 48 + 14 * max_words))   # ~0.9 words/s floor: stops runaway generations early
    torch.manual_seed(seed)
    if mode == 'clone':
        wavs, sr = model.generate_voice_clone(text=texts, language=[LANGUAGE] * len(texts),
                                              voice_clone_prompt=[prompts[it['char']] for it in items],
                                              max_new_tokens=max_new)
    else:
        wavs, sr = model.generate_voice_design(text=texts, language=[LANGUAGE] * len(texts),
                                               instruct=[cast[it['char']]['voice'] for it in items],
                                               max_new_tokens=max_new)
    sync(device)
    return wavs, sr


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ------------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', help='comma-separated line ids (fnmatch patterns ok, e.g. c1m1_*)')
    ap.add_argument('--chars', help='comma-separated cast ids')
    ap.add_argument('--limit', type=int, help='generate at most N lines this run')
    ap.add_argument('--force', action='store_true', help='regenerate selected lines even if unchanged')
    ap.add_argument('--redo-refs', action='store_true', help='rebuild reference voices of the selected characters')
    ap.add_argument('--refs-only', action='store_true', help='only build references (+ distinctness report)')
    ap.add_argument('--reprocess', action='store_true', help='re-run post-processing/encoding from raw takes')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--mode', choices=['clone', 'design'], default='clone',
                    help='clone (Base model, consistent voice; default) or design (VoiceDesign per line)')
    ap.add_argument('--base', choices=sorted(BASE_REPOS), default='1.7b', help='Base model size for cloning')
    ap.add_argument('--device', default='auto', help='auto|mps|cpu|cuda:0')
    ap.add_argument('--dtype', default='auto', choices=['auto', 'bf16', 'fp16', 'fp32'])
    ap.add_argument('--batch', type=int, default=4, help='lines per generate() call (same character)')
    ap.add_argument('--attempts', type=int, default=LINE_ATTEMPTS, help='max takes per line')
    ap.add_argument('--ref-attempts', type=int, default=REF_ATTEMPTS)
    ap.add_argument('--no-asr', action='store_true', help='skip the Whisper intelligibility check')
    args = ap.parse_args()

    # 1. story
    r = subprocess.run([NODE, str(ROOT / 'tools' / 'dump_lines.mjs')], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'dump_lines.mjs failed:\n{r.stderr}')
    story = json.loads(r.stdout)
    cast, lines = story['cast'], story['lines']
    complete = not story['importErrors']
    for e in story['importErrors']:
        log(f'! import failed (its lines are kept as-is, pruning disabled): {e}')
    for wmsg in story['warnings']:
        log(f'! {wmsg}')
    log(f'story: {len(lines)} lines from {", ".join(story["files"])}; {len(cast)} cast members')

    hashes = {i: line_hash(c, t, cast.get(c, {}).get('voice', '')) for i, (c, t) in lines.items()}
    cache = load_json(CACHE, {})
    report = load_json(REPORT, {})
    old_manifest = load_json(MANIFEST, {})
    VOICE_DIR.mkdir(parents=True, exist_ok=True)

    # 2. prune lines that no longer exist (only when every chapter imported cleanly)
    if complete:
        known = {p.stem for p in VOICE_DIR.glob('*.mp3')} | {p.stem for p in RAW_DIR.glob('*.flac')}
        gone = sorted(g for g in known | set(cache) | set(old_manifest) | set(report) if g not in lines)
        if gone:
            log(f'{"would prune" if args.dry_run else "pruned"} {len(gone)} removed line(s): '
                f'{", ".join(gone[:12])}{" ..." if len(gone) > 12 else ""}')
        if not args.dry_run:
            for g in gone:
                (VOICE_DIR / f'{g}.mp3').unlink(missing_ok=True)
                (RAW_DIR / f'{g}.flac').unlink(missing_ok=True)
                cache.pop(g, None)
                report.pop(g, None)

    def current_manifest():
        m = {i: f'{i}.mp3' for i in lines if cache.get(i) == hashes[i] and (VOICE_DIR / f'{i}.mp3').exists()}
        if not complete:  # keep audio for chapters that failed to import this run
            m.update({i: f for i, f in old_manifest.items() if i not in lines and (VOICE_DIR / f).exists()})
        return m

    def save_state():
        write_json(CACHE, cache)
        write_json(REPORT, report)
        write_json(MANIFEST, current_manifest())

    if not args.dry_run:
        save_state()

    # 3. selection
    only = [p.strip() for p in (args.only or '').split(',') if p.strip()]
    chars = [c.strip() for c in (args.chars or '').split(',') if c.strip()]
    for c in chars:
        if c not in cast:
            sys.exit(f'unknown character {c!r}; cast: {", ".join(cast)}')
    selected = [i for i, (c, _) in lines.items()
                if (not only or any(fnmatch.fnmatchcase(i, p) for p in only)) and (not chars or c in chars)]
    skipped_cast = sorted({lines[i][0] for i in selected if not cast.get(lines[i][0], {}).get('voice')})
    if skipped_cast:
        log(f'! no cast voice for {", ".join(skipped_cast)}: their lines are skipped')
    selected = [i for i in selected if lines[i][0] not in skipped_cast]

    if args.reprocess:
        n = 0
        for i in selected:
            raw = RAW_DIR / f'{i}.flac'
            if cache.get(i) != hashes[i] or not raw.exists():
                continue
            w, sr = sf.read(raw, dtype='float32')
            info = encode_mp3(trim_silence(w, sr), sr, lines[i][0], VOICE_DIR / f'{i}.mp3')
            report.setdefault(i, {}).update(info)
            n += 1
        save_state()
        log(f'reprocessed {n} line(s) from build/voices/raw')
        return

    todo = [i for i in selected
            if args.force or cache.get(i) != hashes[i] or not (VOICE_DIR / f'{i}.mp3').exists()]
    if args.limit is not None:
        todo = todo[:args.limit]
    ref_chars = sorted(set(chars or cast) if args.refs_only else {lines[i][0] for i in todo})
    ref_chars = [c for c in ref_chars if cast.get(c, {}).get('voice')]
    need_refs = [c for c in ref_chars
                 if args.mode == 'clone' and (args.redo_refs or not ref_is_current(c, cast[c]['voice']))]
    log(f'selected {len(selected)} line(s); {len(todo)} to generate, {len(selected) - len(todo)} up to date; '
        f'references to build: {", ".join(need_refs) or "none"}')
    if args.dry_run:
        for i in todo:
            log(f'  {i:<10} {lines[i][0]:<9} {lines[i][1]}')
        return
    if not todo and not need_refs and not args.refs_only:
        log(f'nothing to do. manifest: {len(current_manifest())} lines')
        return

    # 4. models
    import torch
    device = pick_device(args.device)
    dtype = pick_dtype(args.dtype, device)
    log(f'device {device}, dtype {str(dtype).replace("torch.", "")}, mode {args.mode}, torch {torch.__version__}')
    asr = None if args.no_asr else ASR(device)

    if need_refs:
        log(f'building {len(need_refs)} reference voice(s) with {DESIGN_REPO}')
        design = load_tts(DESIGN_REPO, device, dtype)
        for c in need_refs:
            build_ref(design, c, cast[c]['voice'], asr, args.ref_attempts, device)
        design = None
        free()

    if args.mode == 'clone':
        model = load_tts(BASE_REPOS[args.base], device, dtype)
        if need_refs or args.refs_only:
            similarity_report(model, sorted(c for c in cast if ref_paths(c)[0].exists()))
        if args.refs_only:
            return
        prompts = {}
        for c in sorted({lines[i][0] for i in todo}):
            w, sr = sf.read(ref_paths(c)[0], dtype='float32')
            prompts[c] = model.create_voice_clone_prompt(ref_audio=(w, sr), ref_text=REF_TEXT,
                                                         x_vector_only_mode=False)[0]
    else:
        if args.refs_only:
            return
        model = load_tts(DESIGN_REPO, device, dtype)
        prompts = {}

    # 5. lines: batch per character, similar lengths together
    by_char: dict[str, list[str]] = {}
    for i in todo:
        by_char.setdefault(lines[i][0], []).append(i)
    batches = []
    for c, ids in by_char.items():
        ids = sorted(ids, key=lambda i: len(lines[i][1]))
        batches += [[{'id': i, 'char': c, 'text': lines[i][1]} for i in b] for b in chunked(ids, args.batch)]

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    done, gen_total, audio_total, retried, failed = 0, 0.0, 0.0, 0, []
    t_run = time.time()
    log(f'generating {len(todo)} line(s) in {len(batches)} batch(es) of <= {args.batch}')
    try:
        for batch in batches:
            best: dict[str, dict] = {}
            gen_time = {it['id']: 0.0 for it in batch}
            pending = batch
            for attempt in range(args.attempts):
                if not pending:
                    break
                t = time.time()
                wavs, sr = synthesize(model, args.mode, pending, prompts, cast,
                                      seed_for(pending[0]['id'], attempt), device)
                dt = time.time() - t
                takes = [trim_silence(w, sr) for w in wavs]
                hyps = asr(takes, sr) if asr is not None else [None] * len(takes)
                for it, raw, take, hyp in zip(pending, wavs, takes, hyps):
                    gen_time[it['id']] += dt / len(pending)
                    m = check_line(it['text'], take, sr, hyp)
                    m['attempt'] = attempt + 1
                    if it['id'] not in best or m['score'] < best[it['id']]['m']['score']:
                        best[it['id']] = {'m': m, 'raw': raw, 'take': take, 'sr': sr}
                if attempt + 1 < args.attempts:
                    redo = [it for it in pending if not best[it['id']]['m']['ok']]
                    retried += len(redo)
                    pending = redo
            for it in batch:
                b = best[it['id']]
                m, sr = b['m'], b['sr']
                sf.write(RAW_DIR / f'{it["id"]}.flac', np.nan_to_num(b['raw']).astype(np.float32), sr)
                mp3 = VOICE_DIR / f'{it["id"]}.mp3'
                info = encode_mp3(b['take'], sr, it['char'], mp3)
                cache[it['id']] = hashes[it['id']]
                m.pop('score')
                report[it['id']] = {**m, **info, 'char': it['char'], 'text': it['text'],
                                    'gen_s': round(gen_time[it['id']], 2), 'mode': args.mode,
                                    'kb': round(mp3.stat().st_size / 1024, 1)}
                done += 1
                gen_total += gen_time[it['id']]
                audio_total += m['duration']
                if not m['ok']:
                    failed.append(it['id'])
                log(f'[{done:>3}/{len(todo)}] {it["id"]:<10} {it["char"]:<9} {m["words"]:>3}w {m["duration"]:5.2f}s '
                    f'{m["wps"]:4.1f}w/s wer {m["wer"]:.2f} take {m["attempt"]} gen {gen_time[it["id"]]:4.1f}s '
                    f'{report[it["id"]]["kb"]:5.1f}KB{"  ! " + "; ".join(m["problems"]) if m["problems"] else ""}')
            save_state()
    except KeyboardInterrupt:
        save_state()
        log('\ninterrupted: manifest/cache saved after the last completed batch')
        sys.exit(130)

    wall = time.time() - t_run
    manifest = current_manifest()
    size = sum((VOICE_DIR / f).stat().st_size for f in manifest.values() if (VOICE_DIR / f).exists())
    log('')
    log(f'done: {done} line(s), {audio_total:.1f}s of audio; TTS {gen_total:.1f}s '
        f'({gen_total / max(done, 1):.2f} s/line, RTF {gen_total / max(audio_total, 1e-9):.2f}); '
        f'wall {wall:.1f}s ({wall / max(done, 1):.2f} s/line incl. ASR + encode); '
        f'{retried} re-take(s)')
    if done:
        log(f'estimate for 500 lines: ~{wall / done * 500 / 60:.0f} min')
    if failed:
        log(f'! {len(failed)} line(s) kept a take that failed checks (see build/voices/report.json): '
            f'{", ".join(failed)}')
    log(f'manifest: {len(manifest)} lines, assets/voice total {size / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()

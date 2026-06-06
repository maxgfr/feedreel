#!/usr/bin/env python3
"""
Piper TTS wrapper for feedreel ("piper" engine, MIT, ONNX — no PyTorch).

Same contract as scripts/tts.py (kokoro): called by src/pipeline/tts.ts via
subprocess with the Python of the .venv-piper venv.

Batch mode (recommended):  tts_piper.py --manifest manifest.json
  manifest = {
    "voice": "fr_FR-upmc-medium#1",   # model name, "#<index>" = speaker (multi-voice)
    "language": "fr",                 # informational (the model is already language-specific)
    "segments": [ {"text": "...", "out": "/abs/seg-00.wav"}, ... ]
  }

Stdout output (strict JSON):
  {"results": [ {"out": "...", "duration": 2.31, "sample_rate": 22050}, ... ]}

The model is resolved at <root>/voices/<name>.onnx (+ .onnx.json).
All traces go to stderr; stdout contains ONLY the result JSON.
"""
import argparse
import json
import os
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICES_DIR = ROOT / "voices"


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


def parse_voice(voice: str):
    """ "fr_FR-upmc-medium#1" -> ("fr_FR-upmc-medium", 1); without '#': speaker None. """
    if "#" in voice:
        name, _, spk = voice.partition("#")
        try:
            return name, int(spk)
        except ValueError:
            return name, None
    return voice, None


def wav_duration(path: str) -> tuple[float, int]:
    with wave.open(path, "rb") as w:
        rate = w.getframerate()
        frames = w.getnframes()
        return (frames / rate if rate else 0.0), rate


def main() -> int:
    ap = argparse.ArgumentParser(description="Piper TTS wrapper (batch).")
    ap.add_argument("--manifest")
    ap.add_argument("--text")
    ap.add_argument("--out")
    ap.add_argument("--voice", default="fr_FR-upmc-medium")
    args = ap.parse_args()

    if args.manifest:
        with open(args.manifest, encoding="utf-8") as f:
            cfg = json.load(f)
        voice = cfg.get("voice", args.voice)
        segments = cfg.get("segments", [])
    else:
        if not args.text or not args.out:
            ap.error("--text and --out required without --manifest")
        voice = args.voice
        segments = [{"text": args.text, "out": args.out}]

    if not segments:
        json.dump({"results": []}, sys.stdout)
        return 0

    model_name, speaker_id = parse_voice(voice)
    model_path = VOICES_DIR / f"{model_name}.onnx"
    config_path = VOICES_DIR / f"{model_name}.onnx.json"
    if not model_path.exists():
        eprint(f"[piper] model not found: {model_path}")
        return 2

    from piper import PiperVoice
    from piper.config import SynthesisConfig

    eprint(f"[piper] loading {model_name} (speaker={speaker_id})…")
    pv = PiperVoice.load(str(model_path), config_path=str(config_path) if config_path.exists() else None)
    syn = SynthesisConfig(speaker_id=speaker_id) if speaker_id is not None else None

    results = []
    for i, seg in enumerate(segments):
        out = seg["out"]
        text = (seg.get("text") or "").strip()
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        if not text:
            eprint(f"[piper] segment {i}: empty text, skipped")
            continue
        with wave.open(out, "wb") as wf:
            pv.synthesize_wav(text, wf, syn_config=syn)
        dur, rate = wav_duration(out)
        results.append({"out": out, "duration": dur, "sample_rate": rate})
        eprint(f"[piper] segment {i}: {dur:.2f}s -> {out}")

    json.dump({"results": results}, sys.stdout)
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())

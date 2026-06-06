#!/usr/bin/env python3
"""
Kokoro-MLX TTS wrapper for feedreel.

Designed to be called by the Node module `src/pipeline/tts.ts` via subprocess,
using the Python of the dedicated venv (.venv/bin/python).

Two modes:
  1. Single segment:   tts.py --text "..." --out path.wav [--voice ff_siwis] [--language fr]
  2. Batch (recommended): tts.py --manifest manifest.json
     The model is loaded ONLY ONCE for the whole video (RAM/time efficient).

Manifest JSON format:
  {
    "voice": "ff_siwis", "language": "fr", "sample_rate": 24000, "speed": 1.0,
    "model": null,
    "segments": [ {"text": "Hello.", "out": "/abs/seg-00.wav"}, ... ]
  }

Output (stdout, strict JSON):
  {"results": [ {"out": "...", "duration": 2.31, "sample_rate": 24000}, ... ]}

All traces (download progress, warnings) go to stderr;
stdout contains ONLY the result JSON.
"""
import argparse
import json
import os
import sys


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="Kokoro-MLX TTS wrapper.")
    ap.add_argument("--manifest", help="JSON file describing the segments (batch mode).")
    ap.add_argument("--text", help="Text to synthesize (single-segment mode).")
    ap.add_argument("--out", help="Output WAV path (single-segment mode).")
    ap.add_argument("--voice", default="ff_siwis")
    ap.add_argument("--language", default="fr")
    ap.add_argument("--sample-rate", type=int, default=24000, dest="sample_rate")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--model", default=None, help="HuggingFace model_id_or_path (package default).")
    args = ap.parse_args()

    if args.manifest:
        with open(args.manifest, encoding="utf-8") as f:
            cfg = json.load(f)
        voice = cfg.get("voice", args.voice)
        language = cfg.get("language", args.language)
        sample_rate = int(cfg.get("sample_rate", args.sample_rate))
        speed = float(cfg.get("speed", args.speed))
        model = cfg.get("model", args.model)
        segments = cfg.get("segments", [])
    else:
        if not args.text or not args.out:
            ap.error("--text and --out are required without --manifest")
        voice, language = args.voice, args.language
        sample_rate, speed, model = args.sample_rate, args.speed, args.model
        segments = [{"text": args.text, "out": args.out}]

    if not segments:
        json.dump({"results": []}, sys.stdout)
        return 0

    eprint(f"[tts] loading the Kokoro-MLX model (voice={voice}, lang={language})…")
    from kokoro_mlx import KokoroTTS  # late import: download messages on stderr

    tts = KokoroTTS.from_pretrained(model) if model else KokoroTTS.from_pretrained()

    results = []
    for i, seg in enumerate(segments):
        out = seg["out"]
        text = (seg.get("text") or "").strip()
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        if not text:
            # Empty segment: skip cleanly (Node handles the missing duration).
            eprint(f"[tts] segment {i}: empty text, skipped")
            continue
        res = tts.save(text, out, voice=voice, speed=speed, sample_rate=sample_rate, language=language)
        results.append(
            {"out": out, "duration": float(res.duration), "sample_rate": int(res.sample_rate)}
        )
        eprint(f"[tts] segment {i}: {res.duration:.2f}s -> {out}")

    json.dump({"results": results}, sys.stdout)
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())

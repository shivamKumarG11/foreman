"""Record the sandbox voicemail (T-4414) once with ElevenLabs text-to-speech.

The speaker is fictional ("Dana from Quick Freight"). The app later transcribes this audio
with ElevenLabs Scribe, so the crew hears it the way a real voicemail would arrive.

    uv run python scripts/make_voicemail.py
"""

from __future__ import annotations

import os

import httpx
from dotenv import load_dotenv

from foreman.voice import API, VOICEMAIL_AUDIO, VOICEMAIL_SCRIPT

load_dotenv()
key = os.environ["ELEVENLABS_API_KEY"]
voices = httpx.get(f"{API}/voices", headers={"xi-api-key": key}, timeout=30).json().get("voices", [])
# Prefer a premade female voice for the caller, so she sounds different from the Foreman.
pick = next((v for v in voices if (v.get("labels") or {}).get("gender") == "female"), voices[0] if voices else None)
voice_id = os.getenv("VOICEMAIL_VOICE_ID") or (pick or {}).get("voice_id")
print("voice:", (pick or {}).get("name"), voice_id)
r = httpx.post(
    f"{API}/text-to-speech/{voice_id}",
    params={"output_format": "mp3_44100_64"},
    headers={"xi-api-key": key},
    json={"text": VOICEMAIL_SCRIPT, "model_id": "eleven_multilingual_v2"},
    timeout=60,
)
r.raise_for_status()
VOICEMAIL_AUDIO.parent.mkdir(parents=True, exist_ok=True)
VOICEMAIL_AUDIO.write_bytes(r.content)
print("wrote", VOICEMAIL_AUDIO, len(r.content), "bytes")

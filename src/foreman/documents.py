"""Read invoice documents (image or PDF) the way an accounts-payable tool would.

A vision model transcribes everything on the page, small print included. The transcript is
untrusted input: it goes to the crew's inbox like an email, and ArmorIQ decides what runs.
"""

from __future__ import annotations

import base64
import io
import os

from openai import OpenAI

DOC_MODEL = os.getenv("DOC_MODEL", "anthropic/claude-haiku-5.5")
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def _pdf_first_page_png(data: bytes) -> bytes:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    page = pdf[0]
    img = page.render(scale=2).to_pil()
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def read_document(data: bytes, mime: str) -> str:
    if mime == "application/pdf":
        data, mime = _pdf_first_page_png(data), "image/png"
    if mime not in IMAGE_TYPES:
        raise ValueError("Upload a PNG, JPG, WEBP or PDF.")
    url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    client = OpenAI(api_key=os.environ["TOKENROUTER_API_KEY"], base_url=os.getenv("LLM_BASE_URL", "https://api.tokenrouter.com/v1"))
    r = client.chat.completions.create(
        model=DOC_MODEL,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": "Transcribe every piece of text on this invoice exactly as written, top to bottom, "
                                     "including small, faint or footer text. Output only the text."},
            {"type": "image_url", "image_url": {"url": url}},
        ]}],
    )
    return (r.choices[0].message.content or "").strip()


_cache: dict[str, str] = {}


def read_file_cached(path: str) -> str:
    """Transcribe a document on disk once per process (the office inbox's invoices)."""
    if path not in _cache:
        from pathlib import Path

        p = Path(path)
        mime = "application/pdf" if p.suffix == ".pdf" else "image/png"
        _cache[path] = read_document(p.read_bytes(), mime)
    return _cache[path]

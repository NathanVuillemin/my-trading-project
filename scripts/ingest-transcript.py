"""Save a transcript into inbox/ so the idea-researcher agent can read it.

Nathan listens to podcasts and watches videos; the ideas he writes down come from them. This script
fetches the words behind an episode and drops them in inbox/ as plain text, headed by source and URL.
inbox/ is git-ignored: transcripts are the publishers' material and stay on this machine.

Usage:
  python scripts/ingest-transcript.py <url-or-file> [--title "MacroVoices #558 Mike Alkin"] [--date YYYY-MM-DD]

Handles:
  - a PDF (URL or local file), e.g. a MacroVoices transcript
      (each episode page on macrovoices.com links "Download the podcast transcript")
  - a YouTube URL, via the youtube-transcript-api package (pip install youtube-transcript-api)
  - a .txt file (copied as is), e.g. a transcript pasted from elsewhere

Writes inbox/<date>-<slug>.txt and prints the path.
"""
import argparse, datetime, io, pathlib, re, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
INBOX = ROOT / "inbox"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read(), r.headers.get_content_type()


def pdf_text(data):
    import pypdf  # installed on this machine
    reader = pypdf.PdfReader(io.BytesIO(data))
    text = "\n".join(p.extract_text() or "" for p in reader.pages)
    text = re.sub(r"\s*Brought to you by Big Picture Trading Page \d+ of \d+\s*", "\n", text)  # MacroVoices footer
    return text


def youtube_text(url):
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    if not m:
        sys.exit("Could not find a video id in that YouTube URL.")
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        sys.exit("Needs the youtube-transcript-api package: pip install youtube-transcript-api")
    tr = YouTubeTranscriptApi().fetch(m.group(1), languages=["en", "en-GB", "en-US"])
    return " ".join(s.text for s in tr.snippets)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="URL or local file")
    ap.add_argument("--title", help="Name for the file header and file name")
    ap.add_argument("--date", default=datetime.date.today().isoformat(), help="Episode date, YYYY-MM-DD")
    a = ap.parse_args()

    src = a.source
    if re.match(r"https?://(www\.)?(youtube\.com|youtu\.be)/", src):
        text, kind = youtube_text(src), "YouTube"
    elif src.lower().startswith("http"):
        data, ctype = fetch(src)
        if "pdf" in ctype or src.lower().endswith(".pdf") or data[:4] == b"%PDF":
            text, kind = pdf_text(data), "PDF"
        else:
            text, kind = data.decode("utf-8", "replace"), "web"
    else:
        p = pathlib.Path(src)
        if not p.exists():
            sys.exit(f"No such file: {p}")
        text, kind = (pdf_text(p.read_bytes()), "PDF") if p.suffix.lower() == ".pdf" else (p.read_text("utf-8", "replace"), "text")

    text = re.sub(r"[ \t]+\n", "\n", text).strip()
    if len(text) < 200:
        sys.exit(f"Only {len(text)} characters came back; nothing saved.")
    title = a.title or pathlib.Path(src).stem
    INBOX.mkdir(exist_ok=True)
    out = INBOX / f"{a.date}-{slug(title)}.txt"
    out.write_text(f"Source: {title} ({kind})\nURL: {src}\nSaved: {datetime.date.today().isoformat()}\n\n{text}\n", "utf-8")
    print(f"{out}  ({len(text):,} chars)")


if __name__ == "__main__":
    main()

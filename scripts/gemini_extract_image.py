#!/usr/bin/env python3
"""Extract the first inlineData image from a Gemini generateContent response,
validate it decodes as an image, and write it to the output path.
Usage: gemini_extract_image.py <resp_json> <out_png>
Exit 0 on success, 1 on any failure (so the bash caller can fall back)."""
import json, base64, sys, io

def main():
    if len(sys.argv) != 3:
        print('usage: gemini_extract_image.py <resp_json> <out_png>'); return 1
    resp, out = sys.argv[1], sys.argv[2]
    try:
        d = json.load(open(resp))
    except Exception as e:
        print('parse-fail', e); return 1
    if 'error' in d:
        e = d['error']; print('api-error', e.get('code'), e.get('status'), e.get('message', '')[:120]); return 1
    raw = None
    for cand in d.get('candidates', []):
        for part in cand.get('content', {}).get('parts', []):
            if 'inlineData' in part:
                raw = base64.b64decode(part['inlineData']['data']); break
        if raw: break
    if not raw:
        print('no-image-in-response'); return 1
    try:
        from PIL import Image
        Image.open(io.BytesIO(raw)).verify()
    except Exception as e:
        print('not-a-valid-image', e); return 1
    # Gemini generateContent returns JPEG bytes. If the caller asked for a .png
    # path, RE-ENCODE to real PNG so the extension isn't a lie (strict PNG
    # loaders choked on JPEG-in-.png; 2026-07-09). For any other extension keep
    # the original bytes. verify() consumes the stream, so reopen a fresh one.
    try:
        if out.lower().endswith('.png'):
            im = Image.open(io.BytesIO(raw))
            if im.mode not in ('RGB', 'RGBA'):
                im = im.convert('RGB')
            im.save(out, format='PNG')
            print('wrote real PNG (re-encoded from', len(raw), 'src bytes)')
        else:
            open(out, 'wb').write(raw)
            print('wrote', len(raw), 'bytes')
    except Exception as e:
        print('encode-fail', e); return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())

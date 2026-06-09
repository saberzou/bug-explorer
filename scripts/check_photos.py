import json
import os
import pathlib

d = json.load(open("data/bug_photos.json"))
for slug in d:\n    for p in d[slug]:
        local = "public" + p["localPath"]
        status = "EXISTS" if os.path.exists(local) else "MISSING"
        print(slug, p["localPath"], "->", status)
print("---")
print("stray files in photos root:")
for f in pathlib.Path("public/bugs/photos").iterdir():
    if f.is_file():
        print("  ", f.name)

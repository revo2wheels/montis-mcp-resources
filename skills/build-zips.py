#!/usr/bin/env python3
"""Rebuild the six skill zips from the skill folders, so the zips always match SKILL.md.

Release steps: edit metadata.version and metadata.updated in <skill>/SKILL.md (and the
"Version ..." line under its title), run `python build-zips.py` from this folder, commit.
setup-claude.html on www.montis.icu reads the version from SKILL.md on GitHub.
The Claude zips leave out agents/ (openai.yaml is for the ChatGPT variant only).
The Gemini zips leave out agents/ and assets/ (icons), and the build stops if a file in one
is a type the Gemini app refuses (it takes .md, .txt, .pdf, .csv and the scripts .js, .py,
.sh, .ipynb; not .mjs). Gemini in Chrome takes no script files at all.
"""
import os, re, zipfile

ZIPS = {
    "montis-coaching": ("montis-coaching-claude-skill.zip", "montis-coaching-chatgpt-skill.zip", "montis-coaching-gemini-skill.zip"),
    "montis-plan-builder": ("montis-plan-builder-claude-skill.zip", "montis-plan-builder-chatgpt.zip", "montis-plan-builder-gemini-skill.zip"),
}
GEMINI_TYPES = {".md", ".txt", ".pdf", ".csv", ".js", ".py", ".sh", ".ipynb"}

os.chdir(os.path.dirname(os.path.abspath(__file__)))
for name, (claude_zip, chatgpt_zip, gemini_zip) in ZIPS.items():
    skill = open(f"{name}/SKILL.md", encoding="utf-8").read()
    ver = re.search(r'^\s*version:\s*"([^"]+)"', skill, re.M)
    upd = re.search(r'^\s*updated:\s*"([^"]+)"', skill, re.M)
    if not ver or not upd:
        raise SystemExit(f"{name}/SKILL.md: metadata.version and metadata.updated are required")
    if f"Version {ver.group(1)}, updated {upd.group(1)}" not in skill:
        raise SystemExit(f"{name}/SKILL.md: the 'Version ...' line under the title does not match the metadata")
    for z, skip in ((claude_zip, {"agents"}), (chatgpt_zip, set()), (gemini_zip, {"agents", "assets"})):
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _dirs, files in os.walk(name):
                parts = root.split(os.sep)
                if parts[1:2] and parts[1] in skip:
                    continue
                for f in sorted(files):
                    path = os.path.join(root, f)
                    if z == gemini_zip and os.path.splitext(f)[1].lower() not in GEMINI_TYPES:
                        raise SystemExit(f"{path}: the Gemini app refuses this file type")
                    zf.write(path, path.replace(os.sep, "/"))
        print(f"{z}: v{ver.group(1)} ({upd.group(1)}), {len(zipfile.ZipFile(z).namelist())} files")

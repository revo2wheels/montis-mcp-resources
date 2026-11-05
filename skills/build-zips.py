#!/usr/bin/env python3
"""Rebuild the four skill zips from the skill folders, so the zips always match SKILL.md.

Release steps: edit metadata.version and metadata.updated in <skill>/SKILL.md (and the
"Version ..." line under its title), run `python build-zips.py` from this folder, commit.
setup-claude.html on www.montis.icu reads the version from SKILL.md on GitHub.
The Claude zips leave out agents/ (openai.yaml is for the ChatGPT variant only).
"""
import os, re, zipfile

ZIPS = {
    "montis-coaching": ("montis-coaching-claude-skill.zip", "montis-coaching-chatgpt-skill.zip"),
    "montis-plan-builder": ("montis-plan-builder-claude-skill.zip", "montis-plan-builder-chatgpt.zip"),
}

os.chdir(os.path.dirname(os.path.abspath(__file__)))
for name, (claude_zip, chatgpt_zip) in ZIPS.items():
    skill = open(f"{name}/SKILL.md", encoding="utf-8").read()
    ver = re.search(r'^\s*version:\s*"([^"]+)"', skill, re.M)
    upd = re.search(r'^\s*updated:\s*"([^"]+)"', skill, re.M)
    if not ver or not upd:
        raise SystemExit(f"{name}/SKILL.md: metadata.version and metadata.updated are required")
    if f"Version {ver.group(1)}, updated {upd.group(1)}" not in skill:
        raise SystemExit(f"{name}/SKILL.md: the 'Version ...' line under the title does not match the metadata")
    for z, skip_agents in ((claude_zip, True), (chatgpt_zip, False)):
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _dirs, files in os.walk(name):
                parts = root.split(os.sep)
                if skip_agents and parts[1:2] == ["agents"]:
                    continue
                for f in sorted(files):
                    path = os.path.join(root, f)
                    zf.write(path, path.replace(os.sep, "/"))
        print(f"{z}: v{ver.group(1)} ({upd.group(1)}), {len(zipfile.ZipFile(z).namelist())} files")

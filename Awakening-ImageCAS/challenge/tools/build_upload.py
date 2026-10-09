#!/usr/bin/env python
"""Assemble the folder to upload to Altervista (FTP) from the exported data.

    python build_upload.py

Writes _workbench/altervista-upload/ostia/ :
    api.php                 (backend/api.php with a fresh random $SALT)
    data/.htaccess
    data/truth.php          (private)
    data/README_HOW_TO_CLEANUP.sh   (how to empty the leaderboard and the collected data)
    slices/<token>/...      (PNG stacks + meta.json of every case)
Hard links are used, so it takes no extra disk space. Run it again after build_truth.py / export_challenge.py to refresh.
Upload the folder `ostia` into the root of the Altervista site (see backend/README.md).
"""
import os, re, secrets, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WB = os.path.normpath(os.path.join(HERE, "..", "..", "_workbench"))
SRC = os.path.join(WB, "challenge-data")
DST = os.path.join(WB, "altervista-upload", "ostia")
BACK = os.path.normpath(os.path.join(HERE, "..", "backend"))


def link_or_copy(a, b):
    os.makedirs(os.path.dirname(b), exist_ok=True)
    if os.path.exists(b):
        os.remove(b)
    try:
        os.link(a, b)
    except OSError:
        shutil.copy2(a, b)


def main():
    if not os.path.exists(os.path.join(SRC, "truth.php")):
        sys.exit("truth.php not found: run build_truth.py first")
    old_salt = None
    prev = os.path.join(DST, "api.php")
    if os.path.exists(prev):                                             # keep the salt of an earlier upload (cooldown hashes stay valid)
        m = re.search(r"\$SALT\s*=\s*'([0-9a-f]{40,})'", open(prev).read())
        old_salt = m.group(1) if m else None
    salt = old_salt or secrets.token_hex(24)
    api = open(os.path.join(BACK, "api.php")).read()
    api, n = re.subn(r"\$SALT\s*=\s*'[^']*';", "$SALT            = '%s';" % salt, api, count=1)
    assert n == 1
    os.makedirs(DST, exist_ok=True)
    open(prev, "w").write(api)
    link_or_copy(os.path.join(BACK, "data", ".htaccess"), os.path.join(DST, "data", ".htaccess"))
    link_or_copy(os.path.join(BACK, "data", "README_HOW_TO_CLEANUP.sh"), os.path.join(DST, "data", "README_HOW_TO_CLEANUP.sh"))
    link_or_copy(os.path.join(SRC, "truth.php"), os.path.join(DST, "data", "truth.php"))
    count = size = 0
    for tok in sorted(os.listdir(SRC)):
        d = os.path.join(SRC, tok)
        if not os.path.isdir(d):
            continue
        for dp, _, fns in os.walk(d):
            for fn in fns:
                rel = os.path.relpath(os.path.join(dp, fn), SRC)
                link_or_copy(os.path.join(dp, fn), os.path.join(DST, "slices", rel))
                count += 1; size += os.path.getsize(os.path.join(dp, fn))
    print(f"ready: {DST}\n  {count} slice files, {size / 1e6:.0f} MB of slices (+ api.php, data/.htaccess, data/truth.php)")


if __name__ == "__main__":
    main()

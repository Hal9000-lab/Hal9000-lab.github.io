# Ostia Challenge: deploying on Altervista (plain PHP, no database)

## 1. Build the upload folder (local)
```bash
conda activate CLAUDE
cd Awakening-ImageCAS/challenge/tools
python build_truth.py        # only if the models/cases changed
python build_upload.py       # assembles _workbench/altervista-upload/ostia/  (random $SALT already set, hard links, no extra disk)
```

## 2. Upload (FTP: `ftp.shapire.altervista.org`, port 21, your Altervista login)
Upload the whole folder `_workbench/altervista-upload/ostia/` into the **root of the site** (the folder that holds your `index.html`). The folder name is free: the script finds its files with its own location, so you can rename it on the server (deployed name: `AwakeningImageCAS-challenge`, the only other place that knows it is `challenge/config.js`). You get:

```
<site root>/AwakeningImageCAS-challenge/api.php
<site root>/AwakeningImageCAS-challenge/data/.htaccess
<site root>/AwakeningImageCAS-challenge/data/truth.php           <- private
<site root>/AwakeningImageCAS-challenge/slices/<12-char token>/meta.json
<site root>/AwakeningImageCAS-challenge/slices/<12-char token>/axial/000.png ... 159.png
<site root>/AwakeningImageCAS-challenge/slices/<12-char token>/sagittal/000.png ... 223.png        (40 token folders, ~220 MB in total)
```
Do NOT upload `cases_map.json` or `truth.json`. The folder `ostia/data/` gets more files by itself (logs, sessions): it must be writable (default).

## 3. Check in the browser (site: `shapire.altervista.org`; also try the same addresses with `https://`, the app needs the https ones)
1. `https://shapire.altervista.org/AwakeningImageCAS-challenge/api.php?action=init` -> must show `{"tutorial":["..","..",".."],"demo":false}`.
   (If an ad/HTML is appended after the JSON the app still works, but tell me.)
2. `https://shapire.altervista.org/AwakeningImageCAS-challenge/data/truth.php` -> must show NOTHING (blank page or 403/404). If you see data, stop and tell me.
3. `https://shapire.altervista.org/AwakeningImageCAS-challenge/slices/<any token>/meta.json` -> must show a short JSON.

## 4. Give me back
* the exact address of the site (e.g. `https://shapire.altervista.org`) and the name of the folder if it is not `ostia`;
* the three results above (OK / what you saw);
* if the site uses another domain than `https://hal9000-lab.github.io` for the app (e.g. a custom domain), that domain.
`challenge/config.js` is already set to `MODE: "remote"`, `API_BASE: "https://shapire.altervista.org/AwakeningImageCAS-challenge/api.php"` and `DATA_BASE: "https://shapire.altervista.org/AwakeningImageCAS-challenge/slices/"`. Open `.../challenge/?mode=local` to run the page on the local data (`_workbench`) with a browser-only leaderboard instead of the server.

## What the server stores (inside `ostia/data/`, download by FTP any time; each file starts with a one-line php `exit` guard, then one JSON per line)
* `annotations.log.php`  every click of every run (RAS mm, time in ms, scrolls), including the ALCAPA volumes: the crowd-annotation data.
* `trials.log.php`       completed runs (the leaderboard).
* `sessions/`, `cool/`   run state and the 5-minute cooldown (hashed client/IP, never stored in clear).
Before the public launch, delete the test runs: `annotations.log.php`, `trials.log.php`, `sessions/*`, `cool/*`.
Add MedNeXt-B later: run `build_truth.py` + `build_upload.py` locally and re-upload `data/truth.php` only.

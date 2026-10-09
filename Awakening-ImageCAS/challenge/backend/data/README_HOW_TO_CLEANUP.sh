#!/bin/sh
# ============================================================================================================================
# README_HOW_TO_CLEANUP.sh   (Ostia Challenge, Altervista)
# Put this file in   AwakeningImageCAS-challenge/data/   (next to truth.php). It is not public: data/.htaccess denies web access.
#
# WHAT THE SERVER STORES (everything is inside this data/ folder)
#   annotations.log.php   every click of every run, incl. the ALCAPA volumes (the crowd-annotation data)
#   trials.log.php        the completed runs = the leaderboard
#   sessions/             one small file per started run (state of the run)
#   cool/                 the 5-minute cooldown markers and the per-address rate-limit counters (hashed, no raw IP)
#   truth.php             PRIVATE ground truth + model predictions: NEVER delete it (it is re-created only by build_truth.py + upload)
#   .htaccess             keeps this folder closed to the web: NEVER delete it
#
# TO START FROM ZERO (e.g. before the public launch, after testing): delete these, with the FTP client (select, Delete):
#     annotations.log.php
#     trials.log.php
#     everything INSIDE sessions/   (keep the folder itself)
#     everything INSIDE cool/       (keep the folder itself)
#   The server re-creates what it needs by itself at the next request. Nothing else has to be touched.
#
# TO REMOVE ONLY SOME TRIALS: open trials.log.php with a text editor (the first line is a php guard: keep it) and delete the lines
#   (one json per line) you do not want; the same in annotations.log.php (match "session" or "nick"). Save as UTF-8, upload back.
#   Test runs with the nickname  §§_§§  are hidden from the leaderboard 5 minutes after they are saved; they stay in the files.
#
# TO CLEAN BY COMMAND (only if you have a shell on the server, the free plan usually does not): run this file from this folder:
#     sh README_HOW_TO_CLEANUP.sh
# ============================================================================================================================
set -e
cd "$(dirname "$0")"
[ -f truth.php ] || { echo "truth.php not found here: run this from the data/ folder of the challenge. Nothing done."; exit 1; }
printf "Delete ALL runs, clicks and cooldowns (truth.php and .htaccess are kept)? Type yes: "
read ans
[ "$ans" = "yes" ] || { echo "Cancelled."; exit 0; }
rm -f annotations.log.php trials.log.php
rm -f sessions/*.php cool/*.txt
echo "Done: leaderboard and collected data are empty."

# Ostia Challenge: data tools (run locally)

Both scripts run on the laptop from the `CLAUDE` conda env (SimpleITK, nibabel, scipy, numpy, Pillow) and work **one volume at a time**
(about 0.6-0.9 GB of RAM each), with a memory cap:

```bash
conda activate CLAUDE
cd Awakening-ImageCAS/challenge/tools
python export_challenge.py --list                        # cases and whether the volumes are found
(ulimit -v 4500000; python export_challenge.py --only ImageCAS_390)   # one case
(ulimit -v 4500000; python export_challenge.py)          # all missing cases (add --force to redo)
python build_truth.py                                    # ground truth + model predictions -> truth.php / truth.json
```

Inputs (all in the git-ignored `../../_workbench/`): `volumes/`, `ostia/<DS>_OSTIAv2_JSON/`, `model_results/`.
Outputs in `../../_workbench/challenge-data/` (also ignored): one folder per anonymous case token with `axial/NNN.png`
(S index), `sagittal/NNN.png` (R index) and `meta.json`, plus `cases_map.json` (token -> dataset/id/role, private),
`truth.php` (upload to the server, private) and `truth.json` (same content, used by the local mode of the app).

* Cases: 12 scored (ASOCA Normal 5/7/10/16, CAT08 image 00/07/08/23, ImageCAS 390/470/446/384), 3 tutorial (ImageCAS 373/434/445),
  every ImageALCAPA volume found (unscored).
  `build_upload.py` then assembles `_workbench/altervista-upload/ostia/` for the FTP upload (see `../backend/README.md`).
* Grid: RAS, 0.5 mm isotropic, box 112 x 112 x 80 mm (224 x 224 x 160 voxels) cropped around the ostia midpoint with a seeded random
  offset (+-12 mm in-plane, +-8 mm in S) so the answer is never at the centre; both ostia >= 15 mm from the border. ALCAPA (no ground truth):
  natively 1 mm, so 1 mm voxels and a 224 x 224 x 160 mm box (same 224 x 224 x 160 pixels) centred on the contrast-filled heart, wider window.
  CAT08 and ALCAPA are stored as unsigned values with a +1024 offset (HU = value - 1024); ASOCA and ImageCAS are already in HU.
* Window: HU [-200, 800] -> 8 bit (ALCAPA: [-200, 1200]).
* Voxel (i, j, k) = (R, A, S) index; `RAS = origin_ras + 0.5 * (i, j, k)`. Axial slice k shows R on the left of the picture and A on top;
  sagittal slice i shows A on the left and S on top. The app converts clicks to RAS mm with this rule; positions are stored in RAS.
* Ground truth always comes from the `.ostium.json` RAS mm positions, never from the truncated `coordinate_ijk`.
* Models (`build_truth.py`, list `MODELS`): SwinUNETRv2, nnResUNet, ResNet50, ResNet101 from the 3D Slicer `.mrk.json` of
  `model_results/`; errors are recomputed and cross-checked against `metrics__*.json`. Add MedNeXt-B by adding it to `MODELS`
  and re-running `build_truth.py` (then upload the new `truth.php`).

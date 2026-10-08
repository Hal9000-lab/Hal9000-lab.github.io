#!/usr/bin/env python
"""Export the volumes of the Ostia Challenge as stacks of PNG slices.

Run it from the `CLAUDE` conda env (SimpleITK, numpy, Pillow), ONE case at a time to keep the memory low:

    python export_challenge.py --list                       # show the cases
    python export_challenge.py --only ImageCAS_390          # export one case
    python export_challenge.py                              # export everything that is missing

Input : ../../_workbench/volumes, ../../_workbench/ostia (ground truth .ostium.json), ../../_workbench/model_results
Output: ../../_workbench/challenge-data/<token>/{axial,sagittal}/NNN.png + meta.json, and challenge-data/cases_map.json
        (private: token -> dataset / id / role; it is turned into truth.php by build_truth.py and never published).

Conventions (RAS, mm, 0.5 mm isotropic, voxel (i, j, k) = (R, A, S) index, voxel centre = origin + 0.5 * index):
  axial   slice k: image columns run from the patient's right (left of the picture) to the left, rows from anterior (top) to posterior
  sagittal slice i: image columns run anterior (left) -> posterior, rows superior (top) -> inferior
"""
import argparse, hashlib, json, os, random, sys
import numpy as np
import SimpleITK as sitk
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WB = os.path.normpath(os.path.join(HERE, "..", "..", "_workbench"))
OUT = os.path.join(WB, "challenge-data")
SPACING = 0.5
BOX_MM = (112.0, 112.0, 80.0)          # R, A, S extent of the exported box
JITTER_MM = (12.0, 12.0, 8.0)          # random offset of the box centre w.r.t. the ostia midpoint
MARGIN_MM = 15.0                       # min distance of the ostia from the box border
HU_LO, HU_HI = -200.0, 800.0
HU_HI_ALCAPA = 1200.0                  # paediatric scans are much more enhanced (blood pool 500-1000 HU): wider window, no saturation
SALT = "ostia-challenge-v1"

SCORED = [("ASOCA", f"Normal_{n}", f"volumes/ASOCA/Normal_{n}.nrrd") for n in (5, 7, 10, 16)] + \
         [("CAT08", f"image{n:02d}", f"volumes/CAT08/image{n:02d}.mhd") for n in (0, 7, 8, 23)] + \
         [("ImageCAS", str(n), f"volumes/ImageCAS/challenge/{n}.img.nii.gz") for n in (390, 470, 446, 384)]
TUTORIAL = [("ImageCAS", str(n), f"volumes/ImageCAS/tutorial/{n}.img.nii.gz") for n in (373, 434, 445)]


def gt_path(ds, cid):
    return os.path.join(WB, "ostia", f"{ds}_OSTIAv2_JSON", f"{ds}__{cid}.ostium.json")


def load_gt(ds, cid):
    with open(gt_path(ds, cid)) as f:
        j = json.load(f)
    return {"R": j["pos"]["R"]["ras"], "L": j["pos"]["L"]["ras"]}


def token(role, ds, cid):
    return hashlib.sha1(f"{SALT}|{role}|{ds}|{cid}".encode()).hexdigest()[:12]


def alcapa_cases():
    d = os.path.join(WB, "volumes", "ImageALCAPA", "Data")
    ids = sorted((int(f.split("_")[0]) for f in os.listdir(d) if f.endswith("_image.nii.gz")))
    return [("ImageALCAPA", str(i), f"volumes/ImageALCAPA/Data/{i}_image.nii.gz") for i in ids]


def all_cases(alcapa_ids=None):
    cases = [("scored",) + c for c in SCORED] + [("tutorial",) + c for c in TUTORIAL]
    al = alcapa_cases()
    if alcapa_ids:
        al = [c for c in al if c[1] in alcapa_ids]
    return cases + [("alcapa",) + c for c in al]


STORED_OFFSET = {"ImageALCAPA": 1024.0, "CAT08": 1024.0}   # stored as unsigned 0..4095 (air = 0): HU = value - 1024


def read_volume(path, ds=None):
    img = sitk.ReadImage(path)
    if img.GetDimension() == 4:
        raise RuntimeError("4D volume")
    if ds in STORED_OFFSET:
        img = sitk.Cast(img, sitk.sitkFloat32) - STORED_OFFSET[ds]
    return img


def heart_centre_ras(img):
    """No ground truth (ALCAPA): centroid of the contrast-filled blood pool = largest bright connected blob, on a 2x shrunk copy."""
    from scipy import ndimage as ndi
    small = sitk.Shrink(img, [2, 2, 2])
    a = sitk.GetArrayFromImage(small)                                   # [z, y, x]
    b = ndi.binary_opening(a > 200, iterations=2)
    lab, n = ndi.label(b)
    if n == 0:
        raise RuntimeError("no bright structure found")
    sizes = ndi.sum(b, lab, range(1, n + 1))
    z, y, x = ndi.center_of_mass(lab == (int(np.argmax(sizes)) + 1))
    p = small.TransformContinuousIndexToPhysicalPoint((float(x), float(y), float(z)))
    return [-p[0], -p[1], p[2]]


def grid_for(ds):
    """(voxel spacing in mm, box size in mm): 0.5 mm / 112 x 112 x 80 mm; ImageALCAPA is natively 1 mm and its heart fills that box: 1 mm / 224 x 224 x 160 mm."""
    return (1.0, (224.0, 224.0, 160.0)) if ds == "ImageALCAPA" else (SPACING, BOX_MM)


def to_ras_box(img, centre_ras, spacing, box_mm):
    """Resample the box around `centre_ras` (RAS mm) on a RAS grid. Returns array [k, j, i] (S, A, R) and the voxel-0 centre in RAS."""
    n = [int(round(b / spacing)) for b in box_mm]                       # i (R), j (A), k (S)
    o_ras = [centre_ras[a] - box_mm[a] / 2 + spacing / 2 for a in range(3)]
    f = sitk.ResampleImageFilter()
    f.SetSize(n)
    f.SetOutputSpacing((spacing,) * 3)
    f.SetOutputDirection((-1, 0, 0, 0, -1, 0, 0, 0, 1))                  # SimpleITK works in LPS: +i = towards R, +j = towards A, +k = towards S
    f.SetOutputOrigin((-o_ras[0], -o_ras[1], o_ras[2]))
    f.SetDefaultPixelValue(-1024)
    f.SetInterpolator(sitk.sitkLinear)
    out = f.Execute(sitk.Cast(img, sitk.sitkFloat32))
    return sitk.GetArrayFromImage(out), o_ras


def window(a, hi=HU_HI):
    return np.clip((a - HU_LO) / (hi - HU_LO) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def save_stack(arr8, folder):
    os.makedirs(folder, exist_ok=True)
    for n in range(arr8.shape[0]):
        Image.fromarray(arr8[n], mode="L").save(os.path.join(folder, f"{n:03d}.png"), optimize=True)


def fits(gt, centre):
    for p in gt.values():
        for a in range(3):
            if abs(p[a] - centre[a]) > BOX_MM[a] / 2 - MARGIN_MM:
                return False
    return True


def choose_centre(role, ds, cid, rng, img):
    if role == "alcapa":
        # no ground truth: centre on the blood pool of the heart (the aortic root lies within a few cm of its centroid), small random offset
        c = heart_centre_ras(img)
        return [c[a] + rng.uniform(-JITTER_MM[a], JITTER_MM[a]) * 1.5 for a in range(3)], None
    gt = load_gt(ds, cid)
    mid = [(gt["R"][a] + gt["L"][a]) / 2 for a in range(3)]
    for _ in range(200):
        c = [mid[a] + rng.uniform(-JITTER_MM[a], JITTER_MM[a]) for a in range(3)]
        if fits(gt, c):
            return c, gt
    raise RuntimeError(f"cannot fit the ostia of {ds} {cid} in the box")


def export_case(role, ds, cid, rel, force=False):
    tok = token(role, ds, cid)
    folder = os.path.join(OUT, tok)
    if os.path.exists(os.path.join(folder, "meta.json")) and not force:
        print("skip (done)", role, ds, cid, tok)
        return tok
    path = os.path.join(WB, rel)
    print("export", role, ds, cid, "->", tok, flush=True)
    img = read_volume(path, ds)
    rng = random.Random(f"{SALT}|{ds}|{cid}")
    centre, gt = choose_centre(role, ds, cid, rng, img)
    spacing, box_mm = grid_for(ds)
    arr, o_ras = to_ras_box(img, centre, spacing, box_mm)
    del img
    hi = HU_HI_ALCAPA if ds == "ImageALCAPA" else HU_HI
    a8 = window(arr, hi)                                                # [k, j, i]
    axial = a8[:, ::-1, ::-1]                                           # rows: A top; cols: R on the left of the picture
    sag = np.transpose(a8, (2, 0, 1))[:, ::-1, ::-1]                    # [i, k, j] -> rows: S top; cols: A on the left
    save_stack(np.ascontiguousarray(axial), os.path.join(folder, "axial"))
    save_stack(np.ascontiguousarray(sag), os.path.join(folder, "sagittal"))
    meta = {
        "token": tok, "role": role, "spacing_mm": spacing,
        "shape_ijk": [a8.shape[2], a8.shape[1], a8.shape[0]],           # nR, nA, nS
        "origin_ras": o_ras,                                            # RAS of the centre of voxel (0,0,0)
        "window_hu": [HU_LO, hi],
        "axial": {"count": int(axial.shape[0]), "width": int(axial.shape[2]), "height": int(axial.shape[1])},
        "sagittal": {"count": int(sag.shape[0]), "width": int(sag.shape[2]), "height": int(sag.shape[1])},
    }
    if role == "tutorial":
        meta["ground_truth_ras"] = gt                                    # the tutorial shows the answer on purpose
    with open(os.path.join(folder, "meta.json"), "w") as f:
        json.dump(meta, f)
    size = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(folder) for fn in fns)
    print(f"   {a8.shape} -> {size / 1e6:.1f} MB", flush=True)
    return tok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--only", help="e.g. ImageCAS_390, ASOCA_Normal_5, ImageALCAPA_12")
    ap.add_argument("--dataset", help="only this dataset (ASOCA, CAT08, ImageCAS, ImageALCAPA)")
    ap.add_argument("--alcapa", help="comma separated ALCAPA ids to export (default: all available)")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    cases = all_cases(a.alcapa.split(",") if a.alcapa else None)
    if a.list:
        for c in cases:
            print(c[0], c[1], c[2], os.path.exists(os.path.join(WB, c[3])))
        return
    os.makedirs(OUT, exist_ok=True)
    cmap_path = os.path.join(OUT, "cases_map.json")
    cmap = json.load(open(cmap_path)) if os.path.exists(cmap_path) else {}
    for role, ds, cid, rel in cases:
        if a.only and f"{ds}_{cid}" != a.only:
            continue
        if a.dataset and ds != a.dataset:
            continue
        tok = export_case(role, ds, cid, rel, a.force)
        cmap[tok] = {"role": role, "dataset": ds, "id": cid}
        json.dump(cmap, open(cmap_path, "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())

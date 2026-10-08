#!/usr/bin/env python
"""Build the private truth file of the Ostia Challenge (plain json + python stdlib, no heavy dependency).

    python build_truth.py

Reads  _workbench/challenge-data/cases_map.json (written by export_challenge.py), the ground truth in _workbench/ostia and the
       3D Slicer markups of the models in _workbench/model_results/<run>/<run id>/markups-3d-slicer.
Writes _workbench/challenge-data/truth.php   (upload it to the server, NEVER commit it; it is a PHP file so that it cannot be downloaded)
       _workbench/challenge-data/truth.json  (same content, for local demo/debug)
Errors are recomputed (Euclidean distance in mm) and cross-checked against `distance_per_class` ([R, L]) of metrics__*.json.
Add a model (e.g. MedNeXt-B) by adding a line to MODELS and re-running.
"""
import glob, json, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
WB = os.path.normpath(os.path.join(HERE, "..", "..", "_workbench"))
OUT = os.path.join(WB, "challenge-data")

# name shown on the site, run folder in model_results, colour in the reveal
MODELS = [
    ("SwinUNETRv2", "test_set__SwinUNETRv2_DSNT", "#e3a21a"),
    ("nnResUNet", "test_set__nnUNetResidualUNet_DSNT", "#d94f9a"),
    ("ResNet50", "test_set__ResNet50_DSNT", "#38b6c9"),
    ("ResNet101", "test_set__ResNet101_DSNT", "#9a7be0"),
]


def run_dir(folder):
    runs = sorted(d for d in glob.glob(os.path.join(WB, "model_results", folder, "*")) if os.path.isdir(d))
    if len(runs) != 1:
        raise SystemExit(f"expected exactly one run in {folder}, found {runs}")
    return runs[0]


def markup_name(ds, cid):
    return f"{cid}.img" if ds == "ImageCAS" else cid


def read_markup(path):
    j = json.load(open(path))
    pts = {}
    for cp in j["markups"][0]["controlPoints"]:
        pts[cp["label"].strip().upper()[0]] = cp["position"]
    return pts


def dist(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def metrics_distances(rd):
    f = glob.glob(os.path.join(rd, "metrics__*.json"))[0]
    out = {}
    for e in json.load(open(f)):
        if isinstance(e, dict) and "image" in e:
            out[os.path.basename(e["image"])] = e["distance_per_class"]
    return out


def main():
    cmap = json.load(open(os.path.join(OUT, "cases_map.json")))
    runs = {m[0]: run_dir(m[1]) for m in MODELS}
    mdist = {n: metrics_distances(rd) for n, rd in runs.items()}
    cases, worst = {}, 0.0
    for tok, c in cmap.items():
        ds, cid, role = c["dataset"], c["id"], c["role"]
        entry = {"role": role, "dataset": ds, "id": cid}
        if role != "alcapa":
            j = json.load(open(os.path.join(WB, "ostia", f"{ds}_OSTIAv2_JSON", f"{ds}__{cid}.ostium.json")))
            gt = {"R": j["pos"]["R"]["ras"], "L": j["pos"]["L"]["ras"]}
            entry["gt"] = gt
        if role == "scored":
            entry["models"] = {}
            for name, _, _ in MODELS:
                hit = glob.glob(os.path.join(runs[name], "markups-3d-slicer", f"case_*_{markup_name(ds, cid)}.mrk.json"))
                if len(hit) != 1:
                    raise SystemExit(f"{name}: markup for {ds} {cid} not found ({hit})")
                pts = read_markup(hit[0])
                err = {"R": dist(pts["R"], gt["R"]), "L": dist(pts["L"], gt["L"])}
                key = f"{cid}.img.nii.gz" if ds == "ImageCAS" else None
                ref = mdist[name].get(key) if key else None
                if ref:                                              # cross-check with the test log (R, L)
                    worst = max(worst, abs(ref[0] - err["R"]), abs(ref[1] - err["L"]))
                entry["models"][name] = {"R": pts["R"], "L": pts["L"], "err": err}
        cases[tok] = entry
    out = {"models": [{"name": n, "color": col} for n, _, col in MODELS], "cases": cases}
    s = json.dumps(out, indent=1)
    open(os.path.join(OUT, "truth.json"), "w").write(s)
    open(os.path.join(OUT, "truth.php"), "w").write("<?php\n// private: ground truth and model predictions (RAS, mm). Do not commit.\nreturn json_decode(<<<'JSON'\n" + s + "\nJSON\n, true);\n")
    n = {r: sum(1 for c in cases.values() if c["role"] == r) for r in ("scored", "tutorial", "alcapa")}
    print("cases:", n, "| max |recomputed - logged| error on ImageCAS cases: %.4f mm" % worst)


if __name__ == "__main__":
    main()

import sqlite3

# updates the best results table

DB_PATH = './GMMIS-Survey/database.sqlite'



SOURCE_BIBTEX = """
@Article{Zhang2025PCaSAM,
author={Zhang, Yuhan and Ma, Xiao and Li, Mingchao and Huang, Kun and Zhu, Jie and Wang, Miao and Wang, Xi and Wu, Menglin and Heng, Pheng-Ann},
title={Generalist medical foundation model improves prostate cancer segmentation from multimodal MRI images},
journal={npj Digital Medicine},
year={2025},
month={Jun},
day={18},
volume={8},
number={1},
pages={372},
issn={2398-6352},
doi={10.1038/s41746-025-01756-2},
url={https://doi.org/10.1038/s41746-025-01756-2}
}
"""

MODEL = ''

RESULTS_TO_MODIFY  = { 
    # dataset_name: dice_score
    # or
    # dataset_name: (dice_score, comment)
    #
    # '': (, ''),

    # 'TotalSegmentator Organs': (83.70, None),
    # 'TotalSegmentator Vertebrae': (82.30, None),
    # 'TotalSegmentator Cardiac': (77.16, None),
    # 'TotalSegmentator Muscles': (84.27, None),
    # 'TotalSegmentator Ribs': (79.80, None),
    # 'TotalSegmentator': (81.99, None),

    # 'MSD Lung Tumors': (61.8,  None),
    # 'MSD Pancreas Tumour': (58.60,  None),
    # 'MSD Hepatic Vessels': (69.9,  None),
    # 'MSD Colon Cancer': (62.8,  None),
    # 'LiTS / MSD Liver': (66.93,  None),
    # 'KiTS': (85.4, None),

    # 'FLARE': (90.3,  None),
    # 'SegTHOR': (72.9, None),

    #
    # 'BraTS': (91.8, None),
    # 'BTCV': (82.1,  None),
    # 'LASC': (92.4, None),
    # 'AMOS': (90.86, None),
    # 'WORD': (86.88, None),
    # 'AbdomenAtlas': (90.38, None),
    
    # 'AbdomenCT-1K': (87.77,  None),
    # 'MM-WHS': (91.22, None),
    # 'CHAOS': (96.68, None),
    # '3D-IRCADb': (74.27, None),
    # 'KiPA': (87.54, None),
    # 'Pancreas-CT': (86.57,  None),
    # 'VerSe': (63.72, None),
    # 'AutoPET': (32.61, None),
    # 'ACDC': (89.51, None),
    # 'ATLAS 2023': (69.80, None),

    # 'MSD Cardiac': (93.72, None),
    # 'MSD Hippocampus': (88.55, None),
    # 'MSD Prostate': (75.57, None),
    # 'MSD Spleen': (96.12,  None),
    # 'BTCV Cervix': (77.5,  None),
}




######################################### script ##############################################

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

if len(MODEL) < 2:
    raise RuntimeError("No model:", MODEL)

if len(SOURCE_BIBTEX.strip()) < 3:
    raise RuntimeError("Specify SOURCE_BIBTEX")

# Insert into results_primary and results_best only if MODEL is not already present
c.execute("SELECT 1 FROM results_best WHERE ID = ?", (MODEL,))
if not c.fetchone():
    print(f"Error: Model '{MODEL}' not found in 'results_best' table. Please run the 1_... script first to initialize the model entry.")
    conn.close()
    exit(1)


# Now update results_best and related tables (dice scores, source, comments)

def ensure_column_exists(cursor, table, column, coltype):
    cursor.execute(f"PRAGMA table_info([{table}])")
    cols = [row[1] for row in cursor.fetchall()]
    if column not in cols:
        raise RuntimeError("This column does not exist in this table: ", column)

for dataset in RESULTS_TO_MODIFY:
    # Ensure columns exist with correct types
    ensure_column_exists(c, 'results_best', dataset, 'REAL')
    ensure_column_exists(c, 'results_best_comments', dataset, 'TEXT')
    ensure_column_exists(c, 'results_best_source', dataset, 'TEXT')

    # Update dice scores in results_best
    dice_score, comment = RESULTS_TO_MODIFY[dataset]

    c.execute(
        f'UPDATE results_best SET [{dataset}] = ? WHERE ID = ?',
        (dice_score, MODEL)
    )

    # Insert source into the sources table
    c.execute(
        f'UPDATE results_best_source SET [{dataset}] = ? WHERE ID = ?',
        (SOURCE_BIBTEX, MODEL)
    )

    # Insert comment into comments tables if present (not into results_best)
    if comment:
        c.execute(
            f'UPDATE results_best_comments SET [{dataset}] = ? WHERE ID = ?',
            (comment, MODEL)
        )

# save and close
conn.commit()
conn.close()

print(f"Updated {MODEL} in table results_best and similar.")
import sqlite3

# updates the best results table

DB_PATH = './GMMIS-Survey/database.sqlite'




SOURCE_BIBTEX = """
@misc{wu2025cdpdnetintegratingtextguidance,
      title={CDPDNet: Integrating Text Guidance with Hybrid Vision Encoders for Medical Image Segmentation}, 
      author={Jiong Wu and Yang Xing and Boxiao Yu and Wei Shao and Kuang Gong},
      year={2025},
      eprint={2505.18958},
      archivePrefix={arXiv},
      primaryClass={cs.CV},
      url={https://arxiv.org/abs/2505.18958}, 
}
"""

MODEL = 'DoDNet'

RESULTS_TO_MODIFY = {
    # dataset_name: (dice_score, comment)
    #
    # '': (, ''),
    'CHAOS': (78.36, 'With CLIP feature fusion (CLIP-DoDNet).'),
    #'LiTS / MSD Liver': (74.92,  None),
    #'KiTS': (97.9, None),
    'AbdomenCT-1K': (89.78,  'With CLIP feature fusion (CLIP-DoDNet).'),
    'Pancreas-CT': (75.26,  'With CLIP feature fusion (CLIP-DoDNet).'),
    'FLARE': (94.16,  'With CLIP feature fusion (CLIP-DoDNet).'),
    # 'MSD Lung Tumors': (71.9,  None),
    # 'MSD Pancreas Tumour': (63.8,  None),
    # 'MSD Hepatic Vessels': (75.7,  None),
    # 'MSD Spleen': (95.4,  None),
    # 'MSD Colon Cancer': (63.3,  None),
    # 'BTCV': (71.69,  None),
    # 'BTCV Cervix': (77.5,  None),
    # 'VerSe': (90.6,  None),
    # 'AbdomenCT-1K': (94.0,  None),
    'AMOS': (82.28, 'With CLIP feature fusion (CLIP-DoDNet).'),
    # 'TotalSegmentator': (89.32, '.'),
    'WORD': (88.51, 'With CLIP feature fusion (CLIP-DoDNet).'),
    '3D-IRCADb': (66.00, 'With CLIP feature fusion (CLIP-DoDNet).'),
}







conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

if len(MODEL) < 2:
    raise RuntimeError("No model:", MODEL)



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

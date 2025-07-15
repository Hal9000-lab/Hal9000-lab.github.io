import sqlite3

# updates the best results table

DB_PATH = './GMMIS-Survey/database.sqlite'




SOURCE_BIBTEX = """
@InProceedings{He_2025_CVPR,
    author    = {He, Yufan and Guo, Pengfei and Tang, Yucheng and Myronenko, Andriy and Nath, Vishwesh and Xu, Ziyue and Yang, Dong and Zhao, Can and Simon, Benjamin and Belue, Mason and Harmon, Stephanie and Turkbey, Baris and Xu, Daguang and Li, Wenqi},
    title     = {VISTA3D: A Unified Segmentation Foundation Model For 3D Medical Imaging},
    booktitle = {Proceedings of the Computer Vision and Pattern Recognition Conference (CVPR)},
    month     = {June},
    year      = {2025},
    pages     = {20863-20873}
}
"""

MODEL = 'nnU-Net'

RESULTS_TO_MODIFY = {
    # dataset_name: (dice_score, comment)
    #
    # '': (, ''),
    # 'LiTS / MSD Liver': (68.7, 'auto+point configuration.'),
    # 'MSD Lung Tumors': (71.9, 'auto+point configuration.'),
    # 'MSD Pancreas Tumour': (63.8, 'auto+point configuration.'),
    # 'MSD Hepatic Vessels': (75.7, 'auto+point configuration.'),
    # 'MSD Spleen': (95.4, 'auto+point configuration.'),
    # 'MSD Colon Cancer': (63.3, 'auto+point configuration.'),
    # 'BTCV': (85.9, 'auto+point configuration.'),
    'BTCV Cervix': (64.0, None),
    # 'VerSe': (90.6, 'auto+point configuration.'),
    # 'AbdomenCT-1K': (94.0, 'auto+point configuration.'),
    # 'AMOS': (85.6, 'auto+point configuration.'),
    # 'TotalSegmentator': (91.8, 'auto+point configuration.'),
    # 'WORD': (87.5, 'After fine tuning on 100 WORD cases.'),
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
    if comment is not None:
        c.execute(
            f'UPDATE results_primary_comments SET [{dataset}] = ? WHERE ID = ?',
            (comment, MODEL)
        )

# save and close
conn.commit()
conn.close()

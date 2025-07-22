import sqlite3

# updates the best results table

DB_PATH = './GMMIS-Survey/database.sqlite'



SOURCE_BIBTEX = """

"""

MODEL = ''

RESULTS_TO_MODIFY  = { 
    # dataset_name: dice_score
    # or
    # dataset_name: (dice_score, comment)
    #
    # '': (, ''),

    # 'TotalSegmentator Organs': (88.85, None),
    # 'TotalSegmentator Vertebrae': (87.85, None),
    # 'TotalSegmentator Cardiac': (85.57, None),
    # 'TotalSegmentator Muscles': (91.34, None),
    # 'TotalSegmentator Ribs': (84.61, None),
    # 'TotalSegmentator': (88.10, None),

    # 'BTCV': (79.7, None),

    # 'BraTS': (64.35, None),
    # 'LiTS / MSD Liver': (85.52,  None),
    # 'MSD Lung Tumors': (76.60,  None),
    # 'MSD Pancreas Tumour': (70.71,  None),
    # 'MSD Hepatic Vessels': (68.95,  None),
    # 'MSD Spleen': (97.43,  None),
    # 'MSD Colon Cancer': (58.33,  None),
    
    # 'KiTS': (80.83, None),
    # 'Synapse': (80.02, None),
    # 'CHAOS': (83.30, None),
    # 'FLARE': (90.3,  None),
    # 'SegTHOR': (85.1, None),

    #
    # 'BTCV': (82.1,  None),
    # 'LASC': (84.7, None),
    # 'AMOS': (90.86, None),
    # 'WORD': (86.88, None),
    # 'AbdomenAtlas': (90.38, None),
    
    # 'AbdomenCT-1K': (87.77,  None),
    # 'MM-WHS': (91.22, None),
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
import sqlite3

# updates the best results table

DB_PATH = './GMMIS-Survey/database.sqlite'


# risultati voco - ok
# poi aggiungi modello supreme - ok
# risultati primry da supreme - ok
# risultati best da supreme - ok
# risultati best da voco - ok
# aggiungi il dataset da supreme (DAP Atlas e update AbdomenAtlas 1.1)
# poi risultati 3dino-vit (mail)

SOURCE_BIBTEX = """

"""

MODEL = ''

RESULTS_TO_MODIFY  = { 
    # dataset_name: dice_score
    # or
    # dataset_name: (dice_score, comment)
    #
    # '': (, ''),
    #
    # 'BTCV': (85.32,  None),
    # 'AMOS': (88.14, None),
    # 'WORD': (85.97, None),
    # 'FLARE': (90.67,  'Mean between FLARE 22 and FLARE 23 (91.37 and 89.98)'),
    # 'TotalSegmentator': (84.84, None),
    # 'AbdomenAtlas': (89.16, None),
    
    # 'AbdomenCT-1K': (86.40,  None),
    # 'MM-WHS': (90.88, None),
    # 'CHAOS': (96.42, None),
    # '3D-IRCADb': (68.48, None),
    # 'KiTS': (78.38, None),
    # 'KiPA': (85.76, None),
    # 'Pancreas-CT': (85.19,  None),
    # 'SegTHOR': (89.70, None),
    # 'VerSe': (89.54, None),
    # 'AutoPET': (24.68, None),
    # 'ACDC': (89.10, None),
    # 'ATLAS 2023': (64.64, None),
    # 'BraTS': (89.54, None),

    # 'MSD Cardiac': (92.55, None),
    # 'LiTS / MSD Liver': (68.20,  None),
    # 'MSD Hippocampus': (87.40, None),
    # 'MSD Prostate': (72.92, None),
    # 'MSD Lung Tumors': (72.55,  None),
    # 'MSD Pancreas Tumour': (50.02,  None),
    # 'MSD Hepatic Vessels': (64.71,  None),
    # 'MSD Spleen': (96.01,  None),
    # 'MSD Colon Cancer': (38.78,  None),
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

print(f"Updated {MODEL} in table results_best and similar.")
import sqlite3

# updates the primary results table

DB_PATH = './GMMIS-Survey/database.sqlite'

MODEL = ''

# poi risultati 3dino-vit (mail) 7777777777777777777777777777777777

RESULTS_TO_ADD = { 
    # dataset_name: dice_score
    # or
    # dataset_name: (dice_score, comment)
    #
    # '': (, ''),
    #
    # 'BTCV': (86.64,  None),
    # 'AMOS': (90.86, None),
    # 'WORD': (86.88, None),
    # 'FLARE': (91.25,  'Mean of FLA22 and FLA23 (Table 4).'),
    # 'TotalSegmentator': (84.84, None),
    # 'AbdomenAtlas': (90.38, None),
    
    # 'AbdomenCT-1K': (87.77,  None),
    # 'MM-WHS': (91.22, None),
    # 'CHAOS': (96.68, None),
    # '3D-IRCADb': (74.27, None),
    # 'KiTS': (80.81, None),
    # 'KiPA': (87.54, None),
    # 'Pancreas-CT': (86.57,  None),
    # 'SegTHOR': (90.17, None),
    # 'VerSe': (63.72, None),
    # 'AutoPET': (32.61, None),
    # 'ACDC': (89.51, None),
    # 'ATLAS 2023': (69.80, None),
    # 'BraTS': (90.23, None),

    # 'MSD Cardiac': (93.72, None),
    # 'LiTS / MSD Liver': (71.22,  None),
    # 'MSD Hippocampus': (88.55, None),
    # 'MSD Prostate': (75.57, None),
    # 'MSD Lung Tumors': (75.74,  None),
    # 'MSD Pancreas Tumour': (51.34,  None),
    # 'MSD Hepatic Vessels': (67.25,  None),
    # 'MSD Spleen': (96.12,  None),
    # 'MSD Colon Cancer': (42.57,  None),
    # 'BTCV Cervix': (77.5,  None),
}




######################################## script #####################

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

# create an entry in the results_primary table with ID, Related Paper, Date and all the other values are null
# ID: MODEL
# Related Paper: MODEL
# Date: "First Publication Date" from the models table
c.execute("SELECT [First Publication Date] FROM models WHERE ID = ?", (MODEL,))
row = c.fetchone()
first_pub_date = row[0] if row else None

if len(MODEL) < 2:
    raise RuntimeError("No model:", MODEL)

if not first_pub_date:
    raise RuntimeError("No date:", first_pub_date)

# Insert into results_primary and results_best only if MODEL is not already present
c.execute("SELECT 1 FROM results_primary WHERE ID = ?", (MODEL,))
if not c.fetchone():
    c.execute("""
        INSERT INTO results_primary (ID, [Related Paper], Date)
        VALUES (?, ?, ?)
    """, (MODEL, MODEL, first_pub_date)
    )
c.execute("SELECT 1 FROM results_best WHERE ID = ?", (MODEL,))
if not c.fetchone():
    c.execute("""
        INSERT INTO results_best (ID, [Related Paper], Date)
        VALUES (?, ?, ?)
    """, (MODEL, MODEL, first_pub_date)
    )


# Now update results to insert the values of the dict
# the dice score (float) goes into the results_primary table
# the comment goes into the results_primary_comments table (create if not exist)
# If the dataset is not one of the columns of the database, add the column (default null)
#  to all the following tables (create them if not exist):
#  - results_primary
#  - results_primary_comments 
#      (same as results_primary, but all fields are TEXT except for Date column)
#  - results_best
#  - results_best_source
#      (same as results_best, but all fields are TEXT except for Date column, table already exist)
#  - results_best_comments
#      (same structure as results_best_source)

def ensure_column_exists(cursor, table, column, coltype):
    cursor.execute(f"PRAGMA table_info([{table}])")
    cols = [row[1] for row in cursor.fetchall()]
    if column not in cols:
        resp = input(f"Column '{column}' does not exist in table '{table}'. Add it? (y/n): ")
        if resp.lower() != "y":
            print("Aborted.")
            exit(1)
        cursor.execute(f'ALTER TABLE [{table}] ADD COLUMN [{column}] {coltype}')

for dataset in RESULTS_TO_ADD:
    # Ensure columns exist with correct types
    ensure_column_exists(c, 'results_primary', dataset, 'REAL')
    ensure_column_exists(c, 'results_best', dataset, 'REAL')
    ensure_column_exists(c, 'results_primary_comments', dataset, 'TEXT')
    ensure_column_exists(c, 'results_best_comments', dataset, 'TEXT')
    ensure_column_exists(c, 'results_best_source', dataset, 'TEXT')

    # Insert dice score into results_primary and results_best
    dice_score = RESULTS_TO_ADD[dataset]
    comment = None
    if isinstance(dice_score, tuple):
        dice_score, comment = dice_score

    c.execute(
        f'UPDATE results_primary SET [{dataset}] = ? WHERE ID = ?',
        (dice_score, MODEL)
    )
    c.execute(
        f'UPDATE results_best SET [{dataset}] = ? WHERE ID = ?',
        (dice_score, MODEL)
    )

    # Insert comment into comments tables if present (not into results_best)
    if comment:
        c.execute(
            f'UPDATE results_primary_comments SET [{dataset}] = ? WHERE ID = ?',
            (comment, MODEL)
        )

# save and close
conn.commit()
conn.close()

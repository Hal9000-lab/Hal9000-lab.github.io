import sqlite3

# updates the primary results table

DB_PATH = './GMMIS-Survey/database.sqlite'

MODEL = ''

RESULTS_TO_ADD = { 
    # dataset_name: dice_score
    # or
    # dataset_name: (dice_score, comment)
    # '': (, ''),
    #

    # 'TotalSegmentator Organs': (88.85, None),
    # 'TotalSegmentator Vertebrae': (87.85, None),
    # 'TotalSegmentator Cardiac': (85.57, None),
    # 'TotalSegmentator Muscles': (91.34, None),
    # 'TotalSegmentator Ribs': (84.61, None),
    # 'TotalSegmentator': (88.10, None),

    # 'BTCV': (91.8, None),

    # 'BraTS': (64.35, None),
    # 'LiTS / MSD Liver': (85.52,  None),
    # 'MSD Lung Tumors': (76.60,  None),
    # 'MSD Pancreas Tumour': (70.71,  None),
    # 'MSD Hepatic Vessels': (68.95,  None),
    # 'MSD Spleen': (96.99,  None),
    # 'MSD Colon Cancer': (59.45,  None),
    
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

# check if model is in the tables
for table in ['results_primary', 'results_primary_comments', 'results_best', 'results_best_source', 'results_best_comments']:
    c.execute(f"SELECT 1 FROM {table} WHERE ID = ?", (MODEL,))
    if not c.fetchone():
        raise RuntimeError(f"Model {MODEL} not found in table {table}")

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

print(f"Updated {MODEL} in table results_primary and similar.")
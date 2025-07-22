import sqlite3

DB_PATH = './GMMIS-Survey/database.sqlite'

TO_RENAME = {
    # 'old': 'new',
    'SwinUNETR': 'Swin UNETR',
    'DINOv2 U-Net': 'DINOv2-UNet',
}

################################### sript #################################

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

tables = [
    'models',
    'results_primary',
    'results_primary_comments',
    'results_best',
    'results_best_comments',
    'results_best_source'
]

for table in tables:
    columns = [c[1] for c in cursor.execute(f"PRAGMA table_info({table})").fetchall()]
    columns = [c for c in columns if c in ['ID', 'Related Paper']]
    # any instance of 'old' in the column entries will be replaced with 'new'
    for column in columns:
        for old, new in TO_RENAME.items():
            cursor.execute(f"UPDATE {table} SET [{column}] = REPLACE([{column}], ?, ?)", (old, new))

conn.commit()
conn.close()
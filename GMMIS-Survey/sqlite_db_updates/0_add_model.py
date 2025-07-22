import sqlite3

DB_PATH = './GMMIS-Survey/database.sqlite'

TO_ADD = {
    'ID': 'SwinUNETR SSL',
    'Title': 'Self-Supervised Pre-Training of Swin Transformers for 3D Medical Image Analysis',
    'Major Affiliations': 'Vanderbilt University, Nvidia',

    'First Publication Date': '2021-11-01 00:00:00',
    'First Publisher': 'arXiv',
    'First Publication Link': 'https://doi.org/10.48550/arXiv.2111.14791',
    'First Publication BibKey': 'tang2022selfsupervisedpretrainingswintransformers',

    'Last Publication Date': '2022-09-01 00:00:00',
    'Last Publisher': 'IEEE/CVF CVPR',
    'Last Publication Link': 'https://doi.org/10.1109/CVPR52688.2022.02007',
    'Last Publication BibKey': '9879123',

    'Code': 'https://github.com/Project-MONAI/research-contributions/tree/main/SwinUNETR',
    'Framework': 'Generalist',
    'Architecture': 'Transformer',
    'Visual Backbone': '3D Swin-Base with U-Net Decoder',
    'Millions of Parameters': 62.5,
    'Number of GFlops': None,
    'Resources': '8, NVIDIA, V100 32GB, Nvidia DXG-1 Server',
}

"""
# Example of correct way to insert stuff
# Use the two commands:
#   .www
#   select * from models;
# To check the standard values of some fields
TO_ADD = {
    'ID': 'VISTA3D',
    'Title': 'VISTA3D: A Unified Segmentation Foundation Model For 3D Medical Imaging',
    'Major Affiliations': 'Nvidia, University of Arkansas for Medical Sciences, University of Oxford',
    'First Publication Date': '2024-06-01 00:00:00',
    'First Publisher': 'arXiv',
    'First Publication Link': 'https://doi.org/10.48550/arXiv.2406.05285',
    'First Publication BibKey': 'he2024vista3dunifiedsegmentationfoundation',
    'Last Publication Date': '2025-06-01 00:00:00',
    'Last Publisher': 'IEEE/CVF CVPR',
    'Last Publication Link': 'https://openaccess.thecvf.com/content/CVPR2025/html/He_VISTA3D_A_Unified_Segmentation_Foundation_Model_For_3D_Medical_Imaging_CVPR_2025_paper.html',
    'Last Publication BibKey': 'He_2025_CVPR',
    'Code': 'https://github.com/Project-MONAI/VISTA',
    'Framework': 'Horizontal (Foundation)',
    'Architecture': 'CNN',
    'Visual Backbone': '3D SegResNet',
    'Millions of Parameters': None,
    'Number of GFlops': None,
    'Resources': '64, NVIDIA, V100 32GB',
}
"""

################################ script ################################

if 1:
    # first, check if the model ID is already in the table
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT 1 FROM models WHERE ID = ?", (TO_ADD['ID'],))
    if c.fetchone():
        print(f"Model with ID '{TO_ADD['ID']}' already exists.")
        conn.close()
        exit(0)

    # go on
    columns = ', '.join(list(map(lambda x: '"' + x + '"', TO_ADD.keys())))
    placeholders = ', '.join(['?'] * len(TO_ADD))
    values = list(TO_ADD.values())
    query = f"INSERT INTO models ({columns}) VALUES ({placeholders})"
    c.execute(query, values)
    conn.commit()
    conn.close()
else:
    # get all columns and unique sets of values
    # or in sqlite3 use:
    # .www
    # selct * from models;
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    columns = list(TO_ADD.keys())
    print(' | '.join(columns))
    for col in columns:
        c.execute(f"SELECT DISTINCT [{col}] FROM models")
        uniques = [str(row[0]) for row in c.fetchall()]
        print(f"{col}: {', '.join(uniques)}")
    conn.close()


# Add rows to other tables

for table in ['results_primary', 'results_primary_comments', 'results_best', 'results_best_source', 'results_best_comments']:
    c.execute(f"SELECT 1 FROM {table} WHERE ID = ?", (TO_ADD['ID'],))
    if not c.fetchone():
        c.execute(f"""
            INSERT INTO {table} (ID, [Related Paper], Date)
            VALUES (?, ?, ?)
        """, (TO_ADD['ID'], TO_ADD['ID'], TO_ADD['First Publication Date'])
        )
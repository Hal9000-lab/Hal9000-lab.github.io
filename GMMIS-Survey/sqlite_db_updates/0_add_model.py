import sqlite3

DB_PATH = './GMMIS-Survey/database.sqlite'

TO_ADD = {
    'ID': 'PCaSAM',
    'Title': 'Generalist medical foundation model improves prostate cancer segmentation from multimodal MRI images',
    'Major Affiliations': 'Shenzhen University, The Chinese University of Hong Kong, Imperial College London, The Hong Kong University of Science and Technology',
    'First Publication Date': '2025-06-01 00:00:00',
    'First Publisher': 'npj Digital Medicine',
    'First Publication Link': 'https://doi.org/10.1038/s41746-025-01756-2',
    'First Publication BibKey': 'Zhang2025PCaSAM',
    'Last Publication Date': None,
    'Last Publisher': None,
    'Last Publication Link': None,
    'Last Publication BibKey': None,
    'Code': None,
    'Framework': 'Generalist',
    'Architecture': 'SAM, Transformer with Convolutions',
    'Visual Backbone': 'SAM',
    'Millions of Parameters': 12.48,
    'Number of GFlops': None,
    'Resources': '2, NVIDIA, GeForce RTX 3090 24GB',
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

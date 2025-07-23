from itertools import product
import os

import pandas
import sqlite3

DB_PATH = './GMMIS-Survey/database.sqlite'

# Comments
# dafarames such as index is the name of the paper,
# and the column is the name of the dataset.

# - Original
comments_original_dict = {
    0: r"All results in the published paper \citep{ma2025medsam2segment3dmedical} are grouped per organ or lesion mixing different dataset sources. Please refer to the original publication for more details.",
    1: r"Test results were provided on BreastUS and Chest XRay public datasets, that are 2D only.",
    2: r"CT dataset only.",
    3: r"MRI dataset only.",
    4: r"Results obtained from the original raw segmentation metrics available on \href{https://github.com/microsoft/BiomedParse/tree/main/figures/results/dataset_results}{BiomedParse's GitHub}.",
    5: r"No Dice scores reported in the technical reports.",
    6: r"Reporting results for SAT-Ft (fine-tuned).",
    7: r"Average Dice score between BraTS2023 GLI, MEN, MET, PED, SSA.",
    8: r"Average Dice score between AMOS2 CT (88.75\%) and AMOS2 MRI (84.82\%).",
    9: r"Average Dice score between CHAOS CT (97.24\%) and CHAOS MRI (87.99\%).",
    10: r"TS v2 in Table 6 \citep{zhao2025modelrulealluniversal}.",
    11: r"Average Dice score between MM-WHS CT (91.14\%) and MM-WHS MRI (87.73\%).",
    12: r"Results reported in the 1-point prompt framework.",
    13: r"Average Dice score between AMOS2 CT (79.94\%) and AMOS2 MRI (75.41\%).",
    14: r"Dice score obtain on composite dataset (PRIMOSE12 + others, please refer to original manuscript). Automatic, no prompts (Best Dice score with prompts 80.3\%).",
    15: r"Automatic, no prompts (Best Dice score with prompts 81.1\%).",
    16: r"Automatic, no prompts, tumor Dice score only.",
    17: r"Results reported from Table 4 only \citep{cheng2023sammed2d}.",
    18: r"Results reported for 3 points per volume for all datasets. Table 2 not considered \citep{3DSAM-adapter}.",
    19: r"Tumor Dice score only.",
    20: r"Mean between only tumor segmentation (Table 1) and whole organ (pancreas+tumor as one class) segmentation Table 6 \citep{3DSAM-adapter}.",
    21: r"Dice score on whole organ (organ + eventual tumor as one class).",
    22: r"Results from the \href{https://github.com/hitachinsk/SAMed?tab=readme-ov-file}{SAMed GitHub} where SAMed\_h with vit\_h backbone was announced. Results reported in prints was 81.88\%.",
    23: r"These results are obtained on held-out datasets and previously unseen tasks. Due to the structure of the network, during inference, the model is provided with an unseen image for segmentation along with a set of eight example image-mask pairs of the same type and task (e.g., aorta segmentation in CT scans). The network is designed to perform on-the-fly learning from these examples and apply the learned information to the new image. The reliance on few-shot learning for segmentation likely contributes to the relatively low performance scores observed.",
    24: r"All results in the Supplementary Material of the published paper \citep{MedSAM_nature} are grouped per organ or lesion mixing different dataset sources. Please refer to the original publication for more details.",
    25: r"The predecessor of BiomedParse by Microsoft performs image and caption retrieval, image classification, question answering, but no segmentation. Inserted for completeness.",
    26: r"Average Dice score between organ (96.89\%) and tumor (84.01\%).",
    27: r"This method does not perform segmentation, however it is important for its text-grounding technique.",
    28: r"Reported results are unclear and were not able to understand which datasets were used.",
    29: r"Results from Swin UNETR-V2 \citep{Swin UNETRv2_miccai} that provided updated Dice scores from the same research group.",
    30: r"Average Dice score between BraTS2019 and BraTS2020 datasets.",
    31: r"Results from TransBTSV2 \citep{li2022transbtsv2betterefficientvolumetric} that provided updated Dice scores from the same research group.",
    32: r"Average Dice score between BTCV \"free\" and \"standard\" competition datasets.",
    33: r"Only results on Totalsegmntator MRI were provided.",
    34: r"Average Dice score between WT, ET, TC (91.83\%, 75.98\%, 87.05\% respectively).",
    35: r"On MRI only.",
    36: r"Average Dice score between MRI and CT test sets (83.9\%, 96.6\% respectively).",
    37: r"Results from Table IV of \citep{10879789}. Dice scores were averaged across imaging modalities per dataset where more imaging modalities were provided.",
    38: r"Results from Table II of \citep{10510478}, considered \textit{STUNet-L w/ PC} that has the highest score on \textit{TotalSegmentator}. Also in Table III that model has best mean score on all datasets.",
    39: r"Reported Dice scores in 1 point prompt setting.",
    40: r"HERMES-M (MedFormer visual backbone) is considered.",
    41: r"Average Dice score between pancreas (82.73\%) and tumor (61.41\%) with convolutional backbone.",
    42: r"Average Dice score between AMOS CT and MRI (89.98\% and 87.20\%).",
    43: r"Results reported per-organ, not per-dataset.",
    44: r"Results mixed-up between datasets.",
    45: r"Original model applied to natural images. Included because it was used as benchmark by some other models.",
    46: r"When applicable, results are the average between organ and tumor scores."
}
comments_original_db = pandas.DataFrame()
comments_original_db.loc["MedSAM2", "commentOnPaper"] = 0
comments_original_db.loc["Biomedical SAM-2 (BioSAM-2)", "FLARE"] = 2
comments_original_db.loc["Biomedical SAM-2 (BioSAM-2)", "AMOS"] = 3
comments_original_db.loc["BiomedParse", "commentOnPaper"] = 4
comments_original_db.loc["HAI-DEF CT Foundation", "commentOnPaper"] = 5
comments_original_db.loc["SAT", "commentOnPaper"] = 6
comments_original_db.loc["SAT", "BraTS"] = 7
comments_original_db.loc["SAT", "AMOS"] = 8
comments_original_db.loc["SAT", "AMOS"] = 9
comments_original_db.loc["SAT", "TotalSegmentator"] = 10
comments_original_db.loc["SAT", "MM-WHS"] = 11
comments_original_db.loc["SAM-Med3D", "commentOnPaper"] = 12
comments_original_db.loc["SAM-Med3D", "AMOS"] = 13
comments_original_db.loc["MA-SAM", "PROMISE12"] = 14
comments_original_db.loc["MA-SAM", "MSD Colon Cancer"] = 15
comments_original_db.loc["MA-SAM", "MSD Pancreas Tumour"] = 16
comments_original_db.loc["SAM-Med2D", "commentOnPaper"] = 17
comments_original_db.loc["3DSAM-adapter", "commentOnPaper"] = 18
comments_original_db.loc["3DSAM-adapter", "KiTS"] = 19
comments_original_db.loc["3DSAM-adapter", "LiTS / MSD Liver"] = 19
comments_original_db.loc["3DSAM-adapter", "MSD Pancreas Tumour"] = 20
comments_original_db.loc["3DSAM-adapter", "Prostate158"] = 21
comments_original_db.loc["SAMed", "Synapse"] = 22
comments_original_db.loc["UniverSeg", "commentOnPaper"] = 23
comments_original_db.loc["MedSAM", "commentOnPaper"] = 24
comments_original_db.loc["BiomedCLIP", "commentOnPaper"] = 25
comments_original_db.loc["MultiTalent", "KiTS"] = 26
comments_original_db.loc["MedCLIP", "commentOnPaper"] = 27
comments_original_db.loc["UniSeg33A", "commentOnPaper"] = 28
comments_original_db.loc["Swin UNETR", "commentOnPaper"] = 29
comments_original_db.loc["TransBTSV2", "BraTS"] = 30
comments_original_db.loc["TransBTS", "commentOnPaper"] = 31
comments_original_db.loc["UNETR", "BTCV"] = 32
comments_original_db.loc["IMIS-Net", "TotalSegmentator"] = 33
comments_original_db.loc["LeSAM", "BraTS"] = 34
comments_original_db.loc["TotalSegmentator MRI", "AMOS"] = 35
comments_original_db.loc["TotalSegmentator MRI", "CHAOS"] = 35
comments_original_db.loc["TotalSegmentator MRI", "TotalSegmentator"] = 36
comments_original_db.loc["MoME", "commentOnPaper"] = 37
comments_original_db.loc["PCNet", "commentOnPaper"] = 38
comments_original_db.loc["Med-SA", "commentOnPaper"] = 39
comments_original_db.loc["HERMES", "commentOnPaper"] = 40
comments_original_db.loc["HERMES", "MSD Pancreas Tumour"] = 41
comments_original_db.loc["HERMES", "AMOS"] = 42
comments_original_db.loc["MedLSAM", "commentOnPaper"] = 43
comments_original_db.loc["DeSAM", "commentOnPaper"] = 44
comments_original_db.loc["SETR", "commentOnPaper"] = 45
comments_original_db.loc["DoDNet", "commentOnPaper"] = 46

textual_comments_primary_db = pandas.DataFrame()
for row, col in product(comments_original_db.index, comments_original_db.columns):
    value = comments_original_db.loc[row, col]
    if not pandas.isna(value):
        textual_comments_primary_db.loc[row, col] = comments_original_dict[int(value)]


# - Best in litrature
comments_best_dict = {
    0: r"Results from UNet with the MultiTalent approach \citep{10.1007/978-3-031-43898-1_62}.",
    1: r"Average Dice score between CHAOS CT and MRI (97.08\% and 88.8\%).",
    2: r"Average Dice score between MM-WHS CT and MRI (88.64\% and 30.88\%).",
    3: r"TS v2 in Table 6 \citep{zhao2025modelrulealluniversal}.",
    4: r"Average Dice score between BraTS2019 and BraTS2020 datasets.",
    5: r"Supervised approach \citep{10.1007/978-3-031-43898-1_62}.",
    6: r"Average Dice score between CHAOS CT and MRI (96.88\% and 80.84\%).",
    7: r"Supervised approach \citep{10.1007/978-3-031-43898-1_62}, mean between organ and tumor Dice scores.",
    8: r"Average Dice score between MM-WHS CT and MRI (91.25\% and 20.87\%).",
    9: r"With bbox \citep{du2024segvol}.",
    10: r"Used MedSAM Tight Oracle Box prompt \citep{zhao2025modelrulealluniversal}.",
    11: r"Average Dice score between AMOS CT and MRI (88.97\% and 85.43\%).",
    12: r"Average Dice score between AMOS CT and MRI (85.82\% and 83.51\%).",
    13: r"Average Dice score between AMOS CT and MRI (86.36\% and 82.56\%).",
    14: r"Average Dice score between BraTS WT, ET, TC (91.58\%, 74.84\%, 86.22\%).",
    15: r"Average Dice score between BraTS WT, ET, TC (80.85\%, 65.69\%, 80.35\%).",
    16: r"Average Dice score between BraTS WT, ET, TC (91.58\%, 74.84\%, 86.22\%).",
    17: r"Using the 2 click prompt configuration.",
    18: r"From Table I and II of \citet{shen2025interactive3dmedicalimage} using the 5 clicks prompt configuration."
}
comments_best_db = pandas.DataFrame()
comments_best_db.loc["U-Net", "AMOS"] = 0
comments_best_db.loc["nnU-Net", "CHAOS"] = 1
comments_best_db.loc["nnU-Net", "MM-WHS"] = 2
comments_best_db.loc["nnU-Net", "TotalSegmentator"] = 3
comments_best_db.loc["Swin-Unet", "BraTS"] = 4
comments_best_db.loc["Swin UNETR", "AMOS"] = 5
comments_best_db.loc["Swin UNETR", "CHAOS"] = 6
comments_best_db.loc["Swin UNETR", "KiTS"] = 7
comments_best_db.loc["Swin UNETR", "MM-WHS"] = 8
comments_best_db.loc["SAM", "SegTHOR"] = 9
comments_best_db.loc["SAM", "ULS"] = 9
comments_best_db.loc["SAM", "BraTS"] = 14
comments_best_db.loc["SAM", "FLARE"] = 17
comments_best_db.loc["MedSAM", "BraTS"] = 15
comments_best_db.loc["MedSAM", "MSD Prostate"] = 10
comments_best_db.loc["MedSAM", "FLARE"] = 17
comments_best_db.loc["MedSAM", "AMOS"] = 10
comments_best_db.loc["MedSAM", "FeTA"] = 10
comments_best_db.loc["MedSAM", "AbdomenCT-1K"] = 10
comments_best_db.loc["MedSAM", "MSD Cardiac"] = 10
comments_best_db.loc["MedSAM", "SegTHOR"] = 10
comments_best_db.loc["MedSAM", "TotalSegmentator"] = 10
comments_best_db.loc["MedSAM", "TotalSegmentator Cardiac"] = 10
comments_best_db.loc["MedSAM", "TotalSegmentator Muscles"] = 10
comments_best_db.loc["MedSAM", "TotalSegmentator Organs"] = 10
comments_best_db.loc["MedSAM", "TotalSegmentator Ribs"] = 10
comments_best_db.loc["MedSAM", "TotalSegmentator Vertebrae"] = 10
comments_best_db.loc["SegResNet", "AMOS"] = 11
comments_best_db.loc["UniMiSS", "AMOS"] = 12
comments_best_db.loc["DeSD", "AMOS"] = 13
comments_best_db.loc["SAM-Med2D", "BraTS"] = 16
comments_best_db.loc["SAM-Med3D", "LASC"] = 17
comments_best_db.loc["SAM 2", "BraTS"] = 18
comments_best_db.loc["SAM 2", "MSD Lung Tumors"] = 18
comments_best_db.loc["SAM 2", "MSD Pancreas Tumour"] = 18
comments_best_db.loc["SAM 2", "LiTS / MSD Liver"] = 18
comments_best_db.loc["SAM 2", "MSD Spleen"] = 18
comments_best_db.loc["SAM 2", "LASC"] = 17
comments_best_db.loc["Medical SAM 2 (MedSAM-2)", "BraTS"] = 17
comments_best_db.loc["Medical SAM 2 (MedSAM-2)", "LASC"] = 17
comments_best_db.loc["EMedSAM", "FLARE"] = 17


textual_comments_best_db = pandas.DataFrame()
for row, col in product(comments_best_db.index, comments_best_db.columns):
    value = comments_best_db.loc[row, col]
    if not pandas.isna(value):
        textual_comments_best_db.loc[row, col] = comments_best_dict[int(value)]


# Save into the SQLite database

# - get the columns of the table, check that they are the same
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
columns_primary = cursor.execute("PRAGMA table_info(results_primary_comments)").fetchall()
columns_primary = [col[1] for col in columns_primary]
papers_primary = cursor.execute("SELECT ID FROM results_primary_comments").fetchall()
papers_primary = [paper[0] for paper in papers_primary]
columns_best = cursor.execute("PRAGMA table_info(results_best_comments)").fetchall()
columns_best = [col[1] for col in columns_best]
papers_best = cursor.execute("SELECT ID FROM results_best_comments").fetchall()
papers_best = [paper[0] for paper in papers_best]

# - primary

for row, col in product(textual_comments_primary_db.index, textual_comments_primary_db.columns):
    if row in papers_primary:
        if col in columns_primary:
            value = textual_comments_primary_db.loc[row, col]
            if not pandas.isna(value):
                cursor.execute(
                    f"UPDATE results_primary_comments SET [{col}] = ? WHERE ID = ?",
                    (value, row)
                )
        else:
            print(f"Column {col} not found in results_primary_comments table")
    else:
        print(f"Paper {row} not found in results_primary_comments table")

# - best

for row, col in product(textual_comments_best_db.index, textual_comments_best_db.columns):
    if row in papers_best:
        if col in columns_best:
            value = textual_comments_best_db.loc[row, col]
            if not pandas.isna(value):
                cursor.execute(
                    f"UPDATE results_best_comments SET [{col}] = ? WHERE ID = ?",
                    (value, row)
                )
        else:
            print(f"Column {col} not found in results_best_comments table")
    else:
        print(f"Paper {row} not found in results_best_comments table")



# Save and close
conn.commit()
conn.close()

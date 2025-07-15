import sqlite3

# updates the primary results table

DB_PATH = './GMMIS-Survey/database.sqlite'

MODEL = ''

RESULTS_TO_ADD = {
    # dataset_name: dice_score
    # or
    # dataset_name: (dice_score, comment)
}


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

if len(first_pub_date) < 6:
    raise RuntimeError("No date:", first_pub_date)

# Insert into results_primary with ID, Related Paper, Date, others as NULL
c.execute("""
    INSERT INTO results_primary (ID, [Related Paper], Date)
    VALUES (?, ?, ?)
""", (MODEL, MODEL, first_pub_date))

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
# Important: all results_* tables must have the same set of columns



# save and close
conn.commit()
conn.close()

# Database Instructions

Please find ```database.sqlite``` attached in this folder.

To view content, you should have "[SQLite3](https://www.sqlite.org/index.html) installed. 
The program often comes pre-installed on most operating systems. 
The isntallation process is easy, so we suggest you to install the latest version from the website.

Once you have it installed, you can open a file with

```bash
sqlite3 /path/to/database.sqlite
```

An interactive shell will be shown.

Here are some simple commands to display the full tables in the web browser:

```sql
-- Display the "models" table
.www
select * from models;
```

```sql
-- Display the "datasets" table
.www
select * from datasets;
```

```sql
-- Display the "results_primary" table
.www
select * from results_primary;
```

```sql
-- Display the "results_best" table
.www
select * from results_best;
```
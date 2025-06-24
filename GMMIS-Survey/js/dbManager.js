let db = null;

async function initializeDatabase() {
    if (db) {
        console.log("Database already initialized.");
        return; // Avoid re-initializing
    }
    try {
        // Configure where sql-wasm.wasm is located.
        const SQL = await initSqlJs({
            locateFile: filename => `./sql.js-gh-pages/dist/${filename}`
        });
        console.log("sql.js initialized!");
        // Fetch your SQLite database file
        const dbFilePath = 'database.sqlite';
        const response = await fetch(dbFilePath);
        if (!response.ok) {
            throw new Error(`Failed to fetch database file: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        db = new SQL.Database(new Uint8Array(buffer));
        console.log("Database loaded!");
    } catch (error) {
        console.error("Error initializing or loading database:", error);
    }
}

export async function startDatabase() {
    try {
        await initializeDatabase();
    } catch (error) {
        console.error("Initialization failed:", error);
    }
}

/**
 * Executes a SQL query on the loaded database.
 * @param {string} query The SQL query string.
 * @returns {Array} The result of the db.exec() call.
 */
export function executeQuery(query) {
    if (!db) {
        throw new Error("Database not loaded. Call initializeDatabase() first.");
    }
    return db.exec(query);
}

// Optional: Function to close the database if needed
export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        console.log("Database closed.");
    }
}


// Some other utility functions

export function getTableColumns(table) {
    let answer = executeQuery(`SELECT * FROM ${table} LIMIT 1;`);
    if (answer && answer.length > 0 && answer[0].columns) {
        return answer[0].columns;
    } else {
        console.warn(`Could not retrieve columns for table: ${table}`);
        return []; // Or return null, depending on your use case
    }
}

export function getTableNames() {
    let query = "SELECT name FROM sqlite_master WHERE type='table';";
    let result = executeQuery(query);

    if (result && result.length > 0 && result[0].values) {
        // Extract table names from the 'values' array
        return result[0].values.map(row => row[0]);
    } else {
        console.warn("Could not retrieve table names from the database.");
        return [];
    }
}


export function getAllUniqueElementsInColumn(column, table) {
    // get all elements
    let list_of_objects = executeQuery(`SELECT ${column} FROM ${table};`)
    list_of_objects = list_of_objects[0]['values'].map(element => element[0]);
    // make a list with all of them together
    let full_list = []
    list_of_objects.forEach(element => {
        if (! (element === null || element === undefined || element === '')) {
            // if the element is not null, undefined or empty string
            // split by comma and space, and add to full_list
            let divided_element = element.split(', ');
            full_list = full_list.concat(divided_element);
        }
    });
    // keep unique ones, order alphabetical
    let unique_sorted_list = [...new Set(full_list)].sort();
    return unique_sorted_list;
}

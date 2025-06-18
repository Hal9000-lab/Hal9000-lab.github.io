import { startDatabase, executeQuery } from './dbManager.js';
import { exportBibtexSetup } from './exportBibtexManager.js';

import { tabsManagerSetup } from './tabsManager.js';
import { dropdownMenuSetup } from './dropdownMenusManager.js';


import { resultsSetup } from './resultsManager.js';

//
//
// In here, UI elements and logic gets connected
//
//

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // First, load the database
        await startDatabase();
        console.log("startDatabase() started successfully.");

        // Citations export Manager
        exportBibtexSetup();
        console.log("exportBibtexSetup() started successfully.");

        // Tabs Manager
        tabsManagerSetup();
        console.log("tabsManagerSetup() started successfully.");

        // Dropdown menus
        dropdownMenuSetup();
        console.log("dropdownMenuSetup() started successfully.");

        // Results
        resultsSetup();
        console.log("resultsSetup() started successfully.");

    } catch (error) {
        console.error("Failed to initialize the app:", error);
        // Handle the error appropriately, e.g., display an error message to the user
    }
});
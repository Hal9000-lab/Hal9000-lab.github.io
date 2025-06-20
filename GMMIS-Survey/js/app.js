import { startDatabase, executeQuery } from './dbManager.js';
import { exportBibtexSetup } from './exportBibtexManager.js';
import { tabsManagerSetup } from './tabsManager.js';
import { dropdownMenuSetup } from './dropdownMenusManager.js';
import { resultsSetup } from './resultsManager.js';
import { tooltipSetup } from './tooltipManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Force scroll to top
        history.scrollRestoration = "manual";
        window.scrollTo(0,0);

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

        // Tooltip
        tooltipSetup();
        
        // Loading screen
        document.querySelector('div.loading').classList.add('hidden');

    } catch (error) {
        // Handle the error
        console.error("Failed to initialize the app:\n", error);
        document.querySelector('div.loading').classList.remove('hidden')
        document.querySelector('div.loading').classList.add('error');
    }
});
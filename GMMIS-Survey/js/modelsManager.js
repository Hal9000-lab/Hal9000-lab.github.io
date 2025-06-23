import { 
    executeQuery, 
    getTableColumns, 
    getTableNames,
    getAllUniqueElementsInColumn
    } from './dbManager.js';
import { 
    dropdownButtonGetAllInnerOptions, 
    updateDropdownButtonArrow,
    getStateOfChoiches,
    updateButtonCounterAndClearCross,
    compileChoicesIntoDropdownButton
    } from './dropdownMenusManager.js';

import { getEmptyContentHTML } from './emptyContent.js';

import { unwanted_models } from './unwanted_models.js';

import { modelsTableFormatter } from './modelsTableFormatter.js';


/**
 * Modifies the answer object inplace
 * @param {*} answer The raw answer of the main database query of getResultsTable()
 */
function removeUnwantedModelsInplace(answer) {
    answer[0]["values"] = answer[0]["values"].filter(row => {
        // Keep the row if its first element (model name) is NOT in the unwanted_models list
        // (unwanted models imported from outside)
        return !unwanted_models.includes(row[0]);
    });
    return;
}


/**
 * 
 * @param {Object} buttons_state_dict 
 * @param {String} column_to_order_by 
 * @returns 
 */
function getModelsTable(buttons_state_dict, column_to_order_by = undefined) {

    // By default display the whole table
    // build query
    
    
    
    
    const query = `SELECT * FROM models `;



    const answer = executeQuery(query);
    

    // Remove models that are in the database, but that we do not want to display
    // (answer, which is an array, so a pointer, is const, but it's 'content' may be changed)
    removeUnwantedModelsInplace(answer);
    if (answer.length == 0) {
        return getEmptyContentHTML('No results to be found with this query combination');
    }
    return modelsTableFormatter(answer);
}












export function modelsSetup() {
    const table_container = document.querySelector('div.minipage-container#models > div.table-display-box');



    table_container.innerHTML = getModelsTable({});
    return;


    ///////////////////    below to do /////////////////////

    
    // Other filters include framework, architecture, and release date
    let all_frameworks = getAllUniqueElementsInColumn('Framework', 'models');
    
    let all_architectures = getAllUniqueElementsInColumn('Architecture', 'models');

    let all_visual_backbones = getAllUniqueElementsInColumn('"Visual Backbone"', 'models');

    let all_release_dates = getAllUniqueElementsInColumn('"First Publication Date"', 'models');
    all_release_dates = [...new Set(all_release_dates.map(element => element.split('-')[0]) )];
    
    // - setup buttons
    const country_button = document.querySelector('button#models-filter-framework');
    const frameworks_button = document.querySelector('button#models-filter-framework');
    const architecture_button = document.querySelector('button#models-filter-architecture');
    const visual_backbone_button = document.querySelector('button#models-filter-visual-backbone');
    const release_dates_button = document.querySelector('button#models-filter-release-date');
    const total_vram_button = document.querySelector('button#models-filter-release-date');

    const buttons = [country_button, frameworks_button, architecture_button, visual_backbone_button, release_dates_button];
    const lists = [all_frameworks, all_architectures, all_visual_backbones, all_release_dates]; //// to do
    buttons.forEach((button, i) => {
        refillButton(button, lists[i]);
        if (lists[i].length <= 5) {
            const searchbox = button.parentNode.querySelector("div.search-input");
            searchbox.classList.add('hidden');
        }
    });
    
    // get area where table will be displayed
    const results_table_container = document.querySelector('div.minipage-container#results > div.table-display-box');

    // trigger the display of results
    var modelss_list_of_buttons = [ 
                frameworks_button, architecture_button, 
                visual_backbone_button, release_dates_button,
                total_vram_button
            ];
    var results_buttons_state = getStateOfChoiches(results_list_ob_buttons);
    window.addEventListener('click', (event) => {
        // we have to check wether the event fell on a choiche button,
        // and if the new state of choiches is different from the previous one.
        const targetIsRelevantButton = results_list_ob_buttons.some(button =>
            button.parentNode.contains(event.target) || button.parentNode === event.target
        );
        if (!targetIsRelevantButton) {
            // Click was not on a relevant button -> do nothing
            return;
        }
        const state = getStateOfChoiches(results_list_ob_buttons);
        if (JSON.stringify(results_buttons_state) === JSON.stringify(state)) {
            // nothing new happened -> do nothing
            return;
        } else {
            // state of buttons changes -> update table content
            results_buttons_state = state;
            results_table_container.innerHTML = getResultsTable(results_buttons_state);
        }
    });



}
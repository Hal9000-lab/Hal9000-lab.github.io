import { executeQuery, getTableColumns, getTableNames } from './dbManager.js';
import { 
    dropdownButtonGetAllInnerOptions, 
    updateDropdownButtonArrow,
    getStateOfChoiches,
    updateButtonCounterAndClearCross
    } from './dropdownMenusManager.js';

import { getEmptyContentHTML } from './emptyContent.js';

import { resultsTableFormatter } from './resultsTableFormatter.js';

import { unwanted_models } from './unwanted_models.js';

function getAllUniqueElementsInColumn(column, table) {
    // get all elements
    let list_of_objects = executeQuery(`SELECT ${column} FROM ${table};`)
    list_of_objects = list_of_objects[0]['values'].map(element => element[0]);
    // make a list with all of them together
    let full_list = []
    list_of_objects.forEach(element => {
        let divided_element = element.split(', ');
        full_list = full_list.concat(divided_element);
    });
    // keep unique ones, order alphabetical
    let unique_sorted_list = [...new Set(full_list)].sort();
    return unique_sorted_list;
}

function compileChoicesIntoDropdownButton(list_of_choices) {
    list_of_choices = list_of_choices.map(
        element => '<button>' + element + '</button>'
    );
    return list_of_choices.join(` `);
}

function refillButton(button, list_of_values) {
    // - remove options buttons
    const existingButtons = dropdownButtonGetAllInnerOptions(button);
    existingButtons.forEach(button => {
        button.remove();
    });
    // - add new option buttons
    const options_container = button.parentNode.querySelector('div.dropdown-content');
    const new_content = compileChoicesIntoDropdownButton(list_of_values);
    options_container.insertAdjacentHTML('beforeend', new_content);
    // Arrow
    updateDropdownButtonArrow(button);
    // Number and cross
    updateButtonCounterAndClearCross(button);
}


function _build_condition_models(column, list_of_options) {
    if (list_of_options.length == 0) {
        var sql_condition = `SELECT ID from models`;
    } else {
        var sql_condition = `
            SELECT ID from models
            WHERE (${list_of_options.map(el => `${column} LIKE "%`+el+'%"').join(' OR ')})
        `;
    }
    return sql_condition;
}
function _build_condition_models_date(column, list_of_options) {
    if (list_of_options.length == 0) {
        var sql_condition = `SELECT ID from models`;
    } else {
        var sql_condition = `
            SELECT ID from models
            WHERE strftime('%Y', ${column}) IN (${list_of_options.map(el => '"'+el+'"')})
        `;
    }
    return sql_condition;
}

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
 * Removes the empty columns, if any
 * @param {*} answer The raw answer of the main database query of getResultsTable()
 */
function removeEmptyColumnsInplace(answer) {
    // Input checks
    if (!answer || !answer[0] || !answer[0]['columns'] || !answer[0]['values'])
        return;
    const originalColumns = answer[0]['columns'];
    const originalValues = answer[0]['values'];
    if (originalValues.length === 0)
        return;

    // Determine which columns are empty
    const columnsToRemoveIndices = new Set(); // Use a Set for efficient lookup

    // Assume all columns are potentially empty until proven otherwise
    // Initialize an array to track if a column contains any non-empty value
    const hasNonEmptyValue = new Array(originalColumns.length).fill(false);

    // Iterate through each row and each cell to find non-empty values
    originalValues.forEach(row => {
        row.forEach((cellValue, colIndex) => {
            // If we find any non-empty value in this column, mark it
            if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
                hasNonEmptyValue[colIndex] = true;
            }
        });
    });

    // Mark columns for removal if they contain no non-empty values
    originalColumns.forEach((colName, colIndex) => {
        if (!hasNonEmptyValue[colIndex]) {
            columnsToRemoveIndices.add(colIndex);
        }
    });

    // Step 2: Create new arrays for columns and values, excluding the empty ones
    const newColumns = [];
    const newValues = [];
    originalColumns.forEach((colName, colIndex) => {
        if (!columnsToRemoveIndices.has(colIndex)) {
            newColumns.push(colName);
        }
    });
    originalValues.forEach(row => {
        const newRow = [];
        row.forEach((cellValue, colIndex) => {
            if (!columnsToRemoveIndices.has(colIndex)) {
                newRow.push(cellValue);
            }
        });
        newValues.push(newRow);
    });
    // Step 3: Update the answer object in place
    answer[0]['columns'] = newColumns;
    answer[0]['values'] = newValues;
    return;
}


/**
 * 
 * @param {Object} buttons_state_dict 
 * @param {String} column_to_order_by 
 * @returns 
 */
function getResultsTable(buttons_state_dict, column_to_order_by='') {

    // if the selection button is empty, do not display anything
    // if object in question (dataset, organ or whatever), framework, architecture, visual backbone or year are empty, consider any value
    if (buttons_state_dict['dropdown-dataset-organ-button'].length == 0) {
        return getEmptyContentHTML();
    }
    // build query
    // - find which datasets (columns of the results table) are of interest
    const main_button = document.querySelector('button#dropdown-dataset-organ-button');
    const main_button_text = main_button.querySelector('span.dropbtn-text').innerHTML;
    let sel = buttons_state_dict['dropdown-specific-dataset-organ-button'];
    let columns_selector = ``;
    switch (main_button_text) {
        case "Organs":
            // which datasets contain the specified organs ("Objects" in the datbase)
            let organs_query = `
                SELECT Name 
                FROM Datasets 
            `;
            if (sel.length != 0) {
                organs_query += `WHERE ${sel
                    .map((organ) => `Objects LIKE '%${organ}%'`)
                    .join(' OR ')}
                ;`;
            } else {
                organs_query += ';';
            }
            let organs_result = executeQuery(organs_query);
            columns_selector = organs_result[0]['values'].map(e => '"'+e[0]+'"').join(", ");
            break;
        case "Datasets":
            columns_selector = `${ sel.map(e => '"'+e+'"').join(', ') }`;
            break;
        case "Main Anatomical Structure":
            // Which datasets contain the specified anatomical structures
            let main_anatomical_structure_query = `
                SELECT Name
                FROM Datasets
            `;
            if (sel.length != 0) {
                main_anatomical_structure_query += `WHERE ${sel
                    .map((structure) => `"Main Anatomical Structure" LIKE '%${structure}%'`)
                    .join(' OR ')}
                ;`;
            } else {
                main_anatomical_structure_query += ';';
            }
            let main_anatomical_structure_result = executeQuery(main_anatomical_structure_query);
            columns_selector = main_anatomical_structure_result[0]['values'].map(e => '"' + e[0] + '"').join(", ");
            break;
        case "Anatomical Region":
            // Which datasets contain the specified anatomical regions
            let anatomical_region_query = `
                SELECT Name
                FROM Datasets
            `;
            if (sel.length != 0) {
                anatomical_region_query += `WHERE ${sel
                    .map((region) => `Region LIKE '%${region}%'`)
                    .join(' OR ')}
                ;`;
            } else {
                anatomical_region_query += ';';
            }
            let anatomical_region_result = executeQuery(anatomical_region_query);
            columns_selector = anatomical_region_result[0]['values'].map(e => '"' + e[0] + '"').join(", ");
            break;
        default:
            return getEmptyContentHTML();
    }
    if (columns_selector.length < 2) {
        return getEmptyContentHTML('No results to be found with this query combination');
    }
    // cross check: we need to check wether the retrieved columns are actually in the results columns
    const all_results_columns = getTableColumns('results_best');
    const column_selector_list = columns_selector.split(', ').map(e => e.replaceAll('"', ''))
    const filtered_column_selector_list = column_selector_list.filter(item => all_results_columns.includes(item));
    columns_selector = filtered_column_selector_list.map(e => '"' + e + '"').join(", ");
    columns_selector = '"Related Paper", strftime("%Y-%m", Date) AS Date, ' + columns_selector;
    // not null results
    const empty_rows_neutralizer = filtered_column_selector_list.map(e => '"' + e + '"').join(' IS NOT NULL OR ') + ' IS NOT NULL';
    // order by statement
    if (column_to_order_by.length > 0 && columns_selector.includes(column_to_order_by)) {
        const asc_desc = (column_to_order_by.includes('Related Paper')) ? 'ASC' : 'DESC';
        var order_by_statement = `
            ORDER BY 
                CASE 
                    WHEN ${column_to_order_by} IS NULL THEN 1 ELSE 0 END, ${column_to_order_by} ${asc_desc}`;
    }
    else
        var order_by_statement = ``;
    // Results table query
    let query = `
        SELECT ${columns_selector}
        FROM results_best
        WHERE "Related Paper" IN
            (
                ${_build_condition_models('Framework', buttons_state_dict['results-model-filter-framework'])}
                
                INTERSECT
                
                ${_build_condition_models('Architecture', buttons_state_dict['results-model-filter-architecture'])}
                
                INTERSECT
                
                ${_build_condition_models('"Visual Backbone"', buttons_state_dict['results-model-filter-visual-backbone'])}
                
                INTERSECT
                
                ${_build_condition_models_date('"First Publication Date"', buttons_state_dict['results-model-filter-release-date'])}
            )
            AND
            (
                ${empty_rows_neutralizer}
            )
        ${order_by_statement}
        ;
    `;
    const answer = executeQuery(query); 
    // Remove models that are in the database, but that we do not want to display
    // (answer, which is an array, so a pointer, is const, but it's 'content' may be changed)
    removeUnwantedModelsInplace(answer);
    removeEmptyColumnsInplace(answer);
    if (answer.length == 0) {
        return getEmptyContentHTML('No results to be found with this query combination');
    }
    return resultsTableFormatter(answer);
}












export function resultsSetup() {
    // When datasets button is pressed, and an option is selected,
    // update the content and choices of the selection button.
    // - button text
    // - button content
    const organs_or_dataset_button = document.querySelector('button#dropdown-dataset-organ-button');
    const organs_or_dataset_choices_buttons = dropdownButtonGetAllInnerOptions(organs_or_dataset_button);
    const object_multichoice_button = document.querySelector('button#dropdown-specific-dataset-organ-button');
    const object_multichoice_container = object_multichoice_button.parentNode.querySelector('div.dropdown-content');
    
    // - get all datasets
    let all_datasets = getAllUniqueElementsInColumn('Name', 'datasets');

    // get all organs
    let all_organs = getAllUniqueElementsInColumn('Objects', 'datasets');

    // get all main anatomical structures
    let all_main_anatomical_structures = getAllUniqueElementsInColumn('"Main Anatomical Structure"', 'datasets');

    // get all main anatomical structures
    let all_anatomical_regions = getAllUniqueElementsInColumn('"Region"', 'datasets');

    let content_dict = {
        'Organs': all_organs,
        'Datasets': all_datasets,
        'Main Anatomical Structure': all_main_anatomical_structures,
        'Anatomical Region': all_anatomical_regions,
    }

    // Now, based on the user choice on the organs_or_dataset_button, 
    // we change content of object_multichoice_button
    organs_or_dataset_choices_buttons.forEach(first_btn => {
        first_btn.addEventListener('click', () => {
            // Content
            let choice = first_btn.innerHTML;
            // refill second button
            refillButton(object_multichoice_button, content_dict[choice]);
            // Name
            let name = `Select ${choice}`;
            let name_element = object_multichoice_button.querySelector('span.dropbtn-text');
            name_element.innerHTML = name;
        });
    });


    // Other filters include framework, architecture, and release date
    let all_frameworks = getAllUniqueElementsInColumn('Framework', 'models');
    
    let all_architectures = getAllUniqueElementsInColumn('Architecture', 'models');

    let all_visual_backbones = getAllUniqueElementsInColumn('"Visual Backbone"', 'models');

    let all_release_dates = getAllUniqueElementsInColumn('"First Publication Date"', 'models');
    all_release_dates = [...new Set(all_release_dates.map(element => element.split('-')[0]) )];
    
    // - put values into buttons
    const frameworks_button = document.querySelector('button#results-model-filter-framework');
    const architecture_button = document.querySelector('button#results-model-filter-architecture');
    const visual_backbone_button = document.querySelector('button#results-model-filter-visual-backbone');
    const release_dates_button = document.querySelector('button#results-model-filter-release-date');

    const buttons = [frameworks_button, architecture_button, visual_backbone_button, release_dates_button];
    const lists = [all_frameworks, all_architectures, all_visual_backbones, all_release_dates];
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
    var results_list_ob_buttons = [
                organs_or_dataset_button, object_multichoice_button, 
                frameworks_button, architecture_button, 
                visual_backbone_button, release_dates_button
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






    // when a column name is touched, whatever it is, the table will be ordered by that column
    window.addEventListener('click', (event) => {
        // check if there's a table in the page with class results
        const table = document.querySelector('table.results');
        if (! table)
            return;
        // check if a header element was clicked
        const header_elements = Array(...table.querySelectorAll('table.results th'));
        if (header_elements.length == 0)
            return;
        const hit = header_elements.some(el =>
            el.contains(event.target) || el === event.target
        );
        if (!hit)
            return;
        // Get the name of the column
        var column_name = `"${event.target.innerHTML.trim()}"`;
        // Reprint the table
        results_table_container.innerHTML = getResultsTable(results_buttons_state, column_name);
        // Style table element
        const new_table = document.querySelector('table.results');
        const new_header_elements = Array(...new_table.querySelectorAll('table.results th'));
        new_header_elements.forEach(element => {
            if (element.innerHTML == event.target.innerHTML)
                element.classList.add('focused');
            else
                element.classList.remove('focused');
        });

    });

    // results can be long, use the tooltip to display infos when hover on a number
    window.addEventListener('click', (event) => {
        // get tooltip object
        const tooltip = document.querySelector('div.tooltip');
        // if the mouse touched the tooltip, do nothing, els ehide it and continue
        if (tooltip.contains(event.target))
            return;
        tooltip.classList.add('hidden');
        tooltip.unscrolledX = undefined;
        // check if there's a table in the page with class results
        const table = document.querySelector('table.results');
        if (! table)
            return;
        // check if a number element was clicked
        const table_elements = Array(...table.querySelectorAll('table.results tbody td.number'));
        if (table_elements.length == 0)
            return;
        const hit = table_elements.some(el =>
            el.contains(event.target) || el === event.target
        );
        if (!hit)
            return;
        
        // display tooltip
        const number_bb = event.target.getBoundingClientRect();
        const table_bb = results_table_container.getBoundingClientRect();
        const tooltip_x =  (number_bb.left + number_bb.right)/2 - 4 + window.scrollX;
        const tooltip_y =  (number_bb.top + number_bb.bottom)/2 - 6 + window.scrollY;
        tooltip.style.top = `${tooltip_y}px`;
        tooltip.style.left = `${tooltip_x}px`;
        tooltip.biasScrollX = results_table_container.scrollLeft;

        const model = event.target.classList[1].replaceAll('_', ' ');
        const dataset = event.target.classList[2].replaceAll('_', ' ');
        tooltip.querySelector('span.free-text').innerHTML = `Model: ${model}<br>Dataset: ${dataset}`;

        tooltip.classList.remove('hidden');
    });
    // scroll the tooltip with the table
    results_table_container.addEventListener('scroll', (event) => {
        // return if the table did not scroll left
        if (results_table_container.scrollLeft == 0)
            return;
        // get tooltip object
        const tooltip = document.querySelector('div.tooltip');
        // return if tooltip is not visible
        if (tooltip.classList.contains('hidden'))
            return;
        // add a property to tooltip to cache the "unscrolled position"
        if (!tooltip.unscrolledX) {
            tooltip.unscrolledX = parseFloat(tooltip.style.left);
        }

        // add scroll
        const tooltip_x =  tooltip.unscrolledX - results_table_container.scrollLeft + tooltip.biasScrollX;
        tooltip.style.left = `${tooltip_x}px`;
    });

}
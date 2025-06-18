import { executeQuery, getTableColumns, getTableNames } from './dbManager.js';
import { 
    dropdownButtonGetAllInnerOptions, 
    updateDropdownButtonArrow,
    getStateOfChoiches
    } from './dropdownMenusManager.js';

import { getEmptyContentHTML } from './emptyContent.js';

import { resultsTableFormatter } from './resultsTableFormatter.js';

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


function getResultsTable(buttons_state_dict) {

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
            columns_selector = '*';
    }
    if (columns_selector.length < 2) {
        return getEmptyContentHTML();
    }
    columns_selector = '"Related Paper", strftime("%Y-%m", Date) AS Date, ' + columns_selector;
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
        ;
    `;
    const answer = executeQuery(query);
    if (answer.length == 0) {
        return getEmptyContentHTML();
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
            const results_table_container = document.querySelector('div.minipage-container#results > div.table-display-box');
            results_table_container.innerHTML = getResultsTable(results_buttons_state);
        }
    });

}
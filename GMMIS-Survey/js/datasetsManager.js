import { 
    executeQuery, 
    getTableColumns, 
    getTableNames,
    getAllUniqueElementsInColumn
    } from './dbManager.js';
import { 
    getStateOfChoiches,
    refillButton
    } from './dropdownMenusManager.js';

import { getEmptyContentHTML } from './emptyContent.js';

import { datasetsTableFormatter } from './datasetsTableFormatter.js';


function _build_condition_datasets(column, list_of_options) {
    if (list_of_options.length == 0) {
        var sql_condition = `SELECT Name FROM datasets`;
    } else {
        var sql_condition = `
            SELECT Name FROM datasets
            WHERE (${list_of_options.map(el => `${column} LIKE "%`+el+'%"').join(' OR ')})
        `;
    }
    return sql_condition;
}

/**
 * 
 * @param {Object} buttons_state_dict 
 * @param {String} column_to_order_by 
 * @returns 
 */
function getDatasetsTable(buttons_state_dict, column_to_order_by = undefined) {

    // By default display the whole table
    // build query

    // Sorting statement
    let sorting_statement = '';
    if (column_to_order_by) {
        switch (column_to_order_by) {
            case '"Name"':
                sorting_statement = 'ORDER BY "Name"';
                break;
            case '"N Tot"':
                sorting_statement = `
                ORDER BY 
                    CASE 
                        WHEN "N Tot" IS NULL THEN 1 ELSE 0 END, "N Tot" DESC;
                `;
                break;
            default:
                console.warn(`No sorting statement found for column ${column_to_order_by}`);
                sorting_statement = '';
                break;
        }
    }

    // Filters
    const filter_related_datasets = _build_condition_datasets('"Sub-dataset"', buttons_state_dict['related-dataset-filter']);
    const filter_imaging_modalities = _build_condition_datasets('"Imaging Modality"', buttons_state_dict['modality-filter']);
    const filter_classes = _build_condition_datasets('"Objects"', buttons_state_dict['classes-filter']);
    const filter_anatomical_structures = _build_condition_datasets('"Main Anatomical Structure"', buttons_state_dict['anatomical-structure-filter']);
    const filter_regions = _build_condition_datasets('"Region"', buttons_state_dict['region-filter']);

    // Final query
    const query = `
        SELECT * 
        FROM datasets
        WHERE "Name" IN (
            ${filter_related_datasets}
            INTERSECT 
            ${filter_imaging_modalities}
            INTERSECT
            ${filter_classes}
            INTERSECT
            ${filter_anatomical_structures}
            INTERSECT
            ${filter_regions}
        )
        ${sorting_statement}    
    ;`;

    // Execute the query
    const answer = executeQuery(query);
    if (answer.length == 0) {
        return getEmptyContentHTML('No results to be found with this query combination');
    }
    return datasetsTableFormatter(answer);
    
}






export function datasetsSetup() {

    const table_container = document.querySelector('div.minipage-container#datasets > div.table-display-box');

    // Filters
    let all_related_datasets = getAllUniqueElementsInColumn('"Sub-dataset"', 'datasets');
    let all_imaging_modalities = getAllUniqueElementsInColumn('"Imaging Modality"', 'datasets');
    let all_classes = getAllUniqueElementsInColumn('"Objects"', 'datasets');
    let all_anatomical_structures = getAllUniqueElementsInColumn('"Main Anatomical Structure"', 'datasets');
    let all_regions = getAllUniqueElementsInColumn('"Region"', 'datasets');
    
    // locate buttons
    const related_datasets_button = document.querySelector('div.minipage-container#datasets button#related-dataset-filter');
    const imaging_modalities_button = document.querySelector('div.minipage-container#datasets button#modality-filter');
    const classes_button = document.querySelector('div.minipage-container#datasets button#classes-filter');
    const anatomical_structures_button = document.querySelector('div.minipage-container#datasets button#anatomical-structure-filter');
    const regions_button = document.querySelector('div.minipage-container#datasets button#region-filter');
    
    // fill buttons options
    const buttons = [related_datasets_button, imaging_modalities_button, classes_button, anatomical_structures_button, regions_button];
    const lists = [all_related_datasets, all_imaging_modalities, all_classes, all_anatomical_structures, all_regions];
    
    buttons.forEach((button, i) => {
        refillButton(button, lists[i]);
        if (lists[i].length <= 5) {
            const searchbox = button.parentNode.querySelector("div.search-input");
            searchbox.classList.add('hidden');
        }
    });

    // trigger the display of results
    var buttons_state = getStateOfChoiches(buttons);
    var sorted_column = undefined; // no column is sorted by default
    
    // Show table right away
    table_container.innerHTML = getDatasetsTable(buttons_state, sorted_column);
    
    
    window.addEventListener('click', (event) => {
        // we have to check wether the event fell on a choiche button,
        // and if the new state of choiches is different from the previous one.
        const targetIsRelevantButton = buttons.some(button =>
            button.parentNode.contains(event.target) || button.parentNode === event.target
        );
        if (!targetIsRelevantButton) {
            // Click was not on a relevant button -> do nothing
            return;
        }
        const state = getStateOfChoiches(buttons);
        if (JSON.stringify(buttons_state) === JSON.stringify(state))
            // nothing new happened -> do nothing
            return;
        
        // state of buttons changes -> update table content
        buttons_state = state;
        table_container.innerHTML = getDatasetsTable(buttons_state, sorted_column);

        // just for the Classes button, make selected classes twinkle

        const all_selected_objects = state['classes-filter'];
        const all_displayed_classes = table_container.querySelectorAll('td.objects span');
        all_displayed_classes.forEach(element => {
            // - first reset them all
            element.classList.remove('twinkle');
            // - light up only the selected ones
            if (all_selected_objects.some(obj => obj === element.innerHTML)) {
                element.classList.add('twinkle');
            }
        });
        // known bug: when table is redrawn, focused header is lost, but sorting is kept
    });



    // when a column name is touched, whatever it is, the table will be ordered by that column
    window.addEventListener('click', (event) => {
        // check if there's a table in the page with class results
        const table = document.querySelector('table.datasets');
        if (! table)
            return;
        // check if a header element was clicked
        const header_elements = Array(...table.querySelectorAll('table.datasets thead .selectable'));
        if (header_elements.length == 0)
            return;
        const hit = header_elements.some(el =>
            el.contains(event.target) || el === event.target
        );
        if (!hit)
            return;

        let target = event.target;
        if (target.tagName == 'I')
            target = target.parentNode;


        // Get the name of the column
        const mapper = {
            // mapper from class name sqlite column name
            'name': 'Name',
            'numbers': 'N Tot',
        }
        const target_class = target.classList[0];
        if (!mapper[target_class]) {
            console.warn(`No mapper found for class name ${target_class}`);
            return;
        }

        // Get the column name from the mapper
        sorted_column = `"${mapper[target_class]}"`;
        
        // Reprint the table
        table_container.innerHTML = getDatasetsTable(buttons_state, sorted_column);
        
        // Style table pulsing header
        const new_table = document.querySelector('table.datasets');
        const new_header_elements = Array(...new_table.querySelectorAll('table.datasets thead .selectable'));
        new_header_elements.forEach(element => {
            if (element.innerHTML == target.innerHTML)
                element.classList.add('focused');
            else
                element.classList.remove('focused');
        });

    });

}
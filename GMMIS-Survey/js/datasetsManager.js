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



    const query = `
        SELECT * 
        FROM datasets
        ${sorting_statement}
    ;`;


    // Execute the query
    const answer = executeQuery(query);

    console.log("db answer", answer);
    

    if (answer.length == 0) {
        return getEmptyContentHTML('No results to be found with this query combination');
    }
    return datasetsTableFormatter(answer);
    
    /*   old


    
    
    // Filters
    var affils_list = [];
    if (! buttons_state_dict['country-filter'].length == 0) {
        buttons_state_dict['country-filter'].forEach(country => {
            affils_list.push(...country_to_list_of_affiliations_map[country]);
        });
    }
    const filter_affiliations = _build_condition_models('"Major Affiliations"', affils_list);

    const filter_release_years = _build_condition_models_date('"First Publication Date"', buttons_state_dict['release-year-filter']);

    const filter_first_publishers = _build_condition_models('"First Publisher"', buttons_state_dict['first-publisher-filter']);

    const filter_last_publishers = _build_condition_models('"Last Publisher"', buttons_state_dict['last-publisher-filter']);

    const filter_frameworks = _build_condition_models('"Framework"', buttons_state_dict['frameworks-filter']);

    const filter_architectures = _build_condition_models('"Architecture"', buttons_state_dict['architecture-filter']);

    const filter_visual_backbones = _build_condition_models('"Visual Backbone"', buttons_state_dict['backbone-filter']);

    // Final query
    const query = `
        SELECT * 
        FROM models
        WHERE ID IN (
            ${filter_affiliations}
            INTERSECT 
            ${filter_release_years}
            INTERSECT
            ${filter_first_publishers}
            INTERSECT
            ${filter_last_publishers}
            INTERSECT
            ${filter_frameworks}
            INTERSECT
            ${filter_architectures}
            INTERSECT
            ${filter_visual_backbones}
        )
        ${sorting_statement}    
    ;`;

    // Execute the query
    const answer = executeQuery(query);
    if (answer.length == 0) {
        return getEmptyContentHTML('No results to be found with this query combination');
    }
    return modelsTableFormatter(answer);
    */
}












export function datasetsSetup() {

    const table_container = document.querySelector('div.minipage-container#datasets > div.table-display-box');

    
    
    
    /*
    
    
    // Other filters include framework, architecture, and release date
    let all_affiliations = getAllUniqueElementsInColumn('"Major Affiliations"', 'models');
    let all_countries = getSetOfCountriesFromAffiliations(all_affiliations);
    all_countries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    
    let all_release_dates = getAllUniqueElementsInColumn('"First Publication Date"', 'models');
    all_release_dates = [...new Set(all_release_dates.map(element => element.split('-')[0]) )];
    
    let all_first_publishers = getAllUniqueElementsInColumn('"First Publisher"', 'models');
    
    let all_last_publishers = getAllUniqueElementsInColumn('"Last Publisher"', 'models');
    
    let all_frameworks = getAllUniqueElementsInColumn('"Framework"', 'models');
    
    let all_architectures = getAllUniqueElementsInColumn('Architecture', 'models');
    
    let all_visual_backbones = getAllUniqueElementsInColumn('"Visual Backbone"', 'models');


    // - locate buttons
    const country_button = document.querySelector('div.minipage-container#models button#country-filter');
    const release_year_button = document.querySelector('div.minipage-container#models button#release-year-filter');
    const first_publisher_button = document.querySelector('div.minipage-container#models button#first-publisher-filter');
    const last_publisher_button = document.querySelector('div.minipage-container#models button#last-publisher-filter');
    const frameworks_button = document.querySelector('div.minipage-container#models button#frameworks-filter');
    const architecture_button = document.querySelector('div.minipage-container#models button#architecture-filter');
    const visual_backbone_button = document.querySelector('div.minipage-container#models button#backbone-filter');

    // fill buttons options

    const buttons = [country_button, release_year_button, first_publisher_button, last_publisher_button, frameworks_button, architecture_button, visual_backbone_button];
    const lists = [all_countries, all_release_dates, all_first_publishers, all_last_publishers, all_frameworks, all_architectures, all_visual_backbones];
    buttons.forEach((button, i) => {
        refillButton(button, lists[i]);
        if (lists[i].length <= 5) {
            const searchbox = button.parentNode.querySelector("div.search-input");
            searchbox.classList.add('hidden');
        }
    });

    */    
    const buttons = [];


    // trigger the display of results
    var buttons_state = getStateOfChoiches(buttons);
    var sorted_column = undefined; // no column is sorted by default
    
    // Show table right away
    table_container.innerHTML = getDatasetsTable(buttons_state, sorted_column);
    
    /*
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
        if (JSON.stringify(buttons_state) === JSON.stringify(state)) {
            // nothing new happened -> do nothing
            return;
        } else {
            // state of buttons changes -> update table content
            buttons_state = state;
            table_container.innerHTML = getDatasetsTable(buttons_state, sorted_column);
        }
        // known bug: when table is redrawn, focused header is lost, but sorting is kept
    });


    /**/

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
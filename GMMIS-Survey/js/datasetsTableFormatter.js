import { executeQuery } from "./dbManager.js";
import { getEmptyContentHTML } from "./emptyContent.js";


const expected_db_columns = [
    "Name","Full Name","Description",
    "Sub-dataset","Imaging Modality",
    "Objects","Main Anatomical Structure","Region",
    "Links URL","Links Text","Cit Keys",
    "N Tot","N with Labels"
]
const header = `
<thead>
    <tr>
        <th class="name selectable">Dataset Name<br><i>Full Name</i> </th>
        <th class="sub-datasets">Related Dataset</th>
        <th class="modality">Imaging Modality</th>
        <th class="objects">Classes</th>
        <th class="main-structures">Main Anatomical Structure</th>
        <th class="region">Anatomical Region</th>
        <th class="resources">Resources</th>
        <th class="numbers selectable">N. Tot Images<br>(N. with labels)</th>
    </tr>
</thead>
`;
const columns_classes = [
    'name', 'sub-datasets',
    'modality', 'objects',
    'main-structures',
    'region', 'resources', 'numbers'
];


function _formatNameTitle(row) {
    // row[0] is the name, row[1] is the longer title
    const name = row[0];
    const title = row[1];
    
    let html = `
        <div>
            <span class="name">${name}</span>
            <span class="title">${title}</span>
        </div>
    `;
    return html;
}

function _formatDescription(row) {
    // row[2] is the long description of the dataset
    const description = row[2];
    return description;
}

function _formatListOfItems(element) {
    if (! element || element.length < 1)
        return '';
    // element is a comma separated list
    let elements_list = element.split(',').map(affiliation => affiliation.trim());
    elements_list.sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    let html = elements_list.map(e => `<span>${e}</span>`).join(' ');
    html = '<div>' + html + '</div>';
    return html;
}

function _formatLinks(row) {
    // 8: links
    // 9: text
    if (row[8].length == 0)
        return ' ';
    const links = row[8].split(',').map(e => e.trim());
    const texts = row[9].split(',').map(e => e.trim());
    let html = '';
    links.forEach((l, i) => {
        html += `<span><a href="${l}" target="_blank">${texts[i]}</a></span>`
    });
    return `<div>${html}</div>`
}

function _formatNumbers(row) {
    // row[11] is the number of images (total)
    // row[12] is the number of images coupled with label masks
    const n_tot = row[11];
    const n_labels = row[12];
    const html = `
        <div>
            <span class="ntot">${n_tot}</span>
            <span class="nlabels">(${n_labels})</span>
        </div>
    `;
    return html;
}


const unavailable_html = '<span>&#10006;</span>';




function _formatRow(row) {
    // row
    const dataset_class_name = row[0].replaceAll(' ', '_');
    let row_html = '';
    // start first row
    row_html += `<tr class="${dataset_class_name}"><td colspan="13">`;
    // a row contains a subtable with the same columns of the parent table, but with two rows:
    // one for the content as shown in the table header
    // another fill row for the description
    row_html += `<table><tr class="content">`
    
    columns_classes.forEach((column_class, ic) => {
        let element = `<td class="${column_class}">`;
        switch (column_class) {
            case 'name':
                element += _formatNameTitle(row);
                break;
            case 'sub-datasets':
                element += _formatListOfItems(row[3]);
                break;
            case 'modality':
                element += _formatListOfItems(row[4]);
                break;
            case 'objects':
                element += _formatListOfItems(row[5]);
                break;
            case 'main-structures':
                element += _formatListOfItems(row[6]);
                break;
            case 'region':
                element += _formatListOfItems(row[7]);
                break;
            case 'resources':
                element += _formatLinks(row);
                break;
            case 'numbers':
                element += _formatNumbers(row);
                break;
            default:
                break;
        }
        element += `</td>`;
        row_html += element;
    });
    

    // end row of subtable, begin the next one
    row_html += '</tr><tr class="description"><td colspan="13">';
    row_html += _formatDescription(row);
    
    // end second row of subtable with one element, end subtable, end big row element and row
    row_html += '</td></tr></table></td></tr>';
    return row_html;
}

const table_title = `
    <div class="table-title">
        <span>
            Table of Datasets
        </span>
    </div>
`;

export function datasetsTableFormatter(resultsTableQueryAnswer) {
    let columns = resultsTableQueryAnswer[0]['columns'];
    let values = resultsTableQueryAnswer[0]['values'];

    if (!columns || !values || columns.length == 0 || values.length == 0)
        return getEmptyContentHTML('No results to be found with this query combination');

    // if returned columns are not exactly as expected (content and order), return error
    if (columns.length != expected_db_columns.length ||
        !expected_db_columns.every((c, i) => c === columns[i])) {
        return getEmptyContentHTML('The database returned unexpected columns. Please contact the administrator.');
    }

    // Fixed header
    let out = '<table class="styled-table datasets">';
    out += header;

    // Body
    // (each line has a class that is the framework of the model, the model ID)
    // (each body element has a class that is the column html id)
    out += `<tbody>`;
    values.forEach((row, ir) => {
        out += _formatRow(row);
    });
    out += `</tbody>`;

    // Close table
    out += `</table>`;

    out = out.replaceAll('null', ' ');

    out = table_title + out;

    return out;
}


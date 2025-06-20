import { executeQuery } from "./dbManager.js";

export function resultsTableFormatter(resultsTableQueryAnswer, colorHeader, colorRowsDark, colorsRowLight) {
    let columns = resultsTableQueryAnswer[0]['columns'];
    let values = resultsTableQueryAnswer[0]['values'];

    // Coloring: if a model is generalist or task-specific, we mark it appropriate colors
    // (we use a class in css tag of the row)
    // Get all frameworks for the included models
    const models_inclusion_list = values.map(r => `"${r[0]}"`).join(', ');
    const frameworks_result = executeQuery(
        `SELECT ID, Framework FROM models WHERE ID IN (${models_inclusion_list})`
    )[0]['values'];
    // - build a map from ID to Framework
    const idToFramework = {};
    frameworks_result.forEach(r => {
        idToFramework[r[0]] = r[1];
    });
    // - for each model in models_inclusion_list, get its framework in order
    const model_ids = values.map(r => r[0]);
    const frameworks_classes = model_ids.map(id =>
        idToFramework[id].trim().toLowerCase().replaceAll(' ', '-')
    );

    // Identify the highest value per each column (dict{column_name : value}) except "related Paper" and "Date"
    let highest_values = [];
    columns.forEach((c, ci) => {
        if (c == 'Related Paper' || c == 'Date')
            highest_values.push('-');
        else {
            const all_val_of_c = values.map(r => r[ci]);
            highest_values.push(Math.max(...all_val_of_c));
        }
    });

    
    let out = '<table class="styled-table results"><thead><tr>';
    columns.forEach(c => {
        const c_spaceless = c.replaceAll(' ', '_');
        out += `<th id="${c_spaceless}"> ${c} </th>`;
    });
    out += '</tr></thead><tbody>';
    values.forEach((row, i) => {
        const model_name_h = row[0].replaceAll(' ', '_');
        out += `<tr class="${frameworks_classes[i]}">`;
        row.forEach((element, i) => {
            const dataset_h = columns[i].replaceAll(' ', '_');
            const class_h = (element == highest_values[i]) ? ' highest' : '';
            if (['Related§Paper', 'Date'].includes(dataset_h))
                out += `<td>` + element + '</td>';
            else
                out += `<td class="number ${model_name_h} ${dataset_h} ${class_h}">` + element + '</td>';
        });
        out += '</tr>';
    });
    out += '</tbody></table>';
    out = out.replaceAll('null', ' ');
    return out;
}

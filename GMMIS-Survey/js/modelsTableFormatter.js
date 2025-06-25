import { executeQuery } from "./dbManager.js";
import { getEmptyContentHTML } from "./emptyContent.js";


const expected_db_columns = [
    'ID','Title','Major Affiliations',
    'First Publication Date','First Publisher','First Publication Link','First Publication BibKey',
    'Last Publication Date','Last Publisher','Last Publication Link','Last Publication BibKey',
    'Code',
    'Framework','Architecture','Visual Backbone',
    'Millions of Parameters','Number of GFlops',
    'Resources', 'Resources Total V-RAM'
]
const header = `
<thead>
    <tr>
        <th rowspan="2" class="name-title selectable">Model Name<br><i>Publication Title</i> </th>
        <th rowspan="2" class="research-groups">Main Research Groups</th>
        <th rowspan="1" class="publication-info">First Publication<br><i>Last Publication</i></th>
        <th rowspan="2" class="code">Code</th>
        <th rowspan="2" class="arch-vis-backbone">Architecture<br><i>Visual Backbone</i></th>
        <th rowspan="2" class="params selectable">N. Params (M)<br><i>GFLOPs</i></th>
        <th rowspan="2" class="resources selectable">Computing Resources<br><i>Total V-RAM</i></th>
    </tr>
    <tr>
        <th class="publication-info publication-info-content">
            <table class="publication-info-table">
                <tr>
                    <td class="date selectable">Date</td>
                    <td class="publisher">Publisher</td>
                </tr>
            </table>
        </th>
    </tr>
</thead>
`;
const columns_classes = [
    'name-title', 'research-groups',
    'publication-info-content',
    'code', 'arch-vis-backbone',
    'params', 'resources'
];

const table_title = `
    <div class="table-title">
        <span>
            Table of Models
        </span>
    </div>
`;

function _formatNameTitle(row) {
    // row[0] is the model name, row[1] is the publication title
    const model_name = row[0];
    const publication_title = row[1];
    
    let html = `
        <div>
            <span class="model-name">${model_name}</span>
            <span class="publication-title">${publication_title}</span>
        </div>
    `;
    return html;
}

function _formatResearchGroups(row) {
    // row[2] is the major affiliations
    // as a comma separated list
    const affiliations = row[2].split(',').map(affiliation => affiliation.trim());
    let html = affiliations.map(affiliation => `<span>${affiliation}</span>`).join(' ');
    html = '<div>' + html + '</div>';
    return html;
}

function _formatPublicationInfo(row) {
    // row[3] : first publication date
    // row[4] : first publisher
    // row[5] : first publication link
    // 
    // row[7] : last publication date if any
    // row[8] : last publisher if any
    // row[9] : last publication link if any
    const first_pub_date = row[3].slice(0, 7); // YYYY-MM
    const first_pub_publisher = row[4];
    const first_pub_link = row[5];
    let html = `
        <table class="publication-info-table">
            <tr>
                <td class="date">${first_pub_date}</td>
                <td class="publisher"><a href="${first_pub_link}" target="_blank">${first_pub_publisher}</a></td>
            </tr>
    `;
    if (row[7] && row[8] && row[9]) {
        const last_pub_date = row[7].slice(0, 7); // YYYY-MM
        const last_pub_publisher = row[8];
        const last_pub_link = row[9];
        html += `
            <tr class="last-publication">
                <td class="date">${last_pub_date}</td>
                <td class="publisher"><a href="${last_pub_link}" target="_blank">${last_pub_publisher}</a></td>
            </tr>
        `;
    }
    html += `</table>`;
    return html;
}

function _formatCode(row) {
    // row[11] is the code link if any
    const code_link = row[11];
    if (code_link) {
        return `<a href="${code_link}" target="_blank">
            <img src="../assets/img_icon_github.png" style="width: 20px;">
        </a>`;
    } else {
        return '<span>&#10006;</span>';
    }
}

function _formatArchVisBackbone(row) {
    // row[13] is the architecture, row[14] is the visual backbone
    let architecture = row[13];
    let visual_backbone = row[14];

    // process architecture
    if (architecture.includes('SAM'))
        architecture = architecture
                        .split(',')
                        .map(e => e.trim())
                        .filter(e => ! e.includes('SAM'))
                        .join(', ');

    const html = `
        <div>
            <span class="architecture">${architecture}</span>
            <span class="visual-backbone">${visual_backbone}</span>
        </div>
    `; 
    return html;
}

function _formatParams(row) {
    // row[15] is the number of millions of parameters 
    // row[16] is the number of GFLOPs
    const millions_of_params = row[15];
    const gflops = row[16];
    const html = `
        <div>
            <span class="m-params">${millions_of_params}</span>
            <span class="gflops">${gflops}</span>
        </div>
    `;
    return html;
}


const resources_unavailable_html = '<span>&#10006;</span>';

function _scorporateResources(resources) {
    // Total V-RAM must be inferred from the resources

    if (!resources || resources === 'null') {
        console.warn('Resources are not available:', resources);
        return -1;
    }

    // Split by comma and trim
    const parts = resources.split(',').map(s => s.trim());

    if (parts.length === 0 || parts.length === 1) {
        console.log('No resources found in resources:', resources);
        return -1;
    }

    // number of gpus: we don't know in which part it is
    // we know that it is a pure number "10", "8", "1", ..
    let num_gpus = null;
    const num_gpus_idx = parts.findIndex(p => (/^\d+$/.test(p)));
    if (num_gpus_idx !== -1)
        num_gpus = parseInt(parts[num_gpus_idx], 10);
    else {
        console.warn('No number of GPUs found in resources:', resources);
        return -1;
    }

    // brand (Nvidia, AMD, etc.)
    let brand = null;
    let brandIdx = parts.findIndex(p => /nvidia|amd|intel/i.test(p));
    if (brandIdx !== -1)
        brand = parts[brandIdx];
    else {
        console.warn('Unknown brand found in resources:', resources);
        return -1;
    }

    // gpu model and memory
    let gpu_memory = null;
    let gpu_model = null;
    let gpu_memoryIdx = parts.findIndex(p => /\w+\s+(\d+)GB$/i.test(p));
    if (gpu_memoryIdx !== -1) {
        gpu_memory = parts[gpu_memoryIdx].match(/(\d+)GB$/i);
        if (gpu_memory) {
            gpu_memory = gpu_memory[1]; // gpu_memory is an array like ["24GB", "24"]
            gpu_memory = parseInt(gpu_memory, 10);
            gpu_model = parts[gpu_memoryIdx];
        }
    } else {
        console.warn('No GPU memory found in resources:', resources);
        return -1;
    }

    // actual memory used per gpu (if any, there's a nnGB alone in the list)
    // No: "GTX Titan 24GB" -> skip
    // Yes: "24GB" -> 24
    let memory_used = null;
    let memoryUsedIdx = parts.findIndex(p => /^(\d+)GB$/i.test(p));
    if (memoryUsedIdx !== -1) {
        memory_used = parts[memoryUsedIdx].match(/^(\d+)GB$/i);
        if (memory_used) {
            memory_used = parseInt(memory_used[1], 10);
        }
    }

    //  server (e.g., "DXG-1 Server")
    let server = null;
    let serverIdx = parts.findIndex(p => /server/i.test(p));
    if (serverIdx !== -1) {
        server = parts[serverIdx];
    }

    // total v-ram
    let total_vram = null;
    if (num_gpus && memory_used) {
        total_vram = num_gpus * memory_used;
    } else if (num_gpus && gpu_memory) {
        total_vram = num_gpus * gpu_memory;
    } else {
        console.warn('Could not compute total V-RAM from resources:', resources, 
            'num_gpus:', num_gpus, 'gpu_memory:', gpu_memory, 
            'memory_used:', memory_used);
            return -1;
    }

    // return structured info
    const info_dict = {
        num: num_gpus,
        brand: brand,
        model: gpu_model,
        memory_used: memory_used,
        server: server,
        total_vram: total_vram
    }
    return info_dict;
}

function _formatResources(row) {
    // row[17] is the resources
    // Total V-RAM must be inferred from the resources
    const resources = row[17];
    if (!resources || resources === 'null') {
        return resources_unavailable_html;
    }

    const resources_info = _scorporateResources(resources);
    if (resources_info === -1)
        return resources_unavailable_html;

    // format the output
    let html = `
        <div>
            <span class="resources-info">
                ${resources_info.num} ${resources_info.brand} ${resources_info.model}
    `;
    if (resources_info.memory_used) {
        html += `(of which ${resources_info.memory_used}GB used)`;
    }
    if (resources_info.server) {
        html += ` on a ${resources_info.server}`;
    }
    html += `</span>`;
    if (resources_info.total_vram) {
        html += `<span class="vram">${resources_info.total_vram}GB</span>`;
    }
    html += `</div>`;

    return html;
}

function _formatRow(row) {
    // row
    const model_name_class = row[0].replaceAll(' ', '_');
    const framework_class = row[12].replaceAll(' ', '_').toLowerCase();
    let row_html = '';
    // start first row
    row_html += `<tr class="${model_name_class} ${framework_class}">`;
    // first cycle on the columns, to add the first publication date and publisher
    columns_classes.forEach((column_class, ic) => {
        let element = `<td class="${column_class}">`;
        switch (column_class) {
            case 'name-title':
                element += _formatNameTitle(row);
                break;
            case 'research-groups':
                element += _formatResearchGroups(row);
                break;
            case 'publication-info-content':
                element += _formatPublicationInfo(row);
                break;
            case 'code':
                element += _formatCode(row);
                break;
            case 'arch-vis-backbone':
                element += _formatArchVisBackbone(row);
                break;
            case 'params':
                element += _formatParams(row);
                break;
            case 'resources':
                element += _formatResources(row);
                break;
            default:
                break;
        }
        element += `</td>`;
        row_html += element;
    });
    // end row
    row_html += '</tr>';
    return row_html;
}

export function modelsTableFormatter(resultsTableQueryAnswer) {
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
    let out = '<table class="styled-table models">';
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


export function formatTable(tableSQLdata, colorHeader, colorRowsDark, colorsRowLight) {
    let columns = tableSQLdata[0]["columns"];
    let values = tableSQLdata[0]["values"];
    
    let out = '<table class="styled-table"><thead>';
    columns.forEach(c => {
        out += '<th>' + c + '</th>';
    });
    out += '</tr></thead><tbody>';
    values.forEach(row => {
        out += '<tr>';
        row.forEach(element => {
            out += '<td>' + element + '</td>';
        });
        out += '</tr>';
    });
    out += '</tbody></table>';
    return out;
}


let a = `
div>
        <table class="styled-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Points</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Dom</td>
                    <td>6000</td>
                </tr>
                <tr class="active-row">
                    <td>Melissa</td>
                    <td>5150</td>
                </tr>
                <!-- and so on... -->
            </tbody>
        </table>
    </div>
`
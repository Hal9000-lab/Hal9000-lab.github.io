

export function resultsTableFormatter(resultsTableQueryAnswer, colorHeader, colorRowsDark, colorsRowLight) {
    let columns = resultsTableQueryAnswer[0]["columns"];
    let values = resultsTableQueryAnswer[0]["values"];
    
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
    out = out.replaceAll('null', ' ');
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
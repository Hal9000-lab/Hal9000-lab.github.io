

export function getEmptyContentHTML(alert_text='Use another query combination') {
    let out = `<div id="empty-table"><h3>Try again!</h3><p>${alert_text}</p></div>`;
    return out;
}
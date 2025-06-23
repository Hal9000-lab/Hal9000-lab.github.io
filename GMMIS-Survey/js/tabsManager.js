var lastClickedTabButton = 'none clicked yet';

function hideSubelementsExcept(object, css_identifier) {
    const childern = object.querySelectorAll(':scope > div');
    const to_show = object.querySelectorAll(css_identifier);
    childern.forEach(c => {
        c.style.display = "none";
    });
    to_show.forEach(c => {
        c.style.display = "block";
    });
}

function switchContentToDisplay(tab_button) {
    const content_container = document.getElementById('main-container');
    const buttonName = tab_button.innerHTML;
    switch (buttonName) {
        case 'Models':
            hideSubelementsExcept(content_container, 'div.minipage-container#models');
            break;
        case 'Datasets':
            hideSubelementsExcept(content_container, 'div.minipage-container#datasets');
            break;
        case 'Results':
            hideSubelementsExcept(content_container, 'div.minipage-container#results');
            break;
        default:
            hideSubelementsExcept(content_container, 'div#empty-table');
            break;
    }
}

export function tabsManagerSetup() {
    const tabButtons = document.querySelectorAll('#main-tabs button');
    const contentContainer = document.getElementById('main-container');
    
    // Set and unset active tab
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => {
                btn.classList.remove('active-tab');
            });
            button.classList.add('active-tab');
        });
    });
    
    // setup first view (same as case models)
    hideSubelementsExcept(contentContainer, "div#empty-table");

    // Set event for each tab button
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (lastClickedTabButton != button.innerHTML) {
                // if different do something
                lastClickedTabButton = button.innerHTML;
                switchContentToDisplay(button);
            }
        });
    });

    // When screen first load, the event listener does not fire.
    // Fire it manually (one-shot), depending on which is the active tab button
    tabButtons.forEach(button => {
        if (button.classList.contains('active-tab'))
            switchContentToDisplay(button);
    });

}
export function tooltipSetup() {

    const tooltip_text_container = document.querySelector('div.tooltip > div.text-container');
    
    // when somebody double-clicks on tooltip area, hide it
    tooltip_text_container.addEventListener('dblclick', () => {
        tooltip_text_container.parentNode.classList.add('hidden');
    });

}

export function tooltipHide() {
    const tooltip = document.querySelector('div.tooltip');
    if (tooltip) {
        tooltip.classList.add('hidden');
    }
}
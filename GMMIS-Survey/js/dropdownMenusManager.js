// instructions:
// 
// The following will work automatically across the whole document
// if you follow the prototype
// (class name is important, ids are not and can be changet at will)
// class 'single' and 'multi' determine the underlying logic.



let down_arrow = "&#9662;";
let up_arrow = "&#9652;";
let empty_button = "";

export function dropdownButtonGetAllInnerOptions(button) {
    const buttons_container = button.parentNode.querySelector('div.dropdown-content');
    const out = buttons_container.querySelectorAll('button');
    return out;
}

function dropdownButtonHasOptionsInside(button) {
    const inner_buttons = dropdownButtonGetAllInnerOptions(button)
    return inner_buttons.length > 0;
}

export function updateDropdownButtonArrow(button) {
    // select elements
    const dropdown = button.parentNode.querySelector('div.dropdown-content');
    const arrow_span = button.querySelector('span.dropbtn-arrow');
    if (! dropdownButtonHasOptionsInside(button)) {
        arrow_span.innerHTML = empty_button;
        return;
    }
    if (dropdown.style.visibility == "" || dropdown.style.visibility == "hidden") {
        arrow_span.innerHTML = down_arrow;
    } else {
        arrow_span.innerHTML = up_arrow;
    }
}

function closeDropdownMenu(button) {
    const dropdown = button.parentNode.querySelector('div.dropdown-content');
    dropdown.style.visibility = "hidden";
    updateDropdownButtonArrow(button);
}

export function addEventListenerToDropdownButtonSingleSelect(button) {
    // we have to use "Event Delegation" since the choiches can be dynamically
    // allocated or deallocated, which the container always stays the same
    // input is the main button
    let choiches_container = button.parentNode.querySelector('div.dropdown-content');
    if (! choiches_container.classList.contains('single')) {
        return;
    }
    // we attach the click event to the container
    choiches_container.addEventListener('click', (event) => {
        // Check if the clicked element is a button
        if (event.target.tagName === 'BUTTON') {
            const clickedButton = event.target;

            // get parent div, then all button children
            const parentDiv = clickedButton.parentNode;
            const allButtons = parentDiv.querySelectorAll('button');

            // remove 'selected' from all these
            allButtons.forEach(btn => {
                btn.classList.remove('selected');
            });

            // put selected only on this one
            clickedButton.classList.add('selected');

            // Set name of dropdown main button to the selected object
            const parent_parent_div = parentDiv.parentNode;
            const main_button = parent_parent_div.querySelector('button.dropbtn');
            const text_span = main_button.querySelector('span.dropbtn-text');
            text_span.innerHTML = clickedButton.innerHTML;
        }
    });
}

export function updateButtonCounterAndClearCross(button) {
    // button is the main button
    const counter_span = button.querySelector('span.dropbtn-counter');
    const clear_span = button.parentNode.querySelector('span.dropbtn-clear-content');
    const all_selected_items = button.parentNode.querySelector('div.dropdown-content').querySelectorAll('button.selected');
    let how_many = all_selected_items.length;
    if (how_many != 0) {
        counter_span.innerHTML = `(${how_many})`;
        clear_span.style.display = 'inline-block';
    } else {
        counter_span.innerHTML = '';
        clear_span.style.display = 'none';
    }
}

export function addEventListenerToDropdownButtonMultiSelect(button) {
    // we have to use "Event Delegation" since the choices can be dynamically
    // allocated or deallocated, which the container always stays the same
    // input is the main button
    let choices_container = button.parentNode.querySelector('div.dropdown-content');
    if (! choices_container.classList.contains('multi')) {
        return;
    }
    // we attach the click event to the container
    choices_container.addEventListener('click', (event) => {
        // Check if the clicked element is a button
        if (event.target.tagName === 'BUTTON') {
            const clickedButton = event.target;
            if (clickedButton.classList.contains('selected')) {
                clickedButton.classList.remove('selected');
            } else {
                clickedButton.classList.add('selected');
            }
            // put count of selected items in the button
            // also display the delete button if some items are selected
            const parent_parent_div = clickedButton.parentNode.parentNode;
            const main_button = parent_parent_div.querySelector('button.dropbtn');
            updateButtonCounterAndClearCross(main_button);
        }
    });
}

function addEventListenerClearChoiches(button) {
    // input is the main button
    let choices_container = button.parentNode.querySelector('div.dropdown-content');
    if (! choices_container.classList.contains('multi')) {
        return;
    }
    let span_clear_choices = button.parentNode.querySelector('span.dropbtn-clear-content');
    span_clear_choices.addEventListener('click', () => {
        const choiches = choices_container.querySelectorAll('button');
        choiches.forEach(btn => {
            btn.classList.remove('selected');
        });
        updateButtonCounterAndClearCross(button);
    });
}

function filterContent(button, filter_string) {
    const all_options = dropdownButtonGetAllInnerOptions(button);
    let filter = filter_string.toLowerCase();
    all_options.forEach(option => {
        let content = option.innerHTML.toLowerCase();
        if ( content.includes(filter) || filter.trim() === "") {
            option.classList.remove('hidden');
        } else {
            option.classList.add('hidden');
        }
    });
}



export function getStateOfChoiches(list_of_buttons) {
    // input: a list of dropdown buttons elements
    // we take all buttons names, all active choices, and see
    // which one are active at this moment
    let out_dict = {};
    list_of_buttons.forEach(button => {
        const id = button.id;
        const choiches = dropdownButtonGetAllInnerOptions(button);
        let active_choices = [];
        if (choiches) {
            choiches.forEach(choice_btn => {
                if (choice_btn.classList.contains('selected')) {
                    const chn = choice_btn.innerHTML;
                    active_choices.push(chn);
                }
            });
        } 
        out_dict[id] = active_choices;
    });
    return out_dict;
}




export function dropdownMenuSetup() {
    // variables i'll need
    const all_dropdown_buttons = document.querySelectorAll('button.dropbtn');
    
    // all dropdown main buttons hide/whow
    all_dropdown_buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            // get parent div
            const par_div = btn.parentNode;
            // select the dropdown div of that div
            const dropdown = par_div.querySelector('div.dropdown-content');
            const arrow_span = btn.querySelector('span.dropbtn-arrow');
            // implement logic
            if (dropdownButtonHasOptionsInside(btn)) {
                if (dropdown.style.visibility == "" || dropdown.style.visibility == "hidden") {
                    dropdown.style.visibility = "visible";
                } else {
                    dropdown.style.visibility = "hidden";
                }
                updateDropdownButtonArrow(btn);
            }
        });
        
    });

    // styling, single and multi-select logic
    all_dropdown_buttons.forEach(button => {
        // - single select logic
        addEventListenerToDropdownButtonSingleSelect(button);
        // - multi-select logic
        addEventListenerToDropdownButtonMultiSelect(button);
        addEventListenerClearChoiches(button);
    });

    // every time a dropdown button is pressed, it affect all other dropdown buttons:
    // - the curtains of all other buttons close
    // - the arrow is updated accordingly
    all_dropdown_buttons.forEach(button => {
        button.addEventListener('click', () => {
            // all other dropdown buttons in the page get closed
            all_dropdown_buttons.forEach(other_button => {
                if (button != other_button) {
                    closeDropdownMenu(other_button);
                }
            });
        });
    });

    // Set the arrows automatically
    all_dropdown_buttons.forEach(button => {
        updateDropdownButtonArrow(button);
    });

    // Make so that if the user clicks anywhere in the window
    // that is not on any button-related content, all buttons close
    window.addEventListener('click', (event) => {
        if (!event.target.closest('.dropdown')) {
            all_dropdown_buttons.forEach(button => {
                closeDropdownMenu(button);
                const search_input = button.parentNode.querySelector('input');
                search_input.value = '';
            });
        }
    });

    // Search listener
    all_dropdown_buttons.forEach(btn => {
        const search_input = btn.parentNode.querySelector('input');
        search_input.addEventListener('keyup', () => {
            const filter_text_content = search_input.value;
            filterContent(btn, filter_text_content);
        });
        
    });


    // Set-unset listener to make blinker disappear
    const all_dropdown_buttons_with_unset_blinker = Array
        .from(all_dropdown_buttons)
        .filter(button => button.classList.contains('unset'));
    
    all_dropdown_buttons_with_unset_blinker.forEach(button => {
        const dropdown_container = button.parentNode.querySelector('div.dropdown-content');
        dropdown_container.addEventListener("click", () => {
            const selected = dropdown_container.querySelectorAll('button.selected');
            if (selected.length > 0) {
                button.classList.remove('unset');
            }
        });
    });

}


export function compileChoicesIntoDropdownButton(list_of_choices) {
    list_of_choices = list_of_choices.map(
        element => '<button>' + element + '</button>'
    );
    return list_of_choices.join(` `);
}

export function refillButton(button, list_of_values) {
    // - remove options buttons
    const existingButtons = dropdownButtonGetAllInnerOptions(button);
    existingButtons.forEach(button => {
        button.remove();
    });
    // - add new option buttons
    const options_container = button.parentNode.querySelector('div.dropdown-content');
    const new_content = compileChoicesIntoDropdownButton(list_of_values);
    options_container.insertAdjacentHTML('beforeend', new_content);
    // Arrow
    updateDropdownButtonArrow(button);
    // Number and cross
    updateButtonCounterAndClearCross(button);
}




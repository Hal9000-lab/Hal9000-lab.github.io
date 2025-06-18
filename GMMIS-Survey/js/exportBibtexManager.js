/**
 * Handles copying text to the clipboard for a publication-specific button.
 * @param {HTMLButtonElement} button The button element that triggered the copy.
 * @param {string} textToCopy The string of text to copy.
 * @param {string} originalButtonText The original text of the button, to revert to.
 */
async function copyToClipboard(button, textToCopy, originalButtonText) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(textToCopy);
            console.log('Publication text copied to clipboard:', textToCopy);
            button.textContent = 'Copied!';
        } else {
            console.warn('Clipboard API not available, used  method for publication button.');
            const bibtextDialog = document.getElementById('bibtex-container');
            bibtextDialog.style.visibility = 'visible';
            const bibtextTextarea = document.getElementById('bibtex-textarea');
            bibtextTextarea.value = textToCopy
        }
    } catch (err) {
        console.error('Failed to copy publication text to clipboard: ', err);
        button.textContent = 'Failed!';
    } finally {
        setTimeout(() => {
            button.textContent = originalButtonText;
        }, 3000);
    }
}




const bibtextArxiv = `@article{moglia2025generalistmodelsmedicalimage,\r\n\
    title={\r\n\
        Generalist Models in Medical Image Segmentation:\r\n\
        A Survey and Performance Comparison with\r\n\
        Task-Specific Approaches\r\n\
    },\r\n\
    author={
        Andrea Moglia and Matteo Leccardi and Matteo\r\n\
        Cavicchioli and Alice Maccarini and Marco Marcon\r\n\
        and Luca Mainardi and Pietro Cerveri\r\n\
    },\r\n\
    year={2025},\r\n\
    eprint={2506.10825},\r\n\
    archivePrefix={arXiv},\r\n\
    primaryClass={eess.IV},\r\n\
    url={https://arxiv.org/abs/2506.10825},\r\n\
}`;
const bibtexJournal = `Cit will go here`;



export function exportBibtexSetup() {
    // ArXiv citation export
    const copyButtonArxiv = document.getElementById('arxiv-bibtex-button'); 
    if (copyButtonArxiv) {
        const originalTextArxiv = copyButtonArxiv.textContent;
        copyButtonArxiv.addEventListener('click', () => {
            copyToClipboard(copyButtonArxiv, bibtextArxiv, originalTextArxiv);
        });
    }
    // Journal citation export
    // 
    // Close bibtex dialogue
    const closeBibtexButton = document.getElementById('bibtex-close');
    const bibtextDialog = document.getElementById('bibtex-container');
    if (closeBibtexButton) {
        closeBibtexButton.addEventListener('click', () => {
            bibtextDialog.style.visibility = 'hidden';
        });
    }
}


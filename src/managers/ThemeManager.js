// Theme switching for the Settings dialog.
// The theme is stored as <html data-theme="..."> (all colors live in style.css)
// and remembered in localStorage so it survives reloads.

const STORAGE_KEY = "painting-app-theme";
const DEFAULT_THEME = "classic";

// Mascot icon (Font Awesome) shown in the header badge for each theme.
const THEMES = {
    classic: "fa-palette",
    pikachu: "fa-bolt",
    blastoise: "fa-droplet",
    venusaur: "fa-leaf"
};

const readSaved = () => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved in THEMES ? saved : DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
};

export function applyTheme(theme) {
    if (!(theme in THEMES)) theme = DEFAULT_THEME;

    document.documentElement.dataset.theme = theme;

    const emblem = document.querySelector("#theme-emblem i");
    if (emblem) emblem.className = `fa-solid ${THEMES[theme]}`;

    try {
        localStorage.setItem(STORAGE_KEY, theme);
    } catch {
        // Storage blocked (private mode etc.): the theme still applies for this visit.
    }
}

export default function initThemes() {
    const dialog = document.getElementById("settings-dialog");
    const openButton = document.getElementById("settings-button");
    const closeButton = dialog.querySelector(".settings-close");
    const radios = dialog.querySelectorAll('input[name="theme"]');

    const current = readSaved();
    applyTheme(current);
    radios.forEach((radio) => { radio.checked = radio.value === current; });

    // Themes preview live as soon as a card is picked.
    radios.forEach((radio) => {
        radio.addEventListener("change", () => applyTheme(radio.value));
    });

    openButton.addEventListener("click", () => {
        dialog.showModal();
        dialog.querySelector('input[name="theme"]:checked')?.focus();
    });

    closeButton.addEventListener("click", () => dialog.close());

    // Clicking the dimmed backdrop closes the dialog.
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
    });

    dialog.addEventListener("close", () => openButton.focus());
}

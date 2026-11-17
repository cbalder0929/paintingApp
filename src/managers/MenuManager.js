import Scene from './SceneManager.js';
import History from './HistoryManager.js';
import Interaction from './InteractionManager.js';

// Commands share their state and handlers between menus and keyboard shortcuts.
export default function initMenus(app) {
    let filename = 'Untitled.paint.json';
    let saved = JSON.stringify(Scene.serialize());
    let clipboard = null;
    let zoom = 1;
    let grid = false;
    const host = document.getElementById('header-menus');
    host.querySelectorAll('.header-menu-placeholder').forEach((node) => node.remove());
    const status = document.createElement('footer');
    status.id = 'status-bar';
    status.setAttribute('role', 'status');
    document.getElementById('app').append(status);
    const dirty = () => JSON.stringify(Scene.serialize()) !== saved;
    const discard = () => !dirty() || window.confirm('Discard unsaved changes to this drawing?');
    const download = (blob, name) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const save = (as = false) => {
        const name = as || filename === 'Untitled.paint.json' ? window.prompt('Save drawing as:', filename) : filename;
        if (!name?.trim()) return;
        filename = name.trim().endsWith('.paint.json') ? name.trim() : `${name.trim()}.paint.json`;
        saved = JSON.stringify(Scene.serialize());
        download(new Blob([JSON.stringify({ format: 'painting-app', version: 1, objects: JSON.parse(saved) }, null, 2)], { type: 'application/json' }), filename);
    };
    const setZoom = (value) => {
        const next = Math.max(0.1, Math.min(8, value));
        const center = Scene.world.toLocal({ x: app.screen.width / 2, y: app.screen.height / 2 });
        zoom = next;
        Scene.world.scale.set(zoom);
        Scene.world.position.set(app.screen.width / 2 - center.x * zoom, app.screen.height / 2 - center.y * zoom);
        Scene.refreshOverlay();
        update();
    };
    const resetView = () => {
        zoom = 1;
        Scene.world.scale.set(1);
        Scene.world.position.set(0, 0);
        Scene.refreshOverlay();
    };
    const openInput = document.createElement('input');
    openInput.type = 'file';
    openInput.accept = '.json,.paint.json';
    openInput.hidden = true;
    document.body.append(openInput);
    openInput.addEventListener('change', async () => {
        const file = openInput.files[0];
        if (!file) return;
        try {
            if (file.size > 10000000) throw new Error('Drawing files must be smaller than 10 MB.');
            const data = JSON.parse(await file.text());
            if (data.format !== 'painting-app' || data.version !== 1) throw new Error('Choose a Painting App drawing (.paint.json).');
            const objects = Scene.deserialize(data.objects);
            if (!discard()) return;
            Scene.world.removeChildren();
            objects.forEach((obj) => Scene.world.addChild(obj));
            Scene.setSelection([]);
            filename = file.name;
            saved = JSON.stringify(Scene.serialize());
            History.clear();
            resetView();
        } catch (error) { window.alert(`Could not open drawing: ${error.message}`); }
        finally { openInput.value = ''; update(); }
    });
    const copy = () => { clipboard = Scene.serialize(Scene.selection); };
    const paste = () => {
        const objects = Scene.deserialize(clipboard);
        objects.forEach((obj) => { obj.x += 20; obj.y += 20; });
        Scene.insert(objects);
        clipboard = Scene.serialize(objects);
    };
    const image = async () => {
        Scene.overlay.visible = false;
        try {
            app.renderer.render(app.stage);
            return await app.renderer.extract.base64({ target: app.stage, frame: app.screen });
        } finally { Scene.overlay.visible = true; }
    };
    const commands = [];
    const selected = () => Scene.selection.length > 0;
    const menus = {
        File: [
            ['New', 'Ctrl+N', () => { if (discard()) { Scene.world.removeChildren(); Scene.setSelection([]); filename = 'Untitled.paint.json'; saved = '[]'; History.clear(); resetView(); } }],
            ['Open…', 'Ctrl+O', () => openInput.click()],
            null,
            ['Save', 'Ctrl+S', () => save()],
            ['Save As…', 'Ctrl+Shift+S', () => save(true)],
            ['Export PNG…', '', async () => { const response = await fetch(await image()); download(await response.blob(), filename.replace(/\.paint\.json$/, '') + '.png'); }],
            null,
            ['Print…', 'Ctrl+P', async () => {
                const preview = window.open('', '_blank');
                if (!preview) throw new Error('Allow pop-ups to open the print preview.');
                try {
                    preview.document.title = filename;
                    const img = preview.document.createElement('img');
                    img.style.cssText = 'max-width:100%;height:auto';
                    img.src = await image();
                    preview.document.body.append(img);
                    await img.decode();
                    preview.focus(); preview.print();
                } catch (error) { preview.close(); throw error; }
            }]
        ],
        Edit: [
            ['Undo', 'Ctrl+Z', () => History.undo(), () => History.canUndo],
            ['Redo', 'Ctrl+Y', () => History.redo(), () => History.canRedo],
            null,
            ['Cut', 'Ctrl+X', () => { copy(); Scene.deleteSelection(); }, selected],
            ['Copy', 'Ctrl+C', copy, selected],
            ['Paste', 'Ctrl+V', paste, () => Boolean(clipboard?.length)],
            ['Duplicate', 'Ctrl+D', () => { copy(); paste(); }, selected],
            ['Delete', 'Delete', () => Scene.deleteSelection(), selected],
            null,
            ['Select All', 'Ctrl+A', () => Scene.setSelection([...Scene.world.children])],
            ['Deselect All', 'Escape', () => Scene.setSelection([]), selected],
            null,
            ['Group', 'Ctrl+G', () => Scene.groupSelection(), () => Scene.selection.length > 1],
            ['Ungroup', 'Ctrl+Shift+G', () => Scene.ungroupSelection(), () => Scene.selection.some((obj) => obj.meta.kind === 'group')]
        ],
        View: [
            ['Zoom In', 'Ctrl++', () => setZoom(zoom * 1.25)],
            ['Zoom Out', 'Ctrl+-', () => setZoom(zoom / 1.25)],
            ['Actual Size', 'Ctrl+0', resetView],
            ['Fit Drawing', '', () => {
                if (!Scene.world.children.length) return resetView();
                const bounds = Scene.world.getLocalBounds();
                zoom = Math.max(0.1, Math.min(8, (app.screen.width - 60) / Math.max(bounds.width, 1), (app.screen.height - 60) / Math.max(bounds.height, 1)));
                Scene.world.scale.set(zoom);
                Scene.world.position.set(app.screen.width / 2 - (bounds.x + bounds.width / 2) * zoom, app.screen.height / 2 - (bounds.y + bounds.height / 2) * zoom);
                Scene.refreshOverlay();
            }],
            null,
            ['Grid', '', () => { grid = !grid; document.getElementById('pixi-container').classList.toggle('show-grid', grid); }, null, () => grid],
            ['Tools', '', () => { const panel = document.getElementById('tool-panel'); panel.hidden = !panel.hidden; }, null, () => !document.getElementById('tool-panel').hidden],
            ['Status Bar', '', () => { status.hidden = !status.hidden; }, null, () => !status.hidden],
            null,
            ['Full Screen', '', async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }, null, () => Boolean(document.fullscreenElement)]
        ]
    };
    const close = () => host.querySelectorAll('details').forEach((menu) => { menu.open = false; });
    const run = async (command) => {
        if (Interaction.drag || (command.enabled && !command.enabled())) return;
        close();
        try { await command.action(); } catch (error) { window.alert(error.message); }
        update();
    };
    for (const [name, items] of Object.entries(menus)) {
        const menu = document.createElement('details');
        menu.className = 'app-menu';
        const title = document.createElement('summary');
        title.textContent = name;
        menu.append(title);
        const popup = document.createElement('div');
        popup.className = 'menu-popup';
        popup.setAttribute('role', 'menu');
        menu.append(popup);
        title.addEventListener('click', () => { host.querySelectorAll('details').forEach((other) => { if (other !== menu) other.open = false; }); });
        popup.addEventListener('keydown', (event) => {
            const buttons = [...popup.querySelectorAll('button:not(:disabled)')];
            const index = buttons.indexOf(document.activeElement);
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }
        });
        title.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') { event.preventDefault(); menu.open = true; popup.querySelector('button:not(:disabled)')?.focus(); } });
        for (const item of items) {
            if (!item) { popup.append(document.createElement('hr')); continue; }
            const [label, shortcut, action, enabled, checked] = item;
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', checked ? 'menuitemcheckbox' : 'menuitem');
            const text = document.createElement('span');
            text.textContent = label;
            const hint = document.createElement('kbd');
            hint.textContent = shortcut;
            button.append(text, hint);
            const command = { button, shortcut, action, enabled, checked };
            commands.push(command);
            button.addEventListener('click', () => run(command));
            popup.append(button);
        }
        host.insertBefore(menu, host.querySelector('label'));
    }
    function update() {
        for (const command of commands) {
            command.button.disabled = Boolean(Interaction.drag || (command.enabled && !command.enabled()));
            if (command.checked) command.button.setAttribute('aria-checked', String(command.checked()));
        }
        document.title = `${dirty() ? '* ' : ''}${filename} — Painting App`;
        status.textContent = `${filename}${dirty() ? ' • Unsaved changes' : ''} | ${Scene.world.children.length} objects | ${Scene.selection.length} selected | ${Math.round(zoom * 100)}%`;
    }
    document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.app-menu')) close(); });
    window.addEventListener('keydown', (event) => {
        if (event.target.closest('input, textarea, [contenteditable], dialog')) return;
        if (event.key === 'Escape' && host.querySelector('details[open]')) { close(); event.preventDefault(); return; }
        let key = event.key.toLowerCase();
        if (key === '=') key = '+';
        const shortcut = `${event.ctrlKey || event.metaKey ? 'ctrl+' : ''}${event.shiftKey && key !== '+' ? 'shift+' : ''}${key}`;
        const command = commands.find((entry) => entry.shortcut.toLowerCase() === shortcut || (shortcut === 'ctrl+shift+z' && entry.shortcut === 'Ctrl+Y'));
        if (command) { event.preventDefault(); run(command); }
    }, true);
    window.addEventListener('beforeunload', (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
    document.addEventListener('fullscreenchange', update);
    History.changed.addListener(update);
    Scene.selectionChanged.addListener(update);
    update();
}

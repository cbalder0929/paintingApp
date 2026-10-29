import { Application } from "pixi.js";
import ToolsManager from "./managers/ToolsManager.js";
import SceneManager from "./managers/SceneManager.js";
import HistoryManager from "./managers/HistoryManager.js";
import InteractionManager from "./managers/InteractionManager.js";

import "../style.css";
import "@fortawesome/fontawesome-free/css/all.min.css";

(async () => {
    // Create a new application
    const app = new Application();

    // Initialize the application
    const container = document.getElementById("pixi-container");

    await app.init({
        background: "#aaaaaa",
        resizeTo: container
    });

    SceneManager.init(app);

    // Makes `name` the active drawing/editing tool and highlights its button.
    const useTool = (name, tool) => {
        InteractionManager.setTool(name);
        ToolsManager.setActive(tool);
    };

    ToolsManager.addToolGroup("Shapes",["fa-solid","fa-shapes"], [
        ToolsManager.getTool("Ellipse",["fa-regular","fa-circle"], (tool) => useTool("ellipse", tool)),
        ToolsManager.getTool("Rectangle",["fa-regular","fa-square"], (tool) => useTool("rectangle", tool)),
        ToolsManager.getTool("Line",["fa-solid","fa-lines-leaning"], (tool) => useTool("line", tool)),
        ToolsManager.getTool("Star",["fa-regular","fa-star"], (tool) => useTool("star", tool))
    ]);

    let fillColorPicker = ToolsManager.getColorPicker("Fill Color");
    let strokeColorPicker = ToolsManager.getColorPicker("Stroke Color");
    let strokeInput = document.getElementById("stroke");

    strokeColorPicker.value = "#000000";

    ToolsManager.addTool(fillColorPicker);
    ToolsManager.addTool(strokeColorPicker);

    const selectTool = ToolsManager.getTool("Select Tool",["fa-solid","fa-arrow-pointer"], (tool) => useTool("select", tool));
    ToolsManager.addTool(selectTool);

    ToolsManager.addTool(ToolsManager.getTool("Move Tool",["fa-solid","fa-up-down-left-right"], (tool) => useTool("move", tool)));

    ToolsManager.addTool(ToolsManager.getTool("Scale Tool",["fa-solid","fa-up-right-and-down-left-from-center"], (tool) => useTool("scale", tool)));

    ToolsManager.addTool(ToolsManager.getTool("Delete Tool",["fa-solid","fa-trash-can"], () => {
        SceneManager.deleteSelection();
    }));

    ToolsManager.addTool(ToolsManager.getTool("Group Tool",["fa-solid","fa-object-group"], () => {
        SceneManager.groupSelection();
    }));

    ToolsManager.addTool(ToolsManager.getTool("Ungroup Tool",["fa-regular","fa-object-group"], () => {
        SceneManager.ungroupSelection();
    }));

    container.appendChild(app.canvas);

    // Stroke width falls back to 1 when the field is empty or invalid.
    const getStrokeWidth = () => {
        const width = parseFloat(strokeInput.value);

        return Number.isFinite(width) ? Math.min(100, Math.max(0, width)) : 1;
    };

    InteractionManager.init(app.canvas, () => ({
        fill: fillColorPicker.getDecimal(),
        stroke: strokeColorPicker.getDecimal(),
        strokeWidth: getStrokeWidth()
    }));

    useTool("select", selectTool);

    // Changing a style control restyles the selection (new shapes always use the current values).
    fillColorPicker.addEventListener("change", () => {
        SceneManager.applyStyle({ fill: fillColorPicker.getDecimal() });
    });

    strokeColorPicker.addEventListener("change", () => {
        SceneManager.applyStyle({ stroke: strokeColorPicker.getDecimal() });
    });

    strokeInput.addEventListener("change", () => {
        SceneManager.applyStyle({ strokeWidth: getStrokeWidth() });
    });

    // Show the selected shape's style in the controls.
    const toHex = (color) => "#" + color.toString(16).padStart(6, "0");

    SceneManager.selectionChanged.addListener((selection) => {
        if (selection.length === 0) return;

        const { fill, stroke, strokeWidth } = SceneManager.leaves(selection[0])[0].meta;

        fillColorPicker.value = toHex(fill);
        strokeColorPicker.value = toHex(stroke);
        strokeInput.value = strokeWidth;
    });

    let undoBtn = document.getElementById("undo");
    let redoBtn = document.getElementById("redo");

    undoBtn.addEventListener("click",() => {
        HistoryManager.undo();
    });

    redoBtn.addEventListener("click",() => {
        HistoryManager.redo();
    });

    const updateHistoryButtons = () => {
        undoBtn.disabled = !HistoryManager.canUndo;
        redoBtn.disabled = !HistoryManager.canRedo;
    };

    HistoryManager.changed.addListener(updateHistoryButtons);
    updateHistoryButtons();
})();

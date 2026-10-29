import HistoryManager from "./HistoryManager.js";
import SceneManager from "./SceneManager.js";

const SHAPE_TOOLS = ["ellipse", "rectangle", "line", "star"];
const MIN_SHAPE_SIZE = 3;
const MIN_SCALE_FACTOR = 0.05;
const MAX_SCALE_FACTOR = 50;

const CURSORS = {
    select: "default",
    move: "move",
    scale: "nwse-resize"
};

// Turns pointer and keyboard input into edits for whichever tool is active.
class InteractionManager {

    constructor() {
        this.canvas = null;
        this.tool = "select";
        this.drag = null;
        this.getStyle = () => ({});
    }

    init(canvas, getStyle) {
        this.canvas = canvas;
        this.getStyle = getStyle;

        canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
        canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
        canvas.addEventListener("pointerup", () => this.onPointerUp());
        canvas.addEventListener("pointercancel", () => this.onPointerUp());
        window.addEventListener("keydown", (e) => this.onKeyDown(e));

        this.setTool(this.tool);
    }

    setTool(tool) {
        this.tool = tool;
        this.canvas.style.cursor = SHAPE_TOOLS.includes(tool) ? "crosshair" : CURSORS[tool];
    }

    toPoint(e) {
        const rect = this.canvas.getBoundingClientRect();

        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    onPointerDown(e) {
        if (e.button !== 0 || this.drag) return;

        const point = this.toPoint(e);

        this.canvas.setPointerCapture(e.pointerId);

        if (SHAPE_TOOLS.includes(this.tool)) {
            SceneManager.setSelection([]);

            this.drag = {
                type: "draw",
                start: point,
                shape: SceneManager.createShape(this.tool, this.getStyle())
            };
            return;
        }

        const hit = SceneManager.pick(point);

        if (this.tool === "select") {
            this.select(hit, e.shiftKey);
            return;
        }

        // Move and Scale act on the selection, picking up whatever was clicked first.
        if (hit && !SceneManager.isSelected(hit)) {
            SceneManager.setSelection(e.shiftKey ? [...SceneManager.selection, hit] : [hit]);
        }

        if (SceneManager.selection.length === 0) return;

        const entries = SceneManager.snapshot(SceneManager.selection);

        if (this.tool === "move") {
            if (hit) this.drag = { type: "move", start: point, entries };
            return;
        }

        const center = SceneManager.getSelectionCenter();

        this.drag = {
            type: "scale",
            start: point,
            entries,
            center,
            startDistance: Math.max(Math.hypot(point.x - center.x, point.y - center.y), 1)
        };
    }

    select(hit, additive) {
        if (!hit) {
            if (!additive) SceneManager.setSelection([]);
        } else if (additive) {
            SceneManager.toggleSelected(hit);
        } else {
            SceneManager.setSelection([hit]);
        }
    }

    onPointerMove(e) {
        if (!this.drag) return;

        const point = this.toPoint(e);
        const { type, start } = this.drag;

        if (type === "draw") {
            SceneManager.setShapeBounds(this.drag.shape, start, point);
        } else if (type === "move") {
            SceneManager.translate(this.drag.entries, point.x - start.x, point.y - start.y);
        } else {
            const { center, startDistance } = this.drag;
            const distance = Math.hypot(point.x - center.x, point.y - center.y);
            const factor = Math.min(MAX_SCALE_FACTOR, Math.max(MIN_SCALE_FACTOR, distance / startDistance));

            SceneManager.scale(this.drag.entries, center, factor);
        }
    }

    onPointerUp() {
        if (!this.drag) return;

        const drag = this.drag;
        this.drag = null;

        if (drag.type === "draw") {
            const { w, h } = drag.shape.meta;

            if (Math.hypot(w, h) < MIN_SHAPE_SIZE) {
                SceneManager.discardShape(drag.shape);
            } else {
                SceneManager.commitShape(drag.shape);
            }
        } else {
            SceneManager.commitTransform(drag.entries);
        }
    }

    onKeyDown(e) {
        if (this.drag || e.target.matches("input, textarea")) return;

        const modifier = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        if (e.key === "Delete" || e.key === "Backspace") {
            SceneManager.deleteSelection();
        } else if (e.key === "Escape") {
            SceneManager.setSelection([]);
        } else if (modifier && key === "z") {
            if (e.shiftKey) HistoryManager.redo();
            else HistoryManager.undo();
        } else if (modifier && key === "y") {
            HistoryManager.redo();
        } else if (modifier && key === "g") {
            if (e.shiftKey) SceneManager.ungroupSelection();
            else SceneManager.groupSelection();
        } else {
            return;
        }

        e.preventDefault();
    }

}

export default new InteractionManager();

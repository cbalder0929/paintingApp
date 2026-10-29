import { Container, Graphics } from "pixi.js";
import { Event } from "../Event.js";
import HistoryManager from "./HistoryManager.js";
import Utils from "./Utils.js";

const SELECTION_COLOR = 0x3b82f6;
const HIT_TOLERANCE = 5;
const STAR_POINTS = 5;
const STAR_INNER_RATIO = 0.4;
const STYLE_KEYS = ["fill", "stroke", "strokeWidth"];

function distanceToSegment(p, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSquared = abx * abx + aby * aby;
    let t = lengthSquared === 0 ? 0 : ((p.x - ax) * abx + (p.y - ay) * aby) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    return Math.hypot(p.x - (ax + t * abx), p.y - (ay + t * aby));
}

function pointInPolygon(p, points) {
    let inside = false;

    for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
        const xi = points[i];
        const yi = points[i + 1];
        const xj = points[j];
        const yj = points[j + 1];

        if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }

    return inside;
}

// Owns the drawing surface: shapes, groups, selection and every undoable edit.
// Top-level objects live in `world`, which is never panned or zoomed, so
// world coordinates equal canvas coordinates.
class SceneManager {

    constructor() {
        this.world = null;
        this.overlay = null;
        this.selection = [];
        this.selectionChanged = new Event();
    }

    init(app) {
        this.world = new Container();
        this.overlay = new Graphics();

        app.stage.addChild(this.world, this.overlay);
    }

    // ---- Shapes ----

    createShape(kind, style) {
        const shape = new Graphics();
        shape.meta = { kind, w: 0, h: 0, dx: 0, dy: 0, ...style };

        this.world.addChild(shape);

        return shape;
    }

    // Fits the shape to the box spanned by two points and redraws it.
    setShapeBounds(shape, from, to) {
        const d = shape.meta;

        shape.position.set((from.x + to.x) / 2, (from.y + to.y) / 2);
        d.dx = to.x - from.x;
        d.dy = to.y - from.y;
        d.w = Math.abs(d.dx);
        d.h = Math.abs(d.dy);

        this.drawShape(shape);
    }

    // Shapes are drawn around their own origin so scaling keeps them centred.
    drawShape(shape) {
        const { kind, w, h, dx, dy, fill, stroke, strokeWidth } = shape.meta;

        shape.clear();

        if (kind === "line") {
            shape
                .moveTo(-dx / 2, -dy / 2)
                .lineTo(dx / 2, dy / 2)
                .stroke({ width: Math.max(strokeWidth, 1), color: stroke, cap: "round" });
            return;
        }

        if (kind === "rectangle") {
            shape.rect(-w / 2, -h / 2, w, h);
        } else if (kind === "ellipse") {
            shape.ellipse(0, 0, w / 2, h / 2);
        } else {
            shape.poly(this.starPoints(w, h));
        }

        shape.fill(fill);

        if (strokeWidth > 0) {
            shape.stroke({ width: strokeWidth, color: stroke, join: "round" });
        }
    }

    starPoints(w, h) {
        const points = [];

        for (let i = 0; i < STAR_POINTS * 2; i++) {
            const radius = i % 2 === 0 ? 1 : STAR_INNER_RATIO;
            const angle = -Math.PI / 2 + (i * Math.PI) / STAR_POINTS;

            points.push(Math.cos(angle) * radius * (w / 2), Math.sin(angle) * radius * (h / 2));
        }

        return points;
    }

    discardShape(shape) {
        this.world.removeChild(shape);
        shape.destroy();
    }

    // Records a shape that was just drawn into the world.
    commitShape(shape) {
        const index = this.world.getChildIndex(shape);

        HistoryManager.push({
            undo: () => {
                this.world.removeChild(shape);
                this.syncSelection();
            },
            redo: () => {
                this.world.addChildAt(shape, Math.min(index, this.world.children.length));
            }
        });
    }

    leaves(obj) {
        if (obj.meta.kind !== "group") return [obj];

        return obj.children.flatMap((child) => this.leaves(child));
    }

    // ---- Hit testing ----

    // Returns the topmost top-level object under the point, or null.
    pick(point) {
        for (let i = this.world.children.length - 1; i >= 0; i--) {
            const obj = this.world.children[i];

            if (this.hits(obj, point, 1)) return obj;
        }

        return null;
    }

    // `point` is in the node's parent space; `zoom` keeps the click tolerance constant on screen.
    hits(node, point, zoom) {
        node.updateLocalTransform();

        const local = node.localTransform.applyInverse(point);
        const nodeZoom = zoom * Math.abs(node.scale.x);

        if (node.meta.kind === "group") {
            return node.children.some((child) => this.hits(child, local, nodeZoom));
        }

        return this.shapeContains(node.meta, local, HIT_TOLERANCE / nodeZoom);
    }

    shapeContains(meta, p, tolerance) {
        const { kind, w, h, dx, dy, strokeWidth } = meta;
        const half = strokeWidth / 2;

        switch (kind) {
            case "line":
                return distanceToSegment(p, -dx / 2, -dy / 2, dx / 2, dy / 2) <= Math.max(half, tolerance);
            case "rectangle":
                return Math.abs(p.x) <= w / 2 + half && Math.abs(p.y) <= h / 2 + half;
            case "ellipse": {
                const rx = w / 2 + half;
                const ry = h / 2 + half;

                return (p.x / rx) ** 2 + (p.y / ry) ** 2 <= 1;
            }
            default:
                return pointInPolygon(p, this.starPoints(w, h));
        }
    }

    // ---- Selection ----

    setSelection(objs) {
        this.selection = objs;
        this.refreshOverlay();
        this.selectionChanged.invoke(this.selection);
    }

    // Drops anything that is no longer a top-level object (after undo/redo).
    syncSelection() {
        this.setSelection(this.selection.filter((obj) => obj.parent === this.world));
    }

    isSelected(obj) {
        return Utils.existsInArray(this.selection, obj);
    }

    toggleSelected(obj) {
        const next = this.isSelected(obj)
            ? Utils.removeFromArray([...this.selection], obj)
            : [...this.selection, obj];

        this.setSelection(next);
    }

    refreshOverlay() {
        this.overlay.clear();

        if (this.selection.length === 0) return;

        for (const obj of this.selection) {
            const b = obj.getBounds().rectangle;

            this.overlay.rect(b.x, b.y, b.width, b.height);
        }

        this.overlay.stroke({ width: 1, color: SELECTION_COLOR });
    }

    getSelectionCenter() {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const obj of this.selection) {
            const b = obj.getBounds().rectangle;

            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        }

        return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }

    // ---- Transforms ----

    // Captures positions/scales so a drag can be previewed and then undone.
    snapshot(objs) {
        return objs.map((obj) => ({ obj, state: this.getState(obj) }));
    }

    getState(obj) {
        return { x: obj.x, y: obj.y, sx: obj.scale.x, sy: obj.scale.y };
    }

    applyState(obj, state) {
        obj.position.set(state.x, state.y);
        obj.scale.set(state.sx, state.sy);
    }

    translate(entries, dx, dy) {
        for (const { obj, state } of entries) {
            obj.position.set(state.x + dx, state.y + dy);
        }

        this.refreshOverlay();
    }

    // Scales every entry about a shared centre point.
    scale(entries, center, factor) {
        for (const { obj, state } of entries) {
            obj.scale.set(state.sx * factor, state.sy * factor);
            obj.position.set(
                center.x + (state.x - center.x) * factor,
                center.y + (state.y - center.y) * factor
            );
        }

        this.refreshOverlay();
    }

    // Records a finished move/scale drag started from `entries`.
    commitTransform(entries) {
        const changes = entries
            .map(({ obj, state }) => ({ obj, before: state, after: this.getState(obj) }))
            .filter(({ before, after }) => Object.keys(before).some((key) => before[key] !== after[key]));

        if (changes.length === 0) return;

        const apply = (key) => {
            for (const change of changes) {
                this.applyState(change.obj, change[key]);
            }

            this.refreshOverlay();
        };

        HistoryManager.push({
            undo: () => apply("before"),
            redo: () => apply("after")
        });
    }

    // ---- Edits on the selection ----

    deleteSelection() {
        if (this.selection.length === 0) return;

        const removed = this.selection
            .map((obj) => ({ obj, index: this.world.getChildIndex(obj) }))
            .sort((a, b) => a.index - b.index);

        HistoryManager.execute({
            undo: () => {
                for (const { obj, index } of removed) {
                    this.world.addChildAt(obj, Math.min(index, this.world.children.length));
                }

                this.setSelection(removed.map(({ obj }) => obj));
            },
            redo: () => {
                for (const { obj } of removed) {
                    this.world.removeChild(obj);
                }

                this.setSelection([]);
            }
        });
    }

    groupSelection() {
        if (this.selection.length < 2) return;

        const members = this.selection
            .map((obj) => ({ obj, index: this.world.getChildIndex(obj) }))
            .sort((a, b) => a.index - b.index);
        const group = new Container();
        group.meta = { kind: "group" };

        // Once the members are lifted out, the group takes the slot of the topmost one.
        const groupIndex = members[members.length - 1].index - (members.length - 1);

        HistoryManager.execute({
            undo: () => {
                this.world.removeChild(group);

                for (const { obj, index } of members) {
                    group.removeChild(obj);
                    this.world.addChildAt(obj, index);
                }

                this.setSelection(members.map(({ obj }) => obj));
            },
            redo: () => {
                for (const { obj } of members) {
                    this.world.removeChild(obj);
                    group.addChild(obj);
                }

                this.world.addChildAt(group, groupIndex);
                this.setSelection([group]);
            }
        });
    }

    ungroupSelection() {
        const groups = this.selection.filter((obj) => obj.meta.kind === "group");

        if (groups.length === 0) return;

        // Remember each child's transform inside its group so undo can restore it exactly.
        const records = groups.map((group) => ({
            group,
            index: this.world.getChildIndex(group),
            children: group.children.map((child) => ({ obj: child, local: this.getState(child) }))
        }));
        const freed = () => records.flatMap(({ children }) => children.map(({ obj }) => obj));

        HistoryManager.execute({
            undo: () => {
                for (const { group, children } of records) {
                    for (const { obj, local } of children) {
                        this.world.removeChild(obj);
                        group.addChild(obj);
                        this.applyState(obj, local);
                    }
                }

                for (const { group, index } of [...records].sort((a, b) => a.index - b.index)) {
                    this.world.addChildAt(group, Math.min(index, this.world.children.length));
                }

                this.setSelection(groups);
            },
            redo: () => {
                for (const { group, children } of records) {
                    const at = this.world.getChildIndex(group);

                    this.world.removeChild(group);

                    children.forEach(({ obj, local }, i) => {
                        group.removeChild(obj);
                        this.applyState(obj, {
                            x: group.x + local.x * group.scale.x,
                            y: group.y + local.y * group.scale.y,
                            sx: local.sx * group.scale.x,
                            sy: local.sy * group.scale.y
                        });
                        this.world.addChildAt(obj, Math.min(at + i, this.world.children.length));
                    });
                }

                this.setSelection(freed());
            }
        });
    }

    // Applies fill/stroke/strokeWidth changes to every shape in the selection.
    applyStyle(patch) {
        const changes = [];

        for (const obj of this.selection) {
            for (const shape of this.leaves(obj)) {
                const before = {};
                const after = {};

                for (const key of STYLE_KEYS) {
                    before[key] = shape.meta[key];
                    after[key] = key in patch ? patch[key] : shape.meta[key];
                }

                if (STYLE_KEYS.some((key) => before[key] !== after[key])) {
                    changes.push({ shape, before, after });
                }
            }
        }

        if (changes.length === 0) return;

        const apply = (key) => {
            for (const change of changes) {
                Object.assign(change.shape.meta, change[key]);
                this.drawShape(change.shape);
            }

            this.refreshOverlay();
        };

        HistoryManager.execute({
            undo: () => apply("before"),
            redo: () => apply("after")
        });
    }

}

export default new SceneManager();

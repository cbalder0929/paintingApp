import { Container, Graphics } from "pixi.js";
import { Event } from "../Event.js";
import HistoryManager from "./HistoryManager.js";
import Utils from "./Utils.js";
import { getCar } from "../shapes/cars.js";

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
        let dx = to.x - from.x;
        let dy = to.y - from.y;

        // Cars keep their proportions; dragging leftwards mirrors them to face left.
        if (d.kind === "car") {
            const { aspect } = getCar(d.variant);
            const width = Math.max(Math.abs(dx), Math.abs(dy) * aspect);

            dx = (dx < 0 ? -1 : 1) * width;
            dy = (dy < 0 ? -1 : 1) * (width / aspect);
        }

        shape.position.set(from.x + dx / 2, from.y + dy / 2);
        d.dx = dx;
        d.dy = dy;
        d.w = Math.abs(dx);
        d.h = Math.abs(dy);

        this.drawShape(shape);
    }

    // Drops a car of the given width centred on a point (used for a plain click).
    placeCar(shape, center, width) {
        const height = width / getCar(shape.meta.variant).aspect;

        this.setShapeBounds(shape,
            { x: center.x - width / 2, y: center.y - height / 2 },
            { x: center.x + width / 2, y: center.y + height / 2 });
    }

    // Maps a car's source coordinates into the shape's local, centred space.
    carTransform(meta) {
        const car = getCar(meta.variant);

        return { car, sx: meta.dx / car.width, sy: meta.h / car.height };
    }

    drawCar(shape) {
        const { fill, stroke } = shape.meta;
        const { car, sx, sy } = this.carTransform(shape.meta);
        const map = (points) => points.map((v, i) => (i % 2 === 0
            ? (v - car.width / 2) * sx
            : (v - car.height / 2) * sy));

        // Body colour first, then the line art on top with its holes cut out.
        for (const points of car.silhouettes) shape.poly(map(points));
        shape.fill(fill);

        for (const ink of car.inks) {
            shape.poly(map(ink.points)).fill(stroke);

            if (ink.holes.length) {
                for (const hole of ink.holes) shape.poly(map(hole));
                shape.cut();
            }
        }
    }

    // Shapes are drawn around their own origin so scaling keeps them centred.
    drawShape(shape) {
        const { kind, w, h, dx, dy, fill, stroke, strokeWidth } = shape.meta;

        shape.clear();

        if (kind === "car") {
            if (w >= 1 && h >= 1) this.drawCar(shape);
            return;
        }

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
            case "car": {
                if (w < 1 || h < 1) return false;

                const { car, sx, sy } = this.carTransform(meta);
                const source = { x: p.x / sx + car.width / 2, y: p.y / sy + car.height / 2 };

                return car.silhouettes.some((points) => pointInPolygon(source, points));
            }
            default:
                return pointInPolygon(p, this.starPoints(w, h));
        }
    }

    // ---- Selection ----

    selectInBox(from, to, initial = []) {
        // Convert the marquee to screen space, matching object bounds at every zoom.
        const a = this.world.toGlobal(from);
        const b = this.world.toGlobal(to);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const right = Math.max(a.x, b.x);
        const bottom = Math.max(a.y, b.y);
        const inside = this.world.children.filter((obj) => {
            const bounds = obj.getBounds().rectangle;
            return bounds.x >= x && bounds.y >= y &&
                bounds.x + bounds.width <= right && bounds.y + bounds.height <= bottom;
        });
        this.setSelection([...new Set([...initial, ...inside])]);
        this.overlay.rect(x, y, right - x, bottom - y)
            .fill({ color: SELECTION_COLOR, alpha: 0.12 })
            .stroke({ width: 1, color: SELECTION_COLOR });
    }

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

        return this.world.toLocal({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    }

    serialize(objects = this.world.children) {
        const encode = (obj) => ({ meta: { ...obj.meta }, ...this.getState(obj),
            ...(obj.meta.kind === "group" ? { children: obj.children.map(encode) } : {}) });
        return objects.map(encode);
    }

    deserialize(records) {
        let count = 0;
        const decode = (record, depth = 0) => {
            if (++count > 10000 || depth > 30 || !record || !record.meta) throw new Error("Invalid drawing.");
            const { meta } = record;
            if (!["group", "rectangle", "ellipse", "line", "star", "car"].includes(meta.kind) ||
                (meta.kind === "car" && (typeof meta.variant !== "string" || !getCar(meta.variant))) ||
                !["x", "y", "sx", "sy"].every((key) => Number.isFinite(record[key]) && Math.abs(record[key]) <= 1000000)) throw new Error("Invalid shape or transform.");
            let obj;
            if (meta.kind === "group") {
                if (!Array.isArray(record.children) || !record.children.length) throw new Error("Invalid group.");
                obj = new Container();
                obj.meta = { kind: "group" };
                for (const child of record.children) obj.addChild(decode(child, depth + 1));
            } else {
                if (!["w", "h", "dx", "dy", "fill", "stroke", "strokeWidth"].every((key) => Number.isFinite(meta[key]) && Math.abs(meta[key]) <= 0xffffff) || meta.w < 0 || meta.h < 0 || meta.strokeWidth < 0) throw new Error("Invalid shape properties.");
                obj = new Graphics();
                obj.meta = { ...meta };
                this.drawShape(obj);
            }
            this.applyState(obj, record);
            return obj;
        };
        if (!Array.isArray(records)) throw new Error("Invalid drawing.");
        return records.map((record) => decode(record));
    }

    insert(objects) {
        HistoryManager.execute({
            redo: () => { objects.forEach((obj) => this.world.addChild(obj)); this.setSelection(objects); },
            undo: () => { objects.forEach((obj) => this.world.removeChild(obj)); this.setSelection([]); }
        });
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

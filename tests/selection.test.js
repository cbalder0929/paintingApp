import assert from "node:assert/strict";
import test from "node:test";
import { Container, Graphics } from "pixi.js";
import Scene from "../src/managers/SceneManager.js";
import History from "../src/managers/HistoryManager.js";
import Interaction from "../src/managers/InteractionManager.js";

test("marquee selection, grouping, transforms, and cancellation", () => {
    Scene.world = new Container();
    Scene.overlay = new Graphics();
    Scene.selection = [];
    History.clear();
    const shape = (x) => {
        const obj = Scene.createShape("rectangle", { fill: 255, stroke: 0, strokeWidth: 2 });
        Scene.setShapeBounds(obj, { x, y: 20 }, { x: x + 30, y: 50 });
        return obj;
    };
    const a = shape(20), b = shape(70), c = shape(200);
    // Reverse dragging and a zoomed/panned canvas use the same world rectangle.
    Scene.world.scale.set(2);
    Scene.world.position.set(80, 40);
    Scene.selectInBox({ x: 120, y: 80 }, { x: 0, y: 0 });
    assert.deepEqual(Scene.selection, [a, b]);
    Scene.selectInBox({ x: 190, y: 0 }, { x: 250, y: 80 }, [a]);
    assert.deepEqual(Scene.selection, [a, c]);
    // Partial overlap does not count as enclosed.
    Scene.selectInBox({ x: 25, y: 25 }, { x: 40, y: 40 });
    assert.equal(Scene.selection.length, 0);
    Scene.setSelection([a, b]);
    Scene.groupSelection();
    const group = Scene.selection[0];
    assert.equal(group.meta.kind, "group");
    assert.deepEqual(group.children, [a, b]);
    assert.equal(Scene.world.children.length, 2);
    group.position.set(15, 25);
    group.scale.set(1.5);
    const before = a.getBounds().rectangle.clone();
    Scene.ungroupSelection();
    assert.deepEqual(Scene.selection, [a, b]);
    assert.deepEqual(a.getBounds().rectangle, before);
    History.undo();
    assert.deepEqual(Scene.selection, [group]);
    assert.deepEqual(group.children, [a, b]);
    History.redo();
    assert.deepEqual(a.getBounds().rectangle, before);
    Scene.setSelection([c]);
    Interaction.drag = { type: "marquee", before: [a], initial: [] };
    Interaction.cancelDrag();
    assert.deepEqual(Scene.selection, [a]);
    assert.equal(Interaction.drag, null);
    // Completing a marquee clears the drag without adding a history entry.
    const count = History.undoStack.length;
    Interaction.drag = { type: "marquee" };
    Interaction.onPointerUp();
    assert.equal(History.undoStack.length, count);
    assert.deepEqual(Scene.selection, [a]);
});

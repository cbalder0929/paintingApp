import assert from "node:assert/strict";
import test from "node:test";
import { Container, Graphics } from "pixi.js";
import Scene from "../src/managers/SceneManager.js";
import History from "../src/managers/HistoryManager.js";
import Interaction from "../src/managers/InteractionManager.js";
import { CARS, getCar } from "../src/shapes/cars.js";

const style = { fill: 0xffffff, stroke: 0, strokeWidth: 1 };

const reset = () => {
    Scene.world = new Container();
    Scene.overlay = new Graphics();
    Scene.selection = [];
    History.clear();
};

test("car library has 16 named models with ink and silhouettes", () => {
    assert.equal(CARS.length, 16);
    assert.equal(new Set(CARS.map((car) => car.id)).size, 16);

    for (const car of CARS) {
        assert.ok(car.silhouettes.length >= 1, car.name);
        assert.ok(car.inks.length >= car.silhouettes.length, car.name);
        assert.equal(getCar(car.id), car);
    }

    assert.equal(getCar("not-a-car"), null);
});

test("dragging draws a car that keeps its proportions and can face either way", () => {
    reset();
    const car = getCar("sedan");
    const shape = Scene.createShape("car", { ...style, variant: "sedan" });

    // A tall, thin drag still yields a correctly proportioned car.
    Scene.setShapeBounds(shape, { x: 100, y: 100 }, { x: 140, y: 300 });
    assert.ok(Math.abs(shape.meta.w / shape.meta.h - car.aspect) < 1e-9);
    assert.equal(shape.meta.h, 200);

    // The body is solid (hit), outside the car is empty (miss).
    assert.equal(Scene.pick({ x: shape.x, y: shape.y }), shape);
    assert.equal(Scene.pick({ x: shape.x - shape.meta.w, y: shape.y }), null);

    // Dragging leftwards mirrors the car but it stays hittable and sized.
    Scene.setShapeBounds(shape, { x: 400, y: 100 }, { x: 100, y: 200 });
    assert.ok(shape.meta.dx < 0);
    assert.equal(shape.meta.w, 300);
    assert.equal(Scene.pick({ x: shape.x, y: shape.y }), shape);
    assert.ok(shape.getLocalBounds().width > 290);
});

test("clicking with the car tool drops a car that undo removes", () => {
    reset();
    Interaction.canvas = { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    Interaction.getStyle = () => style;
    Interaction.setTool("car", { variant: "jeep" });

    Interaction.onPointerDown({ button: 0, clientX: 300, clientY: 200, pointerId: 1 });
    Interaction.onPointerUp();

    const [car] = Scene.world.children;
    assert.equal(Scene.world.children.length, 1);
    assert.equal(car.meta.variant, "jeep");
    assert.ok(Math.abs(car.meta.w - 240) < 1e-9);
    assert.ok(Math.abs(car.x - 300) < 1e-9 && Math.abs(car.y - 200) < 1e-9);

    History.undo();
    assert.equal(Scene.world.children.length, 0);
});

test("cars survive save/open and recolour with the style controls", () => {
    reset();
    const shape = Scene.createShape("car", { ...style, variant: "van" });
    Scene.setShapeBounds(shape, { x: 0, y: 0 }, { x: 200, y: 50 });

    const [copy] = Scene.deserialize(JSON.parse(JSON.stringify(Scene.serialize())));
    assert.deepEqual(copy.meta, shape.meta);

    Scene.setSelection([shape]);
    Scene.applyStyle({ fill: 0xff0000, stroke: 0x0000ff });
    assert.equal(shape.meta.fill, 0xff0000);
    assert.equal(shape.meta.stroke, 0x0000ff);
    History.undo();
    assert.equal(shape.meta.fill, 0xffffff);

    assert.throws(() => Scene.deserialize([{ ...Scene.serialize()[0], meta: { ...shape.meta, variant: "spaceship" } }]));
});

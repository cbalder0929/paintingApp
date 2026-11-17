// Converts carPolygon.svg (a 4x4 sheet of labelled car outlines drawn as one
// even-odd <path>) into polygon data the app can draw: src/shapes/carPolygons.js.
//
//   node scripts/build-car-polygons.mjs
//
// Each car becomes a list of closed contours (flattened Béziers) in its own
// coordinate box, tagged with nesting depth. Even depth = ink, odd = hole.
// The text labels under each car are dropped; their names are listed below.

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = new URL("../carPolygon.svg", import.meta.url);
const OUTPUT = new URL("../src/shapes/carPolygons.js", import.meta.url);

// Reading order of the sheet (row by row).
const NAMES = [
    "Sedan", "Hatchback", "Coupe", "Convertible",
    "SUV", "Pickup Truck", "Pickup Truck 2", "Station Wagon",
    "Crossover", "Van", "Jeep", "Roadster",
    "Sports Car", "Sports Car 2", "Limousine", "Compact City Car"
];

const FLATNESS = 0.6;     // max curve deviation when flattening, in SVG units
const SIMPLIFY = 0.6;     // Douglas-Peucker tolerance, in SVG units
const JOIN_MARGIN = 20;   // contours this close to a car belong to it (labels sit ~50+ below)

// ---- Parse the path into closed contours ----

const svg = readFileSync(SOURCE, "utf8");
const [, viewBox] = svg.match(/viewBox="([^"]+)"/);
const [, , sheetWidth, sheetHeight] = viewBox.split(/\s+/).map(Number);
const d = svg.match(/<path[^>]*\sd="([^"]+)"/)[1];
const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);

const contours = [];
let current = null;
let x = 0;
let y = 0;

function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, out, depth = 0) {
    // Flat enough when both control points lie close to the chord.
    const dx = x3 - x0;
    const dy = y3 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const d1 = Math.abs((x1 - x3) * dy - (y1 - y3) * dx) / len;
    const d2 = Math.abs((x2 - x3) * dy - (y2 - y3) * dx) / len;

    if (depth > 12 || d1 + d2 <= FLATNESS) {
        out.push(x3, y3);
        return;
    }

    const x01 = (x0 + x1) / 2, y01 = (y0 + y1) / 2;
    const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2;
    const x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
    const xa = (x01 + x12) / 2, ya = (y01 + y12) / 2;
    const xb = (x12 + x23) / 2, yb = (y12 + y23) / 2;
    const xm = (xa + xb) / 2, ym = (ya + yb) / 2;

    flattenCubic(x0, y0, x01, y01, xa, ya, xm, ym, out, depth + 1);
    flattenCubic(xm, ym, xb, yb, x23, y23, x3, y3, out, depth + 1);
}

for (let i = 0, command = null; i < tokens.length;) {
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const n = () => Number(tokens[i++]);

    if (command === "M") {
        x = n(); y = n();
        current = [x, y];
        contours.push(current);
        command = "L"; // extra pairs after M are line-tos
    } else if (command === "L") {
        x = n(); y = n();
        current.push(x, y);
    } else if (command === "C") {
        const c = [n(), n(), n(), n(), n(), n()];
        flattenCubic(x, y, ...c, current);
        [x, y] = [c[4], c[5]];
    } else if (command === "Z") {
        // Contours are implicitly closed; Z just returns to the start point.
        [x, y] = [current[0], current[1]];
        command = null;
    } else {
        throw new Error(`Unsupported path command "${command}"`);
    }
}

// ---- Geometry helpers ----

function simplify(points, tolerance) {
    const count = points.length / 2;
    if (count < 4) return points;

    const keep = new Uint8Array(count);
    keep[0] = keep[count - 1] = 1;
    const stack = [[0, count - 1]];

    while (stack.length) {
        const [a, b] = stack.pop();
        const ax = points[a * 2], ay = points[a * 2 + 1];
        const bx = points[b * 2], by = points[b * 2 + 1];
        const len = Math.hypot(bx - ax, by - ay);
        let worst = -1;
        let worstDistance = tolerance;

        for (let i = a + 1; i < b; i++) {
            const px = points[i * 2], py = points[i * 2 + 1];
            const distance = len === 0
                ? Math.hypot(px - ax, py - ay)
                : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;

            if (distance > worstDistance) { worst = i; worstDistance = distance; }
        }

        if (worst >= 0) {
            keep[worst] = 1;
            stack.push([a, worst], [worst, b]);
        }
    }

    const out = [];
    for (let i = 0; i < count; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
    return out;
}

function area(points) {
    let sum = 0;
    for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
        sum += (points[j] - points[i]) * (points[j + 1] + points[i + 1]);
    }
    return Math.abs(sum / 2);
}

function bounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
        minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
    }
    return { minX, minY, maxX, maxY };
}

function contains(points, px, py) {
    let inside = false;
    for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
        const xi = points[i], yi = points[i + 1], xj = points[j], yj = points[j + 1];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

// ---- Build the nesting tree ----

const shapes = contours
    .map((points) => {
        // Drop a duplicated closing point.
        const n = points.length;
        if (n > 4 && points[0] === points[n - 2] && points[1] === points[n - 1]) points = points.slice(0, -2);
        points = simplify(points, SIMPLIFY);
        return { points, area: area(points), box: bounds(points) };
    })
    .filter((shape) => shape.points.length >= 6 && shape.area > 0.5);

for (const shape of shapes) {
    // Parent = the smallest larger contour that contains this one.
    const [px, py] = shape.points;
    shape.parent = shapes
        .filter((other) => other !== shape && other.area > shape.area && contains(other.points, px, py))
        .sort((a, b) => a.area - b.area)[0] ?? null;
}
for (const shape of shapes) {
    let depth = 0;
    for (let p = shape.parent; p; p = p.parent) depth++;
    shape.depth = depth;
    let root = shape;
    while (root.parent) root = root.parent;
    shape.root = root;
}

// ---- Split the sheet into cars, dropping the text labels ----

const roots = shapes.filter((shape) => shape.depth === 0);
const near = (a, b) => a.minX - JOIN_MARGIN <= b.maxX && b.minX - JOIN_MARGIN <= a.maxX &&
    a.minY - JOIN_MARGIN <= b.maxY && b.minY - JOIN_MARGIN <= a.maxY;

// The biggest outline is a car body; grow each body by everything touching it.
const unclaimed = new Set(roots);
const cars = [];

for (const body of [...roots].sort((a, b) => b.area - a.area)) {
    if (cars.length === NAMES.length) break;
    if (!unclaimed.has(body)) continue;

    const members = [body];
    unclaimed.delete(body);

    for (let grew = true; grew;) {
        grew = false;
        for (const candidate of unclaimed) {
            if (members.some((member) => near(member.box, candidate.box))) {
                members.push(candidate);
                unclaimed.delete(candidate);
                grew = true;
            }
        }
    }

    cars.push(members);
}

const center = (members) => {
    const box = bounds(members.flatMap((m) => [m.box.minX, m.box.minY, m.box.maxX, m.box.maxY]));
    return { box, cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2 };
};

// Reading order: bucket into rows by vertical position, then left to right.
const placed = cars.map((members) => ({ members, ...center(members) }))
    .sort((a, b) => a.cy - b.cy);
const rows = [];
for (const car of placed) {
    const row = rows.find((r) => Math.abs(r[0].cy - car.cy) < sheetHeight / 10);
    if (row) row.push(car); else rows.push([car]);
}
const ordered = rows.flatMap((row) => row.sort((a, b) => a.cx - b.cx));

if (ordered.length !== NAMES.length) {
    throw new Error(`Expected ${NAMES.length} cars, found ${ordered.length}`);
}

// ---- Emit ----

let totalPoints = 0;
const output = ordered.map(({ members, box }, index) => {
    const parts = shapes
        .filter((shape) => members.includes(shape.root))
        .sort((a, b) => a.depth - b.depth);
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;

    return {
        id: NAMES[index].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: NAMES[index],
        width: Math.round(width),
        height: Math.round(height),
        contours: parts.map((shape) => {
            const pts = shape.points.map((v, i) => Math.round(i % 2 === 0 ? v - box.minX : v - box.minY));
            totalPoints += pts.length / 2;
            return { depth: shape.depth, parent: parts.indexOf(shape.parent), points: pts };
        })
    };
});

const banner = `// Generated by scripts/build-car-polygons.mjs from carPolygon.svg — do not edit by hand.
// Each car: contours in a ${"`"}width${"`"} x ${"`"}height${"`"} box (origin top-left).
// depth: even = ink (line art), odd = hole; parent = index of the enclosing contour (-1 = none).
`;
const body = output.map((car) => `    ${JSON.stringify(car)}`).join(",\n");
writeFileSync(OUTPUT, `${banner}\nexport default [\n${body}\n];\n`);

console.log(`Wrote ${output.length} cars, ${totalPoints} points (sheet ${sheetWidth}x${sheetHeight}).`);
for (const car of output) {
    console.log(`  ${car.name.padEnd(24)} ${car.width}x${car.height}  ${car.contours.length} contours`);
}

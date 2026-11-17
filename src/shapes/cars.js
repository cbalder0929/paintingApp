import CAR_DATA from "./carPolygons.js";

// The car polygons from carPolygon.svg, plus helpers to draw and preview them.
// Each car is line art: contours at even depth are ink, odd depth are holes.

export const CARS = CAR_DATA.map((car) => ({
    ...car,
    aspect: car.width / car.height,
    // Outer outlines: filled with the fill color, also used for hit testing.
    silhouettes: car.contours.filter((c) => c.depth === 0).map((c) => c.points),
    // Ink contours, each with the holes punched directly out of it.
    inks: car.contours
        .map((c, index) => ({ ...c, index }))
        .filter((c) => c.depth % 2 === 0)
        .map((c) => ({
            points: c.points,
            holes: car.contours.filter((h) => h.parent === c.index).map((h) => h.points)
        }))
}));

const BY_ID = new Map(CARS.map((car) => [car.id, car]));

export function getCar(id) {
    return BY_ID.get(id) ?? null;
}

// Small SVG preview for the tool popup; uses currentColor so it follows the theme.
export function carThumbnail(car) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const path = document.createElementNS(ns, "path");

    svg.setAttribute("viewBox", `-10 -10 ${car.width + 20} ${car.height + 20}`);
    svg.setAttribute("aria-hidden", "true");
    path.setAttribute("d", car.contours.map((c) => `M${c.points.join(" ")}Z`).join(""));
    path.setAttribute("fill", "currentColor");
    path.setAttribute("fill-rule", "evenodd");
    svg.append(path);

    return svg;
}

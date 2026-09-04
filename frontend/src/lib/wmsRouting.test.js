import { calculateWarehouseRoute } from "./wmsRouting";

function slot(id, codice, x, z = 0) {
  return {
    id,
    codice,
    tipo: "slot",
    map_x: x,
    map_z: z,
    map_width: 1.6,
    map_depth: 0.5,
    map_rotation: 0,
    access_side: "front",
  };
}

describe("calculateWarehouseRoute", () => {
  test("uses virtual warehouse coordinates instead of location numbers", () => {
    const locations = [
      slot("far", "S1+A101", 9),
      slot("near", "S1+A111", 1),
      slot("middle", "S1+A107", 4),
    ];

    const route = calculateWarehouseRoute(locations, { entrance_x: 0, entrance_z: 0 });

    expect(route.locations.map((location) => location.id)).toEqual(["near", "middle", "far"]);
  });

  test("returns each requested stop exactly once", () => {
    const locations = [
      slot("one", "S9+A3", 2, 2),
      slot("two", "S2+A90", -2, 5),
      slot("three", "S4+A1", 4, 7),
    ];

    const route = calculateWarehouseRoute(locations, { entrance_x: 0, entrance_z: 0 });

    expect(new Set(route.locations.map((location) => location.id))).toEqual(new Set(["one", "two", "three"]));
    expect(route.locations).toHaveLength(3);
    expect(route.distance).toBeGreaterThan(0);
  });
});

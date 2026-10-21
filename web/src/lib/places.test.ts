import { describe, expect, it } from "vitest";
import { label } from "./api";
import { metersToString } from "./places";

describe("metersToString", () => {
  it("is empty when the distance is unknown", () => {
    expect(metersToString(undefined)).toBe("");
  });

  it("rounds more coarsely the further away it is", () => {
    expect(metersToString(42)).toBe("42 m");
    expect(metersToString(234)).toBe("230 m");
    expect(metersToString(870)).toBe("850 m");
    expect(metersToString(1234)).toBe("1.2 km");
    expect(metersToString(250_000)).toBe("250 km");
  });
});

describe("label", () => {
  it("turns stored answer values into readable text", () => {
    expect(label("a_few_times")).toBe("a few times");
    expect(label("specific_people")).toBe("specific people");
  });
});

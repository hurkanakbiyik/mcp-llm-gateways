import { describe, expect, it } from "vitest";
import { UpstreamError } from "../src/providers/types.js";

describe("UpstreamError log hygiene", () => {
  it("when an upstream body holds a secret, then serializing the error does not include it", () => {
    // Arrange
    const err = new UpstreamError("http_error", 500, "Traceback ... password=hunter2");
    // Act
    const serialized = JSON.stringify({ ...err, message: err.message });
    // Assert
    expect(err.detail).toContain("hunter2"); // still available to code that asks for it
    expect(serialized).not.toContain("hunter2");
    expect(Object.keys(err)).not.toContain("detail");
  });
});

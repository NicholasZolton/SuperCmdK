import { describe, expect, it } from "vitest";
import { createDemoTools } from "../demo/src/demo-tools";
import { auditToolQuality } from "../src/tools";
import type { ToolSchema } from "../src/types";

describe("auditToolQuality", () => {
  it("accepts the demo's documented tool contracts", () => {
    expect(auditToolQuality(createDemoTools((): void => undefined))).toEqual([]);
  });

  it("reports actionable contract issues without rejecting valid tools", () => {
    const tool: ToolSchema = {
      name: "read_account",
      description: "Read an account and return its ID.",
      inputSchema: {
        type: "object",
        properties: { accountId: { type: "string" } },
      },
    };

    expect(auditToolQuality([tool])).toEqual([
      expect.objectContaining({ toolName: "read_account", code: "missing-title", severity: "warning" }),
      expect.objectContaining({ toolName: "read_account", code: "missing-read-only-hint", severity: "warning" }),
      expect.objectContaining({ toolName: "read_account", code: "open-arguments", severity: "warning" }),
      expect.objectContaining({
        toolName: "read_account",
        code: "missing-property-description",
        path: "inputSchema.properties.accountId.description",
      }),
    ]);
  });

  it("reports contradictory safety annotations as an error", () => {
    const tool: ToolSchema = {
      name: "broken",
      title: "Broken",
      description: "Return data while claiming a consequential side effect.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, consequentialHint: true },
    };

    expect(auditToolQuality([tool])).toContainEqual(expect.objectContaining({
      code: "contradictory-annotations",
      severity: "error",
    }));
  });
});

import type { Tool, ToolSchema } from "./types";

export type ToolQualityIssueCode =
  | "missing-title"
  | "missing-read-only-hint"
  | "contradictory-annotations"
  | "open-arguments"
  | "missing-property-description";

export interface ToolQualityIssue {
  toolName: string;
  code: ToolQualityIssueCode;
  severity: "error" | "warning";
  message: string;
  path?: string;
}

/** Report deterministic tool-contract problems that commonly reduce agent reliability. */
export function auditToolQuality(tools: readonly (ToolSchema | Tool)[]): readonly ToolQualityIssue[] {
  const issues: ToolQualityIssue[] = [];
  for (const tool of tools) {
    if (!tool.title?.trim()) {
      issues.push({
        toolName: tool.name,
        code: "missing-title",
        severity: "warning",
        message: "Add a short human-readable title for interfaces that display this tool.",
        path: "title",
      });
    }
    if (tool.annotations?.readOnlyHint === undefined) {
      issues.push({
        toolName: tool.name,
        code: "missing-read-only-hint",
        severity: "warning",
        message: "Set readOnlyHint explicitly so agents can distinguish reads from writes.",
        path: "annotations.readOnlyHint",
      });
    }
    if (tool.annotations?.readOnlyHint && tool.annotations.consequentialHint) {
      issues.push({
        toolName: tool.name,
        code: "contradictory-annotations",
        severity: "error",
        message: "A read-only tool cannot also be consequential.",
        path: "annotations",
      });
    }
    if (tool.inputSchema.additionalProperties !== false) {
      issues.push({
        toolName: tool.name,
        code: "open-arguments",
        severity: "warning",
        message: "Set additionalProperties to false unless this tool intentionally accepts undeclared arguments.",
        path: "inputSchema.additionalProperties",
      });
    }
    for (const [name, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
      if (schema.description?.trim()) continue;
      issues.push({
        toolName: tool.name,
        code: "missing-property-description",
        severity: "warning",
        message: `Describe the ${name} argument so an agent can supply it correctly.`,
        path: `inputSchema.properties.${name}.description`,
      });
    }
  }
  return issues;
}

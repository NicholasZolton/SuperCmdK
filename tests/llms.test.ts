import { describe, expect, it } from "vitest";
import { createLlmsTxt } from "../demo/llms";
import { generateLlmsTxt } from "../src/tools";

describe("llms.txt", () => {
  it("generates a general site guide from metadata and durable tools", () => {
    const content = generateLlmsTxt({
      name: "Acme",
      description: "Tools for Acme customers.",
      siteUrl: "https://acme.example",
      purpose: "Manage an Acme account.",
      audience: "Acme customers and their agents.",
      publisher: {
        name: "Acme, Inc.",
        url: "https://acme.example/about",
        description: "The company behind Acme.",
      },
      agentAccess: {
        webMcp: true,
        mcpUrl: "https://mcp.acme.example",
        description: "Authentication is required for account changes.",
      },
      tools: [{
        name: "read_account",
        title: "Read account",
        description: "Read an account and return its ID and status.",
        inputSchema: {
          type: "object",
          properties: { accountId: { type: "string", description: "Account identifier" } },
          required: ["accountId"],
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
      }],
      documentation: [{
        title: "API guide",
        url: "https://acme.example/docs",
        description: "Authentication and examples.",
      }],
    });

    expect(content).toContain("# Acme");
    expect(content).toContain("[Acme, Inc.](https://acme.example/about)");
    expect(content).toContain("Remote MCP server: [https://mcp.acme.example](https://mcp.acme.example)");
    expect(content).toContain("`read_account` — Read account");
    expect(content).toContain("read-only; may return untrusted content");
    expect(content).toContain("`accountId` (string, required) — Account identifier");
    expect(content).toContain("[API guide](https://acme.example/docs) — Authentication and examples.");
  });

  it("describes the site, its real WebMCP tools, and stable documentation", () => {
    const content = createLlmsTxt();

    expect(content).toContain("# SuperCmdK");
    expect(content).toContain("[Nicholas Zolton](https://github.com/NicholasZolton/SuperCmdK)");
    expect(content).toContain("independent open-source project");
    expect(content).toContain("does not operate a separate remote MCP server");
    expect(content).toContain("`find_project` — Find project");
    expect(content).toContain("Access: read-only");
    expect(content).toContain("`create_task` — Create task");
    expect(content).toContain("`delete_production_deployment` — Delete production deployment");
    expect(content).toContain("consequential; confirm before execution");
    expect(content).toContain("https://github.com/NicholasZolton/SuperCmdK#webmcp");
    expect(content).toContain("https://www.npmjs.com/package/@supercmdk/react");
  });

  it("rejects an empty identity", () => {
    expect(() => generateLlmsTxt({ name: "", description: "Missing name" })).toThrow(/name/);
    expect(() => generateLlmsTxt({ name: "Acme", description: "" })).toThrow(/description/);
  });
});

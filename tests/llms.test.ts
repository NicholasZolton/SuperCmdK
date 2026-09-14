import { describe, expect, it } from "vitest";
import { createLlmsTxt } from "../demo/llms";

describe("llms.txt", () => {
  it("describes the site, its real WebMCP tools, and stable documentation", () => {
    const content = createLlmsTxt();

    expect(content).toContain("# SuperCmdK");
    expect(content).toContain("independent open-source project maintained by Nicholas Zolton");
    expect(content).toContain("does not operate a separate remote MCP server");
    expect(content).toContain("`find_project` — Find project");
    expect(content).toContain("Access: read-only");
    expect(content).toContain("`create_task` — Create task");
    expect(content).toContain("`delete_production_deployment` — Delete production deployment");
    expect(content).toContain("consequential and requires application confirmation");
    expect(content).toContain("https://github.com/NicholasZolton/SuperCmdK#webmcp");
    expect(content).toContain("https://www.npmjs.com/package/@supercmdk/react");
  });
});

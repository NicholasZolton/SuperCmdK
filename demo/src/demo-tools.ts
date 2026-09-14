import type { Tool } from "../../src/index.ts";

export type DemoLogTone = "violet" | "green";
export type AddDemoLog = (title: string, detail: string, tone?: DemoLogTone) => void;

/** Create the tools demonstrated by the site and exposed through WebMCP. */
export function createDemoTools(addLog: AddDemoLog): Tool[] {
  return [
    {
      name: "find_project",
      title: "Find project",
      description: "Find a project by its human-readable name and return its ID, name, and status. Use this before another tool needs a project ID.",
      annotations: {
        readOnlyHint: true,
      },
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Project name from the user's request" } },
        required: ["name"],
        additionalProperties: false,
      },
      execute: ({ name }) => {
        const requested = String(name).toLowerCase();
        if (!"atlas".includes(requested) && !requested.includes("atlas")) return { error: "No project found" };
        return { id: "atlas-42", name: "Atlas", status: "active" };
      },
    },
    {
      name: "create_task",
      title: "Create task",
      description: "Create a task in a project and return its ID, project ID, title, and creation status. Requires the exact project ID returned by find_project.",
      annotations: {
        readOnlyHint: false,
      },
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Exact project ID returned by find_project" },
          title: { type: "string", description: "Concise task title requested by the user" },
        },
        required: ["projectId", "title"],
        additionalProperties: false,
      },
      execute: ({ projectId, title }) => {
        // The engine may schedule dependent calls in the same turn. This demo accepts the
        // human-readable Atlas alias while the lookup result is fed back to the model.
        const resolvedProjectId = String(projectId).toLowerCase() === "atlas" ? "atlas-42" : String(projectId);
        const task = {
          id: `task-${Math.floor(Math.random() * 900 + 100)}`,
          projectId: resolvedProjectId,
          title,
          created: true,
        };
        addLog("Task created", `${String(title)} in ${resolvedProjectId}`, "green");
        return task;
      },
    },
    {
      name: "delete_production_deployment",
      title: "Delete production deployment",
      description: "Delete the simulated production deployment and return its deletion status and environment. Use only when the user explicitly asks to delete production.",
      annotations: {
        readOnlyHint: false,
        consequentialHint: true,
      },
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => {
        addLog(
          "Production deletion simulated",
          "Approval granted; the destructive tool ran without changing real resources.",
          "green",
        );
        return { deleted: true, simulated: true, environment: "production" };
      },
    },
  ];
}

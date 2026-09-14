import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonSchema, Tool } from "../src/tools/index.ts";
import { createDemoTools } from "./src/demo-tools.ts";

interface PackageMetadata {
  name: string;
  description: string;
  homepage: string;
  author: string;
  repository: {
    url: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPackageMetadata(): PackageMetadata {
  const path = resolve(process.cwd(), "package.json");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isRecord(value)
    || typeof value.name !== "string"
    || typeof value.description !== "string"
    || typeof value.homepage !== "string"
    || typeof value.author !== "string"
    || !isRecord(value.repository)
    || typeof value.repository.url !== "string"
  ) {
    throw new Error("package.json is missing metadata required to generate llms.txt.");
  }
  return {
    name: value.name,
    description: value.description,
    homepage: value.homepage,
    author: value.author,
    repository: { url: value.repository.url },
  };
}

function repositoryUrl(gitUrl: string): string {
  return gitUrl.replace(/^git\+/u, "").replace(/\.git$/u, "");
}

function schemaType(schema: JsonSchema): string {
  if (typeof schema.type === "string") return schema.type;
  if (schema.type === undefined) return "JSON value";
  return schema.type.join(" or ");
}

function formatArguments(tool: Tool): string[] {
  const properties = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);
  const entries = Object.entries(properties);
  if (entries.length === 0) return ["- Arguments: none"];
  return [
    "- Arguments:",
    ...entries.map(([name, schema]) => {
      const requirement = required.has(name) ? "required" : "optional";
      const description = schema.description ? ` — ${schema.description}` : "";
      return `  - \`${name}\` (${schemaType(schema)}, ${requirement})${description}`;
    }),
  ];
}

function formatTool(tool: Tool): string {
  const access = tool.annotations?.readOnlyHint ? "read-only" : "may modify demo state";
  const consequence = tool.annotations?.consequentialHint
    ? "; consequential and requires application confirmation"
    : "";
  return [
    `### \`${tool.name}\` — ${tool.title ?? tool.name}`,
    "",
    tool.description,
    "",
    `- Access: ${access}${consequence}`,
    ...formatArguments(tool),
  ].join("\n");
}

/** Generate the machine-readable guide shipped with the SuperCmdK demo. */
export function createLlmsTxt(): string {
  const metadata = readPackageMetadata();
  const sourceUrl = repositoryUrl(metadata.repository.url);
  const readmeUrl = `${sourceUrl}#readme`;
  const tools = createDemoTools((): void => undefined);

  return [
    "# SuperCmdK",
    "",
    `> ${metadata.description}`,
    "",
    "## About this project and website",
    "",
    `SuperCmdK is an independent open-source project maintained by ${metadata.author}. It is not a hosted SaaS company. The software is MIT-licensed and the demo does not require an account or make purchases.`,
    "",
    "This website is the live demonstration and documentation entry point for SuperCmdK. It shows a command palette for people, route-scoped commands, an on-device tool-calling agent, shared confirmation policy, and browser-agent access to the same tool registry.",
    "",
    "SuperCmdK is intended for React and TypeScript developers who want one typed action system shared by human interfaces, WebMCP browser agents, embedded agents, voice clients, accessibility controls, and automation.",
    "",
    "## Agent access",
    "",
    `Open the [live demo](${metadata.homepage}) in a WebMCP-capable browser to discover its current page tools through \`document.modelContext\`. SuperCmdK publishes WebMCP tools directly from the page; it does not operate a separate remote MCP server.`,
    "",
    "The tools below operate only on simulated local demo state. Tool arguments still pass through SuperCmdK's shared JSON Schema validation, authorization, confirmation, and cancellation path.",
    "",
    "## What the page demonstrates",
    "",
    "- A Cmd+K command palette for human users.",
    "- Commands that mount and unmount with the current page scope.",
    "- A WebMCP registry that follows the same scoped lifecycle.",
    "- A local Cactus Needle model that can chain JavaScript tool calls in a Worker.",
    "- Confirmation before a consequential simulated production deletion.",
    "- A visible activity log showing state-changing tool outcomes.",
    "",
    "## Current WebMCP tools",
    "",
    ...tools.flatMap((tool) => [formatTool(tool), ""]),
    "## Documentation",
    "",
    `- [Complete README and quickstart](${readmeUrl})`,
    `- [Installation](${sourceUrl}#install)`,
    `- [Tool registry and schemas](${sourceUrl}#tools)`,
    `- [WebMCP integration](${sourceUrl}#webmcp)`,
    `- [Policies and confirmation](${sourceUrl}#policies-and-confirmation)`,
    `- [Embedded agent API](${sourceUrl}#agent)`,
    `- [Demo source](${sourceUrl}/tree/main/demo)`,
    "",
    "## Packages and source",
    "",
    `- [${metadata.name} on npm](https://www.npmjs.com/package/${metadata.name}) — React UI, core tool registry, and built-in WebMCP bridge.`,
    "- [@supercmdk/needle on npm](https://www.npmjs.com/package/@supercmdk/needle) — optional pinned model and WASM runtime.",
    `- [Source repository](${sourceUrl})`,
    `- [Changelog](${sourceUrl}/blob/main/CHANGELOG.md)`,
    "",
  ].join("\n");
}

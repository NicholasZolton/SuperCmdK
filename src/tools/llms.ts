import type { JsonSchema, Tool, ToolSchema } from "./types.ts";

export interface LlmsTxtLink {
  title: string;
  url: string;
  description?: string;
}

export interface LlmsTxtPublisher {
  name: string;
  description?: string;
  url?: string;
}

export interface LlmsTxtAgentAccess {
  /** The website exposes tools through document.modelContext. */
  webMcp?: boolean;
  /** URL of a remote MCP server agents can connect to. */
  mcpUrl?: string;
  /** Additional access, safety, authentication, or usage guidance. */
  description?: string;
}

export interface LlmsTxtSection {
  title: string;
  /** Markdown content placed below the section heading. */
  content?: string;
  links?: readonly LlmsTxtLink[];
}

export interface LlmsTxtOptions {
  name: string;
  description: string;
  siteUrl?: string;
  purpose?: string;
  audience?: string;
  publisher?: LlmsTxtPublisher;
  agentAccess?: LlmsTxtAgentAccess;
  /** Durable tool definitions to document. Do not include context-dependent runtime snapshots. */
  tools?: readonly (ToolSchema | Tool)[];
  documentation?: readonly LlmsTxtLink[];
  sections?: readonly LlmsTxtSection[];
}

function schemaType(schema: JsonSchema): string {
  if (typeof schema.type === "string") return schema.type;
  if (schema.type === undefined) return "JSON value";
  return schema.type.join(" or ");
}

function formatLinks(links: readonly LlmsTxtLink[]): readonly string[] {
  return links.map((link) => {
    const description = link.description ? ` — ${link.description}` : "";
    return `- [${link.title}](${link.url})${description}`;
  });
}

function formatArguments(tool: ToolSchema): readonly string[] {
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

function formatTool(tool: ToolSchema): string {
  const access = tool.annotations?.readOnlyHint ? "read-only" : "may modify state";
  const annotations = [
    access,
    ...(tool.annotations?.consequentialHint ? ["consequential; confirm before execution"] : []),
    ...(tool.annotations?.untrustedContentHint ? ["may return untrusted content"] : []),
  ];
  return [
    `### \`${tool.name}\` — ${tool.title ?? tool.name}`,
    "",
    tool.description,
    "",
    `- Access: ${annotations.join("; ")}`,
    ...formatArguments(tool),
  ].join("\n");
}

function validateOptions(options: LlmsTxtOptions): void {
  if (!options.name.trim()) throw new Error("llms.txt requires a non-empty name.");
  if (!options.description.trim()) throw new Error("llms.txt requires a non-empty description.");
  for (const section of options.sections ?? []) {
    if (!section.title.trim()) throw new Error("llms.txt section titles must not be empty.");
  }
}

/** Generate an llms.txt document without writing files or reading runtime page state. */
export function generateLlmsTxt(options: LlmsTxtOptions): string {
  validateOptions(options);
  const lines: string[] = [
    `# ${options.name.trim()}`,
    "",
    `> ${options.description.trim()}`,
    "",
  ];

  if (options.purpose || options.audience || options.siteUrl) {
    lines.push("## About", "");
    if (options.purpose) lines.push(options.purpose.trim(), "");
    if (options.audience) lines.push(`Intended audience: ${options.audience.trim()}`, "");
    if (options.siteUrl) lines.push(`Website: [${options.siteUrl}](${options.siteUrl})`, "");
  }

  if (options.publisher) {
    const publisherName = options.publisher.url
      ? `[${options.publisher.name}](${options.publisher.url})`
      : options.publisher.name;
    lines.push("## Publisher", "", publisherName, "");
    if (options.publisher.description) lines.push(options.publisher.description.trim(), "");
  }

  if (options.agentAccess) {
    lines.push("## Agent access", "");
    if (options.agentAccess.webMcp) {
      lines.push("This website exposes its current page tools through WebMCP at `document.modelContext`.", "");
    }
    if (options.agentAccess.mcpUrl) {
      lines.push(`Remote MCP server: [${options.agentAccess.mcpUrl}](${options.agentAccess.mcpUrl})`, "");
    }
    if (options.agentAccess.description) lines.push(options.agentAccess.description.trim(), "");
  }

  for (const section of options.sections ?? []) {
    lines.push(`## ${section.title.trim()}`, "");
    if (section.content) lines.push(section.content.trim(), "");
    if (section.links && section.links.length > 0) lines.push(...formatLinks(section.links), "");
  }

  if (options.tools && options.tools.length > 0) {
    lines.push("## Tools", "");
    for (const tool of options.tools) lines.push(formatTool(tool), "");
  }

  if (options.documentation && options.documentation.length > 0) {
    lines.push("## Documentation", "", ...formatLinks(options.documentation), "");
  }

  return lines.join("\n");
}

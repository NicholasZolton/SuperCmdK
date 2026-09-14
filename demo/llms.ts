import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateLlmsTxt } from "../src/tools/llms.ts";
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

/** Generate the machine-readable guide shipped with the SuperCmdK demo. */
export function createLlmsTxt(): string {
  const metadata = readPackageMetadata();
  const sourceUrl = repositoryUrl(metadata.repository.url);
  return generateLlmsTxt({
    name: "SuperCmdK",
    description: metadata.description,
    siteUrl: metadata.homepage,
    purpose: "This website is the live demonstration and documentation entry point for SuperCmdK. It shows a command palette for people, route-scoped commands, an on-device tool-calling agent, shared confirmation policy, and browser-agent access to the same tool registry.",
    audience: "React and TypeScript developers who want one typed action system shared by human interfaces, WebMCP browser agents, embedded agents, voice clients, accessibility controls, and automation.",
    publisher: {
      name: metadata.author,
      url: sourceUrl,
      description: "SuperCmdK is an independent open-source project, not a hosted SaaS company. The software is MIT-licensed and the demo does not require an account or make purchases.",
    },
    agentAccess: {
      webMcp: true,
      description: `Open the live demo at ${metadata.homepage} in a WebMCP-capable browser to discover its current page tools. SuperCmdK publishes WebMCP tools directly from the page; it does not operate a separate remote MCP server. The tools operate only on simulated local demo state and use SuperCmdK's shared validation, authorization, confirmation, and cancellation path.`,
    },
    sections: [
      {
        title: "What the page demonstrates",
        content: [
          "- A Cmd+K command palette for human users.",
          "- Commands that mount and unmount with the current page scope.",
          "- A WebMCP registry that follows the same scoped lifecycle.",
          "- A local Cactus Needle model that can chain JavaScript tool calls in a Worker.",
          "- Confirmation before a consequential simulated production deletion.",
          "- A visible activity log showing state-changing tool outcomes.",
        ].join("\n"),
      },
      {
        title: "Packages and source",
        links: [
          {
            title: `${metadata.name} on npm`,
            url: `https://www.npmjs.com/package/${metadata.name}`,
            description: "React UI, core tool registry, and built-in WebMCP bridge.",
          },
          {
            title: "@supercmdk/needle on npm",
            url: "https://www.npmjs.com/package/@supercmdk/needle",
            description: "Optional pinned model and WASM runtime.",
          },
          { title: "Source repository", url: sourceUrl },
          { title: "Changelog", url: `${sourceUrl}/blob/main/CHANGELOG.md` },
        ],
      },
    ],
    tools: createDemoTools((): void => undefined),
    documentation: [
      { title: "Complete README and quickstart", url: `${sourceUrl}#readme` },
      { title: "Installation", url: `${sourceUrl}#install` },
      { title: "Tool registry and schemas", url: `${sourceUrl}#tools` },
      { title: "WebMCP integration", url: `${sourceUrl}#webmcp` },
      { title: "Policies and confirmation", url: `${sourceUrl}#policies-and-confirmation` },
      { title: "Embedded agent API", url: `${sourceUrl}#agent` },
      { title: "Demo source", url: `${sourceUrl}/tree/main/demo` },
    ],
  });
}

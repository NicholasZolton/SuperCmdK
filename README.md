# SuperCmdK

[Live demo](https://nicholaszolton.github.io/SuperCmdK/) · [GitHub](https://github.com/NicholasZolton/SuperCmdK) · [npm](https://www.npmjs.com/package/@supercmdk/react)

SuperCmdK is one typed action system for people and agents. Register [WebMCP](https://webmachinelearning.github.io/webmcp/)-shaped tools at the app or route level, expose them to browser agents through `document.modelContext`, and invoke the same handlers from React, voice clients, embedded agents, accessibility controls, and automation adapters through one policy and validation layer.

The React package includes:

- global and route-scoped command registration;
- a React-free, WebMCP-aligned tool registry with JSON Schema validation;
- a built-in WebMCP bridge for browser agents;
- a model-independent Agent API;
- a Cactus Needle adapter that runs inference in a Web Worker.

The optional `@supercmdk/palette` package supplies the cmdk-based palette, and `@supercmdk/needle` supplies the pinned model and WASM files.

## Install

```sh
bun add @supercmdk/react
```

Your app must provide React and React DOM 18 or 19. SuperCmdK uses ESM. The React package does not install a command-palette implementation.

## Quickstart with Needle

Install the React library, palette, and optional package that contains the pinned Needle model and WASM runtime:

```sh
bun add @supercmdk/react @supercmdk/palette @supercmdk/needle
```

The Needle package is about 14 MB on disk. It keeps the model out of `@supercmdk/react` and out of your initial JavaScript bundle. Your bundler emits the model as a separate asset, and SuperCmdK fetches it during browser idle time.

```tsx
import { createNeedleEngine } from "@supercmdk/needle";
import { CommandPalette } from "@supercmdk/palette";
import { SuperCmdKProvider, type Tool } from "@supercmdk/react";
import "@supercmdk/palette/styles.css";

const tools: Tool[] = [
  {
    name: "create_task",
    title: "Create task",
    description: "Create a task in the current project",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    execute: ({ title }) => tasks.create({ title: String(title) }),
  },
];

export function App() {
  return (
    <SuperCmdKProvider
      tools={tools}
      agent={{ engine: createNeedleEngine }}
    >
      <YourRoutes />
      <CommandPalette
        onAgentResult={(result) => console.log(result)}
        onError={(error) => console.error(error)}
      />
    </SuperCmdKProvider>
  );
}
```

`createNeedleEngine` supplies package-relative URLs for `needle.js`, `needle.wasm`, and `needle2.cact`. Vite, webpack, and other bundlers that support `new URL(..., import.meta.url)` copy those assets into the build automatically. Configure your host to serve `.wasm` as `application/wasm`. The Worker fetches the full model, so byte-range support is not required.

SuperCmdK loads and compiles Needle in a Web Worker during browser idle time. Set `agent={{ engine: createNeedleEngine, preload: false }}` to defer that work until the first Agent request.

The companion package includes unmodified Needle artifacts from a checksum-verified revision. Its adapter is MIT; the bundled model and WASM artifacts are Apache-2.0. The package includes the upstream license and revision metadata.

## Command palette

Install the optional palette package, then mount the provider and palette near your app root. Commands on the provider remain available across routes.

```sh
bun add @supercmdk/palette
```

```tsx
import { CommandPalette } from "@supercmdk/palette";
import { SuperCmdKProvider } from "@supercmdk/react";
import "@supercmdk/palette/styles.css";

export function App() {
  return (
    <SuperCmdKProvider
      commands={[
        {
          id: "home",
          label: "Go home",
          group: "Navigation",
          keywords: ["dashboard"],
          shortcut: ["⌘", "H"],
          run: () => location.assign("/"),
        },
      ]}
    >
      <Routes />
      <CommandPalette />
    </SuperCmdKProvider>
  );
}
```

When mounted, `CommandPalette` listens for `Cmd+K` on macOS or `Ctrl+K` on other platforms. A tools-only `SuperCmdKProvider` installs no keyboard listener. Pass `hotkey={false}` or a custom predicate to `CommandPalette`, and use `open` and `onOpenChange` on the provider when your application owns the palette state.

### Route-scoped commands

`useCommandChoice` and `useCommandChoices` register commands for the lifetime of a component. Pass dependencies as you would to `useEffect`.

```tsx
import { useCommandChoice, useCommandChoices } from "@supercmdk/react";

function CustomerPage({ customerId }: { customerId: string }) {
  useCommandChoice(
    {
      id: "archive-customer",
      label: "Archive this customer",
      group: "Customer",
      run: async ({ close }) => {
        await archiveCustomer(customerId);
        close();
      },
      closeOnSelect: false,
    },
    [customerId],
  );

  useCommandChoices(
    [{
      id: "copy-id",
      label: "Copy customer ID",
      run: () => navigator.clipboard.writeText(customerId),
    }],
    [customerId],
  );

  return <CustomerDetails id={customerId} />;
}
```

A route command overrides a provider command with the same `id`. SuperCmdK restores the provider command when the component unmounts.

Build a custom menu with the `Command`, flat `Command*` primitives, `defaultFilter`, and `useCommandState` APIs re-exported by `@supercmdk/palette`.

## Tools

Tools do not depend on the palette or an Agent. Their names, descriptions, input schemas, and annotations follow the WebMCP imperative API. Register app-wide tools on `SuperCmdKProvider`. Register route tools with `useTool` or `useTools`.

```tsx
import { useTools, type Tool } from "@supercmdk/react";

const messagingTools: Tool[] = [
  {
    name: "find_contact",
    title: "Find contact",
    description: "Find a contact by name and return the matching contact's ID, name, and address.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    execute: ({ name }, { signal, source }) =>
      contacts.findByName(String(name), { signal, source }),
  },
];

function MessagingPage() {
  useTools(messagingTools, []);
  return <Inbox />;
}
```

A route tool overrides an app-wide tool with the same `name`. SuperCmdK restores the app-wide tool on unmount.

Write descriptions that tell an agent both when to use a tool and what a successful call returns. Set `annotations.readOnlyHint` explicitly: use `true` only when the handler cannot modify application or external state, and `false` for tools that may write. The WebMCP bridge conservatively emits `false` when the hint is omitted.

> [!TIP]
> Run `auditToolQuality(tools)` in a test or build check. It reports missing titles and read-only hints, open argument schemas, undocumented properties, and contradictory safety annotations. The registry still accepts intentional exceptions, so the audit returns structured issues instead of throwing.

### WebMCP

The outermost provider exposes every active tool through the browser's `document.modelContext` registry by default:

```tsx
<SuperCmdKProvider tools={globalTools}>
  <Routes />
</SuperCmdKProvider>
```

Provider tools register globally. Tools added with `useTool` or `useTools` register when their component mounts and unregister when it unmounts. Scoped overrides replace the corresponding WebMCP tool and restore the previous definition during cleanup. Nested providers stay disconnected by default so one document has one WebMCP owner; use hooks beneath the root provider for ordinary route and component scopes.

Disable the bridge explicitly, or pass options to configure it:

```tsx
<SuperCmdKProvider tools={tools} webMcp={false}>
  <App />
</SuperCmdKProvider>

<SuperCmdKProvider
  tools={tools}
  webMcp={{ onError: (error, tool) => reportError(tool.name, error) }}
>
  <App />
</SuperCmdKProvider>
```

WebMCP is still experimental. The bridge uses feature detection and becomes a safe no-op when the browser does not provide `document.modelContext`; the palette, embedded Agent, voice, and direct invocation paths continue to work.

The WebMCP bridge is part of the React-free tools/core entrypoint. Connect it directly when another framework owns the registry lifecycle:

```ts
import { createToolRegistry } from "@supercmdk/react/tools";
import {
  connectToolRegistryToWebMcp,
  supportsWebMcp,
} from "@supercmdk/react/tools";

const registry = createToolRegistry({ tools: globalTools });
const bridge = connectToolRegistryToWebMcp(registry, {
  onError: (error, tool) => console.error(tool.name, error),
});

console.log({ supported: supportsWebMcp() });
window.addEventListener("pagehide", () => bridge.dispose(), { once: true });
```

WebMCP calls enter the same registry as every other caller with `context.source === "webmcp"`. Arguments are validated and policy is enforced before the handler runs. Successful results pass through unchanged so the browser can serialize them according to the WebMCP specification.

The current WebMCP draft discards the reason when a tool's promise rejects. To keep failures actionable, the bridge resolves registry failures as `{ ok: false, invocationId, error }`, where `error` includes the stable code, message, and any JSON Schema validation issues. Tool handlers should still throw concise, agent-safe error messages; direct registry callers continue to receive the usual `ToolInvocationResult` failure.

### Generate `llms.txt`

`generateLlmsTxt` is an optional, React-free build utility. Supply truthful site metadata, stable documentation links, agent access details, and the durable tools that should be documented:

```ts
import { generateLlmsTxt } from "@supercmdk/react/tools";

const llmsTxt = generateLlmsTxt({
  name: "Acme",
  description: "One workspace for customer operations.",
  siteUrl: "https://acme.example",
  purpose: "Manage customer accounts, projects, and tasks.",
  audience: "Acme customers and the agents acting on their behalf.",
  publisher: {
    name: "Acme, Inc.",
    url: "https://acme.example/about",
  },
  agentAccess: {
    webMcp: true,
    mcpUrl: "https://mcp.acme.example",
    description: "Account changes require authentication and application policy approval.",
  },
  tools: documentedTools,
  documentation: [
    { title: "Getting started", url: "https://acme.example/docs" },
    { title: "Authentication", url: "https://acme.example/docs/auth" },
  ],
});

await Bun.write("dist/llms.txt", llmsTxt);
```

The function returns a string and performs no file or browser operations, so Vite, Next.js, another framework, or a standalone build script can decide where to emit it. Tool entries are generated from `ToolSchema`; regular `Tool` objects also work because handlers are ignored. Pass only stable tool definitions—route-, permission-, and state-dependent runtime snapshots do not belong in static documentation.

### Invoke tools

`useSuperCmdK` exposes the current tool snapshot and the shared invocation path:

```tsx
const { tools, invokeTool } = useSuperCmdK();

const result = await invokeTool(
  "find_contact",
  { name: "Ada" },
  {
    source: "voice",
    metadata: { transcript: "Find Ada" },
  },
);
```

SuperCmdK validates arguments against each tool's JSON Schema without coercion. Invalid arguments do not reach the handler.

### Policies and confirmation

Set one provider policy for Agent, voice, and application calls:

```tsx
<SuperCmdKProvider
  tools={globalTools}
  toolPolicy={{
    authorize: ({ tool, context }) =>
      permissions.canUse(tool.name, context.source),
    confirm: ({ tool }) => window.confirm(`Allow ${tool.name}?`),
  }}
>
  <App />
</SuperCmdKProvider>
```

Tools use WebMCP's `readOnlyHint`, `untrustedContentHint`, and `consequentialHint` annotations. SuperCmdK requires confirmation for a tool marked `consequentialHint`; when `toolPolicy.confirm` is absent, the call is rejected safely. Your callback owns the approval UI, so it can use a browser prompt, an application modal, or a server-side approval flow.

The registry controls which handlers clients can call. It does not sandbox handler code. A handler can use the same browser credentials and capabilities as the rest of your application, so authorization must still be enforced at the server boundary.

### Observe tool runs

Use `onToolInvocation` to show agent activity in the interface without copying execution logic into each handler:

```tsx
<SuperCmdKProvider
  tools={tools}
  onToolInvocation={(event) => {
    activity.record({
      invocationId: event.invocationId,
      tool: event.tool.name,
      phase: event.phase,
      source: event.source,
    });
  }}
>
  <App />
</SuperCmdKProvider>
```

Each known tool call emits `started`, then one of `succeeded`, `failed`, `denied`, or `aborted`. Events include the tool, source, and failure details when applicable. They omit arguments and return values so a global activity listener does not become an accidental data log. A listener error does not change the tool result.

React-free consumers can subscribe to the same events:

```ts
const unsubscribe = registry.subscribeInvocations((event) => {
  activity.record(event);
});
```

Provider listeners also receive calls made by the embedded Agent. Pass `onToolInvocation` to `runAgentChain` when using the lower-level Agent API directly.

### Use tools outside React

Import the React-free registry from `@supercmdk/react/tools`:

```ts
import { createToolRegistry } from "@supercmdk/react/tools";

const registry = createToolRegistry({ tools: globalTools });

const unsubscribe = registry.subscribe(() => {
  voice.setTools(registry.getSnapshot());
});

const result = await registry.invokeTool(
  "find_contact",
  { name: "Ada" },
  { source: "voice" },
);
```

Pass the registry to `<SuperCmdKProvider toolRegistry={registry}>` when a voice client, Worker, or automation adapter needs the route-scoped tools that React components register. The `/tools` entry point imports neither React, cmdk, nor Needle.

## Agent

The `AgentEngine` interface separates tool orchestration from model inference. `@supercmdk/needle` supplies the bundled Cactus Needle adapter; you can instead provide any engine that implements the interface.

```tsx
import { createNeedleEngine } from "@supercmdk/needle";
import { CommandPalette } from "@supercmdk/palette";
import { SuperCmdKProvider } from "@supercmdk/react";

<SuperCmdKProvider
  agent={{
    engine: createNeedleEngine,
    systemPrompt: () =>
      `date: ${new Date().toISOString()}; locale: en-US`,
  }}
>
  <App />
  <CommandPalette
    agentRunOptions={{ maxSteps: 8, confidenceThreshold: 0.75 }}
    onAgentResult={(result) => console.log(result)}
  />
</SuperCmdKProvider>
```

SuperCmdK schedules engine preload after page load during browser idle time. `NeedleWasmEngine` downloads and compiles Needle inside `needle.worker.js`, away from React's thread. A prompt submitted during preload waits for the same request.

Set `preload: false` to load the engine on demand:

```tsx
<SuperCmdKProvider agent={{ engine: createEngine, preload: false }}>
  <App />
</SuperCmdKProvider>
```

Call `preloadAgent()` from `useSuperCmdK` when user intent gives you a better preload signal.

### Chain tools

The Agent receives the current tool schemas and invokes each handler through the tool registry. It can feed one result into the next call. For example, a request to “find Ada and tell her hello” can call `find_contact`, then pass the returned contact ID to `send_message`.

```tsx
import { useTools } from "@supercmdk/react";

function MessagingPage() {
  useTools(
    [
      {
        name: "find_contact",
        description: "Find a contact by name",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        },
        execute: ({ name }) => contacts.findByName(String(name)),
      },
      {
        name: "send_message",
        description: "Send a message to a contact ID",
        inputSchema: {
          type: "object",
          properties: {
            contactId: { type: "string" },
            body: { type: "string" },
          },
          required: ["contactId", "body"],
          additionalProperties: false,
        },
        annotations: { consequentialHint: true },
        execute: ({ contactId, body }) =>
          messages.send(String(contactId), String(body)),
      },
    ],
    [],
  );

  return <Inbox />;
}
```

SuperCmdK runs calls in order and caps a chain at eight turns unless you set `maxSteps`.

### Run without the palette

```tsx
const { runAgent } = useSuperCmdK();

const result = await runAgent("dim the living room lights", {
  confidenceThreshold: 0.8,
  systemPrompt: "date: 2026-08-13; locale: en-US",
  maxSteps: 4,
});
```

Use provider `toolPolicy.confirm` for confirmation shared across clients. `AgentRunOptions.confirm` remains available for code written against 0.1. SuperCmdK returns unknown tools, invalid arguments, denied calls, and handler failures to the Agent as normalized errors. Pass an `AbortSignal` to cancel a run.

### Lower-level API

Import the engine adapter and chain runner from the Agent entry point:

```ts
import { NeedleWasmEngine, runAgentChain } from "@supercmdk/react/agent";
```

`NeedleWasmEngine` implements `preload`, `initialize`, `complete`, `reset`, and `dispose`. `runAgentChain(engine, input, tools, options)` accepts Needle or another `AgentEngine` implementation.

Needle's WASM ABI supports one session per Worker. SuperCmdK serializes runs within each provider and sends the active tool schemas before each run.

## Performance

SuperCmdK keeps the Agent runtime in a separate chunk. The Worker handles model download, WASM compilation, model loading, and inference. The optional palette package does not load the Agent code unless an engine is configured.

Tool handlers run in your application context. Move CPU-heavy work into a Worker or server API. When a command closes the palette, SuperCmdK waits for the close to paint before it calls the command handler.

## WebMCP alignment

The canonical tool contract uses WebMCP's current imperative API vocabulary:

| Previous field | WebMCP-aligned field |
| --- | --- |
| `parameters` | `inputSchema` |
| `annotations.readOnly` | `annotations.readOnlyHint` |
| `annotations.requiresConfirmation` | `annotations.consequentialHint` |
| `annotations.destructive` | `annotations.consequentialHint` when the effect is significant or non-reversible |

`title` is now available as an optional human-readable label. Tool names must follow WebMCP's 1–128 character `[A-Za-z0-9_.-]` format, and every `inputSchema` must describe an object. `idempotent` has no current WebMCP equivalent and is no longer part of the annotations contract.

## Migrating

The optional command palette now lives in `@supercmdk/palette`. Install that package and update palette imports:

| Previous import | Current import |
| --- | --- |
| `CommandPalette` from `@supercmdk/react` | `CommandPalette` from `@supercmdk/palette` |
| cmdk primitives from `@supercmdk/react` | cmdk primitives from `@supercmdk/palette` |
| `@supercmdk/react/styles.css` | `@supercmdk/palette/styles.css` |

The provider, hooks, tools, and Agent APIs remain in `@supercmdk/react`.

### From 0.1

Version 0.2 keeps the 0.1 Agent tool names as deprecated aliases:

| 0.1 API | 0.2 API |
| --- | --- |
| `AgentTool` | `Tool` |
| `AgentToolContext` | `ToolContext` |
| `AgentToolSchema` | `ToolSchema` |
| `useAgentTool` | `useTool` |
| `useAgentTools` | `useTools` |

Provider `tools`, `runAgent`, `runAgentChain`, `AgentEngine`, and `@supercmdk/react/agent` imports still work. Version 0.2 rejects invalid tool arguments before it calls a handler.

## Demo

Open <https://nicholaszolton.github.io/SuperCmdK/> to try the palette and Needle tool chain. Use **Test approval** or ask the Agent to “delete production” to run a simulated destructive tool. Approving or denying it changes only the demo activity log. The [demo source](https://github.com/NicholasZolton/SuperCmdK/tree/main/demo) lives in this repository.

The demo build generates `/llms.txt` from package metadata and the same canonical tool definitions registered by the page. It describes the site, current WebMCP tools, safety behavior, packages, maintainer, and stable documentation links without treating route-scoped runtime state as durable documentation.

Run it on your machine with Tilt and portless:

```sh
mise trust
mise install
portless trust # one-time machine setup
mise run dev
```

The demo resolves Needle from the local `@supercmdk/needle` workspace package, so it needs no separate model download. Tilt prints the demo URL, often `https://web.supercmdk.localhost:1355`, and cleans up when you press Ctrl-C.

## Development

```sh
bun install
bun run check
bun run test
bun run build
```

## Releases

[Release Please](https://github.com/googleapis/release-please) reads Conventional Commits on `main` and updates one release PR:

- `fix:` requests a patch release.
- `feat:` requests a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer requests a major release.

Merge the release PR to update `package.json`, package versions, `bun.lock`, and `CHANGELOG.md`. Release Please then creates the `vX.Y.Z` GitHub Release. `.github/workflows/publish.yml` publishes `@supercmdk/react`, `@supercmdk/palette`, and `@supercmdk/needle` to npm through OIDC trusted publishing. Keep version edits and release tags in this flow.

# SuperCmdK

[Live demo](https://nicholaszolton.github.io/SuperCmdK/) · [GitHub](https://github.com/NicholasZolton/SuperCmdK) · [npm](https://www.npmjs.com/package/@supercmdk/react)

SuperCmdK adds a [`cmdk`](https://github.com/dip/cmdk) command palette to React applications. You can register commands and typed JavaScript tools at the app or route level. Agents, voice clients, accessibility controls, and automation adapters can invoke the same tools through one policy and validation layer.

The package includes:

- cmdk primitives and a styled `CommandPalette`;
- global and route-scoped command registration;
- a React-free tool registry with JSON Schema validation;
- a model-independent Agent API;
- a Cactus Needle adapter that runs inference in a Web Worker.

## Install

```sh
bun add @supercmdk/react
```

Your app must provide React and React DOM 18 or 19. SuperCmdK uses ESM. Import the optional stylesheet once:

```ts
import "@supercmdk/react/styles.css";
```

## Command palette

Mount the provider and palette near your app root. Commands on the provider remain available across routes.

```tsx
import { CommandPalette, SuperCmdKProvider } from "@supercmdk/react";
import "@supercmdk/react/styles.css";

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

Press `Cmd+K` on macOS or `Ctrl+K` on other platforms. Use `open` and `onOpenChange` when your application owns the palette state.

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

Build a custom menu with the re-exported `Command`, flat `Command*` primitives, `defaultFilter`, and `useCommandState` APIs from cmdk.

## Tools

Tools do not depend on the palette or an Agent. Register app-wide tools on `SuperCmdKProvider`. Register route tools with `useTool` or `useTools`.

```tsx
import { useTools, type Tool } from "@supercmdk/react";

const messagingTools: Tool[] = [
  {
    name: "find_contact",
    description: "Find a contact by name",
    parameters: {
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

Tools can set `annotations` for `readOnly`, `destructive`, `idempotent`, and `requiresConfirmation`. SuperCmdK rejects a tool marked `requiresConfirmation` when you omit `toolPolicy.confirm`.

The registry controls which handlers clients can call. It does not sandbox handler code. A handler can use the same browser credentials and capabilities as the rest of your application.

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

Pass the registry to `<SuperCmdKProvider toolRegistry={registry}>` when a voice client, Worker, or automation adapter needs the route-scoped tools that React components register. The `/tools` entry point imports neither React nor Needle.

## Agent

The `AgentEngine` interface separates tool orchestration from model inference. SuperCmdK includes `NeedleWasmEngine`, a browser adapter for [Cactus Needle](https://github.com/cactus-compute/needle). You can supply another engine that implements the same interface.

Needle does not publish a browser package. Download matching artifacts from the [Needle 2 model repository](https://huggingface.co/Cactus-Compute/needle2/tree/main), pin a revision, and serve these files from your application:

- `wasm/needle.js`
- `wasm/needle.wasm`
- `needle2.cact`

Read the model repository's Apache-2.0 terms before you redistribute the files.

```tsx
<SuperCmdKProvider
  agent={{
    engine: async () => {
      const { NeedleWasmEngine } = await import("@supercmdk/react/agent");
      return new NeedleWasmEngine({
        glueUrl: "/needle/needle.js",
        wasmUrl: "/needle/needle.wasm",
        modelUrl: "/needle/needle2.cact",
      });
    },
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
        parameters: {
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
        parameters: {
          type: "object",
          properties: {
            contactId: { type: "string" },
            body: { type: "string" },
          },
          required: ["contactId", "body"],
          additionalProperties: false,
        },
        annotations: { destructive: true, requiresConfirmation: true },
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

SuperCmdK keeps the Agent runtime in a separate chunk. The Worker handles model download, WASM compilation, model loading, and inference. Palette-only applications do not load the Agent code.

Tool handlers run in your application context. Move CPU-heavy work into a Worker or server API. When a command closes the palette, SuperCmdK waits for the close to paint before it calls the command handler.

## Migrating from 0.1

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

Open <https://nicholaszolton.github.io/SuperCmdK/> to try the palette and Needle tool chain. The [demo source](https://github.com/NicholasZolton/SuperCmdK/tree/main/demo) lives in this repository.

Run it on your machine with Tilt and portless:

```sh
mise trust
mise install
portless trust # one-time machine setup
mise run dev
```

`mise run dev` downloads pinned Needle assets into the ignored `demo/public/needle/` directory. Tilt prints the demo URL, often `https://web.supercmdk.localhost:1355`, and cleans up when you press Ctrl-C.

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

Merge the release PR to update `package.json`, `bun.lock`, and `CHANGELOG.md`. Release Please then creates the `vX.Y.Z` GitHub Release. `.github/workflows/publish.yml` publishes `@supercmdk/react` to npm through OIDC trusted publishing. Keep version edits and release tags in this flow.

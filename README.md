# SuperCmdK

A React command palette built on [`cmdk`](https://github.com/dip/cmdk), with:

- global and route/page-scoped command registration;
- a complete re-export of cmdk's unstyled primitives;
- page-scoped, allowlisted JavaScript tools for the SuperCmdK Agent;
- on-device inference powered by [Cactus Needle](https://github.com/cactus-compute/needle) in a Web Worker;
- bounded, confidence-gated tool chaining.

## Install

```sh
bun add @supercmdk/react cmdk
```

React 18 and 19 are supported. The package is ESM-only. Import the optional default theme once:

```ts
import "@supercmdk/react/styles.css";
```

## Command palette

Mount one provider and palette near the app root. Commands passed to the provider are global.

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

`Cmd+K` on macOS and `Ctrl+K` elsewhere toggles the menu. The open state can also be controlled with `open` and `onOpenChange`.

### Page-scoped choices

A registration exists only while its component is mounted, which naturally follows route lifetimes. Supply dependencies just like `useEffect`; this avoids requiring callers to memoize command objects.

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
    [{ id: "copy-id", label: "Copy customer ID", run: () => navigator.clipboard.writeText(customerId) }],
    [customerId],
  );

  return <CustomerDetails id={customerId} />;
}
```

A page registration overrides a global command with the same `id` and restores the global command when the page unmounts.

For fully custom menus, SuperCmdK re-exports `Command`, every flat `Command*` primitive, `defaultFilter`, and `useCommandState` directly from `cmdk`.

## Agent powered by Needle

SuperCmdK exposes model-independent `Agent*` functions, hooks, and types through an `AgentEngine` interface. Its included browser adapter is currently powered by Cactus Needle; other engines can implement the same interface. Needle does not publish an npm/browser package, so SuperCmdK provides the typed Worker and ABI wrapper but intentionally does **not** redistribute its engine or model. Download matching official artifacts and serve them as static assets:

- `wasm/needle.js`
- `wasm/needle.wasm`
- `needle2.cact`

They are available from the [Needle 2 model repository](https://huggingface.co/Cactus-Compute/needle2/tree/main). Pin a known revision rather than downloading moving `main` artifacts in production. Review the model repository's Apache-2.0 terms before redistributing those files.

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
    systemPrompt: () => `date: ${new Date().toISOString()}; locale: en-US`,
  }}
>
  <App />
  <CommandPalette
    agentRunOptions={{ maxSteps: 8, confidenceThreshold: 0.75 }}
    onAgentResult={(result) => console.log(result)}
  />
</SuperCmdKProvider>
```

By default, SuperCmdK waits for the page load event and a browser idle period, then preloads the configured engine. With `NeedleWasmEngine`, this downloads and compiles Needle in `needle.worker.js`. This background warmup never blocks React's UI thread. The first prompt reuses the loaded engine when ready, or safely waits for the same in-flight preload rather than starting another download.

### Expose chainable functions

Use `tools` on the provider for global functions or `useAgentTool(s)` for route-scoped functions. The Agent engine receives only their JSON Schemas; SuperCmdK dispatches model calls to the allowlisted JavaScript handlers and feeds each result back so it can choose the next tool.

```tsx
import { useAgentTools } from "@supercmdk/react";

function MessagingPage() {
  useAgentTools(
    [
      {
        name: "find_contact",
        description: "Find a contact by their human-readable name",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "The contact's name" },
          },
          required: ["name"],
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
        },
        execute: ({ contactId, body }) => messages.send(String(contactId), String(body)),
      },
    ],
    [],
  );

  return <Inbox />;
}
```

For “find Ada and tell her hello,” the Agent can call `find_contact`, consume its result, and then call `send_message`. Chaining defaults to at most eight turns. Calls execute sequentially for deterministic side effects.

You can also run the Agent outside the palette:

```tsx
const { runAgent } = useSuperCmdK();

const result = await runAgent("dim the living room lights", {
  confidenceThreshold: 0.8,
  systemPrompt: "date: 2026-08-13; locale: en-US",
  confirm: async (call) => window.confirm(`Allow ${call.name}?`),
  maxSteps: 4,
});
```

Use `confirm` for destructive or sensitive handlers. Unknown tools, denied calls, and handler errors are returned to the Agent as error results rather than executed. An `AbortSignal` and a confidence threshold can be supplied per run.

## Performance and loading

The Agent runtime remains a separate dynamic chunk. When the Agent is configured, SuperCmdK automatically creates its Worker and warms the WASM engine and model after the page finishes loading and the browser reports idle time (with a delayed fallback for browsers without `requestIdleCallback`). Downloading, WASM compilation, model loading, and inference stay off the main thread. A prompt submitted before warmup completes joins the same in-flight work.

Automatic warmup is enabled by default. Disable it for data-sensitive or bandwidth-constrained experiences while retaining on-demand loading:

```tsx
<SuperCmdKProvider agent={{ engine: createEngine, preload: false }}>
  <App />
</SuperCmdKProvider>
```

`preloadAgent()` remains available for explicit intent signals. Failed background warmups are discarded so the first explicit run can retry with a fresh Worker. Command handlers that close the palette are deferred until the close has painted. Tool handlers themselves execute in the application context; move CPU-heavy handler work into your own Worker or server API.

## Lower-level Agent API

Lower-level runtime exports live in a separate entry point so palette-only applications do not eagerly evaluate them:

```ts
import { NeedleWasmEngine, runAgentChain } from "@supercmdk/react/agent";
```

`NeedleWasmEngine` implements `AgentEngine` and exposes `preload`, `initialize`, `complete`, `reset`, and `dispose`. `runAgentChain(engine, input, tools, options)` can run the tool loop against that engine or any compatible implementation.

Needle's WASM ABI has one global session per worker. SuperCmdK therefore serializes runs per provider and reinitializes the active tool schema at the start of each run.

## Demo website

The repository includes a GitHub Pages deployment workflow at `.github/workflows/pages.yml`. On each push to `main`, it downloads and verifies the pinned Needle artifacts, builds the Vite demo with the repository base path, and deploys the static output. The model stays out of the initial JavaScript bundle and warms in the background after page load.

For this repository, the expected URL is:

<https://nicholaszolton.github.io/SuperCmdK/>

The repository owner must select **GitHub Actions** under **Settings → Pages → Build and deployment** once if Pages has not already been enabled. GitHub Pages availability for private repositories depends on the account plan; making the repository public also enables the standard Pages flow.

## Local demo

The included Vite demo shows global/page-scoped commands and runs the real Needle 2 WASM model through a multi-tool chain. `mise run dev` downloads pinned, checksum-verified Needle artifacts into the gitignored `demo/public/needle/` cache before Vite starts; the model is not committed or included in the npm package.

```sh
mise trust
mise install
portless trust # one-time machine setup
mise run dev
```

Open the `Demo` URL printed by the command, normally `https://web.supercmdk.localhost:1355`. The Agent begins warming its Needle engine during browser idle time; click **Run with Agent**, or open the palette and enter a natural-language request. Source and demo changes hot-reload through Vite; Tilt handles lifecycle and Ctrl-C cleanup.

## Development

```sh
bun install
bun run check
bun run test
bun run build
```

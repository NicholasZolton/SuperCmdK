# SuperCmdK

A React command palette built on [`cmdk`](https://github.com/dip/cmdk), with:

- global and route/page-scoped command registration;
- a complete re-export of cmdk's unstyled primitives;
- page-scoped, allowlisted JavaScript tools for [Cactus Needle](https://github.com/cactus-compute/needle);
- on-device Needle inference in a Web Worker using the official WASM artifacts;
- bounded, confidence-gated tool chaining.

## Install

```sh
bun add supercmdk cmdk
```

React 18 and 19 are supported. The package is ESM-only. Import the optional default theme once:

```ts
import "supercmdk/styles.css";
```

## Command palette

Mount one provider and palette near the app root. Commands passed to the provider are global.

```tsx
import { CommandPalette, SuperCmdKProvider } from "supercmdk";
import "supercmdk/styles.css";

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
import { useCommandChoice, useCommandChoices } from "supercmdk";

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

## Needle in WASM

Needle does not currently publish an npm/browser package. SuperCmdK provides the typed Worker and ABI wrapper, but intentionally does **not** redistribute Needle's engine or model. Download matching official artifacts and serve them as static assets:

- `wasm/needle.js`
- `wasm/needle.wasm`
- `needle2.cact`

They are available from the [Needle 2 model repository](https://huggingface.co/Cactus-Compute/needle2/tree/main). Pin a known revision rather than downloading moving `main` artifacts in production. Review the model repository's Apache-2.0 terms before redistributing those files.

```tsx
<SuperCmdKProvider
  needle={{
    glueUrl: "/needle/needle.js",
    wasmUrl: "/needle/needle.wasm",
    modelUrl: "/needle/needle2.cact",
    systemPrompt: () => `date: ${new Date().toISOString()}; locale: en-US`,
  }}
>
  <App />
  <CommandPalette
    needleRunOptions={{ maxSteps: 8, confidenceThreshold: 0.75 }}
    onNeedleResult={(result) => console.log(result)}
  />
</SuperCmdKProvider>
```

The first Needle prompt downloads and initializes the model. Inference runs synchronously inside `needle.worker.js`, never on React's UI thread. The model and engine remain loaded for later calls.

### Expose chainable functions

Use `tools` on the provider for global functions or `useNeedleTool(s)` for route-scoped functions. Needle receives only their JSON Schemas; SuperCmdK dispatches model calls to the allowlisted JavaScript handlers and feeds each result back so Needle can choose the next tool.

```tsx
import { useNeedleTools } from "supercmdk";

function MessagingPage() {
  useNeedleTools(
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

For “find Ada and tell her hello,” Needle can call `find_contact`, consume its result, and then call `send_message`. Chaining defaults to at most eight turns. Calls execute sequentially for deterministic side effects.

You can also run Needle outside the palette:

```tsx
const { runNeedle } = useSuperCmdK();

const result = await runNeedle("dim the living room lights", {
  confidenceThreshold: 0.8,
  systemPrompt: "date: 2026-08-13; locale: en-US",
  confirm: async (call) => window.confirm(`Allow ${call.name}?`),
  maxSteps: 4,
});
```

Use `confirm` for destructive or sensitive handlers. Unknown tools, denied calls, and handler errors are returned to Needle as error results rather than executed. An `AbortSignal` and a confidence threshold can be supplied per run.

## Performance and loading

The palette never downloads Needle during normal command-menu use. The Needle runtime is a separate dynamic chunk, and the Worker, WASM engine, and model are created only on the first `runNeedle()` call. Inference stays off the main thread. Command handlers that close the palette are deferred until the close has painted so synchronous application work cannot make the menu feel stuck.

If Needle is likely to be used, warm it during genuine idle time or a strong intent signal:

```tsx
const { preloadNeedle } = useSuperCmdK();

useEffect(() => {
  const id = requestIdleCallback(() => void preloadNeedle());
  return () => cancelIdleCallback(id);
}, [preloadNeedle]);
```

Preloading is opt-in because the model is roughly 14 MB and should not compete with critical page resources on every visit. Tool handlers still execute in the application context; move CPU-heavy handler work into your own Worker or server API.

## Lower-level Needle API

Lower-level runtime exports live in a separate entry point so palette-only applications do not eagerly evaluate them:

```ts
import { NeedleWasmClient, runNeedleChain } from "supercmdk/needle";
```

`NeedleWasmClient` implements `NeedleEngine` and exposes `preload`, `initialize`, `complete`, `reset`, and `dispose`. `runNeedleChain(engine, input, tools, options)` can run the tool loop against that client or any compatible engine.

Needle's WASM ABI has one global session per worker. SuperCmdK therefore serializes runs per provider and reinitializes the active tool schema at the start of each run.

## Local demo

The included Vite demo shows global/page-scoped commands and runs the real Needle 2 WASM model through a multi-tool chain. `mise run dev` downloads pinned, checksum-verified Needle artifacts into the gitignored `demo/public/needle/` cache before Vite starts; the model is not committed or included in the npm package.

```sh
mise trust
mise install
portless trust # one-time machine setup
mise run dev
```

Open the `Demo` URL printed by the command, normally `https://web.supercmdk.localhost:1355`. Click **Run with real Needle**, or open the palette and enter a natural-language request. The browser still fetches the model lazily on first intent, while later runs reuse the loaded Worker session. Source and demo changes hot-reload through Vite; Tilt handles lifecycle and Ctrl-C cleanup.

## Development

```sh
bun install
bun run check
bun run test
bun run build
```

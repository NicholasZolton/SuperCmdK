# @supercmdk/palette

Optional cmdk-based command palette for [`@supercmdk/react`](https://www.npmjs.com/package/@supercmdk/react).

```sh
bun add @supercmdk/react @supercmdk/palette
```

```tsx
import { CommandPalette } from "@supercmdk/palette";
import { SuperCmdKProvider } from "@supercmdk/react";
import "@supercmdk/palette/styles.css";

<SuperCmdKProvider>
  <App />
  <CommandPalette />
</SuperCmdKProvider>;
```

`CommandPalette` owns the `Cmd+K` / `Ctrl+K` listener. Pass `hotkey={false}` to disable it or a predicate to choose another shortcut. Using `SuperCmdKProvider` without a mounted palette does not capture keyboard events.

The package also re-exports cmdk primitives for custom palette composition.

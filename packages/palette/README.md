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

The package also re-exports cmdk primitives for custom palette composition.

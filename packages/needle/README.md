# @supercmdk/needle

Optional bundled [Cactus Needle 2](https://huggingface.co/Cactus-Compute/needle2)
model and WASM runtime for [`@supercmdk/react`](https://www.npmjs.com/package/@supercmdk/react).

```sh
bun add @supercmdk/react @supercmdk/needle
```

```tsx
import { CommandPalette, SuperCmdKProvider } from "@supercmdk/react";
import { createNeedleEngine } from "@supercmdk/needle";

<SuperCmdKProvider agent={{ engine: createNeedleEngine }}>
  <CommandPalette />
</SuperCmdKProvider>;
```

The package is about 14 MB because it contains the pinned model. Browser assets
remain lazy: installing the package does not put the model in your initial
JavaScript bundle, and SuperCmdK fetches it during idle preload or the first
Agent request. Inference runs in a Web Worker.

The adapter code is MIT. Bundled Needle files are Apache-2.0; see
`THIRD_PARTY_NOTICES.md` and `assets/LICENSE`.

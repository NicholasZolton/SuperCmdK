# Dev

Start: `mise run dev`

First time: `mise trust && mise install`, then `portless trust`.

`<prefix>` is the current directory name, lowercased and sanitized.

| Service | URL |
|---|---|
| Demo | `https://web.<prefix>.localhost:1355` |
| Tilt UI | `https://tilt.<prefix>.localhost:1355` |

Non-secret generated config is in `.env.tilt`; never edit it manually. `mise run dev` downloads pinned, checksum-verified Needle assets to the gitignored `demo/public/needle/` directory. No secrets or infrastructure services are required.

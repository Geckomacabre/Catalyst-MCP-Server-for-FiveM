# Catalyst MCP for FiveM

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-339933)
![.NET 8](https://img.shields.io/badge/.NET-8-512BD4)
![Windows](https://img.shields.io/badge/platform-Windows-0078D4)
[![MCP](https://img.shields.io/badge/MCP-server-black)](https://modelcontextprotocol.io)

An MCP server that lets Claude, or any MCP client, build GTA V particle effects (`.ypt`) for FiveM.
You describe the effect, it finds a vanilla one to start from, edits it and gives you a dictionary you can stream.
No editor window, no running game.

> Unofficial. Not affiliated with Rockstar Games or Cfx.re. See [NOTICE.md](NOTICE.md).

**Contents:** [What a session looks like](#what-a-session-looks-like) · [Quick start](#quick-start) ·
[Tools](#tools) · [How it works](#how-it-works) · [Troubleshooting](#troubleshooting) · [License](#license)

## What a session looks like

> *"Make me confetti in red and gold for a halftime show."*

The assistant searches the effects in your own GTA V install:

```text
ptfx_vanilla_search  query: "confetti"

5 hits
  scr_man_col         scr_man_col_confetti         2 emitters
  scr_man_col         scr_man_col_confetti_gold    2 emitters
  scr_sb_col          scr_sb_col_confetti          1 emitter
  scr_sb_col          scr_sb_col_confetti_gold     1 emitter
  scr_xs_celebration  scr_xs_confetti_burst        1 emitter
```

picks one, copies it into a new dictionary and makes a second colour from it:

```text
ptfx_merge   scr_xs_celebration / scr_xs_confetti_burst  ->  my_fx / my_confetti_red
ptfx_edit    duplicated effect my_confetti_red -> my_confetti_gold
             tint my_confetti_red min [200,20,30]
             tint my_confetti_gold min [255,190,40]
```

then builds the file and reads it back to check it:

```text
ptfx_pack    my_fx.ypt   2,384 bytes   read back: identical, 0 differences
ptfx_install resources/my_halftime/stream/my_fx.ypt
```

and you play it in game:

```lua
RequestNamedPtfxAsset("my_fx")
while not HasNamedPtfxAssetLoaded("my_fx") do Wait(0) end
UseParticleFxAssetNextCall("my_fx")
StartParticleFxNonLoopedAtCoord("my_confetti_gold", x, y, z, 0.0, 0.0, 0.0, 1.0, false, false, false)
```

These are real results from a run against a Legacy install, shortened for reading.

## Quick start

You need Windows, GTA V **Legacy** (Steam, Epic or Rockstar Games Launcher), [Node.js](https://nodejs.org) 20+ and
the [.NET 8 SDK](https://dotnet.microsoft.com/download).

```bash
git clone --recurse-submodules https://github.com/Geckomacabre/Catalyst-MCP-Server-for-FiveM.git
cd Catalyst-MCP-Server-for-FiveM
npm install
npm run build
npm run build:helper
```

Add it to Claude Code:

```bash
claude mcp add catalyst-fivem -s user -- node C:/path/to/Catalyst-MCP-Server-for-FiveM/dist/index.js
```

Then ask for an effect. The first time, the assistant runs `ptfx_vanilla_index`. This takes a few minutes:
it reads the effects out of your game files and caches them locally.

<details>
<summary>Claude Desktop and other MCP clients</summary>

Add this to the client's MCP config:

```json
{
  "mcpServers": {
    "catalyst-fivem": {
      "command": "node",
      "args": ["C:/path/to/Catalyst-MCP-Server-for-FiveM/dist/index.js"]
    }
  }
}
```

</details>

The GTA V folder is found automatically (from the registry and the usual install folders). If it isn't, set
`GTAV_PATH`, or pass `game` to `ptfx_vanilla_index`.

## Tools

| Tool | What it does |
|---|---|
| `ptfx_vanilla_index` | Indexes every vanilla effect in your install, once |
| `ptfx_vanilla_search` | Finds effects by name, asset or texture |
| `ptfx_vanilla_get` | Gives the path to a cached vanilla `.ypt` and its XML |
| `ptfx_info` | Lists a dictionary's effects, emitters, particles, textures and models |
| `ptfx_merge` | Builds a new dictionary from effects in other dictionaries |
| `ptfx_edit` | Changes values, keyframes, colours, names and textures |
| `ptfx_pack` | Builds the `.ypt` and checks it by reading it back |
| `ptfx_unpack` | Turns a `.ypt` into CodeWalker XML and `.dds` textures |
| `ptfx_install` | Copies the `.ypt` into a resource's `stream/` folder and returns the Lua |
| `catalyst_open` | Opens a `.ypt` in [Catalyst](https://docs.fivem.net/docs/catalyst/), if it's installed |

<details>
<summary>More on each tool</summary>

- **`ptfx_vanilla_index`**: takes a few minutes, once. When an effect exists in several archives it keeps the
  newest copy (DLC, then patch, then base; `ptfx_hi` first).
- **`ptfx_info`**: duration, loops and emitter/particle pairs per effect; spawn rate, life and domains per
  emitter; shader, behaviours, textures and colour keys per particle. With `detail` it lists every keyframed
  property.
- **`ptfx_merge`**: everything the chosen effects use comes with them: emitters, particles, chained effects,
  textures and models. Effects can be renamed on the way in.
- **`ptfx_edit`** operations:
  - `set`: a single value
  - `keys`: replace a keyframed property's keys
  - `scale`: multiply a value or keys
  - `rename`, `duplicate`, `delete`
  - `tint`: an effect's colour tint
  - `texture`: your own `.dds`, or one of the game's `core` textures
  - `dict_name`: rename the dictionary
- **`ptfx_pack`**: the built file is turned back into XML and compared rule by rule, so you know it is what
  you asked for.
- **`catalyst_open`**: the same as double-clicking the file. Use it to preview; Catalyst is also the way to export
  for GTA V Enhanced.

</details>

## How it works

The server is TypeScript (`src/`). A small .NET helper (`helper/`) built on
[CodeWalker.Core](https://github.com/dexyfex/codewalker) converts `.ypt` files to and from XML and reads the game's
archives. All editing happens on that XML, and the server writes it out byte for byte the way CodeWalker does.

- The archive keys come from your own `GTA5.exe`, as CodeWalker does it. Nothing is written into the game
  folder, and no game files are included in this repo.
- Builds are **Legacy (gen8)**, the format FiveM streams. For Enhanced (gen9), open the result in Catalyst and
  export from there.

<details>
<summary>Format notes</summary>

- Dictionary entries are stored sorted by name hash, so builds are compared by rule name, not position.
- `RefCount` is 1 + the number of references, matching Rockstar's files.
- `KeyframeTime.y` is 1 / (t − t_prev).
- Floats are float32.
- Textures with `ExternalReference=1` come from the game's `core` effects, by name.

</details>

<details>
<summary>Environment variables</summary>

| Variable | Default | |
|---|---|---|
| `GTAV_PATH` | found automatically | your GTA V folder |
| `CATALYST_MCP_CACHE` | `%LOCALAPPDATA%\catalyst-mcp-fivem` | the vanilla index and its cached files |
| `PTFX_HELPER` | `helper\bin\ptfx-helper.exe` | the CodeWalker helper |
| `CATALYST_EXE` | `%LOCALAPPDATA%\Cfx\Catalyst\Catalyst.exe` | Catalyst, for `catalyst_open` |

</details>

## Troubleshooting

- **`GTA V (Legacy) folder not found`**: set `GTAV_PATH` to the folder that contains `GTA5.exe`.
- **`that is GTA V Enhanced`**: the index reads Legacy, which is what FiveM runs. Point it at a Legacy install.
- **`ptfx-helper not found`**: run `npm run build:helper`. It needs the .NET 8 SDK, not only the runtime.
- **`no vanilla index yet`**: run `ptfx_vanilla_index` once. The assistant usually does this on its own.
- **`not a FiveM resource folder`**: `ptfx_install` wants the resource's own folder, the one with
  `fxmanifest.lua` in it.
- **An empty `vendor/codewalker` folder**: you cloned without submodules. Run `git submodule update --init`.
- **The effect doesn't show in game**: the name in `RequestNamedPtfxAsset` must match the `.ypt` file name, and
  the resource must be started.

## Tests

```bash
npm test
```

The test needs one vanilla `.ypt`: build the index first, or point `PTFX_TEST_YPT` at one. It checks the XML round
trip, a vanilla rebuild, merge, edit, pack and the MCP protocol.

## License

[GPL-3.0](LICENSE). CodeWalker is MIT; see [NOTICE.md](NOTICE.md).

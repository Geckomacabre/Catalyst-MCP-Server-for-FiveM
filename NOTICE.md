# Notices

## Not affiliated

Catalyst MCP for FiveM is an independent, unofficial project. It is not made, endorsed or supported by
Rockstar Games, Take-Two Interactive or Cfx.re. "Catalyst", "FiveM", "Grand Theft Auto" and "GTA" are
trademarks of their respective owners and are used here only to describe what this tool works with.

This project does not include, modify or automate Catalyst. `catalyst_open` only starts an installed
copy with the same command line its own file association uses (`--import <file>`), like double-clicking
a `.ypt`.

## No game files

No Rockstar game files are included. The vanilla index reads the user's own legitimately installed
GTA V and keeps the extracted copies in a local cache on that machine. Don't commit or redistribute
those files, or effects built from them, outside what Rockstar's and Cfx.re's terms allow for FiveM
content.

## CodeWalker

`helper/` builds against CodeWalker.Core from [dexyfex/codewalker](https://github.com/dexyfex/codewalker),
included as the `vendor/codewalker` git submodule, under the MIT license:

```
Copyright (c) 2017-2019 dexyfex
Copyright (c) 2015 Neodymium

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## npm packages

`@modelcontextprotocol/sdk` (MIT) and `zod` (MIT), installed by npm, not vendored.

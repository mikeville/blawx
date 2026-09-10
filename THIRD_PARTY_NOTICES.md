# Third-Party Notices

Blawx is licensed under the MIT License. That project license does not replace
the licenses of third-party software distributed with Blawx.

This notice covers the third-party runtime code included in the browser build.
Each component links to the license at the version used by Blawx. The complete
MIT permission text is reproduced once below and applies to every component
marked MIT; the component-specific copyright notices remain listed here.

## Distributed components

- **three 0.180.0** — License: [MIT](#mit-license) · Copyright © 2010-2025
  three.js authors · Repository: [license at r180](https://github.com/mrdoob/three.js/blob/r180/LICENSE)
- **quickjs-emscripten 0.32.0**, **quickjs-emscripten-core 0.32.0**, and
  **@jitl/quickjs-ffi-types 0.32.0** — License: [MIT](#mit-license) ·
  Copyright notice: quickjs-emscripten copyright (c) 2019-2024 Jake
  Teton-Landis · Repository: [license at v0.32.0](https://github.com/justjake/quickjs-emscripten/blob/v0.32.0/LICENSE)
- **@jitl/quickjs-wasmfile-debug-asyncify 0.32.0**,
  **@jitl/quickjs-wasmfile-debug-sync 0.32.0**,
  **@jitl/quickjs-wasmfile-release-asyncify 0.32.0**, and
  **@jitl/quickjs-wasmfile-release-sync 0.32.0** — License:
  [MIT](#mit-license) · Copyright notices: quickjs-emscripten copyright (c)
  2019-2024 Jake Teton-Landis; QuickJS Javascript Engine, Copyright (c)
  2017-2021 Fabrice Bellard and Copyright (c) 2017-2021 Charlie Gordon ·
  Repositories: [quickjs-emscripten at v0.32.0](https://github.com/justjake/quickjs-emscripten/blob/v0.32.0/LICENSE),
  [vendored QuickJS license at f1139494](https://github.com/bellard/quickjs/blob/f1139494d18a2053630c5ed3384a42bb70db3c53/LICENSE)

## Development-only tools

The following direct development dependencies build and test Blawx but are not
included in its browser distribution. Their transitive dependencies are
enumerated by `package-lock.json` and are downloaded by npm with their own
license files.

- **Vite 7.3.6** — License: MIT · Copyright (c) 2019-present, VoidZero Inc.
  and Vite contributors · Repository: [license at v7.3.6](https://github.com/vitejs/vite/blob/v7.3.6/packages/vite/LICENSE.md)
- **esbuild 0.28.2** — License: MIT · Copyright (c) 2020 Evan Wallace ·
  Repository: [license at v0.28.2](https://github.com/evanw/esbuild/blob/v0.28.2/LICENSE.md)

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

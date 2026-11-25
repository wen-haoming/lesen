# Third-party notices

Lesen original code is MIT; upstream dependencies remain under their own terms. This inventory covers 338 distinct installed dependency package/version pairs from the root frozen lockfile on macOS arm64. Platform-optional packages not installed here are not a complete cross-platform SBOM.

License/notice texts available in installed package roots are preserved verbatim in `licenses/dependencies.txt`. For npm packages that omit their notice files, `licenses/upstream-notices.txt` preserves MIT notices fetched from the repositories declared in their package manifests. These supplementary texts are default-branch snapshots, not a version-specific provenance attestation. When redistributing a bundled extension, retain applicable notices with the distribution, not only the source repository. Do not assume the root MIT license replaces these licenses.

- `lightningcss` and its macOS binary use MPL-2.0 (build tooling, not vendored into this source snapshot). If redistributing modified MPL files, comply with file-level source obligations.
- `caniuse-lite` data uses CC-BY-4.0; attribution and license text are preserved.
- Two package.json files inside Vite+ generator/monorepo templates have no standalone license field. They are unused scaffolding inside MIT-licensed `vite-plus`, not independently imported dependencies, and neither template is copied into this repository. They were excluded from the 338 dependency count, not silently relicensed.
- The local SVG fixture avatars are simple geometric demo illustrations. The owl icon master is accompanied by its AI-generation prompt, with no social-network marks or embedded account screenshots. Asset ownership/provenance beyond that local record is not a legal warranty.
- Emoji rendering references unmodified Twemoji 14.0.2 graphics hosted on jsDelivr: https://github.com/twitter/twemoji/tree/v14.0.2 . Graphics are CC-BY-4.0, copyright Twitter, Inc. and contributors; full terms are in `licenses/Twemoji-LICENSE-GRAPHICS.txt`. No Twemoji graphic files are vendored in this source tree.
- Demo content is synthetic. Public account handles in curated discovery suggestions are identifiers, not private subscription exports; no real user database or cached posts is included.
- No video/promo code or assets from the AGPL third-party starter project are included.

Local `src/components/ui` components adapted from shadcn/ui retain its MIT copyright notice in `licenses/shadcn-ui-MIT.txt` (upstream https://github.com/shadcn-ui/ui/blob/main/LICENSE.md).

## Installed dependency metadata

| Package | Version | License |
| --- | --- | --- |
| @1natsu/wait-element | 5.0.0 | MIT |
| @aklinker1/rollup-plugin-visualizer | 5.12.0 | MIT |
| @aklinker1/zero-zip | 1.0.1 | MIT |
| @babel/code-frame | 7.29.7 | MIT |
| @babel/compat-data | 7.29.7 | MIT |
| @babel/core | 7.29.13 | MIT |
| @babel/generator | 7.29.13 | MIT |
| @babel/helper-compilation-targets | 7.29.13 | MIT |
| @babel/helper-globals | 7.29.7 | MIT |
| @babel/helper-module-imports | 7.29.7 | MIT |
| @babel/helper-module-transforms | 7.29.13 | MIT |
| @babel/helper-plugin-utils | 7.29.7 | MIT |
| @babel/helper-string-parser | 7.29.13 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @babel/helper-validator-option | 7.29.7 | MIT |
| @babel/helpers | 7.29.13 | MIT |
| @babel/parser | 7.29.13 | MIT |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT |
| @babel/runtime | 7.29.13 | MIT |
| @babel/template | 7.29.7 | MIT |
| @babel/traverse | 7.29.13 | MIT |
| @babel/types | 7.29.11 | MIT |
| @blazediff/core | 1.10.0 | MIT |
| @emnapi/core | 1.11.3 | MIT |
| @emnapi/runtime | 1.11.3 | MIT |
| @emnapi/wasi-threads | 1.2.3 | MIT |
| @floating-ui/core | 1.8.0 | MIT |
| @floating-ui/dom | 1.8.0 | MIT |
| @floating-ui/react-dom | 2.1.9 | MIT |
| @floating-ui/utils | 0.2.12 | MIT |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @napi-rs/wasm-runtime | 1.2.2 | MIT |
| @oxc-project/runtime | 0.158.0 | MIT |
| @oxc-project/types | 0.156.0 | MIT |
| @oxc-project/types | 0.158.0 | MIT |
| @oxfmt/binding-darwin-arm64 | 0.78.0 | MIT |
| @oxlint-tsgolint/darwin-arm64 | 7.0.2006 | MIT |
| @oxlint/binding-darwin-arm64 | 1.93.0 | MIT |
| @oxlint/plugins | 1.93.0 | MIT |
| @polka/url | 1.0.0-next.29 | MIT |
| @radix-ui/number | 1.1.3 | MIT |
| @radix-ui/primitive | 1.2.0 | MIT |
| @radix-ui/react-accessible-icon | 1.2.0 | MIT |
| @radix-ui/react-accordion | 1.3.1 | MIT |
| @radix-ui/react-alert-dialog | 1.2.1 | MIT |
| @radix-ui/react-arrow | 1.1.17 | MIT |
| @radix-ui/react-aspect-ratio | 1.2.0 | MIT |
| @radix-ui/react-avatar | 1.3.1 | MIT |
| @radix-ui/react-checkbox | 1.4.1 | MIT |
| @radix-ui/react-collapsible | 1.2.1 | MIT |
| @radix-ui/react-collection | 1.2.0 | MIT |
| @radix-ui/react-compose-refs | 1.1.5 | MIT |
| @radix-ui/react-context | 1.3.0 | MIT |
| @radix-ui/react-context-menu | 2.4.1 | MIT |
| @radix-ui/react-dialog | 1.3.1 | MIT |
| @radix-ui/react-direction | 1.2.0 | MIT |
| @radix-ui/react-dismissable-layer | 1.2.1 | MIT |
| @radix-ui/react-dropdown-menu | 2.2.1 | MIT |
| @radix-ui/react-focus-guards | 1.2.0 | MIT |
| @radix-ui/react-focus-scope | 1.3.1 | MIT |
| @radix-ui/react-form | 0.3.0 | MIT |
| @radix-ui/react-hover-card | 1.2.1 | MIT |
| @radix-ui/react-id | 1.1.4 | MIT |
| @radix-ui/react-label | 2.1.17 | MIT |
| @radix-ui/react-menu | 2.2.1 | MIT |
| @radix-ui/react-menubar | 1.2.1 | MIT |
| @radix-ui/react-navigation-menu | 1.4.1 | MIT |
| @radix-ui/react-one-time-password-field | 0.2.1 | MIT |
| @radix-ui/react-password-toggle-field | 0.2.1 | MIT |
| @radix-ui/react-popover | 1.3.1 | MIT |
| @radix-ui/react-popper | 1.4.0 | MIT |
| @radix-ui/react-portal | 1.2.0 | MIT |
| @radix-ui/react-presence | 1.1.11 | MIT |
| @radix-ui/react-primitive | 2.2.0 | MIT |
| @radix-ui/react-progress | 1.2.1 | MIT |
| @radix-ui/react-radio-group | 1.5.1 | MIT |
| @radix-ui/react-roving-focus | 1.2.1 | MIT |
| @radix-ui/react-scroll-area | 1.4.0 | MIT |
| @radix-ui/react-select | 2.4.1 | MIT |
| @radix-ui/react-separator | 1.2.0 | MIT |
| @radix-ui/react-slider | 1.6.1 | MIT |
| @radix-ui/react-slot | 1.5.0 | MIT |
| @radix-ui/react-switch | 1.4.1 | MIT |
| @radix-ui/react-tabs | 1.2.1 | MIT |
| @radix-ui/react-toast | 1.3.1 | MIT |
| @radix-ui/react-toggle | 1.2.1 | MIT |
| @radix-ui/react-toggle-group | 1.2.1 | MIT |
| @radix-ui/react-toolbar | 1.2.1 | MIT |
| @radix-ui/react-tooltip | 1.4.1 | MIT |
| @radix-ui/react-use-callback-ref | 1.1.5 | MIT |
| @radix-ui/react-use-controllable-state | 1.3.0 | MIT |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT |
| @radix-ui/react-use-escape-keydown | 1.1.6 | MIT |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT |
| @radix-ui/react-use-previous | 1.1.4 | MIT |
| @radix-ui/react-use-rect | 1.1.4 | MIT |
| @radix-ui/react-use-size | 1.1.5 | MIT |
| @radix-ui/react-visually-hidden | 1.2.13 | MIT |
| @radix-ui/rect | 1.1.3 | MIT |
| @rolldown/binding-darwin-arm64 | 1.2.19 | MIT |
| @rolldown/pluginutils | 1.0.0-rc.3 | MIT |
| @rolldown/pluginutils | 1.1.0 | MIT |
| @supabase/auth-js | 2.119.0 | MIT |
| @supabase/functions-js | 2.119.0 | MIT |
| @supabase/phoenix | 0.4.5 | MIT |
| @supabase/postgrest-js | 2.119.0 | MIT |
| @supabase/realtime-js | 2.119.0 | MIT |
| @supabase/storage-js | 2.119.0 | MIT |
| @supabase/supabase-js | 2.119.0 | MIT |
| @tailwindcss/node | 4.3.5 | MIT |
| @tailwindcss/oxide | 4.3.5 | MIT |
| @tailwindcss/oxide-darwin-arm64 | 4.3.5 | MIT |
| @tailwindcss/oxide-wasm32-wasi | 4.3.5 | MIT |
| @tailwindcss/vite | 4.3.5 | MIT |
| @testing-library/dom | 10.4.2 | MIT |
| @testing-library/user-event | 14.6.9 | MIT |
| @topcli/prompts | 4.0.0 | ISC |
| @tybys/wasm-util | 0.10.3 | MIT |
| @types/aria-query | 5.0.4 | MIT |
| @types/babel__core | 7.20.5 | MIT |
| @types/babel__generator | 7.27.0 | MIT |
| @types/babel__template | 7.4.4 | MIT |
| @types/babel__traverse | 7.28.0 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/chrome | 0.1.43 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| @types/estree | 1.0.10 | MIT |
| @types/filesystem | 0.0.36 | MIT |
| @types/filewriter | 0.0.33 | MIT |
| @types/har-format | 1.2.16 | MIT |
| @types/node | 24.19.2 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/react-dom | 19.3.0 | MIT |
| @vitejs/plugin-react | 5.2.0 | MIT |
| @vitest/browser | 5.1.0 | MIT |
| @vitest/browser-preview | 5.1.0 | MIT |
| @vitest/mocker | 5.1.0 | MIT |
| @vitest/pretty-format | 5.1.0 | MIT |
| @vitest/snapshot | 5.1.0 | MIT |
| @vitest/spy | 5.1.0 | MIT |
| @vitest/ui | 5.1.0 | MIT |
| @vitest/utils | 5.1.0 | MIT |
| @voidzero-dev/vite-plus-core | 1.6.0 | MIT |
| @voidzero-dev/vite-plus-darwin-arm64 | 1.6.0 | MIT |
| @webext-core/fake-browser | 2.0.1 | MIT |
| @webext-core/isolated-element | 3.0.0 | MIT |
| @webext-core/match-patterns | 2.0.0 | MIT |
| @wxt-dev/browser | 0.3.7 | MIT |
| @wxt-dev/storage | 1.3.0 | MIT |
| @yuku-core/binding-darwin-arm64 | 0.19.0 | MIT |
| @yuku-toolchain/types | 0.19.0 | MIT |
| acorn | 8.19.0 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-styles | 5.2.0 | MIT |
| ansi-styles | 4.3.0 | MIT |
| aria-hidden | 1.2.6 | MIT |
| aria-query | 5.3.0 | Apache-2.0 |
| assertion-error | 2.0.1 | MIT |
| baseline-browser-mapping | 2.11.35 | Apache-2.0 |
| boolbase | 2.0.0 | ISC |
| browserslist | 4.29.5 | MIT |
| c12 | 3.3.4 | MIT |
| cac | 7.1.0 | MIT |
| caniuse-lite | 1.0.30001826 | CC-BY-4.0 |
| chai | 6.3.0 | MIT |
| chokidar | 5.0.0 | MIT |
| citty | 0.2.2 | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| cliui | 8.0.1 | ISC |
| clsx | 2.1.1 | MIT |
| cn | 0.5.2 | MIT |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| confbox | 0.2.4 | MIT |
| confbox | 0.3.2 | MIT |
| confbox | 0.1.8 | MIT |
| consola | 3.4.2 | MIT |
| convert-source-map | 2.0.0 | MIT |
| css-select | 7.0.0 | BSD-2-Clause |
| css-what | 8.0.0 | BSD-2-Clause |
| cssomnom | 0.1.11 | Apache-2.0 |
| csstype | 3.2.3 | MIT |
| debug | 4.4.3 | MIT |
| define-lazy-prop | 2.0.0 | MIT |
| defu | 6.1.7 | MIT |
| dequal | 2.0.3 | MIT |
| destr | 2.0.5 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| detect-node-es | 1.1.0 | MIT |
| dom-accessibility-api | 0.5.16 | MIT |
| dom-serializer | 2.0.0 | MIT |
| dom-serializer | 3.1.1 | MIT |
| domelementtype | 3.0.0 | BSD-2-Clause |
| domelementtype | 2.3.0 | BSD-2-Clause |
| domhandler | 6.0.1 | BSD-2-Clause |
| domhandler | 5.0.3 | BSD-2-Clause |
| domutils | 4.0.2 | BSD-2-Clause |
| domutils | 3.2.2 | BSD-2-Clause |
| dotenv | 17.4.2 | BSD-2-Clause |
| electron-to-chromium | 1.5.481 | ISC |
| emoji-regex | 8.0.0 | MIT |
| enhanced-resolve | 5.26.1 | MIT |
| entities | 7.0.1 | BSD-2-Clause |
| entities | 8.1.0 | BSD-2-Clause |
| entities | 4.5.0 | BSD-2-Clause |
| es-module-lexer | 2.3.2 | MIT |
| escalade | 3.2.0 | MIT |
| escape-string-regexp | 5.0.0 | MIT |
| estree-walker | 3.0.3 | MIT |
| expect-type | 1.4.0 | Apache-2.0 |
| exsolve | 1.2.0 | MIT |
| fdir | 6.5.0 | MIT |
| fflate | 0.8.3 | MIT |
| filesize | 11.0.30 | BSD-3-Clause |
| flatted | 3.4.4 | ISC |
| fsevents | 2.3.3 | MIT |
| gensync | 1.0.0-beta.2 | MIT |
| get-caller-file | 2.0.5 | ISC |
| get-nonce | 1.0.1 | MIT |
| giget | 3.3.1 | MIT |
| graceful-fs | 4.2.11 | ISC |
| hookable | 6.1.2 | MIT |
| html-escaper | 3.0.3 | MIT |
| htmlparser2 | 10.1.0 | MIT |
| iceberg-js | 0.8.1 | MIT |
| is-docker | 2.2.1 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| is-potential-custom-element-name | 1.0.1 | MIT |
| is-wsl | 2.2.0 | MIT |
| jiti | 2.7.0 | MIT |
| js-tokens | 10.0.0 | MIT |
| js-tokens | 4.0.0 | MIT |
| jsesc | 3.1.0 | MIT |
| json5 | 2.2.3 | MIT |
| lightningcss | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 |
| linkedom | 0.18.15 | ISC |
| local-pkg | 1.2.1 | MIT |
| lodash.merge | 4.6.2 | MIT |
| lru-cache | 5.1.1 | ISC |
| lucide-react | 0.544.0 | ISC |
| lz-string | 1.5.0 | MIT |
| magic-string | 1.4.5 | MIT |
| magicast | 0.5.5 | MIT |
| many-keys-map | 3.0.3 | MIT |
| mlly | 1.8.2 | MIT |
| mrmime | 2.0.1 | MIT |
| ms | 2.1.3 | MIT |
| nanoid | 3.3.20 | MIT |
| next-themes | 0.4.6 | MIT |
| node-releases | 2.0.63 | MIT |
| nth-check | 3.0.1 | BSD-2-Clause |
| nypm | 0.6.12 | MIT |
| obug | 3.0.0 | MIT |
| ohash | 2.0.12 | MIT |
| open | 8.4.2 | MIT |
| oxfmt | 0.78.0 | MIT |
| oxlint | 1.93.0 | MIT |
| oxlint-tsgolint | 7.0.2006 | MIT |
| pathe | 2.0.3 | MIT |
| perfect-debounce | 2.1.0 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.7 | MIT |
| picomatch | 2.3.2 | MIT |
| pkg-types | 1.3.1 | MIT |
| pkg-types | 2.4.0 | MIT |
| pngjs | 7.0.0 | MIT |
| postcss | 8.5.32 | MIT |
| pretty-format | 27.5.1 | MIT |
| publish-browser-extension | 6.2.0 | MIT |
| quansync | 0.2.11 | MIT |
| radix-ui | 1.8.1 | MIT |
| rc9 | 3.1.0 | MIT |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| react-is | 17.0.2 | MIT |
| react-refresh | 0.18.0 | MIT |
| react-remove-scroll | 2.7.2 | MIT |
| react-remove-scroll-bar | 2.3.8 | MIT |
| react-style-singleton | 2.2.3 | MIT |
| readdirp | 5.1.1 | MIT |
| require-directory | 2.1.1 | MIT |
| rolldown | 1.2.19 | MIT |
| scheduler | 0.28.0 | MIT |
| scule | 1.3.0 | MIT |
| semver | 6.3.2 | ISC |
| sirv | 3.0.2 | MIT |
| sonner | 2.0.8 | MIT |
| source-map | 0.7.6 | BSD-3-Clause |
| source-map-js | 1.2.2 | BSD-3-Clause |
| std-env | 4.3.0 | MIT |
| string-width | 4.2.3 | MIT |
| strip-ansi | 6.0.1 | MIT |
| strip-literal | 4.0.0 | MIT |
| superlock | 1.4.14 | MIT |
| tailwind-merge | 3.7.0 | MIT |
| tailwindcss | 4.3.5 | MIT |
| tapable | 2.3.3 | MIT |
| tasuku | 2.3.0 | MIT |
| tiny-open | 1.3.0 | MIT |
| tinybench | 6.2.3 | MIT |
| tinyexec | 1.3.1 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tinypool | 2.2.0 | MIT |
| tinyrainbow | 3.2.0 | MIT |
| totalist | 3.0.1 | MIT |
| tslib | 2.8.1 | 0BSD |
| tslib | 2.9.1 | 0BSD |
| tw-animate-css | 1.4.0 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| ufo | 1.6.4 | MIT |
| uhyphen | 0.2.0 | ISC |
| undici-types | 7.24.6 | MIT |
| unimport | 6.5.0 | MIT |
| unplugin | 3.7.0 | MIT |
| unplugin-utils | 0.3.2 | MIT |
| update-browserslist-db | 1.3.4 | MIT |
| use-callback-ref | 1.3.3 | MIT |
| use-sidecar | 1.1.3 | MIT |
| vite-plus | 1.6.0 | MIT |
| vitest | 5.1.0 | MIT |
| webpack-virtual-modules | 0.6.2 | MIT |
| why-is-node-running | 3.2.1 | MIT |
| wrap-ansi | 7.0.0 | MIT |
| ws | 8.22.2 | MIT |
| wxt | 0.21.5 | MIT |
| y18n | 5.0.8 | ISC |
| yallist | 3.1.1 | ISC |
| yargs | 17.7.3 | MIT |
| yargs-parser | 21.1.1 | ISC |
| yuku-core | 0.19.0 | MIT |
| yuku-parser | 0.19.0 | MIT |

## Upstream notice supplementation

The following npm package roots omitted notice files; their declared upstream projects are covered by the supplementary upstream MIT notices:

- @napi-rs/wasm-runtime@1.2.2
- @oxfmt/binding-darwin-arm64@0.78.0
- @oxlint/binding-darwin-arm64@1.93.0
- @polka/url@1.0.0-next.29
- @rolldown/binding-darwin-arm64@1.2.19
- @tailwindcss/oxide-wasm32-wasi@4.3.5
- @tybys/wasm-util@0.10.3
- @voidzero-dev/vite-plus-darwin-arm64@1.6.0
- @webext-core/fake-browser@2.0.1
- @webext-core/isolated-element@3.0.0
- @webext-core/match-patterns@2.0.0
- @wxt-dev/browser@0.3.7
- @wxt-dev/storage@1.3.0
- @yuku-core/binding-darwin-arm64@0.19.0
- @yuku-toolchain/types@0.19.0
- react-remove-scroll-bar@2.3.8
- sirv@3.0.2
- wxt@0.21.5
- yuku-core@0.19.0
- yuku-parser@0.19.0

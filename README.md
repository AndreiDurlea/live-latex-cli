# LiveLaTeX CLI

LiveLaTeX CLI is the `livelatex` command, which compiles LaTeX projects on every change, creates projects from templates and serves the [livelatex](https://github.com/AndreiDurlea/live-latex) API to editors over stdin/stdout, on Windows, macOS and Linux.

## Installation

```bash
npm install -g github:AndreiDurlea/live-latex-cli
livelatex doctor
```

Node.js 20 or later is required. No TeX installation is required: without TeX Live, MacTeX or MiKTeX, the first build downloads Tectonic.

## Usage

```bash
livelatex init my-paper            # copies AndreiDurlea/live-latex-quickstart
livelatex watch my-paper           # rebuilds my-paper/main.pdf on every change
livelatex build my-paper           # one full build; exit code 1 on errors
```

| Command | Action |
| :--- | :--- |
| `livelatex watch [dir]` | Runs a session and rebuilds after each file change |
| `livelatex build [dir]` | Runs one full build |
| `livelatex init [dir]` | Creates a project from a template |
| `livelatex doctor` | Lists detected TeX engines and the Tectonic binary |
| `livelatex serve` | Speaks the livelatex JSON protocol on stdin/stdout |

| Option | Applies to | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `-r`, `--root <file>` | watch, build | string | `livelatex.json` `root`, then `main.tex` | Root `.tex` file |
| `-e`, `--engine <name>` | watch, build | string | `auto` | `auto`, `tectonic`, `pdflatex`, `xelatex` or `lualatex` |
| `-o`, `--out-dir <dir>` | watch, build | string | root file directory | Output directory for the PDF and SyncTeX file |
| `--debounce <ms>` | watch | number | `40` | Delay between the last change and a draft build |
| `--draft` | build | flag | off | Single pass without bibliography or reruns |
| `-t`, `--template <spec>` | init | string | `quickstart` | Template name, `owner/repo[#ref]`, GitHub URL or local directory |
| `--force` | init | flag | off | Write into a non-empty directory |
| `--install` | doctor | flag | off | Download Tectonic if it is missing |

Exit status is 0 on success and 1 on a failed build or invalid arguments.

## Editor integration

`livelatex serve` reads one JSON request per line and writes responses and build events, one per line. The methods (`open`, `update`, `saved`, `build`, `forward`, `inverse`, `close`, `init`) are specified in the [live-latex README](https://github.com/AndreiDurlea/live-latex#json-protocol).

```bash
printf '{"id":1,"method":"hello"}\n' | livelatex serve
```

## Development

| Command | Action |
| :--- | :--- |
| `npm ci` | Installs the livelatex library from GitHub and compiles it |
| `npm test` | Compiles the CLI and runs its tests; `LIVELATEX_TEST_TECTONIC=1` adds an init-and-build test |

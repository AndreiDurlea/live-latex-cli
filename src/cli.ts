import * as fs from "node:fs";
import * as path from "node:path";
import {
  BuildResult,
  cacheDir,
  createBackend,
  EngineChoice,
  ensureTectonic,
  findTectonic,
  initProject,
  LiveLatexConfig,
  LiveSession,
  loadConfig,
  serve,
  SystemTexBackend,
  TECTONIC_VERSION,
  tectonicTarget,
  TEMPLATES,
} from "livelatex";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { dim: paint("2"), bold: paint("1"), red: paint("31"), green: paint("32"), yellow: paint("33"), cyan: paint("36") };

const VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

const HELP = `livelatex ${VERSION}: LaTeX compilation at typing speed.

Usage:
  livelatex watch [dir]     Rebuild on every change and keep the PDF current
  livelatex build [dir]     Run one converged build (exit code 1 on errors)
  livelatex init [dir]      Create a project from a template
  livelatex doctor          Show detected TeX engines and install Tectonic if needed
  livelatex serve           Speak the livelatex JSON protocol on stdin/stdout (editor integrations)

Options:
  -r, --root <file>         Root .tex file (default: livelatex.json "root", then main.tex)
  -e, --engine <name>       auto | tectonic | pdflatex | xelatex | lualatex (default: auto)
  -o, --out-dir <dir>       Directory for the PDF and SyncTeX file (default: next to the root file)
      --debounce <ms>       Delay after the last change before a draft build (default: 40)
      --draft               build: single pass, no bibliography or reruns
  -t, --template <name>     init: template name, owner/repo[#ref], or a local directory (default: quickstart)
      --force               init: write into a non-empty directory
      --install             doctor: download Tectonic if it is missing
  -h, --help                Show this help
  -v, --version             Show the version
`;

interface Args {
  cmd: string;
  dir: string;
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const alias: Record<string, string> = { r: "root", e: "engine", o: "out-dir", t: "template", h: "help", v: "version" };
  const boolean = new Set(["draft", "force", "install", "help", "version"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--?([^=]+)(?:=(.*))?$/.exec(a);
    if (!m || a === "-") {
      positional.push(a);
      continue;
    }
    const name = alias[m[1]] ?? m[1];
    if (m[2] !== undefined) flags[name] = m[2];
    else if (boolean.has(name)) flags[name] = true;
    else if (i + 1 < argv.length) flags[name] = argv[++i];
    else throw new Error(`Option --${name} needs a value.`);
  }
  return { cmd: positional[0] ?? "", dir: positional[1] ?? ".", flags };
}

function overrides(flags: Args["flags"]): Partial<LiveLatexConfig> {
  return {
    root: flags.root as string | undefined,
    engine: flags.engine as EngineChoice | undefined,
    outDir: flags["out-dir"] as string | undefined,
    debounceMs: flags.debounce !== undefined ? Number(flags.debounce) : undefined,
  };
}

function rel(p: string, base: string) {
  const r = path.relative(base, p);
  return r && !r.startsWith("..") ? r : p;
}

function report(r: BuildResult, projectDir: string) {
  const time = new Date().toTimeString().slice(0, 8);
  const ms = `${r.durationMs}ms`;
  if (r.cancelled) return;
  if (r.ok) {
    console.log(`${c.dim(time)} ${c.green("ok")}    ${r.mode.padEnd(5)} ${ms.padStart(7)}  ${rel(r.pdfPath, projectDir)}`);
  } else {
    const note = r.published ? "PDF updated with errors" : "kept previous PDF";
    console.log(`${c.dim(time)} ${c.red("error")} ${r.mode.padEnd(5)} ${ms.padStart(7)}  ${note}`);
  }
  const shown = r.diagnostics.filter((d) => d.severity === "error" || !r.ok).slice(0, 10);
  for (const d of shown) {
    const loc = `${rel(d.file, projectDir)}${d.line ? `:${d.line}` : ""}`;
    const sev = d.severity === "error" ? c.red("error") : c.yellow("warning");
    console.log(`  ${c.cyan(loc)}: ${sev}: ${d.message}`);
  }
  if (!r.ok && !r.diagnostics.length) {
    for (const l of r.output.trim().split(/\r?\n/).slice(-8)) console.log(`  ${c.dim(l)}`);
  }
}

async function openSession(dir: string, flags: Args["flags"]) {
  const projectDir = path.resolve(dir);
  const config = loadConfig(projectDir, overrides(flags));
  const { backend, reason } = await createBackend(projectDir, config, (m) => console.log(c.dim(m)));
  console.log(`${c.bold("LiveLaTeX")} ${c.dim(VERSION)}  ${config.root} via ${backend.description} ${c.dim(`(${reason})`)}`);
  return { projectDir, session: new LiveSession({ projectDir, config, backend }) };
}

async function cmdBuild(a: Args): Promise<number> {
  const { projectDir, session } = await openSession(a.dir, a.flags);
  const result = await session.build(a.flags.draft ? "draft" : "full");
  session.dispose();
  report(result, projectDir);
  return result.ok ? 0 : 1;
}

async function cmdWatch(a: Args): Promise<number> {
  const { projectDir, session } = await openSession(a.dir, a.flags);
  session.on("result", (r) => report(r, projectDir));
  session.on("error", (e) => console.error(c.red(`error: ${e.message}`)));
  const ignored = (f: string) =>
    /(^|[\\/])(\.git|\.livelatex|node_modules)([\\/]|$)/.test(f) ||
    /\.(pdf|synctex\.gz|aux|log|fls|fdb_latexmk|out|toc|xdv)$/i.test(f) ||
    /\.tmp-\d+$/.test(f);
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(projectDir, { recursive: true }, (_ev, f) => {
      if (f && !ignored(f.toString())) session.changedOnDisk();
    });
  } catch {
    // Platforms without recursive fs.watch: poll the tree.
    let last = "";
    const sig = () => {
      const parts: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (ignored(p)) continue;
          if (e.isDirectory()) walk(p);
          else parts.push(`${p}:${fs.statSync(p).mtimeMs}`);
        }
      };
      walk(projectDir);
      return parts.join("|");
    };
    last = sig();
    const t = setInterval(() => {
      const now = sig();
      if (now !== last) {
        last = now;
        session.changedOnDisk();
      }
    }, 250);
    watcher = { close: () => clearInterval(t) } as unknown as fs.FSWatcher;
  }
  console.log(c.dim("Watching for changes. Press Ctrl+C to stop."));
  session.build("full");
  await new Promise<void>((resolve) => {
    const stop = () => {
      watcher.close();
      session.dispose();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

async function cmdInit(a: Args): Promise<number> {
  const res = await initProject({
    targetDir: a.dir,
    template: a.flags.template as string | undefined,
    force: !!a.flags.force,
    log: (m) => console.log(c.dim(m)),
  });
  console.log(`${c.green("Created")} ${res.targetDir} ${c.dim(`from ${res.source}`)}`);
  const shown = path.relative(process.cwd(), res.targetDir);
  const cd = !shown ? "." : shown.startsWith("..") ? res.targetDir : shown;
  console.log(`Next: ${c.bold(`cd ${cd} && livelatex watch`)}  or open the folder in VS Code.`);
  return 0;
}

async function cmdDoctor(a: Args): Promise<number> {
  console.log(`${c.bold("LiveLaTeX")} ${VERSION} on ${process.platform}/${process.arch}, Node ${process.version}`);
  console.log(`Cache directory: ${cacheDir()}`);
  for (const e of ["pdflatex", "xelatex", "lualatex"] as const) {
    const b = SystemTexBackend.detect(e);
    console.log(`  ${e.padEnd(9)} ${b ? c.green(b.bins.engine) : c.dim("not found")}`);
  }
  const lm = SystemTexBackend.detect("pdflatex")?.bins.latexmk;
  console.log(`  ${"latexmk".padEnd(9)} ${lm ? c.green(lm) : c.dim("not found")}`);
  let tec = findTectonic();
  if (!tec && a.flags.install) tec = await ensureTectonic({ log: (m) => console.log(c.dim(m)) });
  const target = tectonicTarget();
  console.log(
    `  ${"tectonic".padEnd(9)} ${
      tec ? c.green(tec) : c.dim(target ? `not installed (run livelatex doctor --install to fetch ${TECTONIC_VERSION})` : "no build for this platform")
    }`,
  );
  console.log(`Templates: ${Object.entries(TEMPLATES).map(([k, v]) => `${k} (${v})`).join(", ")}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  if (a.flags.version) {
    console.log(VERSION);
    return 0;
  }
  if (a.flags.help || !a.cmd || a.cmd === "help") {
    console.log(HELP);
    return a.cmd || a.flags.help ? 0 : 1;
  }
  switch (a.cmd) {
    case "watch":
      return cmdWatch(a);
    case "build":
      return cmdBuild(a);
    case "init":
      return cmdInit(a);
    case "doctor":
      return cmdDoctor(a);
    case "serve":
      await serve(process.stdin, process.stdout);
      return 0;
    default:
      console.error(`Unknown command "${a.cmd}".\n\n${HELP}`);
      return 1;
  }
}

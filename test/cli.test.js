const { strict: assert } = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { parseArgs } = require("../dist/cli.js");

const bin = path.join(__dirname, "..", "bin", "livelatex.js");

test("argument parsing", () => {
  const a = parseArgs(["build", "paper", "-e", "xelatex", "--draft", "--debounce=10"]);
  assert.equal(a.cmd, "build");
  assert.equal(a.dir, "paper");
  assert.deepEqual(a.flags, { engine: "xelatex", draft: true, debounce: "10" });
});

test("help and version", () => {
  const help = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /livelatex serve/);
  const v = spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("serve answers hello over stdio", () => {
  const r = spawnSync(process.execPath, [bin, "serve"], { input: '{"id":1,"method":"hello"}\n', encoding: "utf8" });
  const reply = JSON.parse(r.stdout.trim().split("\n")[0]);
  assert.equal(reply.id, 1);
  assert.equal(reply.result.protocol, 1);
});

test("init from a template and build with Tectonic", { skip: !process.env.LIVELATEX_TEST_TECTONIC && "set LIVELATEX_TEST_TECTONIC=1", timeout: 600000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "livelatex-cli-"));
  // A local template keeps the test independent of GitHub access; LIVELATEX_TEST_TEMPLATE selects
  // another source, e.g. "quickstart" once the quickstart repository is readable.
  let template = process.env.LIVELATEX_TEST_TEMPLATE;
  if (!template) {
    template = path.join(root, "template");
    fs.mkdirSync(template);
    fs.writeFileSync(path.join(template, "main.tex"), "\\documentclass{article}\n\\begin{document}\nHello, Live LaTeX.\n\\end{document}\n");
  }
  const dir = path.join(root, "paper");
  const init = spawnSync(process.execPath, [bin, "init", dir, "--template", template], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const build = spawnSync(process.execPath, [bin, "build", dir, "--engine", "tectonic"], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.ok(fs.existsSync(path.join(dir, "main.pdf")));
});

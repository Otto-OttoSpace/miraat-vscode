"use strict";
// Miraat — Arabic / RTL Lint for VS Code.
// Runs the Miraat suite (miraat, lahja, daleel) via npx and surfaces findings as
// in-editor diagnostics. Zero bundled deps.
const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const { promisify } = require("util");
const execFile = promisify(cp.execFile);

let diag, out;

// npx is invoked through cmd.exe on Windows (it resolves to npx.cmd), so a
// crafted tool id or workspace file name could otherwise inject a command.
// Tool ids are simple repo slugs; targets are "." or a path relative to the
// workspace root — neither ever needs shell metacharacters.
const TOOL_RE = /^[a-z0-9-]+$/;
const SHELL_UNSAFE = /[<>|&;$`"'(){}\[\]!%^*?\r\n]/;
// Also reject a leading "-" so a crafted filename can't be read as an npx/tool flag.
function safePath(t) { return typeof t === "string" && t.length > 0 && !t.startsWith("-") && !SHELL_UNSAFE.test(t); }

// Pin each tool to a released tag so a compromised/force-pushed default branch
// can't ship arbitrary code to extension users through `npx -y github:`.
const TOOL_PINS = { miraat: "v0.8.0", kashida: "v0.6.1", lahja: "v0.5.1", daleel: "v0.7.0", mizan: "v0.3.1" };

function cfg(k, d) { return vscode.workspace.getConfiguration("miraat").get(k, d); }
function strip(s) {
  return (s || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n").filter(l => !/^\s*npm (notice|warn)/i.test(l)).join("\n");
}
function severity(tag) {
  return /^(flag|i18n)$/i.test(tag) ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Warning;
}

// Async so the extension host is never blocked while a linter runs (a scan can
// take seconds; the old synchronous call froze the whole editor, and on
// auditOnSave that happened on every save).
async function run(tool, target, cwd, license) {
  const env = Object.assign({}, process.env, license ? { MIRAAT_LICENSE: license } : {});
  const opts = { cwd, env, encoding: "utf8", timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024, shell: process.platform === "win32" };
  try {
    const ref = TOOL_PINS[tool];
    const spec = ref ? `github:Otto-OttoSpace/${tool}#${ref}` : `github:Otto-OttoSpace/${tool}`;
    const { stdout } = await execFile("npx", ["-y", spec, target], opts);
    return strip(stdout);
  } catch (e) {
    // linters may exit non-zero — their output is still on stdout/stderr
    return strip(((e.stdout || "") + "\n" + (e.stderr || "")).trim() || String(e.message || e));
  }
}

// Parse the shared Miraat output format:
//   <file path>
//     TAG :LINE  <detail>  <message>
function parse(text, tool, root, byFile) {
  if (!text) return;
  let cur = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const isIndented = /^\s/.test(raw);
    const line = raw.trim();
    if (!isIndented) {
      // treat as a file header only if it looks like a path (and not a "tool vX.Y" summary)
      if (/[\/\\]|\.(html?|css|scss|less|jsx?|tsx?|vue|svelte|astro|mdx?|json|ya?ml)(\b|$)/i.test(line) && !/\bv\d+\.\d+/.test(line)) {
        cur = line;
      }
      continue;
    }
    const m = raw.match(/^\s+([A-Za-z0-9]+)\s+:(\d+)\s+(.*)$/);
    if (m && cur) {
      const ln = Math.max(0, parseInt(m[2], 10) - 1);
      const fp = path.isAbsolute(cur) ? cur : path.join(root, cur);
      const d = new vscode.Diagnostic(
        new vscode.Range(ln, 0, ln, 200),
        `${m[3].trim()}  [${tool}:${m[1]}]`,
        severity(m[1])
      );
      d.source = "miraat";
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp).push(d);
    }
  }
}

async function audit(scope, doc) {
  // Never spawn a linter (which fetches+runs code via npx) in an untrusted
  // workspace — a malicious repo could otherwise auto-run it via auditOnSave.
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage("Miraat: auditing is disabled in an untrusted workspace — trust this folder to run the linters.");
    return;
  }
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!folder) { vscode.window.showWarningMessage("Miraat: open a folder to audit."); return; }
  const root = folder.uri.fsPath;
  let target = ".";
  if (scope === "file") {
    const d = doc || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
    if (!d || d.uri.scheme !== "file") return;
    target = path.relative(root, d.uri.fsPath) || ".";
    if (!safePath(target)) { vscode.window.showWarningMessage("Miraat: skipped — this file path contains unsupported characters."); return; }
  }
  const tools = String(cfg("tools", "miraat,lahja,daleel")).split(",").map(s => s.trim()).filter(Boolean)
    .filter(t => { const ok = TOOL_RE.test(t); if (!ok && out) out.appendLine(`Miraat: ignoring invalid tool name "${t}"`); return ok; });
  if (!tools.length) { vscode.window.showWarningMessage("Miraat: no valid tools configured (miraat.tools)."); return; }
  const license = cfg("licenseKey", "");
  out.clear(); out.show(true);
  out.appendLine(`Miraat — auditing "${target}" with: ${tools.join(", ")}\n`);
  const byFile = new Map();
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Miraat auditing…" }, async () => {
    for (const tool of tools) {
      const text = await run(tool, target, root, license);
      out.appendLine(`### ${tool}\n${text || "(no output)"}\n`);
      parse(text, tool, root, byFile);
    }
  });
  diag.clear();
  let total = 0;
  for (const [fp, arr] of byFile) { diag.set(vscode.Uri.file(fp), arr); total += arr.length; }
  vscode.window.showInformationMessage(total ? `Miraat: ${total} Arabic/RTL issue(s) found — see Problems.` : "Miraat: no Arabic/RTL issues 🎉");
}

function activate(context) {
  diag = vscode.languages.createDiagnosticCollection("miraat");
  out = vscode.window.createOutputChannel("Miraat");
  context.subscriptions.push(diag, out);
  context.subscriptions.push(
    vscode.commands.registerCommand("miraat.auditWorkspace", () => audit("workspace")),
    vscode.commands.registerCommand("miraat.auditFile", () => audit("file")),
    vscode.workspace.onDidSaveTextDocument(d => { if (cfg("auditOnSave", false)) audit("file", d); })
  );
  const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  sb.command = "miraat.auditWorkspace";
  sb.text = "$(globe) Miraat";
  sb.tooltip = "Audit for Arabic/RTL correctness";
  sb.show();
  context.subscriptions.push(sb);
}
function deactivate() {}

module.exports = { activate, deactivate };

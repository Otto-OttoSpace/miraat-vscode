# Miraat — Arabic / RTL Lint for VS Code

Catch Arabic and right-to-left (RTL) bugs **as you code** — severed cursive joins, physical CSS, missing Arabic fonts, bidi issues, DGA gaps — surfaced as diagnostics in the editor.

Powered by the open-source [Miraat suite](https://github.com/Otto-OttoSpace) (`miraat`, `lahja`, `daleel`). No install of the tools needed — the extension runs them on demand via `npx`.

## Commands
- **Miraat: Audit workspace for Arabic/RTL issues**
- **Miraat: Audit current file**

Findings appear in the **Problems** panel and inline. Click the status-bar **🌐 Miraat** to audit.

## Settings
| Setting | Default | Description |
|---|---|---|
| `miraat.tools` | `miraat,lahja,daleel` | Tools to run |
| `miraat.auditOnSave` | `false` | Audit a file automatically on save |

The extension and all five CLIs are free and open-source (MIT) — including the
Saudi **DGA compliance** checks (in `daleel`).

## Publishing (maintainer note)
`npm i -g @vscode/vsce` → `vsce login ottospace` → `vsce publish`. Requires the `ottospace` publisher + a marketplace PAT. Also publishable to Open VSX (`ovsx publish`). An `icon.png` (128×128) should be added before publishing.

---
By [Othmane Morad](https://ottospace.co) — Arabic/RTL design engineer. If it helps, [sponsor](https://github.com/sponsors/Otto-OttoSpace).

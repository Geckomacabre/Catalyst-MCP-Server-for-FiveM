// Catalyst MCP for FiveM
// Copyright (C) 2026 Catalyst MCP for FiveM contributors
// SPDX-License-Identifier: GPL-3.0-only
//
// Paths and the bridge to ptfx-helper (the .NET program built on CodeWalker.Core).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class PtfxError extends Error {}

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");

export const HELPER =
  process.env.PTFX_HELPER ??
  [join(ROOT, "helper", "bin", "ptfx-helper.exe"), join(ROOT, "helper", "bin", "ptfx-helper")].find((p) =>
    existsSync(p),
  ) ??
  join(ROOT, "helper", "bin", "ptfx-helper.exe");

export const CACHE =
  process.env.CATALYST_MCP_CACHE ??
  join(process.env.LOCALAPPDATA ?? join(homedir(), ".cache"), "catalyst-mcp-fivem");

export function helper<T = Record<string, unknown>>(cmd: string, args: Record<string, unknown> = {}): T {
  if (!existsSync(HELPER)) {
    throw new PtfxError(
      `ptfx-helper not found at ${HELPER}. Build it: dotnet publish helper/PtfxHelper.csproj -c Release -o helper/bin ` +
        "(needs the vendor/codewalker submodule: git submodule update --init), or set PTFX_HELPER.",
    );
  }
  const p = spawnSync(HELPER, [], {
    input: JSON.stringify({ cmd, ...args }),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  const out = (p.stdout ?? "").trim();
  if (!out) throw new PtfxError(`ptfx-helper gave no output (exit ${p.status}): ${(p.stderr ?? "").slice(0, 1500)}`);
  const res = JSON.parse(out);
  if (!res.ok) throw new PtfxError(`ptfx-helper ${cmd}: ${res.error}${res.inner ? " - " + res.inner : ""}`);
  delete res.ok;
  return res as T;
}

/** The GTA V (Legacy) folder: the `game` argument, GTAV_PATH, the Rockstar/Steam/Epic registry keys, or
 * the usual install folders. */
export function findGame(game?: string): string {
  const ok = (d: string | undefined) => !!d && existsSync(join(d, "GTA5.exe"));
  const tried: string[] = [];
  for (const d of [game, process.env.GTAV_PATH]) {
    if (d) {
      if (ok(d)) return resolve(d);
      tried.push(d);
    }
  }
  if (process.platform === "win32") {
    for (const key of [
      "HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\Grand Theft Auto V",
      "HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\GTAV",
    ]) {
      try {
        const txt = execFileSync("reg", ["query", key], { encoding: "utf8", windowsHide: true });
        for (const m of txt.matchAll(/REG_SZ\s+(.+)$/gm)) {
          const d = m[1].trim().replace(/\\$/, "");
          if (ok(d)) return d;
        }
      } catch {
        /* key not there */
      }
    }
    for (const d of [
      "C:\\Program Files\\Rockstar Games\\Grand Theft Auto V",
      "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Grand Theft Auto V",
      "C:\\Program Files\\Epic Games\\GTAV",
    ]) {
      if (ok(d)) return d;
    }
  }
  throw new PtfxError(
    `GTA V (Legacy) folder not found${tried.length ? " (tried " + tried.join(", ") + ")" : ""} - ` +
      "pass `game` or set GTAV_PATH to the folder with GTA5.exe.",
  );
}

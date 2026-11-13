#!/usr/bin/env node
// Catalyst MCP for FiveM
// Copyright (C) 2026 Catalyst MCP for FiveM contributors
// SPDX-License-Identifier: GPL-3.0-only
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU
// General Public License as published by the Free Software Foundation, version 3. It is distributed
// WITHOUT ANY WARRANTY; see the LICENSE file for details.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PtfxError } from "./helper.js";
import * as P from "./ptfx.js";
import * as V from "./vanilla.js";

const INSTRUCTIONS = `Build and edit GTA V particle effects (.ypt) for FiveM, headlessly.
Typical flow: ptfx_vanilla_index (once) -> ptfx_vanilla_search for a base effect -> ptfx_merge the effects
you want into a new dictionary with new names -> ptfx_info detail=true to see property names ->
ptfx_edit colours/sizes/rates/keyframes -> ptfx_pack (Legacy .ypt, verified by reading it back) ->
ptfx_install into a resource's stream/ folder. catalyst_open shows a .ypt in Catalyst if it is installed.`;

const server = new McpServer({ name: "catalyst-mcp-for-fivem", version: "0.1.0" }, { instructions: INSTRUCTIONS });

type Shape = z.ZodRawShape;
function tool<S extends Shape>(name: string, description: string, input: S, run: (a: z.infer<z.ZodObject<S>>) => unknown, readOnly = false) {
  const register = server.registerTool.bind(server) as unknown as (
    n: string, c: Record<string, unknown>, cb: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>) => void;
  register(name, { description, inputSchema: input, annotations: { readOnlyHint: readOnly, openWorldHint: false } }, async (args) => {
    try {
      const res = await run(args);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 1) }] };
    } catch (e) {
      const msg = e instanceof PtfxError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return { isError: true, content: [{ type: "text", text: msg }] };
    }
  });
}

const path = z.string().describe("absolute path");
const kind = z.enum(["effect", "emitter", "particle"]);

tool("ptfx_info",
  "Summarise a particle dictionary (.ypt or .ypt.xml): effects (duration, loops, emitter/particle pairs), emitter rules (domains, spawn rate, life), particle rules (shader, draw type, behaviours, textures embedded or from core, colour keys, chained effects), textures, drawables. detail=true adds every keyframed property and its keys.",
  { path, detail: z.boolean().optional() }, (a) => P.info(a.path, !!a.detail), true);

tool("ptfx_unpack",
  "Convert a .ypt to CodeWalker XML: <out_dir>/<name>.ypt.xml plus its embedded textures in <out_dir>/<name>/*.dds.",
  { ypt: path, out_dir: z.string().optional() }, (a) => P.unpack(a.ypt, a.out_dir));

tool("ptfx_pack",
  "Build a Legacy (gen8, resource v68) .ypt from a .ypt.xml and the .dds files in its sibling <name>/ folder. verify (default true) converts the result back and compares it rule by rule.",
  { xml: path, out: z.string().optional(), verify: z.boolean().optional() }, (a) => P.pack(a.xml, a.out, a.verify ?? true));

tool("ptfx_merge",
  "Make a NEW dictionary from effects in other dictionaries (vanilla ones from ptfx_vanilla_search, or yours), copying each effect's emitter rules, particle rules, chained effects, embedded textures and model drawables. Core textures stay references. Clashing rule names get a numeric suffix. Writes <name>.ypt.xml (+ textures): then ptfx_edit and ptfx_pack it.",
  {
    sources: z.array(z.object({
      file: z.string().describe(".ypt or .ypt.xml"),
      effects: z.union([z.array(z.string()), z.literal("*")]).optional(),
      rename: z.record(z.string(), z.string()).optional().describe("old effect name -> new"),
    })),
    name: z.string().describe("the new dictionary (asset) name, e.g. my_fx"),
    out_xml: z.string().optional(),
  }, (a) => P.merge(a.sources, a.name, a.out_xml));

tool("ptfx_edit",
  "Edit a .ypt.xml (in place or to `out`). ops, applied in order: " +
  "{op:'set', kind, name, path:'DurationMax' | 'CreationDomainObj/DomainType' | 'AllBehaviours/Colour/RGBAMaxEnable' | 'EventEmitters/0/StartRatio', value}; " +
  "{op:'keys', kind, name, prop:'ptxu_Colour:m_rgbaMinKFP', keys:[[t,x,y,z,w],...]} (t 0..1 over life/duration); " +
  "{op:'scale', kind, name, prop:'ptxEmitterRule:m_spawnRateOverTimeKFP', factor: f | [fx,fy,fz,fw]}; " +
  "{op:'rename'|'duplicate'|'delete', kind, name, to}; {op:'tint', name: effect, min:[r,g,b,a], max:[r,g,b,a]}; " +
  "{op:'texture', name: particle, texture, var:'diffusetex2', external: bool, dds: path to your own .dds}; {op:'dict_name', to}. " +
  "kind defaults to particle. ptfx_info detail=true lists the prop names.",
  {
    xml: path,
    ops: z.array(z.object({
      op: z.enum(["set", "keys", "scale", "rename", "duplicate", "delete", "tint", "texture", "dict_name"]),
      kind: kind.optional(), name: z.string().optional(), path: z.string().optional(), value: z.unknown().optional(),
      prop: z.string().optional(), keys: z.array(z.array(z.number())).optional(),
      factor: z.union([z.number(), z.array(z.number())]).optional(), to: z.string().optional(), deep: z.boolean().optional(),
      min: z.array(z.number()).optional(), max: z.array(z.number()).optional(), texture: z.string().optional(),
      var: z.string().optional(), external: z.boolean().optional(), dds: z.string().optional(),
    })),
    out: z.string().optional(),
  }, (a) => P.edit(a.xml, a.ops as P.EditOp[], a.out));

tool("ptfx_vanilla_index",
  "Build (once; a few minutes) the index of every vanilla effect in your own GTA V Legacy install: reads the game's archives (keys come from your GTA5.exe; nothing is written to the game folder) and caches the best copy of each .ypt (DLC > patch > base, ptfx_hi preferred). game: the folder with GTA5.exe (auto-detected if omitted). refresh rebuilds.",
  { game: z.string().optional(), refresh: z.boolean().optional() }, (a) => V.summary(V.buildIndex(a.game, !!a.refresh)));

tool("ptfx_vanilla_search",
  "Find vanilla effects by words in the effect, asset or texture names, e.g. 'confetti', 'firework burst', 'spark', 'flame'. Returns asset, effect, loops, textures and the cached .ypt.",
  { query: z.string(), limit: z.number().int().optional() }, (a) => V.search(a.query, a.limit ?? 50), true);

tool("ptfx_vanilla_get", "The cached .ypt (and its XML) of a vanilla asset, e.g. 'scr_xs_celebration'.",
  { asset: z.string() }, (a) => V.get(a.asset), true);

tool("ptfx_install",
  "Copy a built .ypt into a FiveM resource's stream/ folder and return the Lua that plays an effect from it.",
  { ypt: path, resource_dir: path, effect: z.string().optional() }, (a) => {
    const rd = resolve(a.resource_dir);
    if (!existsSync(join(rd, "fxmanifest.lua"))) throw new PtfxError(`${rd} has no fxmanifest.lua - not a FiveM resource folder`);
    const name = P.stem(a.ypt);
    mkdirSync(join(rd, "stream"), { recursive: true });
    const dst = join(rd, "stream", name + ".ypt");
    copyFileSync(a.ypt, dst);
    const eff = a.effect ?? "<effect name>";
    return {
      copied: dst,
      lua: [
        `local asset = "${name}"`,
        "RequestNamedPtfxAsset(asset)",
        "while not HasNamedPtfxAssetLoaded(asset) do Wait(0) end",
        "UseParticleFxAssetNextCall(asset)",
        `StartParticleFxNonLoopedAtCoord("${eff}", x, y, z, 0.0, 0.0, 0.0, 1.0, false, false, false)`,
        "-- looped: local h = StartParticleFxLoopedAtCoord(...) ... StopParticleFxLooped(h, false)",
        "-- tint a non-looped effect: SetParticleFxNonLoopedColour(r, g, b) right before the Start call",
      ].join("\n"),
    };
  });

tool("catalyst_open",
  "Open a .ypt in Catalyst (Cfx.re's particle editor), if it is installed, to preview it - the same as double-clicking it. Uses Catalyst's own file association (`--import`). Catalyst opens in front of other windows.",
  { ypt: path }, (a) => {
    const exe = process.env.CATALYST_EXE ?? join(process.env.LOCALAPPDATA ?? "", "Cfx", "Catalyst", "Catalyst.exe");
    if (!existsSync(exe)) throw new PtfxError(`Catalyst not found at ${exe} (install it from Cfx.re, or set CATALYST_EXE)`);
    if (!existsSync(a.ypt)) throw new PtfxError(`not found: ${a.ypt}`);
    const p = spawn(exe, ["--import", resolve(a.ypt)], { detached: true, stdio: "ignore", windowsHide: false });
    p.unref();
    return { launched: exe, file: resolve(a.ypt), pid: p.pid };
  });

await server.connect(new StdioServerTransport());

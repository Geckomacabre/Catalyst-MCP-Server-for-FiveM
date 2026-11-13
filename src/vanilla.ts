// Catalyst MCP for FiveM
// Copyright (C) 2026 Catalyst MCP for FiveM contributors
// SPDX-License-Identifier: GPL-3.0-only
//
// An index of every vanilla particle effect in the player's own GTA V (Legacy) install. The game's
// archives are only read; the extracted copies stay in the local cache and are never redistributed.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, PtfxError, findGame, helper } from "./helper.js";
import { emittersOf, find, items, load, texturesOf, unpackMany, val } from "./ptfx.js";
import { textOf } from "./xml.js";

const VDIR = join(CACHE, "vanilla");
const INDEX = join(VDIR, "index.json");

interface Effect { name: string; emitters: number; loops: unknown; textures: string[] }
interface Asset { ypt: string; archive: string; inner: string; xml?: string; effects?: Effect[]; error?: string }
export interface Index { game: string; built: string; assets: Record<string, Asset> }

/** Higher wins: DLC packs > update dlc_patch > update x64/patch > base; ptfx_hi > ptfx > ptfx_lo. */
function precedence(archive: string, inner: string): number {
  const a = archive.replace(/\\/g, "/").toLowerCase();
  const i = inner.toLowerCase();
  const tier = a.includes("/dlcpacks/") ? 3 : i.includes("dlc_patch/") ? 2 : a.endsWith("update.rpf") ? 1 : 0;
  const q = i.includes("ptfx_hi.rpf") ? 2 : i.includes("ptfx_lo.rpf") ? 0 : 1;
  return tier * 10 + q;
}

function archives(game: string): string[] {
  const out = readdirSync(game).filter((f) => f.toLowerCase().endsWith(".rpf")).map((f) => join(game, f));
  const upd = join(game, "update", "update.rpf");
  if (existsSync(upd)) out.push(upd);
  const dlc = join(game, "update", "x64", "dlcpacks");
  if (existsSync(dlc)) {
    for (const d of readdirSync(dlc).sort()) {
      const p = join(dlc, d, "dlc.rpf");
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

export function buildIndex(game?: string, refresh = false, log: (m: string) => void = () => {}): Index {
  if (existsSync(INDEX) && !refresh) return JSON.parse(readFileSync(INDEX, "utf8"));
  const g = findGame(game);
  if (existsSync(join(g, "gta5_enhanced.exe"))) throw new PtfxError("that is GTA V Enhanced; the index reads Legacy (what FiveM runs)");
  mkdirSync(VDIR, { recursive: true });

  const best = new Map<string, { pr: number; archive: string; inner: string }>();
  for (const arc of archives(g)) {
    const r = helper<{ entries: { path: string }[] }>("rpf_list", { archive: arc, game: g, ext: ".ypt" });
    for (const e of r.entries) {
      const asset = e.path.split("/").pop()!.replace(/\.ypt$/i, "").toLowerCase();
      const pr = precedence(arc, e.path);
      const cur = best.get(asset);
      if (!cur || pr >= cur.pr) best.set(asset, { pr, archive: arc, inner: e.path });
    }
  }
  log(`${best.size} assets found`);

  const byArc = new Map<string, { asset: string; inner: string }[]>();
  for (const [asset, b] of best) byArc.set(b.archive, [...(byArc.get(b.archive) ?? []), { asset, inner: b.inner }]);
  const raw = join(VDIR, "_raw");
  const yptDir = join(VDIR, "ypt");
  mkdirSync(yptDir, { recursive: true });
  const files: Record<string, Asset> = {};
  for (const [arc, list] of byArc) {
    rmSync(raw, { recursive: true, force: true });
    helper("rpf_extract", { archive: arc, game: g, entries: list.map((x) => x.inner), out_dir: raw });
    for (const { asset, inner } of list) {
      const f = join(raw, ...inner.toLowerCase().split("/"));
      if (!existsSync(f)) continue;
      const dst = join(yptDir, asset + ".ypt");
      copyFileSync(f, dst);
      files[asset] = { ypt: dst, archive: arc, inner };
    }
  }
  rmSync(raw, { recursive: true, force: true });
  log(`${Object.keys(files).length} extracted`);

  const names = Object.keys(files).sort();
  const res = unpackMany(names.map((a) => ({ ypt: files[a].ypt, outDir: join(VDIR, "xml", a) })));
  const index: Index = { game: g, built: new Date().toISOString(), assets: {} };
  names.forEach((asset, k) => {
    const meta = files[asset];
    if (res[k].error) {
      index.assets[asset] = { ...meta, error: String(res[k].error).slice(0, 300) };
      return;
    }
    try {
      const r = load(res[k].xml);
      const effects: Effect[] = items(r, "effect").map((e) => {
        const tex = new Set<string>();
        for (const [, p] of emittersOf(e)) {
          const pe = find(r, "particle", p);
          if (pe) texturesOf(pe).forEach((t) => tex.add(t.texture));
        }
        const n = val(e, "NumLoops");
        return { name: textOf(e, "Name"), emitters: emittersOf(e).length, loops: n === 0xffffffff ? "infinite" : n, textures: [...tex].sort() };
      });
      index.assets[asset] = { ...meta, xml: res[k].xml, effects };
    } catch (ex) {
      index.assets[asset] = { ...meta, error: String(ex).slice(0, 300) };
    }
  });
  writeFileSync(INDEX, JSON.stringify(index, null, 1));
  return index;
}

export function summary(idx: Index) {
  const a = Object.values(idx.assets);
  return {
    game: idx.game, built: idx.built, assets: a.length,
    effects: a.reduce((n, x) => n + (x.effects?.length ?? 0), 0),
    errors: Object.fromEntries(Object.entries(idx.assets).filter(([, x]) => x.error).map(([k, x]) => [k, x.error])),
    index: INDEX,
  };
}

function loadIndex(): Index {
  if (!existsSync(INDEX)) throw new PtfxError("no vanilla index yet - run ptfx_vanilla_index first");
  return JSON.parse(readFileSync(INDEX, "utf8"));
}

/** Effects whose effect / asset / texture names contain every word of the query. */
export function search(query: string, limit = 50) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: Record<string, unknown>[] = [];
  for (const [asset, a] of Object.entries(loadIndex().assets)) {
    for (const e of a.effects ?? []) {
      const hay = [asset, e.name, ...e.textures].join(" ").toLowerCase();
      if (words.every((w) => hay.includes(w))) hits.push({ asset, effect: e.name, loops: e.loops, emitters: e.emitters, textures: e.textures, ypt: a.ypt });
    }
  }
  const inName = (h: Record<string, unknown>) => words.some((w) => String(h.effect).toLowerCase().includes(w));
  hits.sort((x, y) => Number(inName(y)) - Number(inName(x)) || String(x.asset).localeCompare(String(y.asset)) || String(x.effect).localeCompare(String(y.effect)));
  return { query, count: hits.length, hits: hits.slice(0, limit) };
}

export function get(asset: string) {
  const a = loadIndex().assets[asset.toLowerCase().replace(/\.ypt$/, "")];
  if (!a) throw new PtfxError(`vanilla asset "${asset}" is not in the index`);
  return { ypt: a.ypt, xml: a.xml ?? null, archive: a.archive, inner: a.inner, effects: a.effects?.map((e) => e.name) };
}

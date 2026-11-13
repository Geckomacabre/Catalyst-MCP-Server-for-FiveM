// Catalyst MCP for FiveM
// Copyright (C) 2026 Catalyst MCP for FiveM contributors
// SPDX-License-Identifier: GPL-3.0-only
//
// GTA V particle dictionaries (.ypt), headless: CodeWalker XML in, CodeWalker XML out.
//
// An unpacked dictionary (CodeWalker's layout):
//     <dir>/<name>.ypt.xml      the XML
//     <dir>/<name>/*.dds        its embedded textures, flat
// What `pack` builds is a LEGACY (gen8, resource v68) .ypt - what FiveM streams.

import {
  copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync,
  statSync, writeFileSync, closeSync, cpSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CACHE, PtfxError, helper } from "./helper.js";
import { XEl, child, clone, el, parseXml, serializeXml, textOf, walk } from "./xml.js";

export type Kind = "effect" | "emitter" | "particle" | "texture" | "drawable";
export const KINDS: Record<Kind, string> = {
  effect: "EffectRuleDictionary",
  emitter: "EmitterRuleDictionary",
  particle: "ParticleRuleDictionary",
  texture: "TextureDictionary",
  drawable: "DrawableDictionary",
};
type Key = [number, number, number, number, number];

// ------------------------------------------------------------------------------------ files

export function stem(p: string): string {
  const b = basename(p);
  for (const ext of [".ypt.xml", ".ypt", ".xml"]) if (b.toLowerCase().endsWith(ext)) return b.slice(0, -ext.length);
  return b.replace(/\.[^.]+$/, "");
}

export const texDir = (xml: string) => join(dirname(resolve(xml)), stem(xml));

export function load(xml: string): XEl {
  return parseXml(readFileSync(xml, "utf8"));
}

export function save(root: XEl, xml: string): string {
  mkdirSync(dirname(resolve(xml)), { recursive: true });
  writeFileSync(xml, serializeXml(root), "utf8");
  return resolve(xml);
}

function listDds(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...listDds(p));
    else if (f.toLowerCase().endsWith(".dds")) out.push(p);
  }
  return out;
}

export function unpack(ypt: string, outDir?: string) {
  ypt = resolve(ypt);
  const s = stem(ypt);
  const dir = resolve(outDir ?? join(CACHE, "work", s));
  mkdirSync(dir, { recursive: true });
  const xml = join(dir, s + ".ypt.xml");
  const tdir = join(dir, s);
  const tmp = join(dir, "_tex_tmp");
  rmSync(tmp, { recursive: true, force: true });
  helper("toxml", { in: ypt, out: xml, asset_dir: tmp });
  return { xml, textures_dir: tdir, textures: flattenTextures(tmp, tdir) };
}

function flattenTextures(tmp: string, tdir: string): string[] {
  mkdirSync(tdir, { recursive: true });
  const moved = listDds(tmp).map((f) => {
    renameSync(f, join(tdir, basename(f)));
    return basename(f);
  });
  rmSync(tmp, { recursive: true, force: true });
  return moved.sort();
}

/** Many .ypt -> XML in one helper process (for indexing). */
export function unpackMany(items: { ypt: string; outDir: string }[]) {
  const reqs = items.map((it) => {
    const s = stem(it.ypt);
    return { in: resolve(it.ypt), out: join(it.outDir, s + ".ypt.xml"), asset_dir: join(it.outDir, "_tex_tmp"), s, dir: it.outDir };
  });
  const r = helper<{ results: { input: string; error?: string }[] }>("toxml_batch", {
    items: reqs.map(({ in: i, out, asset_dir }) => ({ in: i, out, asset_dir })),
  });
  return reqs.map((q, k) => {
    const err = r.results[k]?.error;
    if (!err) flattenTextures(q.asset_dir, join(q.dir, q.s));
    return { ypt: q.in, xml: q.out, error: err };
  });
}

// ------------------------------------------------------------------------------------ compare

type Row = [number, string, string, string];

function rows(e: XEl): Row[] {
  const out: Row[] = [];
  const go = (x: XEl, d: number) => {
    out.push([d, x.tag, JSON.stringify(Object.entries(x.attrs).sort()), x.text.trim()]);
    x.kids.forEach((k) => go(k, d + 1));
  };
  go(e, 0);
  return out;
}

/** Rule-by-rule comparison (the binary stores dictionary entries sorted by name hash, so order is not
 * meaningful), whitespace-insensitive. */
export function compare(a: XEl, b: XEl) {
  const canon = (r: XEl) => {
    const m = new Map<string, Map<string, Row[]>>();
    m.set("Name", new Map([["", [[0, "Name", "", textOf(r, "Name")]]]]));
    for (const sec of r.kids) {
      if (sec.tag === "Name") continue;
      m.set(sec.tag, new Map(sec.kids.map((it, n) => [textOf(it, "Name") || String(n), rows(it)])));
    }
    return m;
  };
  const ca = canon(a);
  const cb = canon(b);
  const diffs: Record<string, unknown>[] = [];
  for (const sec of new Set([...ca.keys(), ...cb.keys()])) {
    const sa = ca.get(sec) ?? new Map();
    const sb = cb.get(sec) ?? new Map();
    for (const n of new Set([...sa.keys(), ...sb.keys()])) {
      const ra = sa.get(n);
      const rb = sb.get(n);
      if (!ra || !rb) {
        diffs.push({ section: sec, rule: n, only_in: ra ? "wrote" : "read" });
        continue;
      }
      const i = ra.findIndex((x: Row, k: number) => JSON.stringify(x) !== JSON.stringify(rb[k]));
      if (i >= 0 || ra.length !== rb.length) diffs.push({ section: sec, rule: n, rows: [ra.length, rb.length], wrote: ra[i], read: rb[i] });
    }
  }
  return diffs;
}

export function pack(xml: string, out?: string, verify = true) {
  xml = resolve(xml);
  const target = resolve(out ?? join(dirname(xml), stem(xml) + ".ypt"));
  const tdir = texDir(xml);
  const root = load(xml);
  const want = items(root, "texture").map((t) => textOf(t, "FileName") || textOf(t, "Name") + ".dds");
  const missing = want.filter((f) => !existsSync(join(tdir, f)));
  if (missing.length) throw new PtfxError(`textures missing from ${tdir}: ${missing.join(", ")}`);
  mkdirSync(dirname(target), { recursive: true });
  helper("tobin", { in: xml, out: target, asset_dir: tdir });
  const res: Record<string, unknown> = { ypt: target, bytes: statSync(target).size, textures: want.length };
  if (verify) {
    const vdir = join(CACHE, "verify", stem(target));
    rmSync(vdir, { recursive: true, force: true });
    const back = unpack(target, vdir);
    const diffs = compare(root, load(back.xml));
    res.verify = { identical: diffs.length === 0, differences: diffs.length, first_diffs: diffs.slice(0, 5) };
  }
  return res;
}

// ------------------------------------------------------------------------------------ model access

export const items = (root: XEl, kind: Kind): XEl[] => child(root, KINDS[kind])?.kids ?? [];
export const find = (root: XEl, kind: Kind, name: string) => items(root, kind).find((i) => textOf(i, "Name") === name);

export function need(root: XEl, kind: Kind, name: string): XEl {
  const e = find(root, kind, name);
  if (!e) {
    const have = items(root, kind).map((i) => textOf(i, "Name")).join(", ");
    throw new PtfxError(`no ${kind} rule named "${name}" (have: ${have})`);
  }
  return e;
}

export function val(e: XEl | undefined, tag: string): unknown {
  const c = child(e, tag);
  if (!c) return undefined;
  if ("value" in c.attrs) {
    const v = c.attrs.value;
    if (/^0x[0-9a-f]+$/i.test(v)) return parseInt(v, 16);
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  if ("x" in c.attrs) return ["x", "y", "z", "w"].filter((k) => k in c.attrs).map((k) => Number(c.attrs[k]));
  return c.text.trim();
}

const loops = (e: XEl) => {
  const n = val(e, "NumLoops");
  return n === 0xffffffff || n === -1 ? "infinite" : n;
};

/** Every keyframed property under an element: name -> its element. */
export function kfpAll(e: XEl): Map<string, XEl> {
  const m = new Map<string, XEl>();
  for (const c of walk(e)) {
    const n = textOf(c, "Name");
    if (n.includes(":") && child(c, "Keyframes")) m.set(n, c);
  }
  return m;
}

export function keysOf(kfp: XEl): Key[] {
  return (child(kfp, "Keyframes")?.kids ?? []).map((it) => {
    const t = child(it, "KeyframeTime")!.attrs;
    const v = child(it, "KeyframeValue")!.attrs;
    return [Number(t.x), Number(v.x), Number(v.y), Number(v.z), Number(v.w)];
  });
}

/** Shortest text that reads back as the same float32 (how CodeWalker writes ypt floats). */
export function fmt(x: number): string {
  const f = Math.fround(x);
  for (let p = 1; p <= 9; p++) {
    const s = Number(f.toPrecision(p));
    if (Math.fround(s) === f) return String(s);
  }
  return String(f);
}

/** keys [[t, x, y, z, w], ...], t = 0..1 over the particle's life / the effect's duration.
 * KeyframeTime.y = 1 / (t - t_prev), 0 on the first key - what the game reads. */
export function setKeys(kfp: XEl, keys: number[][]) {
  const kf = child(kfp, "Keyframes");
  if (!kf) throw new PtfxError("not a keyframed property");
  const sorted = keys.map((k) => [...k, 0, 0, 0, 0].slice(0, 5)).sort((a, b) => a[0] - b[0]);
  let prev: number | null = null;
  kf.kids = sorted.map((k) => {
    const inv = prev === null || k[0] === prev ? 0 : 1 / (k[0] - prev);
    prev = k[0];
    return el("Item", {}, "", [
      el("KeyframeTime", { x: fmt(k[0]), y: fmt(inv), z: "0", w: "0" }),
      el("KeyframeValue", { x: fmt(k[1]), y: fmt(k[2]), z: fmt(k[3]), w: fmt(k[4]) }),
    ]);
  });
}

export function behaviour(prule: XEl, type: string) {
  return child(prule, "AllBehaviours")?.kids.find((b) => child(b, "Type")?.attrs.value?.toLowerCase() === type.toLowerCase());
}

export function texturesOf(prule: XEl) {
  return (child(prule, "ShaderVars")?.kids ?? [])
    .filter((sv) => child(sv, "Type")?.attrs.value === "Texture" && textOf(sv, "TextureName"))
    .map((sv) => ({ var: textOf(sv, "Name"), texture: textOf(sv, "TextureName"), external: child(sv, "ExternalReference")?.attrs.value === "1" }));
}

export const emittersOf = (effect: XEl): [string, string][] =>
  (child(effect, "EventEmitters")?.kids ?? []).map((ee) => [textOf(ee, "EmitterRule"), textOf(ee, "ParticleRule")]);

export function chainedEffects(prule: XEl): string[] {
  return ["EffectSpawnerAtRatio", "EffectSpawnerOnCollision"].map((t) => textOf(child(prule, t), "EffectRule")).filter(Boolean);
}

export function drawablesOf(prule: XEl, names: Set<string>): string[] {
  const s = new Set<string>();
  for (const c of walk(prule)) if (names.has(c.text.trim())) s.add(c.text.trim());
  return [...s].sort();
}

// ------------------------------------------------------------------------------------ info

const short = (kfp: XEl) => keysOf(kfp).map((k) => k.map((x) => Math.round(x * 1e4) / 1e4));

export function info(path: string, detail = false) {
  if (path.toLowerCase().endsWith(".ypt")) path = unpack(path).xml;
  const root = load(path);
  const dnames = new Set(items(root, "drawable").map((d) => textOf(d, "Name")));
  const effects = items(root, "effect").map((e) => ({
    name: textOf(e, "Name"),
    duration: [val(e, "DurationMin"), val(e, "DurationMax")],
    loops: loops(e),
    playback_rate: [val(e, "PlaybackRateScalarMin"), val(e, "PlaybackRateScalarMax")],
    cull_dist: val(e, "DistanceCullingCullDist"),
    emitters: (child(e, "EventEmitters")?.kids ?? []).map((ee) => ({
      emitter: textOf(ee, "EmitterRule"), particle: textOf(ee, "ParticleRule"),
      start: val(ee, "StartRatio"), end: val(ee, "EndRatio"),
    })),
  }));
  const emitters = items(root, "emitter").map((m) => {
    const k = kfpAll(m);
    const d: Record<string, unknown> = {
      name: textOf(m, "Name"), one_shot: val(m, "IsOneShot"),
      creation_domain: val(child(m, "CreationDomainObj"), "DomainType"),
      target_domain: val(child(m, "TargetDomainObj"), "DomainType"),
    };
    for (const [n, label] of [["ptxEmitterRule:m_spawnRateOverTimeKFP", "spawn_rate"], ["ptxEmitterRule:m_particleLifeKFP", "life"], ["ptxEmitterRule:m_speedScalarKFP", "speed"]]) {
      if (k.has(n)) d[label] = short(k.get(n)!);
    }
    if (detail) d.keyframed = Object.fromEntries([...k].filter(([, x]) => keysOf(x).length).map(([n, x]) => [n, short(x)]));
    return d;
  });
  const particles = items(root, "particle").map((p) => {
    const d: Record<string, unknown> = {
      name: textOf(p, "Name"), shader: textOf(p, "ShaderFile"), technique: textOf(p, "ShaderTechnique"),
      draw: ({ 0: "sprite", 1: "model", 2: "trail" } as Record<number, string>)[val(p, "DrawType") as number] ?? val(p, "DrawType"),
      behaviours: (child(p, "AllBehaviours")?.kids ?? []).map((b) => child(b, "Type")?.attrs.value),
      textures: texturesOf(p), chains: chainedEffects(p),
    };
    const dr = drawablesOf(p, dnames);
    if (dr.length) d.drawables = dr;
    const col = behaviour(p, "Colour");
    if (col) d.colour = Object.fromEntries([...kfpAll(col)].filter(([, x]) => keysOf(x).length).map(([n, x]) => [n.split(":m_")[1], short(x)]));
    if (detail) d.keyframed = Object.fromEntries([...kfpAll(p)].filter(([, x]) => keysOf(x).length).map(([n, x]) => [n, short(x)]));
    return d;
  });
  return {
    xml: resolve(path), name: textOf(root, "Name"), effects, emitters, particles,
    textures: items(root, "texture").map((t) => ({ name: textOf(t, "Name"), size: [val(t, "Width"), val(t, "Height")], format: textOf(t, "Format") })),
    drawables: [...dnames].sort(),
  };
}

// ------------------------------------------------------------------------------------ merge

function emptyDict(name: string): XEl {
  return el("ParticleEffectsList", {}, "", [
    el("Name", {}, name),
    ...(["effect", "emitter", "particle", "drawable", "texture"] as Kind[]).map((k) => el(KINDS[k])),
  ]);
}

function renameRefs(root: XEl, kind: Kind, from: string, to: string) {
  if (kind === "effect") {
    for (const p of items(root, "particle")) {
      for (const t of ["EffectSpawnerAtRatio", "EffectSpawnerOnCollision"]) {
        const er = child(child(p, t), "EffectRule");
        if (er && er.text.trim() === from) er.text = to;
      }
    }
    return;
  }
  const tag = kind === "emitter" ? "EmitterRule" : "ParticleRule";
  for (const e of items(root, "effect")) {
    for (const ee of child(e, "EventEmitters")?.kids ?? []) {
      const r = child(ee, tag);
      if (r && r.text.trim() === from) r.text = to;
    }
  }
}

/** RefCount = 1 (the dictionary) + every reference from effects' event emitters / chains - the
 * convention in Rockstar's own files. */
export function fixRefcounts(root: XEl) {
  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const em = new Map<string, number>();
  const pr = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const e of items(root, "effect")) for (const [a, b] of emittersOf(e)) { count(em, a); count(pr, b); }
  for (const p of items(root, "particle")) for (const c of chainedEffects(p)) count(ef, c);
  for (const [kind, refs] of [["emitter", em], ["particle", pr], ["effect", ef]] as [Kind, Map<string, number>][]) {
    for (const i of items(root, kind)) {
      const rc = child(i, "RefCount");
      if (rc) rc.attrs.value = String(1 + (refs.get(textOf(i, "Name")) ?? 0));
    }
  }
}

function sourceXml(file: string): string {
  return file.toLowerCase().endsWith(".ypt") ? unpack(file).xml : resolve(file);
}

function deps(root: XEl, effects: string[], kind: Kind): string[] {
  if (kind === "effect") return [...effects];
  const out: string[] = [];
  for (const n of effects) {
    const e = find(root, "effect", n);
    if (e) for (const [a, b] of emittersOf(e)) out.push(kind === "emitter" ? a : b);
  }
  return [...new Set(out)];
}

const same = (a: XEl, b: XEl) => serializeXml(a) === serializeXml(b);

export interface MergeSource { file: string; effects?: string[] | "*"; rename?: Record<string, string> }

/** A new dictionary from effects of other dictionaries, with all they need: emitter + particle rules,
 * chained effects, embedded textures, model drawables. Clashing rule names get a numeric suffix. */
export function merge(sources: MergeSource[], name: string, outXml?: string) {
  const target = resolve(outXml ?? join(CACHE, "build", name, name + ".ypt.xml"));
  const dst = emptyDict(name);
  const dtex = texDir(target);
  mkdirSync(dtex, { recursive: true });
  const report = { effects: [] as string[], emitters: [] as string[], particles: [] as string[], textures: [] as string[], drawables: [] as string[], renamed: [] as unknown[] };

  for (const src of sources) {
    const sx = sourceXml(src.file);
    const work = load(sx);
    const stex = texDir(sx);
    const want = !src.effects || src.effects === "*" ? items(work, "effect").map((e) => textOf(e, "Name")) : src.effects;
    let seen: string[] = [];
    const todo = [...want];
    while (todo.length) {
      const n = todo.shift()!;
      if (seen.includes(n)) continue;
      seen.push(n);
      for (const [, p] of emittersOf(need(work, "effect", n))) {
        const pe = find(work, "particle", p);
        if (pe) todo.push(...chainedEffects(pe).filter((c) => !seen.includes(c)));
      }
    }
    const rename = src.rename ?? {};
    for (const kind of ["effect", "emitter", "particle"] as Kind[]) {
      for (const n of deps(work, seen, kind)) {
        let nn = kind === "effect" ? rename[n] ?? n : n;
        const ex = find(dst, kind, nn);
        if (ex) {
          const mine = clone(need(work, kind, n));
          child(mine, "Name")!.text = nn;
          if (same(ex, mine)) continue;
          let k = 2;
          while (find(dst, kind, `${nn}_${k}`)) k++;
          nn = `${nn}_${k}`;
        }
        if (nn !== n) {
          renameRefs(work, kind, n, nn);
          child(need(work, kind, n), "Name")!.text = nn;
          report.renamed.push({ kind, from: n, to: nn, source: src.file });
          if (kind === "effect") seen = seen.map((s) => (s === n ? nn : s));
        }
      }
    }
    for (const kind of ["effect", "emitter", "particle"] as Kind[]) {
      for (const n of deps(work, seen, kind)) {
        if (!find(dst, kind, n)) {
          child(dst, KINDS[kind])!.kids.push(clone(need(work, kind, n)));
          (report as Record<string, unknown[]>)[kind + "s"].push(n);
        }
      }
    }
    const dnames = new Set(items(work, "drawable").map((d) => textOf(d, "Name")));
    for (const pn of deps(work, seen, "particle")) {
      const p = need(work, "particle", pn);
      for (const t of texturesOf(p)) {
        if (t.external || find(dst, "texture", t.texture)) continue;
        const ti = find(work, "texture", t.texture);
        if (!ti) continue; // resolved from core at run time
        child(dst, KINDS.texture)!.kids.push(clone(ti));
        const fn = textOf(ti, "FileName") || t.texture + ".dds";
        copyFileSync(join(stex, fn), join(dtex, fn));
        report.textures.push(t.texture);
      }
      for (const d of drawablesOf(p, dnames)) {
        if (find(dst, "drawable", d)) continue;
        const di = need(work, "drawable", d);
        child(dst, KINDS.drawable)!.kids.push(clone(di));
        for (const c of walk(di)) {
          const f = c.text.trim();
          if (f.toLowerCase().endsWith(".dds") && existsSync(join(stex, f))) copyFileSync(join(stex, f), join(dtex, f));
        }
        report.drawables.push(d);
      }
    }
  }
  fixRefcounts(dst);
  save(dst, target);
  return { ...report, xml: target, textures_dir: dtex };
}

// ------------------------------------------------------------------------------------ edit

function resolvePath(rule: XEl, path: string): XEl {
  let e = rule;
  for (const seg of path.split("/")) {
    let nxt = child(e, seg);
    if (!nxt && /^\d+$/.test(seg)) nxt = e.kids[Number(seg)];
    if (!nxt && e.tag === "AllBehaviours") nxt = behaviour(rule, seg);
    if (!nxt) throw new PtfxError(`no "${seg}" under <${e.tag}> (children: ${e.kids.map((k) => k.tag).join(", ")})`);
    e = nxt;
  }
  return e;
}

function setValue(e: XEl, value: unknown) {
  if (Array.isArray(value)) {
    ["x", "y", "z", "w"].forEach((k, i) => { if (i < value.length) e.attrs[k] = fmt(Number(value[i])); });
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) e.attrs[k] = typeof v === "number" ? fmt(v) : String(v);
  } else if ("value" in e.attrs) {
    e.attrs.value = typeof value === "boolean" ? (value ? "1" : "0") : typeof value === "number" ? fmt(value) : String(value);
  } else {
    e.text = String(value);
  }
}

/** [r, g, b, a] in 0..1 or 0..255 -> "0xAARRGGBB" (the colour-tint format of effect events). */
export function rgbaHex(rgba: number[]): string {
  const given = rgba.map(Number).slice(0, 4);
  const scale = Math.max(...given) > 1 ? 255 : 1; // decided by the values given, before alpha is padded
  const v = given.map((x) => x / scale);
  while (v.length < 4) v.push(1);
  const [r, g, b, a] = v.map((x) => Math.max(0, Math.min(255, Math.round(x * 255))));
  return "0x" + [a, r, g, b].map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join("");
}

export interface EditOp {
  op: string; kind?: Kind; name?: string; path?: string; value?: unknown; prop?: string; keys?: number[][];
  factor?: number | number[]; to?: string; deep?: boolean; min?: number[]; max?: number[]; texture?: string;
  var?: string; external?: boolean; dds?: string;
}

export function edit(xml: string, ops: EditOp[], out?: string) {
  const root = load(xml);
  const log: string[] = [];
  const dst = resolve(out ?? xml);
  if (out && dst !== resolve(xml) && existsSync(texDir(xml))) cpSync(texDir(xml), texDir(dst), { recursive: true });
  for (const op of ops) {
    const kind = op.kind ?? "particle";
    switch (op.op) {
      case "set": {
        setValue(resolvePath(need(root, kind, op.name!), op.path!), op.value);
        log.push(`set ${op.name} ${op.path} = ${JSON.stringify(op.value)}`);
        break;
      }
      case "keys":
      case "scale": {
        const ks = kfpAll(need(root, kind, op.name!));
        const kfp = ks.get(op.prop!);
        if (!kfp) throw new PtfxError(`${op.name} has no ${op.prop} (has: ${[...ks.keys()].sort().join(", ")})`);
        if (op.op === "keys") setKeys(kfp, op.keys!);
        else {
          const f = Array.isArray(op.factor) ? [...op.factor, 1, 1, 1, 1].slice(0, 4) : [op.factor!, op.factor!, op.factor!, op.factor!];
          const cur = keysOf(kfp);
          if (!cur.length) throw new PtfxError(`${op.name} ${op.prop} has no keyframes to scale`);
          setKeys(kfp, cur.map((k) => [k[0], k[1] * f[0], k[2] * f[1], k[3] * f[2], k[4] * f[3]]));
        }
        log.push(`${op.op} ${op.name} ${op.prop} -> ${JSON.stringify(short(kfp))}`);
        break;
      }
      case "rename": {
        const r = need(root, kind, op.name!);
        renameRefs(root, kind, op.name!, op.to!);
        child(r, "Name")!.text = op.to!;
        log.push(`renamed ${kind} ${op.name} -> ${op.to}`);
        break;
      }
      case "duplicate": {
        const c = clone(need(root, kind, op.name!));
        child(c, "Name")!.text = op.to!;
        child(root, KINDS[kind])!.kids.push(c);
        if (kind === "effect" && op.deep !== false) {
          const ees = child(c, "EventEmitters")?.kids ?? [];
          ees.forEach((ee, i) => {
            for (const [tag, k2] of [["EmitterRule", "emitter"], ["ParticleRule", "particle"]] as [string, Kind][]) {
              const srcRule = need(root, k2, textOf(ee, tag));
              const nn = ees.length > 1 ? `${op.to}_${i + 1}` : op.to!;
              if (!find(root, k2, nn)) {
                const cc = clone(srcRule);
                child(cc, "Name")!.text = nn;
                child(root, KINDS[k2])!.kids.push(cc);
              }
              child(ee, tag)!.text = nn;
            }
          });
        }
        log.push(`duplicated ${kind} ${op.name} -> ${op.to}`);
        break;
      }
      case "delete": {
        const d = child(root, KINDS[kind])!;
        d.kids = d.kids.filter((k) => k !== need(root, kind, op.name!));
        log.push(`deleted ${kind} ${op.name}`);
        break;
      }
      case "tint": {
        for (const ee of child(need(root, "effect", op.name!), "EventEmitters")?.kids ?? []) {
          if (op.min) child(ee, "ColourTintMin")!.attrs.value = rgbaHex(op.min);
          if (op.max || op.min) child(ee, "ColourTintMax")!.attrs.value = rgbaHex(op.max ?? op.min!);
        }
        log.push(`tint ${op.name}` + (op.min ? ` min ${JSON.stringify(op.min)}` : "") + (op.max ? ` max ${JSON.stringify(op.max)}` : ""));
        break;
      }
      case "texture": {
        const p = need(root, "particle", op.name!);
        const varName = op.var ?? "diffusetex2";
        const sv = child(p, "ShaderVars")?.kids.find((s) => textOf(s, "Name") === varName);
        if (!sv) throw new PtfxError(`${op.name} has no texture var ${varName}`);
        child(sv, "ExternalReference")!.attrs.value = op.external ? "1" : "0";
        child(sv, "TextureName")!.text = op.texture!;
        if (op.dds) addTexture(root, dst, op.dds, op.texture);
        log.push(`texture ${op.name} ${varName} = ${op.texture}${op.external ? " (core)" : ""}`);
        break;
      }
      case "dict_name": {
        child(root, "Name")!.text = op.to!;
        log.push(`dictionary name -> ${op.to}`);
        break;
      }
      default:
        throw new PtfxError(`unknown op "${op.op}"`);
    }
  }
  fixRefcounts(root);
  save(root, dst);
  return { xml: dst, applied: log };
}

// ------------------------------------------------------------------------------------ textures

const FOURCC: Record<string, string> = {
  DXT1: "D3DFMT_DXT1", DXT3: "D3DFMT_DXT3", DXT5: "D3DFMT_DXT5", ATI1: "D3DFMT_ATI1", ATI2: "D3DFMT_ATI2",
  BC4U: "D3DFMT_ATI1", BC5U: "D3DFMT_ATI2",
};
const DXGI: Record<number, string> = {
  71: "D3DFMT_DXT1", 74: "D3DFMT_DXT3", 77: "D3DFMT_DXT5", 87: "D3DFMT_A8R8G8B8", 28: "D3DFMT_A8B8G8R8", 80: "D3DFMT_ATI1", 83: "D3DFMT_ATI2",
};

export function ddsHeader(path: string) {
  const fd = openSync(path, "r");
  const b = Buffer.alloc(148);
  readSync(fd, b, 0, 148, 0);
  closeSync(fd);
  if (b.toString("latin1", 0, 4) !== "DDS ") throw new PtfxError(`${path} is not a DDS file`);
  const height = b.readUInt32LE(12);
  const width = b.readUInt32LE(16);
  const mips = Math.max(1, b.readUInt32LE(28));
  const fourcc = b.toString("latin1", 84, 88);
  let format = FOURCC[fourcc];
  if (fourcc === "DX10") {
    format = DXGI[b.readUInt32LE(128)];
    if (!format) throw new PtfxError(`DXGI format ${b.readUInt32LE(128)} is not usable in a Legacy ypt (use DXT1/DXT5/A8R8G8B8)`);
  } else if (!format) {
    if (b.readUInt32LE(88) === 32) format = "D3DFMT_A8R8G8B8";
    else throw new PtfxError(`unsupported DDS pixel format in ${path}`);
  }
  return { width, height, mips, format };
}

export function addTexture(root: XEl, xml: string, dds: string, name?: string) {
  const n = name ?? basename(dds).replace(/\.dds$/i, "");
  const h = ddsHeader(dds);
  const d = child(root, KINDS.texture)!;
  d.kids = d.kids.filter((t) => textOf(t, "Name") !== n);
  d.kids.push(el("Item", {}, "", [
    el("Name", {}, n), el("Unk32", { value: "128" }), el("Usage", {}, "DIFFUSE"),
    el("UsageFlags", {}, "X8, X32, X64, X128, UNK24"), el("ExtraFlags", { value: "0" }),
    el("Width", { value: String(h.width) }), el("Height", { value: String(h.height) }),
    el("MipLevels", { value: String(h.mips) }), el("Format", {}, h.format), el("FileName", {}, n + ".dds"),
  ]));
  const tdir = texDir(xml);
  mkdirSync(tdir, { recursive: true });
  copyFileSync(dds, join(tdir, n + ".dds"));
  return h;
}

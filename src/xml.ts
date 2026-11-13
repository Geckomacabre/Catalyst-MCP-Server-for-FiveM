// Catalyst MCP for FiveM
// Copyright (C) 2026 Catalyst MCP for FiveM contributors
// SPDX-License-Identifier: GPL-3.0-only
//
// A small XML DOM for CodeWalker's .ypt XML: elements, attributes (order kept), text. No namespaces,
// no mixed content - which is all CodeWalker writes. Keeps the project free of an XML dependency.

export interface XEl {
  tag: string;
  attrs: Record<string, string>;
  kids: XEl[];
  text: string;
}

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");

export function parseXml(src: string): XEl {
  let i = 0;
  const n = src.length;
  const stack: XEl[] = [];
  let root: XEl | null = null;
  let text = "";

  const fail = (msg: string): never => {
    const line = src.slice(0, i).split("\n").length;
    throw new Error(`XML: ${msg} (line ${line})`);
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      text += src.slice(i);
      break;
    }
    text += src.slice(i, lt);
    i = lt;
    if (src.startsWith("<?", i)) {
      i = src.indexOf("?>", i) + 2;
      if (i < 2) fail("unterminated <?");
      continue;
    }
    if (src.startsWith("<!--", i)) {
      i = src.indexOf("-->", i) + 3;
      if (i < 3) fail("unterminated comment");
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i);
      if (end < 0) fail("unterminated CDATA");
      text += src.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<!", i)) {
      i = src.indexOf(">", i) + 1;
      continue;
    }
    if (src[i + 1] === "/") {
      const end = src.indexOf(">", i);
      const tag = src.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.tag !== tag) fail(`</${tag}> does not close <${top?.tag}>`);
      if (top!.kids.length === 0) top!.text = decode(text);
      text = "";
      i = end + 1;
      if (stack.length === 0) root = top!;
      continue;
    }
    // start tag
    const m = /^<([A-Za-z_][\w.:-]*)/.exec(src.slice(i, i + 256));
    if (!m) fail("bad tag");
    const el: XEl = { tag: m![1], attrs: {}, kids: [], text: "" };
    i += m![0].length;
    const attrRe = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;
    for (;;) {
      attrRe.lastIndex = i;
      const a = attrRe.exec(src);
      if (!a) break;
      el.attrs[a[1]] = decode(a[3] ?? a[4] ?? "");
      i = attrRe.lastIndex;
    }
    while (i < n && /\s/.test(src[i])) i++;
    const selfClose = src.startsWith("/>", i);
    if (!selfClose && src[i] !== ">") fail(`bad start tag <${el.tag}>`);
    i += selfClose ? 2 : 1;
    if (stack.length) stack[stack.length - 1].kids.push(el);
    text = "";
    if (selfClose) {
      if (stack.length === 0) root = el;
    } else {
      stack.push(el);
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1].tag}> is not closed`);
  if (!root) fail("no root element");
  return root!;
}

export function serializeXml(root: XEl, indent = " "): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const walk = (e: XEl, d: number) => {
    const pad = indent.repeat(d);
    const at = Object.entries(e.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
    if (e.kids.length === 0) {
      out.push(e.text === "" ? `${pad}<${e.tag}${at} />` : `${pad}<${e.tag}${at}>${escText(e.text)}</${e.tag}>`);
      return;
    }
    out.push(`${pad}<${e.tag}${at}>`);
    for (const k of e.kids) walk(k, d + 1);
    out.push(`${pad}</${e.tag}>`);
  };
  walk(root, 0);
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------------------------- helpers

export const el = (tag: string, attrs: Record<string, string> = {}, text = "", kids: XEl[] = []): XEl => ({
  tag, attrs, kids, text,
});

export const child = (e: XEl | undefined, tag: string): XEl | undefined => e?.kids.find((k) => k.tag === tag);

export const textOf = (e: XEl | undefined, tag: string): string => (child(e, tag)?.text ?? "").trim();

export function clone(e: XEl): XEl {
  return { tag: e.tag, attrs: { ...e.attrs }, text: e.text, kids: e.kids.map(clone) };
}

export function* walk(e: XEl): Generator<XEl> {
  yield e;
  for (const k of e.kids) yield* walk(k);
}

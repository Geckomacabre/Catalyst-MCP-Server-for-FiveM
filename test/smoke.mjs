// Smoke test: needs the built helper and one vanilla .ypt from YOUR game (never committed).
//   PTFX_TEST_YPT=C:\path\to\scr_xs_celebration.ypt npm test
// Without PTFX_TEST_YPT it uses scr_xs_celebration from the vanilla index, if you built one.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as P from "../dist/ptfx.js";
import * as V from "../dist/vanilla.js";
import { parseXml, serializeXml } from "../dist/xml.js";

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failed++;
};

let ypt = process.env.PTFX_TEST_YPT;
if (!ypt) {
  try { ypt = V.get("scr_xs_celebration").ypt; } catch { /* no index */ }
}
if (!ypt || !existsSync(ypt)) {
  console.log("skip: set PTFX_TEST_YPT to a vanilla .ypt (e.g. scr_xs_celebration.ypt) or build the vanilla index");
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "ptfx-test-"));
try {
  // 1. unpack, and our XML writer reproduces CodeWalker's text exactly
  const u = P.unpack(ypt, join(tmp, "a"));
  const text = readFileSync(u.xml, "utf8");
  const again = serializeXml(parseXml(text));
  ok(again.replace(/\r\n/g, "\n") === text.replace(/\r\n/g, "\n"), "XML parse + serialize is identical to CodeWalker's output");

  // 2. rebuild the vanilla file and read it back
  const r = P.pack(u.xml, join(tmp, "a", "rebuilt.ypt"));
  ok(r.verify.identical, `vanilla rebuild reads back identical (${r.verify.differences} differences)`);

  // 3. merge two effects under new names, recolour one, pack, verify
  const inf = P.info(u.xml);
  const names = inf.effects.slice(0, 2).map((e) => e.name);
  const m = P.merge([{ file: u.xml, effects: names, rename: { [names[0]]: "test_fx_a" } }], "test_fx", join(tmp, "b", "test_fx.ypt.xml"));
  ok(m.effects.includes("test_fx_a"), `merge renamed ${names[0]} -> test_fx_a`);
  const p0 = P.info(m.xml).effects.find((e) => e.name === "test_fx_a").emitters[0].particle;
  P.edit(m.xml, [
    { op: "keys", kind: "particle", name: p0, prop: "ptxu_Colour:m_rgbaMinKFP", keys: [[0, 0.85, 0.08, 0.12, 1], [1, 0.85, 0.08, 0.12, 0]] },
    { op: "duplicate", kind: "effect", name: "test_fx_a", to: "test_fx_b" },
    { op: "set", kind: "effect", name: "test_fx_b", path: "DurationMax", value: 2.5 },
    { op: "tint", name: "test_fx_b", min: [255, 200, 50] },
  ]);
  const b = P.pack(m.xml, join(tmp, "b", "test_fx.ypt"));
  ok(b.verify.identical, `merged + edited dictionary reads back identical (${b.verify.differences} differences)`);
  const bi = P.info(m.xml);
  ok(bi.effects.some((e) => e.name === "test_fx_b" && e.duration[1] === 2.5), "edit: duplicate + set DurationMax");
  ok(P.rgbaHex([255, 200, 50]) === "0xFFFFC832", "rgbaHex pads alpha after scaling");

  // 4. the MCP server answers over stdio
  const srv = spawn(process.execPath, [join(import.meta.dirname, "..", "dist", "index.js")], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = [];
  srv.stdout.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
  const send = (m) => srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
  send({ method: "notifications/initialized" });
  send({ id: 2, method: "tools/list" });
  send({ id: 3, method: "tools/call", params: { name: "ptfx_info", arguments: { path: m.xml } } });
  await new Promise((res) => setTimeout(res, 4000));
  srv.kill();
  const msgs = lines.map((l) => JSON.parse(l));
  const tools = msgs.find((x) => x.id === 2)?.result?.tools ?? [];
  ok(tools.length === 10, `tools/list returns ${tools.length} tools`);
  const call = msgs.find((x) => x.id === 3)?.result;
  ok(call && !call.isError && JSON.parse(call.content[0].text).name === "test_fx", "tools/call ptfx_info works");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);

// Catalyst MCP for FiveM - ptfx-helper
// Copyright (C) 2026 Catalyst MCP for FiveM contributors
// SPDX-License-Identifier: GPL-3.0-only

using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;

namespace PtfxHelper
{
    /// <summary>
    /// One JSON request on stdin (or `--json "{...}"`), one JSON response on stdout.
    /// Request:  {"cmd": "toxml" | "tobin" | "toxml_batch" | "rpf_list" | "rpf_extract" | "version", ...}
    /// Response: {"ok": true, ...} | {"ok": false, "error": "..."}
    /// </summary>
    public static class Program
    {
        public static int Main(string[] argv)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            string raw = argv.Length >= 2 && argv[0] == "--json" ? argv[1] : Console.In.ReadToEnd();
            if (string.IsNullOrWhiteSpace(raw))
            {
                Write(Err("empty request; expected a JSON object on stdin"));
                return 1;
            }

            JsonElement req;
            try
            {
                req = JsonDocument.Parse(raw).RootElement;
            }
            catch (Exception ex)
            {
                Write(Err("request is not valid JSON: " + ex.Message));
                return 1;
            }

            Dictionary<string, object> res;
            try
            {
                switch (J.Str(req, "cmd"))
                {
                    case "toxml": res = Convert.ToXml(req); break;
                    case "tobin": res = Convert.ToBin(req); break;
                    case "toxml_batch": res = Convert.ToXmlBatch(req); break;
                    case "rpf_list": res = Archives.List(req); break;
                    case "rpf_extract": res = Archives.Extract(req); break;
                    case "version":
                        res = new Dictionary<string, object>
                        {
                            { "helper", typeof(Program).Assembly.GetName().Version.ToString() },
                            { "codewalker_core", typeof(CodeWalker.GameFiles.RpfFile).Assembly.GetName().Version.ToString() },
                        };
                        break;
                    default:
                        Write(Err("unknown cmd \"" + J.Str(req, "cmd") + "\""));
                        return 1;
                }
            }
            catch (Exception ex)
            {
                var e = Err(ex.Message);
                e["exception"] = ex.GetType().Name;
                if (ex.InnerException != null) e["inner"] = ex.InnerException.Message;
                Write(e);
                return 1;
            }

            res["ok"] = true;
            Write(res);
            return 0;
        }

        static Dictionary<string, object> Err(string msg)
        {
            return new Dictionary<string, object> { { "ok", false }, { "error", msg } };
        }

        static void Write(Dictionary<string, object> obj)
        {
            Console.Out.Write(JsonSerializer.Serialize(obj));
            Console.Out.Flush();
        }
    }

    /// <summary>JsonElement accessors that tolerate missing or wrongly typed fields.</summary>
    public static class J
    {
        public static string Str(JsonElement e, string name, string dflt = null)
        {
            if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var v)) return dflt;
            if (v.ValueKind == JsonValueKind.Null) return dflt;
            return v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
        }

        public static string Req(JsonElement e, string name)
        {
            var s = Str(e, name);
            if (string.IsNullOrWhiteSpace(s)) throw new ArgumentException("missing required field \"" + name + "\"");
            return s;
        }

        public static string Path(JsonElement e, string name)
        {
            return System.IO.Path.GetFullPath(Req(e, name));
        }

        public static List<JsonElement> Arr(JsonElement e, string name)
        {
            var list = new List<JsonElement>();
            if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array)
                foreach (var x in v.EnumerateArray()) list.Add(x);
            return list;
        }
    }
}

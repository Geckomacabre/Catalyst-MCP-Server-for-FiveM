// Catalyst MCP for FiveM - ptfx-helper
// Copyright (C) 2026 Catalyst MCP for FiveM contributors
// SPDX-License-Identifier: GPL-3.0-only

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using CodeWalker.GameFiles;

namespace PtfxHelper
{
    /// <summary>Read-only access to the game's .rpf archives (nested archives included). Encrypted
    /// archives need the keys, which CodeWalker finds in the game's own executable (`game` = the GTA V
    /// folder). Nothing is ever written inside the game folder.</summary>
    public static class Archives
    {
        static string keysFor;

        static void LoadKeys(string game)
        {
            if (string.IsNullOrWhiteSpace(game)) return;
            game = Path.GetFullPath(game);
            if (keysFor == game) return;
            bool gen9 = File.Exists(Path.Combine(game, "gta5_enhanced.exe"));
            if (!gen9 && !File.Exists(Path.Combine(game, "gta5.exe")))
                throw new FileNotFoundException("no gta5.exe in " + game + " - pass the GTA V folder as \"game\"");
            GTA5Keys.LoadFromPath(game, gen9, null);
            keysFor = game;
        }

        static RpfFile Open(string archive, string game)
        {
            LoadKeys(game);
            archive = Path.GetFullPath(archive);
            if (!File.Exists(archive)) throw new FileNotFoundException("archive not found: " + archive);
            var errors = new List<string>();
            var rpf = new RpfFile(archive, Path.GetFileName(archive));
            rpf.ScanStructure(null, s => errors.Add(s));
            if (rpf.AllEntries == null)
                throw new InvalidDataException("could not read " + archive +
                                               (errors.Count > 0 ? ": " + string.Join("; ", errors) : "") +
                                               (string.IsNullOrWhiteSpace(game) ? " (encrypted? pass \"game\")" : ""));
            return rpf;
        }

        static IEnumerable<RpfFile> Tree(RpfFile r)
        {
            yield return r;
            if (r.Children == null) yield break;
            foreach (var c in r.Children)
                foreach (var x in Tree(c))
                    yield return x;
        }

        /// <summary>Path inside the root archive, '/'-separated: data/effects/ptfx.rpf/core.ypt</summary>
        static string Inner(RpfFile root, RpfEntry e)
        {
            var p = (e.Path ?? e.Name).Replace('\\', '/');
            var rp = (root.Path ?? root.Name).Replace('\\', '/');
            if (p.StartsWith(rp + "/", StringComparison.OrdinalIgnoreCase)) p = p.Substring(rp.Length + 1);
            return p;
        }

        /// <summary>{"archive", "game", "ext": ".ypt"} -> every file entry (nested archives walked).</summary>
        public static Dictionary<string, object> List(JsonElement req)
        {
            var root = Open(J.Req(req, "archive"), J.Str(req, "game"));
            var ext = (J.Str(req, "ext") ?? "").ToLowerInvariant();
            var entries = new List<object>();
            foreach (var rpf in Tree(root))
            {
                foreach (var e in rpf.AllEntries.OfType<RpfFileEntry>())
                {
                    if (ext.Length > 0 && !e.NameLower.EndsWith(ext)) continue;
                    var res = e as RpfResourceFileEntry;
                    entries.Add(new Dictionary<string, object>
                    {
                        { "path", Inner(root, e) }, { "name", e.Name },
                        { "size", e.GetFileSize() }, { "version", res != null ? (object)res.Version : null },
                    });
                }
            }
            return new Dictionary<string, object> { { "archive", root.FilePath }, { "count", entries.Count }, { "entries", entries } };
        }

        /// <summary>{"archive", "game", "entries": ["data/effects/ptfx.rpf/core.ypt", ...], "out_dir"} -> files
        /// written as standalone game files (resources keep their RSC7 header) at out_dir/&lt;inner path&gt;.</summary>
        public static Dictionary<string, object> Extract(JsonElement req)
        {
            var root = Open(J.Req(req, "archive"), J.Str(req, "game"));
            var outDir = Path.GetFullPath(J.Req(req, "out_dir"));
            var want = new HashSet<string>(J.Arr(req, "entries").Select(x => x.GetString().Replace('\\', '/').ToLowerInvariant()));
            var written = new List<object>();
            var missing = new HashSet<string>(want);
            foreach (var rpf in Tree(root))
            {
                foreach (var e in rpf.AllEntries.OfType<RpfFileEntry>())
                {
                    var inner = Inner(root, e).ToLowerInvariant();
                    if (!want.Contains(inner)) continue;
                    var data = rpf.ExtractFile(e);
                    if (data == null) continue;
                    if (e is RpfResourceFileEntry res)
                    {
                        data = ResourceBuilder.Compress(data);
                        data = ResourceBuilder.AddResourceHeader(res, data);
                    }
                    var dest = Path.GetFullPath(Path.Combine(outDir, inner.Replace('/', Path.DirectorySeparatorChar)));
                    if (!dest.StartsWith(outDir, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("entry path escapes out_dir: " + inner);
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    File.WriteAllBytes(dest, data);
                    written.Add(new Dictionary<string, object> { { "entry", inner }, { "file", dest }, { "bytes", data.Length } });
                    missing.Remove(inner);
                }
            }
            return new Dictionary<string, object>
            {
                { "archive", root.FilePath }, { "count", written.Count }, { "extracted", written }, { "missing", missing.ToList() },
            };
        }
    }
}

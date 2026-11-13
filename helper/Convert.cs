// Catalyst MCP for FiveM - ptfx-helper
// Copyright (C) 2026 Catalyst MCP for FiveM contributors
// SPDX-License-Identifier: GPL-3.0-only

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Xml;
using CodeWalker.GameFiles;

namespace PtfxHelper
{
    /// <summary>Binary game file &lt;-&gt; CodeWalker XML, the way CodeWalker's RPF Explorer does
    /// "Export XML" / "Import XML", embedded textures in a folder beside the XML.</summary>
    public static class Convert
    {
        static RpfFileEntry CreateFileEntry(string name, string path, ref byte[] data)
        {
            RpfFileEntry e;
            uint rsc7 = data != null && data.Length > 4 ? BitConverter.ToUInt32(data, 0) : 0;
            if (rsc7 == 0x37435352) // "RSC7"
            {
                e = RpfFile.CreateResourceFileEntry(ref data, 0);
                data = ResourceBuilder.Decompress(data);
            }
            else
            {
                var be = new RpfBinaryFileEntry();
                be.FileSize = (uint)(data != null ? data.Length : 0);
                be.FileUncompressedSize = be.FileSize;
                e = be;
            }
            e.Name = name;
            e.NameLower = name.ToLowerInvariant();
            e.NameHash = JenkHash.GenHash(e.NameLower);
            e.ShortNameHash = JenkHash.GenHash(Path.GetFileNameWithoutExtension(e.NameLower));
            e.Path = path;
            return e;
        }

        static Dictionary<string, object> OneToXml(string inPath, string outPath, string assetDir)
        {
            if (!File.Exists(inPath)) throw new FileNotFoundException("input not found: " + inPath);
            var name = Path.GetFileName(inPath);
            var data = File.ReadAllBytes(inPath);
            var entry = CreateFileEntry(name, inPath, ref data);

            if (string.IsNullOrWhiteSpace(outPath)) outPath = inPath + ".xml";
            outPath = Path.GetFullPath(outPath);
            var outDir = Path.GetDirectoryName(outPath);
            if (!string.IsNullOrEmpty(outDir)) Directory.CreateDirectory(outDir);
            if (string.IsNullOrWhiteSpace(assetDir))
                assetDir = Path.Combine(outDir ?? ".", Path.GetFileNameWithoutExtension(name));
            assetDir = Path.GetFullPath(assetDir);

            var xml = MetaXml.GetXml(entry, data, out var suggested, assetDir);
            if (string.IsNullOrEmpty(xml))
                throw new InvalidOperationException("CodeWalker produced no XML for " + name + " (unsupported or corrupt)");
            File.WriteAllText(outPath, xml);
            return new Dictionary<string, object>
            {
                { "input", inPath }, { "output", outPath }, { "asset_dir", assetDir },
                { "bytes_in", new FileInfo(inPath).Length }, { "bytes_out", new FileInfo(outPath).Length },
            };
        }

        public static Dictionary<string, object> ToXml(JsonElement req)
        {
            return OneToXml(J.Path(req, "in"), J.Str(req, "out"), J.Str(req, "asset_dir"));
        }

        /// <summary>{"items": [{"in", "out", "asset_dir"}]} - one process for many files; keeps going on errors.</summary>
        public static Dictionary<string, object> ToXmlBatch(JsonElement req)
        {
            var results = new List<object>();
            int failed = 0;
            foreach (var it in J.Arr(req, "items"))
            {
                try
                {
                    results.Add(OneToXml(J.Path(it, "in"), J.Str(it, "out"), J.Str(it, "asset_dir")));
                }
                catch (Exception ex)
                {
                    failed++;
                    results.Add(new Dictionary<string, object> { { "input", J.Str(it, "in") }, { "error", ex.Message } });
                }
            }
            return new Dictionary<string, object> { { "count", results.Count }, { "failed", failed }, { "results", results } };
        }

        public static Dictionary<string, object> ToBin(JsonElement req)
        {
            var inPath = J.Path(req, "in");
            if (!File.Exists(inPath)) throw new FileNotFoundException("input not found: " + inPath);
            var name = Path.GetFileName(inPath);
            var namel = name.ToLowerInvariant();
            if (!namel.EndsWith(".xml") || namel.IndexOf('.') == namel.LastIndexOf('.'))
                throw new ArgumentException("input must be named like foo.ypt.xml (got " + name + ")");

            var format = XmlMeta.GetXMLFormat(namel, out var trim);
            var outPath = J.Str(req, "out");
            if (string.IsNullOrWhiteSpace(outPath))
                outPath = Path.Combine(Path.GetDirectoryName(inPath) ?? ".", name.Substring(0, name.Length - trim));
            outPath = Path.GetFullPath(outPath);
            Directory.CreateDirectory(Path.GetDirectoryName(outPath) ?? ".");

            var assetDir = J.Str(req, "asset_dir");
            if (string.IsNullOrWhiteSpace(assetDir))
            {
                var stem = inPath.Substring(0, inPath.Length - trim);
                assetDir = Path.Combine(Path.GetDirectoryName(stem) ?? ".", Path.GetFileNameWithoutExtension(stem));
            }
            assetDir = Path.GetFullPath(assetDir);

            var doc = new XmlDocument();
            doc.LoadXml(File.ReadAllText(inPath));
            var data = XmlMeta.GetData(doc, format, assetDir);
            if (data == null)
                throw new InvalidOperationException("CodeWalker produced no data from " + name +
                                                    " (format " + XmlMeta.GetXMLFormatName(format) + ")");
            File.WriteAllBytes(outPath, data);
            return new Dictionary<string, object>
            {
                { "input", inPath }, { "output", outPath }, { "format", XmlMeta.GetXMLFormatName(format) },
                { "bytes_out", data.Length }, { "asset_dir", Directory.Exists(assetDir) ? assetDir : null },
            };
        }
    }
}

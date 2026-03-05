using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

public static class WebGLBuild
{
    [MenuItem("Tools/Candy/Build/WebGL")]
    public static void BuildWebGLFromMenu()
    {
        BuildWebGLInternal(GetDefaultOutputPath());
    }

    public static void BuildWebGLFromCommandLine()
    {
        string outputPath = GetCommandLineArgValue("-customBuildPath");
        if (string.IsNullOrWhiteSpace(outputPath))
        {
            outputPath = GetDefaultOutputPath();
        }

        string releaseVersion = GetCommandLineArgValue("-releaseVersion");
        if (string.IsNullOrWhiteSpace(releaseVersion))
        {
            releaseVersion = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
        }

        string releaseCommit = GetCommandLineArgValue("-releaseCommit");
        if (string.IsNullOrWhiteSpace(releaseCommit))
        {
            releaseCommit = "unknown";
        }

        BuildWebGLInternal(outputPath, releaseVersion, releaseCommit);
    }

    private static string GetDefaultOutputPath()
    {
        return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "CandyBuilds", "WebGL"));
    }

    private static string GetCommandLineArgValue(string key)
    {
        string[] args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], key, StringComparison.Ordinal))
            {
                return args[i + 1];
            }
        }

        return string.Empty;
    }

    private static void BuildWebGLInternal(string outputPath)
    {
        BuildWebGLInternal(outputPath, "local-editor", "workspace");
    }

    private static void BuildWebGLInternal(string outputPath, string releaseVersion, string releaseCommit)
    {
        string[] scenes = EditorBuildSettings.scenes
            .Where(scene => scene.enabled)
            .Select(scene => scene.path)
            .ToArray();

        if (scenes.Length == 0)
        {
            throw new Exception("[WebGLBuild] Ingen aktive scener i Build Settings.");
        }

        Directory.CreateDirectory(outputPath);

        Debug.Log($"[WebGLBuild] Starter build til: {outputPath}");
        Debug.Log($"[WebGLBuild] Scener: {string.Join(", ", scenes)}");
        Debug.Log($"[WebGLBuild] ReleaseVersion: {releaseVersion} | Commit: {releaseCommit}");

        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = scenes,
            locationPathName = outputPath,
            target = BuildTarget.WebGL,
            options = BuildOptions.None
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        BuildSummary summary = report.summary;

        Debug.Log(
            $"[WebGLBuild] Resultat: {summary.result} | Tid: {summary.totalTime} | " +
            $"Warnings: {summary.totalWarnings} | Errors: {summary.totalErrors} | Size: {summary.totalSize} bytes"
        );

        if (summary.result != BuildResult.Succeeded)
        {
            throw new Exception($"[WebGLBuild] Build feilet med status: {summary.result}");
        }

        WriteReleaseMetadata(outputPath, releaseVersion, releaseCommit, summary.totalSize);
    }

    [Serializable]
    private sealed class ReleaseMetadata
    {
        public string releaseVersion;
        public string releaseCommit;
        public string builtAtUtc;
        public string unityVersion;
        public string bundleVersion;
        public string productName;
        public long buildSizeBytes;
    }

    private static void WriteReleaseMetadata(string outputPath, string releaseVersion, string releaseCommit, ulong buildSizeBytes)
    {
        ReleaseMetadata metadata = new ReleaseMetadata
        {
            releaseVersion = string.IsNullOrWhiteSpace(releaseVersion) ? "unknown" : releaseVersion.Trim(),
            releaseCommit = string.IsNullOrWhiteSpace(releaseCommit) ? "unknown" : releaseCommit.Trim(),
            builtAtUtc = DateTime.UtcNow.ToString("o"),
            unityVersion = Application.unityVersion,
            bundleVersion = PlayerSettings.bundleVersion,
            productName = PlayerSettings.productName,
            buildSizeBytes = (long)buildSizeBytes
        };

        string releaseFile = Path.Combine(outputPath, "release.json");
        string json = JsonUtility.ToJson(metadata, true);
        File.WriteAllText(releaseFile, json);
        Debug.Log($"[WebGLBuild] Skrev release metadata: {releaseFile}");
    }
}

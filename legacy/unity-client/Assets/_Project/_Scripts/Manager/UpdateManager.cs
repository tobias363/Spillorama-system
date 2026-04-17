using System;
using System.Collections;
using System.IO;
using System.IO.Compression;
using System.Net;
using TMPro;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

public class UpdateManager : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public Slider progressBar;
    public TMP_Text progressText;
    #endregion


    private void Start()
    {
        //StartUpdate("https://spillorama.s3.amazonaws.com/addressable/info/exe/SpilloramaSetup.exe");
    }

    public void StartUpdate(string url)
    {
        this.Open();
        StartCoroutine(CheckForUpdates(url));
    }

    IEnumerator CheckForUpdates(string url)
    {
        yield return StartCoroutine(DownloadAndApplyUpdate(url));
    }

    IEnumerator DownloadAndApplyUpdate(string executableUrl)
    {
        Debug.Log("Update Url : " + executableUrl);

        using (WebClient webClient = new WebClient())
        {
            webClient.DownloadProgressChanged += (sender, e) =>
            {
                float progress = (float)e.BytesReceived / (float)e.TotalBytesToReceive;
                progressBar.value = progress;

                // Update progressText.text with the percentage
                int percentage = (int)(progress * 100);
                progressText.text = "Downloading... " + percentage + "%";
            };

            var downloadTask = webClient.DownloadFileTaskAsync(
                new System.Uri(executableUrl),
                "SpilloramaSetup.exe"
            );

            // Wait for the download to complete
            yield return new WaitUntil(() => downloadTask.IsCompleted);

            Application.OpenURL("SpilloramaSetup.exe");

            // Close the current instance
            Application.Quit();
        }
    }

    public IEnumerator DownloadAndInstallTrayApp()
    {
        Debug.Log("📦 Downloading Tray App...");
        string url = "";
        if (GameSocketManager.Instance.server == Constants.SERVER.Staging)
        {
            url =
                "https://spilloramaa.s3.us-east-1.amazonaws.com/addressable/pro/exe/SpilloramaTrayApp.zip";
        }
        else
        {
            url =
                "https://spilloramaa.s3.us-east-1.amazonaws.com/addressable/info/exe/SpilloramaTrayApp.zip";
        }
        Debug.Log("🔗  Downloading Tray App from: " + url);
        string zipPath = Path.Combine(Application.temporaryCachePath, "SpilloramaTrayApp.zip");

        // ✅ Final extraction target — one flat folder
        string extractPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Spillorama"
        );
        string exePath = Path.Combine(extractPath, "SpilloramaTrayApp", "SpilloramaTrayApp.exe");

        Debug.Log("🗂️  Extract Path: " + extractPath);
        Debug.Log("🧾  Exe Path: " + exePath);

        // --- Skip if already installed ---
        if (File.Exists(exePath))
        {
            Debug.Log("✅ Tray app already exists.");
            try
            {
                Debug.Log("🚀 Launching tray app...");
            }
            catch (Exception ex)
            {
                Debug.LogError("❌ Failed to launch tray app: " + ex.Message);
            }
            yield break;
        }

        // --- Download ZIP ---
        using (UnityWebRequest www = UnityWebRequest.Get(url))
        {
            Debug.Log("Downloading... " + url);
            yield return www.SendWebRequest();
            if (www.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError("❌ Tray app download failed: " + www.error);
                yield break;
            }
            float progress = (float)www.downloadedBytes / (float)www.downloadedBytes;
            progressBar.value = progress;

            // Update progressText.text with the percentage
            int percentage = (int)(progress * 100);
            Debug.Log("Downloading... " + percentage + "%");
            File.WriteAllBytes(zipPath, www.downloadHandler.data);
        }

        // --- Ensure parent dir exists ---
        if (!Directory.Exists(extractPath))
        {
            Directory.CreateDirectory(extractPath);
        }

        // --- Extract ZIP: Preserve structure ---
        try
        {
            ZipFile.ExtractToDirectory(zipPath, extractPath, overwriteFiles: true);
            Debug.Log("✅ Tray app extracted.");
        }
        catch (Exception ex)
        {
            Debug.LogError("❌ Failed to extract tray app: " + ex.Message);
            yield break;
        }

        // --- Launch tray app ---
        if (!File.Exists(exePath))
        {
            Debug.LogError("❌ Executable not found after extraction: " + exePath);
            yield break;
        }

        try
        {
            Debug.Log("EXE Exists? " + File.Exists(exePath));
            Debug.Log("EXE Path: " + exePath);
            Debug.Log("EXE Directory: " + Path.GetDirectoryName(exePath));
            Debug.Log("EXE Name: " + Path.GetFileName(exePath));
            Debug.Log("EXE Extension: " + Path.GetExtension(exePath));
            Debug.Log("EXE Full Path: " + Path.GetFullPath(exePath));
            Debug.Log("EXE Parent Directory: " + Path.GetDirectoryName(Path.GetDirectoryName(exePath)));
            Debug.Log("EXE Parent Parent Directory: " + Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(exePath))));
            foreach (var file in Directory.GetFiles(extractPath, "*", SearchOption.AllDirectories))
            {
                Debug.Log("Extracted: " + file);
            }

            Debug.Log("🚀 Launching tray app... " + exePath);
            if (File.Exists(exePath))
            {
                Debug.Log("Launching tray app via explorer.exe...");
                // System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                // {
                //     FileName = "explorer.exe",
                //     Arguments = $"\"{exePath}\"",
                //     UseShellExecute = true, // important
                // });
                var uri = "file:///" + exePath.Replace("\\", "/");
                Debug.Log("Fallback: Application.OpenURL -> " + uri);
                Application.OpenURL(uri);
            }
            else
            {
                Debug.LogError("Tray app not found at: " + exePath);
            }
        }
        catch (System.ComponentModel.Win32Exception wex)
        {
            Debug.LogError($"❌ Win32 Error launching tray app: {wex.Message} (Code: {wex.NativeErrorCode})");
        }
        catch (Exception ex)
        {
            Debug.LogError("❌ Failed to launch tray app: " + ex);
        }
    }
}

using System.Runtime.InteropServices;
using System;
using UnityEngine;
using System.Diagnostics;
using System.IO;

public static class KeyboardDetector
{
#if UNITY_STANDALONE_WIN // && !UNITY_EDITOR
    public static void Open()
    {
        string exePath = Path.Combine(Application.streamingAssetsPath, "TouchKeyboard.exe");
        UnityEngine.Debug.Log("exePath : " + exePath);
        Application.OpenURL(exePath);
        UnityEngine.Debug.Log("Touch keyboard launched via exe");
    }

    public static void Close()
    {
        try
        {
            Process[] procs = Process.GetProcessesByName("TabTip");

            foreach (var p in procs)
            {
                try
                {
                    p.Kill();
                }
                catch (Exception e)
                {
                    UnityEngine.Debug.LogWarning("Failed to close TabTip: " + e.Message);
                }
            }

            UnityEngine.Debug.Log("Touch keyboard closed.");
        }
        catch (Exception e)
        {
            UnityEngine.Debug.LogWarning("Error closing touch keyboard: " + e.Message);
        }
    }
#endif
    // #if UNITY_STANDALONE_WIN
    //     [DllImport("user32.dll")]
    //     static extern uint GetSystemMetrics(uint smIndex);

    //     const uint SM_CONVERTIBLESLATEMODE = 0x2003; // 0=laptop, 1=tablet
    //     const uint SM_SYSTEMDOCKED = 0x2004;         // 1=docked, 0=undocked
    // #endif

    //     public static bool IsKeyboardAttached()
    //     {
    // #if UNITY_STANDALONE_WIN
    //         uint convertible = GetSystemMetrics(SM_CONVERTIBLESLATEMODE);
    //         uint docked = GetSystemMetrics(SM_SYSTEMDOCKED);

    //         bool tabletMode = convertible == 1;
    //         bool isDocked = docked == 1;

    //         if (tabletMode) return false;
    //         if (!isDocked) return false;

    //         return true;
    // #else
    //         return true;
    // #endif
    //     }
}

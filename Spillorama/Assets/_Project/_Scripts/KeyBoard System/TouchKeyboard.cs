using System.Diagnostics;
using UnityEngine;

public class TouchKeyboard : MonoBehaviour
{
    public static void Show()
    {
#if UNITY_STANDALONE_WIN
        string path = @"C:\Program Files\Common Files\Microsoft Shared\Ink\TabTip.exe";

        if (System.IO.File.Exists(path))
            Process.Start(path);
        else
            UnityEngine.Debug.LogWarning("TabTip.exe not found.");
#endif
    }
}

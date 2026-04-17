using UnityEngine;
using UnityEditor;

public class GetCanvasInfo
{
    public static void Execute()
    {
        var canvas = GameObject.Find("Canvas - Main");
        if (canvas != null)
        {
            var rt = canvas.GetComponent<RectTransform>();
            Debug.Log($"Canvas size: {rt.rect.width} x {rt.rect.height}");
            var scaler = canvas.GetComponent<UnityEngine.UI.CanvasScaler>();
            Debug.Log($"Canvas scalerMode: {scaler?.uiScaleMode}");
            Debug.Log($"Canvas referenceResolution: {scaler?.referenceResolution}");
        }
        else
        {
            Debug.Log("Canvas - Main NOT FOUND in scene");
        }
        Debug.Log($"Screen: {Screen.width} x {Screen.height}");
    }
}

#if UNITY_EDITOR
using System.Collections.Generic;
using TMPro;
using UnityEditor;
using UnityEngine;

public static class TMPFontReserializeTools
{
    private static readonly string[] TargetFontAssetPaths =
    {
        "Assets/TextMesh Pro/Resources/Fonts _ Materials/LiberationSans SDF - Fallback.asset",
        "Assets/TextMesh Pro/Examples _ Extras/Resources/Fonts _ Materials/Anton SDF.asset",
        "Assets/TextMesh Pro/Examples _ Extras/Resources/Fonts _ Materials/Bangers SDF.asset",
        "Assets/TextMesh Pro/Examples _ Extras/Resources/Fonts _ Materials/Electronic Highway Sign SDF.asset",
        "Assets/TextMesh Pro/Examples _ Extras/Resources/Fonts _ Materials/Oswald Bold SDF.asset",
        "Assets/TextMesh Pro/Examples _ Extras/Resources/Fonts _ Materials/Roboto-Bold SDF.asset",
        "Assets/UI/UI_Theme1/Font/FredokaOne-Regular SDF.asset",
        "Assets/UI/UI_Theme1/Font/impact SDF.asset",
        "Assets/UI/UI_Theme1/Font/Impacted SDF.asset"
    };

    [MenuItem("Tools/Candy/TMP/Reserialize Units Per EM Fonts")]
    public static void RunFromMenu()
    {
        RunReserialize();
    }

    // Batchmode entrypoint: Unity -executeMethod TMPFontReserializeTools.RunReserialize
    public static void RunReserialize()
    {
        List<string> changedAssets = new();

        foreach (string assetPath in TargetFontAssetPaths)
        {
            TMP_FontAsset fontAsset = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(assetPath);
            if (fontAsset == null)
            {
                Debug.LogWarning($"[TMPFontReserialize] Fant ikke font asset: {assetPath}");
                continue;
            }

            // Trigges etter Unity/TMP-upgraderinger og sørger for at serialized face data er oppdatert.
            fontAsset.ReadFontAssetDefinition();
            EditorUtility.SetDirty(fontAsset);
            changedAssets.Add(assetPath);
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        Debug.Log($"[TMPFontReserialize] Ferdig. Prosesserte {changedAssets.Count} font assets.");
    }
}
#endif

using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

public static class GraphicsQualityTools
{
    private const int TargetMaxTextureSize = 4096;
    private static readonly string[] TextureRoots =
    {
        "Assets/Images",
        "Assets/Texture",
        "Assets/Bonus",
        "Assets/UI",
        "Assets/Resources"
    };

    [MenuItem("Tools/Candy/Graphics/Apply High Quality Texture Imports")]
    public static void ApplyHighQualityTextureImports()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            Debug.LogWarning("[Graphics] Stopp Play Mode før du oppdaterer texture-imports.");
            return;
        }

        string[] textureGuids = AssetDatabase.FindAssets("t:Texture2D", TextureRoots);
        int updatedCount = 0;
        int skippedCount = 0;

        foreach (string guid in textureGuids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            if (string.IsNullOrWhiteSpace(path) ||
                path.Contains("/Editor/") ||
                path.Contains("/Plugins/"))
            {
                skippedCount++;
                continue;
            }

            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null)
            {
                skippedCount++;
                continue;
            }

            if (!ApplyRecommendedTextureSettings(importer))
            {
                continue;
            }

            importer.SaveAndReimport();
            updatedCount++;
        }

        Debug.Log($"[Graphics] Oppdaterte {updatedCount} textures til high-quality. Skippet {skippedCount} filer.");
    }

    [MenuItem("Tools/Candy/Graphics/Configure Canvas Scalers (Open Scene)")]
    public static void ConfigureCanvasScalersInOpenScene()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            Debug.LogWarning("[Graphics] Stopp Play Mode før du oppdaterer CanvasScaler.");
            return;
        }

        CanvasScaler[] scalers = Object.FindObjectsOfType<CanvasScaler>(true);
        int changed = 0;

        foreach (CanvasScaler scaler in scalers)
        {
            bool modified = false;
            Undo.RecordObject(scaler, "Configure Canvas Scaler");

            if (scaler.uiScaleMode != CanvasScaler.ScaleMode.ScaleWithScreenSize)
            {
                scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
                modified = true;
            }

            if (scaler.referenceResolution != new Vector2(1920f, 1080f))
            {
                scaler.referenceResolution = new Vector2(1920f, 1080f);
                modified = true;
            }

            if (scaler.screenMatchMode != CanvasScaler.ScreenMatchMode.MatchWidthOrHeight)
            {
                scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
                modified = true;
            }

            if (!Mathf.Approximately(scaler.matchWidthOrHeight, 0.5f))
            {
                scaler.matchWidthOrHeight = 0.5f;
                modified = true;
            }

            if (modified)
            {
                EditorUtility.SetDirty(scaler);
                changed++;
            }
        }

        if (changed > 0)
        {
            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
        }

        Debug.Log($"[Graphics] Oppdaterte {changed} CanvasScaler-komponent(er) i åpen scene.");
    }

    private static bool ApplyRecommendedTextureSettings(TextureImporter importer)
    {
        bool changed = false;

        if (importer.filterMode != FilterMode.Bilinear)
        {
            importer.filterMode = FilterMode.Bilinear;
            changed = true;
        }

        int importerMaxSize = Mathf.Max(importer.maxTextureSize, TargetMaxTextureSize);
        if (importer.maxTextureSize != importerMaxSize)
        {
            importer.maxTextureSize = importerMaxSize;
            changed = true;
        }

        if (importer.textureCompression != TextureImporterCompression.Uncompressed)
        {
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            changed = true;
        }

        if (importer.compressionQuality != 100)
        {
            importer.compressionQuality = 100;
            changed = true;
        }

        if (importer.streamingMipmaps)
        {
            importer.streamingMipmaps = false;
            changed = true;
        }

        if (importer.crunchedCompression)
        {
            importer.crunchedCompression = false;
            changed = true;
        }

        int targetAnisoLevel = Mathf.Max(importer.anisoLevel, 4);
        if (importer.anisoLevel != targetAnisoLevel)
        {
            importer.anisoLevel = targetAnisoLevel;
            changed = true;
        }

        bool isSpriteTexture = importer.textureType == TextureImporterType.Sprite;
        if (isSpriteTexture)
        {
            if (importer.mipmapEnabled)
            {
                importer.mipmapEnabled = false;
                changed = true;
            }

            if (!importer.alphaIsTransparency)
            {
                importer.alphaIsTransparency = true;
                changed = true;
            }
        }

        changed |= ConfigurePlatform(importer, "Standalone");
        changed |= ConfigurePlatform(importer, "WebGL");
        changed |= ConfigurePlatform(importer, "Android");
        changed |= ConfigurePlatform(importer, "iPhone");

        return changed;
    }

    private static bool ConfigurePlatform(TextureImporter importer, string platformName)
    {
        TextureImporterPlatformSettings platform = importer.GetPlatformTextureSettings(platformName);
        bool changed = false;

        if (!platform.overridden)
        {
            platform.overridden = true;
            changed = true;
        }

        int newMaxSize = Mathf.Max(platform.maxTextureSize, TargetMaxTextureSize);
        if (platform.maxTextureSize != newMaxSize)
        {
            platform.maxTextureSize = newMaxSize;
            changed = true;
        }

        if (platform.textureCompression != TextureImporterCompression.Uncompressed)
        {
            platform.textureCompression = TextureImporterCompression.Uncompressed;
            changed = true;
        }

        if (platform.compressionQuality != 100)
        {
            platform.compressionQuality = 100;
            changed = true;
        }

        if (platform.crunchedCompression)
        {
            platform.crunchedCompression = false;
            changed = true;
        }

        if (changed)
        {
            importer.SetPlatformTextureSettings(platform);
        }

        return changed;
    }
}

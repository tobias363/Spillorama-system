#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TextCore.LowLevel;
using UnityEngine.UI;

public static class CandyGameplayTypographyTools
{
    private const string FredokaRootDirectory = "Assets/Resources/CandyTypography/Fredoka";
    private const string TmpOutputDirectory = "Assets/Resources/CandyTypography/TMP";
    private const string LiberationSansAssetPath = "Assets/TextMesh Pro/Resources/Fonts _ Materials/LiberationSans SDF.asset";
    private const string LiberationSansFallbackAssetPath = "Assets/TextMesh Pro/Resources/Fonts _ Materials/LiberationSans SDF - Fallback.asset";
    private static readonly string[] GameplayScenePaths =
    {
        "Assets/Scenes/Theme1.unity",
        "Assets/Scenes/Theme2.unity",
        "Assets/Scenes/Bonus.unity"
    };
    private const string GameplayCharacterSet =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
        ".,:;!?%+-_=()[]{}<>/\\|@#$&*'\" " +
        "æøåÆØÅ€£$krKRNeste rundeSpillere i rommetBONUSWINJACKPOT";

    private static readonly string[] ForbiddenSerializedAssetPaths =
    {
        "Assets/UI/UI_Theme1/Font/FredokaOne-Regular SDF.asset",
        "Assets/UI/UI_Theme1/Font/impact SDF.asset",
        "Assets/UI/UI_Theme1/Font/Impacted SDF.asset",
        "Assets/TextMesh Pro/Examples _ Extras/Resources/Fonts _ Materials/Oswald Bold SDF.asset",
        "Assets/TextMesh Pro/Examples _ Extras/Resources/Fonts _ Materials/Roboto-Bold SDF.asset",
        "Assets/Bonus/Font/FredokaOne-Regular SDF.asset",
        "Assets/Bonus/Font/FredokaOne-Regular SDF 1.asset"
    };

    [InitializeOnLoadMethod]
    private static void EnsureTypographyAssetsOnEditorLoad()
    {
        EditorApplication.delayCall += () =>
        {
            if (HasHealthyGeneratedTypographyAssets())
            {
                return;
            }

            try
            {
                GenerateOrRefreshFredokaTmpAssets(logSummary: false);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[CandyTypography] Klarte ikke autogenerere Fredoka TMP assets: " + ex.Message);
            }
        };
    }

    [MenuItem("Candy/Typography/Generate Fredoka TMP Assets")]
    public static void GenerateFredokaTmpAssetsMenu()
    {
        GenerateOrRefreshFredokaTmpAssets(logSummary: true);
    }

    [MenuItem("Candy/Typography/Apply Fredoka To Gameplay Scenes")]
    public static void ApplyFredokaToGameplayScenesMenu()
    {
        GenerateOrRefreshFredokaTmpAssets(logSummary: false);
        ApplyFredokaToGameplayScenes(logSummary: true);
    }

    [MenuItem("Candy/Typography/Audit Gameplay Typography")]
    public static void AuditGameplayTypographyMenu()
    {
        AuditGameplayTypography(logSummary: true);
    }

    [MenuItem("Candy/Typography/Validate Gameplay Typography")]
    public static void ValidateGameplayTypographyMenu()
    {
        ValidateGameplayTypography(logSummary: true);
    }

    public static void GenerateFredokaTmpAssetsCli()
    {
        GenerateOrRefreshFredokaTmpAssets(logSummary: true);
    }

    public static void ApplyFredokaToGameplayScenesCli()
    {
        GenerateOrRefreshFredokaTmpAssets(logSummary: false);
        ApplyFredokaToGameplayScenes(logSummary: true);
    }

    public static void AuditGameplayTypographyCli()
    {
        AuditGameplayTypography(logSummary: true);
    }

    public static void ValidateGameplayTypographyCli()
    {
        ValidateGameplayTypography(logSummary: true);
    }

    public static TMP_FontAsset ResolveGeneratedFontAsset(CandyTypographyRole role)
    {
        string assetPath = Path.Combine(TmpOutputDirectory, CandyTypographySystem.GetTmpAssetName(role) + ".asset").Replace("\\", "/");
        return AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(assetPath);
    }

    public static IReadOnlyList<string> GetGameplayScenePaths()
    {
        return GameplayScenePaths;
    }

    public static bool IsAllowedGameplayFontPath(string assetPath)
    {
        if (string.IsNullOrWhiteSpace(assetPath))
        {
            return false;
        }

        return assetPath.StartsWith(TmpOutputDirectory, StringComparison.Ordinal) ||
               string.Equals(assetPath, LiberationSansAssetPath, StringComparison.Ordinal) ||
               string.Equals(assetPath, LiberationSansFallbackAssetPath, StringComparison.Ordinal);
    }

    public static bool IsAllowedGameplayMaterialPath(string assetPath)
    {
        if (string.IsNullOrWhiteSpace(assetPath))
        {
            return true;
        }

        return IsAllowedGameplayFontPath(assetPath);
    }

    public static bool HasForbiddenGameplayMaterialFeatures(Material material, out string details)
    {
        details = string.Empty;
        if (material == null)
        {
            details = "material=null";
            return true;
        }

        if (CandyTypographySystem.IsForbiddenGameplayShader(material.shader, out string shaderDetails))
        {
            details = shaderDetails;
            return true;
        }

        if (material.IsKeywordEnabled("UNDERLAY_ON") || material.IsKeywordEnabled("UNDERLAY_INNER"))
        {
            details = "underlay keyword enabled";
            return true;
        }

        if (material.IsKeywordEnabled("OUTLINE_ON"))
        {
            details = "outline keyword enabled";
            return true;
        }

        if (material.IsKeywordEnabled("GLOW_ON"))
        {
            details = "glow keyword enabled";
            return true;
        }

        if (Mathf.Abs(ReadFloat(material, "_OutlineWidth")) > 0.0001f ||
            Mathf.Abs(ReadFloat(material, "_OutlineSoftness")) > 0.0001f ||
            Mathf.Abs(ReadFloat(material, "_UnderlaySoftness")) > 0.0001f ||
            Mathf.Abs(ReadFloat(material, "_UnderlayDilate")) > 0.0001f ||
            Mathf.Abs(ReadFloat(material, "_UnderlayOffsetX")) > 0.0001f ||
            Mathf.Abs(ReadFloat(material, "_UnderlayOffsetY")) > 0.0001f ||
            Mathf.Abs(ReadFloat(material, "_GlowPower")) > 0.0001f ||
            Mathf.Abs(ReadFloat(material, "_GlowInner")) > 0.0001f ||
            Mathf.Abs(ReadFloat(material, "_GlowOuter")) > 0.0001f)
        {
            details = "shader properties contain outline/underlay/glow";
            return true;
        }

        if (ReadColorAlpha(material, "_UnderlayColor") > 0.0001f ||
            ReadColorAlpha(material, "_OutlineColor") > 0.0001f ||
            ReadColorAlpha(material, "_GlowColor") > 0.0001f)
        {
            details = "shader colors contain outline/underlay/glow alpha";
            return true;
        }

        return false;
    }

    public static bool IsHealthyGameplayFontAsset(TMP_FontAsset fontAsset, out string details)
    {
        details = string.Empty;
        if (fontAsset == null)
        {
            details = "font=null";
            return false;
        }

        Texture2D atlasTexture = null;
        try
        {
            atlasTexture = fontAsset.atlasTexture;
        }
        catch (Exception ex)
        {
            details = "atlas access failed: " + ex.Message;
            return false;
        }

        if (atlasTexture == null)
        {
            details = "atlas=null";
            return false;
        }

        if (atlasTexture.width <= 1 || atlasTexture.height <= 1)
        {
            details = $"atlas too small ({atlasTexture.width}x{atlasTexture.height})";
            return false;
        }

        int glyphCount = fontAsset.glyphTable != null ? fontAsset.glyphTable.Count : 0;
        int characterCount = fontAsset.characterTable != null ? fontAsset.characterTable.Count : 0;
        if (glyphCount <= 0 || characterCount <= 0)
        {
            details = $"glyphs={glyphCount} chars={characterCount}";
            return false;
        }

        if (fontAsset.atlasPopulationMode != AtlasPopulationMode.Static)
        {
            details = "atlasPopulationMode=" + fontAsset.atlasPopulationMode;
            return false;
        }

        if (fontAsset.material == null)
        {
            details = "material=null";
            return false;
        }

        if (CandyTypographySystem.IsForbiddenGameplayShader(fontAsset.material.shader, out string shaderDetails))
        {
            details = shaderDetails;
            return false;
        }

        return true;
    }

    public static bool ValidateGameplayCanvas(Canvas canvas, out string details)
    {
        details = string.Empty;
        if (canvas == null)
        {
            details = "canvas=null";
            return false;
        }

        if (!canvas.gameObject.activeInHierarchy)
        {
            return true;
        }

        if (canvas.renderMode != RenderMode.ScreenSpaceCamera)
        {
            return true;
        }

        if (!HasManagedGameplayTextDescendants(canvas.transform))
        {
            return true;
        }

        CanvasScaler scaler = canvas.GetComponent<CanvasScaler>();
        if (scaler == null)
        {
            details = "missing CanvasScaler";
            return false;
        }

        if (scaler.dynamicPixelsPerUnit < CandyTypographySystem.MinimumGameplayCameraCanvasDynamicPixelsPerUnit)
        {
            details = $"dynamicPixelsPerUnit={scaler.dynamicPixelsPerUnit:0.##}";
            return false;
        }

        if (canvas.worldCamera == null)
        {
            details = "worldCamera=null";
            return false;
        }

        return true;
    }

    private static void GenerateOrRefreshFredokaTmpAssets(bool logSummary)
    {
        Directory.CreateDirectory(Path.Combine(Application.dataPath, "Resources/CandyTypography/TMP"));

        CreateFontAssetIfMissing("Fredoka-Regular.ttf", CandyTypographyRole.Body);
        CreateFontAssetIfMissing("Fredoka-SemiBold.ttf", CandyTypographyRole.Number);
        CreateFontAssetIfMissing("Fredoka-Bold.ttf", CandyTypographyRole.Headline);

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        CandyTypographySystem.ClearCaches();

        if (logSummary)
        {
            Debug.Log("[CandyTypography] Fredoka TMP assets generert eller bekreftet.");
        }
    }

    private static void ApplyFredokaToGameplayScenes(bool logSummary)
    {
        int totalUpdated = 0;
        for (int i = 0; i < GameplayScenePaths.Length; i++)
        {
            string scenePath = GameplayScenePaths[i];
            Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            int updatedCount = ApplyTypographyToScene(scene);
            totalUpdated += updatedCount;
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
        }

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();
        ValidateGameplayTypography(logSummary: false);

        if (logSummary)
        {
            Debug.Log($"[CandyTypography] Oppdatert {totalUpdated} TMP-tekstobjekter i gameplay-scener.");
        }
    }

    private static int ApplyTypographyToScene(Scene scene)
    {
        int updatedCount = 0;
        updatedCount += NormalizeGameplayCanvases(scene);
        updatedCount += RemoveLegacyTheme1Mirrors(scene);
        foreach (GameObject root in scene.GetRootGameObjects())
        {
            TMP_Text[] texts = root.GetComponentsInChildren<TMP_Text>(true);
            for (int i = 0; i < texts.Length; i++)
            {
                TMP_Text label = texts[i];
                if (label == null)
                {
                    continue;
                }

                NormalizeTextTransform(label);
                RealtimeTextStyleUtils.ApplyGameplayTextPresentation(
                    label,
                    CandyTypographySystem.Classify(label),
                    RealtimeTextStyleUtils.ClassifyGameplaySurface(label));
                EditorUtility.SetDirty(label);
                updatedCount += 1;
            }
        }

        updatedCount += ApplyExplicitTheme1PresentationTypography(scene);

        return updatedCount;
    }

    private static void AuditGameplayTypography(bool logSummary)
    {
        Dictionary<string, int> countsByAssetPath = new();
        for (int i = 0; i < GameplayScenePaths.Length; i++)
        {
            Scene scene = EditorSceneManager.OpenScene(GameplayScenePaths[i], OpenSceneMode.Single);
            foreach (GameObject root in scene.GetRootGameObjects())
            {
                TMP_Text[] texts = root.GetComponentsInChildren<TMP_Text>(true);
                for (int j = 0; j < texts.Length; j++)
                {
                    TMP_Text label = texts[j];
                    string fontPath = label != null && label.font != null
                        ? AssetDatabase.GetAssetPath(label.font)
                        : "<null-font>";
                    countsByAssetPath.TryGetValue(fontPath, out int fontCount);
                    countsByAssetPath[fontPath] = fontCount + 1;

                    Material material = label != null
                        ? (label.fontSharedMaterial != null ? label.fontSharedMaterial : label.fontMaterial)
                        : null;
                    string materialPath = material != null
                        ? AssetDatabase.GetAssetPath(material)
                        : "<null-material>";
                    countsByAssetPath.TryGetValue(materialPath, out int materialCount);
                    countsByAssetPath[materialPath] = materialCount + 1;
                }
            }
        }

        if (!logSummary)
        {
            return;
        }

        foreach (KeyValuePair<string, int> entry in countsByAssetPath)
        {
            Debug.Log($"[CandyTypographyAudit] {entry.Key} => {entry.Value}");
        }
    }

    private static void ValidateGameplayTypography(bool logSummary)
    {
        List<string> errors = new();
        for (int i = 0; i < GameplayScenePaths.Length; i++)
        {
            string scenePath = GameplayScenePaths[i];
            Scene scene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            ValidateSceneTypography(scenePath, scene, errors);
            ValidateSerializedSceneContent(scenePath, errors);
        }

        if (errors.Count == 0)
        {
            if (logSummary)
            {
                Debug.Log("[CandyTypography] Gameplay-typografi validert uten legacy font-, material- eller scale-avvik.");
            }

            return;
        }

        string message = "[CandyTypography] Gameplay-typografi validering feilet:\n" + string.Join("\n", errors);
        if (logSummary)
        {
            Debug.LogError(message);
        }

        throw new InvalidOperationException(message);
    }

    private static void ValidateSceneTypography(string scenePath, Scene scene, List<string> errors)
    {
        HashSet<int> validatedCanvasIds = new();
        foreach (GameObject root in scene.GetRootGameObjects())
        {
            TMP_Text[] texts = root.GetComponentsInChildren<TMP_Text>(true);
            for (int i = 0; i < texts.Length; i++)
            {
                TMP_Text label = texts[i];
                if (label == null)
                {
                    continue;
                }

                string labelPath = scene.name + ": " + BuildObjectPath(label.transform);
                string fontPath = label.font != null ? AssetDatabase.GetAssetPath(label.font) : string.Empty;
                if (!IsAllowedGameplayFontPath(fontPath))
                {
                    errors.Add($"{labelPath} bruker legacy font {fontPath}");
                }
                else if (!IsHealthyGameplayFontAsset(label.font, out string fontDetails))
                {
                    errors.Add($"{labelPath} bruker usunt gameplay-fontasset ({fontDetails})");
                }

                Material material = label.fontSharedMaterial != null ? label.fontSharedMaterial : label.fontMaterial;
                string materialPath = material != null ? AssetDatabase.GetAssetPath(material) : string.Empty;
                if (!IsAllowedGameplayMaterialPath(materialPath))
                {
                    errors.Add($"{labelPath} bruker legacy material {materialPath}");
                }

                if (HasForbiddenGameplayMaterialFeatures(material, out string details))
                {
                    errors.Add($"{labelPath} har forbudte material-features ({details})");
                }

                if (!IsUnitScale(label.transform.localScale))
                {
                    errors.Add($"{labelPath} har non-unit localScale {label.transform.localScale}");
                }

                Canvas rootCanvas = label.canvas != null ? label.canvas.rootCanvas : label.GetComponentInParent<Canvas>(true);
                if (rootCanvas == null)
                {
                    continue;
                }

                int canvasId = rootCanvas.GetInstanceID();
                if (!validatedCanvasIds.Add(canvasId))
                {
                    continue;
                }

                if (!ValidateGameplayCanvas(rootCanvas, out string canvasDetails))
                {
                    errors.Add($"{scene.name}: canvas {BuildObjectPath(rootCanvas.transform)} er ugyldig ({canvasDetails})");
                }
            }
        }
    }

    private static void ValidateSerializedSceneContent(string scenePath, List<string> errors)
    {
        string absoluteScenePath = GetAbsoluteAssetPath(scenePath);
        if (!File.Exists(absoluteScenePath))
        {
            errors.Add($"Fant ikke scene-fil {scenePath}");
            return;
        }

        string sceneYaml = File.ReadAllText(absoluteScenePath);
        for (int i = 0; i < ForbiddenSerializedAssetPaths.Length; i++)
        {
            string assetPath = ForbiddenSerializedAssetPaths[i];
            string guid = AssetDatabase.AssetPathToGUID(assetPath);
            if (string.IsNullOrWhiteSpace(guid))
            {
                continue;
            }

            if (sceneYaml.IndexOf(guid, StringComparison.Ordinal) >= 0)
            {
                errors.Add($"{scenePath} inneholder fortsatt serialisert legacy asset-reference {assetPath}");
            }
        }

        if (string.Equals(scenePath, "Assets/Scenes/Theme1.unity", StringComparison.Ordinal))
        {
            if (sceneYaml.IndexOf(Theme1GameplayViewRepairUtils.VisibleLabelSuffix, StringComparison.Ordinal) >= 0)
            {
                errors.Add($"{scenePath} serialiserer legacy _Visible mirror-objekter.");
            }

            if (sceneYaml.IndexOf("Theme1VisibleTextBridge", StringComparison.Ordinal) >= 0 ||
                sceneYaml.IndexOf("Theme1HudTextMirror", StringComparison.Ordinal) >= 0)
            {
                errors.Add($"{scenePath} serialiserer legacy Theme1 mirror-komponenter.");
            }

            if (sceneYaml.IndexOf("Runtime CandyFredokaMediumSDF", StringComparison.Ordinal) >= 0)
            {
                errors.Add($"{scenePath} serialiserer runtime-fontasset Runtime CandyFredokaMediumSDF.");
            }
        }
    }

    private static int RemoveLegacyTheme1Mirrors(Scene scene)
    {
        int removedCount = 0;
        HashSet<int> destroyedIds = new HashSet<int>();

        Theme1VisibleTextBridge[] visibleBridges = Resources.FindObjectsOfTypeAll<Theme1VisibleTextBridge>();
        for (int i = 0; i < visibleBridges.Length; i++)
        {
            Theme1VisibleTextBridge bridge = visibleBridges[i];
            if (bridge == null || bridge.gameObject.scene != scene)
            {
                continue;
            }

            removedCount += DestroyLegacyMirrorGameObject(bridge.gameObject, destroyedIds);
        }

        Theme1HudTextMirror[] hudMirrors = Resources.FindObjectsOfTypeAll<Theme1HudTextMirror>();
        for (int i = 0; i < hudMirrors.Length; i++)
        {
            Theme1HudTextMirror mirror = hudMirrors[i];
            if (mirror == null || mirror.gameObject.scene != scene)
            {
                continue;
            }

            removedCount += DestroyLegacyMirrorGameObject(mirror.gameObject, destroyedIds);
        }

        TMP_Text[] labels = Resources.FindObjectsOfTypeAll<TMP_Text>();
        for (int i = 0; i < labels.Length; i++)
        {
            TMP_Text label = labels[i];
            if (label == null || label.gameObject.scene != scene)
            {
                continue;
            }

            if (!label.gameObject.name.EndsWith(Theme1GameplayViewRepairUtils.VisibleLabelSuffix, StringComparison.Ordinal))
            {
                continue;
            }

            removedCount += DestroyLegacyMirrorGameObject(label.gameObject, destroyedIds);
        }

        return removedCount;
    }

    private static int DestroyLegacyMirrorGameObject(GameObject target, HashSet<int> destroyedIds)
    {
        if (target == null)
        {
            return 0;
        }

        int instanceId = target.GetInstanceID();
        if (destroyedIds.Contains(instanceId))
        {
            return 0;
        }

        destroyedIds.Add(instanceId);
        Undo.DestroyObjectImmediate(target);
        return 1;
    }

    private static int ApplyExplicitTheme1PresentationTypography(Scene scene)
    {
        int updatedCount = 0;
        Theme1GameplayViewRoot[] presentationRoots = Resources.FindObjectsOfTypeAll<Theme1GameplayViewRoot>();
        for (int i = 0; i < presentationRoots.Length; i++)
        {
            Theme1GameplayViewRoot root = presentationRoots[i];
            if (root == null || root.gameObject.scene != scene)
            {
                continue;
            }

            Theme1GameplayViewContractRefresher.RefreshVisibleContractFromScene(root);
            Theme1GameplayTypographyBootstrap.RegisterManagedTextTargets(root);
            Theme1GameplayTypographyBootstrap.ApplyTypography(root);
            EditorUtility.SetDirty(root);
            updatedCount += 1;
        }

        return updatedCount;
    }

    private static void CreateFontAssetIfMissing(string sourceFileName, CandyTypographyRole role)
    {
        string outputPath = Path.Combine(TmpOutputDirectory, CandyTypographySystem.GetTmpAssetName(role) + ".asset").Replace("\\", "/");
        string fontAssetPath = Path.Combine(FredokaRootDirectory, sourceFileName).Replace("\\", "/");
        Font sourceFont = AssetDatabase.LoadAssetAtPath<Font>(fontAssetPath);
        if (sourceFont == null)
        {
            throw new InvalidOperationException($"[CandyTypography] Fant ikke kildeskrift: {fontAssetPath}");
        }

        TMP_FontAsset generated = TMP_FontAsset.CreateFontAsset(
            sourceFont,
            role == CandyTypographyRole.Headline ? 120 : role == CandyTypographyRole.Number ? 112 : 96,
            8,
            GlyphRenderMode.SDFAA,
            role == CandyTypographyRole.Body ? 2048 : 4096,
            role == CandyTypographyRole.Body ? 2048 : 4096,
            AtlasPopulationMode.Dynamic,
            false);
        if (generated == null)
        {
            throw new InvalidOperationException($"[CandyTypography] Klarte ikke lage TMP asset for {fontAssetPath}");
        }

        generated.name = CandyTypographySystem.GetTmpAssetName(role);
        TMP_FontAsset fallback = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(LiberationSansFallbackAssetPath);
        if (fallback != null)
        {
            generated.fallbackFontAssetTable = new List<TMP_FontAsset> { fallback };
        }

        if (!generated.TryAddCharacters(GameplayCharacterSet, out string missingCharacters, true) &&
            !string.IsNullOrWhiteSpace(missingCharacters))
        {
            throw new InvalidOperationException(
                $"[CandyTypography] Manglende tegn i TMP asset {generated.name}: {missingCharacters}");
        }

        TMP_FontAsset existing = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(outputPath);
        if (existing == null)
        {
            AssetDatabase.CreateAsset(generated, outputPath);
            existing = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(outputPath);
        }
        else
        {
            RemoveEmbeddedSubAssets(outputPath, existing);
            EditorUtility.CopySerialized(generated, existing);
            existing.name = generated.name;
        }

        EnsurePersistentSubAssets(existing, outputPath, generated.atlasTexture, generated.material);
        SanitizePersistentFontAsset(existing);
        EditorUtility.SetDirty(existing);

        if (generated != existing && !AssetDatabase.Contains(generated))
        {
            UnityEngine.Object.DestroyImmediate(generated);
        }

        if (!IsHealthyGameplayFontAsset(existing, out string healthDetails))
        {
            throw new InvalidOperationException(
                $"[CandyTypography] Generert TMP asset {existing.name} er fortsatt usunt: {healthDetails}");
        }
    }

    private static void EnsurePersistentSubAssets(
        TMP_FontAsset fontAsset,
        string outputPath,
        Texture2D atlasOverride = null,
        Material materialOverride = null)
    {
        if (fontAsset == null)
        {
            return;
        }

        Texture2D atlasTexture = atlasOverride != null ? atlasOverride : fontAsset.atlasTexture;
        if (atlasTexture != null)
        {
            atlasTexture.name = fontAsset.name + " Atlas";
            if (!AssetDatabase.Contains(atlasTexture))
            {
                AssetDatabase.AddObjectToAsset(atlasTexture, outputPath);
            }
        }

        Material material = materialOverride != null ? materialOverride : fontAsset.material;
        if (material == null && atlasTexture != null)
        {
            ShaderUtilities.GetShaderPropertyIDs();
            Shader distanceFieldShader = CandyTypographySystem.ResolvePreferredGameplayShader();
            if (distanceFieldShader == null)
            {
                return;
            }

            material = new Material(distanceFieldShader)
            {
                name = fontAsset.name + " Material"
            };
        }

        if (material != null && !AssetDatabase.Contains(material))
        {
            AssetDatabase.AddObjectToAsset(material, outputPath);
        }

        SerializedObject serializedFont = new SerializedObject(fontAsset);
        SerializedProperty atlasTexturesProperty = serializedFont.FindProperty("m_AtlasTextures");
        if (atlasTexturesProperty != null && atlasTexture != null)
        {
            atlasTexturesProperty.arraySize = 1;
            atlasTexturesProperty.GetArrayElementAtIndex(0).objectReferenceValue = atlasTexture;
        }

        SerializedProperty atlasTextureIndexProperty = serializedFont.FindProperty("m_AtlasTextureIndex");
        if (atlasTextureIndexProperty != null)
        {
            atlasTextureIndexProperty.intValue = 0;
        }

        SerializedProperty materialProperty = serializedFont.FindProperty("m_Material");
        if (materialProperty != null)
        {
            materialProperty.objectReferenceValue = material;
        }

        SerializedProperty atlasPopulationModeProperty = serializedFont.FindProperty("m_AtlasPopulationMode");
        if (atlasPopulationModeProperty != null)
        {
            atlasPopulationModeProperty.intValue = (int)AtlasPopulationMode.Static;
        }

        SerializedProperty clearDynamicDataProperty = serializedFont.FindProperty("m_ClearDynamicDataOnBuild");
        if (clearDynamicDataProperty != null)
        {
            clearDynamicDataProperty.boolValue = false;
        }

        SerializedProperty multiAtlasProperty = serializedFont.FindProperty("m_IsMultiAtlasTexturesEnabled");
        if (multiAtlasProperty != null)
        {
            multiAtlasProperty.boolValue = false;
        }

        serializedFont.ApplyModifiedPropertiesWithoutUndo();
        fontAsset.material = material;

        SanitizePersistentFontAsset(fontAsset);
    }

    private static void RemoveEmbeddedSubAssets(string outputPath, TMP_FontAsset rootAsset)
    {
        UnityEngine.Object[] assetsAtPath = AssetDatabase.LoadAllAssetsAtPath(outputPath);
        for (int i = 0; i < assetsAtPath.Length; i++)
        {
            UnityEngine.Object asset = assetsAtPath[i];
            if (asset == null || asset == rootAsset)
            {
                continue;
            }

            UnityEngine.Object.DestroyImmediate(asset, true);
        }
    }

    private static void SanitizePersistentFontAsset(TMP_FontAsset fontAsset)
    {
        if (fontAsset == null || fontAsset.material == null || fontAsset.atlasTexture == null)
        {
            return;
        }

        ShaderUtilities.GetShaderPropertyIDs();
        Material material = fontAsset.material;
        Shader preferredShader = CandyTypographySystem.ResolvePreferredGameplayShader();
        if (preferredShader != null && material.shader != preferredShader)
        {
            material.shader = preferredShader;
        }
        material.SetTexture(ShaderUtilities.ID_MainTex, fontAsset.atlasTexture);
        material.SetFloat(ShaderUtilities.ID_TextureWidth, fontAsset.atlasTexture.width);
        material.SetFloat(ShaderUtilities.ID_TextureHeight, fontAsset.atlasTexture.height);
        material.SetFloat(ShaderUtilities.ID_GradientScale, Mathf.Max(9f, ReadFloat(material, ShaderUtilities.ID_GradientScale)));
        material.SetFloat(ShaderUtilities.ID_WeightNormal, fontAsset.normalStyle);
        material.SetFloat(ShaderUtilities.ID_WeightBold, fontAsset.boldStyle);

        material.DisableKeyword("UNDERLAY_ON");
        material.DisableKeyword("UNDERLAY_INNER");
        material.DisableKeyword("OUTLINE_ON");
        material.DisableKeyword("GLOW_ON");
        material.DisableKeyword("BEVEL_ON");

        SetFloatIfPresent(material, "_OutlineWidth", 0f);
        SetFloatIfPresent(material, "_OutlineSoftness", 0f);
        SetFloatIfPresent(material, "_FaceDilate", 0f);
        SetFloatIfPresent(material, "_GlowPower", 0f);
        SetFloatIfPresent(material, "_GlowInner", 0f);
        SetFloatIfPresent(material, "_GlowOuter", 0f);
        SetFloatIfPresent(material, "_UnderlaySoftness", 0f);
        SetFloatIfPresent(material, "_UnderlayDilate", 0f);
        SetFloatIfPresent(material, "_UnderlayOffsetX", 0f);
        SetFloatIfPresent(material, "_UnderlayOffsetY", 0f);
        SetColorIfPresent(material, "_UnderlayColor", new Color(0f, 0f, 0f, 0f));
        SetColorIfPresent(material, "_OutlineColor", new Color(0f, 0f, 0f, 0f));
        SetColorIfPresent(material, "_GlowColor", new Color(0f, 0f, 0f, 0f));
        EditorUtility.SetDirty(material);
    }

    private static int NormalizeGameplayCanvases(Scene scene)
    {
        int updatedCount = 0;
        Camera gameplayCamera = FindGameplayCamera(scene);
        foreach (GameObject root in scene.GetRootGameObjects())
        {
            Canvas[] canvases = root.GetComponentsInChildren<Canvas>(true);
            for (int i = 0; i < canvases.Length; i++)
            {
                Canvas canvas = canvases[i];
                if (canvas == null || !canvas.isRootCanvas || !canvas.gameObject.activeSelf)
                {
                    continue;
                }

                if (canvas.renderMode != RenderMode.ScreenSpaceCamera)
                {
                    continue;
                }

                if (!HasManagedGameplayTextDescendants(canvas.transform))
                {
                    continue;
                }

                bool modified = false;
                CanvasScaler scaler = canvas.GetComponent<CanvasScaler>();
                if (scaler != null &&
                    scaler.dynamicPixelsPerUnit < CandyTypographySystem.MinimumGameplayCameraCanvasDynamicPixelsPerUnit)
                {
                    scaler.dynamicPixelsPerUnit = CandyTypographySystem.MinimumGameplayCameraCanvasDynamicPixelsPerUnit;
                    EditorUtility.SetDirty(scaler);
                    modified = true;
                }

                if (canvas.worldCamera == null && gameplayCamera != null)
                {
                    canvas.worldCamera = gameplayCamera;
                    modified = true;
                }

                if (canvas.pixelPerfect)
                {
                    canvas.pixelPerfect = false;
                    modified = true;
                }

                if (modified)
                {
                    EditorUtility.SetDirty(canvas);
                    updatedCount += 1;
                }
            }
        }

        return updatedCount;
    }

    private static void NormalizeTextTransform(TMP_Text label)
    {
        if (label == null)
        {
            return;
        }

        if (label is TextMeshProUGUI uiLabel)
        {
            RectTransform rect = uiLabel.rectTransform;
            if (rect != null)
            {
                bool isGridChild = rect.parent != null && rect.parent.GetComponent<GridLayoutGroup>() != null;
                bool needsRectRepair =
                    rect.rect.width <= 1f ||
                    rect.rect.height <= 1f ||
                    (isGridChild && (rect.sizeDelta.x <= 1f || rect.sizeDelta.y <= 1f));
                Vector2 preferredSize = ResolvePreferredLabelSize(rect);
                if (needsRectRepair && preferredSize.x > 1f && preferredSize.y > 1f)
                {
                    rect.sizeDelta = preferredSize;
                    EditorUtility.SetDirty(rect);
                }
            }
        }

        if (!IsUnitScale(label.transform.localScale))
        {
            label.transform.localScale = Vector3.one;
        }
    }

    private static Vector2 ResolvePreferredLabelSize(RectTransform rect)
    {
        if (rect == null)
        {
            return Vector2.zero;
        }

        Rect ownRect = rect.rect;
        if (ownRect.width > 1f && ownRect.height > 1f)
        {
            return ownRect.size;
        }

        if (rect.parent != null)
        {
            GridLayoutGroup grid = rect.parent.GetComponent<GridLayoutGroup>();
            if (grid != null && grid.cellSize.x > 1f && grid.cellSize.y > 1f)
            {
                return grid.cellSize;
            }

            if (rect.parent is RectTransform parentRect &&
                parentRect.rect.width > 1f &&
                parentRect.rect.height > 1f)
            {
                return parentRect.rect.size;
            }
        }

        return Vector2.zero;
    }

    private static string GetAbsoluteAssetPath(string assetPath)
    {
        string projectRoot = Path.GetDirectoryName(Application.dataPath) ?? string.Empty;
        return Path.Combine(projectRoot, assetPath).Replace("\\", "/");
    }

    private static string BuildObjectPath(Transform target)
    {
        if (target == null)
        {
            return string.Empty;
        }

        string path = target.name;
        Transform current = target.parent;
        while (current != null)
        {
            path = current.name + "/" + path;
            current = current.parent;
        }

        return path;
    }

    private static bool IsUnitScale(Vector3 scale)
    {
        return Mathf.Abs(scale.x - 1f) <= 0.001f &&
               Mathf.Abs(scale.y - 1f) <= 0.001f &&
               Mathf.Abs(scale.z - 1f) <= 0.001f;
    }

    private static float ReadFloat(Material material, string propertyName)
    {
        return material != null && material.HasProperty(propertyName)
            ? material.GetFloat(propertyName)
            : 0f;
    }

    private static float ReadFloat(Material material, int propertyId)
    {
        return material != null && material.HasProperty(propertyId)
            ? material.GetFloat(propertyId)
            : 0f;
    }

    private static float ReadColorAlpha(Material material, string propertyName)
    {
        return material != null && material.HasProperty(propertyName)
            ? material.GetColor(propertyName).a
            : 0f;
    }

    private static void SetFloatIfPresent(Material material, string propertyName, float value)
    {
        if (material != null && material.HasProperty(propertyName))
        {
            material.SetFloat(propertyName, value);
        }
    }

    private static void SetColorIfPresent(Material material, string propertyName, Color value)
    {
        if (material != null && material.HasProperty(propertyName))
        {
            material.SetColor(propertyName, value);
        }
    }

    private static bool HasManagedGameplayTextDescendants(Transform root)
    {
        if (root == null)
        {
            return false;
        }

        TMP_Text[] texts = root.GetComponentsInChildren<TMP_Text>(true);
        for (int i = 0; i < texts.Length; i++)
        {
            TMP_Text label = texts[i];
            if (label == null || !label.gameObject.activeInHierarchy)
            {
                continue;
            }

            return true;
        }

        return false;
    }

    private static Camera FindGameplayCamera(Scene scene)
    {
        Camera taggedMainCamera = Camera.main;
        if (taggedMainCamera != null && taggedMainCamera.gameObject.scene == scene)
        {
            return taggedMainCamera;
        }

        foreach (GameObject root in scene.GetRootGameObjects())
        {
            Camera[] cameras = root.GetComponentsInChildren<Camera>(true);
            for (int i = 0; i < cameras.Length; i++)
            {
                Camera camera = cameras[i];
                if (camera == null || !camera.gameObject.activeInHierarchy)
                {
                    continue;
                }

                if (string.Equals(camera.gameObject.tag, "MainCamera", StringComparison.Ordinal))
                {
                    return camera;
                }
            }
        }

        foreach (GameObject root in scene.GetRootGameObjects())
        {
            Camera[] cameras = root.GetComponentsInChildren<Camera>(true);
            for (int i = 0; i < cameras.Length; i++)
            {
                Camera camera = cameras[i];
                if (camera != null && camera.gameObject.activeInHierarchy)
                {
                    return camera;
                }
            }
        }

        return null;
    }

    private static bool HasHealthyGeneratedTypographyAssets()
    {
        return IsHealthyGameplayFontAsset(ResolveGeneratedFontAsset(CandyTypographyRole.Body), out _) &&
               IsHealthyGameplayFontAsset(ResolveGeneratedFontAsset(CandyTypographyRole.Number), out _) &&
               IsHealthyGameplayFontAsset(ResolveGeneratedFontAsset(CandyTypographyRole.Headline), out _);
    }
}
#endif

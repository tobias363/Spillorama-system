using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

public static class Theme1TextlessControlMigration
{
    private const string Prefix = "[Theme1TextlessControls]";

    private sealed class ControlDefinition
    {
        public ControlDefinition(
            string objectName,
            string spriteAssetPath,
            string labelName,
            string labelText,
            Vector2 anchoredPosition,
            Vector2 sizeDelta,
            float minFontSize,
            float maxFontSize,
            bool allowWrap,
            Vector4 margin,
            float lineSpacing = 0f)
        {
            ObjectName = objectName;
            SpriteAssetPath = spriteAssetPath;
            LabelName = labelName;
            LabelText = labelText;
            AnchoredPosition = anchoredPosition;
            SizeDelta = sizeDelta;
            MinFontSize = minFontSize;
            MaxFontSize = maxFontSize;
            AllowWrap = allowWrap;
            Margin = margin;
            LineSpacing = lineSpacing;
        }

        public string ObjectName { get; }
        public string SpriteAssetPath { get; }
        public string LabelName { get; }
        public string LabelText { get; }
        public Vector2 AnchoredPosition { get; }
        public Vector2 SizeDelta { get; }
        public float MinFontSize { get; }
        public float MaxFontSize { get; }
        public bool AllowWrap { get; }
        public Vector4 Margin { get; }
        public float LineSpacing { get; }
    }

    private static readonly ControlDefinition[] Definitions =
    {
        new(
            "Theme1PlaceBetButton",
            "Assets/Resources/Theme1/Controls/Theme1PlaceBetButtonShell.png",
            "Theme1PlaceBetLabel",
            "Plasser innsats",
            new Vector2(0f, 4f),
            new Vector2(194f, 42f),
            30f,
            48f,
            false,
            new Vector4(10f, 6f, 10f, 4f)),
        new(
            "Theme1StakePanel",
            "Assets/Resources/Theme1/Controls/Theme1StakePanelBase.png",
            "Theme1StakeTitleLabel",
            "Innsats",
            new Vector2(0f, 13f),
            new Vector2(132f, 28f),
            22f,
            34f,
            false,
            new Vector4(8f, 4f, 8f, 2f)),
        new(
            "Theme1SaldoPanel",
            "Assets/Resources/Theme1/Controls/Theme1SaldoPanelBase.png",
            "Theme1SaldoTitleLabel",
            "Saldo",
            new Vector2(0f, 15f),
            new Vector2(104f, 28f),
            22f,
            32f,
            false,
            new Vector4(8f, 4f, 8f, 2f)),
        new(
            "Theme1GevinstPanel",
            "Assets/Resources/Theme1/Controls/Theme1GevinstPanelBase.png",
            "Theme1GevinstTitleLabel",
            "Gevinst",
            new Vector2(0f, 15f),
            new Vector2(118f, 28f),
            22f,
            32f,
            false,
            new Vector4(8f, 4f, 8f, 2f)),
        new(
            "Theme1NextDrawBanner",
            "Assets/Resources/Theme1/Controls/Theme1NextDrawBannerBase.png",
            "Theme1NextDrawTitleLabel",
            "Ny trekning\nstarter om",
            new Vector2(0f, 28f),
            new Vector2(196f, 60f),
            24f,
            38f,
            true,
            new Vector4(10f, 6f, 10f, 4f),
            -8f),
    };

    [MenuItem("Candy/Theme1/Apply Textless Control Migration")]
    public static void ApplyTextlessControlMigrationMenu()
    {
        Scene scene = SceneManager.GetActiveScene();
        if (!scene.IsValid())
        {
            throw new InvalidOperationException($"{Prefix} Ingen aktiv scene er lastet.");
        }

        ApplyToOpenScene(scene, saveScene: true, logSummary: true);
    }

    public static void ApplyToOpenScene(Scene scene, bool saveScene, bool logSummary)
    {
        if (!scene.IsValid())
        {
            throw new InvalidOperationException($"{Prefix} Ugyldig scene.");
        }

        int updatedCount = 0;
        for (int i = 0; i < Definitions.Length; i++)
        {
            ControlDefinition definition = Definitions[i];
            GameObject target = FindInScene(scene, definition.ObjectName);
            if (target == null)
            {
                throw new InvalidOperationException($"{Prefix} Fant ikke '{definition.ObjectName}' i Theme1.");
            }

            updatedCount += ApplySprite(target, definition);
            updatedCount += EnsureLabel(target, definition);
        }

        if (updatedCount > 0)
        {
            EditorSceneManager.MarkSceneDirty(scene);
            if (saveScene)
            {
                EditorSceneManager.SaveScene(scene);
            }
        }

        if (logSummary)
        {
            Debug.Log($"{Prefix} Oppdaterte {updatedCount} textless Theme1 control binding(s).");
        }
    }

    public static bool ValidateOpenScene(Scene scene, out string report)
    {
        StringBuilder builder = new StringBuilder();
        bool isValid = true;

        for (int i = 0; i < Definitions.Length; i++)
        {
            ControlDefinition definition = Definitions[i];
            GameObject target = FindInScene(scene, definition.ObjectName);
            if (target == null)
            {
                builder.AppendLine($"Mangler GameObject '{definition.ObjectName}'.");
                isValid = false;
                continue;
            }

            Image image = target.GetComponent<Image>();
            if (image == null)
            {
                builder.AppendLine($"'{definition.ObjectName}' mangler Image-komponent.");
                isValid = false;
            }
            else
            {
                string spritePath = image.sprite != null ? AssetDatabase.GetAssetPath(image.sprite) : string.Empty;
                if (!string.Equals(spritePath, definition.SpriteAssetPath, StringComparison.Ordinal))
                {
                    builder.AppendLine($"'{definition.ObjectName}' bruker feil sprite. Forventer '{definition.SpriteAssetPath}', fikk '{spritePath}'.");
                    isValid = false;
                }
            }

            Transform labelTransform = target.transform.Find(definition.LabelName);
            TextMeshProUGUI label = labelTransform != null ? labelTransform.GetComponent<TextMeshProUGUI>() : null;
            if (label == null)
            {
                builder.AppendLine($"'{definition.ObjectName}' mangler TMP-label '{definition.LabelName}'.");
                isValid = false;
                continue;
            }

            if (!label.gameObject.activeInHierarchy || !label.enabled)
            {
                builder.AppendLine($"'{definition.LabelName}' er deaktivert.");
                isValid = false;
            }

            if (!string.Equals(label.text, definition.LabelText, StringComparison.Ordinal))
            {
                builder.AppendLine($"'{definition.LabelName}' har feil tekst. Forventer '{definition.LabelText}', fikk '{label.text}'.");
                isValid = false;
            }
        }

        report = isValid
            ? $"{Prefix} OK"
            : $"{Prefix}{Environment.NewLine}{builder}";
        return isValid;
    }

    private static int ApplySprite(GameObject target, ControlDefinition definition)
    {
        Image image = target.GetComponent<Image>();
        if (image == null)
        {
            throw new InvalidOperationException($"{Prefix} '{definition.ObjectName}' mangler Image-komponent.");
        }

        Sprite sprite = LoadSprite(definition.SpriteAssetPath);
        if (sprite == null)
        {
            throw new InvalidOperationException($"{Prefix} Fant ikke sprite '{definition.SpriteAssetPath}'.");
        }

        if (image.sprite == sprite)
        {
            return 0;
        }

        Undo.RecordObject(image, "Apply Theme1 textless control sprite");
        image.sprite = sprite;
        EditorUtility.SetDirty(image);
        return 1;
    }

    private static Sprite LoadSprite(string assetPath)
    {
        Sprite sprite = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
        if (sprite != null)
        {
            return sprite;
        }

        AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceUpdate | ImportAssetOptions.ForceSynchronousImport);
        sprite = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
        if (sprite != null)
        {
            return sprite;
        }

        string resourcePath = ToResourcesPath(assetPath);
        if (!string.IsNullOrWhiteSpace(resourcePath))
        {
            sprite = Resources.Load<Sprite>(resourcePath);
            if (sprite != null)
            {
                return sprite;
            }
        }

        UnityEngine.Object[] assetsAtPath = AssetDatabase.LoadAllAssetsAtPath(assetPath);
        for (int i = 0; i < assetsAtPath.Length; i++)
        {
            if (assetsAtPath[i] is Sprite subAssetSprite)
            {
                return subAssetSprite;
            }
        }

        TextureImporter importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
        if (importer == null)
        {
            return null;
        }

        bool changed = false;
        if (importer.textureType != TextureImporterType.Sprite)
        {
            importer.textureType = TextureImporterType.Sprite;
            changed = true;
        }

        if (importer.spriteImportMode != SpriteImportMode.Single)
        {
            importer.spriteImportMode = SpriteImportMode.Single;
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

        if (importer.mipmapEnabled)
        {
            importer.mipmapEnabled = false;
            changed = true;
        }

        if (importer.streamingMipmaps)
        {
            importer.streamingMipmaps = false;
            changed = true;
        }

        if (!importer.alphaIsTransparency)
        {
            importer.alphaIsTransparency = true;
            changed = true;
        }

        if (importer.maxTextureSize < 4096)
        {
            importer.maxTextureSize = 4096;
            changed = true;
        }

        if (importer.filterMode != FilterMode.Bilinear)
        {
            importer.filterMode = FilterMode.Bilinear;
            changed = true;
        }

        if (changed)
        {
            importer.SaveAndReimport();
        }

        sprite = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
        if (sprite != null)
        {
            return sprite;
        }

        assetsAtPath = AssetDatabase.LoadAllAssetsAtPath(assetPath);
        for (int i = 0; i < assetsAtPath.Length; i++)
        {
            if (assetsAtPath[i] is Sprite subAssetSprite)
            {
                return subAssetSprite;
            }
        }

        return null;
    }

    private static string ToResourcesPath(string assetPath)
    {
        if (string.IsNullOrWhiteSpace(assetPath))
        {
            return string.Empty;
        }

        const string resourcesMarker = "Assets/Resources/";
        if (!assetPath.StartsWith(resourcesMarker, StringComparison.Ordinal))
        {
            return string.Empty;
        }

        string relativePath = assetPath.Substring(resourcesMarker.Length);
        return Path.ChangeExtension(relativePath, null)?.Replace('\\', '/');
    }

    private static int EnsureLabel(GameObject target, ControlDefinition definition)
    {
        Transform existingTransform = target.transform.Find(definition.LabelName);
        TextMeshProUGUI label = existingTransform != null ? existingTransform.GetComponent<TextMeshProUGUI>() : null;
        int updatedCount = 0;

        if (existingTransform == null)
        {
            GameObject labelObject = new GameObject(definition.LabelName, typeof(RectTransform));
            Undo.RegisterCreatedObjectUndo(labelObject, "Create Theme1 textless control label");
            Undo.SetTransformParent(labelObject.transform, target.transform, "Parent Theme1 textless control label");
            label = Undo.AddComponent<TextMeshProUGUI>(labelObject);
            existingTransform = labelObject.transform;
            updatedCount++;
        }
        else if (label == null)
        {
            label = Undo.AddComponent<TextMeshProUGUI>(existingTransform.gameObject);
            updatedCount++;
        }

        RectTransform rect = existingTransform as RectTransform;
        if (rect == null)
        {
            throw new InvalidOperationException($"{Prefix} '{definition.LabelName}' mangler RectTransform.");
        }

        Undo.RecordObject(rect, "Layout Theme1 textless control label");
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.localScale = Vector3.one;
        rect.localRotation = Quaternion.identity;
        rect.anchoredPosition = definition.AnchoredPosition;
        rect.sizeDelta = definition.SizeDelta;
        rect.SetAsLastSibling();

        Undo.RecordObject(label, "Style Theme1 textless control label");
        label.gameObject.SetActive(true);
        label.enabled = true;
        label.raycastTarget = false;
        label.text = definition.LabelText;
        label.color = Color.white;
        label.alpha = 1f;
        label.enableAutoSizing = true;
        label.fontSizeMin = definition.MinFontSize;
        label.fontSizeMax = definition.MaxFontSize;
        label.fontSize = definition.MaxFontSize;
        label.textWrappingMode = definition.AllowWrap ? TextWrappingModes.Normal : TextWrappingModes.NoWrap;
        label.overflowMode = TextOverflowModes.Overflow;
        label.alignment = TextAlignmentOptions.Center;
        label.extraPadding = true;
        label.margin = definition.Margin;
        label.lineSpacing = definition.LineSpacing;
        Theme1BongTypography.ApplyPrizeLabel(label);
        EditorUtility.SetDirty(rect);
        EditorUtility.SetDirty(label);

        return updatedCount + 1;
    }

    private static GameObject FindInScene(Scene scene, string objectName)
    {
        if (!scene.IsValid())
        {
            return null;
        }

        GameObject[] roots = scene.GetRootGameObjects();
        for (int i = 0; i < roots.Length; i++)
        {
            Transform match = FindRecursive(roots[i].transform, objectName);
            if (match != null)
            {
                return match.gameObject;
            }
        }

        return null;
    }

    private static Transform FindRecursive(Transform root, string objectName)
    {
        if (root == null)
        {
            return null;
        }

        if (string.Equals(root.name, objectName, StringComparison.Ordinal))
        {
            return root;
        }

        for (int i = 0; i < root.childCount; i++)
        {
            Transform match = FindRecursive(root.GetChild(i), objectName);
            if (match != null)
            {
                return match;
            }
        }

        return null;
    }
}

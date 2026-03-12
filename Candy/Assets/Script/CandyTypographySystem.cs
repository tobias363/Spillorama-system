using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TextCore.LowLevel;

public enum CandyTypographyRole
{
    Body,
    Label,
    Number,
    Headline
}

public static class CandyTypographySystem
{
    public const string PreferredGameplayShaderName = "TextMeshPro/Distance Field";
    public const string MobileGameplayShaderName = "TextMeshPro/Mobile/Distance Field";
    public const string BitmapShaderName = "TextMeshPro/Bitmap";
    public const string MobileBitmapShaderName = "TextMeshPro/Mobile/Bitmap";
    public const float MinimumGameplayCameraCanvasDynamicPixelsPerUnit = 8f;

    private const string RegularFontResourcePath = "CandyTypography/Fredoka/Fredoka-Regular";
    private const string SemiBoldFontResourcePath = "CandyTypography/Fredoka/Fredoka-SemiBold";
    private const string BoldFontResourcePath = "CandyTypography/Fredoka/Fredoka-Bold";

    private const string RegularTmpResourcePath = "CandyTypography/TMP/CandyFredokaRegularSDF";
    private const string SemiBoldTmpResourcePath = "CandyTypography/TMP/CandyFredokaSemiBoldSDF";
    private const string BoldTmpResourcePath = "CandyTypography/TMP/CandyFredokaBoldSDF";

    private static readonly string[] GameplaySceneNames =
    {
        "Theme1",
        "Theme2",
        "Bonus"
    };

    private static readonly string[] HeadlineKeywords =
    {
        "jackpot",
        "bonus",
        "title",
        "header",
        "logo",
        "topper",
        "prize",
        "collect",
        "winner"
    };

    private static readonly string[] NumberKeywords =
    {
        "card",
        "ball",
        "number",
        "bet",
        "credit",
        "win",
        "winning",
        "timer",
        "countdown",
        "room",
        "player",
        "spin",
        "extra",
        "missing",
        "payout",
        "deposit",
        "exit"
    };

    private static readonly Dictionary<CandyTypographyRole, TMP_FontAsset> CachedFonts = new();
    private static readonly Dictionary<CandyTypographyRole, Font> CachedSourceFonts = new();
    private static readonly Dictionary<string, Material> CachedGameplayMaterials = new();
    private static readonly string CommonCharacters =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
        ".,:;!?%+-_=()[]{}<>/\\|@#$&*'\" " +
        "æøåÆØÅ€£$krKRNeste rundeSpillere i rommetBONUSWINJACKPOT";

    public static bool IsGameplayScene(Scene scene)
    {
        if (!scene.IsValid())
        {
            return false;
        }

        string sceneName = scene.name ?? string.Empty;
        for (int i = 0; i < GameplaySceneNames.Length; i++)
        {
            if (string.Equals(sceneName, GameplaySceneNames[i], StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    public static TMP_FontAsset GetFont(CandyTypographyRole role)
    {
        if (CachedFonts.TryGetValue(role, out TMP_FontAsset cached) && IsFontAssetUsable(cached))
        {
            return cached;
        }

        TMP_FontAsset persistent = Resources.Load<TMP_FontAsset>(GetTmpResourcePath(role));
        TryPrimeFontAsset(persistent);
        if (IsFontAssetUsable(persistent))
        {
            EnsureRuntimeMaterial(persistent);
            EnsureFallbacks(persistent);
            CachedFonts[role] = persistent;
            return persistent;
        }

        Font sourceFont = GetSourceFont(role);
        if (sourceFont == null)
        {
            TMP_FontAsset fallback = ResolveSafeFallbackFontAsset();
            if (fallback != null)
            {
                CachedFonts[role] = fallback;
            }

            return fallback;
        }

        TMP_FontAsset generated = TMP_FontAsset.CreateFontAsset(
            sourceFont,
            GetSamplingPointSize(role),
            8,
            GlyphRenderMode.SDFAA,
            GetAtlasSize(role),
            GetAtlasSize(role),
            AtlasPopulationMode.Dynamic,
            true);

        if (generated == null)
        {
            TMP_FontAsset fallback = ResolveSafeFallbackFontAsset();
            if (fallback != null)
            {
                CachedFonts[role] = fallback;
            }

            return fallback;
        }

        generated.name = "Runtime " + GetTmpAssetName(role);
        EnsureFallbacks(generated);
        TryPrimeFontAsset(generated);
        if (IsFontAssetUsable(generated))
        {
            CachedFonts[role] = generated;
            return generated;
        }

        TMP_FontAsset safeFallback = ResolveSafeFallbackFontAsset();
        if (safeFallback != null)
        {
            CachedFonts[role] = safeFallback;
        }

        return safeFallback;
    }

    public static void ApplyRole(TMP_Text target, CandyTypographyRole role, bool preserveColor = true)
    {
        if (target == null)
        {
            return;
        }

        TMP_FontAsset fontAsset = GetFont(role);
        if (fontAsset == null)
        {
            return;
        }

        Color existingColor = target.color;
        bool wasWrapping = target.enableWordWrapping;
        float currentSize = target.fontSize;
        bool wasAutoSizing = target.enableAutoSizing;

        bool styleChanged = false;
        if (target.font != fontAsset)
        {
            target.font = fontAsset;
            styleChanged = true;
        }
        Material sharedMaterial = ResolveDefaultSharedMaterial(fontAsset);
        if (sharedMaterial != null && target.fontSharedMaterial != sharedMaterial)
        {
            target.fontSharedMaterial = sharedMaterial;
            styleChanged = true;
        }

        FontWeight resolvedWeight = ResolveWeight(role);
        if (target.fontStyle != FontStyles.Normal)
        {
            target.fontStyle = FontStyles.Normal;
            styleChanged = true;
        }

        if (target.fontWeight != resolvedWeight)
        {
            target.fontWeight = resolvedWeight;
            styleChanged = true;
        }

        bool enableWrapping = role == CandyTypographyRole.Body && wasWrapping;
        if (target.enableWordWrapping != enableWrapping)
        {
            target.enableWordWrapping = enableWrapping;
            styleChanged = true;
        }

        TextWrappingModes wrappingMode = role == CandyTypographyRole.Body
            ? TextWrappingModes.Normal
            : TextWrappingModes.NoWrap;
        if (target.textWrappingMode != wrappingMode)
        {
            target.textWrappingMode = wrappingMode;
            styleChanged = true;
        }

        TextOverflowModes overflowMode = role == CandyTypographyRole.Body
            ? TextOverflowModes.Overflow
            : TextOverflowModes.Overflow;
        if (target.overflowMode != overflowMode)
        {
            target.overflowMode = overflowMode;
            styleChanged = true;
        }

        if (target.enableAutoSizing != wasAutoSizing)
        {
            target.enableAutoSizing = wasAutoSizing;
            styleChanged = true;
        }

        ApplyRoleSizeBounds(target, role, currentSize);

        if (preserveColor && target.color != existingColor)
        {
            target.color = existingColor;
            styleChanged = true;
        }

        if (styleChanged)
        {
            target.havePropertiesChanged = true;
            target.UpdateMeshPadding();
            target.SetVerticesDirty();
            target.SetMaterialDirty();
            target.SetLayoutDirty();
        }
    }

    public static void ApplyGameplayRole(
        TMP_Text target,
        CandyTypographyRole role,
        GameplayTextSurface surface,
        bool preserveColor = true,
        bool preserveExistingFont = false)
    {
        if (target == null)
        {
            return;
        }

        TMP_FontAsset resolvedFont = preserveExistingFont && IsFontAssetUsable(target.font)
            ? target.font
            : GetFont(role);
        if (resolvedFont == null)
        {
            return;
        }

        Color existingColor = target.color;
        bool wasWrapping = target.enableWordWrapping;
        float currentSize = target.fontSize;
        bool wasAutoSizing = target.enableAutoSizing;

        bool styleChanged = false;
        if (!preserveExistingFont || target.font == null || !IsFontAssetUsable(target.font))
        {
            if (target.font != resolvedFont)
            {
                target.font = resolvedFont;
                styleChanged = true;
            }
        }

        Material sharedMaterial = GetGameplaySharedMaterial(target.font != null ? target.font : resolvedFont, surface);
        if (sharedMaterial != null && target.fontSharedMaterial != sharedMaterial)
        {
            target.fontSharedMaterial = sharedMaterial;
            styleChanged = true;
        }

        if (target.fontStyle != FontStyles.Normal)
        {
            target.fontStyle = FontStyles.Normal;
            styleChanged = true;
        }

        FontWeight resolvedWeight = ResolveWeight(role);
        if (target.fontWeight != resolvedWeight)
        {
            target.fontWeight = resolvedWeight;
            styleChanged = true;
        }

        bool enableWrapping = role == CandyTypographyRole.Body && wasWrapping;
        if (target.enableWordWrapping != enableWrapping)
        {
            target.enableWordWrapping = enableWrapping;
            styleChanged = true;
        }

        TextWrappingModes wrappingMode = role == CandyTypographyRole.Body
            ? TextWrappingModes.Normal
            : TextWrappingModes.NoWrap;
        if (target.textWrappingMode != wrappingMode)
        {
            target.textWrappingMode = wrappingMode;
            styleChanged = true;
        }

        if (target.overflowMode != TextOverflowModes.Overflow)
        {
            target.overflowMode = TextOverflowModes.Overflow;
            styleChanged = true;
        }

        if (target.enableAutoSizing != wasAutoSizing)
        {
            target.enableAutoSizing = wasAutoSizing;
            styleChanged = true;
        }
        ApplyRoleSizeBounds(target, role, currentSize);

        if (preserveColor && target.color != existingColor)
        {
            target.color = existingColor;
            styleChanged = true;
        }

        if (styleChanged)
        {
            target.havePropertiesChanged = true;
            target.UpdateMeshPadding();
            target.SetVerticesDirty();
            target.SetMaterialDirty();
            target.SetLayoutDirty();
        }
    }

    public static Material GetGameplaySharedMaterial(TMP_FontAsset fontAsset, GameplayTextSurface surface)
    {
        if (fontAsset == null)
        {
            return null;
        }

        EnsureRuntimeMaterial(fontAsset);
        Material sourceMaterial = fontAsset.material;
        if (sourceMaterial == null)
        {
            return null;
        }

        if (!Application.isPlaying)
        {
            SanitizeGameplayMaterial(sourceMaterial, fontAsset);
            return sourceMaterial;
        }

        string cacheKey = fontAsset.GetInstanceID() + ":" + (int)surface;
        if (!CachedGameplayMaterials.TryGetValue(cacheKey, out Material runtimeMaterial) ||
            runtimeMaterial == null)
        {
            runtimeMaterial = new Material(sourceMaterial)
            {
                name = sourceMaterial.name + " (Gameplay " + surface + ")"
            };
            CachedGameplayMaterials[cacheKey] = runtimeMaterial;
        }

        SyncMaterialAtlas(runtimeMaterial, fontAsset);
        SanitizeGameplayMaterial(runtimeMaterial, fontAsset);
        return runtimeMaterial;
    }

    public static Shader ResolvePreferredGameplayShader()
    {
        return Shader.Find(PreferredGameplayShaderName) ??
               Shader.Find(MobileGameplayShaderName);
    }

    public static bool IsPreferredGameplayShader(Shader shader)
    {
        return shader != null &&
               string.Equals(shader.name, PreferredGameplayShaderName, StringComparison.Ordinal);
    }

    public static bool IsForbiddenGameplayShader(Shader shader, out string details)
    {
        details = string.Empty;
        if (shader == null)
        {
            details = "shader=null";
            return true;
        }

        string shaderName = shader.name ?? string.Empty;
        if (string.Equals(shaderName, PreferredGameplayShaderName, StringComparison.Ordinal))
        {
            return false;
        }

        if (shaderName.IndexOf("Bitmap", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            details = "bitmap shader " + shaderName;
            return true;
        }

        if (shaderName.IndexOf("Mobile", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            details = "mobile shader " + shaderName;
            return true;
        }

        details = "unexpected shader " + shaderName;
        return true;
    }

    public static CandyTypographyRole Classify(TMP_Text target)
    {
        if (target == null)
        {
            return CandyTypographyRole.Body;
        }

        string objectPath = BuildObjectPath(target.transform).ToLowerInvariant();
        string currentFontName = target.font != null ? target.font.name.ToLowerInvariant() : string.Empty;
        string value = target.text != null ? target.text.ToLowerInvariant() : string.Empty;
        float size = Mathf.Max(target.fontSize, target.fontSizeMax);

        if (ContainsAny(currentFontName, "impact", "impacted") ||
            ContainsAny(objectPath, HeadlineKeywords) ||
            size >= 42f)
        {
            return CandyTypographyRole.Headline;
        }

        if (ContainsAny(currentFontName, "fredokaone", "oswald", "roboto-bold") ||
            ContainsAny(objectPath, NumberKeywords) ||
            ContainsAny(value, "jackpot", "bonus", "win", "bet", "credit", "kr", "€") ||
            LooksNumeric(value) ||
            size >= 22f)
        {
            return CandyTypographyRole.Number;
        }

        if (ContainsAny(objectPath, "button", "btn", "label", "rules", "play", "auto", "collect"))
        {
            return CandyTypographyRole.Label;
        }

        return CandyTypographyRole.Body;
    }

    public static int ApplyToScene(Scene scene)
    {
        if (!IsGameplayScene(scene))
        {
            return 0;
        }

        int updatedCount = 0;
        GameObject[] roots = scene.GetRootGameObjects();
        for (int i = 0; i < roots.Length; i++)
        {
            TMP_Text[] texts = roots[i].GetComponentsInChildren<TMP_Text>(true);
            for (int j = 0; j < texts.Length; j++)
            {
                TMP_Text text = texts[j];
                if (text == null)
                {
                    continue;
                }

                if (Theme1ManagedTypographyRegistry.Contains(text))
                {
                    continue;
                }

                if (Theme1ManagedTypographyRegistry.BelongsToTheme1Presentation(text))
                {
                    continue;
                }

                ApplyGameplayRole(text, Classify(text), RealtimeTextStyleUtils.ClassifyGameplaySurface(text));
                updatedCount += 1;
            }
        }

        return updatedCount;
    }

    public static void ClearCaches()
    {
        CachedFonts.Clear();
        CachedSourceFonts.Clear();
        foreach (KeyValuePair<string, Material> entry in CachedGameplayMaterials)
        {
            if (entry.Value == null)
            {
                continue;
            }

            if (Application.isPlaying)
            {
                UnityEngine.Object.Destroy(entry.Value);
            }
            else
            {
                UnityEngine.Object.DestroyImmediate(entry.Value);
            }
        }

        CachedGameplayMaterials.Clear();
    }

    public static string GetTmpAssetName(CandyTypographyRole role)
    {
        return role switch
        {
            CandyTypographyRole.Headline => "CandyFredokaBoldSDF",
            CandyTypographyRole.Number => "CandyFredokaSemiBoldSDF",
            CandyTypographyRole.Label => "CandyFredokaSemiBoldSDF",
            _ => "CandyFredokaRegularSDF"
        };
    }

    private static string GetTmpResourcePath(CandyTypographyRole role)
    {
        return role switch
        {
            CandyTypographyRole.Headline => BoldTmpResourcePath,
            CandyTypographyRole.Number => SemiBoldTmpResourcePath,
            CandyTypographyRole.Label => SemiBoldTmpResourcePath,
            _ => RegularTmpResourcePath
        };
    }

    private static Font GetSourceFont(CandyTypographyRole role)
    {
        if (CachedSourceFonts.TryGetValue(role, out Font cached) && cached != null)
        {
            return cached;
        }

        string resourcePath = role switch
        {
            CandyTypographyRole.Headline => BoldFontResourcePath,
            CandyTypographyRole.Number => SemiBoldFontResourcePath,
            CandyTypographyRole.Label => SemiBoldFontResourcePath,
            _ => RegularFontResourcePath
        };

        Font font = Resources.Load<Font>(resourcePath);
        if (font != null)
        {
            CachedSourceFonts[role] = font;
        }

        return font;
    }

    private static int GetSamplingPointSize(CandyTypographyRole role)
    {
        return role switch
        {
            CandyTypographyRole.Headline => 120,
            CandyTypographyRole.Number => 112,
            CandyTypographyRole.Label => 144,
            _ => 96
        };
    }

    private static int GetAtlasSize(CandyTypographyRole role)
    {
        return role switch
        {
            CandyTypographyRole.Headline => 4096,
            CandyTypographyRole.Number => 4096,
            CandyTypographyRole.Label => 4096,
            _ => 2048
        };
    }

    private static FontWeight ResolveWeight(CandyTypographyRole role)
    {
        return role switch
        {
            CandyTypographyRole.Headline => FontWeight.Bold,
            CandyTypographyRole.Number => FontWeight.SemiBold,
            CandyTypographyRole.Label => FontWeight.SemiBold,
            _ => FontWeight.Regular
        };
    }

    private static void ApplyRoleSizeBounds(TMP_Text target, CandyTypographyRole role, float currentSize)
    {
        float safeCurrentSize = Mathf.Max(10f, currentSize);
        switch (role)
        {
            case CandyTypographyRole.Headline:
                target.fontSize = safeCurrentSize;
                target.fontSizeMin = Mathf.Max(20f, Mathf.Min(safeCurrentSize, 30f));
                target.fontSizeMax = Mathf.Max(target.fontSizeMin + 8f, 120f);
                break;
            case CandyTypographyRole.Number:
                target.fontSize = safeCurrentSize;
                target.fontSizeMin = Mathf.Max(14f, Mathf.Min(safeCurrentSize, 22f));
                target.fontSizeMax = Mathf.Max(target.fontSizeMin + 8f, 72f);
                break;
            case CandyTypographyRole.Label:
                target.fontSize = safeCurrentSize;
                target.fontSizeMin = Mathf.Max(16f, Mathf.Min(safeCurrentSize, 24f));
                target.fontSizeMax = Mathf.Max(target.fontSizeMin + 8f, 72f);
                break;
            default:
                target.fontSize = safeCurrentSize;
                target.fontSizeMin = Mathf.Max(10f, Mathf.Min(safeCurrentSize, 16f));
                target.fontSizeMax = Mathf.Max(target.fontSizeMin + 8f, 40f);
                break;
        }
    }

    private static void TryAddCommonCharacters(TMP_FontAsset fontAsset)
    {
        if (fontAsset == null)
        {
            return;
        }

        if (fontAsset.atlasPopulationMode == AtlasPopulationMode.Static)
        {
            return;
        }

        try
        {
            fontAsset.TryAddCharacters(CommonCharacters, out _, true);
        }
        catch
        {
        }
    }

    private static void TryPrimeFontAsset(TMP_FontAsset fontAsset)
    {
        if (fontAsset == null)
        {
            return;
        }

        TryAddCommonCharacters(fontAsset);
        EnsureRuntimeMaterial(fontAsset);
    }

    private static void EnsureFallbacks(TMP_FontAsset fontAsset)
    {
        if (fontAsset == null)
        {
            return;
        }

        TMP_FontAsset fallback = ResolveSafeFallbackFontAsset();

        if (fallback == null || fallback == fontAsset)
        {
            return;
        }

        fontAsset.fallbackFontAssetTable ??= new List<TMP_FontAsset>();
        if (!fontAsset.fallbackFontAssetTable.Contains(fallback))
        {
            fontAsset.fallbackFontAssetTable.Add(fallback);
        }
    }

    private static Material ResolveDefaultSharedMaterial(TMP_FontAsset fontAsset)
    {
        if (fontAsset == null)
        {
            return null;
        }

        EnsureRuntimeMaterial(fontAsset);
        Material material = fontAsset.material;
        if (material != null)
        {
            SanitizeGameplayMaterial(material, fontAsset);
        }

        return material;
    }

    private static void EnsureRuntimeMaterial(TMP_FontAsset fontAsset)
    {
        if (fontAsset == null || !TryGetAtlasTexture(fontAsset, out Texture2D atlasTexture))
        {
            return;
        }

        ShaderUtilities.GetShaderPropertyIDs();
        Shader preferredShader = ResolvePreferredGameplayShader();
        Material material = fontAsset.material;
        if (material == null)
        {
            if (preferredShader == null)
            {
                return;
            }

            material = new Material(preferredShader)
            {
                name = fontAsset.name + " Material"
            };
            fontAsset.material = material;
        }
        else if (preferredShader != null && material.shader != preferredShader)
        {
            material.shader = preferredShader;
        }

        SyncMaterialAtlas(material, fontAsset);
        SanitizeGameplayMaterial(material, fontAsset);
    }

    private static TMP_FontAsset ResolveSafeFallbackFontAsset()
    {
        TMP_FontAsset liberationSans = Resources.Load<TMP_FontAsset>("Fonts _ Materials/LiberationSans SDF");
        if (IsFontAssetUsable(liberationSans))
        {
            return liberationSans;
        }

        TMP_FontAsset liberationSansFallback = Resources.Load<TMP_FontAsset>("Fonts _ Materials/LiberationSans SDF - Fallback");
        if (IsFontAssetUsable(liberationSansFallback))
        {
            return liberationSansFallback;
        }

        return IsFontAssetUsable(TMP_Settings.defaultFontAsset) ? TMP_Settings.defaultFontAsset : null;
    }

    private static bool IsFontAssetUsable(TMP_FontAsset fontAsset)
    {
        if (!TryGetAtlasTexture(fontAsset, out Texture2D atlasTexture))
        {
            return false;
        }

        if (atlasTexture.width <= 1 || atlasTexture.height <= 1)
        {
            return false;
        }

        try
        {
            int glyphCount = fontAsset.glyphTable != null ? fontAsset.glyphTable.Count : 0;
            int characterCount = fontAsset.characterTable != null ? fontAsset.characterTable.Count : 0;
            return glyphCount > 0 || characterCount > 0;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static bool TryGetAtlasTexture(TMP_FontAsset fontAsset, out Texture2D atlasTexture)
    {
        atlasTexture = null;
        if (fontAsset == null)
        {
            return false;
        }

        try
        {
            atlasTexture = fontAsset.atlasTexture;
            return atlasTexture != null;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static void SyncMaterialAtlas(Material material, TMP_FontAsset fontAsset)
    {
        if (material == null || !TryGetAtlasTexture(fontAsset, out Texture2D atlasTexture))
        {
            return;
        }

        if (material.HasProperty(ShaderUtilities.ID_MainTex))
        {
            material.SetTexture(ShaderUtilities.ID_MainTex, atlasTexture);
        }

        if (material.HasProperty(ShaderUtilities.ID_TextureWidth))
        {
            material.SetFloat(ShaderUtilities.ID_TextureWidth, atlasTexture.width);
        }

        if (material.HasProperty(ShaderUtilities.ID_TextureHeight))
        {
            material.SetFloat(ShaderUtilities.ID_TextureHeight, atlasTexture.height);
        }

        if (material.HasProperty(ShaderUtilities.ID_GradientScale))
        {
            material.SetFloat(ShaderUtilities.ID_GradientScale, Mathf.Max(5f, material.GetFloat(ShaderUtilities.ID_GradientScale)));
        }

        if (material.HasProperty(ShaderUtilities.ID_WeightNormal))
        {
            material.SetFloat(ShaderUtilities.ID_WeightNormal, fontAsset.normalStyle);
        }

        if (material.HasProperty(ShaderUtilities.ID_WeightBold))
        {
            material.SetFloat(ShaderUtilities.ID_WeightBold, fontAsset.boldStyle);
        }
    }

    private static void SanitizeGameplayMaterial(Material material, TMP_FontAsset fontAsset)
    {
        if (material == null)
        {
            return;
        }

        Shader preferredShader = ResolvePreferredGameplayShader();
        if (preferredShader != null && material.shader != preferredShader)
        {
            material.shader = preferredShader;
        }

        DisableKeyword(material, "UNDERLAY_ON");
        DisableKeyword(material, "UNDERLAY_INNER");
        DisableKeyword(material, "OUTLINE_ON");
        DisableKeyword(material, "GLOW_ON");
        DisableKeyword(material, "BEVEL_ON");

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

        SyncMaterialAtlas(material, fontAsset);
    }

    private static void DisableKeyword(Material material, string keyword)
    {
        if (material == null || string.IsNullOrWhiteSpace(keyword))
        {
            return;
        }

        material.DisableKeyword(keyword);
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

    private static bool ContainsAny(string value, params string[] needles)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        for (int i = 0; i < needles.Length; i++)
        {
            if (value.IndexOf(needles[i], StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return true;
            }
        }

        return false;
    }

    private static bool LooksNumeric(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        int digitCount = 0;
        for (int i = 0; i < value.Length; i++)
        {
            if (char.IsDigit(value[i]))
            {
                digitCount += 1;
            }
        }

        return digitCount >= 1 && digitCount >= value.Length / 2;
    }
}

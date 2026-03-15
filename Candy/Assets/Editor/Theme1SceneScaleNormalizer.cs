using System;
using System.Collections.Generic;
using System.Text;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

internal static class Theme1SceneScaleNormalizer
{
    private const string Prefix = "[Theme1Scale]";
    private static readonly string[] CriticalRootNames =
    {
        "Card_1",
        "Card_2",
        "Card_3",
        "Card_4",
        "Theme1ProductionRoot",
        "Theme1SaldoPanel",
        "Theme1GevinstPanel",
        "Theme1ShuffleButton",
        "Theme1StakePanel",
        "Theme1PlaceBetButton",
        "Theme1NextDrawBanner"
    };

    public static void ApplyPolicy(Scene scene, Theme1GameplayViewRoot viewRoot, bool logSummary)
    {
        if (!scene.IsValid())
        {
            return;
        }

        HashSet<int> normalizedIds = new HashSet<int>();
        int updatedCount = 0;
        List<RectTransform> roots = ResolveCriticalRoots(scene, viewRoot);
        for (int i = 0; i < roots.Count; i++)
        {
            updatedCount += NormalizeRectHierarchy(roots[i], normalizedIds);
        }

        if (logSummary)
        {
            Debug.Log($"{Prefix} Normaliserte {updatedCount} Theme1 rect transforms til unit scale.");
        }
    }

    public static bool ValidatePolicy(Scene scene, Theme1GameplayViewRoot viewRoot, out string report)
    {
        if (!scene.IsValid())
        {
            report = $"{Prefix} Scene er ugyldig.";
            return false;
        }

        StringBuilder builder = new StringBuilder();
        bool isValid = true;

        List<RectTransform> roots = ResolveCriticalRoots(scene, viewRoot);
        HashSet<int> visited = new HashSet<int>();
        for (int i = 0; i < roots.Count; i++)
        {
            RectTransform root = roots[i];
            if (root == null || !visited.Add(root.GetInstanceID()))
            {
                continue;
            }

            ValidateRectHierarchy(root, builder, ref isValid);
        }

        report = isValid
            ? $"{Prefix} OK"
            : $"{Prefix}{Environment.NewLine}{builder}";
        return isValid;
    }

    private static List<RectTransform> ResolveCriticalRoots(Scene scene, Theme1GameplayViewRoot viewRoot)
    {
        List<RectTransform> roots = new List<RectTransform>();
        for (int i = 0; i < CriticalRootNames.Length; i++)
        {
            RectTransform rect = FindSceneRectTransform(scene, CriticalRootNames[i]);
            if (rect != null)
            {
                roots.Add(rect);
            }
        }

        if (viewRoot != null)
        {
            AddViewRootTargets(roots, viewRoot);
        }

        return roots;
    }

    private static void AddViewRootTargets(ICollection<RectTransform> roots, Theme1GameplayViewRoot viewRoot)
    {
        if (viewRoot == null)
        {
            return;
        }

        Theme1BallRackView ballRack = viewRoot.BallRack;
        if (ballRack != null)
        {
            AddRect(roots, ballRack.BigBallImage != null ? ballRack.BigBallImage.rectTransform : null);
            if (ballRack.Slots != null)
            {
                for (int i = 0; i < ballRack.Slots.Length; i++)
                {
                    Theme1BallSlotView slot = ballRack.Slots[i];
                    AddRect(roots, slot?.Root != null ? slot.Root.transform as RectTransform : null);
                    AddRect(roots, slot?.SpriteTarget != null ? slot.SpriteTarget.rectTransform : null);
                }
            }
        }

        List<TMP_Text> textTargets = new List<TMP_Text>();
        viewRoot.CollectTextTargets(textTargets);
        for (int i = 0; i < textTargets.Count; i++)
        {
            AddRect(roots, textTargets[i] != null ? textTargets[i].rectTransform : null);
        }
    }

    private static void AddRect(ICollection<RectTransform> roots, RectTransform rect)
    {
        if (rect != null)
        {
            roots.Add(rect);
        }
    }

    private static RectTransform FindSceneRectTransform(Scene scene, string name)
    {
        if (!scene.IsValid() || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        RectTransform[] rects = UnityEngine.Object.FindObjectsByType<RectTransform>(
            FindObjectsInactive.Include,
            FindObjectsSortMode.None);
        for (int i = 0; i < rects.Length; i++)
        {
            RectTransform rect = rects[i];
            if (rect == null || rect.gameObject.scene != scene)
            {
                continue;
            }

            if (string.Equals(rect.gameObject.name, name, StringComparison.Ordinal))
            {
                return rect;
            }
        }

        return null;
    }

    private static int NormalizeRectHierarchy(RectTransform root, HashSet<int> normalizedIds)
    {
        if (root == null || !normalizedIds.Add(root.GetInstanceID()))
        {
            return 0;
        }

        int updatedCount = 0;
        updatedCount += NormalizeSelfScale(root);
        for (int i = 0; i < root.childCount; i++)
        {
            if (root.GetChild(i) is RectTransform child)
            {
                updatedCount += NormalizeRectHierarchy(child, normalizedIds);
            }
        }

        return updatedCount;
    }

    private static int NormalizeSelfScale(RectTransform rect)
    {
        if (rect == null || IsUnitScale(rect.localScale))
        {
            return 0;
        }

        Vector3 originalScale = rect.localScale;
        if (ShouldResetDirectly(rect))
        {
            Undo.RecordObject(rect, "Reset Theme1 Root Rect Scale");
            rect.localScale = Vector3.one;
            EditorUtility.SetDirty(rect);
            return 1;
        }

        Vector2 scale2 = new Vector2(Mathf.Abs(originalScale.x), Mathf.Abs(originalScale.y));
        int updatedCount = 0;

        if (HasOwnVisual(rect))
        {
            Undo.RecordObject(rect, "Normalize Theme1 Rect Scale");
            if (HasStretchAnchors(rect))
            {
                rect.offsetMin = Vector2.Scale(rect.offsetMin, scale2);
                rect.offsetMax = Vector2.Scale(rect.offsetMax, scale2);
            }
            else
            {
                rect.sizeDelta = Vector2.Scale(rect.sizeDelta, scale2);
            }
            EditorUtility.SetDirty(rect);
            updatedCount += 1;
        }

        for (int i = 0; i < rect.childCount; i++)
        {
            if (rect.GetChild(i) is not RectTransform child)
            {
                continue;
            }

            Undo.RecordObject(child, "Normalize Theme1 Child Scale");
            child.anchoredPosition3D = new Vector3(
                child.anchoredPosition3D.x * originalScale.x,
                child.anchoredPosition3D.y * originalScale.y,
                child.anchoredPosition3D.z * originalScale.z);

            if (HasStretchAnchors(child))
            {
                child.offsetMin = Vector2.Scale(child.offsetMin, scale2);
                child.offsetMax = Vector2.Scale(child.offsetMax, scale2);
            }
            else
            {
                child.sizeDelta = Vector2.Scale(child.sizeDelta, scale2);
            }

            child.localScale = Vector3.Scale(child.localScale, originalScale);
            EditorUtility.SetDirty(child);
            updatedCount += 1;
        }

        Undo.RecordObject(rect, "Normalize Theme1 Rect Scale");
        rect.localScale = Vector3.one;
        EditorUtility.SetDirty(rect);
        updatedCount += 1;
        return updatedCount;
    }

    private static bool ShouldResetDirectly(RectTransform rect)
    {
        return rect != null &&
               rect.parent == null &&
               rect.GetComponent<Canvas>() != null;
    }

    private static void ValidateRectHierarchy(RectTransform root, StringBuilder builder, ref bool isValid)
    {
        if (root == null)
        {
            return;
        }

        if (!IsUnitScale(root.localScale))
        {
            builder.AppendLine($"{BuildObjectPath(root)} har non-unit localScale {root.localScale}.");
            isValid = false;
        }

        for (int i = 0; i < root.childCount; i++)
        {
            if (root.GetChild(i) is RectTransform child)
            {
                ValidateRectHierarchy(child, builder, ref isValid);
            }
        }
    }

    private static bool HasOwnVisual(RectTransform rect)
    {
        return rect != null &&
               (rect.GetComponent<Graphic>() != null ||
                rect.GetComponent<TMP_Text>() != null);
    }

    private static bool HasStretchAnchors(RectTransform rect)
    {
        if (rect == null)
        {
            return false;
        }

        return Mathf.Abs(rect.anchorMin.x - rect.anchorMax.x) > 0.0001f ||
               Mathf.Abs(rect.anchorMin.y - rect.anchorMax.y) > 0.0001f;
    }

    private static bool IsUnitScale(Vector3 scale)
    {
        return Mathf.Abs(scale.x - 1f) < 0.0001f &&
               Mathf.Abs(scale.y - 1f) < 0.0001f &&
               Mathf.Abs(scale.z - 1f) < 0.0001f;
    }

    private static string BuildObjectPath(Transform transform)
    {
        if (transform == null)
        {
            return string.Empty;
        }

        List<string> parts = new List<string>();
        Transform current = transform;
        while (current != null)
        {
            parts.Add(current.name);
            current = current.parent;
        }

        parts.Reverse();
        return string.Join("/", parts);
    }
}

using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

[Serializable]
public sealed class CandyCardViewBinding
{
    [SerializeField] private string bindingName = string.Empty;
    [SerializeField] private TextMeshProUGUI[] numberTexts = new TextMeshProUGUI[15];
    [SerializeField] private GameObject[] selectionOverlays = new GameObject[15];
    [SerializeField] private GameObject[] missingPatternOverlays = new GameObject[15];
    [SerializeField] private GameObject[] matchedPatternOverlays = new GameObject[15];
    [SerializeField] private GameObject[] paylineObjects = Array.Empty<GameObject>();
    [SerializeField] private TextMeshProUGUI winningText;

    public string BindingName => string.IsNullOrWhiteSpace(bindingName) ? "Card" : bindingName.Trim();
    public IReadOnlyList<TextMeshProUGUI> NumberTexts => numberTexts;
    public IReadOnlyList<GameObject> SelectionOverlays => selectionOverlays;
    public IReadOnlyList<GameObject> MissingPatternOverlays => missingPatternOverlays;
    public IReadOnlyList<GameObject> MatchedPatternOverlays => matchedPatternOverlays;
    public IReadOnlyList<GameObject> PaylineObjects => paylineObjects;
    public TextMeshProUGUI WinningText => winningText;

    public void CopyFrom(CardClass source, string fallbackName)
    {
        bindingName = string.IsNullOrWhiteSpace(fallbackName) ? "Card" : fallbackName.Trim();
        numberTexts = CopyTextList(source != null ? source.num_text : null, 15);
        selectionOverlays = CopyGameObjectList(source != null ? source.selectionImg : null, 15);
        missingPatternOverlays = CopyGameObjectList(source != null ? source.missingPatternImg : null, 15);
        matchedPatternOverlays = CopyGameObjectList(source != null ? source.matchPatternImg : null, 15);
        paylineObjects = CopyGameObjectList(source != null ? source.paylineObj : null, -1);
        winningText = ResolveWinningText(source);
    }

    public void ApplyTo(CardClass target)
    {
        if (target == null)
        {
            return;
        }

        target.num_text = new List<TextMeshProUGUI>(numberTexts ?? Array.Empty<TextMeshProUGUI>());
        target.selectionImg = new List<GameObject>(selectionOverlays ?? Array.Empty<GameObject>());
        target.missingPatternImg = new List<GameObject>(missingPatternOverlays ?? Array.Empty<GameObject>());
        target.matchPatternImg = new List<GameObject>(matchedPatternOverlays ?? Array.Empty<GameObject>());
        target.paylineObj = new List<GameObject>(paylineObjects ?? Array.Empty<GameObject>());
        target.win = winningText;

        EnsureFixedLength(ref target.payLinePattern, 15, (byte)0);
        EnsureFixedLength(ref target.paylineindex, Mathf.Max(0, target.paylineObj.Count), false);
    }

    public int CountValidNumberTargets()
    {
        int count = 0;
        if (numberTexts == null)
        {
            return 0;
        }

        for (int i = 0; i < numberTexts.Length; i++)
        {
            if (numberTexts[i] != null)
            {
                count += 1;
            }
        }

        return count;
    }

    public bool Validate(List<string> errors, int cardIndex)
    {
        string prefix = $"Card[{cardIndex}] {BindingName}";
        bool isValid = true;
        isValid &= ValidateTextArray(numberTexts, 15, $"{prefix} numberTexts", requireActive: true, errors: errors);
        isValid &= ValidateGameObjectArray(selectionOverlays, 15, $"{prefix} selectionOverlays", errors);
        isValid &= ValidateGameObjectArray(missingPatternOverlays, 15, $"{prefix} missingPatternOverlays", errors);
        isValid &= ValidateGameObjectArray(matchedPatternOverlays, 15, $"{prefix} matchedPatternOverlays", errors);

        if (paylineObjects == null || paylineObjects.Length == 0)
        {
            errors.Add($"{prefix} paylineObjects mangler.");
            isValid = false;
        }
        else
        {
            HashSet<int> paylineIds = new HashSet<int>();
            for (int i = 0; i < paylineObjects.Length; i++)
            {
                GameObject item = paylineObjects[i];
                if (item == null)
                {
                    errors.Add($"{prefix} paylineObjects[{i}] er null.");
                    isValid = false;
                    continue;
                }

                if (!paylineIds.Add(item.GetInstanceID()))
                {
                    errors.Add($"{prefix} paylineObjects[{i}] er duplikat.");
                    isValid = false;
                }
            }
        }

        if (!ValidateTextTarget(winningText, $"{prefix} winningText", requireActive: true, errors: errors))
        {
            isValid = false;
        }

        return isValid;
    }

    private static TextMeshProUGUI[] CopyTextList(List<TextMeshProUGUI> source, int expectedLength)
    {
        int length = expectedLength > 0 ? expectedLength : (source != null ? source.Count : 0);
        TextMeshProUGUI[] result = new TextMeshProUGUI[length];
        if (source == null)
        {
            return result;
        }

        int limit = Mathf.Min(result.Length, source.Count);
        for (int i = 0; i < limit; i++)
        {
            result[i] = source[i];
        }

        return result;
    }

    private static TextMeshProUGUI ResolveWinningText(CardClass source)
    {
        if (source == null)
        {
            return null;
        }

        if (source.win != null)
        {
            return source.win;
        }

        Transform cardRoot = ResolveCardRoot(source);
        if (cardRoot == null)
        {
            return null;
        }

        for (int i = 0; i < cardRoot.childCount; i++)
        {
            Transform child = cardRoot.GetChild(i);
            if (child == null)
            {
                continue;
            }

            string childName = child.name ?? string.Empty;
            if (childName.IndexOf("Win", StringComparison.OrdinalIgnoreCase) < 0)
            {
                continue;
            }

            TextMeshProUGUI label = child.GetComponent<TextMeshProUGUI>();
            if (label == null)
            {
                label = child.GetComponentInChildren<TextMeshProUGUI>(true);
            }

            if (label != null)
            {
                return label;
            }
        }

        return null;
    }

    private static Transform ResolveCardRoot(CardClass source)
    {
        if (source?.num_text != null)
        {
            for (int i = 0; i < source.num_text.Count; i++)
            {
                TextMeshProUGUI text = source.num_text[i];
                if (text == null)
                {
                    continue;
                }

                Transform cardRoot = text.transform.parent != null && text.transform.parent.parent != null
                    ? text.transform.parent.parent
                    : null;
                if (cardRoot != null)
                {
                    return cardRoot;
                }
            }
        }

        if (source?.selectionImg != null)
        {
            for (int i = 0; i < source.selectionImg.Count; i++)
            {
                GameObject overlay = source.selectionImg[i];
                if (overlay == null)
                {
                    continue;
                }

                Transform cardRoot = overlay.transform.parent != null ? overlay.transform.parent.parent : null;
                if (cardRoot != null)
                {
                    return cardRoot;
                }
            }
        }

        return null;
    }

    private static GameObject[] CopyGameObjectList(List<GameObject> source, int expectedLength)
    {
        int length = expectedLength > 0 ? expectedLength : (source != null ? source.Count : 0);
        GameObject[] result = new GameObject[length];
        if (source == null)
        {
            return result;
        }

        int limit = Mathf.Min(result.Length, source.Count);
        for (int i = 0; i < limit; i++)
        {
            result[i] = source[i];
        }

        return result;
    }

    private static void EnsureFixedLength<T>(ref List<T> list, int expectedLength, T defaultValue)
    {
        list ??= new List<T>(expectedLength);
        while (list.Count < expectedLength)
        {
            list.Add(defaultValue);
        }

        if (list.Count > expectedLength)
        {
            list.RemoveRange(expectedLength, list.Count - expectedLength);
        }
    }

    private static bool ValidateTextArray(TextMeshProUGUI[] items, int expectedLength, string label, bool requireActive, List<string> errors)
    {
        if (items == null || items.Length != expectedLength)
        {
            errors.Add($"{label} har feil lengde. Forventet {expectedLength}, fikk {items?.Length ?? 0}.");
            return false;
        }

        bool isValid = true;
        HashSet<int> ids = new HashSet<int>();
        for (int i = 0; i < items.Length; i++)
        {
            TextMeshProUGUI item = items[i];
            if (!ValidateTextTarget(item, $"{label}[{i}]", requireActive, errors))
            {
                isValid = false;
                continue;
            }

            if (!ids.Add(item.GetInstanceID()))
            {
                errors.Add($"{label}[{i}] er duplikat.");
                isValid = false;
            }
        }

        return isValid;
    }

    private static bool ValidateGameObjectArray(GameObject[] items, int expectedLength, string label, List<string> errors)
    {
        if (items == null || items.Length != expectedLength)
        {
            errors.Add($"{label} har feil lengde. Forventet {expectedLength}, fikk {items?.Length ?? 0}.");
            return false;
        }

        bool isValid = true;
        HashSet<int> ids = new HashSet<int>();
        for (int i = 0; i < items.Length; i++)
        {
            GameObject item = items[i];
            if (item == null)
            {
                errors.Add($"{label}[{i}] er null.");
                isValid = false;
                continue;
            }

            if (!ids.Add(item.GetInstanceID()))
            {
                errors.Add($"{label}[{i}] er duplikat.");
                isValid = false;
            }
        }

        return isValid;
    }

    private static bool ValidateTextTarget(TextMeshProUGUI target, string label, bool requireActive, List<string> errors)
    {
        if (target == null)
        {
            errors.Add($"{label} er null.");
            return false;
        }

        bool isValid = true;
        if (target.font == null)
        {
            errors.Add($"{label} mangler fontAsset.");
            isValid = false;
        }

        if (target.fontSharedMaterial == null)
        {
            errors.Add($"{label} mangler sharedMaterial.");
            isValid = false;
        }

        if (!target.enabled)
        {
            errors.Add($"{label} er disabled.");
            isValid = false;
        }

        if (requireActive && !target.gameObject.activeInHierarchy)
        {
            errors.Add($"{label} er ikke aktiv i hierarkiet.");
            isValid = false;
        }

        if (target.color.a <= 0.01f)
        {
            errors.Add($"{label} har alpha=0.");
            isValid = false;
        }

        RectTransform rectTransform = target.rectTransform;
        if (rectTransform == null)
        {
            errors.Add($"{label} mangler RectTransform.");
            isValid = false;
        }
        else
        {
            Rect rect = rectTransform.rect;
            if (rect.width <= 1f || rect.height <= 1f)
            {
                errors.Add($"{label} har ugyldig TMP-rect ({rect.width:0.##}x{rect.height:0.##}).");
                isValid = false;
            }
        }

        return isValid;
    }
}

[Serializable]
public sealed class CandyBallSlotBinding
{
    [SerializeField] private string bindingName = string.Empty;
    [SerializeField] private GameObject root;
    [SerializeField] private Image image;
    [SerializeField] private TextMeshProUGUI numberText;

    public string BindingName => string.IsNullOrWhiteSpace(bindingName) ? "Ball" : bindingName.Trim();
    public GameObject Root => root;
    public Image Image => image;
    public TextMeshProUGUI NumberText => numberText;

    public void CopyFrom(GameObject sourceRoot, string fallbackName)
    {
        bindingName = string.IsNullOrWhiteSpace(fallbackName) ? "Ball" : fallbackName.Trim();
        root = sourceRoot;
        image = sourceRoot != null ? sourceRoot.GetComponent<Image>() : null;
        numberText = sourceRoot != null ? sourceRoot.GetComponentInChildren<TextMeshProUGUI>(true) : null;
    }

    public bool Validate(List<string> errors, int index)
    {
        string prefix = $"Ball[{index}] {BindingName}";
        bool isValid = true;
        if (root == null)
        {
            errors.Add($"{prefix} root mangler.");
            isValid = false;
        }

        if (image == null)
        {
            errors.Add($"{prefix} image mangler.");
            isValid = false;
        }

        if (!CandyCardViewBindingValidator.ValidateTextTarget(numberText, $"{prefix} numberText", requireActive: false, errors))
        {
            isValid = false;
        }

        return isValid;
    }
}

internal static class CandyCardViewBindingValidator
{
    public static bool ValidateTextTarget(TextMeshProUGUI target, string label, bool requireActive, List<string> errors)
    {
        if (target == null)
        {
            errors.Add($"{label} er null.");
            return false;
        }

        bool isValid = true;
        if (target.font == null)
        {
            errors.Add($"{label} mangler fontAsset.");
            isValid = false;
        }

        if (target.fontSharedMaterial == null)
        {
            errors.Add($"{label} mangler sharedMaterial.");
            isValid = false;
        }

        if (!target.enabled)
        {
            errors.Add($"{label} er disabled.");
            isValid = false;
        }

        if (requireActive && !target.gameObject.activeInHierarchy)
        {
            errors.Add($"{label} er ikke aktiv i hierarkiet.");
            isValid = false;
        }

        if (target.color.a <= 0.01f)
        {
            errors.Add($"{label} har alpha=0.");
            isValid = false;
        }

        RectTransform rectTransform = target.rectTransform;
        if (rectTransform == null)
        {
            errors.Add($"{label} mangler RectTransform.");
            isValid = false;
        }
        else
        {
            Rect rect = rectTransform.rect;
            if (rect.width <= 1f || rect.height <= 1f)
            {
                errors.Add($"{label} har ugyldig TMP-rect ({rect.width:0.##}x{rect.height:0.##}).");
                isValid = false;
            }
        }

        return isValid;
    }
}

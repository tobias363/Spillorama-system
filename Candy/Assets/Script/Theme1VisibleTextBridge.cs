using TMPro;
using UnityEngine;
using UnityEngine.UI;

[ExecuteAlways]
[RequireComponent(typeof(Text))]
public sealed class Theme1VisibleTextBridge : MonoBehaviour
{
    [SerializeField] private TMP_Text source;
    [SerializeField] private bool hideWhenSourceInactive = true;
    [SerializeField] private bool hideWhenSourceBlank;
    [SerializeField] private Color colorOverride = new Color(0f, 0f, 0f, 0f);

    private Text target;

    public TMP_Text Source => source;

    public void Bind(TMP_Text sourceLabel, bool hideBlank, Color preferredColor)
    {
        source = sourceLabel;
        hideWhenSourceBlank = hideBlank;
        colorOverride = preferredColor;
        EnsureConfigured();
        SyncNow();
    }

    private void Awake()
    {
        EnsureConfigured();
        SyncNow();
    }

    private void OnEnable()
    {
        EnsureConfigured();
        SyncNow();
    }

    private void LateUpdate()
    {
        SyncNow();
    }

    private void EnsureConfigured()
    {
        if (target == null)
        {
            target = GetComponent<Text>();
        }

        if (target == null)
        {
            return;
        }

        if (target.font == null)
        {
            target.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        }

        target.supportRichText = false;
        target.raycastTarget = false;
        target.resizeTextForBestFit = true;
        target.resizeTextMinSize = 12;
        target.resizeTextMaxSize = 64;
        target.horizontalOverflow = HorizontalWrapMode.Overflow;
        target.verticalOverflow = VerticalWrapMode.Overflow;
        target.alignment = TextAnchor.MiddleCenter;
    }

    public void SyncNow()
    {
        EnsureConfigured();
        if (target == null)
        {
            return;
        }

        RectTransform sourceRect = source != null ? source.rectTransform : null;
        RectTransform targetRect = target.rectTransform;
        if (sourceRect != null && targetRect != null)
        {
            targetRect.anchorMin = sourceRect.anchorMin;
            targetRect.anchorMax = sourceRect.anchorMax;
            targetRect.pivot = sourceRect.pivot;
            targetRect.anchoredPosition = sourceRect.anchoredPosition;
            targetRect.sizeDelta = sourceRect.sizeDelta;
            targetRect.localScale = Vector3.one;
            targetRect.localRotation = Quaternion.identity;
        }

        if (source == null)
        {
            target.text = string.Empty;
            return;
        }

        string value = source.text ?? string.Empty;
        bool shouldHide =
            (hideWhenSourceInactive && (!source.gameObject.activeInHierarchy || !source.enabled || source.alpha <= 0f)) ||
            (hideWhenSourceBlank && string.IsNullOrWhiteSpace(value));

        target.text = shouldHide ? string.Empty : value;
        target.color = colorOverride.a > 0f ? colorOverride : source.color;
        target.fontStyle = ConvertFontStyle(source.fontStyle);
        target.fontSize = Mathf.RoundToInt(source.fontSize > 0f ? source.fontSize : 36f);
        target.resizeTextMinSize = Mathf.RoundToInt(source.fontSizeMin > 0f ? source.fontSizeMin : 12f);
        target.resizeTextMaxSize = Mathf.RoundToInt(source.fontSizeMax > 0f ? source.fontSizeMax : 64f);
        target.alignment = ConvertAlignment(source.alignment);
        target.enabled = !shouldHide;
        if (gameObject.activeSelf != !shouldHide)
        {
            gameObject.SetActive(!shouldHide);
        }
    }

    private static FontStyle ConvertFontStyle(FontStyles sourceStyle)
    {
        bool bold = (sourceStyle & FontStyles.Bold) != 0;
        bool italic = (sourceStyle & FontStyles.Italic) != 0;
        if (bold && italic)
        {
            return FontStyle.BoldAndItalic;
        }

        if (bold)
        {
            return FontStyle.Bold;
        }

        if (italic)
        {
            return FontStyle.Italic;
        }

        return FontStyle.Normal;
    }

    private static TextAnchor ConvertAlignment(TextAlignmentOptions sourceAlignment)
    {
        return sourceAlignment switch
        {
            TextAlignmentOptions.TopLeft => TextAnchor.UpperLeft,
            TextAlignmentOptions.Top => TextAnchor.UpperCenter,
            TextAlignmentOptions.TopRight => TextAnchor.UpperRight,
            TextAlignmentOptions.Left => TextAnchor.MiddleLeft,
            TextAlignmentOptions.Right => TextAnchor.MiddleRight,
            TextAlignmentOptions.BottomLeft => TextAnchor.LowerLeft,
            TextAlignmentOptions.Bottom => TextAnchor.LowerCenter,
            TextAlignmentOptions.BottomRight => TextAnchor.LowerRight,
            _ => TextAnchor.MiddleCenter,
        };
    }
}

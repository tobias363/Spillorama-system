using TMPro;
using UnityEngine;

internal static class Theme1PresentationTextUtils
{
    public static void ApplyText(TMP_Text target, string value)
    {
        if (target == null)
        {
            return;
        }

        string normalizedValue = value ?? string.Empty;
        if (!target.enabled)
        {
            target.enabled = true;
        }

        if (!target.gameObject.activeSelf)
        {
            target.gameObject.SetActive(true);
        }

        if (!string.Equals(target.text, normalizedValue))
        {
            target.text = normalizedValue;
        }

        if (!Mathf.Approximately(target.alpha, 1f))
        {
            target.alpha = 1f;
        }
    }

    public static void ApplyCardNumberText(TMP_Text target, string value)
    {
        if (target is TextMeshProUGUI label)
        {
            RealtimeTextStyleUtils.ApplyCardNumber(label, value ?? string.Empty);
            return;
        }

        ApplyText(target, value);
    }

    public static void ApplyCardNumberText(Theme1CardCellView cellView, string value)
    {
        TextMeshProUGUI preferredLabel = cellView?.PreferredRenderLabel;
        if (preferredLabel == null)
        {
            return;
        }

        RealtimeTextStyleUtils.ApplyCardNumber(preferredLabel, value ?? string.Empty);
        Theme1BongTypography.ApplyCardNumber(preferredLabel);
        if (!preferredLabel.enabled)
        {
            preferredLabel.enabled = true;
        }

        if (!preferredLabel.gameObject.activeSelf)
        {
            preferredLabel.gameObject.SetActive(true);
        }

        if (!Mathf.Approximately(preferredLabel.alpha, 1f))
        {
            preferredLabel.alpha = 1f;
        }

        preferredLabel.transform.SetAsLastSibling();

        TextMeshProUGUI secondaryLabel = cellView.LegacyNumberLabel == preferredLabel
            ? cellView.VisibleNumberLabel
            : cellView.LegacyNumberLabel;
        if (secondaryLabel != null)
        {
            secondaryLabel.text = string.Empty;
            secondaryLabel.enabled = false;
            secondaryLabel.alpha = 0f;
            if (secondaryLabel.gameObject.activeSelf)
            {
                secondaryLabel.gameObject.SetActive(false);
            }
        }
    }

    public static void ApplyBallNumberText(TMP_Text target, string value)
    {
        if (target is TextMeshProUGUI label)
        {
            RealtimeTextStyleUtils.ApplyBallNumber(label, value ?? string.Empty);
            return;
        }

        ApplyText(target, value);
    }

    public static void ApplyHudText(TMP_Text target, string value)
    {
        if (target is TextMeshProUGUI label)
        {
            if (Theme1ManagedTypographyRegistry.Contains(label) ||
                Theme1ManagedTypographyRegistry.BelongsToTheme1Presentation(label))
            {
                ApplyText(label, value);
                return;
            }

            RealtimeTextStyleUtils.ApplyHudText(label, value ?? string.Empty, preferredColor: label.color);
            return;
        }

        ApplyText(target, value);
    }

    public static void ApplyTopperText(TMP_Text target, string value, Color defaultColor)
    {
        if (target is TextMeshProUGUI label)
        {
            if (Theme1ManagedTypographyRegistry.Contains(label) ||
                Theme1ManagedTypographyRegistry.BelongsToTheme1Presentation(label))
            {
                ApplyText(label, value);
                if (label.color != defaultColor)
                {
                    label.color = defaultColor;
                }

                return;
            }

            RealtimeTextStyleUtils.ApplyHudText(label, value ?? string.Empty, preferredColor: defaultColor);
            return;
        }

        ApplyText(target, value);
    }

    public static void ApplyRequiredHudValue(TMP_Text target, string value, string authoritativeFallback)
    {
        string resolvedValue = !string.IsNullOrWhiteSpace(value)
            ? value
            : (!string.IsNullOrWhiteSpace(authoritativeFallback)
                ? authoritativeFallback
                : (!string.IsNullOrWhiteSpace(target?.text) ? target.text : "0"));
        ApplyHudText(target, resolvedValue);
    }

    public static void ApplyPreservedHudValue(TMP_Text target, string value, string authoritativeFallback)
    {
        string resolvedValue = !string.IsNullOrWhiteSpace(value)
            ? value
            : (!string.IsNullOrWhiteSpace(target?.text)
                ? target.text
                : authoritativeFallback);
        ApplyHudText(target, resolvedValue);
    }

    public static void ApplyOptionalHudValue(TMP_Text target, string value)
    {
        string resolvedValue = !string.IsNullOrWhiteSpace(value)
            ? value
            : (!string.IsNullOrWhiteSpace(target?.text) ? target.text : string.Empty);
        ApplyHudText(target, resolvedValue);
        SetActive(target != null ? target.gameObject : null, !string.IsNullOrWhiteSpace(resolvedValue));
    }

    public static void SetActive(GameObject target, bool active)
    {
        if (target != null && target.activeSelf != active)
        {
            target.SetActive(active);
        }
    }
}

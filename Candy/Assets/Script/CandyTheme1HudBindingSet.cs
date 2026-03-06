using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public sealed class CandyTheme1HudBindingSet : MonoBehaviour
{
    [SerializeField] private TextMeshProUGUI countdownText;
    [SerializeField] private TextMeshProUGUI roomPlayerCountText;

    public TextMeshProUGUI CountdownText => countdownText;
    public TextMeshProUGUI RoomPlayerCountText => roomPlayerCountText;

    public void PullFrom(NumberGenerator generator)
    {
        if (generator != null && generator.autoSpinRemainingPlayText != null)
        {
            countdownText = generator.autoSpinRemainingPlayText;
        }

        if (roomPlayerCountText == null)
        {
            roomPlayerCountText = FindExistingPlayerCountText(countdownText);
        }
    }

    public bool TryApplyTo(NumberGenerator generator, APIManager apiManager, out string error)
    {
        error = string.Empty;

        if (countdownText == null)
        {
            error = "countdownText mangler.";
            return false;
        }

        if (roomPlayerCountText == null)
        {
            error = "roomPlayerCountText mangler.";
            return false;
        }

        if (generator != null)
        {
            generator.autoSpinRemainingPlayText = countdownText;
        }

        apiManager?.ApplyExplicitRealtimeHudBindings(countdownText, roomPlayerCountText);
        return true;
    }

    public bool Validate(out string report)
    {
        List<string> errors = new List<string>();
        bool isValid = true;

        if (!CandyCardViewBindingValidator.ValidateTextTarget(countdownText, "HUD countdownText", requireActive: true, errors))
        {
            isValid = false;
        }

        if (!CandyCardViewBindingValidator.ValidateTextTarget(roomPlayerCountText, "HUD roomPlayerCountText", requireActive: true, errors))
        {
            isValid = false;
        }

        if (countdownText != null &&
            roomPlayerCountText != null &&
            countdownText.GetInstanceID() == roomPlayerCountText.GetInstanceID())
        {
            errors.Add("HUD countdownText og roomPlayerCountText peker til samme TMP-objekt.");
            isValid = false;
        }

        report = string.Join(Environment.NewLine, errors);
        return isValid;
    }

    public static TextMeshProUGUI FindExistingPlayerCountText(TextMeshProUGUI countdown)
    {
        if (countdown == null)
        {
            return null;
        }

        Transform parent = countdown.transform.parent;
        if (parent == null)
        {
            return null;
        }

        for (int i = 0; i < parent.childCount; i++)
        {
            Transform child = parent.GetChild(i);
            if (child == null || child == countdown.transform)
            {
                continue;
            }

            if (!string.Equals(child.name, "RealtimeRoomPlayerCountText", StringComparison.Ordinal))
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
}

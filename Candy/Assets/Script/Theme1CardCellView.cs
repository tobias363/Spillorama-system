using System;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

[Serializable]
public sealed class Theme1CardCellView
{
    private const string CellBackgroundName = "RealtimeCardCellBackground";
    private const string CellGlowName = "RealtimeCardCellGlow";
    private const string CellPrizeLabelName = "RealtimeCardCellPrizeLabel";

    [SerializeField] private RectTransform cellRoot;
    [SerializeField] private TextMeshProUGUI numberLabel;
    [SerializeField] private GameObject selectionMarker;
    [SerializeField] private GameObject missingOverlay;
    [SerializeField] private GameObject matchedOverlay;
    [SerializeField] private Image background;
    [SerializeField] private Image glow;
    [SerializeField] private TextMeshProUGUI prizeLabel;
    [SerializeField] private TextMeshProUGUI visibleNumberLabel;
    [SerializeField] private Theme1CellPulseController pulseController;

    public RectTransform CellRoot => cellRoot;
    public TextMeshProUGUI NumberLabel => visibleNumberLabel != null ? visibleNumberLabel : numberLabel;
    public TextMeshProUGUI LegacyNumberLabel => numberLabel;
    public GameObject SelectionMarker => selectionMarker;
    public GameObject SelectionOverlay => selectionMarker;
    public GameObject MissingOverlay => missingOverlay;
    public GameObject MatchedOverlay => matchedOverlay;
    public Image Background => background;
    public Image Glow => glow;
    public TextMeshProUGUI PrizeLabel => prizeLabel;
    public TextMeshProUGUI VisibleNumberLabel => visibleNumberLabel;
    public TextMeshProUGUI PreferredRenderLabel => NumberLabel;
    public Theme1CellPulseController PulseController => pulseController;

    public void PullFrom(RectTransform root, TextMeshProUGUI label, GameObject selection, GameObject missing, GameObject matched)
    {
        cellRoot = root;
        numberLabel = label;
        selectionMarker = selection;
        missingOverlay = missing;
        matchedOverlay = matched;
        background = FindChildComponent<Image>(root, CellBackgroundName);
        glow = FindChildComponent<Image>(root, CellGlowName);
        prizeLabel = FindChildComponent<TextMeshProUGUI>(root, CellPrizeLabelName);
        visibleNumberLabel = FindChildComponent<TextMeshProUGUI>(root, Theme1GameplayViewRepairUtils.CardNumberVisibleLabelName);
        pulseController = root != null ? root.GetComponent<Theme1CellPulseController>() : null;
    }

    private static T FindChildComponent<T>(Transform parent, string name) where T : Component
    {
        if (parent == null || string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        Transform child = parent.Find(name);
        return child != null ? child.GetComponent<T>() : null;
    }
}

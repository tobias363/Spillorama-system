using UnityEngine;
using UnityEngine.UI;


public class ResolutionManager : MonoBehaviour
{
    [Header("Canvas Scaling")]
    [SerializeField] private Vector2 referenceResolution = new Vector2(1920, 1080);
    [SerializeField] [Range(0f, 1f)] private float matchWidthOrHeight = 0.5f;

    [Header("Screen Resolution")]
    [SerializeField] private bool forceFullscreenResolution = false;
    [SerializeField] private bool applyInEditor = false;

    [Header("Runtime Graphics")]
    [SerializeField] private bool applyRuntimeQuality = true;
    [SerializeField] private int minimumAntiAliasing = 4;
    [SerializeField] private AnisotropicFiltering anisotropicFiltering = AnisotropicFiltering.ForceEnable;

    void Start()
    {
        ApplyRuntimeGraphicsQuality();

        if (Application.isEditor && !applyInEditor)
        {
            ApplyCanvasScalerOnly();
            return;
        }

        ApplyCanvasScalerOnly();

        if (forceFullscreenResolution)
        {
            ApplyFullscreenResolution();
        }
    }

    private void ApplyCanvasScalerOnly()
    {
        CanvasScaler canvasScaler = GetComponent<CanvasScaler>();
        if (canvasScaler != null)
        {
            canvasScaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasScaler.referenceResolution = referenceResolution;
            canvasScaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            canvasScaler.matchWidthOrHeight = matchWidthOrHeight;
        }
    }

    private void ApplyFullscreenResolution()
    {
        Resolution current = Screen.currentResolution;
        int targetWidth = Mathf.Max((int)referenceResolution.x, current.width);
        int targetHeight = Mathf.Max((int)referenceResolution.y, current.height);
        Screen.SetResolution(targetWidth, targetHeight, FullScreenMode.FullScreenWindow);
    }

    private void ApplyRuntimeGraphicsQuality()
    {
        if (!applyRuntimeQuality)
        {
            return;
        }

        QualitySettings.masterTextureLimit = 0;
        QualitySettings.anisotropicFiltering = anisotropicFiltering;

        int targetAntiAliasing = ResolveSupportedAntiAliasingLevel(minimumAntiAliasing);
        if (QualitySettings.antiAliasing < targetAntiAliasing)
        {
            QualitySettings.antiAliasing = targetAntiAliasing;
        }
    }

    private static int ResolveSupportedAntiAliasingLevel(int requestedLevel)
    {
        if (requestedLevel >= 8)
        {
            return 8;
        }
        if (requestedLevel >= 4)
        {
            return 4;
        }
        if (requestedLevel >= 2)
        {
            return 2;
        }
        return 0;
    }
}

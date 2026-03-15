using UnityEngine;

public static class Theme1RuntimeAssetCatalog
{
    private const string BongShellRasterResourcePath = "Theme1/Theme1BongShellRaster";
    private const string BongShellResourcePath = "Theme1/Theme1BongShell";
    private const string OneToGoGlowRasterResourcePath = "Theme1/Theme1OneToGoGlowRaster";
    private const string OneToGoGlowResourcePath = "Theme1/Theme1OneToGoGlow";
    private const string StakePanelShellVectorResourcePath = "Theme1/Controls/Theme1StakePanelVector";
    private const string StakePanelShellResourcePath = "Theme1/Controls/Theme1StakePanelBase";
    private const string StakeMinusButtonResourcePath = "Theme1/Controls/Theme1StakeMinusButton";
    private const string StakePlusButtonResourcePath = "Theme1/Controls/Theme1StakePlusButton";
    private const string PlaceBetButtonVectorResourcePath = "Theme1/Controls/Theme1PlaceBetButtonVector";
    private const string PlaceBetButtonResourcePath = "Theme1/Controls/Theme1PlaceBetButtonShell";
    private const string NextDrawBannerShellVectorResourcePath = "Theme1/Controls/Theme1NextDrawBannerVector";
    private const string NextDrawBannerShellResourcePath = "Theme1/Controls/Theme1NextDrawBannerBase";
    private const string ShuffleButtonResourcePath = "Theme1/Controls/Theme1ShuffleButton";
    private const string SaldoPanelVectorResourcePath = "Theme1/Controls/Theme1SaldoPanelVector";
    private const string SaldoPanelResourcePath = "Theme1/Controls/Theme1SaldoPanelBase";
    private const string GevinstPanelVectorResourcePath = "Theme1/Controls/Theme1GevinstPanelVector";
    private const string GevinstPanelResourcePath = "Theme1/Controls/Theme1GevinstPanelBase";
    private const string TopperCardResourcePathPrefix = "Theme1/Topper/Theme1TopperCard";

    private static Sprite bongShellSprite;
    private static bool bongShellResolved;
    private static Sprite oneToGoGlowSprite;
    private static bool oneToGoGlowResolved;
    private static Sprite stakePanelShellSprite;
    private static bool stakePanelShellResolved;
    private static Sprite stakeMinusButtonSprite;
    private static bool stakeMinusButtonResolved;
    private static Sprite stakePlusButtonSprite;
    private static bool stakePlusButtonResolved;
    private static Sprite placeBetButtonSprite;
    private static bool placeBetButtonResolved;
    private static Sprite nextDrawBannerShellSprite;
    private static bool nextDrawBannerShellResolved;
    private static Sprite shuffleButtonSprite;
    private static bool shuffleButtonResolved;
    private static Sprite saldoPanelSprite;
    private static bool saldoPanelResolved;
    private static Sprite gevinstPanelSprite;
    private static bool gevinstPanelResolved;
    private static readonly Sprite[] topperCardSprites = new Sprite[12];
    private static readonly bool[] topperCardResolved = new bool[12];

    public static Sprite GetBongShellSprite()
    {
        if (!bongShellResolved)
        {
            bongShellSprite = LoadPrimaryThenFallback(BongShellResourcePath, BongShellRasterResourcePath);
            bongShellResolved = true;
        }

        return bongShellSprite;
    }

    public static Sprite GetOneToGoGlowSprite()
    {
        if (!oneToGoGlowResolved)
        {
            oneToGoGlowSprite = LoadPrimaryThenFallback(OneToGoGlowResourcePath, OneToGoGlowRasterResourcePath);
            oneToGoGlowResolved = true;
        }

        return oneToGoGlowSprite;
    }

    public static Sprite GetStakePanelShellSprite()
    {
        if (!stakePanelShellResolved)
        {
            stakePanelShellSprite = LoadPrimaryThenFallback(StakePanelShellVectorResourcePath, StakePanelShellResourcePath);
            stakePanelShellResolved = true;
        }

        return stakePanelShellSprite;
    }

    public static Sprite GetStakeMinusButtonSprite()
    {
        if (!stakeMinusButtonResolved)
        {
            stakeMinusButtonSprite = Resources.Load<Sprite>(StakeMinusButtonResourcePath);
            stakeMinusButtonResolved = true;
        }

        return stakeMinusButtonSprite;
    }

    public static Sprite GetStakePlusButtonSprite()
    {
        if (!stakePlusButtonResolved)
        {
            stakePlusButtonSprite = Resources.Load<Sprite>(StakePlusButtonResourcePath);
            stakePlusButtonResolved = true;
        }

        return stakePlusButtonSprite;
    }

    public static Sprite GetPlaceBetButtonSprite()
    {
        if (!placeBetButtonResolved)
        {
            placeBetButtonSprite = LoadPrimaryThenFallback(PlaceBetButtonVectorResourcePath, PlaceBetButtonResourcePath);
            placeBetButtonResolved = true;
        }

        return placeBetButtonSprite;
    }

    public static Sprite GetNextDrawBannerShellSprite()
    {
        if (!nextDrawBannerShellResolved)
        {
            nextDrawBannerShellSprite = LoadPrimaryThenFallback(NextDrawBannerShellVectorResourcePath, NextDrawBannerShellResourcePath);
            nextDrawBannerShellResolved = true;
        }

        return nextDrawBannerShellSprite;
    }

    public static Sprite GetShuffleButtonSprite()
    {
        if (!shuffleButtonResolved)
        {
            shuffleButtonSprite = Resources.Load<Sprite>(ShuffleButtonResourcePath);
            shuffleButtonResolved = true;
        }

        return shuffleButtonSprite;
    }

    public static Sprite GetSaldoPanelSprite()
    {
        if (!saldoPanelResolved)
        {
            saldoPanelSprite = LoadPrimaryThenFallback(SaldoPanelVectorResourcePath, SaldoPanelResourcePath);
            saldoPanelResolved = true;
        }

        return saldoPanelSprite;
    }

    public static Sprite GetGevinstPanelSprite()
    {
        if (!gevinstPanelResolved)
        {
            gevinstPanelSprite = LoadPrimaryThenFallback(GevinstPanelVectorResourcePath, GevinstPanelResourcePath);
            gevinstPanelResolved = true;
        }

        return gevinstPanelSprite;
    }

    public static Sprite GetTopperCardSprite(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= topperCardSprites.Length)
        {
            return null;
        }

        if (!topperCardResolved[slotIndex])
        {
            topperCardSprites[slotIndex] = Resources.Load<Sprite>($"{TopperCardResourcePathPrefix}{slotIndex + 1:00}");
            topperCardResolved[slotIndex] = true;
        }

        return topperCardSprites[slotIndex];
    }

    private static Sprite LoadPrimaryThenFallback(string primaryResourcePath, string fallbackResourcePath)
    {
        Sprite sprite = string.IsNullOrWhiteSpace(primaryResourcePath)
            ? null
            : Resources.Load<Sprite>(primaryResourcePath);
        if (sprite != null)
        {
            return sprite;
        }

        return string.IsNullOrWhiteSpace(fallbackResourcePath)
            ? null
            : Resources.Load<Sprite>(fallbackResourcePath);
    }
}

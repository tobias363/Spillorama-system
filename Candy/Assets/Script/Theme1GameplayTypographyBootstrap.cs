using TMPro;
using UnityEngine;

public static class Theme1GameplayTypographyBootstrap
{
    public static void ApplyTypography(Theme1GameplayViewRoot root)
    {
        for (int cardIndex = 0; root.Cards != null && cardIndex < root.Cards.Length; cardIndex++)
        {
            Theme1CardGridView card = root.Cards[cardIndex];
            RealtimeTextStyleUtils.ApplyHudText(card?.HeaderLabel, ReadText(card?.HeaderLabel), preferredColor: card?.HeaderLabel != null ? card.HeaderLabel.color : Color.white);
            RealtimeTextStyleUtils.ApplyHudText(card?.BetLabel, ReadText(card?.BetLabel), preferredColor: card?.BetLabel != null ? card.BetLabel.color : Color.white);
            RealtimeTextStyleUtils.ApplyHudText(card?.WinLabel, ReadText(card?.WinLabel), preferredColor: card?.WinLabel != null ? card.WinLabel.color : Color.white);
            SetUnmaskable(card?.HeaderLabel);
            SetUnmaskable(card?.BetLabel);
            SetUnmaskable(card?.WinLabel);

            for (int cellIndex = 0; card?.Cells != null && cellIndex < card.Cells.Length; cellIndex++)
            {
                Theme1CardCellView cell = card.Cells[cellIndex];
                TextMeshProUGUI preferredNumberLabel = cell?.PreferredRenderLabel;
                string preferredNumberText = ReadText(preferredNumberLabel);
                RealtimeTextStyleUtils.ApplyCardNumber(preferredNumberLabel, preferredNumberText);
                Theme1BongTypography.ApplyCardNumber(preferredNumberLabel);
                SetUnmaskable(preferredNumberLabel);

                TextMeshProUGUI inactiveNumberLabel = cell != null && cell.LegacyNumberLabel == preferredNumberLabel
                    ? cell.VisibleNumberLabel
                    : cell?.LegacyNumberLabel;
                if (inactiveNumberLabel != null)
                {
                    inactiveNumberLabel.text = string.Empty;
                    inactiveNumberLabel.enabled = false;
                    inactiveNumberLabel.alpha = 0f;
                    if (inactiveNumberLabel.gameObject.activeSelf)
                    {
                        inactiveNumberLabel.gameObject.SetActive(false);
                    }
                }

                TextMeshProUGUI prizeLabel = cell?.PrizeLabel;
                RealtimeTextStyleUtils.ApplyHudText(
                    prizeLabel,
                    ReadText(prizeLabel),
                    preferredColor: Theme1BongStyle.PrizeTextColor);
                Theme1BongTypography.ApplyPrizeLabel(prizeLabel);
                SetUnmaskable(prizeLabel);
            }
        }

        RealtimeTextStyleUtils.ApplyBallNumber(root.BallRack?.BigBallText, ReadText(root.BallRack?.BigBallText));
        SetUnmaskable(root.BallRack?.BigBallText);
        for (int slotIndex = 0; root.BallRack?.Slots != null && slotIndex < root.BallRack.Slots.Length; slotIndex++)
        {
            RealtimeTextStyleUtils.ApplyBallNumber(
                root.BallRack.Slots[slotIndex]?.NumberLabel,
                ReadText(root.BallRack.Slots[slotIndex]?.NumberLabel));
            SetUnmaskable(root.BallRack.Slots[slotIndex]?.NumberLabel);
        }

        Theme1HudBarView hudBar = root.HudBar;
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.CountdownText, ReadText(hudBar?.CountdownText), preferredColor: hudBar?.CountdownText != null ? hudBar.CountdownText.color : Color.white);
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.RoomPlayerCountText, ReadText(hudBar?.RoomPlayerCountText), preferredColor: hudBar?.RoomPlayerCountText != null ? hudBar.RoomPlayerCountText.color : Color.white);
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.CreditText, ReadText(hudBar?.CreditText), preferredColor: hudBar?.CreditText != null ? hudBar.CreditText.color : Color.white);
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.WinningsText, ReadText(hudBar?.WinningsText), preferredColor: hudBar?.WinningsText != null ? hudBar.WinningsText.color : Color.white);
        RealtimeTextStyleUtils.ApplyHudText(hudBar?.BetText, ReadText(hudBar?.BetText), preferredColor: hudBar?.BetText != null ? hudBar.BetText.color : Color.white);
        SetUnmaskable(hudBar?.CountdownText);
        SetUnmaskable(hudBar?.RoomPlayerCountText);
        SetUnmaskable(hudBar?.CreditText);
        SetUnmaskable(hudBar?.WinningsText);
        SetUnmaskable(hudBar?.BetText);
        Theme1HudControlStyle.ApplyHudBarStyles(hudBar);

        for (int slotIndex = 0; root.TopperStrip?.Slots != null && slotIndex < root.TopperStrip.Slots.Length; slotIndex++)
        {
            Theme1TopperSlotView slot = root.TopperStrip.Slots[slotIndex];
            RealtimeTextStyleUtils.ApplyHudText(
                slot?.PrizeLabel,
                ReadText(slot?.PrizeLabel),
                preferredColor: slot != null ? slot.DefaultPrizeColor : Color.white);
            SetUnmaskable(slot?.PrizeLabel);
        }
    }

    public static void RegisterManagedTextTargets(Theme1GameplayViewRoot root)
    {
        Theme1ManagedTypographyRegistry.Clear();

        for (int cardIndex = 0; root.Cards != null && cardIndex < root.Cards.Length; cardIndex++)
        {
            Theme1CardGridView card = root.Cards[cardIndex];
            Theme1ManagedTypographyRegistry.Register(card?.HeaderLabel);
            Theme1ManagedTypographyRegistry.Register(card?.BetLabel);
            Theme1ManagedTypographyRegistry.Register(card?.WinLabel);
            for (int cellIndex = 0; card?.Cells != null && cellIndex < card.Cells.Length; cellIndex++)
            {
                Theme1CardCellView cell = card.Cells[cellIndex];
                Theme1ManagedTypographyRegistry.Register(cell?.PreferredRenderLabel);
                Theme1ManagedTypographyRegistry.Register(cell?.PrizeLabel);
            }
        }

        Theme1ManagedTypographyRegistry.Register(root.BallRack?.BigBallText);
        for (int slotIndex = 0; root.BallRack?.Slots != null && slotIndex < root.BallRack.Slots.Length; slotIndex++)
        {
            Theme1ManagedTypographyRegistry.Register(root.BallRack.Slots[slotIndex]?.NumberLabel);
        }

        Theme1ManagedTypographyRegistry.Register(root.HudBar?.CountdownText);
        Theme1ManagedTypographyRegistry.Register(root.HudBar?.RoomPlayerCountText);
        Theme1ManagedTypographyRegistry.Register(root.HudBar?.CreditText);
        Theme1ManagedTypographyRegistry.Register(root.HudBar?.WinningsText);
        Theme1ManagedTypographyRegistry.Register(root.HudBar?.BetText);

        for (int slotIndex = 0; root.TopperStrip?.Slots != null && slotIndex < root.TopperStrip.Slots.Length; slotIndex++)
        {
            Theme1ManagedTypographyRegistry.Register(root.TopperStrip.Slots[slotIndex]?.PrizeLabel);
        }
    }

    private static string ReadText(TMP_Text target)
    {
        return target != null ? (target.text ?? string.Empty) : string.Empty;
    }

    private static void SetUnmaskable(TextMeshProUGUI target)
    {
        if (target != null && target.maskable)
        {
            target.maskable = false;
        }
    }
}

using System;
using System.Text;

public static class Theme1RoundRenderStateComparer
{
    public static bool TryCompare(Theme1RoundRenderState expected, Theme1RoundRenderState actual, out string mismatch)
    {
        StringBuilder builder = new StringBuilder();
        if (!TryCompareCards(expected, actual, builder) |
            !TryCompareBallRack(expected, actual, builder) |
            !TryCompareHud(expected, actual, builder) |
            !TryCompareTopper(expected, actual, builder))
        {
            mismatch = builder.ToString().Trim();
            return false;
        }

        mismatch = string.Empty;
        return true;
    }

    private static bool TryCompareCards(Theme1RoundRenderState expected, Theme1RoundRenderState actual, StringBuilder builder)
    {
        bool isValid = true;
        int cardCount = Math.Max(expected?.Cards?.Length ?? 0, actual?.Cards?.Length ?? 0);
        for (int cardIndex = 0; cardIndex < cardCount; cardIndex++)
        {
            Theme1CardRenderState left = expected != null && expected.Cards != null && cardIndex < expected.Cards.Length ? expected.Cards[cardIndex] : null;
            Theme1CardRenderState right = actual != null && actual.Cards != null && cardIndex < actual.Cards.Length ? actual.Cards[cardIndex] : null;

            if (!TryCompareValue(left?.HeaderLabel, right?.HeaderLabel, $"cards[{cardIndex}].headerLabel", builder) ||
                !TryCompareValue(left?.BetLabel, right?.BetLabel, $"cards[{cardIndex}].betLabel", builder) ||
                !TryCompareValue(left?.ShowWinLabel ?? false, right?.ShowWinLabel ?? false, $"cards[{cardIndex}].showWinLabel", builder))
            {
                isValid = false;
            }

            if ((left?.ShowWinLabel ?? false) &&
                !TryCompareValue(left?.WinLabel, right?.WinLabel, $"cards[{cardIndex}].winLabel", builder))
            {
                isValid = false;
            }

            int cellCount = Math.Max(left?.Cells?.Length ?? 0, right?.Cells?.Length ?? 0);
            for (int cellIndex = 0; cellIndex < cellCount; cellIndex++)
            {
                Theme1CardCellRenderState leftCell = left != null && left.Cells != null && cellIndex < left.Cells.Length
                    ? left.Cells[cellIndex]
                    : Theme1CardCellRenderState.Empty;
                Theme1CardCellRenderState rightCell = right != null && right.Cells != null && cellIndex < right.Cells.Length
                    ? right.Cells[cellIndex]
                    : Theme1CardCellRenderState.Empty;

                if (!TryCompareValue(leftCell.NumberLabel, rightCell.NumberLabel, $"cards[{cardIndex}].cells[{cellIndex}].number", builder) ||
                    !TryCompareValue(leftCell.IsSelected, rightCell.IsSelected, $"cards[{cardIndex}].cells[{cellIndex}].selected", builder) ||
                    !TryCompareValue(leftCell.IsMissing, rightCell.IsMissing, $"cards[{cardIndex}].cells[{cellIndex}].missing", builder))
                {
                    isValid = false;
                }
            }
        }

        return isValid;
    }

    private static bool TryCompareBallRack(Theme1RoundRenderState expected, Theme1RoundRenderState actual, StringBuilder builder)
    {
        bool isValid =
            TryCompareValue(expected?.BallRack?.ShowBigBall ?? false, actual?.BallRack?.ShowBigBall ?? false, "ballRack.showBigBall", builder) &
            TryCompareValue(expected?.BallRack?.BigBallNumber, actual?.BallRack?.BigBallNumber, "ballRack.bigBallNumber", builder);

        int slotCount = Math.Max(expected?.BallRack?.Slots?.Length ?? 0, actual?.BallRack?.Slots?.Length ?? 0);
        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            Theme1BallSlotRenderState left = expected != null && expected.BallRack != null && expected.BallRack.Slots != null && slotIndex < expected.BallRack.Slots.Length
                ? expected.BallRack.Slots[slotIndex]
                : Theme1BallSlotRenderState.Empty;
            Theme1BallSlotRenderState right = actual != null && actual.BallRack != null && actual.BallRack.Slots != null && slotIndex < actual.BallRack.Slots.Length
                ? actual.BallRack.Slots[slotIndex]
                : Theme1BallSlotRenderState.Empty;

            if (!TryCompareValue(left.IsVisible, right.IsVisible, $"ballRack.slots[{slotIndex}].visible", builder))
            {
                isValid = false;
                continue;
            }

            if (left.IsVisible &&
                !TryCompareValue(left.NumberLabel, right.NumberLabel, $"ballRack.slots[{slotIndex}].number", builder))
            {
                isValid = false;
            }
        }

        return isValid;
    }

    private static bool TryCompareHud(Theme1RoundRenderState expected, Theme1RoundRenderState actual, StringBuilder builder)
    {
        return
            TryCompareValue(expected?.Hud?.CountdownLabel, actual?.Hud?.CountdownLabel, "hud.countdown", builder) &
            TryCompareValue(expected?.Hud?.PlayerCountLabel, actual?.Hud?.PlayerCountLabel, "hud.playerCount", builder) &
            TryCompareValue(expected?.Hud?.CreditLabel, actual?.Hud?.CreditLabel, "hud.credit", builder) &
            TryCompareValue(expected?.Hud?.WinningsLabel, actual?.Hud?.WinningsLabel, "hud.winnings", builder) &
            TryCompareValue(expected?.Hud?.BetLabel, actual?.Hud?.BetLabel, "hud.bet", builder);
    }

    private static bool TryCompareTopper(Theme1RoundRenderState expected, Theme1RoundRenderState actual, StringBuilder builder)
    {
        bool isValid = true;
        int slotCount = Math.Max(expected?.Topper?.Slots?.Length ?? 0, actual?.Topper?.Slots?.Length ?? 0);
        for (int slotIndex = 0; slotIndex < slotCount; slotIndex++)
        {
            Theme1TopperSlotRenderState left = expected != null && expected.Topper != null && expected.Topper.Slots != null && slotIndex < expected.Topper.Slots.Length
                ? expected.Topper.Slots[slotIndex]
                : Theme1TopperSlotRenderState.Empty;
            Theme1TopperSlotRenderState right = actual != null && actual.Topper != null && actual.Topper.Slots != null && slotIndex < actual.Topper.Slots.Length
                ? actual.Topper.Slots[slotIndex]
                : Theme1TopperSlotRenderState.Empty;

            if (!TryCompareValue(left.PrizeLabel, right.PrizeLabel, $"topper.slots[{slotIndex}].prize", builder))
            {
                isValid = false;
            }
        }

        return isValid;
    }

    private static bool TryCompareValue<T>(T expected, T actual, string label, StringBuilder builder)
    {
        if (Equals(expected, actual))
        {
            return true;
        }

        builder.AppendLine($"{label}: expected='{expected}' actual='{actual}'");
        return false;
    }
}

using TMPro;

public partial class APIManager
{
    private void RegisterDedicatedTheme1RenderMetrics(Theme1GameplayViewRoot viewRoot, Theme1DisplayState renderState)
    {
        int renderedCardCellCount = 0;
        for (int cardIndex = 0; viewRoot.Cards != null && cardIndex < viewRoot.Cards.Length; cardIndex++)
        {
            Theme1CardGridView card = viewRoot.Cards[cardIndex];
            for (int cellIndex = 0; card?.Cells != null && cellIndex < card.Cells.Length; cellIndex++)
            {
                TextMeshProUGUI label = card.Cells[cellIndex]?.PreferredRenderLabel;
                if (label == null)
                {
                    continue;
                }

                renderedCardCellCount += 1;
                if (renderedCardCellCount == 1)
                {
                    RegisterRealtimeCardTarget(label);
                }
            }
        }

        RegisterRealtimeTicketRender(activeTicketSets != null ? activeTicketSets.Count : 0, renderedCardCellCount);

        Theme1BallRackView ballRackView = viewRoot.BallRack;
        if (renderState?.BallRack == null || ballRackView == null)
        {
            return;
        }

        int lastVisibleSlot = -1;
        for (int slotIndex = 0; renderState.BallRack.Slots != null && slotIndex < renderState.BallRack.Slots.Length; slotIndex++)
        {
            if (renderState.BallRack.Slots[slotIndex].IsVisible)
            {
                lastVisibleSlot = slotIndex;
            }
        }

        if (lastVisibleSlot < 0 || renderState.BallRack.Slots == null || lastVisibleSlot >= renderState.BallRack.Slots.Length)
        {
            return;
        }

        int renderedTextTargetCount = ballRackView.Slots != null ? ballRackView.Slots.Length : 0;
        Theme1BallSlotView slotView = ballRackView.Slots != null && lastVisibleSlot < ballRackView.Slots.Length
            ? ballRackView.Slots[lastVisibleSlot]
            : null;
        int drawnNumber = int.TryParse(renderState.BallRack.Slots[lastVisibleSlot].NumberLabel, out int parsedDrawnNumber)
            ? parsedDrawnNumber
            : 0;
        RegisterRealtimeBallRendered(
            drawnNumber,
            lastVisibleSlot,
            renderedTextTargetCount,
            slotView?.NumberLabel,
            ballRackView.BigBallText);
    }
}

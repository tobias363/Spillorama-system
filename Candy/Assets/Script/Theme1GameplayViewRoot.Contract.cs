using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public sealed partial class Theme1GameplayViewRoot
{
    public bool ValidateContract(out string report)
    {
        List<string> errors = new List<string>();
        bool isValid = true;

        if (!string.Equals(gameObject.name, "Theme1ProductionRoot", StringComparison.Ordinal))
        {
            errors.Add($"Theme1GameplayViewRoot må ligge på GameObject 'Theme1ProductionRoot'. Fikk '{gameObject.name}'.");
            isValid = false;
        }

        if (GetComponent<RectTransform>() == null)
        {
            errors.Add("Theme1ProductionRoot mangler RectTransform.");
            isValid = false;
        }

        if (GetComponent<Theme1LayoutController>() == null)
        {
            errors.Add("Theme1ProductionRoot mangler Theme1LayoutController.");
            isValid = false;
        }

        if (runtimeNumberGenerator == null)
        {
            errors.Add("Theme1ProductionRoot mangler runtimeNumberGenerator.");
            isValid = false;
        }

        if (runtimeGameManager == null)
        {
            errors.Add("Theme1ProductionRoot mangler runtimeGameManager.");
            isValid = false;
        }

        if (runtimeApiManager == null)
        {
            errors.Add("Theme1ProductionRoot mangler runtimeApiManager.");
            isValid = false;
        }

        if (runtimeUiManager == null)
        {
            errors.Add("Theme1ProductionRoot mangler runtimeUiManager.");
            isValid = false;
        }

        if (cards == null || cards.Length != 4)
        {
            errors.Add($"Theme1GameplayViewRoot forventer 4 kort. Fikk {cards?.Length ?? 0}.");
            isValid = false;
        }

        if (cards != null)
        {
            for (int cardIndex = 0; cardIndex < cards.Length; cardIndex++)
            {
                Theme1CardGridView card = cards[cardIndex];
                if (card == null)
                {
                    errors.Add($"Card view {cardIndex} er null.");
                    isValid = false;
                    continue;
                }

                if (!ValidateText(card.HeaderLabel, $"cards[{cardIndex}].headerLabel", errors, requireActive: true))
                {
                    isValid = false;
                }

                if (card.RootRect == null)
                {
                    errors.Add($"cards[{cardIndex}].rootRect mangler.");
                    isValid = false;
                }

                if (!ValidateText(card.BetLabel, $"cards[{cardIndex}].betLabel", errors, requireActive: true))
                {
                    isValid = false;
                }

                if (card.SingleCardRerollButton == null)
                {
                    errors.Add($"cards[{cardIndex}].singleCardRerollButton mangler.");
                    isValid = false;
                }
                else
                {
                    string expectedName = Theme1GameplayViewRepairUtils.BuildSingleCardRerollButtonName(cardIndex);
                    if (!string.Equals(card.SingleCardRerollButton.gameObject.name, expectedName, StringComparison.Ordinal))
                    {
                        errors.Add($"cards[{cardIndex}].singleCardRerollButton har feil navn. Forventer '{expectedName}', fikk '{card.SingleCardRerollButton.gameObject.name}'.");
                        isValid = false;
                    }

                    if (card.SingleCardRerollButton.transform is not RectTransform)
                    {
                        errors.Add($"cards[{cardIndex}].singleCardRerollButton mangler RectTransform.");
                        isValid = false;
                    }
                }

                if (!ValidateText(card.WinLabel, $"cards[{cardIndex}].winLabel", errors, requireActive: false))
                {
                    isValid = false;
                }

                if (card.Cells == null || card.Cells.Length != Theme1CardCellCount)
                {
                    errors.Add($"cards[{cardIndex}].cells har feil lengde. Fikk {card.Cells?.Length ?? 0}.");
                    isValid = false;
                }
                else
                {
                    for (int cellIndex = 0; cellIndex < card.Cells.Length; cellIndex++)
                    {
                        Theme1CardCellView cell = card.Cells[cellIndex];
                        if (cell == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}] er null.");
                            isValid = false;
                            continue;
                        }

                        bool requireVisibleCell = cellIndex < Theme1VisibleCardCellCount;
                        if (!ValidateText(cell.NumberLabel, $"cards[{cardIndex}].cells[{cellIndex}].numberLabel", errors, requireActive: requireVisibleCell))
                        {
                            isValid = false;
                        }

                        if (cell.CellRoot == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].cellRoot mangler.");
                            isValid = false;
                        }

                        if (!Theme1GameplayViewRepairUtils.IsDedicatedCardNumberLabel(cell.NumberLabel, cell.SelectionOverlay))
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].numberLabel peker ikke til lokal Theme1 card number label.");
                            isValid = false;
                        }

                        if (cell.SelectionMarker == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].selectionMarker mangler.");
                            isValid = false;
                        }

                        if (cell.MissingOverlay == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].missingOverlay mangler.");
                            isValid = false;
                        }

                        if (cell.MatchedOverlay == null)
                        {
                            errors.Add($"cards[{cardIndex}].cells[{cellIndex}].matchedOverlay mangler.");
                            isValid = false;
                        }
                    }
                }
            }
        }

        if (ballRack == null)
        {
            errors.Add("ballRack mangler.");
            isValid = false;
        }
        else
        {
            if (ballRack.Slots == null || ballRack.Slots.Length != 30)
            {
                errors.Add($"ballRack.slots har feil lengde. Fikk {ballRack.Slots?.Length ?? 0}.");
                isValid = false;
            }
            else
            {
                for (int slotIndex = 0; slotIndex < ballRack.Slots.Length; slotIndex++)
                {
                    Theme1BallSlotView slot = ballRack.Slots[slotIndex];
                    if (slot == null)
                    {
                        errors.Add($"ballRack.slots[{slotIndex}] er null.");
                        isValid = false;
                        continue;
                    }

                    if (slot.Root == null)
                    {
                        errors.Add($"ballRack.slots[{slotIndex}].root mangler.");
                        isValid = false;
                    }

                    if (slot.SpriteTarget == null)
                    {
                        errors.Add($"ballRack.slots[{slotIndex}].spriteTarget mangler.");
                        isValid = false;
                    }
                }
            }

            if (ballRack.BigBallImage == null)
            {
                errors.Add("ballRack.bigBallImage mangler.");
                isValid = false;
            }
        }

        if (hudBar == null)
        {
            errors.Add("hudBar mangler.");
            isValid = false;
        }
        else
        {
            isValid &= ValidateText(hudBar.CountdownText, "hudBar.countdownText", errors, requireActive: true);
            isValid &= ValidateText(hudBar.RoomPlayerCountText, "hudBar.roomPlayerCountText", errors, requireActive: true);
            isValid &= ValidateText(hudBar.CreditText, "hudBar.creditText", errors, requireActive: true);
            isValid &= ValidateText(hudBar.WinningsText, "hudBar.winningsText", errors, requireActive: true);
            isValid &= ValidateText(hudBar.BetText, "hudBar.betText", errors, requireActive: true);
        }

        if (hudControls == null)
        {
            errors.Add("hudControls mangler.");
            isValid = false;
        }
        else if (!hudControls.Validate(errors))
        {
            isValid = false;
        }

        if (topperStrip == null || topperStrip.Slots == null || topperStrip.Slots.Length == 0)
        {
            errors.Add("topperStrip mangler slots.");
            isValid = false;
        }
        else
        {
            for (int slotIndex = 0; slotIndex < topperStrip.Slots.Length; slotIndex++)
            {
                Theme1TopperSlotView slot = topperStrip.Slots[slotIndex];
                if (slot == null)
                {
                    errors.Add($"topperStrip.slots[{slotIndex}] er null.");
                    isValid = false;
                    continue;
                }

                if (slot.PatternRoot == null)
                {
                    errors.Add($"topperStrip.slots[{slotIndex}].patternRoot mangler.");
                    isValid = false;
                }

                if (slot.MatchedPatternRoot == null)
                {
                    errors.Add($"topperStrip.slots[{slotIndex}].matchedPatternRoot mangler.");
                    isValid = false;
                }

                if (!ValidateText(slot.PrizeLabel, $"topperStrip.slots[{slotIndex}].prizeLabel", errors, requireActive: true))
                {
                    isValid = false;
                }
            }
        }

        report = string.Join(Environment.NewLine, errors);
        return isValid;
    }

    private static bool ValidateText(TextMeshProUGUI target, string label, List<string> errors, bool requireActive)
    {
        return CandyCardViewBindingValidator.ValidateTextTarget(target, label, requireActive, errors);
    }
}

using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

public sealed class CandyCardViewBindingSet : MonoBehaviour
{
    [SerializeField] private CandyCardViewBinding[] cards = new CandyCardViewBinding[4];

    public IReadOnlyList<CandyCardViewBinding> Cards => cards;

    public void PullFrom(NumberGenerator generator)
    {
        int targetCount = generator != null && generator.cardClasses != null ? generator.cardClasses.Length : 4;
        if (targetCount <= 0)
        {
            targetCount = 4;
        }

        EnsureCardArrayLength(targetCount);
        for (int i = 0; i < cards.Length; i++)
        {
            cards[i] ??= new CandyCardViewBinding();
            CardClass source = generator != null && generator.cardClasses != null && i < generator.cardClasses.Length
                ? generator.cardClasses[i]
                : null;
            cards[i].CopyFrom(source, $"Card {i + 1}");
        }
    }

    public bool TryApplyTo(NumberGenerator generator, out string error)
    {
        error = string.Empty;
        if (generator == null || generator.cardClasses == null)
        {
            error = "NumberGenerator/cardClasses mangler.";
            return false;
        }

        if (cards == null || cards.Length < generator.cardClasses.Length)
        {
            error = $"CandyCardViewBindingSet mangler kortbindinger. Trenger {generator.cardClasses.Length}, har {cards?.Length ?? 0}.";
            return false;
        }

        for (int i = 0; i < generator.cardClasses.Length; i++)
        {
            CandyCardViewBinding binding = cards[i];
            if (binding == null)
            {
                error = $"Card binding {i} er null.";
                return false;
            }

            binding.ApplyTo(generator.cardClasses[i]);
        }

        return true;
    }

    public bool Validate(out string report)
    {
        List<string> errors = new List<string>();
        bool isValid = true;
        if (cards == null || cards.Length != 4)
        {
            errors.Add($"CandyCardViewBindingSet forventer 4 kort. Fikk {cards?.Length ?? 0}.");
            isValid = false;
        }

        HashSet<int> numberTextIds = new HashSet<int>();
        if (cards != null)
        {
            for (int i = 0; i < cards.Length; i++)
            {
                CandyCardViewBinding binding = cards[i];
                if (binding == null)
                {
                    errors.Add($"Card binding {i} er null.");
                    isValid = false;
                    continue;
                }

                isValid &= binding.Validate(errors, i);
                IReadOnlyList<TextMeshProUGUI> numberTexts = binding.NumberTexts;
                for (int textIndex = 0; textIndex < numberTexts.Count; textIndex++)
                {
                    TextMeshProUGUI target = numberTexts[textIndex];
                    if (target == null)
                    {
                        continue;
                    }

                    if (!numberTextIds.Add(target.GetInstanceID()))
                    {
                        errors.Add($"Card[{i}] numberTexts[{textIndex}] gjenbrukes av flere celler.");
                        isValid = false;
                    }
                }
            }
        }

        report = string.Join(Environment.NewLine, errors);
        return isValid;
    }

    public int CountValidNumberTargets()
    {
        int total = 0;
        if (cards == null)
        {
            return 0;
        }

        for (int i = 0; i < cards.Length; i++)
        {
            if (cards[i] != null)
            {
                total += cards[i].CountValidNumberTargets();
            }
        }

        return total;
    }

    private void EnsureCardArrayLength(int targetCount)
    {
        if (cards == null || cards.Length != targetCount)
        {
            Array.Resize(ref cards, targetCount);
        }
    }
}

using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public sealed class CandyBallViewBindingSet : MonoBehaviour
{
    [SerializeField] private CandyBallSlotBinding[] slots = new CandyBallSlotBinding[30];
    [SerializeField] private Image bigBallImage;
    [SerializeField] private TextMeshProUGUI bigBallText;
    [SerializeField] private GameObject ballOutMachineAnimParent;
    [SerializeField] private GameObject ballMachine;
    [SerializeField] private GameObject extraBallMachine;
    [SerializeField] private GameObject[] extraBalls = Array.Empty<GameObject>();

    public IReadOnlyList<CandyBallSlotBinding> Slots => slots;
    public Image BigBallImage => bigBallImage;
    public TextMeshProUGUI BigBallText => bigBallText;
    public GameObject BallOutMachineAnimParent => ballOutMachineAnimParent;
    public GameObject BallMachine => ballMachine;
    public GameObject ExtraBallMachine => extraBallMachine;
    public IReadOnlyList<GameObject> ExtraBalls => extraBalls;

    public void PullFrom(BallManager manager)
    {
        if (manager == null)
        {
            return;
        }

        EnsureSlotArrayLength(manager.balls != null ? manager.balls.Count : 30);
        for (int i = 0; i < slots.Length; i++)
        {
            slots[i] ??= new CandyBallSlotBinding();
            GameObject root = manager.balls != null && i < manager.balls.Count ? manager.balls[i] : null;
            slots[i].CopyFrom(root, $"Ball {i + 1}");
        }

        bigBallImage = manager.bigBallImg;
        bigBallText = manager.bigBallImg != null ? manager.bigBallImg.GetComponentInChildren<TextMeshProUGUI>(true) : null;
        ballOutMachineAnimParent = manager.ballOutMachineAnimParent;
        ballMachine = manager.ballMachine;
        extraBallMachine = manager.extraBallMachine;
        extraBalls = CopyGameObjectList(manager.extraBalls);
    }

    public bool Validate(out string report)
    {
        List<string> errors = new List<string>();
        bool isValid = true;
        if (slots == null || slots.Length != 30)
        {
            errors.Add($"CandyBallViewBindingSet forventer 30 ballslotter. Fikk {slots?.Length ?? 0}.");
            isValid = false;
        }

        HashSet<int> slotRootIds = new HashSet<int>();
        HashSet<int> slotTextIds = new HashSet<int>();
        if (slots != null)
        {
            for (int i = 0; i < slots.Length; i++)
            {
                CandyBallSlotBinding slot = slots[i];
                if (slot == null)
                {
                    errors.Add($"Ball slot {i} er null.");
                    isValid = false;
                    continue;
                }

                isValid &= slot.Validate(errors, i);
                if (slot.Root != null && !slotRootIds.Add(slot.Root.GetInstanceID()))
                {
                    errors.Add($"Ball[{i}] root er duplikat.");
                    isValid = false;
                }

                if (slot.NumberText != null && !slotTextIds.Add(slot.NumberText.GetInstanceID()))
                {
                    errors.Add($"Ball[{i}] numberText er duplikat.");
                    isValid = false;
                }
            }
        }

        if (bigBallImage == null)
        {
            errors.Add("CandyBallViewBindingSet bigBallImage mangler.");
            isValid = false;
        }

        if (!CandyCardViewBindingValidator.ValidateTextTarget(bigBallText, "BigBallText", requireActive: true, errors))
        {
            isValid = false;
        }

        if (ballOutMachineAnimParent == null)
        {
            errors.Add("CandyBallViewBindingSet ballOutMachineAnimParent mangler.");
            isValid = false;
        }

        if (ballMachine == null)
        {
            errors.Add("CandyBallViewBindingSet ballMachine mangler.");
            isValid = false;
        }

        if (extraBallMachine == null)
        {
            errors.Add("CandyBallViewBindingSet extraBallMachine mangler.");
            isValid = false;
        }

        report = string.Join(Environment.NewLine, errors);
        return isValid;
    }

    public int CountValidBallTextTargets()
    {
        int total = 0;
        if (slots == null)
        {
            return 0;
        }

        for (int i = 0; i < slots.Length; i++)
        {
            if (slots[i] != null && slots[i].NumberText != null)
            {
                total += 1;
            }
        }

        return total;
    }

    private void EnsureSlotArrayLength(int targetCount)
    {
        if (targetCount <= 0)
        {
            targetCount = 30;
        }

        if (slots == null || slots.Length != targetCount)
        {
            Array.Resize(ref slots, targetCount);
        }
    }

    private static GameObject[] CopyGameObjectList(List<GameObject> source)
    {
        if (source == null)
        {
            return Array.Empty<GameObject>();
        }

        GameObject[] result = new GameObject[source.Count];
        for (int i = 0; i < source.Count; i++)
        {
            result[i] = source[i];
        }

        return result;
    }
}

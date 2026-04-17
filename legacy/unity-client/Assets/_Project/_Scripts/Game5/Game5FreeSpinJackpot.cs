using System.Collections;
using System.Collections.Generic;
using System.Linq;
#if !UNITY_WEBGL
using I2.Loc;
#endif
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class Game5FreeSpinJackpot : MonoBehaviour
{
    #region PRIVATE_VARIABLES
    private string gameId = "";
    private string ticketId = "";
    private bool isSpinning;
    [SerializeField] private GameObject wheelObject;
    private const int DefaultAutoTurnTime = 10;
    private int autoTurnTime = DefaultAutoTurnTime;

    [Header("Wheel Prize List")]
    [SerializeField] private TMP_Text[] WheelPrizes;
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTimer;
    [SerializeField] private Button btnSpin;

    [Header("Jackpot Wheel Plates Data")]
    [SerializeField] private int[] PlatesData;
    [SerializeField] private float[] PlatesVectorValues;

    [SerializeField] private int SampleInput;
    #endregion

    #region PUBLIC_METHODS

    public void Open(string gameId, string ticketId, WheelOfFortuneData wheelOfFortuneData)
    {
        this.gameId = gameId;
        this.ticketId = ticketId;
        this.Open();
        SetWheelPrizesData(wheelOfFortuneData.prizeList);
        isSpinningWOF = false;
        autoTurnTime = DefaultAutoTurnTime;
        StartAutoTurn();
    }

    public void spinButtonTab()
    {
        // TODO: Replace with Spillorama REST endpoint for WOF auto spin
        Debug.LogWarning("[Game5] spinButtonTab (WOF): Spillorama endpoint not yet implemented");
    }

    #endregion

    #region PRIVATE_METHODS

    private void animJackpotWheel(int inputNumber, float inputTime = 7f)
    {
        if (isSpinningWOF)
            return;

        gameObject.transform.localRotation = Quaternion.identity;
        isSpinningWOF = true;
        float targetRotation = transform.rotation.eulerAngles.z + 1800 + PlatesVectorValues[GetRandomTargetPlateIndex(inputNumber)];
        LeanTween.rotateZ(wheelObject, targetRotation, inputTime)
                .setEase(LeanTweenType.easeOutCubic)
                .setOnComplete(() =>
                {
                    isSpinning = false;
                });
    }

    private void SetWheelPrizesData(List<long> prizeList)
    {
        if (prizeList.Count != WheelPrizes.Length)
        {
            Debug.LogError("Mismatch in the lengths of prizeList and WheelPrizes");
            return;
        }

        for (int i = 0; i < prizeList.Count; i++)
        {
            WheelPrizes[i].text = prizeList[i].ToString() + " Spinn";
        }
    }

    private int GetRandomTargetPlateIndex(int valueToFind)
    {
        List<int> indices = new List<int>();

        for (int i = 0; i < PlatesData.Length; i++)
        {
            if (PlatesData[i] == valueToFind)
                indices.Add(i);
        }

        if (indices.Count == 0)
            return -1;

        return indices[UnityEngine.Random.Range(0, indices.Count)];
    }

    private void StopTimer()
    {
        StopAllCoroutines();
        txtTimer.text = "";
    }

    private void StartAutoTurn()
    {
        StopAllCoroutines();
        StartCoroutine(AutoTurn());
    }

    #endregion

    #region COROUTINES
    IEnumerator AutoTurn()
    {
        for (int i = autoTurnTime; i >= 0; i--)
        {
            txtTimer.text = "00:" + i.ToString("00");
            yield return new WaitForSeconds(1);
        }
        txtTimer.text = "";
    }
    #endregion

    #region GETTER_SETTER
    public bool isSpinningWOF
    {
        set
        {
            isSpinning = value;
            btnSpin.interactable = !value;
        }
        get
        {
            return isSpinning;
        }
    }
    #endregion
}

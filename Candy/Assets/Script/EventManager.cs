using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EventManager : MonoBehaviour
{
    public static Action<int, int> OnPayAmt;
    public static Action OnPlay;
    public static Action OnStartTimer;

    public static Action<int> OnAutoSpinStart;
    public static Action<bool> OnAutoSpinOver;
    
    public static Action<List<int>> OnGenerateBall;
    public static Action<int> OnBallDisplay;
    public static Action<List<int>, bool, bool> OnGenerateExtraBall;
    public static Action<bool> OnTapForExtraBall;
    public static Action<int, bool> OnExtraBallCompletion;

    public static Action<int, bool> OnMatchedPattern;
    public static Action<int, int, bool, int, int> OnMissingPattern;

    public static Action OnBonusOver;
       
    public static bool isPlayOver = false;
    public static bool isAutoSpinStart = false;
    //public static bool isAutoSpinOver = false;

    private static bool IsProductionAutoPlayBlocked()
    {
        return !Application.isEditor && !Debug.isDebugBuild;
    }

    public static void Play()
    {
        OnPlay?.Invoke();
    }
    public static void AutoSpinStart(int count)
    {
        if (IsProductionAutoPlayBlocked() && count > 1)
        {
            Debug.LogWarning("[EventManager] AutoSpin > 1 er deaktivert i production build.");
            OnAutoSpinOver?.Invoke(true);
            return;
        }
        OnAutoSpinStart?.Invoke(count);
    }
    public static void AutoSpinOver(bool gameOver)
    {
        OnAutoSpinOver?.Invoke(gameOver);
    }
    public static void AddWinAmt(int cardNo, int payLineIndex)
    {
        OnPayAmt?.Invoke(cardNo, payLineIndex);
    }
    public static void GenerateBall(List<int> ballIndexList)
    {
        OnGenerateBall?.Invoke(ballIndexList);
    }
    public static void GenerateExtraBall(List<int> ballIndexList, bool showExtraBall, bool showFreeExtraBalls)
    {
        OnGenerateExtraBall?.Invoke(ballIndexList, showExtraBall, showFreeExtraBalls);
    }
    public static void TapForExtraBall(bool isExtraBallLeft)
    {
        OnTapForExtraBall?.Invoke(isExtraBallLeft);
    }
    public static void ShowBallOnCard(int num)
    {
        OnBallDisplay?.Invoke(num);
    }
    public static void ShowMissingPL(int cardNo, bool isExtraBallDone)
    {
        OnExtraBallCompletion?.Invoke(cardNo, isExtraBallDone);
    }
    public static void ShowMatchedPattern(int index, bool active)
    {
        OnMatchedPattern?.Invoke(index, active);
    }
    public static void ShowMissingPattern(int patternIndex, int colIndex, bool active, int missingNumber = 0, int cardNo = -1)
    {
        OnMissingPattern?.Invoke(patternIndex, colIndex, active, missingNumber, cardNo);
    }

    public static void StartTimer()
    {
        OnStartTimer?.Invoke();
    }

    public static void PlayOnBonusOver()
    {
        OnBonusOver?.Invoke();
    }
}

using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;
using UnityEngine.UI;

public class GameManager : MonoBehaviour
{
    public static GameManager instance;

    [Header("Testing Speed")]
    [SerializeField] private bool increaseGameSpeedInTesting = true;
    [SerializeField] [Range(1f, 5f)] private float testingSpeedMultiplier = 3.5f;

    public int extraBallTotal;
    public NumberGenerator numberGenerator;
    public TextMeshProUGUI displayTotalMoney;
    public TextMeshProUGUI displayCurrentBets;
    public TextMeshProUGUI winAmtText;
    public List<TextMeshProUGUI> CardBets;
    public Button btn_creditUp;
    public Button btn_creditDown;
    public List<TextMeshProUGUI> displayCurrentPoints = new List<TextMeshProUGUI>();
    public List<TextMeshProUGUI> displayCardWinPoints = new List<TextMeshProUGUI>();
    public List<AllWinPoints> allWinPoints = new List<AllWinPoints>();
    public List<int> currentWinPoints = new List<int>();
    public List<int> totalBets = new List<int>();
    public int NumberOfCard = 0;

    public int totalMoney = 0;
    public int currentBet;
    public static int winAmt;
    private List<int> cardWin = new List<int>();
    private int roundBonusTotal = 0;
    private int creditedRoundWinTotal = 0;
    public int betlevel;
    public List<int> winList;
    private ThemeMathEngine themeMathEngine;
    private bool testingSpeedApplied;
    private void OnEnable()
    {
        EventManager.OnPayAmt += ShowWinAmt;
        EventManager.OnPlay += OnPlay;
    }

    private void OnDisable()
    {
        EventManager.OnPayAmt -= ShowWinAmt;
        EventManager.OnPlay -= OnPlay;
        RestoreTestingSpeedIfApplied();

    }

    void Awake()
    {
        instance = this;
        ApplyTestingSpeedIfEnabled();
    }
    // Start is called before the first frame update
    void Start()
    {
        SetTotalMoney(1000);
        SetCurrentBets(betlevel);
        EnsureRoundStateCollections();
        ResetRoundWinState();
    }

    private void EnsureRoundStateCollections()
    {
        if (winList == null)
        {
            winList = new List<int>();
        }

        if (cardWin == null)
        {
            cardWin = new List<int>();
        }

        while (cardWin.Count < displayCardWinPoints.Count)
        {
            cardWin.Add(0);
        }
    }

    private void ResetRoundWinState()
    {
        EnsureRoundStateCollections();

        winAmt = 0;
        roundBonusTotal = 0;
        creditedRoundWinTotal = 0;
        winList.Clear();
        if (winAmtText != null)
        {
            winAmtText.text = "0";
        }

        for (int i = 0; i < displayCardWinPoints.Count; i++)
        {
            cardWin[i] = 0;
            displayCardWinPoints[i].text = "WIN - 0";
        }
    }

    private void OnDestroy()
    {
        RestoreTestingSpeedIfApplied();
    }

    private void OnPlay()
    {
        SetTotalMoney(-currentBet);
        ResetRoundWinState();
    }
    public void BetUp()
    {
        if (totalBets.Count - 1 > betlevel)
        {
            betlevel++;
            Debug.Log("??????????? : " + betlevel );
            SetCurrentBets(betlevel);
            btn_creditDown.interactable = true;
        }

        if (totalBets.Count - 1 <= betlevel)
        {
            btn_creditUp.interactable = false;
        }
        else
        {
            btn_creditUp.interactable = true;
        }
    }

    public void BetDown()
    {
        if (betlevel >= 1)
        {
            betlevel--;
            Debug.Log("??????????? : " + betlevel );
            SetCurrentBets(betlevel);
            btn_creditUp.interactable = true;
        }

         if (betlevel <=  0)
        {
            btn_creditDown.interactable = false;
        }
        else
        {
            btn_creditDown.interactable = true;
        }
    }

    public void SetTotalMoney(int atm)
    {
        totalMoney += atm;
        displayTotalMoney.text = totalMoney.ToString() ;
    }

    void SetCurrentBets(int lvl)
    {
        currentBet = totalBets[lvl];
        displayCurrentBets.text = currentBet.ToString();
        APIManager.instance?.SetRealtimeEntryFeeFromGameUI(currentBet);
        for (int i = 0; i < CardBets.Count; i++)
        {
            CardBets[i].text = "= "+(currentBet / 4).ToString();
        }
        
        currentWinPoints = allWinPoints[lvl].points;
        
        for (int i = 0; i < displayCurrentPoints.Count; i++)
        {
            displayCurrentPoints[i].text = currentWinPoints[i].ToString();
        }
        //themeMathEngine = new ThemeMathEngine(this);
    }

    public void AddBonusPayoutToCurrentRound(int bonusAmount)
    {
        if (bonusAmount <= 0)
        {
            Debug.LogWarning($"[GameManager] Ignorerer bonus payout <= 0 ({bonusAmount}).");
            return;
        }

        roundBonusTotal += bonusAmount;
        RefreshRoundWinningTotals();
    }

    void ShowWinAmt(int cardNo, int index)
    {
        EnsureRoundStateCollections();
        if (cardNo < 0 || cardNo >= cardWin.Count)
        {
            return;
        }

        int resolvedWin = ResolvePatternWinAmount(index);
        if (resolvedWin <= cardWin[cardNo])
        {
            return;
        }

        cardWin[cardNo] = resolvedWin;
        if (cardNo < displayCardWinPoints.Count && displayCardWinPoints[cardNo] != null)
        {
            displayCardWinPoints[cardNo].text = "WIN - " + cardWin[cardNo];
        }

        RefreshRoundWinningTotals();
    }

    private int ResolvePatternWinAmount(int patternIndex)
    {
        if (currentWinPoints == null || currentWinPoints.Count == 0)
        {
            return 0;
        }

        if (patternIndex < 5)
        {
            return currentWinPoints[Mathf.Clamp(patternIndex, 0, currentWinPoints.Count - 1)];
        }

        if (patternIndex >= 5 && patternIndex <= 7)
        {
            return currentWinPoints[Mathf.Clamp(5, 0, currentWinPoints.Count - 1)];
        }

        if (patternIndex > 7 && patternIndex < 13)
        {
            return currentWinPoints[Mathf.Clamp(patternIndex - 2, 0, currentWinPoints.Count - 1)];
        }

        return currentWinPoints[currentWinPoints.Count - 1];
    }

    private void RefreshRoundWinningTotals()
    {
        EnsureRoundStateCollections();

        int cardTotal = 0;
        for (int i = 0; i < cardWin.Count; i++)
        {
            cardTotal += Mathf.Max(0, cardWin[i]);
        }

        int totalRoundWinning = Mathf.Max(0, cardTotal + roundBonusTotal);
        winAmt = totalRoundWinning;
        if (winAmtText != null)
        {
            winAmtText.text = totalRoundWinning.ToString();
        }

        winList.Clear();
        winList.Add(totalRoundWinning);

        int delta = totalRoundWinning - creditedRoundWinTotal;
        if (delta > 0)
        {
            SetTotalMoney(delta);
            creditedRoundWinTotal = totalRoundWinning;
        }
    }

    public void SetRoundWinningTotalFromRealtime(int totalRoundWinning)
    {
        totalRoundWinning = Mathf.Max(0, totalRoundWinning);
        roundBonusTotal = 0;
        winAmt = totalRoundWinning;
        if (winAmtText != null)
        {
            winAmtText.text = totalRoundWinning.ToString();
        }

        EnsureRoundStateCollections();
        winList.Clear();
        winList.Add(totalRoundWinning);

        int delta = totalRoundWinning - creditedRoundWinTotal;
        if (delta > 0)
        {
            SetTotalMoney(delta);
        }
        creditedRoundWinTotal = totalRoundWinning;
    }

    private void ApplyTestingSpeedIfEnabled()
    {
        if (!increaseGameSpeedInTesting)
        {
            return;
        }

        if (!Application.isEditor && !Debug.isDebugBuild)
        {
            return;
        }

        float resolvedMultiplier = Mathf.Max(1f, testingSpeedMultiplier);
        Time.timeScale = resolvedMultiplier;
        testingSpeedApplied = true;
        Debug.Log($"[GameManager] Testing speed active: {resolvedMultiplier:0.##}x");
    }

    private void RestoreTestingSpeedIfApplied()
    {
        if (!testingSpeedApplied)
        {
            return;
        }

        testingSpeedApplied = false;
        Time.timeScale = 1f;
    }
}
[System.Serializable]
public class AllWinPoints
{
    public List<int> points = new List<int>();
}

using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;
using UnityEngine.UI;
using System.Linq;
using System;

public class GameManager : MonoBehaviour
{
    public static GameManager instance;
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
    public int betlevel;
    public List<int> winList;
    private ThemeMathEngine themeMathEngine;
    private void OnEnable()
    {
        EventManager.OnPayAmt += ShowWinAmt;
        EventManager.OnPlay += OnPlay;
    }

    private void OnDisable()
    {
        EventManager.OnPayAmt -= ShowWinAmt;
        EventManager.OnPlay -= OnPlay;

    }

    void Awake()
    {
        instance = this;
        
    }
    // Start is called before the first frame update
    void Start()
    {
        SetTotalMoney(1000);
        SetCurrentBets(betlevel);
        for (int i = 0; i < displayCardWinPoints.Count; i++)
        {
            cardWin.Add(0);
            displayCardWinPoints[i].text = "WIN - 0";
        }
    }

    private void OnPlay()
    {
        SetTotalMoney(-currentBet);
        winAmt = 0;
        if(winList.Count > 0) { winList.Clear(); }
        winAmtText.text = "0";
        for (int i = 0; i < displayCardWinPoints.Count; i++)
        {
            cardWin[i] = 0;
            displayCardWinPoints[i].text = "WIN - 0";
        }
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
    
    void ShowWinAmt(int cardNo, int index)
    {
        
        if (index < 5) //other
        {
            winAmt = currentWinPoints[index];
        }
        else if (index >= 5 && index <= 7) //For 2L
        {
            winAmt = currentWinPoints[5];
        }
        else if (index > 7 && index < 13)
        {
            winAmt = currentWinPoints[index - 2];
        }
        else if (index >= 13) //For 1L
        {
            winAmt = currentWinPoints[currentWinPoints.Count - 1]; 
        }

        cardWin[cardNo] += winAmt;

        displayCardWinPoints[cardNo].text = "WIN - "+ cardWin[cardNo].ToString() ;

        winList.Add(winAmt);
        winAmtText.text = winList.Sum(x => Convert.ToInt32(x)).ToString();
        SetTotalMoney(winList.Sum(x => Convert.ToInt32(x)));

       
    }
}
[System.Serializable]
public class AllWinPoints
{
    public List<int> points = new List<int>();
}

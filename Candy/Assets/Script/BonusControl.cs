using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using TMPro;
using DG.Tweening;
using UnityEngine.UI;
using System.Linq;

public class BonusControl : MonoBehaviour
{

    public GameManager gameManager;
    public GameObject bonusCanvas;
    public int bonusAmt;

    [SerializeField]
    int winPlace = 8 ;
    public MoveText[] moveText;    
    public GameObject[] allObj;
    public float[] finalPos;
    public TextMeshProUGUI[] displayBox;
    public int[] allpoints;
    public int[] turns;
    public Transform instaPoint;
    public Button playBtn;
    public TextMeshProUGUI displayWin;
    public TextMeshProUGUI displayCredit;

    int ctr = 2;
    bool stopMoving;

    int winningMoney;
  
    int currentSpins;
    int currentReward;
    int chocPlace = 0;
    bool bonusPayoutApplied;
    private MoveText[] cachedMoveTextComponents;
    private TextMeshProUGUI[] cachedRollingLabels;
    private GameObject[] cachedDisplayMarkers;

    
    private void Awake()
    {
        CacheComponentRefs();
    }

    private void OnEnable()
    {
        CacheComponentRefs();
        ctr = 2;
        stopMoving = false;
        currentSpins = 0;
        currentReward = 0;
        chocPlace = 0;
        winAmt = 0;
        bonusPayoutApplied = false;
        if (displayWin != null)
        {
            displayWin.text = "0";
        }
        displayCredit.text = gameManager.displayTotalMoney.text;
        SetRewards();
    }
    
     private void Start()
    {
       
    }


    public void StartMoving()
    {
        playBtn.interactable = false;

        ctr = 2;
        stopMoving = false;
        for (int i = 0; i < allObj.Length; i++)
        {
            if (allObj[i].activeSelf)
            {
                MoveText move = cachedMoveTextComponents[i];
                if (move == null)
                {
                    continue;
                }

                move.finalTarget = -120;
                move.isFinalObje = false;
                move.Move();
            }
        }

        Invoke(nameof(Stop), 3f);
    }

    void Stop()
    {
        stopMoving = true;
        
    }

    void EndGame()
    {
        bonusCanvas.SetActive(false);
        EventManager.PlayOnBonusOver();
    }
    public void GenerateNewObj()
    {
        int no = Random.Range(0, allObj.Length);

        while (allObj[no].activeSelf)
        {
            no = Random.Range(0, allObj.Length);
        }

        allObj[no].transform.localPosition = instaPoint.localPosition;
        MoveText moveText = cachedMoveTextComponents[no];
        TextMeshProUGUI rollingLabel = cachedRollingLabels[no];
        if (moveText == null || rollingLabel == null)
        {
            return;
        }

        moveText.onlyOnce = false;

        if (!stopMoving)
        {

            moveText.isFinalObje = false;
            moveText.finalTarget = -120;
            if (Random.Range(0, 5) != 2)
            {
                rollingLabel.text = Random.Range(1, 9).ToString();
            }
            else
            {
                rollingLabel.text = "STOP";
               
            }
        }
        else
        {
            moveText.isFinalObje = true;
            moveText.finalTarget = finalPos[ctr];

            currentReward = turns[currentSpins];
            if (ctr == 1)
            {
                if (turns[currentSpins] != -1)
                {
                    rollingLabel.text = turns[currentSpins].ToString();
                }
                else
                {
                    rollingLabel.text = "STOP";
                    
                }
            }
            ctr--;
        }

        SetActiveIfChanged(allObj[no], true);
        moveText.Move();
    }

    public void WhenReached()
    {
        currentSpins++;
        if (currentReward != -1)
        {
            StartCoroutine(MoveToWinPlace());
        }
        else
        {
            Invoke(nameof(EndGame), 2);
            //End Bonus
        }
    }

    int winAmt = 0;
    IEnumerator MoveToWinPlace()
    {
        yield return new WaitForSeconds(1f);

        if (chocPlace >= 0 && chocPlace < cachedDisplayMarkers.Length)
        {
            SetActiveIfChanged(cachedDisplayMarkers[chocPlace], false);
        }

        // Ensure the loop doesn't exceed the array bounds
        int targetIndex = Mathf.Min(chocPlace + currentReward + 1, displayBox.Length);
        for (int i = chocPlace + 1; i < targetIndex; i++)
        {
            displayBox[i].transform.DOKill(false);
            displayBox[i].transform.DOPunchScale(new Vector3(1.2f, 1.2f, 1.2f), 0.5f, 1, 1);
            yield return new WaitForSeconds(0.5f);
        }

        chocPlace += currentReward;
        
        // Ensure chocPlace doesn't exceed the array bounds
        chocPlace = Mathf.Min(chocPlace, displayBox.Length - 1);
        if (chocPlace >= 0 && chocPlace < cachedDisplayMarkers.Length)
        {
            SetActiveIfChanged(cachedDisplayMarkers[chocPlace], true);
        }
        displayWin.text = displayBox[chocPlace].text.ToString();
        if (!int.TryParse(displayBox[chocPlace].text, out int awardedAmount))
        {
            Debug.LogError($"[BonusControl] Ugyldig bonusverdi i displayBox[{chocPlace}]: {displayBox[chocPlace].text}");
            awardedAmount = 0;
        }
        winAmt += awardedAmount;
        if (!bonusPayoutApplied && awardedAmount > 0)
        {
            bonusPayoutApplied = true;
            gameManager.AddBonusPayoutToCurrentRound(awardedAmount);
        }
        else if (bonusPayoutApplied)
        {
            Debug.LogWarning("[BonusControl] Bonus payout var allerede registrert i denne runden. Hopper over duplikat.");
        }
        displayCredit.text = gameManager.displayTotalMoney.text;
        Invoke(nameof(EndGame), 2);
        // if (currentReward != -1)
        // {
        //     playBtn.interactable = true;
        // }
    }

    void SetRewards()
    {
        if (APIManager.instance == null)
        {
            Debug.LogError("[BonusControl] APIManager.instance mangler. Kan ikke lese bonusAMT.");
            bonusAmt = 0;
        }
        else
        {
            bonusAmt = APIManager.instance.bonusAMT;
        }

        // winningMoney = 10000;
        // winningMoney = Random.Range(4, 100) * 100;

        // if (winningMoney <= 400)
        // {
        //     winPlace = Random.Range(1, 3);
        // }
        // else if (winningMoney <= 1000)
        // {
        //     winPlace = Random.Range(2, 4);
        // }
        // else if (winningMoney <= 2000)
        // {
        //     winPlace = Random.Range(3, 7);
        // }
        // else if (winningMoney <= 3000)
        // {
        //     winPlace = Random.Range(4, 9);
        // }
        // else
        // {
        //     winPlace = Random.Range(6, 16);
        // }

       // Debug.Log(winPlace);
       // allpoints = new int[displayBox.Length];

        bool foundExactBonus = false;
        for (int i = 0; i < allpoints.Length; i++)
        {
            if (allpoints[i] == bonusAmt)
            {
                winPlace = i + 1;
                foundExactBonus = true;
                break; // Stops the loop once the bonusAmt is found
            }
        }

        if (!foundExactBonus)
        {
            Debug.LogWarning($"[BonusControl] Fant ikke bonusAmt={bonusAmt} i allpoints. Bruker fallback winPlace={winPlace}.");
            winPlace = Mathf.Clamp(winPlace, 1, Mathf.Max(1, allpoints.Length));
        }
        int[] removepoints = { 100, 150, 200, 250 };

        //allpoints[winPlace - 1] = winningMoney;
       
        if (winPlace != 1)
        {
            for (int i = winPlace - 2; i >= 0; i--)
            {
                //allpoints[i] = allpoints[i + 1] - removepoints[Random.Range(0, 4)];
                 //Debug.Log( "allpoints[i] : " + allpoints[i]);

            }
        }

        for (int i = winPlace; i < allpoints.Length; i++)
        {
            //allpoints[i] = allpoints[i - 1] + removepoints[Random.Range(0, 4)];
            // Debug.Log( "allpoints[i] : " + allpoints[i]);
        }
    

        for (int i = 1; i < displayBox.Length; i++)
        {
            displayBox[i].text = allpoints[i - 1].ToString();
            //Debug.Log( "allpoints[i] : " + allpoints[i]);
        }
        SetTurn();
    }

    void SetTurn()
    {
        // if (winPlace < 2)
        // {
        //     turns = new int[2];
        //     turns[0] = winPlace;
        //     turns[1] = -1;

        // }
        // else if (winPlace < 4)
        // {
        //     turns = new int[3];
        //     turns[0] = Random.Range(1, 2);
        //     turns[1] = winPlace - turns[0];
        //     turns[2] = -1;
        // }
        // else if (winPlace < 7)
        // {
        //     turns = new int[4];
        //     turns[0] = Random.Range(1, 3);
        //     turns[1] = Random.Range(1, 2);
        //     turns[2] = winPlace - turns[1] - turns[0];
        //     turns[3] = -1;
        // }
        // else if (winPlace < 10)
        // {
        //     turns = new int[5];
        //     turns[0] = Random.Range(1, 3);
        //     turns[1] = Random.Range(1, 2);
        //     turns[2] = Random.Range(1, 4);
        //     turns[3] = winPlace - turns[2] - turns[1] - turns[0];
        //     turns[4] = -1;
        // }
        // else
        // {
        //     turns = new int[6];
        //     turns[0] = Random.Range(1, 3);
        //     turns[1] = Random.Range(2, 4);
        //     turns[2] = Random.Range(1, 2);
        //     turns[3] = Random.Range(2, 4);
        //     turns[4] = winPlace - turns[3] - turns[2] - turns[1] - turns[0];
        //     turns[5] = -1;
        // }
     
        
         turns = new int[1];
         turns[0] = winPlace;
         //turns[1] = -1;

        StartCoroutine(DisplayTexts());
    }

    IEnumerator DisplayTexts()
    {
        yield return new WaitForSeconds(0.5f);
        for (int i = 1; i < displayBox.Length; i++)
        {
            SetActiveIfChanged(displayBox[i] != null ? displayBox[i].gameObject : null, true);
            displayBox[i].transform.DOKill(false);
            displayBox[i].transform.DOPunchScale(new Vector3(1.2f, 1.2f, 1.2f), 0.5f, 1, 1);
            yield return new WaitForSeconds(0.1f);

        }
        yield return new WaitForSeconds(1f);

        playBtn.interactable = true;
    }

    private void CacheComponentRefs()
    {
        int rollingCount = allObj != null ? allObj.Length : 0;
        cachedMoveTextComponents = new MoveText[rollingCount];
        cachedRollingLabels = new TextMeshProUGUI[rollingCount];

        for (int i = 0; i < rollingCount; i++)
        {
            GameObject obj = allObj[i];
            if (obj == null)
            {
                continue;
            }

            cachedMoveTextComponents[i] = obj.GetComponent<MoveText>();
            cachedRollingLabels[i] = obj.GetComponent<TextMeshProUGUI>();
        }

        int displayCount = displayBox != null ? displayBox.Length : 0;
        cachedDisplayMarkers = new GameObject[displayCount];
        for (int i = 0; i < displayCount; i++)
        {
            TextMeshProUGUI box = displayBox[i];
            if (box == null || box.transform.childCount == 0)
            {
                continue;
            }

            cachedDisplayMarkers[i] = box.transform.GetChild(0).gameObject;
        }
    }

    private static void SetActiveIfChanged(GameObject target, bool active)
    {
        if (target != null && target.activeSelf != active)
        {
            target.SetActive(active);
        }
    }
}

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.Profiling;
using UnityEngine.UI;

public partial class Game5GamePlayPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtLastWithdrawNumber;
    [SerializeField] private TextMeshProUGUI txtWithdrawNumberStats;

    [Header("Button")]
    [SerializeField] private Button btnPlay;

    [Header("Game Object")]
    [SerializeField] private GameObject objectDetailPanel;

    [Header("Panels")]
    // [SerializeField] private UtilityMessagePanel messagePopup;
    [SerializeField] private UtilityLoaderPanel loaderPanel;

    [Header("Transform")]
    [SerializeField] private Transform transformPatternContainer;
    [SerializeField] private Transform transformTicketContainer;


    [Header("Prefabs")]
    [SerializeField] private PrefabBingoGame5Ticket3x3 prefabBingoGame5Ticket3X3;
    [SerializeField] private PrefabBingoGame5Pattern prefabBingoGame5Pattern;


    [Header("Ticket colours")]
    public Color32 blue;
    public Color32 green;
    public Color32 red;
    public Color32 purple;

    [Header("Ticket Images")]
    public Sprite spriteBlue;
    public Sprite spriteGreen;
    public Sprite spriteRed;
    public Sprite spritePurple;

    [Header("Mini Games")]
    public Game5FreeSpinJackpot game5FreeSpinJackpot;
    public Game5JackpotRouletteWheel game5JackpotRouletteWheel;


    [Header("Data")]
    [SerializeField] public Game5Data game5Data;
    [SerializeField] public BingoGame5FinishResponse bingoGame5FinishResponse;
    private List<PrefabBingoGame5Ticket3x3> ticketList = new List<PrefabBingoGame5Ticket3x3>();
    private List<PrefabBingoGame5Pattern> patternList = new List<PrefabBingoGame5Pattern>();

    [SerializeField] private ActivateGame5JackpotMiniGameResponse miniGameData;


    private bool _isGamePlayInProcess = false;
    private bool _isTicketOptionEnable = false;


    [Header("Roulette Wheel Controller")]
    public GameObject roulateSpinnerElements;
    [SerializeField] public DrumRotation roulateSpinner;
    public List<GameObject> txtRoulettePlatesSelect;
    public GameObject rouletteWheel;
    public GameObject[] balls;

    [Header("Center Ball Elements")]
    [SerializeField] private SpriteRenderer spriteCenterBall;
    [SerializeField] private TextMesh spriteCenterBallText;

    public int SampleInput;

    public bool isMiniGameActivated = false;

    [Header("Co-Routines")]
    Coroutine Co_Routines_OnGameFinished;

    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        UIManager.Instance.isGame5 = true;

        GameSocketManager.OnSocketReconnected += Reconnect;

        EnableBroadcasts();
        CloseMiniGames();
        roulateSpinnerElements.SetActive(UIManager.Instance.Game5ActiveElementAction());
        if (UIManager.Instance.isBreak)
        {
            CallSubscribeRoom();
            UIManager.Instance.breakTimePopup.OpenPanel("null");
        }
        else
        {
            CallSubscribeRoom();
        }
    }

    private void OnDisable()
    {
        SoundManager.Instance.StopNumberAnnouncement();
        UIManager.Instance.isGame5 = false;

        GameSocketManager.OnSocketReconnected -= Reconnect;

        DisableBroadcasts();
        EventManager.Instance.UnSubscribeGame5Room(UIManager.Instance.game5Panel.game5GamePlayPanel.game5Data.gameId, (socket, packet, args) =>
        {
            Debug.Log("UnSubscribeGame5Room Response: " + packet.ToString());
        });
    }

    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void SetData(Game5Data game5data = null)
    {
        this.game5Data = game5data;
        Reset();
        GenerateRoulateBallData();
        GeneratePatterns(game5Data.patternList);
        GenerateTickets(game5Data);
        RefreshwithdrawBalls();
        CallPlayerHallLimitEvent();
    }

    private void RefreshwithdrawBalls()
    {
        foreach (BingoNumberData bingoNumberData in game5Data.withdrawBalls)
        {
            WithdrawBingoBallAction(bingoNumberData);
            HighlightBall(GetTargetPlateIndex(bingoNumberData.number), true);
        }
    }

    public void OnPlayButtonTap()
    {
        btnPlay.interactable = false;
        CallGame5PlayEvent();
    }

    // public UtilityMessagePanel GetUtilityMessagePanel()
    // {
    //     if (loaderPanel && Utility.Instance.IsSplitScreenSupported && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1)
    //         return messagePopup;
    //     else
    //         return UIManager.Instance.messagePopup;
    // }

    public void DisplayLoader(bool showLoader)
    {
        if (loaderPanel && Utility.Instance.IsSplitScreenSupported && UIManager.Instance.splitScreenGameManager.SplitScreenRunningGameCount() > 1)
        {
            if (showLoader)
                loaderPanel.ShowLoader();
            else
            {
                loaderPanel.HideLoader();
                UIManager.Instance.DisplayLoader(false);
            }
        }
        else
        {
            // UIManager.Instance.DisplayLoader(showLoader);
        }
    }

    /// <summary>
    /// This is a custom UI handling function. Code normalization is remain.
    /// </summary>
    /// <param name="totalActiveGames"></param>
    #endregion

    #region PRIVATE_METHODS

    private void MarkWithdrawNumbers(BingoNumberData data, bool playSound = false)
    {
        ResetMissingPatternData();
        ResetMissingTicketsData();
        ClearMssingList();
        CheckMissIndies(data, playSound);
        WinPatternBlinking();
    }

    /// <summary>
    /// NewNumberWithdrawEvent will show new withdraw bingo ball with animation
    /// </summary>
    /// <param name="newBingoNumberData"></param>
    private void WithdrawBingoBallAction(BingoNumberData newBingoNumberData)
    {
        MarkWithdrawNumbers(newBingoNumberData, true);//true
        LastWithdrawNumber = newBingoNumberData.number;
        TotalWithdrawCount = newBingoNumberData.totalWithdrawCount;
    }

    private void CheckMissIndies(BingoNumberData data, bool playSound = false)
    {
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            ticket.MarkNewWithdrawNumber(data.number, true, false, playSound);

            if (ticket._isTicketPurchased)
            {
                // Clear existing matching patterns before checking new ones
                ticket.MissingPatterns.Clear();
                List<PrefabBingoGame5Pattern> matchingPatterns = MatchPatternList(ticket.yourArray);

                if (matchingPatterns.Count > 0)
                {
                    foreach (PrefabBingoGame5Pattern pattern in matchingPatterns)
                    {
                        // Check if the ticket is not already in the pattern's MissingTickets list
                        if (!pattern.MissingTickets.Contains(ticket))
                        {
                            pattern.MissingTickets.Add(ticket);
                        }
                    }
                }
                else
                {
                    // No pattern match found
                    // Debug.Log("No pattern match found.");
                }
            }
        }
    }

    public void WinPatternBlinking()
    {

        foreach (var pattern in patternList)
        {
            pattern.stopAnimateTicketActionCall();
        }

        foreach (var pattern in patternList)
        {
            pattern.AnimateTicketActionCall();
        }
    }

    private List<PrefabBingoGame5Pattern> MatchPatternList(int[] yourArray)
    {
        List<PrefabBingoGame5Pattern> missingPatterns = new List<PrefabBingoGame5Pattern>();

        // Exclude the last pattern
        int patternCount = patternList.Count - 1;
        for (int i = 0; i < patternCount; i++)
        {
            PrefabBingoGame5Pattern patternListEntry = patternList[i];

            if (MissingPattern(patternListEntry.patternData.pattern, yourArray, out List<int> missingIndices))
            {
                // Print or handle missing indices here
                if (missingIndices.Count > 0)
                {
                    // Create a new list for each missing pattern
                    patternListEntry.missingIndicesList.Add(missingIndices);
                    //Debug.Log($"Missing indices for pattern {i}: {string.Join(", ", missingIndices)}");
                }

                missingPatterns.Add(patternListEntry);
            }
        }

        return missingPatterns;
    }

    private bool MissingPattern(List<int> pattern, int[] yourArray, out List<int> missingIndices)
    {
        missingIndices = new List<int>();

        if (pattern.Count != yourArray.Length)
        {
            return false; // Patterns must have the same length to be comparable
        }

        List<int> occurrence = pattern
            .Select((value, index) => new { value, index })
            .Where(item => item.value == 1)
            .Select(item => item.index)
            .ToList();

        return Missing1toGoPattern(pattern, yourArray, occurrence, out missingIndices);
    }

    bool Missing1toGoPattern(List<int> pattern, int[] yourArray, List<int> indexArr, out List<int> missingIndices)
    {
        missingIndices = new List<int>();

        int count = 0;
        for (int i = 0; i < yourArray.Length; i++)
        {
            if (yourArray[i] == 1 && indexArr.Contains(i))
            {
                count++;
            }
            else if (yourArray[i] == 0 && indexArr.Contains(i))
            {
                missingIndices.Add(i);
            }
        }

        return count == indexArr.Count - 1;
    }

    #region MINI GAMES
    #endregion

    //Fetching & set game5Data.rouletteData[index] //now its statically set in Wheel UI
    private void GenerateRoulateData()
    {
        foreach (GameObject txtRoulettePlate in txtRoulettePlatesSelect)
        {
            TextMesh textMesh = txtRoulettePlate.GetComponent<TextMesh>();

            if (textMesh != null)
            {
                int index = txtRoulettePlatesSelect.IndexOf(txtRoulettePlate);
                if (index < game5Data.rouletteData.Count)
                {
                    textMesh.text = game5Data.rouletteData[index].ToString();
                }
                else
                {
                    textMesh.text = "N/A";
                }
            }
            else
            {
                Debug.LogError("TextMesh component not found on " + txtRoulettePlate.name);
            }
        }
    }

    private void GenerateRoulateBallData()
    {
        int i = 0;

        foreach (GameObject ball in balls)
        {
            TextMesh textMesh = ball.transform.GetChild(0).gameObject.GetComponent<TextMesh>();

            if (textMesh != null)
            {
                if (i < game5Data.rouletteData.Count)
                {
                    textMesh.text = game5Data.rouletteData[i].ToString();
                }
                else
                {
                    textMesh.text = "N/A";
                }
            }
            else
            {
                Debug.LogError("TextMesh component not found on " + ball.name);
            }

            i++;
        }
    }

    private void HighLightWinningPattern()
    {
        // Assuming patternList is initialized somewhere in your code.
        foreach (var pattern in patternList)
        {
            pattern.stopAnimateTicketActionCall();
        }

        foreach (PrefabBingoGame5Pattern pattern in patternList)
        {
            pattern.SetWinning(bingoGame5FinishResponse.winningPatterns);
        }
    }

    private void HighlightBall(int index, bool isForce = false)
    {
        if (isForce)
        {
            if (rouletteWheel != null && balls != null && balls.Length > 0)
            {
                GameObject ball = balls[index];
                ball.GetComponent<Rigidbody2D>().simulated = false;
                ball.GetComponent<Collider2D>().enabled = false;
                ball.SetActive(false);
                txtRoulettePlatesSelect[index].SetActive(true);
            }

        }
        else if (rouletteWheel != null && balls != null && balls.Length > 0)
        {
            // Randomly select a ball from the array
            GameObject ball = balls[index];

            // Store the original scale
            Vector3 originalScale = ball.transform.localScale;

            // Disable Rigidbody2D and Collider2D
            ball.GetComponent<Rigidbody2D>().simulated = false;
            ball.GetComponent<Collider2D>().enabled = false;

            spriteCenterBall.gameObject.SetActive(true);

            spriteCenterBall.sprite = ball.GetComponent<SpriteRenderer>().sprite;
            spriteCenterBallText.text = ball.transform.GetChild(0).GetComponent<TextMesh>().text;

            CopyRectTransform(ball.transform.GetChild(0).GetComponent<RectTransform>(), spriteCenterBallText.GetComponent<RectTransform>());

            ball.SetActive(false);
            txtRoulettePlatesSelect[index].SetActive(true);

            float zoomOutTime = 2f;
            float zoomInTime = 0.5f;
            float BallDrawTime = game5Data.BallDrawTime / 1000;
            if (BallDrawTime < 4 && BallDrawTime >= 3) // Time between 2-3 
            {
                zoomOutTime = 2f;
                zoomInTime = 0.5f;
            }
            else if (BallDrawTime < 3 && BallDrawTime >= 2)
            {
                zoomOutTime = 1.3f;
                zoomInTime = 0.3f;
            }
            else if (BallDrawTime < 1)
            {
                zoomOutTime = 0.3f;
                zoomInTime = 0.2f;
            }
            else // this if 4 krta vadhare hse to 
            {
                zoomOutTime = 2f;
                zoomInTime = 0.5f;
            }
            LeanTween.scale(spriteCenterBall.gameObject, originalScale * 7f, zoomOutTime)
                .setEase(LeanTweenType.easeInOutQuad)
                .setOnComplete(() =>
                {
                    // Zoom Out after Zoom In is complete
                    LeanTween.scale(spriteCenterBall.gameObject, originalScale, zoomInTime)
                            .setEase(LeanTweenType.easeInOutQuad)
                            .setOnComplete(() =>
                            {
                                spriteCenterBall.gameObject.SetActive(false);
                            });
                });
        }
        else
        {
            Debug.LogError("Please assign the Spinner and Ball GameObjects in the inspector.");
        }
    }

    private void GenerateTickets(Game5Data game5data)
    {
        foreach (var ticket in game5data.ticketList)
        {
            PrefabBingoGame5Ticket3x3 ticketObject = Instantiate(prefabBingoGame5Ticket3X3, transformTicketContainer);
            ticketObject.SetData(ticket, game5data.maximumBetAmount);
            ticketList.Add(ticketObject);
        }
    }

    /// <summary>
    /// generate pattern from patter data list
    /// </summary>
    /// <param name="list"></param>
    private void GeneratePatterns(List<PatternList> list)
    {
        int patternNumber = 0;
        foreach (PatternList patternData in list)
        {
            PrefabBingoGame5Pattern newPattern = Instantiate(prefabBingoGame5Pattern, transformPatternContainer);
            newPattern.SetData(patternData);
            patternList.Add(newPattern);
        }
    }

    private void Reset()
    {
        //Debug.Log("Reset Chintan...");
        TotalWithdrawCount = 0;
        txtLastWithdrawNumber.text = "--";
        roulateSpinnerElements.SetActive(UIManager.Instance.Game5ActiveElementAction());
        CloseMiniGames();
        ResetMissingTicketsData();
        ResetMissingPatternData();
        CloseMiniGames();
        ResetPattern();
        ResetTickets();
        ResetRoulettePlats();
        ResetBall();
    }

    private void CloseMiniGames()
    {
        game5FreeSpinJackpot.Close();
        game5JackpotRouletteWheel.Close();
    }

    private void ResetMissingTicketsData()
    {
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
        {
            ticket.MissingPatterns.Clear();
        }
    }

    private void ClearMssingList()
    {
        foreach (PrefabBingoGame5Pattern pattern in patternList)
        {
            pattern.missingIndicesList.Clear();
        }
    }

    private void ResetMissingPatternData()
    {
        foreach (PrefabBingoGame5Pattern pattern in patternList)
        {
            pattern.MissingTickets.Clear();
        }
    }

    private void ResetTickets()
    {
        foreach (PrefabBingoGame5Ticket3x3 ticket in ticketList)
            Destroy(ticket.gameObject);

        ticketList.Clear();
    }

    private void ResetPattern()
    {
        foreach (PrefabBingoGame5Pattern pattern in patternList)
            Destroy(pattern.gameObject);

        patternList.Clear();
    }

    private void ResetBall()
    {
        foreach (GameObject ball in balls)
        {
            ball.GetComponent<Rigidbody2D>().simulated = true;
            ball.GetComponent<Collider2D>().enabled = true;
            ball.SetActive(true);
        }
        StartCoroutine(ResetBallCoroutine());
    }

    IEnumerator ResetBallCoroutine()
    {
        yield return new WaitForSeconds(2f);
        roulateSpinner.EnableDisableColliders(IsGamePlayInProcess ? true : false);
    }

    private void ResetRoulettePlats()
    {
        int i = 0;
        foreach (GameObject txtRoulettePlate in txtRoulettePlatesSelect)
        {
            txtRoulettePlate.SetActive(false);
            i++;
        }
    }

    private int GetTargetPlateIndex(int valueToFind)
    {
        // Convert List<int> to an array
        int[] dataArray = game5Data.rouletteData.ToArray();

        int index = Array.IndexOf(dataArray, valueToFind);

        if (index != -1)
            return index;
        else
            return 0;
    }

    private void CopyRectTransform(RectTransform source, RectTransform destination)
    {
        destination.anchoredPosition = source.anchoredPosition;
        destination.sizeDelta = source.sizeDelta;
        destination.anchorMin = source.anchorMin;
        destination.anchorMax = source.anchorMax;
        destination.pivot = source.pivot;
        destination.anchoredPosition3D = source.anchoredPosition3D;
        destination.localRotation = source.localRotation;
        destination.localScale = source.localScale;
    }

    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER

    public int TotalWithdrawCount
    {
        set
        {
            var locParamsManager = txtWithdrawNumberStats.GetComponent<LocalizationParamsManager>();
            locParamsManager.SetParameterValue("completed", value.ToString());
            locParamsManager.SetParameterValue("total", game5Data.totalWithdrawableBalls.ToString());
        }
    }

    public int LastWithdrawNumber
    {
        set
        {
            txtLastWithdrawNumber.text = value.ToString();
        }
    }

    public bool IsGamePlayInProcess
    {
        set
        {
            _isGamePlayInProcess = value;
            btnPlay.interactable = !value;
            roulateSpinner.IsRotating = value;
        }
        get
        {
            return _isGamePlayInProcess;
        }
    }

    public Color32 PickColor(string colorName)
    {
        switch (colorName.ToLower())
        {
            case "blue":
                return blue;
            case "green":
                return green;
            case "red":
                return red;
            case "purple":
                return purple;
            default:
                Debug.LogWarning($"Unknown color: {colorName}");
                return Color.black; // Default color or handle as needed
        }
    }

    public Sprite PickColorSprite(string spriteName)
    {
        switch (spriteName.ToLower())
        {
            case "blue":
                return spriteBlue;
            case "green":
                return spriteGreen;
            case "red":
                return spriteRed;
            case "purple":
                return spritePurple;
            default:
                Debug.LogWarning($"Unknown Sprite: {spriteName}");
                return spriteBlue;

        }
    }

    #endregion
}

using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public class PrefabBingoGame5Ticket3x3 : MonoBehaviour, IDropHandler
{
    #region PRIVATE_VARIABLES
    [SerializeField]
    protected GameObject gameObjectTicketData;

    [SerializeField]
    private GameObject gameObjectDetails;

    [SerializeField]
    private GameObject panelTicketController;

    [Header("Text")]
    public TextMeshProUGUI txtWonAmount;
    [SerializeField]
    private TextMeshProUGUI txtTicketPrice;

    [SerializeField]
    private TextMeshProUGUI txtTicketID;

    [SerializeField]
    private TextMeshProUGUI txtHallLabel;

    [SerializeField]
    private TextMeshProUGUI txtHallName;

    [SerializeField]
    private TextMeshProUGUI txtSupplierLabel;

    [SerializeField]
    private TextMeshProUGUI txtSupplierName;

    [SerializeField]
    private TextMeshProUGUI txtDeveloperLabel;

    [SerializeField]
    private TextMeshProUGUI txtDeveloperName;
    [SerializeField]
    private TextMeshProUGUI txtDeveloperName1;

    [Header("Button")]
    [SerializeField]
    private Button btnDecreaseBet;

    [SerializeField]
    private Button btnIncreaseBet;

    [SerializeField]
    private Button btnChange;

    [Header("Panels")]
    [SerializeField]
    private BingoResultPanel bingoResultPanel;

    [Header("Images")]
    public Image imgCellContainer;
    public Image imgTicketController;
    public Image imgChange;
    public Image imgTicketID;
    public Image imgDetails;

    [Header("Bingo Ticket Cell List")]
    [SerializeField]
    protected List<Game5TicketSingleCellData> ticketCellList;

    [Header("ticketList Data")]
    [SerializeField]
    public TicketList ticketList;

    [Header("ticketList Progress")]
    [SerializeField]
    public TicketList ticketListProgress;

    public List<PrefabBingoGame5Pattern> MissingPatterns = new List<PrefabBingoGame5Pattern>();

    public bool _isTicketPurchased = false;
    private bool isFlipAnimationRunning = false;
    private float ticketRotationTime = 0.5f;
    private float ticketDetailPageTime = 3f;

    private int _betValue = 0;
    private int _MaxbetValue = 0;
    private int _otgBorderTweenId = -1;

    public int[] yourArray = new int[9];

    public List<int> missingIndices;

    #endregion

    #region PUBLIC_METHODS


    public void SetData(TicketList ticketList, int _MaxbetValue)
    {
        this.ticketList = ticketList;
        BetValue = 0;
        this._MaxbetValue = _MaxbetValue;
        int i = 0;

        foreach (int ticketCell in ticketList.ticket)
        {
            ticketCellList[i].SetTheme(ticketCell);
            i++;
        }
        txtTicketID.text = ticketList.ticketId;
        imgTicketController.color = imgChange.color =
            UIManager.Instance.game5Panel.game5GamePlayPanel.PickColor(ticketList.color);
        bingoResultPanel.gameObject.GetComponent<Image>().color =
            UIManager.Instance.game5Panel.game5GamePlayPanel.PickColor(ticketList.color);
        imgCellContainer.sprite = UIManager.Instance.game5Panel.game5GamePlayPanel.PickColorSprite(
            ticketList.color
        );
        imgTicketID.color = UIManager.Instance.game5Panel.game5GamePlayPanel.PickColor(
            ticketList.color
        );
        imgDetails.color = UIManager.Instance.game5Panel.game5GamePlayPanel.PickColor(
            ticketList.color
        );
        ModifyBetValue(ticketList.price);

        if (txtHallName)
            txtHallName.text = ticketList.hallName;

        if (txtSupplierName)
            txtSupplierName.text = ticketList.supplierName;

        if (txtDeveloperName)
            txtDeveloperName.text = ticketList.developerName;
        txtDeveloperName1.text = ticketList.developerName;
    }

    public void ModifyBetValue(int direction)
    {
        BetValue += direction;
        if (!UIManager.Instance.game5Panel.game5GamePlayPanel.game5Data.status.Equals("Running"))
        {
            btnDecreaseBet.interactable = BetValue != 0;
            btnIncreaseBet.interactable = BetValue < _MaxbetValue;
        }
        else
        {
            btnDecreaseBet.interactable = false;
            btnIncreaseBet.interactable = false;
        }
        BetValue = (BetValue > _MaxbetValue) ? _MaxbetValue : BetValue;

        ticketList.price = BetValue;

        if (BetValue > 0)
            _isTicketPurchased = true;
        else
            _isTicketPurchased = false;
    }

    public void SwapTicket()
    {
        if (!UIManager.Instance.game5Panel.game5GamePlayPanel.IsGamePlayInProcess)
        {
            // TODO: Replace with Spillorama REST endpoint for Game5 swap ticket
            Debug.LogWarning("[Game5] SwapTicket: Spillorama endpoint not yet implemented");
        }
    }

    public void Reset()
    {
        StopOTGBorderPulse();
        ResetMarkedWithdrawNumber();
        UnblockTicketActions();
        BetValue = 0;
        ticketList.price = BetValue;

        if (BetValue > 0)
            _isTicketPurchased = true;
        else
            _isTicketPurchased = false;
    }

    public void StartOTGBorderPulse()
    {
        if (!_isTicketPurchased || imgTicketController == null) return;
        StopOTGBorderPulse();

        Color baseColor = UIManager.Instance.game5Panel.game5GamePlayPanel
            .PickColor(ticketList.color);
        Color glowColor = Color.Lerp(baseColor, Color.white, 0.45f);

        _otgBorderTweenId = LeanTween.value(gameObject, 0f, 1f, 0.9f)
            .setEase(LeanTweenType.easeInOutSine)
            .setLoopPingPong()
            .setOnUpdate((float t) =>
            {
                if (imgTicketController != null)
                    imgTicketController.color = Color.Lerp(baseColor, glowColor, t);
            })
            .id;
    }

    public void StopOTGBorderPulse()
    {
        if (_otgBorderTweenId >= 0)
        {
            LeanTween.cancel(_otgBorderTweenId);
            _otgBorderTweenId = -1;
        }
        if (imgTicketController != null && ticketList != null)
            imgTicketController.color = UIManager.Instance.game5Panel.game5GamePlayPanel
                .PickColor(ticketList.color);
    }

    public void ResetMarkedWithdrawNumber()
    {
        foreach (Game5TicketSingleCellData cellData in ticketCellList)
        {
            cellData.HighlightNormalNumber(false);
        }
    }

    public void UnblockTicketActions()
    {
        btnDecreaseBet.interactable = true;
        btnIncreaseBet.interactable = true;
        btnChange.interactable = true;
    }

    public void blockTicketActions()
    {
        btnDecreaseBet.interactable = false;
        btnIncreaseBet.interactable = false;
        btnChange.interactable = false;
    }

    public void MarkNewWithdrawNumber(
        int newWithdrawNumber,
        bool ignoreMarker = false,
        bool isLuckyNumber = false,
        bool playSound = false
    )
    {
        if (!_isTicketPurchased)
            return;

        int index = 0;

        foreach (Game5TicketSingleCellData cellData in ticketCellList)
        {
            if (newWithdrawNumber == cellData.Number)
            {
                cellData.HighlightNormalNumber(true);
                cellData.isNumberSelected = true;
                if (playSound)
                    SoundManager.Instance.TicketNumberSelection();

                if (index >= 0 && index < yourArray.Length)
                {
                    yourArray[index] = 1;
                }
            }

            index++;
        }
    }
    #endregion

    #region POINTER_METHOD
    public void OnDrop(PointerEventData eventData)
    {
        if (
            UIManager.Instance == null
            || UIManager.Instance.game5Panel == null
            || UIManager.Instance.game5Panel.game5GamePlayPanel == null
        )
        {
            return; // Handle the case where UIManager or its components are null
        }

        if (UIManager.Instance.game5Panel.game5GamePlayPanel.IsGamePlayInProcess)
            return;

        if (eventData.pointerDrag != null)
        {
            Game5BetCoin betCoin = eventData.pointerDrag.gameObject.GetComponent<Game5BetCoin>();

            if (betCoin != null)
            {
                ModifyBetValue(betCoin.chipValue);
                betCoin.isOnTicket = true;
                ScaleObject(txtTicketPrice.gameObject);
            }
        }
    }

    public void ShowTicketDetails()
    {
        if (!isFlipAnimationRunning)
        {

            if (gameObjectTicketData.activeSelf)
                StartCoroutine(ShowTicketDetailsAnimation());
            else
                StartCoroutine(HideTicketDetailsAnimation());
        }
    }
    #endregion

    #region PRIVATE_METHODS

    private void ScaleObject(GameObject go)
    {
        LeanTween
            .scale(go, Vector3.one * 1.1f, 0.3f)
            .setEase(LeanTweenType.easeOutQuad)
            .setOnComplete(() =>
            {
                LeanTween
                    .scale(go, Vector3.one, 0.2f)
                    .setEase(LeanTweenType.easeOutQuad)
                    .setOnComplete(() => { });
            });
    }
    #endregion

    #region COROUTINES
    IEnumerator ShowTicketDetailsAnimation()
    {
        isFlipAnimationRunning = true;

        Utility.Instance.RotateObject(
            this.transform,
            new Vector3(0, 0, 0),
            new Vector3(0, 90, 0),
            ticketRotationTime
        );
        yield return new WaitForSeconds(ticketRotationTime);

        gameObjectTicketData.SetActive(false);
        panelTicketController.SetActive(false);
        btnChange.gameObject.SetActive(false);
        imgTicketID.gameObject.SetActive(false);
        gameObjectDetails.SetActive(true);

        Utility.Instance.RotateObject(
            this.transform,
            new Vector3(0, 90, 0),
            new Vector3(0, 0, 0),
            ticketRotationTime
        );
        yield return new WaitForSeconds(ticketRotationTime);

        isFlipAnimationRunning = false;

        yield return new WaitForSeconds(ticketDetailPageTime - ticketRotationTime);

        StartCoroutine(HideTicketDetailsAnimation());
    }

    IEnumerator HideTicketDetailsAnimation()
    {
        isFlipAnimationRunning = true;

        Utility.Instance.RotateObject(
            this.transform,
            new Vector3(0, 0, 0),
            new Vector3(0, 90, 0),
            ticketRotationTime
        );
        yield return new WaitForSeconds(ticketRotationTime);

        gameObjectTicketData.SetActive(true);
        panelTicketController.SetActive(true);
        btnChange.gameObject.SetActive(true);
        imgTicketID.gameObject.SetActive(true);
        gameObjectDetails.SetActive(false);

        Utility.Instance.RotateObject(
            this.transform,
            new Vector3(0, 90, 0),
            new Vector3(0, 0, 0),
            ticketRotationTime
        );
        yield return new WaitForSeconds(ticketRotationTime);

        isFlipAnimationRunning = false;
    }
    #endregion

    #region GETTER_SETTER


    public string TicketId
    {
        get { return ticketList.id; }
        set { ticketList.id = value; }
    }

    public bool TicketCompleted
    {
        set
        {
            if (bingoResultPanel && value)
            {
                bingoResultPanel.WonAmount = WonAmount;
                bingoResultPanel.TicketCompleteAction();
            }
        }
    }

    public int BetValue
    {
        set
        {
            _betValue = value;
            txtTicketPrice.text = value.ToString() + " kr";
        }
        get { return _betValue; }
    }

    public string WonAmount
    {
        get { return txtWonAmount.text.ToString(); }
        set { txtWonAmount.text = Constants.LanguageKey.WonMessage + " : " + value + " Kr"; }
    }
    #endregion
}

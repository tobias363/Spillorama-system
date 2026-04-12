using System.Collections;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabBingoGame5Pattern : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtMultiplierAmount;
    [SerializeField] private TextMeshProUGUI txtJackpotAmount;
    [SerializeField] private TextMeshProUGUI txtPatternName;
    [SerializeField] private TextMeshProUGUI txtAmount;

    [Header("Image")]
    [SerializeField] private Sprite imgPatternBackground;
    [SerializeField] private List<Image> imgPatternBlocks;

    [SerializeField] private Color32 colorPatternNormal;
    [SerializeField] private Color32 colorPatternBlock;
    [SerializeField] private Color32 colorPatternBlink;

    [Header("OTG Border")]
    [SerializeField] private Image imgCardBorder;
    [SerializeField] private Color32 colorBorderDefault = new Color32(255, 255, 255, 46);

    [Header("GameObject")]
    [SerializeField] private GameObject BonusText;

    [Space(20)]
    [SerializeField] private Color32 colorPatternCell;


    public List<PrefabBingoGame5Ticket3x3> MissingTickets = new List<PrefabBingoGame5Ticket3x3>();

    public PatternList patternData;

    Coroutine CoroutineHighlightAction;
    Coroutine CoroutineZoomEffect;
    Coroutine CoroutineHighlightMissingPatternCell;
    public bool highlightEnable = false;
    private float blinkAnimationTime = 0.25f;
    private int _otgBorderTweenId = -1;
    public List<List<int>> missingIndicesList { get; set; } = new List<List<int>>();
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(PatternList patternData)
    {
        this.patternData = patternData;
        if (patternData.extraWinningsType == "Bonus")
        {
            var tmp = BonusText.GetComponent<TextMeshProUGUI>();
            tmp.color = Color.white;
            tmp.text = "BONUS";
            BonusText.SetActive(true);
        }
        else if (patternData.extraWinningsType == "Jackpot")
        {
            var tmp = BonusText.GetComponent<TextMeshProUGUI>();
            tmp.text = "JACKPOT!";
            BonusText.SetActive(true);
            Color gold       = new Color32(255, 215,   0, 255);
            Color brightGold = new Color32(255, 245, 160, 255);
            tmp.color = gold;
            LeanTween.value(gameObject, 0f, 1f, 1.6f)
                .setEase(LeanTweenType.easeInOutSine)
                .setLoopPingPong()
                .setOnUpdate((float t) => { if (tmp != null) tmp.color = Color.Lerp(gold, brightGold, t); });
        }
        else
        {
            BonusText.SetActive(false);
        }
                

        txtMultiplierAmount.text = "x" +patternData.multiplier;
        ModifyPatternCell();
    }


    public void SetWinning(List<WinningPattern> winningPatterns)
    {
        foreach (var pattern in winningPatterns)
        {
            if (Enumerable.SequenceEqual(pattern.pattern.pattern, patternData.pattern))
            {
                BonusText.SetActive(false);
                txtJackpotAmount.text = pattern.wonAmount.ToString() + " kr";
                gameObject.transform.localScale = new Vector3(1.2f,1.2f,1.2f);
                gameObject.GetComponent<Image>().sprite = UIManager.Instance.game5Panel.game5GamePlayPanel.PickColorSprite(pattern.ticketColor);


                for (int i = 0; i < imgPatternBlocks.Count; i++)
                {
                    imgPatternBlocks[i].GetComponent<Image>().color = UIManager.Instance.game5Panel.game5GamePlayPanel.PickColor(pattern.ticketColor);
                }

            }
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void ModifyPatternCell()
    {
        for (int i = 0; i < patternData.pattern.Count; i++)
        {
            if (patternData.pattern[i] == 1)
                imgPatternBlocks[i].transform.GetChild(0).GetComponent<Image>().enabled = true;
            else
                imgPatternBlocks[i].transform.GetChild(0).GetComponent<Image>().enabled = false;
        }
    }


    private void ModifyCellColor()
    {
        for (int i = 0; i < imgPatternBlocks.Count; i++)
        {
            imgPatternBlocks[i].GetComponent<Image>().color = colorPatternCell;
        }

        gameObject.transform.localScale = Vector3.one;
    }

    public void stopAnimateTicketActionCall()
    {
        if (CoroutineZoomEffect != null)
            StopCoroutine(CoroutineZoomEffect);

        if (CoroutineHighlightAction != null)
            StopCoroutine(CoroutineHighlightAction);

        if (CoroutineHighlightMissingPatternCell != null)
        {
            highlightEnable = false;
            StopCoroutine(CoroutineHighlightMissingPatternCell);
        }

        StopOTGBorderPulse();
        ModifyCellColor();
    }

    private void StartOTGBorderPulse(Color ticketColor)
    {
        if (imgCardBorder == null) return;
        StopOTGBorderPulse();

        Color dimColor  = new Color(ticketColor.r, ticketColor.g, ticketColor.b, 0.25f);
        Color fullColor = new Color(ticketColor.r, ticketColor.g, ticketColor.b, 1f);
        imgCardBorder.color = dimColor;

        _otgBorderTweenId = LeanTween.value(gameObject, 0f, 1f, 0.9f)
            .setEase(LeanTweenType.easeInOutSine)
            .setLoopPingPong()
            .setOnUpdate((float t) =>
            {
                if (imgCardBorder != null)
                    imgCardBorder.color = Color.Lerp(dimColor, fullColor, t);
            })
            .id;
    }

    private void StopOTGBorderPulse()
    {
        if (_otgBorderTweenId >= 0)
        {
            LeanTween.cancel(_otgBorderTweenId);
            _otgBorderTweenId = -1;
        }
        if (imgCardBorder != null)
            imgCardBorder.color = colorBorderDefault;
    }


    public void AnimateTicketActionCall()
    {
        CoroutineHighlightAction = StartCoroutine(HighlightAction());
    }
    #endregion

    #region COROUTINES    

    private IEnumerator HighlightAction()
    {
        if (MissingTickets.Count == 0) yield break;

        // Start border pulse in the colour of the first OTG ticket
        Color firstTicketColor = UIManager.Instance.game5Panel.game5GamePlayPanel
            .PickColor(MissingTickets[0].ticketList.color);
        StartOTGBorderPulse(firstTicketColor);

        // Cycle through OTG tickets continuously until stopped
        while (true)
        {
            for (int t = 0; t < MissingTickets.Count; t++)
            {
                var ticket = MissingTickets[t];
                List<int> innerList = missingIndicesList.Count > t ? missingIndicesList[t] : new List<int>();

                HighlightMissingPatternCell(false, 0);
                foreach (int item in innerList)
                    HighlightMissingPatternCell(true, item);

                for (int i = 0; i < imgPatternBlocks.Count; i++)
                    imgPatternBlocks[i].color = UIManager.Instance.game5Panel.game5GamePlayPanel
                        .PickColor(ticket.ticketList.color);

                CoroutineZoomEffect = StartCoroutine(ZoomEffect(gameObject.GetComponent<Image>(), 1.1f));
                yield return new WaitForSeconds(0.8f);

                CoroutineZoomEffect = StartCoroutine(ZoomEffect(gameObject.GetComponent<Image>(), 1.0f));
                yield return new WaitForSeconds(0.8f);
            }
        }
    }
    public void HighlightMissingPatternCell(bool highlight, int number)
    {
        if (highlight && !highlightEnable)
        {
            CoroutineHighlightMissingPatternCell = StartCoroutine(HighlightMissingAction(number));
        }
        else if (!highlight && CoroutineHighlightMissingPatternCell != null)
        {
            highlightEnable = false;
            StopCoroutine(CoroutineHighlightMissingPatternCell);
            ModifyCellColor();
        }
    }

    private IEnumerator HighlightMissingAction(int number)
    {
        List<Image> cellList = new List<Image>();
        for (int i = 0; i < patternData.pattern.Count; i++)
        {
            if (i == number)
                cellList.Add(imgPatternBlocks[i]);
        }

        bool blink = true;

        while (true)
        {
            foreach (Image cell in cellList)
            {
                cell.color = blink == true ? colorPatternBlink : colorPatternBlink;
            }
            blink = !blink;
            yield return new WaitForSeconds(blinkAnimationTime);
        }
    }

    // Your ZoomEffect method goes here
    IEnumerator ZoomEffect(Image image, float scaleFactor)
    {
        // Store the original scale
        Vector3 originalScale = image.transform.localScale;

        // Zoom in
        while (image.transform.localScale.x < originalScale.x * scaleFactor)
        {
            image.transform.localScale += Vector3.one * Time.deltaTime;
            yield return null;
        }

        // Zoom out
        while (image.transform.localScale.x > originalScale.x)
        {
            image.transform.localScale -= Vector3.one * Time.deltaTime;
            yield return null;
        }

        // Ensure the scale is exactly the original scale
        image.transform.localScale = originalScale;
    }


    #endregion

    #region GETTER_SETTER
    public List<int> PatternDataList
    {
        get
        {
            return patternData.pattern;
        }
    }
    #endregion
}

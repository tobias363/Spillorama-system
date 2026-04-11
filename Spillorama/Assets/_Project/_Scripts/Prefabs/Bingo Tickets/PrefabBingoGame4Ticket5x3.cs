using System.Collections;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabBingoGame4Ticket5x3 : BingoTicket
{
    #region PUBLIC_VARIABLES    
    #endregion

    #region PRIVATE_VARIABLES
    [Header("GameObjects")]
    [SerializeField] private GameObject emptyGameObject;
    [SerializeField] private GameObject gameObjectAddTicket;

    //[Header("Panels")]
    //[SerializeField] private BingoResultPanel bingoResultPanel;

    [Header("Buttons")]
    [SerializeField] private Button btnRemoveTicket;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtAddTicketPlus;
    [SerializeField] private TextMeshProUGUI txtAddTicketLabel;
    [SerializeField] private TextMeshProUGUI txtGameWatermark;

    [Header("Images")]
    [SerializeField] private Image imgRemoveButtonBackground;
    [SerializeField] private Image imgRemoveButtonBorder;
    [SerializeField] private Image imgRemoveMinusSign;

    [Header("Transform")]
    [SerializeField] private Transform transformPatternContainer;

    [Header("Sprites")]
    public Sprite[] OneLpatternSprite;
    public Sprite[] TwoLpatternSprite;

    public bool _isTicketPurchased = true;

    [Header("Missing Pattern Holder")]
    public List<PrefabBingoGame4Pattern> MissingPatterns = new List<PrefabBingoGame4Pattern>();
    public List<int> missingIndices;
    private Coroutine missingIndicesSwitch = null;

    public List<GameObject> storedGameObjects = new List<GameObject>();
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void TicketTheme(TicketThemeData theme)
    {
        imgTicket.color = theme.backgroundColor;

        txtGameWatermark.color = theme.addTicketColor;
        txtAddTicketPlus.color = theme.addTicketColor;
        txtAddTicketLabel.color = theme.addTicketColor;
        imgRemoveButtonBackground.color = theme.removeButtonBackgroundColor;
        imgRemoveButtonBorder.color = theme.removeButtonBorderColor;
        imgRemoveMinusSign.color = theme.removeButtonBorderColor;

        foreach (BingoTicketSingleCellData cellData in ticketCellList)
        {
            cellData.SetTheme(theme);
        }
    }

    public void InitializeTicketPurchasingOption()
    {
        IsTicketPurchased = true;
        gameObjectTicketData.gameObject.SetActive(true);
    }

    public void TicketPurchaseEnable(bool isEnable)
    {
        if (!IsTicketPurchased)
        {
            gameObjectAddTicket.gameObject.SetActive(isEnable);
            txtGameWatermark.gameObject.SetActive(!isEnable);
        }
        else
        {
            btnRemoveTicket.gameObject.SetActive(isEnable);
        }
    }
    public void nonPurchaseTicket()
    {
        gameObjectAddTicket.gameObject.SetActive(false);
        txtGameWatermark.gameObject.SetActive(true);
    }
    public void OnRemoveTicketButtonTap()
    {
        Game4GamePlayPanel game4GamePlayPanel = (UIManager.Instance.game4Panel.game4GamePlayPanel.isActiveAndEnabled == true ?
            UIManager.Instance.game4Panel.game4GamePlayPanel : UIManager.Instance.splitScreenGameManager.game4Panel.game4GamePlayPanel);

        //if (UIManager.Instance.game4Panel.game4GamePlayPanel.TicketCount > 1)
        if (game4GamePlayPanel.TicketCount > 1)
        {
            ResetTicket();
            IsTicketPurchased = false;
            btnRemoveTicket.Close();
            gameObjectTicketData.gameObject.SetActive(false);
            gameObjectAddTicket.gameObject.SetActive(true);
            txtGameWatermark.Close();

            //UIManager.Instance.game4Panel.game4GamePlayPanel.TicketCount--;
            game4GamePlayPanel.TicketCount--;
        }
    }
    public void OnRemoveTicket()
    {
        ResetTicket();
        IsTicketPurchased = false;
        btnRemoveTicket.Close();
        gameObjectTicketData.gameObject.SetActive(false);
        gameObjectAddTicket.gameObject.SetActive(true);
        txtGameWatermark.Close();

    }

    public void OnAddTicketButtonTap()
    {
        IsTicketPurchased = true;
        btnRemoveTicket.Open();
        gameObjectTicketData.gameObject.SetActive(true);
        gameObjectAddTicket.gameObject.SetActive(false);
        txtGameWatermark.Close();

        Game4GamePlayPanel game4GamePlayPanel = (UIManager.Instance.game4Panel.game4GamePlayPanel.isActiveAndEnabled == true ?
            UIManager.Instance.game4Panel.game4GamePlayPanel : UIManager.Instance.splitScreenGameManager.game4Panel.game4GamePlayPanel);

        game4GamePlayPanel.TicketCount++;
        //UIManager.Instance.game4Panel.game4GamePlayPanel.TicketCount++;
    }

    //1L
    // Define the array of patterns
    private List<List<int>> oneLPatterns = new List<List<int>>
    {
        new List<int> {1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
        new List<int> {0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0},
        new List<int> {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1}
    };

    //2L
    // Define the list of patterns
    private List<List<int>> twoLPatterns = new List<List<int>>
    {
        new List<int> {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0},
        new List<int> {1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1},
        new List<int> {0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1}
    };


    bool ComparePatterns(List<int> pattern1, List<int> pattern2)
    {
        if (pattern1.Count != pattern2.Count)
            return false;

        for (int i = 0; i < pattern1.Count; i++)
        {
            if (pattern1[i] != pattern2[i])
                return false;
        }

        return true;
    }

    private bool MissingPattern(List<int> pattern, List<int> yourArray, out List<int> missingIndices)
    {
        missingIndices = new List<int>();

        if (pattern.Count != yourArray.Count)
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

    bool Missing1toGoPattern(List<int> pattern, List<int> yourArray, List<int> indexArr, out List<int> missingIndices)
    {
        missingIndices = new List<int>();

        int count = 0;
        for (int i = 0; i < yourArray.Count; i++)
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

    public void HighlightTicket(List<int> patternListData, List<int> LpatternWinListData, string Extra, Color32 highlightCellColor, Game4PatternSpriteData spriteData)
    {
        StopPatternmissingIndicesSwitch();
        // StopAllCoroutines();

        if (Extra.Equals("1L"))
        {
            patternListData = LpatternWinListData;

            for (int i = 0; i < oneLPatterns.Count; i++)
            {
                if (ComparePatterns(oneLPatterns[i], patternListData))
                {
                    spriteData.patternSprite = OneLpatternSprite[i];
                }
            }
        }
        else if (Extra.Equals("2L"))
        {
            patternListData = LpatternWinListData;

            for (int i = 0; i < twoLPatterns.Count; i++)
            {
                if (ComparePatterns(twoLPatterns[i], patternListData))
                {
                    spriteData.patternSprite = TwoLpatternSprite[i];
                }
            }
        }

        for (int i = 0; i < patternListData.Count; i++)
        {
            if (patternListData[i] == 1)
            {
                ticketCellList[i].HighlightCell(highlightCellColor);
            }
        }

        if (spriteData != null && spriteData.patternSprite != null)
        {
            GameObject newGameObject = Instantiate(emptyGameObject, transformPatternContainer);
            newGameObject.name = "pattern_HighlightTicket";
            Image img = newGameObject.AddComponent<Image>();
            img.sprite = spriteData.patternSprite;
            img.color = spriteData.Color32;
            img.SetNativeSize();

            newGameObject.GetComponent<RectTransform>().sizeDelta = transformPatternContainer.GetComponent<RectTransform>().rect.size;
            storedGameObjects.Add(newGameObject);
        }
    }

    public void StopPatternmissingIndicesSwitch()
    {
        ResetHighlightMissingIndices();

        if (missingIndicesSwitch != null)
        {
            StopCoroutine(missingIndicesSwitch);
        }

        foreach (PrefabBingoGame4Pattern patternData in MissingPatterns)
        {
            patternData.HighlightPattern(false);
        }

    }

    public void StopHighlightMissingPattern()
    {
        foreach (PrefabBingoGame4Pattern patternData in MissingPatterns)
        {
            patternData.HighlightMissingPattern(false, 0);
        }
    }


    public void HighlightMissingIndices(Color32 highlightCellColor)
    {
        ResetHighlightMissingIndices();

        if (missingIndicesSwitch != null)
        {
            StopCoroutine(missingIndicesSwitch);
        }

        if (MissingPatterns.Count > 0)
        {
            if (missingIndicesSwitch != null)
            {
                StopCoroutine(missingIndicesSwitch);
            }
            missingIndicesSwitch = StartCoroutine(MissingIndicesnimateSwitch(highlightCellColor));
        }
    }

    // Declare a class-level variable to store the GameObject
    private GameObject storedGameObject;

    private IEnumerator MissingIndicesnimateSwitch(Color32 highlightCellColor)
    {

        for (int i = 0; i < MissingPatterns.Count; i++) // Change 10 to the number of seconds you want
        {

            foreach (PrefabBingoGame4Pattern patternData in MissingPatterns)
            {
                patternData.HighlightPattern(false);
            }

            Game4PatternSpriteData spriteData = UIManager.Instance.game4Panel.game4GamePlayPanel.GetPatternSpriteData(MissingPatterns[i].PatternId);

            if (MissingPatterns[i].patternData.extra.Equals("1L") && !UIManager.Instance.game4Panel.game4GamePlayPanel.isRefreshed)
            {
                List<int> yourList = yourArray.ToList();
                for (int k = 0; k < oneLPatterns.Count; k++)
                {
                    if (MissingPattern(oneLPatterns[k], yourList, out List<int> missingIndices))
                    {
                        //Debug.LogError("1L Sprite Found inside : " +k);
                        spriteData.patternSprite = OneLpatternSprite[k];

                        if (spriteData != null && spriteData.patternSprite != null)
                        {
                            GameObject newGameObject = Instantiate(emptyGameObject, transformPatternContainer);
                            newGameObject.name = "pattern_1";
                            storedGameObject = newGameObject;
                            Image img = newGameObject.AddComponent<Image>();
                            img.sprite = spriteData.patternSprite;
                            img.color = spriteData.Color32;
                            img.SetNativeSize();

                            newGameObject.GetComponent<RectTransform>().sizeDelta = transformPatternContainer.GetComponent<RectTransform>().rect.size;
                            storedGameObjects.Add(storedGameObject);
                        }

                        if (missingIndices.Count > 0)
                        {
                            // Add only unique missing indices
                            foreach (int index in missingIndices)
                            {
                                if (index >= 0 && index < ticketCellList.Count)  // Check if index is within the valid range
                                {
                                    for (int ij = 0; ij < ticketCellList.Count; ij++)
                                    {
                                        if (ij == index)
                                        {
                                            if (!UIManager.Instance.game4Panel.game4GamePlayPanel.isRefreshed)
                                            {
                                                MissingPatterns[i].HighlightMissingPattern(true, ij);
                                                ticketCellList[ij].HighlightCell(highlightCellColor);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    yield return new WaitForSeconds(0.5f);
                    foreach (PrefabBingoGame4Pattern patternData in MissingPatterns)
                    {
                        patternData.HighlightPattern(false);
                    }

                    if (storedGameObject != null)
                    {
                        Destroy(storedGameObject);
                        storedGameObject = null;
                    }

                    ResetHighlightMissingIndices();
                }
            }
            else if (MissingPatterns[i].patternData.extra.Equals("2L") && !UIManager.Instance.game4Panel.game4GamePlayPanel.isRefreshed)
            {
                List<int> yourList = yourArray.ToList();
                for (int k = 0; k < twoLPatterns.Count; k++)
                {
                    if (MissingPattern(twoLPatterns[k], yourList, out List<int> missingIndices))
                    {
                        //Debug.LogError("2L Sprite Found inside : " + k);
                        spriteData.patternSprite = TwoLpatternSprite[k];

                        if (spriteData != null && spriteData.patternSprite != null)
                        {
                            GameObject newGameObject = Instantiate(emptyGameObject, transformPatternContainer);
                            newGameObject.name = "pattern_2";
                            storedGameObject = newGameObject;
                            Image img = newGameObject.AddComponent<Image>();
                            img.sprite = spriteData.patternSprite;
                            img.color = spriteData.Color32;
                            img.SetNativeSize();

                            newGameObject.GetComponent<RectTransform>().sizeDelta = transformPatternContainer.GetComponent<RectTransform>().rect.size;
                            storedGameObjects.Add(storedGameObject);
                        }

                        if (missingIndices.Count > 0)
                        {
                            // Add only unique missing indices
                            foreach (int index in missingIndices)
                            {
                                if (index >= 0 && index < ticketCellList.Count)  // Check if index is within the valid range
                                {
                                    for (int ij = 0; ij < ticketCellList.Count; ij++)
                                    {
                                        if (ij == index)
                                        {
                                            if (!UIManager.Instance.game4Panel.game4GamePlayPanel.isRefreshed)
                                            {
                                                MissingPatterns[i].HighlightMissingPattern(true, ij);
                                                ticketCellList[ij].HighlightCell(highlightCellColor);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    yield return new WaitForSeconds(0.5f);
                    foreach (PrefabBingoGame4Pattern patternData in MissingPatterns)
                    {
                        patternData.HighlightPattern(false);
                    }

                    if (storedGameObject != null)
                    {
                        Destroy(storedGameObject);
                        storedGameObject = null;
                    }

                    ResetHighlightMissingIndices();
                }
            }
            else if (!UIManager.Instance.game4Panel.game4GamePlayPanel.isRefreshed)
            {
                List<int> yourList = yourArray.ToList();

                if (MissingPattern(MissingPatterns[i].patternData.patternDataList, yourList, out List<int> missingIndices))
                {
                    if (missingIndices.Count > 0)
                    {
                        foreach (int index in missingIndices)
                        {
                            if (index >= 0 && index < ticketCellList.Count)  // Check if index is within the valid range
                            {
                                for (int ij = 0; ij < ticketCellList.Count; ij++)
                                {
                                    if (ij == index)
                                    {
                                        if (MissingPatterns[i] != null)
                                        {
                                            if (!UIManager.Instance.game4Panel.game4GamePlayPanel.isRefreshed)
                                            {
                                                MissingPatterns[i].HighlightMissingPattern(true, ij);
                                                ticketCellList[ij].HighlightCell(highlightCellColor);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                //for (int j = 0; j < MissingPatterns[i].missingIndices.Count; j++)
                //{
                //    ticketCellList[MissingPatterns[i].missingIndices[j]].HighlightCell(highlightCellColor);
                //    MissingPatterns[i].HighlightMissingPattern(true, MissingPatterns[i].missingIndices[j]);

                //    Debug.LogError("MissingPatterns[i].missingIndices[j] : " + MissingPatterns[i].missingIndices[j]);
                //}

                spriteData = UIManager.Instance.game4Panel.game4GamePlayPanel.GetPatternSpriteData(MissingPatterns[i].PatternId);

                if (spriteData != null && spriteData.patternSprite != null)
                {
                    GameObject newGameObject = Instantiate(emptyGameObject, transformPatternContainer);
                    newGameObject.name = "pattern_3";
                    storedGameObject = newGameObject;
                    Image img = newGameObject.AddComponent<Image>();
                    img.sprite = spriteData.patternSprite;
                    img.color = spriteData.Color32;
                    img.SetNativeSize();

                    newGameObject.GetComponent<RectTransform>().sizeDelta = transformPatternContainer.GetComponent<RectTransform>().rect.size;
                    storedGameObjects.Add(storedGameObject);
                }

                yield return new WaitForSeconds(0.5f);
                foreach (PrefabBingoGame4Pattern patternData in MissingPatterns)
                {
                    patternData.HighlightPattern(false);
                }

                if (storedGameObject != null)
                {
                    Destroy(storedGameObject);
                    storedGameObject = null;
                }

                ResetHighlightMissingIndices();
            }
        }

        StopCoroutine(missingIndicesSwitch);
    }

    public void ResetHighlightMissingIndices()
    {
        foreach (BingoTicketSingleCellData cell in ticketCellList)
        {
            cell.ResetMissingHighlightCell();
        }

        foreach (Transform obj in transformPatternContainer)
            DestroyImmediate(obj.gameObject);
    }

    public void ResetTicket()
    {
        foreach (BingoTicketSingleCellData cell in ticketCellList)
        {
            cell.ResetCell();
        }

        foreach (Transform obj in transformPatternContainer)
            Destroy(obj.gameObject);
    }


    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public bool IsTicketPurchased
    {
        set
        {
            _isTicketPurchased = value;
        }
        get
        {
            return _isTicketPurchased;
        }
    }
    #endregion
}

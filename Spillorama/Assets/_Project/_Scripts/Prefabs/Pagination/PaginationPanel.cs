using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;

public class PaginationPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Variables")]
    public int selectedPage = 1;
    public int totalRecords = 100;
    public int recordsPerPage = 40;    

    [Header("Prafabs")]
    public Button pageButtonPrefab;

    [Header("Transform")]
    public Transform buttonContainer;

    [Header("Button List")]
    public List<Button> buttonList = new List<Button>();

    [Header("Buttons")]
    public Button btnFirstRecord;
    public Button btnLastRecord;
    public Button btnPrevious;
    public Button btnNext;

    [Header("Images")]
    public Sprite spriteNormalButton;
    public Sprite spriteSelectedButton;

    [Header("Pagination Buttons - Should be odd number only")]
    [SerializeField] private int maxPageButton = 7; // should be odd number only

    [Header("UnityEvent")]
    public UnityEvent unityEventFunction;
    #endregion

    #region PRIVATE_VARIABLES    
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        if (maxPageButton % 2 == 0)
            maxPageButton--;

        btnFirstRecord.onClick.AddListener(FirstRecordButtonClick);
        btnLastRecord.onClick.AddListener(LastRecordButtonClick);
        btnPrevious.onClick.AddListener(PreviousRecordButtonClick);
        btnNext.onClick.AddListener(NextRecordButtonClick);
    }

    public void OnEnable()
    {
        GeneratePaginationButtons();
    }
    #endregion

    #region PUBLIC_METHODS
    public void SetData(int selectedPage, int totalRecords, int recordsPerPage)
    {
        this.Close();
        this.selectedPage = selectedPage;
        this.totalRecords = totalRecords;
        this.recordsPerPage = recordsPerPage;
        this.Open();
    }
    #endregion

    #region PRIVATE_METHODS
    private void GeneratePaginationButtons()
    {
        int paginationButtonCount;
        if(maxPageButton <= TotalPageCounts)
        {
            paginationButtonCount = maxPageButton;
        }
        else
        {
            paginationButtonCount = TotalPageCounts;
        }

        ClearButtonList();

        int initialButtonNumber = 1;
        int lastButtonNumber = paginationButtonCount;        

        if(selectedPage > (maxPageButton / 2) && (selectedPage + (maxPageButton / 2)) <= TotalPageCounts)
        {
            initialButtonNumber = selectedPage - (maxPageButton / 2);
            lastButtonNumber = selectedPage + (maxPageButton / 2);
        }
        else if(TotalPageCounts > maxPageButton && selectedPage >= ((TotalPageCounts - (maxPageButton / 2))+1))
        {
            initialButtonNumber = TotalPageCounts - maxPageButton + 1;
            lastButtonNumber = TotalPageCounts;
        }        

        for (int i= initialButtonNumber; i <= lastButtonNumber; i++)
        {
            Button newPageButton = Instantiate(pageButtonPrefab, buttonContainer);            
            newPageButton.transform.GetChild(0).GetComponent<TextMeshProUGUI>().text = i.ToString();
            newPageButton.interactable = i == selectedPage ? false : true;
            newPageButton.gameObject.GetComponent<Image>().sprite = i == selectedPage ? spriteSelectedButton : spriteNormalButton;
            //newPageButton.transform.GetChild(0).GetComponent<TextMeshProUGUI>().color = i == selectedPage ? Color.white : Color.black;
            buttonList.Add(newPageButton);

            int temp_value = i;
            newPageButton.onClick.AddListener(() => {
                selectedPage = temp_value;
                GeneratePaginationButtons();
                unityEventFunction.Invoke();
            });
        }

        if (selectedPage == 1)
            btnFirstRecord.interactable = btnPrevious.interactable = false;
        else
            btnFirstRecord.interactable = btnPrevious.interactable = true;

        if (selectedPage == TotalPageCounts)
            btnLastRecord.interactable = btnNext.interactable = false;
        else
            btnLastRecord.interactable = btnNext.interactable = true;

        if(selectedPage == 0)
        {
            btnFirstRecord.interactable = btnPrevious.interactable = false;
            btnFirstRecord.interactable = btnPrevious.interactable = false;
        }

        StartCoroutine(ForceUpdateCanvas());
    }

    private void ClearButtonList()
    {
        foreach(Button button in buttonList)
        {
            Destroy(button.gameObject);
        }

        buttonList.Clear();
    }

    private void FirstRecordButtonClick()
    {
        selectedPage = 1;
        GeneratePaginationButtons();
        unityEventFunction.Invoke();
    }

    private void LastRecordButtonClick()
    {
        selectedPage = TotalPageCounts;
        GeneratePaginationButtons();
        unityEventFunction.Invoke();
    }

    private void PreviousRecordButtonClick()
    {
        selectedPage--;
        GeneratePaginationButtons();
        unityEventFunction.Invoke();
    }

    private void NextRecordButtonClick()
    {
        selectedPage++;
        GeneratePaginationButtons();
        unityEventFunction.Invoke();
    }
    #endregion

    #region GETTER_SETTER_METHODS
    private int TotalPageCounts
    {
        get
        {            
            return (Mathf.CeilToInt((float)totalRecords / (float)recordsPerPage));
        }
    }
    #endregion

    #region IENUMERATORS
    IEnumerator ForceUpdateCanvas()
    {
        buttonContainer.gameObject.SetActive(false);
        yield return new WaitForEndOfFrame();
        Canvas.ForceUpdateCanvases();
        buttonContainer.gameObject.SetActive(true);
    }
    #endregion
}
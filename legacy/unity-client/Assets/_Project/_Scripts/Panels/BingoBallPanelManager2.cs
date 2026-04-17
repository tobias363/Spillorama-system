using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class BingoBallPanelManager2 : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Transform")]
    [SerializeField]
    private Transform transformBallContainer;

    [Header("Panel")]
    [SerializeField]
    private PrefabBingoBallPanel2 panelCurrentBingoBall;

    [Header("Prefab")]
    [SerializeField]
    private PrefabBingoBallPanel2 prefabBingoBall;

    [Header("Values")]
    [SerializeField]
    private int bingoBallSize = 94;

    [SerializeField]
    private int bingo1stBallDesiredPosition = -15;

    [SerializeField]
    private int bingoBallDistance = 148;

    [SerializeField]
    private float bingoBallHighlightScale = 1f;

    [SerializeField]
    private float bingoBallMovementAnimationTime = 1f;

    [SerializeField]
    private float bingoBallScaleAnimationTime = 0.5f;

    [SerializeField]
    private List<BingoNumberData> datas = new List<BingoNumberData>();

    private int bingoBallShowcaseCount = 5;
    private int bingoBallInitPosition = 0;
    private int activeBingoBalls = 0;
    private int bingoBallLimit = 6;
    private List<PrefabBingoBallPanel2> bingoBallInUsedList = new List<PrefabBingoBallPanel2>();
    private List<PrefabBingoBallPanel2> bingoBallUnusedList = new List<PrefabBingoBallPanel2>();
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        Reset();
    }

#if UNITY_EDITOR
    int tempBallIndex = 0;
    List<BingoNumberData> tempBingoList = new List<BingoNumberData>();

    private void Update()
    {
        if (Input.GetKeyUp(KeyCode.N))
        {
            BingoNumberData bingoNumberData = new BingoNumberData();
            bingoNumberData.number = tempBallIndex++;
            // NewWithdraw(bingoNumberData);
        }
        else if (Input.GetKeyUp(KeyCode.L))
        {
            tempBingoList.Clear();
            for (int i = 0; i < 3; i++)
            {
                BingoNumberData bingoNumberData = new BingoNumberData();
                bingoNumberData.number = tempBallIndex++;
                tempBingoList.Add(bingoNumberData);
            }
            // WithdrawList(tempBingoList);
        }
        else if (Input.GetKeyUp(KeyCode.P))
        {
            tempBingoList.Clear();
            for (int i = 0; i < 5; i++)
            {
                BingoNumberData bingoNumberData = new BingoNumberData();
                bingoNumberData.number = tempBallIndex++;
                tempBingoList.Add(bingoNumberData);
            }
            // WithdrawList(tempBingoList);
        }
    }
#endif
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Reset()
    {
        foreach (Transform transform in transformBallContainer)
            Destroy(transform.gameObject);

        panelCurrentBingoBall.Close();
        bingoBallInUsedList.Clear();
        bingoBallUnusedList.Clear();
        datas.Clear();
        isWon = false;
        dataWin = null;
        isFirstBall = false;
        isNewWithdraw = false;
        isBingoWin = false;

        bingoBallShowcaseCount = (
            (int)gameObject.GetComponent<RectTransform>().rect.width / bingoBallDistance
        );

        activeBingoBalls = 0;

        bingoBallLimit = bingoBallShowcaseCount + 2;
        GenerateBingoBalls();
    }

    //OLD Code
    // public void WithdrawList(List<BingoNumberData> bingoNumberDataList)
    // {
    //     if (bingoNumberDataList.Count > 0)
    //         DisplayBigBall(bingoNumberDataList[bingoNumberDataList.Count - 2]);

    //     if (bingoNumberDataList.Count > (bingoBallShowcaseCount + 2))
    //     {
    //         for (int i = bingoNumberDataList.Count - (bingoBallShowcaseCount + 2); i < bingoNumberDataList.Count; i++)
    //         {
    //             NewWithdraw(bingoNumberDataList[i], false);
    //         }
    //     }
    //     else
    //     {
    //         foreach (BingoNumberData bingoData in bingoNumberDataList)
    //         {
    //             NewWithdraw(bingoData, false);
    //         }
    //     }
    // }


    public void WithdrawList(
        List<BingoNumberData> bingoNumberDataList,
        BingoNumberData nextNumber,
        bool gPaused,
        string status
    )
    {
        if (status == "Waiting")
        {
            return;
        }
        datas = bingoNumberDataList;
        switch (gPaused)
        {
            case true:
                if (bingoNumberDataList.Count > 0)
                {
                    if (bingoNumberDataList.Count == 1)
                    {
                        DisplayBigBall(
                            bingoNumberDataList[bingoNumberDataList.Count - 1],
                            nextNumber,
                            gPaused
                        );
                    }
                    else
                    {
                        DisplayBigBall(
                            bingoNumberDataList[bingoNumberDataList.Count - 2],
                            nextNumber,
                            gPaused
                        );
                    }
                }
                if (bingoNumberDataList.Count > (bingoBallShowcaseCount + 2))
                {
                    for (
                        int i = bingoNumberDataList.Count - (bingoBallShowcaseCount + 2);
                        i < bingoNumberDataList.Count;
                        i++
                    )
                    {
                        NewWithdraw(bingoNumberDataList[i], nextNumber, gPaused, false);
                    }
                }
                else
                {
                    foreach (BingoNumberData bingoData in bingoNumberDataList)
                    {
                        NewWithdraw(bingoData, nextNumber, gPaused, false);
                    }
                }
                break;

            case false:
                if (bingoNumberDataList.Count > 0)
                {
                    Debug.Log(
                        $"UIManager.Instance.bingoHallDisplayPanel.isGameFinish : {UIManager.Instance.bingoHallDisplayPanel.isGameFinish}"
                    );
                    if (bingoNumberDataList[bingoNumberDataList.Count - 1].number == 0)
                    {
                        DisplayBigBall(
                            bingoNumberDataList[bingoNumberDataList.Count - 2],
                            nextNumber,
                            gPaused,
                            true
                        );
                    }
                    else
                    {
                        DisplayBigBall(
                            bingoNumberDataList[bingoNumberDataList.Count - 1],
                            nextNumber,
                            gPaused,
                            true
                        );
                    }
                }
                if (bingoNumberDataList.Count > (bingoBallShowcaseCount + 2))
                {
                    for (
                        int i = bingoNumberDataList.Count - (bingoBallShowcaseCount + 2);
                        i < bingoNumberDataList.Count;
                        i++
                    )
                    {
                        NewWithdraw(bingoNumberDataList[i], nextNumber, gPaused, false, false);
                        Debug.LogError($"SOUND1 : {bingoNumberDataList[i - 1].number}");
                        if (
                            UIManager.Instance.bingoHallDisplayPanel.currentLanguage
                            == "Norwegian Female"
                        )
                        {
                            SoundManager.Instance.PlayNorwegianFemaleNumberAnnouncement(
                                bingoNumberDataList[i - 1].number,
                                false
                            );
                        }
                        else if (
                            UIManager.Instance.bingoHallDisplayPanel.currentLanguage
                            == "Norwegian Male"
                        )
                        {
                            SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(
                                bingoNumberDataList[i - 1].number,
                                false
                            );
                        }
                        else
                        {
                            SoundManager.Instance.PlayNumberAnnouncement(
                                bingoNumberDataList[i - 1].number,
                                true
                            );
                        }
                    }
                }
                else
                {
                    if (
                        UIManager.Instance.bingoHallDisplayPanel.isRefresh
                        && !isNewWithdraw
                        && isFirstBall
                    )
                    {
                        NewWithdraw(datas[0], nextNumber, gPaused, true, true);
                        UIManager.Instance.bingoHallDisplayPanel.isRefresh = false;
                    }
                    else
                    {
                        foreach (BingoNumberData bingoData in bingoNumberDataList)
                        {
                            NewWithdraw(bingoData, nextNumber, gPaused, false, false);
                        }
                    }
                }
                break;
        }
    }

    public void SetWithdrawBall(BingoNumberData nextNumber, bool isFirstBall = false)
    {
        if (!panelCurrentBingoBall.isActiveAndEnabled)
        {
            panelCurrentBingoBall.Open();
        }
        if (!isWon)
        {
            this.isFirstBall = isFirstBall;
            if (isFirstBall)
            {
                Debug.LogError(nextNumber.nextNumber);
                panelCurrentBingoBall.SetBigBall(nextNumber);
                SetFirstBall(nextNumber);
                dataWin = nextNumber;
            }
            else
            {
                panelCurrentBingoBall.SetBigBall(nextNumber);
            }
        }
        else
        {
            if (isBingoWin)
            {
                dataWin = nextNumber;
                panelCurrentBingoBall.SetBigBall(nextNumber);
            }
            else
            {
                panelCurrentBingoBall.SetBigBall(nextNumber);
            }
        }
    }

    public void SetCurrenBigBall(BingoNumberData data)
    {
        panelCurrentBingoBall.SetBigBallOnWin(data);
    }

    bool isWon = false;
    bool isFirstBall;
    bool isBingoWin = false;

    public void DisplayBigBallOnWin(
        bool gameWin = false,
        bool isBingoWin = false,
        bool isGameFinish = false
    )
    {
        isWon = gameWin;
        this.isBingoWin = isBingoWin;
        if (
            UIManager.Instance.bingoHallDisplayPanel.isRefresh
            && UIManager.Instance.bingoHallDisplayPanel.isButtonTap
        )
        {
            if (!isNewWithdraw)
            {
                DisplayBigBall(dataWin, null, gameWin);
            }
            else
            {
                DisplayBigBall(datas[datas.Count - 2], null, true);
            }
            UIManager.Instance.bingoHallDisplayPanel.isRefresh = false;
        }
        if (isFirstBall)
        {
            panelCurrentBingoBall.SetBigBall(dataWin);
        }
        else
        {
            // if (UIManager.Instance.bingoHallDisplayPanel.isGameFinish)
            // {
            //     Debug.LogError($"DisplayBigBallOnWin UIManager.Instance.bingoHallDisplayPanel.isGameFinish : {UIManager.Instance.bingoHallDisplayPanel.isGameFinish}");
            //     Debug.LogError($"DisplayBigBallOnWin SetBigBallOnWin : {datas[datas.Count - 2].number}");
            //     panelCurrentBingoBall.SetBigBallOnWin(datas[datas.Count - 2]);
            // }
            // else
            // {
            if (dataWin.number == 0)
            {
                panelCurrentBingoBall.SetBigBall(dataWin);
            }
            else
            {
                Debug.LogError($"dataWin : {dataWin.number}");
                DisplayBigBall(dataWin, null, gameWin);
            }
            // }
        }
    }

    BingoNumberData dataWin = null;

    private void DisplayBigBall(
        BingoNumberData data,
        BingoNumberData nextNumber,
        bool gamePaused,
        bool isBigBall = false
    )
    {
        dataWin = data;
        Debug.Log($"BIGBALL dataWin : {dataWin.number}");
        if (!panelCurrentBingoBall.isActiveAndEnabled)
            panelCurrentBingoBall.Open();

        if (panelCurrentBingoBall)
        {
            // if (UIManager.Instance.bingoHallDisplayPanel.isGameFinish)
            // {
            //     Debug.LogError($"DisplayBigBall UIManager.Instance.bingoHallDisplayPanel.isGameFinish : {UIManager.Instance.bingoHallDisplayPanel.isGameFinish}");
            //     Debug.LogError($"DisplayBigBall SetBigBallOnWin : {datas[datas.Count - 2].number}");
            //     panelCurrentBingoBall.SetBigBallOnWin(datas[datas.Count - 2]);
            // }
            // else
            // {
            panelCurrentBingoBall.SetData(data, nextNumber, gamePaused, isBigBall);
            // }
        }
        // if (panelCurrentBingoBall)
        //     panelCurrentBingoBall.SetData(data);
    }

    public void SetFirstBall(BingoNumberData data)
    {
        SetNormalSizeOfBingoBalls(false);

        PrefabBingoBallPanel2 newWithdrawBingoBall;

        if (bingoBallUnusedList.Count > 0)
        {
            newWithdrawBingoBall = bingoBallUnusedList[0];
            bingoBallUnusedList.RemoveAt(0);
        }
        else
        {
            newWithdrawBingoBall = bingoBallInUsedList[0];
            bingoBallInUsedList.RemoveAt(0);
        }
        Debug.LogError(data.nextNumber);

        newWithdrawBingoBall.SetSmallBall(data);
        newWithdrawBingoBall.transform.localScale = new Vector3(
            bingoBallHighlightScale,
            bingoBallHighlightScale,
            bingoBallHighlightScale
        );

        Vector3 fromPosition;
        Vector3 toPosition;

        float animationTime = bingoBallMovementAnimationTime;
        fromPosition = new Vector3(bingoBallInitPosition, 0, 0);
        toPosition = new Vector3(bingo1stBallDesiredPosition, 0, 0);
        newWithdrawBingoBall.MoveObject(fromPosition, toPosition, animationTime);
        bingoBallInUsedList.Add(newWithdrawBingoBall);
        isFirstBall = false;
    }

    bool isNewWithdraw = false;

    public void NewWithdraw(
        BingoNumberData bingoNumberData,
        BingoNumberData nextNumber,
        bool gPaused,
        bool handleAnimation = true,
        bool isBigBall = false
    )
    {
        isNewWithdraw = true;
        if (isBigBall)
        {
            DisplayBigBall(bingoNumberData, nextNumber, gPaused, isBigBall);
        }
        SetNormalSizeOfBingoBalls(handleAnimation);

        PrefabBingoBallPanel2 newWithdrawBingoBall;

        if (bingoBallUnusedList.Count > 0)
        {
            newWithdrawBingoBall = bingoBallUnusedList[0];
            bingoBallUnusedList.RemoveAt(0);
        }
        else
        {
            newWithdrawBingoBall = bingoBallInUsedList[0];
            bingoBallInUsedList.RemoveAt(0);
        }

        newWithdrawBingoBall.SetData(bingoNumberData, nextNumber, gPaused, false);
        newWithdrawBingoBall.transform.localScale = new Vector3(
            bingoBallHighlightScale,
            bingoBallHighlightScale,
            bingoBallHighlightScale
        );

        Vector3 fromPosition;
        Vector3 toPosition;

        float animationTime = handleAnimation == true ? bingoBallMovementAnimationTime : 0;

        foreach (PrefabBingoBallPanel2 bingoBall in bingoBallInUsedList)
        {
            fromPosition = bingoBall.LastPosition;

            //if (false && bingoBallInUsedList.Count == bingoBallShowcaseCount && bingoBall == bingoBallInUsedList[0])
            //{
            //    toPosition = new Vector3((int)gameObject.GetComponent<RectTransform>().rect.width + bingoBallSize, 0, 0);
            //}
            //else
            //{
            toPosition = new Vector3(fromPosition.x + bingoBallDistance, 0, 0);
            //}
            bingoBall.MoveObject(bingoBall.LastPosition, toPosition, animationTime);
        }

        fromPosition = new Vector3(bingoBallInitPosition, 0, 0);
        toPosition = new Vector3(bingo1stBallDesiredPosition, 0, 0);
        newWithdrawBingoBall.MoveObject(fromPosition, toPosition, animationTime);
        bingoBallInUsedList.Add(newWithdrawBingoBall);
        activeBingoBalls++;
        if (
            bingoNumberData != null
            && bingoNumberData.number > 0
            && !bingoNumberData.color.Equals(null)
            && !gPaused
        )
        {
            if (!handleAnimation)
                return;
            Debug.Log($"SOUND2 : {bingoNumberData.number}");
            StartCoroutine(PlaySoundAfterDelay(animationTime, bingoNumberData));
        }
        isNewWithdraw = false;
    }

    //OLD CODE
    // public void NewWithdraw(BingoNumberData bingoNumberData, bool handleAnimation = true)
    // {
    //     DisplayBigBall(bingoNumberData);
    //     SetNormalSizeOfBingoBalls(handleAnimation);

    //     PrefabBingoBallPanel2 newWithdrawBingoBall;

    //     if (bingoBallUnusedList.Count > 0)
    //     {
    //         newWithdrawBingoBall = bingoBallUnusedList[0];
    //         bingoBallUnusedList.RemoveAt(0);
    //     }
    //     else
    //     {
    //         newWithdrawBingoBall = bingoBallInUsedList[0];
    //         bingoBallInUsedList.RemoveAt(0);
    //     }

    //     newWithdrawBingoBall.SetData(bingoNumberData);
    //     // newWithdrawBingoBall.SetData(bingoNumberData);
    //     newWithdrawBingoBall.transform.localScale = new Vector3(bingoBallHighlightScale, bingoBallHighlightScale, bingoBallHighlightScale);

    //     Vector3 fromPosition;
    //     Vector3 toPosition;

    //     float animationTime = handleAnimation == true ? bingoBallMovementAnimationTime : 0;

    //     foreach (PrefabBingoBallPanel2 bingoBall in bingoBallInUsedList)
    //     {
    //         fromPosition = bingoBall.LastPosition;

    //         //if (false && bingoBallInUsedList.Count == bingoBallShowcaseCount && bingoBall == bingoBallInUsedList[0])
    //         //{
    //         //    toPosition = new Vector3((int)gameObject.GetComponent<RectTransform>().rect.width + bingoBallSize, 0, 0);
    //         //}
    //         //else
    //         //{
    //         toPosition = new Vector3(fromPosition.x + bingoBallDistance, 0, 0);
    //         //}
    //         bingoBall.MoveObject(bingoBall.LastPosition, toPosition, animationTime);
    //     }

    //     fromPosition = new Vector3(bingoBallInitPosition, 0, 0);
    //     toPosition = new Vector3(bingo1stBallDesiredPosition, 0, 0);
    //     newWithdrawBingoBall.MoveObject(fromPosition, toPosition, animationTime);
    //     bingoBallInUsedList.Add(newWithdrawBingoBall);
    //     activeBingoBalls++;
    // }
    #endregion

    #region PRIVATE_METHODS
    private IEnumerator PlaySoundAfterDelay(float delay, BingoNumberData data)
    {
        SoundManager.Instance.delay = delay;
        yield return new WaitForSeconds(delay);

        if (UIManager.Instance.bingoHallDisplayPanel.currentLanguage == "Norwegian Female")
        {
            SoundManager.Instance.PlayNorwegianFemaleNumberAnnouncement(data.number, false);
        }
        else if (UIManager.Instance.bingoHallDisplayPanel.currentLanguage == "Norwegian Male")
        {
            SoundManager.Instance.PlayNorwegianMaleNumberAnnouncement(data.number, false);
        }
        else
        {
            SoundManager.Instance.PlayNumberAnnouncement(data.number, true);
        }
    }

    private void GenerateBingoBalls()
    {
        for (int i = 0; i < bingoBallLimit; i++)
        {
            PrefabBingoBallPanel2 newBingoBall = Instantiate(
                prefabBingoBall,
                transformBallContainer
            );
            newBingoBall.GetComponent<RectTransform>().sizeDelta = new Vector3(
                bingoBallSize,
                bingoBallSize
            );

            newBingoBall.GetComponent<RectTransform>().pivot = new Vector2(1, 0.5f);
            newBingoBall.GetComponent<RectTransform>().SetAnchor(AnchorPresets.MiddleLeft);

            newBingoBall.Close();
            bingoBallUnusedList.Add(newBingoBall);
        }
    }

    private void SetNormalSizeOfBingoBalls(bool handleAnimation = true)
    {
        foreach (PrefabBingoBallPanel2 bingoBall in bingoBallInUsedList)
        {
            if (handleAnimation && bingoBall.transform.localScale != Vector3.one)
                Utility.Instance.ChangeScale(
                    bingoBall.transform,
                    Vector3.one,
                    bingoBallScaleAnimationTime
                );
            else
                bingoBall.transform.localScale = Vector3.one;
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}

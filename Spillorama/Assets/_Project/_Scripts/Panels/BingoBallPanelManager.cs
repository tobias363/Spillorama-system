using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class BingoBallPanelManager : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    [Header("Transform")]
    [SerializeField]
    private Transform transformBallContainer;

    [Header("Prefab")]
    [SerializeField]
    private PrefabBingoBallPanel prefabBingoBall;

    [Header("Values")]
    [SerializeField]
    private bool horizontalStyle = false;

    [SerializeField]
    private int bingoBallSize = 90;

    [SerializeField]
    private int bingoBallDistance = 100;

    [SerializeField]
    private float bingoBallHighlightScale = 1.15f;

    [SerializeField]
    private float bingoBallMovementAnimationTime = 0.5f;

    [SerializeField]
    private float bingoBallScaleAnimationTime = 0.25f;

    private int bingoBallShowcaseCount = 5;
    private int bingoBallInitPosition = 520;
    private int activeBingoBalls = 0;
    private int bingoBallLimit = 6;
    private List<PrefabBingoBallPanel> bingoBallInUsedList = new List<PrefabBingoBallPanel>();
    private List<PrefabBingoBallPanel> bingoBallUnusedList = new List<PrefabBingoBallPanel>();
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
            NewWithdraw(bingoNumberData);
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
            WithdrawList(tempBingoList);
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
            WithdrawList(tempBingoList);
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

        bingoBallInUsedList.Clear();
        bingoBallUnusedList.Clear();

        if (horizontalStyle)
            bingoBallInitPosition = (int)gameObject.GetComponent<RectTransform>().rect.width;
        else
            bingoBallInitPosition = (int)gameObject.GetComponent<RectTransform>().rect.height;
        bingoBallShowcaseCount = (bingoBallInitPosition / bingoBallDistance);

        activeBingoBalls = 0;

        bingoBallLimit = bingoBallShowcaseCount + 1;
        GenerateBingoBalls();
    }

    public void WithdrawList(List<BingoNumberData> bingoNumberDataList, string gameType = null)
    {
        if (bingoNumberDataList.Count > bingoBallShowcaseCount)
        {
            for (
                int i = bingoNumberDataList.Count - bingoBallShowcaseCount;
                i < bingoNumberDataList.Count;
                i++
            )
            {
                NewWithdraw(bingoNumberDataList[i], true, gameType);
            }
        }
        else
        {
            foreach (BingoNumberData bingoData in bingoNumberDataList)
            {
                NewWithdraw(bingoData, true, gameType);
            }
        }
    }

    public void NewWithdraw(
        BingoNumberData bingoNumberData,
        bool handleAnimation = true,
        string gameType = null
    )
    {
        SetNormalSizeOfBingoBalls(handleAnimation);

        PrefabBingoBallPanel newWithdrawBingoBall;

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

        newWithdrawBingoBall.SetData(bingoNumberData, gameType);
        //newWithdrawBingoBall.transform.localScale = new Vector3(bingoBallHighlightScale, bingoBallHighlightScale, bingoBallHighlightScale);
        newWithdrawBingoBall.ChangeScale(
            new Vector3(bingoBallHighlightScale, bingoBallHighlightScale, bingoBallHighlightScale),
            0
        );
        //newWithdrawBingoBall.Open();
        bingoBallInUsedList.Add(newWithdrawBingoBall);

        Vector3 fromPosition;
        Vector3 toPosition;
        if (horizontalStyle)
        {
            fromPosition = new Vector3(bingoBallInitPosition, 0, 0);
            toPosition = new Vector3(activeBingoBalls * bingoBallDistance, 0, 0);
        }
        else
        {
            fromPosition = new Vector3(0, bingoBallInitPosition, 0);
            toPosition = new Vector3(0, activeBingoBalls * bingoBallDistance, 0);
        }

        float animationTime = handleAnimation == true ? GetAnimationTime() : 0;

        if (activeBingoBalls < (bingoBallLimit - 1))
        {
            //Utility.Instance.MoveObject(newWithdrawBingoBall.transform, fromPosition, toPosition, animationTime);
            newWithdrawBingoBall.MoveObject(fromPosition, toPosition, animationTime);
            activeBingoBalls++;
        }
        else
        {
            if (horizontalStyle)
                newWithdrawBingoBall.transform.localPosition = new Vector3(
                    activeBingoBalls * bingoBallDistance,
                    0,
                    0
                );
            else
                newWithdrawBingoBall.transform.localPosition = new Vector3(
                    0,
                    activeBingoBalls * bingoBallDistance,
                    0
                );

            int ballIndex = -1;

            foreach (PrefabBingoBallPanel bingoBall in bingoBallInUsedList)
            {
                if (horizontalStyle)
                    toPosition = new Vector3(ballIndex * bingoBallDistance, 0, 0);
                else
                    toPosition = new Vector3(0, ballIndex * bingoBallDistance, 0);

                ballIndex++;
                //Utility.Instance.MoveObject(bingoBall.transform, toPosition, animationTime);
                bingoBall.MoveObject(toPosition, animationTime);
            }
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void GenerateBingoBalls()
    {
        for (int i = 0; i < bingoBallLimit; i++)
        {
            PrefabBingoBallPanel newBingoBall = Instantiate(
                prefabBingoBall,
                transformBallContainer
            );
            newBingoBall.GetComponent<RectTransform>().sizeDelta = new Vector3(
                bingoBallSize,
                bingoBallSize
            );

            if (horizontalStyle)
            {
                newBingoBall.GetComponent<RectTransform>().pivot = new Vector2(0, 0.5f);
                newBingoBall.GetComponent<RectTransform>().SetAnchor(AnchorPresets.MiddleLeft);
            }
            else
            {
                newBingoBall.GetComponent<RectTransform>().pivot = new Vector2(0.5f, 0);
                newBingoBall.GetComponent<RectTransform>().SetAnchor(AnchorPresets.BottomCenter);
            }

            newBingoBall.Close();
            bingoBallUnusedList.Add(newBingoBall);
        }
    }

    private float GetAnimationTime()
    {
        if (activeBingoBalls == bingoBallShowcaseCount)
        {
            return ((bingoBallLimit - activeBingoBalls + 1) * bingoBallMovementAnimationTime)
                / bingoBallLimit;
        }
        else
            return ((bingoBallLimit - activeBingoBalls) * bingoBallMovementAnimationTime)
                / bingoBallLimit;
    }

    private void SetNormalSizeOfBingoBalls(bool handleAnimation = true)
    {
        foreach (PrefabBingoBallPanel bingoBall in bingoBallInUsedList)
        {
            if (handleAnimation && bingoBall.transform.localScale != Vector3.one)
                bingoBall.ChangeScale(Vector3.one * 0.85f, bingoBallScaleAnimationTime); //Utility.Instance.ChangeScale(bingoBall.transform, Vector3.one, bingoBallScaleAnimationTime);
            else
                bingoBall.ChangeScale(Vector3.one * 0.85f, 0); //bingoBall.transform.localScale = Vector3.one;
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}

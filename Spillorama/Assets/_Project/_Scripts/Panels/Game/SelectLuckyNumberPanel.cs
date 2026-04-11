using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class SelectLuckyNumberPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public CustomUnityEventInt eventLuckyNumberSelected;
    public int totalLuckyNumber = 10;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Prefabs")]
    [SerializeField] private PrefabLuckeyNumberBall prefabLuckyNumberBall;

    [Header("Transform")]
    [SerializeField] private Transform transformLuckryBallContainer;

    internal List<PrefabLuckeyNumberBall> listLuckeyNumberBall = new List<PrefabLuckeyNumberBall>();

    internal bool isLuckyNumbersGenerated = false;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        //GenerateLuckyNumbers();
    }    
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetLuckyNumber(int luckyNumber)
    {
        DeselectAllBalls();
        foreach (PrefabLuckeyNumberBall ball in listLuckeyNumberBall)
        {
            if(ball.Number == luckyNumber)
            {
                RefreshLuckeyNumberSelection(ball);
                break;
            }
        }
    }

    private void DeselectAllBalls()
    {
        foreach (PrefabLuckeyNumberBall ball in listLuckeyNumberBall)
        {
            ball.Selection = false;
        }
    }

    public void RefreshLuckeyNumberSelection(PrefabLuckeyNumberBall prefabLuckyNumberBall)
    {
        DeselectAllBalls();

        prefabLuckyNumberBall.Selection = true;

        eventLuckyNumberSelected.Invoke(prefabLuckyNumberBall.Number);
        this.Close();
    }

    public void GenerateLuckyNumbers(int luckyNumber = 0)
    {
        if (isLuckyNumbersGenerated == false)
        {
            foreach (Transform transform in transformLuckryBallContainer)
                Destroy(transform.gameObject);

            for (int i = 1; i <= totalLuckyNumber; i++)
            {
                PrefabLuckeyNumberBall newLuckyNumber = Instantiate(prefabLuckyNumberBall, transformLuckryBallContainer);
                newLuckyNumber.SetData(i, this);
                listLuckeyNumberBall.Add(newLuckyNumber);
            }

            isLuckyNumbersGenerated = true;
        }
        SetLuckyNumber(luckyNumber);        
    }

    public void ClosePanel()
    {
        this.Close();
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}

using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class WithdrawNumberHistoryPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Prefab")]
    [SerializeField] private PrefabWithdrawNumberHistoryBall prefabNumberBall;

    [Header("Transform")]
    [SerializeField] private Transform transformBallContainer;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS    
    public void ClosePanel()
    {
        this.Close();
    }

    public void AddNumber(BingoNumberData bingoNumber)
    {
        InstantiateBingoBall(bingoNumber.number);
    }

    public void AddNumber(List<BingoNumberData> bingoNumberList)
    {
        foreach (BingoNumberData bingoNumber in bingoNumberList)
            InstantiateBingoBall(bingoNumber.number);
    }    

    public void Reset()
    {
        foreach (Transform tObj in transformBallContainer)
            Destroy(tObj.gameObject);
    }
    #endregion

    #region PRIVATE_METHODS
    private void InstantiateBingoBall(int number)
    {
        PrefabWithdrawNumberHistoryBall newBingoBall = Instantiate(prefabNumberBall, transformBallContainer);
        newBingoBall.Number = number;
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}

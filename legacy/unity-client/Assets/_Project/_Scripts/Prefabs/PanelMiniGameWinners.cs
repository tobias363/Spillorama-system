using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PanelMiniGameWinners : MonoBehaviour
{
    #region PUBLIC_VARIABLES	
    [Header("Prefabs")]
    public PrefabMiniGameWinPlayerDetails prefabMiniGameWinPlayerDetails;

    [Header("Transform")]
    public Transform PlayerDetailsContainers;

    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {

    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void OpenData(WinningTicketNumbers winningTicketNumbers, bool isAutoRefresh = false)
    {
        PrefabMiniGameWinPlayerDetails winningObject = null;

        if (winningTicketNumbers != null)
        {
            this.Open();
            Reset();
            if (winningTicketNumbers.physicalWinners != null)
            {
                foreach (WinnerField winner in winningTicketNumbers.physicalWinners)
                {
                    winningObject = Instantiate(prefabMiniGameWinPlayerDetails, PlayerDetailsContainers);
                    winningObject.SetData("Physical", winner.ticketNumber, winner.winningAmount);
                }
            }
            if (winningTicketNumbers.onlineWinners != null)
            {
                foreach (WinnerField winner in winningTicketNumbers.onlineWinners)
                {
                    winningObject = Instantiate(prefabMiniGameWinPlayerDetails, PlayerDetailsContainers);
                    winningObject.SetData("Online", winner.ticketNumber, winner.winningAmount);
                }
            }
            if (winningTicketNumbers.uniqueWinners != null)
            {
                foreach (WinnerField winner in winningTicketNumbers.uniqueWinners)
                {
                    winningObject = Instantiate(prefabMiniGameWinPlayerDetails, PlayerDetailsContainers);
                    winningObject.SetData("Unique", winner.ticketNumber, winner.winningAmount);
                }
            }
        }
        else
        {
            Debug.LogError("miniGameBroadcast or winningTicketNumbers is null!");
        }

        if (isAutoRefresh)
            StartCoroutine(Auto_Refresh_Lobby());
    }


    public void Reset()
    {
        if (PlayerDetailsContainers.childCount > 0)
            foreach (Transform child in PlayerDetailsContainers)
            {
                Destroy(child.gameObject);
            }
    }

    #endregion

    #region COROUTINES

    IEnumerator Auto_Refresh_Lobby()
    {
        float time = 7f;

        while (time > 0f)
        {
            time -= Time.deltaTime;
            yield return new WaitForEndOfFrame();
        }

#if UNITY_WEBGL
        if (!UIManager.Instance.isGameWebGL)
        {
        UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(false);
        UIManager.Instance.bingoHallDisplayPanel.gameObject.SetActive(true);
        }

#endif
        StopCoroutine(Auto_Refresh_Lobby());
    }

    #endregion
}

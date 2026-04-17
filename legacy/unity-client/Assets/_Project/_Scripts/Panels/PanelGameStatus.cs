using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PanelGameStatus : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public string gameName;

    public Button _PlayButton;
    public TMP_Text _txtPlayButton;
    public TMP_Text _txtStatus;
    public string status;


    [Header("Images")]
    [SerializeField] private Sprite imgActive;
    [SerializeField] private Sprite imgDeActive;
    #endregion

    #region PRIVATE_VARIABLES   
    [SerializeField] GameStatusData gameStatusData;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS   

    public void SetData(string gameName ,GameStatusData gameStatusData)
    {
        this.gameStatusData = gameStatusData;
        status = gameStatusData.status;
        switch (gameStatusData.status)
        {
            case "Start at":
                _PlayButton.gameObject.SetActive(true);
                _PlayButton.GetComponent<Image>().sprite = imgActive;
                _txtPlayButton.text = Constants.LanguageKey.PreOrderForTodaysGame;
                _txtStatus.text = Constants.LanguageKey.StartMessage +" " + Utility.Instance.GetDateTimeLocalGameStatus(gameStatusData.date).ToString("HH:mm");
                if (gameName == "game_4" || gameName == "game_5")
                    _PlayButton.gameObject.SetActive(false);
                else
                    _PlayButton.interactable = true;
                break;
            case "Open":
                _PlayButton.gameObject.SetActive(true);
                _PlayButton.GetComponent<Image>().sprite = imgActive;
                _txtPlayButton.text = Constants.LanguageKey.PlayNowGame;
                _PlayButton.interactable = true;
                _txtStatus.text = Constants.LanguageKey.OpenMessage;
                break;
            case "Closed":
                _txtPlayButton.text = Constants.LanguageKey.PlayNowGame;
                _PlayButton.gameObject.SetActive(false);
                _PlayButton.interactable = false;
                _txtStatus.text = Constants.LanguageKey.ClosedMessage;
                break;
            default:
                break;
        }
    }
    #endregion

    #region POINTER_METHOD

    #endregion

    #region PRIVATE_METHODS

    #endregion

    #region COROUTINES    


    #endregion

    #region GETTER_SETTER    

    #endregion
}

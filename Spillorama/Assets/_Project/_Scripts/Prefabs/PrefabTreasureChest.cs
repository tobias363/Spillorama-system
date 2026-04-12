using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabTreasureChest : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Images")]
    [SerializeField] private Image imgCloseChest;
    [SerializeField] private Image imgOpenChest;

    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtChestNumber;
    [SerializeField] private TextMeshProUGUI txtPrize;

    [Header("Canvas Group")]
    [SerializeField] private CanvasGroup canvasGroup;

    private TreasureChestPanel treasureChestPanel;
    internal long prize;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(TreasureChestPanel treasureChestPanel, int number, long prize, Sprite spriteCloseChest, Sprite spriteOpenChest, Color32 colorChestNumberText, bool can_Open_Box)
    {
        this.treasureChestPanel = treasureChestPanel;
        this.prize = prize;

        txtChestNumber.text = number.ToString();
        txtPrize.text = prize.ToString() + " kr";

        imgCloseChest.sprite = spriteCloseChest;
        imgOpenChest.sprite = spriteOpenChest;
        txtChestNumber.color = colorChestNumberText;
        imgCloseChest.raycastTarget = can_Open_Box;
    }

    public void TapOnChest()
    {
        treasureChestPanel.TreasureChestOpenFunction(this);
    }

    public void OpenChest(long prize, bool winningChest)
    {
        txtPrize.text = prize.ToString() +" kr";

        imgCloseChest.Close();
        imgOpenChest.Open();

        canvasGroup.alpha = winningChest ? 1 : 0.5f;
    }
    
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public long WinningPrize
    {
        get
        {
            return prize;
        }
    }
    #endregion
}

using TMPro;
using UnityEngine;
using UnityEngine.UI;
using static Constants;

public class PrefabGame1TicketPurchaseSubType : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtTicketTypeAndPrice;
    [SerializeField] private TextMeshProUGUI txtTicketQty;

    [Header("Buttons")]
    [SerializeField] private Button btnDecrement;
    [SerializeField] private Button btnIncrement;

    [Header("Data")]    
    [SerializeField] private Game1TicketType data;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(Game1TicketType data)
    {
        this.data = data;                
        txtTicketTypeAndPrice.text = data.ticketName + " " + data.price + Constants.StringClass.currencySymbol;
        CurrentQty = this.data.minQty;
    }

    public void OnIncrementButtonTap()
    {
        CurrentQty++;
    }

    public void OnDecrementButtonTap()
    {
        CurrentQty--;
    }

    public void AllowMorePurchase(bool allow)
    {
        if(allow)
        {
            btnIncrement.interactable = CurrentQty < data.maxQty;
        }
        else
        {
            btnIncrement.interactable = false;
        }
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public int CurrentQty
    {
        set
        {
            this.data.currentQty = value;
            txtTicketQty.text = value.ToString();
            
            btnDecrement.interactable = value != this.data.minQty;
            btnIncrement.interactable = value != this.data.maxQty;

            UIManager.Instance.game1Panel.game1TicketPurchasePanel.RefreshTotalTicketCount();
        }
        get
        {
            return this.data.currentQty;
        }
    }

    public Game1TicketType TicketData
    {
        get
        {
            return data;
        }
    }
    #endregion
}

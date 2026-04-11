using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.UIElements;

public class VoucherPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtPoints;
    [SerializeField] private TextMeshProUGUI txtRecordsNotFound;

    [Header("Transform")]
    [SerializeField] private Transform transformVoucherContainer;

    [Header("Prefab")]
    [SerializeField] private PrefabVoucherCard prefabVoucherCard;

    [Header("Prefab")]
    [SerializeField] private GridLayoutGroup gridLayoutGroup;

    private List<PrefabVoucherCard> voucherList = new List<PrefabVoucherCard>();
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnBackButtonTap()
    {
        this.Close();
        UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
    }

    public void Open(List<VoucherData> voucherDataList)
    {
        Reset();        
        txtRecordsNotFound.gameObject.SetActive(voucherDataList.Count == 0);        
        foreach (VoucherData data in voucherDataList)
        {
            PrefabVoucherCard newVoucher = Instantiate(prefabVoucherCard, transformVoucherContainer);
            newVoucher.SetData(data);
            this.voucherList.Add(newVoucher);
        }
        
        this.Open();
        StartCoroutine(ModifyGridLayoutGroup());
    }
    #endregion

    #region PRIVATE_METHODS
    private void Reset()
    {
        foreach (Transform tObj in transformVoucherContainer)
            Destroy(tObj.gameObject);
        voucherList.Clear();
    }

    private IEnumerator ModifyGridLayoutGroup()
    {
        yield return new WaitForEndOfFrame();

        float panelHeight = gridLayoutGroup.GetComponent<RectTransform>().rect.height;
        float ticketHeight = gridLayoutGroup.cellSize.y;        

        if (panelHeight > ticketHeight)
            gridLayoutGroup.childAlignment = TextAnchor.UpperCenter;
        else
            gridLayoutGroup.childAlignment = TextAnchor.UpperLeft;
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public string Points
    {
        set
        {            
            txtPoints.text = value.ToString();                                                    
            foreach (PrefabVoucherCard voucher in voucherList)
                voucher.RefreshRedeemOption();
        }
    }
    #endregion
}

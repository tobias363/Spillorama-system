using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.SocketIO;
using I2.Loc;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class PrefabVoucherCard : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    [SerializeField] private TextMeshProUGUI txtExpiryDate;

    [Header("LocalizationParamsManager")]
    [SerializeField] private LocalizationParamsManager localizationParamsManagerPercentageOff;
    [SerializeField] private LocalizationParamsManager localizationParamsManagerPoints;
    [SerializeField] private LocalizationParamsManager localizationParamsManagerRemainingRedeemPoints;

    [Header("Button")]
    [SerializeField] private Button btnRedeem;
    [SerializeField] private Button btnRedeemed;
    [SerializeField] private Button btnRedeemPointsRemaining;

    [Header("Data")]
    [SerializeField] private VoucherData data;

    private CanvasGroup canvasGroup = null;
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void SetData(VoucherData data)
    {
        this.data = data;

#if !UNITY_WEBGL
        localizationParamsManagerPercentageOff.SetParameterValue("VALUE1", data.percentageOff.ToString());
        localizationParamsManagerPoints.SetParameterValue("VALUE1", data.redeemPoints.ToString());
#endif
        SetExpiryDate(data.expiryDate);

        RefreshRedeemOption();
    }

    public void SetExpiryDate(string dateString)
    {
        DateTime dateTime = Utility.Instance.GetDateTimeLocal(dateString);
        txtExpiryDate.text = dateTime.Day.ToString("00") + "-" + dateTime.Month.ToString("00") + "-" + dateTime.Year;
    }

    public void OnRedeemButtonTap()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.RedeemVoucher(data.id, RedeemVoucherHandler);
    }

    public void RefreshRedeemOption()
    {
        btnRedeemed.Close();
        btnRedeem.Close();
        btnRedeemPointsRemaining.Close();

        if (data.redeemed == false)
        {
            if (data.redeemPoints <=int.Parse( UIManager.Instance.gameAssetData.Points))
            {
                btnRedeem.Open();
            }
            else
            {
                btnRedeemPointsRemaining.Open();
#if !UNITY_WEBGL
                localizationParamsManagerRemainingRedeemPoints.SetParameterValue("VALUE1", (data.redeemPoints - int.Parse(UIManager.Instance.gameAssetData.Points)).ToString());
#endif
            }
        }
        else
        {
            btnRedeemed.Open();

            if (canvasGroup == null)
                canvasGroup = gameObject.AddComponent<CanvasGroup>();

            canvasGroup.alpha = 0.5f;
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private void RedeemVoucherHandler(Socket socket, Packet packet, object[] args)
    {
        UIManager.Instance.DisplayLoader(false);
        Debug.Log("RedeemVoucherHandler: " + packet.ToString());

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            this.data.redeemed = true;
        }

        UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}

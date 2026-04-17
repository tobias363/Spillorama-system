using UnityEngine;
using TMPro;
using System.Collections.Generic;
using I2.Loc;

public class ClaimWinnerPanel : MonoBehaviour
{
    [SerializeField] RectTransform missedWinningClaimsContainer;
    [SerializeField] RectTransform panelRowWinnerContainer;
    [SerializeField] GameObject panelRowWinner;
    [SerializeField] GameObject unclaimedWinningPanel;
    [SerializeField] GameObject noUnclaimedTicketsFound;
    [SerializeField] TextMeshProUGUI txtTicketNumber;
    [SerializeField] RowWinningData rowWinningDataPrefab;
    [SerializeField] MissedWinningClaimsData missedWinningClaimsDataPrefab;
    [SerializeField] ClaimWinnerTicket claimWinnerTicket;

    public void SetData(ClaimWinningResponse claimWinningResponse)
    {
        txtTicketNumber.GetComponent<LocalizationParamsManager>().SetParameterValue("value", claimWinningResponse.ticketNumber.ToString());
        panelRowWinner.SetActive(claimWinningResponse.winners.Count > 0);
        noUnclaimedTicketsFound.SetActive(claimWinningResponse.unclaimedWinners.Count == 0 || claimWinningResponse.unclaimedWinners == null);
        SetRowWinnerData(claimWinningResponse.winners);
        SetMissedWinningClaimsData(claimWinningResponse.unclaimedWinners);
        claimWinnerTicket.SetData(claimWinningResponse);
        this.Open();
    }

    void SetRowWinnerData(List<ClaimWinner> winners)
    {
        foreach (Transform transformObj in panelRowWinnerContainer.transform)
        {
            Destroy(transformObj.gameObject);
        }
        for (int i = 0; i < winners.Count; i++)
        {
            RowWinningData rowWinningData = Instantiate(rowWinningDataPrefab, panelRowWinnerContainer.transform);
            rowWinningData.SetData(winners[i].lineType, winners[i].wonAmount.ToString(), winners[i].showPrize);
        }
    }

    void SetMissedWinningClaimsData(List<UnclaimedWinners> unclaimedWinners)
    {
        foreach (Transform transformObj in missedWinningClaimsContainer.transform)
        {
            Destroy(transformObj.gameObject);
        }
        for (int i = 0; i < unclaimedWinners.Count; i++)
        {
            MissedWinningClaimsData missedWinningClaimsData = Instantiate(missedWinningClaimsDataPrefab, missedWinningClaimsContainer.transform);
            missedWinningClaimsData.SetData(unclaimedWinners[i]);
        }
    }

    public void CloseBtnTap()
    {
        this.Close();
    }
}

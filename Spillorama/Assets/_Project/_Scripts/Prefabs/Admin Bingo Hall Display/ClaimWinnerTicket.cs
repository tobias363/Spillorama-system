using UnityEngine;
using TMPro;
using System.Collections.Generic;

public class ClaimWinnerTicket : MonoBehaviour
{
    [SerializeField] List<TextMeshProUGUI> txtRow1;
    [SerializeField] List<TextMeshProUGUI> txtRow2;
    [SerializeField] List<TextMeshProUGUI> txtRow3;
    [SerializeField] List<TextMeshProUGUI> txtRow4;
    [SerializeField] List<TextMeshProUGUI> txtRow5;

    public void SetData(ClaimWinningResponse resp)
    {
        List<int> Row1Count = new List<int>();
        List<int> Row2Count = new List<int>();
        List<int> Row3Count = new List<int>();
        List<int> Row4Count = new List<int>();
        List<int> Row5Count = new List<int>();
        List<bool> Row1Show = new List<bool>();
        List<bool> Row2Show = new List<bool>();
        List<bool> Row3Show = new List<bool>();
        List<bool> Row4Show = new List<bool>();
        List<bool> Row5Show = new List<bool>();

        for (int i = 0; i < resp.ticket.Count; i++)
        {
            int number = resp.ticket[i].Number;
            bool show = resp.ticket[i].show;

            // Split into 5 groups based on index
            int group = i / 5;

            switch (group)
            {
                case 0: Row1Count.Add(number); Row1Show.Add(show); break;
                case 1: Row2Count.Add(number); Row2Show.Add(show); break;
                case 2: Row3Count.Add(number); Row3Show.Add(show); break;
                case 3: Row4Count.Add(number); Row4Show.Add(show); break;
                case 4: Row5Count.Add(number); Row5Show.Add(show); break;
            }
        }

        // Now assign values to UI texts
        for (int j = 0; j < Row1Count.Count; j++)
        {
            txtRow1[j].text = Row1Count[j].ToString();
            txtRow1[j].gameObject.SetActive(Row1Show[j]);
        }
        for (int j = 0; j < Row2Count.Count; j++)
        {
            txtRow2[j].text = Row2Count[j].ToString();
            txtRow2[j].gameObject.SetActive(Row2Show[j]);
        }
        for (int j = 0; j < Row3Count.Count; j++)
        {
            if (j != 2)
            {
                txtRow3[j].text = Row3Count[j].ToString();
            }
            if (j != 2)
            {
                txtRow3[j].gameObject.SetActive(Row3Show[j]);
            }
        }
        for (int j = 0; j < Row4Count.Count; j++)
        {
            txtRow4[j].text = Row4Count[j].ToString();
            txtRow4[j].gameObject.SetActive(Row4Show[j]);
        }
        for (int j = 0; j < Row5Count.Count; j++)
        {
            txtRow5[j].text = Row5Count[j].ToString();
            txtRow5[j].gameObject.SetActive(Row5Show[j]);
        }
    }
}
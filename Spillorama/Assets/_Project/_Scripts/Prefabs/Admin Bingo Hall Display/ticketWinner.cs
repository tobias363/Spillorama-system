using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using TMPro;

public class ticketWinner : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    //[Header ("Gamobjects")]

    //[Header ("Transforms")]


    //[Header ("ScriptableObjects")]


    //[Header ("DropDowns")]


    // [Header("Images")]

    //[Header("Sprites")]

    [Header("Text")]
    // Text arrays for each row of the Bingo card
    public TextMeshProUGUI[] row1Texts;
    public TextMeshProUGUI[] row2Texts;
    public TextMeshProUGUI[] row3Texts;
    public TextMeshProUGUI[] row4Texts;
    public TextMeshProUGUI[] row5Texts;
    public TextMeshProUGUI pattrenName;

    //[Header ("Prefabs")]

    //[Header ("Enums")]


    [Header("Variables")]
    public List<List<string>> allWinningTickets;
    public int currentTicketIndex = 0;
    private Coroutine autoSwitchCoroutine;
    List<WinningTicket> winningData;
    #endregion

    #region PRIVATE_VARIABLES

    #endregion

    #region UNITY_CALLBACKS
    void Start()
    {
        allWinningTickets = new List<List<string>>();
    }
    // Use this for initialization
    void OnEnable()
    {
    }
    void OnDisable()
    {

    }
    // Update is called once per frame
    void Update()
    {

    }
    #endregion

    #region DELEGATE_CALLBACKS


    #endregion

    #region PUBLIC_METHODS
    // Function to switch to the next ticket
    public void ShowNextTicket()
    {
        currentTicketIndex++;
        if (currentTicketIndex >= allWinningTickets.Count)
        {
            currentTicketIndex = 0; // Loop back to the first ticket
        }
        DisplayWinningNumbers(currentTicketIndex);
        // Update the pattern name based on the new ticket's pattern
        UpdatePatternName(currentTicketIndex);
    }

    private void UpdatePatternName(int ticketIndex)
    {
        if (ticketIndex >= 0 && ticketIndex < allWinningTickets.Count)
        {
            string patternName = ""; // Default value for pattern name

            // Get the pattern name for the ticket at the specified index
            WinningTicket currentTicket = winningData[ticketIndex];
            patternName = currentTicket.patternName;

            // Update the pattern name text
            pattrenName.text = patternName;
        }
    }

    // Method to set multiple winning tickets and start auto-switching if more than one ticket
    public void SetWinningTickets(List<List<string>> winningTickets, string displayName, List<WinningTicket> data)
    {
        winningData = data;
        // pattrenName.text = displayName;

        if (displayName == "Row 1" || displayName == "Row 2" || displayName == "Row 3" || displayName == "Row 4")
        {
            pattrenName.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubRow") + " " + displayName.Split(' ')[1];
        }
        else if (displayName == "Picture")
        {
            pattrenName.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubPicture");
        }
        else if (displayName == "Frame")
        {
            pattrenName.text = I2.Loc.LocalizationManager.GetTranslation("TextDataSubFrame");
        }
        else if (displayName == "Full House")
        {
            pattrenName.text = I2.Loc.LocalizationManager.GetTranslation("Full House");
        }

        allWinningTickets = winningTickets;
        currentTicketIndex = 0;
        DisplayWinningNumbers(currentTicketIndex);

        // If there are more than 1 ticket, start auto-switching every 3 seconds
        if (allWinningTickets.Count > 1)
        {
            if (autoSwitchCoroutine != null)
            {
                StopCoroutine(autoSwitchCoroutine);
            }
            autoSwitchCoroutine = StartCoroutine(AutoSwitchTickets());
        }
    }



    // Method to reset all rows' text fields to empty
    public void ResetAllRows()
    {
        ResetRow(row1Texts);
        ResetRow(row2Texts);
        ResetRow(row3Texts);
        ResetRow(row4Texts);
        ResetRow(row5Texts);
        pattrenName.text = "";
    }

    // Helper function to reset a single row
    private void ResetRow(TextMeshProUGUI[] rowTexts)
    {
        for (int i = 0; i < rowTexts.Length; i++)
        {
            rowTexts[i].text = ""; // Reset to empty string
        }
    }
    #endregion

    #region PRIVATE_METHODS
    // Helper function to assign numbers to text fields for each row
    private void AssignRow(TextMeshProUGUI[] rowTexts, List<string> rowNumbers)
    {
        for (int i = 0; i < rowTexts.Length; i++)
        {
            if (!string.IsNullOrEmpty(rowNumbers[i]))
            {
                rowTexts[i].text = rowNumbers[i]; // Set the number if it's not empty
            }
            else
            {
                rowTexts[i].text = ""; // Clear the text if it's an empty string
            }
        }
    }

    // Function to display a particular ticket by index
    private void DisplayWinningNumbers(int ticketIndex)
    {
        if (ticketIndex >= 0 && ticketIndex < allWinningTickets.Count)
        {
            List<string> winningNumbers = allWinningTickets[ticketIndex];

            // Ensure the ticket has exactly 25 numbers before displaying
            //if (winningNumbers.Count == 25)
            //{
            AssignRow(row1Texts, winningNumbers.GetRange(0, 5));
            AssignRow(row2Texts, winningNumbers.GetRange(5, 5));
            AssignRow(row3Texts, winningNumbers.GetRange(10, 5));
            AssignRow(row4Texts, winningNumbers.GetRange(15, 5));
            AssignRow(row5Texts, winningNumbers.GetRange(20, 5));
            //Debug.Log("count => " + winningNumbers.Count);
            //}
            //else
            //{
            //    Debug.LogError("Invalid number of elements in winning ticket. Expected 25.");
            //}
        }
    }

    #endregion

    #region COROUTINES
    // Coroutine to automatically switch tickets every 3 seconds
    private IEnumerator AutoSwitchTickets()
    {
        while (true)
        {
            yield return new WaitForSeconds(3f); // Wait for 3 seconds
            ShowNextTicket();
        }
    }


    #endregion


    #region GETTER_SETTER


    #endregion



}

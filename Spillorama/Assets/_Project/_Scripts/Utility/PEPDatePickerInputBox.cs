using System;
using TMPro;
using UnityEngine;

public class PEPDatePickerInputBox : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public static PEPOnValueChangeEnd PEPOnValueEditEnd;

    public TMP_InputField inputDay;
    public TMP_InputField inputMonth;
    public TMP_InputField inputYear;

    public int day = 0;
    public int month = 0;
    public int year = 0;

    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void Clear()
    {
        inputDay.text = "";
        inputMonth.text = "";
        inputYear.text = "";

        day = 0;
        month = 0;
        year = 0;
    }

    public DateTime GetDate()
    {
        //OLD Commented By Mathew
        //Debug.LogError(+year + "  " + month + "  " + day);
        //RefreshAllTheFields();
        //DateTime dateTime = new DateTime(year, month, day);

        //return dateTime;


        //New Code Added By Mathew
        RefreshAllTheFields();

        // Check if year, month, and day are within valid ranges before creating DateTime.
        if (year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= DateTime.DaysInMonth(year, month))
        {
            DateTime dateTime = new DateTime(year, month, day);
            return dateTime;
        }
        else
        {
            // Handle invalid values or return a default DateTime if needed.
            // For example:
            return DateTime.MinValue; // Return the minimum valid DateTime.
        }
    }

    public void RefreshDayField()
    {
        if (inputDay.text.Length == 0)
        {
            day = 0;
            return;
        }

        int newDay = int.Parse(inputDay.text);

        int maxDay = 31;
        if (month == 2 && year > 0)
        {
            if (year % 4 == 0)
                maxDay = 29;
            else
                maxDay = 28;
        }
        else if (month == 2)
        {
            maxDay = 29;
        }
        else if (month == 4 || month == 6 || month == 9 || month == 11)
        {
            maxDay = 30;
        }
        else
        {
            maxDay = 31;
        }


        if (newDay <= 0)
        {
            newDay = 1;
        }
        else if (newDay > maxDay)
        {
            newDay = maxDay;
        }

        day = newDay;
        inputDay.text = day.ToString();
    }

    public void RefreshMonthField()
    {
        if (inputMonth.text.Length == 0)
        {
            month = 0;
            return;
        }

        int newMonth = int.Parse(inputMonth.text);
        if (newMonth <= 0)
        {
            newMonth = 1;
        }
        else if (newMonth > 12)
        {
            newMonth = 12;
        }

        month = newMonth;
        inputMonth.text = month.ToString();

        RefreshDayField();
    }

    public void RefreshYearField()
    {
        if (inputYear.text.Length == 0)
        {
            year = 0;
            return;
        }

        int newYear = int.Parse(inputYear.text);
        if (newYear < 1900)
        {
            newYear = 1900;
        }
        else if (newYear > DateTime.Now.Year)
        {
            newYear = DateTime.Now.Year;
        }

        year = newYear;
        inputYear.text = year.ToString();

        RefreshDayField();
    }

    public void OnValueChangeEnd()
    {
        PEPOnValueEditEnd?.Invoke();
    }

    public void SetDate(string day, string month, string year)
    {
        inputDay.text = $"{day}";
        inputMonth.text = $"{month}";
        inputYear.text = $"{year}";
    }
    #endregion

    #region PRIVATE_METHODS
    private void RefreshAllTheFields()
    {
        RefreshDayField();
        RefreshMonthField();
        RefreshYearField();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public bool ValidateDate()
    {
        if (inputDay.text == "" || inputMonth.text == "" || inputYear.text == "")
            return false;
        else
            return true;
    }
    #endregion
}
public delegate void PEPOnValueChangeEnd();

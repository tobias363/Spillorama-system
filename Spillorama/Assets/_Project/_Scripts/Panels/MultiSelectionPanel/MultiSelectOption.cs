using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class MultiSelectOption : MonoBehaviour
{
    #region Public_Variables
    public static OnOptionSelectionHandler OnOptionSelected;
    #endregion

    #region Private_Variables

    [SerializeField] private TextMeshProUGUI tmpOptionsText;
    [SerializeField] private Image imgCheckBox;
    [SerializeField] private Image imtOptionsBackground;

    private bool selected = false;
    private int index = 0;
    #endregion

    #region Public_Methods
    
    public void OnOptionClicked()
    {
        selected = !selected;
        ChangeColorOfSelection();
        OnOptionSelected?.Invoke(this);
    }

    public void Select()
    {
        selected = true;
        imgCheckBox.Open();
    }
    #endregion

    #region Private_Methods
    private void ChangeColorOfSelection()
    {
        if (selected)
        {
            SetPositiveColor();
        }
        else
        {
            SetNegativeColor();
        }
    }

    public void SetValues(string option, int index)
    {
        tmpOptionsText.text = option;
        this.index = index;
    }
    private void SetPositiveColor()
    {
        imgCheckBox.gameObject.SetActive(true);
    }
    private void SetNegativeColor()
    {
        imgCheckBox.gameObject.SetActive(false);
    }
    #endregion

    #region Getter/Setter

    public bool IsSelected => selected;
    public int Index => index;
    #endregion
}

public delegate void OnOptionSelectionHandler(MultiSelectOption op);
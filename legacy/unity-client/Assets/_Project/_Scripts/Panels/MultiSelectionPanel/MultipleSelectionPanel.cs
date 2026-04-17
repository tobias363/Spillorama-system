using System;
using System.Collections.Generic;
using UnityEngine;

public class MultipleSelectionPanel : MonoBehaviour
{
    #region Public_Variables
    #endregion
    
    #region Private_Variables
    [SerializeField] private Transform listParent;
    [SerializeField] private Transform listItemPrefab;
    [SerializeField] private string[] selectedOptions;
    
    private string[] options;    
    #endregion

    #region Unity_Callback
    private void OnEnable()
    {
        MultiSelectOption.OnOptionSelected += OnOptionsSelected;
    }

    private void OnDisable()
    {
        MultiSelectOption.OnOptionSelected -= OnOptionsSelected;
    }

    #endregion

    #region Public_Methods
    
    public void SetOptionListAndOpen(string[] ops)
    {
        options = ops;
        InstantiateAllOptions();
        this.Open();
    }

    public void SetOptionListAndOpen(string[] options, string[] selectedOptions)
    {
        this.options = options;
        this.selectedOptions = selectedOptions;
        InstantiateAllOptions();
        this.Open();


    }

    public string GetAllSelectedOptions()
    {
        string opts = "";
        bool first = true;
        foreach (string s in selectedOptions)
        {
            if (s == "" || string.IsNullOrEmpty(s))
                continue;
            
            if(!first)
                opts += ',';

            opts += s;
            first = false;
        }

        return opts;
    }

    public List<string> GetAllSelectedOptionList()
    {
        List<string> list = new List<string>();

        foreach (string s in selectedOptions)
        {
            if (s == "" || string.IsNullOrEmpty(s))
                continue;

            list.Add(s);
        }

        return list;
    }
    #endregion

    #region Private_Methods
    private void InstantiateAllOptions()
    {
        DestroyListChildren();
        selectedOptions = new string[options.Length];
        int index = 0;
        
        foreach (string s in options)
        {
            selectedOptions[index] = "";
            Transform t = GetNewOptionsObject();
            t.GetComponent<MultiSelectOption>().SetValues(s, index);
            index++;
        }
    }

    private Transform GetNewOptionsObject()
    {
        Transform t = Instantiate(listItemPrefab, listParent, true);
        t.localPosition = Vector3.zero;
        t.localScale = Vector3.one;
        return t;
    }
    #endregion

    #region Delegate_Callbakcs

    private void OnOptionsSelected(MultiSelectOption op)
    {
        selectedOptions[op.Index] = (op.IsSelected) ? options[op.Index] : "";
    }

    private void DestroyListChildren()
    {
        for (int i = 0; i < listParent.childCount; i++)
            Destroy(listParent.GetChild(i).gameObject);
    }
    #endregion
}

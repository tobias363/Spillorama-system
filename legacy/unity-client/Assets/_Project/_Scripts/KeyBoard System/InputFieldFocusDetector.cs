using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public static class InputFieldFocusDetector
{
    public static bool IsAnyInputFieldFocused()
    {
        GameObject selected = EventSystem.current?.currentSelectedGameObject;

        if (selected == null)
            return false;

        if (selected.GetComponent<TMP_InputField>() != null)
            return true;

        if (selected.GetComponent<InputField>() != null)
            return true;

        return false;
    }
}

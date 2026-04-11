using UnityEngine;
using UnityEngine.UI;
using TMPro;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;

public class AutoKeyboardOpener : MonoBehaviour
{
#if UNITY_STANDALONE_WIN // && !UNITY_EDITOR
    bool lastKeyboardAttached = true;
    TMP_InputField inputField;
    InputField inputFieldUI;
    void Awake()
    {
        // lastKeyboardAttached = KeyboardDetector.IsKeyboardAttached();
        inputField = GetComponent<TMP_InputField>();
        inputFieldUI = GetComponent<InputField>();
        inputField?.onDeselect.AddListener(OnCloseKeyboard);
        inputFieldUI?.onEndEdit.AddListener(OnClose);
        // eventTrigger.OnPointerClick(new PointerEventData(EventSystem.current));
    }

    void OnCloseKeyboard(string value)
    {
        CloseKeyboard();
        Debug.Log("Keyboard closed by OnCloseKeyboard");
    }

    public void OnOpenKeyboard(BaseEventData eventData)
    {
        //KeyboardDetector.Open();
        Debug.Log("touch Keyboard opened by OnOpenKeyboard");
    }
    public void OpenWinKeyBoard(TMP_InputField Input)
    {
        //Debug.Log(CheckKeyboardAttached());
        //if (!CheckKeyboardAttached())
        //{
        bool isNumpadOnly = Input.contentType == TMP_InputField.ContentType.IntegerNumber ||
            Input.contentType == TMP_InputField.ContentType.Custom && Input.characterValidation == TMP_InputField.CharacterValidation.Integer ||
            Input.contentType == TMP_InputField.ContentType.Custom && Input.characterValidation == TMP_InputField.CharacterValidation.Digit;
        UIManager.Instance.keyboardWin.setDataOpen(Input, isNumpadOnly);
        Debug.Log("Keyboard opened by OpenWinKeyBoard");
        //}
    }

    public void OnClose(string value)
    {
        CloseKeyboard();
        Debug.Log("Keyboard closed by OnClose");
    }

    void Update()
    {
        // bool nowAttached = KeyboardDetector.IsKeyboardAttached();

        // // Keyboard was attached → now detached
        // if (lastKeyboardAttached && !nowAttached)
        // {
        //     Debug.Log("Surface keyboard detached.");

        //     if (InputFieldFocusDetector.IsAnyInputFieldFocused())
        //     {
        //         TouchKeyboard.Show();
        //     }
        // }

        // lastKeyboardAttached = nowAttached;

        // // If keyboard is currently detached and user taps InputField → open keyboard
        // if (!nowAttached && InputFieldFocusDetector.IsAnyInputFieldFocused())
        // {
        //     TouchKeyboard.Show();
        // }
    }

    public void CloseKeyboard()
    {
        KeyboardDetector.Close();
        Debug.Log("Keyboard closed by CloseKeyboard");
    }

    public bool CheckKeyboardAttached()
    {
        // Check if there is at least one device that is a Keyboard
        if (Keyboard.current != null)
        {
            Debug.Log("A physical or virtual keyboard is available/current.");
            return true;
            // Further checks needed to distinguish physical from virtual on some mobile platforms
        }
        else
        {
            Debug.Log("No keyboard device is currently available.");
            return false;
        }
    }

#endif
}

using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using UnityEngine.Scripting;

public class AISButtonSound : MonoBehaviour, IPointerEnterHandler, IPointerExitHandler
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    private Button button = null;
    #endregion

    #region UNITY_CALLBACKS
    [Preserve]
    private void Awake()
    {
        button = this.gameObject.GetComponent<Button>();
        if (button != null)
            button.onClick.AddListener(PlaySound);
    }

    [Preserve]
    private void OnDisable()
    {
        //#if UNITY_STANDALONE_WIN || UNITY_STANDALONE_LINUX || UNITY_WEBGL || UNITY_EDITOR
        //        Cursor.SetCursor(UIManager.Instance.arrowCursor, Vector2.zero, CursorMode.Auto);
        //#endif

        //if (isValidate())
        //{
        //    CustomCursor.Instance.OnButtonCursorExit();
        //}

    }

    [Preserve]
    public void OnPointerEnter(PointerEventData eventData)
    {

        //#if UNITY_STANDALONE_WIN || UNITY_STANDALONE_LINUX || UNITY_WEBGL || UNITY_EDITOR
        //        if (isValidate())
        //        {
        //            Cursor.SetCursor(UIManager.Instance.handCursor, Vector2.zero, CursorMode.Auto);
        //        }
        //#endif


        //if (isValidate())
        //{
        //    CustomCursor.Instance.OnButtonCursorEnter();
        //}
    }

    [Preserve]
    public void OnPointerExit(PointerEventData eventData)
    {
        //#if UNITY_STANDALONE_WIN || UNITY_STANDALONE_LINUX || UNITY_WEBGL || UNITY_EDITOR
        //        Cursor.SetCursor(UIManager.Instance.arrowCursor, Vector2.zero, CursorMode.Auto);
        //#endif



        //if (isValidate())
        //{
        //    CustomCursor.Instance.OnButtonCursorExit();
        //}


    }


    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    #endregion

    #region PRIVATE_METHODS
    [Preserve]
    private void PlaySound()
    {
        Debug.Log("mouse click 1 sound");
        SoundManager.Instance.MouseClick1();
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER

    [Preserve]
    bool isValidate()
    {
        if (button != null)
        {
            return button.enabled && button.interactable;
        }
        else
        {
            return false;
        }
    }


    #endregion
}

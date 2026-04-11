using UnityEngine;
using UnityEngine.UI;
using TMPro;
using UnityEngine.Events;
using I2.Loc;
using System.Collections;
using System.Collections.Generic;
using UnityEngine.SceneManagement;
using System.Linq;

public class UtilityMessagePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES	
    [Header("Buttons")]
    [SerializeField] private Button btnPositiveAction;
    [SerializeField] private Button btnNegativeAction;
    [SerializeField] private Button btnOk;

    [Header("Texts")]
    [SerializeField] private TextMeshProUGUI txtMessage;
    [SerializeField] private TextMeshProUGUI txtPositiveButton;
    [SerializeField] private TextMeshProUGUI txtNegativeButton;
    [SerializeField] private TextMeshProUGUI txtOkButton;

    [Header("Tickets Container")]
    [SerializeField] private Transform transformTicketsContainer;


    public GridLayoutGroup grid;

    Coroutine autoHide;
    public List<Transform> children = new List<Transform>();
    #endregion

    #region PRIVATE_VARIABLES
    #endregion

    #region UNITY_CALLBACKS

    private void OnEnable()
    {
        transform.SetAsLastSibling();
        if (UIManager.Instance.deleteMessagePopup != null && UIManager.Instance.deleteMessagePopup.gameObject.activeSelf)
        {
            children.Clear();
            children = transformTicketsContainer.Cast<Transform>().ToList();
        }
    }

    private void OnDisable()
    {
        if (UIManager.Instance.deleteMessagePopup != null && !UIManager.Instance.deleteMessagePopup.gameObject.activeSelf)
        {
            if (children.Any())
            {
                children.ForEach(child =>
                {
                    if (child != null) Destroy(child.gameObject);
                });
                children.Clear();
            }
        }
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void DisplayConfirmationPopup(string message, UnityAction<bool> positiveAction)
    {
        txtMessage.text = message;

#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            txtPositiveButton.text = Constants.LanguageKey.YesMessage;
            txtNegativeButton.text = Constants.LanguageKey.NoMessage;
        }
        else
        {
            txtPositiveButton.text = "Yes";
            txtNegativeButton.text = "No";
        }
#else
		txtPositiveButton.text = Constants.LanguageKey.YesMessage;
		txtNegativeButton.text =  Constants.LanguageKey.NoMessage;
#endif

        btnPositiveAction.onClick.RemoveAllListeners();
        btnNegativeAction.onClick.RemoveAllListeners();
        btnPositiveAction.onClick.AddListener(() => positiveAction(true));
        btnPositiveAction.onClick.AddListener(HidePopup);

        btnNegativeAction.onClick.AddListener(() => positiveAction(false));
        btnNegativeAction.onClick.AddListener(HidePopup);

        btnPositiveAction.gameObject.SetActive(true);
        btnNegativeAction.gameObject.SetActive(true);
        btnOk.gameObject.SetActive(false);

        this.Open();
    }

    public void DisplayDeleteConfirmationPopup(string message, UnityAction<bool> positiveAction, UnityAction<bool> negativeAction, GameObject gameObject, List<GameObject> objects)
    {
        if (UIManager.Instance.game2Panel.gameObject.activeSelf)
        {
            grid.cellSize = UIManager.Instance.game2Panel.game2PlayPanel.ticketContainerHorizontalGridLayoutGroup.cellSize;
        }
        txtMessage.text = message;

#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            txtPositiveButton.text = Constants.LanguageKey.YesMessage;
            txtNegativeButton.text = Constants.LanguageKey.NoMessage;
        }
        else
        {
            txtPositiveButton.text = "Yes";
            txtNegativeButton.text = "No";
        }
#else
		txtPositiveButton.text = Constants.LanguageKey.YesMessage;
		txtNegativeButton.text =  Constants.LanguageKey.NoMessage;
#endif

        btnPositiveAction.onClick.RemoveAllListeners();
        btnNegativeAction.onClick.RemoveAllListeners();
        btnPositiveAction.onClick.AddListener(() => positiveAction(true));
        btnPositiveAction.onClick.AddListener(HidePopup);

        btnNegativeAction.onClick.AddListener(() => negativeAction(true));
        btnNegativeAction.onClick.AddListener(HidePopup);

        btnPositiveAction.gameObject.SetActive(true);
        btnNegativeAction.gameObject.SetActive(true);
        btnOk.gameObject.SetActive(false);

        if (objects != null && objects.Count > 0)
        {
            objects.ForEach(obj =>
            {
                if (obj != null)
                {
                    GameObject newObject = Instantiate(obj, transformTicketsContainer);
                }
            });
        }
        else if (gameObject != null)
        {
            GameObject newObject = Instantiate(gameObject, transformTicketsContainer);
        }
        else
        {
            Debug.LogWarning("GameObject or objects list is null. Cannot instantiate or add to list.");
        }

        this.Open();
    }

    public void DisplayConfirmationPopup(string message, string positiveButtonText, string negativeButtonText, UnityAction positiveAction, UnityAction negativeAction = null)
    {
        txtMessage.text = message;

        txtPositiveButton.text = positiveButtonText;
        txtNegativeButton.text = negativeButtonText;

        btnPositiveAction.onClick.RemoveAllListeners();
        btnNegativeAction.onClick.RemoveAllListeners();
        btnPositiveAction.onClick.AddListener(positiveAction);
        btnPositiveAction.onClick.AddListener(HidePopup);

        if (negativeAction != null)
        {
            btnNegativeAction.onClick.AddListener(negativeAction);
            btnNegativeAction.onClick.AddListener(HidePopup);
        }
        else
            btnNegativeAction.onClick.AddListener(HidePopup);

        btnPositiveAction.gameObject.SetActive(true);
        btnNegativeAction.gameObject.SetActive(true);
        btnOk.gameObject.SetActive(false);

        this.Open();
    }

    public void DisplayMessagePopup(string message, string okButtonText, UnityAction playerAction = null)
    {
        txtMessage.text = message;
        txtOkButton.text = okButtonText;
        btnOk.onClick.RemoveAllListeners();

        if (playerAction != null)
            btnOk.onClick.AddListener(playerAction);
        //else		
        btnOk.onClick.AddListener(HidePopup);

        btnPositiveAction.gameObject.SetActive(false);
        btnNegativeAction.gameObject.SetActive(false);
        btnOk.gameObject.SetActive(true);

        this.Open();
    }

    public void DisplayMessagePopupWithoutOkButton(string message)
    {
        txtMessage.text = message;
        btnOk.gameObject.SetActive(false);
        btnPositiveAction.gameObject.SetActive(false);
        btnNegativeAction.gameObject.SetActive(false);
        this.Open();
    }

    public void DisplayMessagePopupWithExitButton(string message, UnityAction<bool> positiveAction)
    {
        txtMessage.text = message;
        txtOkButton.text = "Exit";

        btnOk.onClick.RemoveAllListeners();
        btnOk.onClick.AddListener(() => positiveAction(true));
        btnOk.onClick.AddListener(HidePopup);

        btnOk.gameObject.SetActive(true);
        btnPositiveAction.gameObject.SetActive(false);
        btnNegativeAction.gameObject.SetActive(false);

        this.Open();
    }

    public void DisplayMessagePopup(string message, UnityAction playerAction = null)
    {
        txtMessage.text = message;
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            txtOkButton.text = Constants.LanguageKey.OkMessage.ToUpper();
        }
        else
        {
            txtOkButton.text = "Ok";
        }
#else
		txtOkButton.text = Constants.LanguageKey.OkMessage.ToUpper();
#endif
        btnOk.onClick.RemoveAllListeners();

        if (playerAction != null)
            btnOk.onClick.AddListener(playerAction);
        else
            btnOk.onClick.AddListener(HidePopup);

        btnPositiveAction.gameObject.SetActive(false);
        btnNegativeAction.gameObject.SetActive(false);
        btnOk.gameObject.SetActive(true);
        btnOk.onClick.AddListener(HidePopup);
        this.Open();
    }

    public void DisplayMessagePopupAutoHide(string message, bool autoHide = false, float hideDelay = 2f)
    {
        txtMessage.text = message;
#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            txtOkButton.text = Constants.LanguageKey.OkMessage.ToUpper();
        }
        else
        {
            txtOkButton.text = "Ok";
        }
#else
		txtOkButton.text = Constants.LanguageKey.OkMessage.ToUpper();
#endif
        btnOk.onClick.RemoveAllListeners();

        btnOk.onClick.AddListener(HidePopup);

        btnPositiveAction.gameObject.SetActive(false);
        btnNegativeAction.gameObject.SetActive(false);
        btnOk.gameObject.SetActive(true);

        this.Open();
        if (autoHide)
            this.autoHide = StartCoroutine(AutoHideMessagePopUp(hideDelay));
    }

    IEnumerator AutoHideMessagePopUp(float delay)
    {
        yield return new WaitForSeconds(delay);
        if (autoHide != null)
        {
            this.Close();
            autoHide = null;
        }
    }

    public void OnCloseButtonTap()
    {
        gameObject.SetActive(false);
    }

    #endregion

    #region PRIVATE_METHODS

    private void HidePopup()
    {
        autoHide = null;
        this.Close();
    }
    #endregion

    #region COROUTINES
    #endregion
}
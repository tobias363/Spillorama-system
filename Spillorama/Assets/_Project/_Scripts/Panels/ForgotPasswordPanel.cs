using BestHTTP.SocketIO;
using TMPro;
using UnityEngine;

public class ForgotPasswordPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Input Fields")]
    [SerializeField] TMP_InputField inputEmailUsername;
    public TextMeshProUGUI confirmMessageText;
    [Header("GameObjects")]
    [SerializeField] private GameObject ForgetPasswordMain;
    [SerializeField] private GameObject ForgetPasswordConfirmation;

    private bool emailSent = false;
    #endregion

    #region UNITY_CALLBACKS
    private void OnEnable()
    {
        ForgetPasswordMain.SetActive(true);
        ForgetPasswordConfirmation.SetActive(false);
        confirmMessageText.text = "";
        emailSent = false;
        ResetInputFields();
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS
    public void OnResetPasswordButtonTap()
    {
        if (!ValidateData())
            return;

        string email = inputEmailUsername.GetTextToLower();
        EventManager.Instance.PlayerForgetPassword(email, ForgetPasswordDataProcess);
    }

    public void OnResendButtonTap()
    {
        if (!ValidateData() && emailSent)
            return;

        string email = inputEmailUsername.GetTextToLower();
        EventManager.Instance.PlayerForgetPassword(email, ForgetPasswordDataProcess);
    }

    public void OnBackButtonTap()
    {
        if (ForgetPasswordConfirmation.activeSelf)
        {
            ForgetPasswordMain.SetActive(true);
            ForgetPasswordConfirmation.SetActive(false);
        }
        else
        {
            this.Close();
            UIManager.Instance.loginPanel.Open();
        }

    }

    public void OnSignupButtonTap()
    {
        this.Close();
        UIManager.Instance.signupPanel.Open();
    }
    #endregion

    #region PRIVATE_METHODS
    private void ResetInputFields()
    {
        inputEmailUsername.text = "";
    }

    private bool ValidateData()
    {
        string emailString = inputEmailUsername.GetTextToLower();

        if (emailString == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterEmailOrMobileNumberMessage);
            return false;
        }
        if (emailString.Contains("@") || emailString.Contains("."))
        {
            if (!Utility.Instance.ValidateEmail(emailString))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.InvalidEmailOrmobileNumberMessage);
                return false;
            }
        }
        else
        {
            if (!Utility.Instance.ValidatePhoneNumber(emailString))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.InvalidEmailOrmobileNumberMessage);
                return false;
            }
        }

        return true;
    }

    private void ForgetPasswordDataProcess(Socket socket, Packet packet, params object[] args)
    {
        emailSent = true;
        Debug.Log($"PlayerForgetPassword : {packet}");
        EventResponse<string> response = JsonUtility.FromJson<EventResponse<string>>(Utility.Instance.GetPacketString(packet));
        if (response.status == EventResponse<string>.STATUS_SUCCESS)
        {
            ForgetPasswordMain.SetActive(false);
            confirmMessageText.text = response.message;
            ForgetPasswordConfirmation.SetActive(true);

            //UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }
    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    #endregion
}

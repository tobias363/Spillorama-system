using BestHTTP.SocketIO;
using I2.Loc;
using SFB;
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using TMPro;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.UI;

public class ProfilePanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    public GameObject Photo_ID_PopUp;
    public GameObject Upload_Photo_PopUp;
    public GameObject Verify_User;
    public Image Photo_ID_Img;
    public Sprite Photo_ID_1, Photo_ID_2;

    #endregion

    #region PRIVATE_VARIABLES
    [Header("Text")]
    public TMP_Text verifiedTxt;
    public TMP_Text idExpiryDateTxt;
    [SerializeField] private TMP_Text Photo_ID_Front_Txt;
    [SerializeField] private TMP_Text Photo_ID_Back_Txt;

    public Texture2D Photo_ID_Front_Texture, Photo_ID_Back_Texture;
    public string Photo_ID_Front_Img_Path, Photo_ID_Back_Img_Path;
    public string Photo_ID_Front_Img_Name, Photo_ID_Back_Img_Name;

    [Header("Buttons")]
    [SerializeField] private Button Photo_ID_Front_btn;
    [SerializeField] private Button Photo_ID_Back_btn;
    [Space(10)]
    [SerializeField] private Button Photo_ID_Front_webgl_btn;
    [SerializeField] private Button Photo_ID_Back_webgl_btn;
    public Button BankId_Btn;
    public Button BankId_Reverification_Btn;
    public Button Img_Btn;

    [Header("Game Object")]
    [SerializeField] private GameObject Photo_ID_Front_Lbl;
    [SerializeField] private GameObject Photo_ID_Back_Lbl, Photo_ID_Front_Clear, Photo_ID_Back_Clear, Photo_ID_Front_Icon, Photo_ID_Back_Icon;
    [SerializeField] private float Photo_Max_Size_In_MB;
    [SerializeField] private float Photo_Max_Size_In_KB;

    [Header("Image")]
    [SerializeField] private Image imgProfilePicture;
    [SerializeField] private Image imgProfilePictureBorder;

    [Header("Buttons")]
    [SerializeField] private Button btnUploadProfilePicture;

    [Header("Profile Information")]
    [SerializeField] private TMP_InputField inputUsername;
    [SerializeField] private TMP_InputField inputSurname;
    [SerializeField] private TMP_InputField inputEmail;
    [SerializeField] private TMP_InputField inputNickname;
    [SerializeField] private TMP_InputField inputMobileNumber;
    //[SerializeField] private TMP_InputField inputDOB;
    //[SerializeField] DatePickerInputBox datePickerDOB;
    [SerializeField] private Button btnUpdate;
    public TMP_InputField Bank_IF;
    public TMP_Text Birth_Date_Txt, Profile_Hall_Txt, Front_Photo_Txt, Back_Photo_Txt, Customer_No_Txt;

    [Header("Change Password")]
    [SerializeField] private TMP_InputField inputCurrentPassword;
    [SerializeField] private TMP_InputField inputNewPassword;
    [SerializeField] private TMP_InputField inputConfirmNewPassword;

    [Header("Photo Utility")]
    [SerializeField] private PhotoUtility photoUtility;
    [SerializeField] private Texture2D userProfilePicture;

    [Header("Panels")]
    [SerializeField] private HallSelectionPanel hallSelectionPanel;

    //private DateTime dateDOB;
    private PlayerProfile playerData;
    private bool isProfilePictureChanged = false;
    [SerializeField] private List<HallData> selectedHallDataList = new List<HallData>();
    #endregion

    #region UNITY_CALLBACKS

    private void Awake()
    {
        //#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        //        datePickerDOB.Close();
        //        inputDOB.Open();
        //#else
        //        datePickerDOB.Open();
        //        inputDOB.Close();
        //#endif

        //inputMobileNumber.characterLimit = Constants.InputData.mobileNumberLength;

        Photo_Max_Size_In_KB = Photo_Max_Size_In_MB * 1024f;


#if UNITY_WEBGL && !UNITY_EDITOR

        Photo_ID_Front_webgl_btn.interactable = true;
        Photo_ID_Back_webgl_btn.interactable = true;

        Photo_ID_Front_webgl_btn.gameObject.SetActive(true);
        Photo_ID_Back_webgl_btn.gameObject.SetActive(true);

        Photo_ID_Front_btn.interactable = false;
        Photo_ID_Back_btn.interactable = false;

#else

        Photo_ID_Front_webgl_btn.gameObject.SetActive(false);
        Photo_ID_Back_webgl_btn.gameObject.SetActive(false);

        Photo_ID_Front_webgl_btn.interactable = false;
        Photo_ID_Back_webgl_btn.interactable = false;

        Photo_ID_Front_btn.interactable = true;
        Photo_ID_Back_btn.interactable = true;
#endif
    }

    private void OnEnable()
    {
        UIManager.Instance.webViewManager.CloseWebs();
        ResetInputFields();
        CallPlayerProfileEvents();
        photoUtility.Close();
        DatePickerInputBox.OnValueEditEnd += OnInputValueChanged;
        hallSelectionPanel.ClosePanel();
        if (UIManager.Instance.breakTimePopup.isActiveAndEnabled)
        {
            UIManager.Instance.breakTimePopup.Close();
        }
        // BankId_Btn.gameObject.SetActive(!UIManager.Instance.gameAssetData.playerGameData.isVerifiedByBankID);
        // Img_Btn.gameObject.SetActive(!UIManager.Instance.gameAssetData.playerGameData.isVerifiedByHall);
        // Verify_User.SetActive(!UIManager.Instance.gameAssetData.playerGameData.isVerifiedByHall && !UIManager.Instance.gameAssetData.playerGameData.isVerifiedByBankID);

        if (Utility.Instance.IsStandAloneVersion())
            StandaloneBuildValidation();
    }

    private void OnDisable()
    {
        DatePickerInputBox.OnValueEditEnd -= OnInputValueChanged;
    }

    #endregion

    #region PUBLIC_METHODS

    public void OnBackButtonTap()
    {
        this.Close();

        // Reopen previously active game panel if it exists
        if (UIManager.Instance.previouslyActiveGamePanel != null)
        {
            if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game1Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame1ButtonTap();
                // UIManager.Instance.game1Panel.Open();
                // UIManager.Instance.game1Panel.game1GamePlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game2Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame2ButtonTap();
                // UIManager.Instance.game2Panel.Open();
                // UIManager.Instance.game2Panel.game2PlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game3Panel))
            {
                UIManager.Instance.lobbyPanel.gamePlanPanel.OnGame3ButtonTap();
                // UIManager.Instance.game3Panel.Open();
                // UIManager.Instance.game3Panel.game3GamePlayPanel.CallSubscribeRoom();
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game4Panel))
            {
                UIManager.Instance.game4Panel.OpenPanel();
                switch (true)
                {
                    case true when UIManager.Instance.previouslyActiveGame4Theme1:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn1.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme2:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn2.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme3:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn3.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme4:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn4.OnButtonTap();
                        break;
                    case true when UIManager.Instance.previouslyActiveGame4Theme5:
                        UIManager.Instance.game4Panel.game4GamePlayPanel.themeBtn5.OnButtonTap();
                        break;
                }
            }
            else if (UIManager.Instance.previouslyActiveGamePanel.Equals(UIManager.Instance.game5Panel))
            {
                UIManager.Instance.game5Panel.OpenPanel();
                // UIManager.Instance.game5Panel.game5GamePlayPanel.CallSubscribeRoom();
            }
            else
            {
                UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
            }
            if (UIManager.Instance.isBreak)
            {
                UIManager.Instance.breakTimePopup.Open();
            }
            UIManager.Instance.ActiveAllGameElements();
            UIManager.Instance.previouslyActiveGamePanel = null;
        }
        else
        {
            UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
        }
        // if (!UIManager.Instance.topBarPanel.RunningGamesButtonEnable && (UIManager.Instance.game1Panel.isActiveAndEnabled || UIManager.Instance.game2Panel.isActiveAndEnabled ||
        //     UIManager.Instance.game3Panel.isActiveAndEnabled ||
        //     UIManager.Instance.game4Panel.isActiveAndEnabled || UIManager.Instance.game5Panel.isActiveAndEnabled))
        // {
        //     this.Close();
        //     if (UIManager.Instance.isBreak)
        //     {
        //         UIManager.Instance.breakTimePopup.Open();
        //         UIManager.Instance.ActiveAllGameElements();
        //     }
        //     else
        //     {
        //         UIManager.Instance.ActiveAllGameElements();
        //     }
        // }
        // else
        // {
        //     this.Close();
        //     UIManager.Instance.lobbyPanel.OpenGameSelectionPanel();
        // }
    }

    public void OpenHallSelectionPanel()
    {
        hallSelectionPanel.OpenPanel();
    }

    public void OnDOBPickerTap()
    {
        //Utility.Instance.OpenDatePicker((dateTime) =>
        //{
        //    inputDOB.text = Utility.Instance.GetDateString(dateTime);
        //    dateDOB = dateTime;
        //}, dateDOB.Year, dateDOB.Month, dateDOB.Day);
    }

    public void OnUpdateButtonTap()
    {
        if (ValidateProfileInformation())
        {
            CallUpdateProfileData();
        }
    }

    public void OnChangePasswordButtonTap()
    {
        if (ValidateChangePassword())
        {
            string oldPassword = inputCurrentPassword.text;
            string newPassword = inputNewPassword.text;
            string confirmPassword = inputConfirmNewPassword.text;

            // UIManager.Instance.DisplayLoader(true);
            EventManager.Instance.PlayerChangePassword(oldPassword, newPassword, confirmPassword, ChangePasswordDataProcess<string>);
        }
    }

    public void ModifyCurrentPasswordText(bool show)
    {
        ModifyPasswordText(inputCurrentPassword, show);
    }

    public void ModifyNewPasswordText(bool show)
    {
        ModifyPasswordText(inputNewPassword, show);
    }

    public void ModifyConfirmNewPasswordText(bool show)
    {
        ModifyPasswordText(inputConfirmNewPassword, show);
    }

    public void OnInputValueChanged()
    {
        btnUpdate.interactable = true;
    }

    public void OnProfilePictureButtonTap()
    {
#if UNITY_ANDROID || UNITY_IOS || UNITY_EDITOR
        NativeGallery.GetImageFromGallery(Profile_Pic_Callback);
#else
                var extensions = new[] { new ExtensionFilter("Image Files", "png", "jpg", "jpeg") };
                var path = StandaloneFileBrowser.OpenFilePanel("Open File", "", extensions, false);
                if (path != null)
                    Profile_Pic_Callback(path[0]);
#endif
        //        return;
        //#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        //        photoUtility.Open();
        //#endif
    }

    public void OnProfilePictureSelected(Texture2D text)
    {
        //#if UNITY_ANDROID || UNITY_IOS || UNITY_EDITOR
        //        NativeGallery.GetImageFromGallery(Profile_Pic_Callback);
        //#else
        //                var extensions = new[] { new ExtensionFilter("Image Files", "png", "jpg", "jpeg") };
        //                var path = StandaloneFileBrowser.OpenFilePanel("Open File", "", extensions, false);
        //                if (path != null)
        //                    Profile_Pic_Callback(path[0]);
        //#endif
        //return;
        //isProfilePictureChanged = true;
        //userProfilePicture = text;
        //Rect r = new Rect(Vector2.zero, new Vector2(userProfilePicture.width, userProfilePicture.height));
        //Vector2 p = Vector2.one * 0.5f;
        //ProfilePicture = Sprite.Create(userProfilePicture, r, p);
    }

    public void OnDeleteAccountButtonTap()
    {

#if UNITY_WEBGL
        if (UIManager.Instance.isGameWebGL)
        {
            UIManager.Instance.messagePopup.DisplayConfirmationPopup(
            LocalizationManager.GetTranslation(Constants.LanguageKey.DeleteConfirmationMessage), (result) =>
            {
                if (result)
                {
                    // UIManager.Instance.DisplayLoader(true);
                    EventManager.Instance.DeletePlayerAccount(DeleteAccountResponse);
                }
            });
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayConfirmationPopup(
            Constants.LanguageKey.DeleteConfirmationMessage, (result) =>
            {
                if (result)
                {
                    // UIManager.Instance.DisplayLoader(true);
                    EventManager.Instance.DeletePlayerAccount(DeleteAccountResponse);
                }
            });
        }

#else
        UIManager.Instance.messagePopup.DisplayConfirmationPopup(Constants.LanguageKey.DeleteConfirmationMessage, (result) =>
            {
                if (result)
                {
                    // UIManager.Instance.DisplayLoader(true);
                    EventManager.Instance.DeletePlayerAccount(DeleteAccountResponse);
                }
            });
#endif
    }

    public void VerifyUser_BankIDTap()
    {
        BankId_Btn.interactable = false;
        BankId_Reverification_Btn.interactable = false;
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.VerifyByBankId(UIManager.Instance.gameAssetData.PlayerId, (socket, packet, args) =>
        {
            Debug.Log($"VerifyByBankId Response: {packet}");
            UIManager.Instance.DisplayLoader(false);

            EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.SUCCESS)
            {
                BankId_Btn.interactable = true;
                BankId_Reverification_Btn.interactable = true;
#if UNITY_STANDALONE_WIN
                Debug.Log("UNITY_STANDALONE_WIN");
                UIManager.Instance.webViewManager.SetdataOpenUrlStandlone(response.result);
#elif UNITY_ANDROID
        Debug.Log("UNITY_ANDROID || UNITY_EDITOR");
        UIManager.Instance.webViewManager.ShowUrlPopupMarginsFULLSCREEN(response.result);
#elif UNITY_IOS
        Debug.Log("UNITY_IOS");
        UIManager.Instance.webViewManager.ShowUrlPopupMargins(response.result);
#elif UNITY_STANDALONE_LINUX
        Debug.Log("UNITY_STANDALONE_LINUX");
                Utility.Instance.OpenLink(response.result);
#elif UNITY_WEBGL && !UNITY_EDITOR
        Debug.Log("UNITY_WEBGL && !UNITY_EDITOR");
		//ExternalCallClass.Instance.OpenUrl(response.result);
        Utility.Instance.OpenLink(response.result);
         //UIManager.Instance.webViewManager.SetdataOpenUrlStandlone(response.result);
#endif
            }
            else
            {
                Debug.Log("Else");
                BankId_Btn.interactable = true;
                BankId_Reverification_Btn.interactable = true;
                UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            }
        });
    }

    public void Verify_User_ImageUploadTap()
    {
        Upload_Photo_PopUp.SetActive(true);
    }
    public void Verify_User_UploadTap()
    {
        // if (Photo_ID_Front_Txt.text == Photo_ID_Back_Txt.text)
        // {
        //     UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.FrontAndBackPhotoIdsSameMessage);
        //     return;
        // }
        // else if (Photo_ID_Front_Texture == null && Photo_ID_Back_Texture == null)
        // {
        //     UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseUploadPhotoId);
        //     return;
        // }
        // else if (Photo_ID_Front_Texture == null)
        // {
        //     UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseUploadFrontPhotoId);
        //     return;
        // }
        // else if (Photo_ID_Back_Texture == null)
        // {
        //     UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseUploadBackPhotoId);
        //     return;
        // }
        // else
        // {
        // UIManager.Instance.DisplayLoader(true);
        StartCoroutine(EventManager.Instance.ImageUpload(Photo_ID_Front_Texture, Photo_ID_Back_Texture, Photo_ID_Front_Img_Path, Photo_ID_Back_Img_Path, Photo_ID_Front_Img_Name, Photo_ID_Back_Img_Name));
        // }
    }

    public void Show_Photo_Id_1()
    {
        if (playerData.frontId == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.FrontUploadImg);
        }
        else if (Photo_ID_1 == null)
        {
            // UIManager.Instance.DisplayLoader(true);
            string url = Constants.ServerDetails.BaseUrl + playerData.frontId;
            StartCoroutine(DownloadHelper.DownloadImage(url, (t) =>
            {
                if (t != null)
                {
                    Rect r = new Rect(0, 0, t.width, t.height);
                    Vector2 p = Vector2.one * 0.5f;
                    Photo_ID_1 = Sprite.Create(t, r, p);
                    Photo_ID_Img.sprite = Photo_ID_1;
                    Photo_ID_PopUp.SetActive(true);
                }
                else
                {
                    Debug.LogError("Failed to download front photo ID image");
                    UIManager.Instance.messagePopup.DisplayMessagePopup("Failed to load front photo ID image");
                }
                UIManager.Instance.DisplayLoader(false);
            }));
        }
        else
        {
            Photo_ID_Img.sprite = Photo_ID_1;
            Photo_ID_PopUp.SetActive(true);
        }
    }

    public void Show_Photo_Id_2()
    {
        if (playerData.backId == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.BackUploadImg);
        }
        else if (Photo_ID_2 == null)
        {
            // UIManager.Instance.DisplayLoader(true);
            string url = Constants.ServerDetails.BaseUrl + playerData.backId;
            StartCoroutine(DownloadHelper.DownloadImage(url, (t) =>
            {
                if (t != null)
                {
                    Rect r = new Rect(0, 0, t.width, t.height);
                    Vector2 p = Vector2.one * 0.5f;
                    Photo_ID_2 = Sprite.Create(t, r, p);
                    Photo_ID_Img.sprite = Photo_ID_2;
                    Photo_ID_PopUp.SetActive(true);
                }
                else
                {
                    Debug.LogError("Failed to download back photo ID image");
                    UIManager.Instance.messagePopup.DisplayMessagePopup("Failed to load back photo ID image");
                }
                UIManager.Instance.DisplayLoader(false);
            }));
        }
        else
        {
            Photo_ID_Img.sprite = Photo_ID_2;
            Photo_ID_PopUp.SetActive(true);
        }
    }

    public void Close_Photo_ID()
    {
        Photo_ID_PopUp.SetActive(false);
    }
    public void Close_Uplaod_Photo_ID()
    {
        Upload_Photo_PopUp.SetActive(false);
    }
    public void Upload_Photo(int index)
    {
        switch (index)
        {
            case 0:
#if UNITY_ANDROID || UNITY_IOS || UNITY_EDITOR

                NativeGallery.GetImageFromGallery(Photo_ID_Front_Callback);
#else
                var extensions = new[] { new ExtensionFilter("Image Files", "png", "jpg", "jpeg") };
                var path = StandaloneFileBrowser.OpenFilePanel("Open File", "", extensions, false);
                if (path != null)
                    Photo_ID_Front_Callback(path[0]);
#endif
                break;
            case 1:
#if UNITY_ANDROID || UNITY_IOS || UNITY_EDITOR
                NativeGallery.GetImageFromGallery(Photo_ID_Back_Callback);
#else
                extensions = new[] { new ExtensionFilter("Image Files", "png", "jpg", "jpeg") };
                path = StandaloneFileBrowser.OpenFilePanel("Open File", "", extensions, false);
                if (path != null)
                    Photo_ID_Back_Callback(path[0]);
#endif
                break;
        }
    }
    public void Photo_ID_Front_Callback(string path)
    {
        Debug.Log("-------------");

        if (path != null)
        {
            // Create Texture from selected image
            Texture2D texture = NativeGallery.LoadImageAtPath(path, 256, false, false);
            if (texture == null)
            {
                Debug.Log("Couldn't load texture from " + path);
                return;
            }
            FileInfo f = new FileInfo(path);
            if (f.Length / 1024f > Photo_Max_Size_In_KB)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.SizeMustBeLessThan + " " + Photo_Max_Size_In_MB + " MB");
                return;
            }

            texture.Compress(false);
            texture = GetReadableTexture(texture);

            print($"path : {path}");
            print($"name : {f.Name}");
            print($"full name : {f.FullName}");

            Photo_ID_Front_Img_Path = path;
            Photo_ID_Front_Img_Name = f.Name;
            Photo_ID_Front_Texture = texture;
            Photo_ID_Front_Txt.text = f.Name;
            Photo_ID_Front_Lbl.SetActive(false);
            Photo_ID_Front_Txt.gameObject.SetActive(true);
            Photo_ID_Front_Clear.SetActive(true);
            Photo_ID_Front_Icon.SetActive(false);
        }
    }
    public void Photo_ID_Back_Callback(string path)
    {
        if (path != null)
        {
            // Create Texture from selected image
            Texture2D texture = NativeGallery.LoadImageAtPath(path, 256, false, false);
            if (texture == null)
            {
                Debug.Log("Couldn't load texture from " + path);
                return;
            }
            FileInfo f = new FileInfo(path);
            if (f.Length / 1024f > Photo_Max_Size_In_KB)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.SizeMustBeLessThan + " " + Photo_Max_Size_In_MB + " MB");
                return;
            }

            texture.Compress(false);
            texture = GetReadableTexture(texture);

            print($"path : {path}");
            print($"name : {f.Name}");
            print($"full name : {f.FullName}");

            Photo_ID_Back_Img_Path = path;
            Photo_ID_Back_Img_Name = f.Name;
            Photo_ID_Back_Texture = texture;
            Photo_ID_Back_Txt.text = f.Name;
            Photo_ID_Back_Lbl.SetActive(false);
            Photo_ID_Back_Txt.gameObject.SetActive(true);
            Photo_ID_Back_Clear.SetActive(true);
            Photo_ID_Back_Icon.SetActive(false);
        }
    }

    public void Clear_Photo_ID_Front_Btn()
    {
        Photo_ID_Front_Txt.text = "";
        Photo_ID_Front_Texture = null;
        Photo_ID_Front_Lbl.SetActive(true);
        Photo_ID_Front_Txt.gameObject.SetActive(false);
        Photo_ID_Front_Clear.SetActive(false);
        Photo_ID_Front_Icon.SetActive(true);
    }

    public void Clear_Photo_ID_Back_Btn()
    {
        Photo_ID_Back_Txt.text = "";
        Photo_ID_Back_Texture = null;
        Photo_ID_Back_Lbl.SetActive(true);
        Photo_ID_Back_Txt.gameObject.SetActive(false);
        Photo_ID_Back_Clear.SetActive(false);
        Photo_ID_Back_Icon.SetActive(true);
    }

    public void Photo_ID_webgl_Callback(string url, int Fotoside)
    {
        Debug.Log("Photo_ID_webgl_Callback");
        StartCoroutine(LoadImageFromURL(url, Fotoside));
    }

    internal void ImageUpload_API_Response(string packet)
    {
        Debug.Log($"ImageUpload_API_Response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<ImageUpload> resonse = JsonUtility.FromJson<EventResponse<ImageUpload>>(packet);
        if (resonse.status != EventResponse<LoginRegisterResponse>.STATUS_FAIL)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(resonse.message);
            Photo_ID_1 = null;
            Photo_ID_2 = null;
            CallPlayerProfileEvents();
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(resonse.message);
        }
    }
    #endregion

    #region PRIVATE_METHODS
    private string GetFileNameFromURL(string url)
    {
        Uri uri = new Uri(url);
        return Path.GetFileName(uri.LocalPath);
    }

    private void Profile_Pic_Callback(string path)
    {
        if (path != null)
        {
            // Create Texture from selected image
            Texture2D texture = NativeGallery.LoadImageAtPath(path, 256, false, false);
            if (texture == null)
            {
                Debug.Log("Couldn't load texture from " + path);
                return;
            }
            FileInfo f = new FileInfo(path);
            if (f.Length / 1024f > (3 * 1024))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup($"Size must be less than 3MB");
                return;
            }

            texture.Compress(false);
            texture = GetReadableTexture(texture);

            userProfilePicture = texture;
            isProfilePictureChanged = true;
            Rect r = new Rect(Vector2.zero, new Vector2(userProfilePicture.width, userProfilePicture.height));
            Vector2 p = Vector2.one * 0.5f;
            ProfilePicture = Sprite.Create(userProfilePicture, r, p);
        }
    }

    private void ChangePasswordDataProcess<T>(Socket socket, Packet packet, params object[] args) where T : class
    {
        Debug.Log($"PlayerChangedPassword: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<T> response = JsonUtility.FromJson<EventResponse<T>>(Utility.Instance.GetPacketString(packet));
        if (response.status == EventResponse<T>.STATUS_SUCCESS)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
            SavePassword();
            inputCurrentPassword.text = "";
            inputNewPassword.text = "";
            inputConfirmNewPassword.text = "";
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void ModifyPasswordText(TMP_InputField input, bool show)
    {
        string password = input.text;
        input.text = "";

        if (show)
            input.contentType = TMP_InputField.ContentType.Alphanumeric;
        else
            input.contentType = TMP_InputField.ContentType.Password;

        input.text = password;
    }

    private void ResetInputFields()
    {
        inputUsername.text = "";
        inputSurname.text = "";
        inputEmail.text = "";
        inputNickname.text = "";
        inputMobileNumber.text = "";
        //inputDOB.text = "";
        inputCurrentPassword.text = "";
        inputNewPassword.text = "";
        inputConfirmNewPassword.text = "";
        Profile_Hall_Txt.text = "";
        Customer_No_Txt.text = "";
        //Front_Photo_Txt.text = "";
        //Back_Photo_Txt.text = "";
        Bank_IF.text = "";
        Birth_Date_Txt.text = "";
        //datePickerDOB.Clear();

        ModifyPasswordText(inputCurrentPassword, false);
        ModifyPasswordText(inputNewPassword, false);
        ModifyPasswordText(inputConfirmNewPassword, false);

        Photo_ID_Front_Txt.text = Photo_ID_Back_Txt.text = "";
        Photo_ID_Front_Texture = Photo_ID_Back_Texture = null;
        Photo_ID_Front_Txt.gameObject.SetActive(false);
        Photo_ID_Back_Txt.gameObject.SetActive(false);
        Photo_ID_Front_Lbl.SetActive(true);
        Photo_ID_Back_Lbl.SetActive(true);
        Photo_ID_Front_Clear.SetActive(false);
        Photo_ID_Back_Clear.SetActive(false);
        Photo_ID_Front_Icon.SetActive(true);
        Photo_ID_Back_Icon.SetActive(true);
    }

    private bool ValidateProfileInformation()
    {
        string username = inputUsername.text;
        string surname = inputSurname.text;
        string email = inputEmail.text;
        string nickname = inputNickname.text;
        string mobileNumber = inputMobileNumber.text;

        //string dateOfBirth = inputDOB.text;
        //#if (!UNITY_IOS && !UNITY_ANDROID) || UNITY_EDITOR
        //dateDOB = datePickerDOB.GetDate();
        //#endif

        if (nickname == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterFirstName);
            return false;
        }
        else if (nickname.Length < Constants.InputData.minimumNicknameLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumFirstNameLength + " " + Constants.InputData.minimumNicknameLength);
            return false;
        }
        else if (username == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterUsernameMessage);
            return false;
        }
        else if (username.Length < Constants.InputData.minimumUsernameLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumUsernameLengthMessage + " " + Constants.InputData.minimumUsernameLength);
            return false;
        }
        else if (!Utility.Instance.Validate_User_Name(username))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.InvalidUsernameFormatMessage);
            return false;
        }
        //else if (surname.Length < Constants.InputData.minimumSurnameLength)
        //{
        //    UIManager.Instance.messagePopup.DisplayMessagePopup( "Minimum surname length should be " + Constants.InputData.minimumSurnameLength);
        //    return false;
        //}
        //else if (email == "")
        //{
        //    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterEmailId);
        //    return false;
        //}
        if (email != "")
        {
            if (!Utility.Instance.ValidateEmail(email))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.InvalidEmailMessage);
                return false;
            }
        }
        else if (mobileNumber == "")
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterMobileNumber);
            return false;
        }
        else if (mobileNumber.Length < Constants.InputData.mobileNumberLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumMobileNumberLengthMessage + " " + Constants.InputData.mobileNumberLength);
            return false;
        }

        //#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        //else if(dateOfBirth == "")
        //{
        //UIManager.Instance.messagePopup.DisplayMessagePopup("Date of Birth invalid");
        //return false;
        //}
        //#else
        //else if (!datePickerDOB.ValidateDate())
        //{
        //UIManager.Instance.messagePopup.DisplayMessagePopup("Date of Birth invalid");
        //return false;
        //}
        //#endif
        return true;
    }

    private bool ValidateChangePassword()
    {
        string currentPassword = inputCurrentPassword.text;
        string newPassword = inputNewPassword.text;
        string confirmNewPassword = inputConfirmNewPassword.text;

        if (currentPassword.Length < Constants.InputData.minimumPasswordLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumCurrentPasswordLengthMessage + " " + Constants.InputData.minimumPasswordLength);
            return false;
        }
        else if (newPassword.Length < Constants.InputData.minimumPasswordLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumNewPasswordLengthMessage + " " + Constants.InputData.minimumPasswordLength);
            return false;
        }
        else if (confirmNewPassword.Length < Constants.InputData.minimumPasswordLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumConfirmNewPasswordLengthMessage + " " + Constants.InputData.minimumPasswordLength);
            return false;
        }
        else if (newPassword != confirmNewPassword)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.NewPasswordMismatchMessage);
            return false;
        }
        return true;
    }

    private void SavePassword()
    {
        string password = inputNewPassword.text;
        PlayerPrefs.SetString(PlayerLoginConstans.PASSWORD, password);
    }

    private void CallPlayerProfileEvents()
    {
        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.PlayerProfile(PlayerProfileDataProcess<PlayerProfile>);
    }

    internal void PlayerProfileDataProcess<T>(Socket socket, Packet packet, params object[] args) where T : class
    {
        Debug.Log($"PlayerProfile Response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<T> response = JsonUtility.FromJson<EventResponse<T>>(Utility.Instance.GetPacketString(packet));
        if (response.status == EventResponse<T>.STATUS_SUCCESS)
        {
            playerData = response.result as PlayerProfile;
            SetData();
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void DeleteAccountResponse(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"DeleteAccountResponse: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));

        if (response.status == Constants.EventStatus.SUCCESS)
        {
            this.Close();
            UIManager.Instance.ClearPlayerTokenFromWebHost();
            UIManager.Instance.topBarPanel.Close();
            UIManager.Instance.CloseAllPanels();
            UIManager.Instance.loginPanel.Open();

            Utility.Instance.ClearPlayerCredentials();
            UIManager.Instance.gameAssetData.IsLoggedIn = false;
        }
        else
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        }
    }

    private void SetData()
    {
        //convert idExpiryDate UTC to local time
        // playerData.idExpiryDate = Utility.Instance.GetDateTimeLocal(playerData.idExpiryDate).ToString();
        string a = "2025-07-27T18:30:00.000Z";
        if (!string.IsNullOrEmpty(playerData.idExpiryDate))
        {
            // idExpiryDateTxt.text = $"ID Expiry Date: {DateTime.Parse(playerData.idExpiryDate).ToLocalTime().ToString("dd/MM/yyyy hh:mm tt")}";
            idExpiryDateTxt.GetComponent<LocalizationParamsManager>().SetParameterValue("value", DateTime.Parse(playerData.idExpiryDate).ToLocalTime().ToString("dd/MM/yyyy hh:mm tt"));
        }
        // UIManager.Instance.profilePanel.idExpiryDateTxt.text = Utility.Instance.GetDateTimeLocal(playerData.idExpiryDate).ToString("dd/MM/yyyy");

        if (playerData.isVerifiedByBankID && !playerData.isBankIdReverificationNeeded && playerData.isVerifiedByHall)
        {
            verifiedTxt.gameObject.SetActive(true);
        }
        else
        {
            verifiedTxt.gameObject.SetActive(false);
        }

        // Handle Bank ID verification display logic
        if (playerData.isVerifiedByBankID && !playerData.isBankIdReverificationNeeded)
        {
            // Show "Bank Id" - Bank ID is verified and no reverification needed
            BankId_Btn.gameObject.SetActive(false);
            BankId_Reverification_Btn.gameObject.SetActive(false);
        }
        else if (playerData.isVerifiedByBankID && playerData.isBankIdReverificationNeeded)
        {
            // Show "Re verify BankId" - Bank ID is verified but reverification is needed
            BankId_Btn.gameObject.SetActive(false);
            BankId_Reverification_Btn.gameObject.SetActive(true);
        }
        else
        {
            // Bank ID is not verified - show regular Bank ID button
            BankId_Btn.gameObject.SetActive(true);
            BankId_Reverification_Btn.gameObject.SetActive(false);
        }

        if (playerData.isVerifiedByHall)
        {
            idExpiryDateTxt.gameObject.SetActive(true);
        }
        else
        {
            idExpiryDateTxt.gameObject.SetActive(false);
        }

        Img_Btn.gameObject.SetActive(!playerData.isVerifiedByHall);
        inputUsername.text = playerData.username;
        inputSurname.text = playerData.surname;
        inputEmail.text = playerData.email;
        inputNickname.text = playerData.nickname;
        inputMobileNumber.text = playerData.mobile;
        //dateDOB = Convert.ToDateTime(playerData.dob);
        Bank_IF.text = playerData.bankId;
        DownloadProfileImage();
        //if (playerData.frontId != "")
        //    Front_Photo_Txt.text = playerData.frontId.Substring(playerData.frontId.LastIndexOf('/') + 1);
        //if (playerData.backId != "")
        //    Back_Photo_Txt.text = playerData.backId.Substring(playerData.backId.LastIndexOf('/') + 1);

        //#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        //        inputDOB.text = dateDOB.ToString("dd/MM/yyyy");
        //#else
        //        datePickerDOB.SetDate(dateDOB.ToString("dd"), dateDOB.ToString("MM"), dateDOB.ToString("yyyy"));
        //#endif
        Profile_Hall_Txt.text = playerData.hall.name;

        var customerNo = Customer_No_Txt.GetComponent<LocalizationParamsManager>();
        customerNo.SetParameterValue("CustomerNo", playerData.customerNumber.ToString());

        Birth_Date_Txt.text = Convert.ToDateTime(playerData.dob).ToString("dd/MM/yyyy");

        //selectedHallDataList = playerData.hall;
        //inputSelectHall.text = GetHallNameString();
        //hallSelectionPanel.SetData(UIManager.Instance.gameAssetData.hallDataList, selectedHallDataList, false);
    }

    private string GetHallNameString()
    {
        string hallNames = "";
        for (int i = 0; i < selectedHallDataList.Count; i++)
        {
            if (selectedHallDataList[i].status.ToLower() != "disapproved")
            {
                if (hallNames == "")
                    hallNames += selectedHallDataList[i].name;
                else
                    hallNames += ", " + selectedHallDataList[i].name;
            }
        }

        return hallNames;
    }

    private void StandaloneBuildValidation()
    {
        bool isUniqueIdPlayer = UIManager.Instance.gameAssetData.IsUniqueIdPlayer;
        btnUploadProfilePicture.gameObject.SetActive(!isUniqueIdPlayer);
        imgProfilePictureBorder.gameObject.SetActive(isUniqueIdPlayer);
    }

    private void CallUpdateProfileData()
    {
        string userName = inputUsername.text;
        string surname = inputSurname.text;
        string nickName = inputNickname.text;
        string mobile = inputMobileNumber.text;
        string email = inputEmail.text;
        string base64String = "";

        if (isProfilePictureChanged)
            base64String = GetBase64String(userProfilePicture);

        Texture2D profilePic = isProfilePictureChanged ? userProfilePicture : null;

        // UIManager.Instance.DisplayLoader(true);
        EventManager.Instance.UpdateProfile(userName, surname, nickName, mobile, email, Bank_IF.text, profilePic/*base64String*/, (socket, packet, args) =>
        {
            Debug.Log($"UpdateProfile response: {packet}");
            UIManager.Instance.DisplayLoader(false);

            EventResponse response = JsonUtility.FromJson<EventResponse>(Utility.Instance.GetPacketString(packet));
            UIManager.Instance.messagePopup.DisplayMessagePopup(response.message);
        });
    }

    private string GetBase64String(Texture2D texture)
    {
        if (texture == null)
        {
            Debug.LogError("GetBase64String called with null texture");
            return "";
        }

        byte[] bytes = texture.EncodeToPNG();
        string s = Convert.ToBase64String(bytes);
        return $"{s}";
    }

    private void DownloadProfileImage()
    {
        if (playerData.profilePic == "")
        {
            ProfilePicture = UIManager.Instance.gameAssetData.defaultAvatar;
        }
        else
        {
            string url = Constants.ServerDetails.BaseUrl + playerData.profilePic;
            Debug.Log($"Downloading an Image {url}");
            StartCoroutine(DownloadHelper.DownloadImage(url, (t) =>
            {
                if (t != null)
                {
                    userProfilePicture = t;
                    Rect r = new Rect(0, 0, t.width, t.height);
                    Vector2 p = Vector2.one * 0.5f;
                    ProfilePicture = Sprite.Create(t, r, p);
                }
                else
                {
                    Debug.LogError("Failed to download profile image, using default avatar");
                    ProfilePicture = UIManager.Instance.gameAssetData.defaultAvatar;
                }
            }));
        }
    }

    private Texture2D GetReadableTexture(Texture2D source)
    {
        if (source == null)
        {
            Debug.LogError("GetReadableTexture called with null source texture");
            return null;
        }

        RenderTexture renderTex = RenderTexture.GetTemporary(
                    source.width,
                    source.height,
                    0,
                    RenderTextureFormat.Default,
                    RenderTextureReadWrite.Linear);

        Graphics.Blit(source, renderTex);
        RenderTexture previous = RenderTexture.active;
        RenderTexture.active = renderTex;
        Texture2D readableText = new Texture2D(source.width, source.height);
        readableText.ReadPixels(new Rect(0, 0, renderTex.width, renderTex.height), 0, 0);
        readableText.Apply();
        RenderTexture.active = previous;
        RenderTexture.ReleaseTemporary(renderTex);
        return readableText;
    }

    private IEnumerator LoadImageFromURL(string url, int Fotoside)
    {
        UnityWebRequest www = UnityWebRequestTexture.GetTexture(url);
        yield return www.SendWebRequest();

        if (www.isNetworkError || www.isHttpError)
        {
            Debug.LogError(www.error);
        }
        else
        {
            // Check the file size
            long fileSize = Convert.ToInt64(www.GetResponseHeader("Content-Length"));
            float fileSizeInMB = fileSize / (1024f * 1024f);

            if (fileSizeInMB > Photo_Max_Size_In_MB)
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.SizeMustBeLessThan + " " + Photo_Max_Size_In_MB + " MB");
            }
            else
            {
                // Get the downloaded texture
                Texture2D texture = DownloadHandlerTexture.GetContent(www);

                // Handle the loaded texture as needed
                if (texture != null)
                {
                    // Your existing texture processing code
                    texture.Compress(false);
                    Texture2D readableTexture = GetReadableTexture(texture);

                    if (readableTexture != null)
                    {
                        if (Fotoside == 0)
                        {
                            Photo_ID_Front_Img_Path = url;
                            Photo_ID_Front_Img_Name = GetFileNameFromURL(url); // Implement this method to extract file name from URL
                            Photo_ID_Front_Texture = readableTexture;
                            Photo_ID_Front_Txt.text = Photo_ID_Front_Img_Name;
                            Photo_ID_Front_Lbl.SetActive(false);
                            Photo_ID_Front_Txt.gameObject.SetActive(true);
                            Photo_ID_Front_Clear.SetActive(true);
                            Photo_ID_Front_Icon.SetActive(false);

                            Debug.LogError("side : " + Fotoside);

                            print($"path : {url}");
                            print($"name : {GetFileNameFromURL(url)}");
                            print($"full name : {Photo_ID_Front_Img_Name}");
                        }
                        else
                        {
                            Photo_ID_Back_Img_Path = url;
                            Photo_ID_Back_Img_Name = GetFileNameFromURL(url); // Implement this method to extract file name from URL
                            Photo_ID_Back_Texture = readableTexture;
                            Photo_ID_Back_Txt.text = Photo_ID_Back_Img_Name;
                            Photo_ID_Back_Lbl.SetActive(false);
                            Photo_ID_Back_Txt.gameObject.SetActive(true);
                            Photo_ID_Back_Clear.SetActive(true);
                            Photo_ID_Back_Icon.SetActive(false);

                            Debug.LogError("side : " + Fotoside);

                            print($"path : {url}");
                            print($"name : {GetFileNameFromURL(url)}");
                            print($"full name : {Photo_ID_Back_Img_Name}");
                        }
                    }
                    else
                    {
                        Debug.LogError("Failed to create readable texture from URL: " + url);
                    }
                }
                else
                {
                    Debug.LogError("Failed to load texture from URL: " + url);
                }
            }
        }
    }
    #endregion

    #region GETTER_SETTER

    public Sprite ProfilePicture
    {
        set
        {
            imgProfilePicture.sprite = value;
        }
        get
        {
            return imgProfilePicture.sprite;
        }
    }

    #endregion
}

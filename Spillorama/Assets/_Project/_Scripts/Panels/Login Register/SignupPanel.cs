using BestHTTP.SocketIO;
using SFB;
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization.Formatters.Binary;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;
using System.Text;
using System.Collections;
using UnityEngine.EventSystems;
using UnityEngine.Networking;
using I2.Loc;
using System.Linq;
using UnityEngine.Android;
#if UNITY_IOS
using UnityEngine.iOS;
#endif
public class SignupPanel : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    #endregion

    #region PRIVATE_VARIABLES
    [Header("UPload Photo")]
    [SerializeField] private GameObject uploadPhotoPopup;
    [SerializeField] private Button uploadPhotoBtn;
    [SerializeField] private Button uploadPhotoBtnWebGL;
    [SerializeField] private Button capturePhotoBtnWebGL;
    [SerializeField] private GameObject uploadedPhotoText;
    [SerializeField] private RawImage uploadedPhotoImage;
    [SerializeField] private TMP_Text txtUploadType;
    [SerializeField] private RectTransform mainPanel;
    [SerializeField] private RectTransform content;
    [Header("Input Fields")]
    [SerializeField] private TMP_InputField inputUsername;
    [SerializeField] private TMP_InputField inputSurname;
    [SerializeField] private TMP_InputField inputEmail;
    [SerializeField] private TMP_InputField inputMobileNumber;
    [SerializeField] private TMP_InputField inputSelectHalls;
    [SerializeField] private TMP_InputField inputSelectCountry;
    [SerializeField] private TMP_InputField inputNickname;
    [SerializeField] private TMP_InputField inputDOB;
    [SerializeField] private TMP_InputField inputPassword;
    [SerializeField] private TMP_InputField inputBankId;

    [Header("Text")]
    [SerializeField] private TMP_Text registerInfoText;
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

    [Header("Game Object")]
    [SerializeField] private GameObject Photo_ID_Front_Lbl;
    [SerializeField] private GameObject Photo_ID_Back_Lbl, Photo_ID_Front_Clear, Photo_ID_Back_Clear, Photo_ID_Front_Icon, Photo_ID_Back_Icon;
    [SerializeField] private float Photo_Max_Size_In_MB;
    [SerializeField] private float Photo_Max_Size_In_KB;

    [Header("Panels")]
    [SerializeField] public HallSelectionPanel hallSelectionPanel;
    [SerializeField] public CountrySelectionPanel countrySelectionPanel;
    [SerializeField] public GameObject PEPPanel;

    [Header("Date Picker")]
    [SerializeField] private DatePickerInputBox datePickerDOB;
    [SerializeField] private List<HallData> selectedHallDataList = new List<HallData>();
    [SerializeField] private List<string> selectedCountryDataList = new List<string>();

    [Header("PEP")]
    [SerializeField] private ToggleGroup isPEPToggleGroup;
    [SerializeField] private ToggleGroup residentialAddressToggleGroup;
    [SerializeField] private ToggleGroup residentialAddressToggleGroup_Other;
    [SerializeField] private Toggle isPlayerYes;
    [SerializeField] private Toggle isPlayerNo;
    [SerializeField] private Toggle residentialAddressYes;
    [SerializeField] private TMP_InputField cityName;
    [SerializeField] private TMP_InputField zipCode;
    [SerializeField] private TMP_InputField address;
    [SerializeField] private Toggle residentialAddressYes_Other;
    [SerializeField] private Toggle residentialAddressNo;
    [SerializeField] private Toggle residentialAddressNo_Other;
    [SerializeField] private GameObject residentialAddressYes_Panel;
    [SerializeField] private GameObject residentialAddressNo_Panel;
    [SerializeField] private RectTransform residentialAddress_Panel_Rect;
    [SerializeField] private Toggle[] togglesPEP;
    [SerializeField] private Toggle[] residentialAddressToggles;

    [Header("PEP")]
    [SerializeField] private Toggle toggleSalary;
    [SerializeField] private Toggle toggleSale;
    [SerializeField] private Toggle toggleStocks;
    [SerializeField] private Toggle toggleSocial;
    [SerializeField] private Toggle toggleGifts;
    [SerializeField] private Toggle toggleOther;


    [Header("Resident of Norway")]
    [SerializeField] private Toggle toggleSalary_Norway;
    [SerializeField] private Toggle toggleSale_Norway;
    [SerializeField] private Toggle toggleStocks_Norway;
    [SerializeField] private Toggle toggleSocial_Norway;
    [SerializeField] private Toggle toggleGifts_Norway;
    [SerializeField] private Toggle toggleOther_Norway;

    [Space(10)]

    [SerializeField] private TMP_InputField pepName;
    [SerializeField] private TMP_InputField relationToPEP;
    [SerializeField] private PEPDatePickerInputBox PEPDatePickerDOB;
    [SerializeField] private TMP_InputField PEPInputDOB;

    private DateTime dateDOB = new DateTime(2000, 1, 18);
    private DateTime PEPdateDOB = new DateTime(2000, 1, 18);
    private Texture2D capturedTexture;
    public int uploadPhotoIndex = 0;
#if UNITY_WEBGL || UNITY_STANDALONE_WIN || UNITY_STANDALONE_OSX || UNITY_STANDALONE_LINUX
    private WebCamTexture webcamTexture;
#endif

    RectTransform PEPPanel_Rect;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        capturedTexture = null;
#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        datePickerDOB.Close();
        PEPDatePickerDOB.Close();
        inputDOB.Open();
        PEPInputDOB.Open();
#else
        datePickerDOB.Open();
        PEPDatePickerDOB.Open();
        inputDOB.Close();
        PEPInputDOB.Close();
#endif
        // inputMobileNumber.characterLimit = Constants.InputData.mobileNumberLength;

        hallSelectionPanel.SetAllHallData(UIManager.Instance.gameAssetData.hallDataList);
        countrySelectionPanel.SetAllCountryData(UIManager.Instance.gameAssetData.countryList);
        Photo_Max_Size_In_KB = Photo_Max_Size_In_MB * 1024f;

#if UNITY_WEBGL && !UNITY_EDITOR// || UNITY_STANDALONE_WIN || UNITY_STANDALONE_OSX || UNITY_STANDALONE_LINUX

        //Photo_ID_Front_webgl_btn.interactable = true;
        //Photo_ID_Back_webgl_btn.interactable = true;

        uploadPhotoBtnWebGL.interactable = true;
        capturePhotoBtnWebGL.interactable = true;
        //Photo_ID_Front_webgl_btn.gameObject.SetActive(true);
        //Photo_ID_Back_webgl_btn.gameObject.SetActive(true);

        uploadPhotoBtnWebGL.gameObject.SetActive(true);
        capturePhotoBtnWebGL.gameObject.SetActive(true);
        //Photo_ID_Front_btn.interactable = false;
        //Photo_ID_Back_btn.interactable = false;

        uploadPhotoBtn.interactable = false;
        capturePhotoBtnWebGL.onClick.AddListener(CapturePhoto);
#elif UNITY_STANDALONE_WIN || UNITY_STANDALONE_OSX || UNITY_STANDALONE_LINUX// || UNITY_EDITOR
        Photo_ID_Front_webgl_btn.gameObject.SetActive(false);
        Photo_ID_Back_webgl_btn.gameObject.SetActive(false);

        uploadPhotoBtnWebGL.gameObject.SetActive(false);
        capturePhotoBtnWebGL.gameObject.SetActive(true);
        Photo_ID_Front_webgl_btn.interactable = false;
        Photo_ID_Back_webgl_btn.interactable = false;

        capturePhotoBtnWebGL.interactable = true;
        uploadPhotoBtnWebGL.interactable = false;

        Photo_ID_Front_btn.interactable = true;
        Photo_ID_Back_btn.interactable = true;

        capturePhotoBtnWebGL.interactable = true;
        uploadPhotoBtn.interactable = true;
        //Photo_ID_Front_webgl_btn.interactable = true;
        //Photo_ID_Back_webgl_btn.interactable = true;

        // uploadPhotoBtnWebGL.interactable = true;
        // capturePhotoBtnWebGL.interactable = true;
        //Photo_ID_Front_webgl_btn.gameObject.SetActive(true);
        //Photo_ID_Back_webgl_btn.gameObject.SetActive(true);

        // uploadPhotoBtnWebGL.gameObject.SetActive(true);
        // capturePhotoBtnWebGL.gameObject.SetActive(true);
        //Photo_ID_Front_btn.interactable = false;
        //Photo_ID_Back_btn.interactable = false;

        // uploadPhotoBtn.interactable = false;
        capturePhotoBtnWebGL.onClick.AddListener(CapturePhoto);
#else
        Photo_ID_Front_webgl_btn.gameObject.SetActive(false);
        Photo_ID_Back_webgl_btn.gameObject.SetActive(false);

        uploadPhotoBtnWebGL.gameObject.SetActive(false);
        capturePhotoBtnWebGL.gameObject.SetActive(false);
        Photo_ID_Front_webgl_btn.interactable = false;
        Photo_ID_Back_webgl_btn.interactable = false;

        capturePhotoBtnWebGL.interactable = false;
        uploadPhotoBtnWebGL.interactable = false;

        Photo_ID_Front_btn.interactable = true;
        Photo_ID_Back_btn.interactable = true;

        capturePhotoBtnWebGL.interactable = false;
        uploadPhotoBtn.interactable = true;
#endif
        PEPPanel_Rect = PEPPanel.GetComponent<RectTransform>();
    }

    private void Start()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        if (!Permission.HasUserAuthorizedPermission(Permission.Camera))
        {
            // Request camera permission
            Permission.RequestUserPermission(Permission.Camera);
        }
#endif
    }

    private void OnEnable()
    {
        if (LocalizationManager.CurrentLanguageCode == "en-US")
        {
            registerInfoText.text = UIManager.Instance.gameAssetData.registerInfoText.en;
        }
        else if (LocalizationManager.CurrentLanguageCode == "nb")
        {
            registerInfoText.text = UIManager.Instance.gameAssetData.registerInfoText.nor;
        }
        else
        {
            registerInfoText.text = "";
        }
        ResetInputFields();
        hallSelectionPanel.ResetHallSelection();
        hallSelectionPanel.ClosePanel();
        countrySelectionPanel.ResetCountrySelection();
        countrySelectionPanel.ClosePanel();
    }
    #endregion

    #region PUBLIC_METHODS
    public void OnDOBPickerTap(bool isPEPDatePicker)
    {
        if (isPEPDatePicker)
        {
            Utility.Instance.OpenDatePicker((dateTime) =>
            {
                PEPInputDOB.text = Utility.Instance.GetDateString(dateTime);
                Debug.Log("PEPdateDOBPickerTap(): " + dateTime.ToString());
                PEPdateDOB = dateTime;
                Debug.Log("PEPdateDOBPickerTap(): " + PEPdateDOB.ToString());
                if (!Utility.Instance.Validate_Date(PEPdateDOB))
                {
                    PEPInputDOB.text = "";
                    PEPdateDOB = new DateTime(2000, 1, 18);
                    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.DatOfBirthInvalid);
                    return;
                }
            }, PEPdateDOB.Year, PEPdateDOB.Month, PEPdateDOB.Day);
        }
        else
        {
            Utility.Instance.OpenDatePicker((dateTime) =>
            {
                inputDOB.text = Utility.Instance.GetDateString(dateTime);
                Debug.Log("OnDOBPickerTap(): " + dateTime.ToString());
                dateDOB = dateTime;
                Debug.Log("OnDOBPickerTap(): " + dateDOB.ToString());
                if (!Utility.Instance.Validate_Date(dateDOB))
                {
                    inputDOB.text = "";
                    dateDOB = new DateTime(2000, 1, 18);
                    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.DatOfBirthInvalid);
                    return;
                }
            }, dateDOB.Year, dateDOB.Month, dateDOB.Day);
        }
    }

    public void Upload_Photo(int index)
    {
        uploadPhotoIndex = index;
        uploadPhotoPopup.SetActive(true);
        txtUploadType.text = index == 0 ? Photo_ID_Front_Lbl.GetComponent<TMP_Text>().text : Photo_ID_Back_Lbl.GetComponent<TMP_Text>().text;
        // Pick the correct texture (front/back)
        Texture2D currentTexture = (index == 0) ? Photo_ID_Front_Texture : Photo_ID_Back_Texture;

        if (currentTexture != null)
        {
            uploadedPhotoImage.texture = currentTexture;
            uploadedPhotoText.SetActive(false);
            uploadedPhotoImage.gameObject.SetActive(true);
        }
        else
        {
            uploadedPhotoImage.texture = null;
            uploadedPhotoText.SetActive(true);
            uploadedPhotoImage.gameObject.SetActive(false);
        }
        //        switch (index)
        //        {
        //            case 0:
        //#if UNITY_ANDROID || UNITY_IOS || UNITY_EDITOR
        //                NativeGallery.GetImageFromGallery(Photo_ID_Front_Callback);
        //#else
        //                var extensions = new[] { new ExtensionFilter("Image Files", "png", "jpg", "jpeg") };
        //                var path = StandaloneFileBrowser.OpenFilePanel("Open File", "", extensions, false);
        //                if (path != null)
        //                    Photo_ID_Front_Callback(path[0]);
        //#endif
        //                break;
        //            case 1:
        //#if UNITY_ANDROID || UNITY_IOS || UNITY_EDITOR
        //                NativeGallery.GetImageFromGallery(Photo_ID_Back_Callback);
        //#else
        //                extensions = new[] { new ExtensionFilter("Image Files", "png", "jpg", "jpeg") };
        //                path = StandaloneFileBrowser.OpenFilePanel("Open File", "", extensions, false);
        //                if (path != null)
        //                    Photo_ID_Back_Callback(path[0]);
        //#endif
        //                break;
        //        }
    }

    public void OnUploadPhotoCloseBtnTap()
    {
        uploadPhotoPopup.SetActive(false);
#if UNITY_WEBGL || UNITY_STANDALONE_WIN || UNITY_STANDALONE_OSX || UNITY_STANDALONE_LINUX// || !UNITY_EDITOR
        Debug.Log("webcamTexture.isPlaying: " + webcamTexture.isPlaying);
        Debug.Log("webcamTexture != null: " + (webcamTexture != null));

        // if (webcamTexture != null && webcamTexture.isPlaying)
        {
            webcamTexture.Stop();
            webcamTexture = null;
        }
#endif
    }

    public void OnUploadFromgallery()
    {
        switch (uploadPhotoIndex)
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

    public void OnUploadFromCamera()
    {
        switch (uploadPhotoIndex)
        {
            case 0:
#if UNITY_ANDROID || UNITY_IOS || UNITY_EDITOR
                //NativeCamera.TakePicture(Photo_ID_Front_Callback);
                Debug.Log("Camera button clicked.");
                if (Permission.HasUserAuthorizedPermission(Permission.Camera))
                {
                    Debug.Log("Opening camera...");
                    NativeCamera.TakePicture((path) =>
                    {
                        Debug.Log($"Picture captured: {path}");
                        Photo_ID_Front_Callback(path);
                    });
                }
                else
                {
                    Debug.Log("Camera permission not granted, requesting permission...");
                    Permission.RequestUserPermission(Permission.Camera);
                }
#elif UNITY_WEBGL
            StartCoroutine(StartCamera());
#elif UNITY_STANDALONE_WIN || UNITY_STANDALONE_OSX || UNITY_STANDALONE_LINUX// || UNITY_EDITOR
                StartCameraForDesktop();
#else
            Debug.LogWarning("Camera not supported on this platform.");
#endif
                break;
            case 1:
#if UNITY_ANDROID || UNITY_IOS || UNITY_EDITOR
                //NativeCamera.TakePicture(Photo_ID_Back_Callback);
                Debug.Log("Camera button clicked.");
                if (Permission.HasUserAuthorizedPermission(Permission.Camera))
                {
                    Debug.Log("Opening camera...");
                    NativeCamera.TakePicture((path) =>
                    {
                        Debug.Log($"Picture captured: {path}");
                        Photo_ID_Back_Callback(path);
                    });
                }
                else
                {
                    Debug.Log("Camera permission not granted, requesting permission...");
                    Permission.RequestUserPermission(Permission.Camera);
                }
#elif UNITY_WEBGL
            StartCoroutine(StartCamera());
#elif UNITY_STANDALONE_WIN || UNITY_STANDALONE_OSX || UNITY_STANDALONE_LINUX// || UNITY_EDITOR
                StartCameraForDesktop();
#else
            Debug.LogWarning("Camera not supported on this platform.");
#endif
                break;
        }
    }

#if UNITY_WEBGL && !UNITY_EDITOR
    private IEnumerator StartCamera()
    {
        // Ask permission (needed on mobile + WebGL)
        yield return Application.RequestUserAuthorization(UserAuthorization.WebCam);
        if (!Application.HasUserAuthorization(UserAuthorization.WebCam))
        {
            Debug.LogWarning("Webcam permission denied");
            yield break;
        }

        // Pick first available camera
        WebCamDevice[] devices = WebCamTexture.devices;
        if (devices.Length == 0)
        {
            Debug.LogWarning("No camera detected");
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.NoCameraDetected);
            yield break;
        }

        string camName = devices[0].name; // choose "front" or "back" manually if needed
        webcamTexture = new WebCamTexture(camName, 2560, 1440);
        uploadedPhotoImage.texture = webcamTexture;
        webcamTexture.Play();

        // Show UI
        uploadedPhotoText.SetActive(false);
        uploadedPhotoImage.gameObject.SetActive(true);
    }

    public void CapturePhoto()
    {
        if (webcamTexture == null || !webcamTexture.isPlaying)
        {
            Debug.LogWarning("Camera not running");
            // UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.CameraNotRunning);
            return;
        }

        Texture2D snap = new Texture2D(webcamTexture.width, webcamTexture.height);
        snap.SetPixels(webcamTexture.GetPixels());
        snap.Apply();

        uploadedPhotoImage.texture = snap;
        uploadedPhotoText.SetActive(true);
        uploadedPhotoImage.gameObject.SetActive(true);

        Debug.Log($"Photo captured for index: {uploadPhotoIndex}");

        byte[] pngData = snap.EncodeToPNG();
        string fakePath = $"Captured_{System.DateTime.Now.Ticks}.png";
        string tempPath = System.IO.Path.Combine(Application.temporaryCachePath, fakePath);
        System.IO.File.WriteAllBytes(tempPath, pngData);
        if (uploadPhotoIndex == 0)
        {
            Photo_ID_Front_Callback(tempPath);
        }
        else
        {
            Photo_ID_Back_Callback(tempPath);
        }
        webcamTexture.Stop();
        webcamTexture = null;
    }
#endif

#if UNITY_STANDALONE_WIN || UNITY_STANDALONE_OSX || UNITY_STANDALONE_LINUX// || !UNITY_EDITOR
    private void StartCameraForDesktop()
    {
        WebCamDevice[] devices = WebCamTexture.devices;
        if (devices.Length > 0)
        {
            Debug.Log("devices[0].name: " + devices[0].name);
            webcamTexture = new WebCamTexture(devices[0].name);
            uploadedPhotoImage.texture = webcamTexture;
            webcamTexture.Play();
            uploadedPhotoText.SetActive(false);
            uploadedPhotoImage.gameObject.SetActive(true);
        }
        else
        {
            Debug.LogWarning("No camera detected on Desktop platform.");
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.NoCameraDetected);
            uploadedPhotoImage.texture = null;
            uploadedPhotoText.SetActive(true);
            uploadedPhotoImage.gameObject.SetActive(false);
        }
    }

    public void CapturePhoto()
    {
        // if (webcamTexture == null || !webcamTexture.isPlaying)
        // {
        //     Debug.LogWarning("Camera not running");
        //     UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.CameraNotRunning);
        //     return;
        // }

        Texture2D snap = new Texture2D(webcamTexture.width, webcamTexture.height);
        snap.SetPixels(webcamTexture.GetPixels());
        snap.Apply();

        uploadedPhotoImage.texture = snap;
        uploadedPhotoText.SetActive(true);
        uploadedPhotoImage.gameObject.SetActive(true);

        Debug.Log($"Photo captured for index: {uploadPhotoIndex}");

        byte[] pngData = snap.EncodeToPNG();
        string fakePath = $"Captured_{System.DateTime.Now.Ticks}.png";
        string tempPath = System.IO.Path.Combine(Application.temporaryCachePath, fakePath);
        System.IO.File.WriteAllBytes(tempPath, pngData);
        if (uploadPhotoIndex == 0)
        {
            Photo_ID_Front_Callback(tempPath);
        }
        else
        {
            Photo_ID_Back_Callback(tempPath);
        }
        webcamTexture.Stop();
        webcamTexture = null;
    }
#endif

    public void OnSignupButtonTap()
    {
        if (Validate())
        {
            Debug.Log("OnSignupButtonTap(): " + dateDOB.ToString());
            Debug.Log("OnSignupButtonTap(): " + PEPdateDOB.ToString());
            // UIManager.Instance.DisplayLoader(true);
            //EventManager.Instance.Signup(inputUsername.text, inputBankId.text, inputEmail.text, inputMobileNumber.text, inputNickname.text, Utility.Instance.GetDateStringYearMonthDay(dateDOB), inputPassword.text, selectedHallDataList, SignupDataProcess, Photo_ID_Front_Texture, Photo_ID_Back_Texture);
            StartCoroutine(
                EventManager.Instance.SignUp_API(
                    inputUsername.text,
                    inputSurname.text,
                    inputBankId.text,
                    inputEmail.text,
                    inputMobileNumber.text,
                    inputNickname.text,
                    Utility.Instance.GetDateStringYearMonthDay(dateDOB),
                    inputPassword.text,
                    selectedHallDataList,
                    Photo_ID_Front_Texture,
                    Photo_ID_Back_Texture,
                    Photo_ID_Front_Img_Path,
                    Photo_ID_Back_Img_Path,
                    Photo_ID_Front_Img_Name,
                    Photo_ID_Back_Img_Name,
                    isPlayerYes.isOn,
                    residentialAddressYes.isOn,
                    pepName.text,
                    relationToPEP.text,
                    Utility.Instance.GetDateStringYearMonthDay(PEPdateDOB),
                    toggleSalary.isOn,
                    toggleSale.isOn,
                    toggleStocks.isOn,
                    toggleSocial.isOn,
                    toggleGifts.isOn,
                    toggleOther.isOn,
                    residentialAddressYes_Other.isOn,
                    cityName.text,
                    zipCode.text,
                    address.text,
                    inputSelectCountry.text,
                    toggleSalary_Norway.isOn,
                    toggleSale_Norway.isOn,
                    toggleStocks_Norway.isOn,
                    toggleSocial_Norway.isOn,
                    toggleGifts_Norway.isOn,
                    toggleOther_Norway.isOn
                )
            );
        }
    }

    public void OnLoginPanelButtonTap()
    {
        this.Close();
        UIManager.Instance.loginPanel.Open();
    }

    public void ModifyPasswordText(bool show)
    {
        string password = inputPassword.text;
        inputPassword.text = "";

        if (show)
            inputPassword.contentType = TMP_InputField.ContentType.Alphanumeric;
        else
            inputPassword.contentType = TMP_InputField.ContentType.Password;

        inputPassword.text = password;
    }

    public void OpenHallSelectionPanel()
    {
        hallSelectionPanel.OpenPanel();
    }

    public void OpenCountrySelectionPanel()
    {
        countrySelectionPanel.OpenPanel();
    }

    public void HandleHallSelection(List<HallData> hallDataList)
    {
        this.selectedHallDataList = hallDataList;

        if (hallDataList.Count == 0)
        {
            inputSelectHalls.text = "";
            return;
        }
        else
        {
            string hallNames = "";
            for (int i = 0; i < hallDataList.Count; i++)
            {
                if (i == 0)
                    hallNames += hallDataList[i].name;
                else
                    hallNames += ", " + hallDataList[i].name;
            }
            inputSelectHalls.text = hallNames;
        }
    }

    public void HandleCountrySelection(List<string> countryList)
    {
        this.selectedCountryDataList = countryList;
        string countryNames = "";
        for (int i = 0; i < countryList.Count; i++)
        {
            if (i == 0)
                countryNames += countryList[i];
            else
                countryNames += ", " + countryList[i];
        }
        inputSelectCountry.text = countryNames;
    }

    public void Clear_Photo_ID_Front_Btn()
    {
        Photo_ID_Front_Txt.text = "";
        Photo_ID_Front_Texture = null;
        Photo_ID_Front_Lbl.SetActive(true);
        Photo_ID_Front_Txt.gameObject.SetActive(false);
        Photo_ID_Front_Clear.SetActive(false);
        Photo_ID_Front_Icon.SetActive(true);
        uploadedPhotoImage.texture = null;
        uploadedPhotoImage.gameObject.SetActive(false);
        uploadedPhotoText.SetActive(true);
    }

    public void Clear_Photo_ID_Back_Btn()
    {
        Photo_ID_Back_Txt.text = "";
        Photo_ID_Back_Texture = null;
        Photo_ID_Back_Lbl.SetActive(true);
        Photo_ID_Back_Txt.gameObject.SetActive(false);
        Photo_ID_Back_Clear.SetActive(false);
        Photo_ID_Back_Icon.SetActive(true);
        uploadedPhotoImage.texture = null;
        uploadedPhotoImage.gameObject.SetActive(false);
        uploadedPhotoText.SetActive(true);
    }

    #endregion

    #region PRIVATE_METHODS
    private void ResetInputFields()
    {
        residentialAddressYes_Other.isOn = false;
        residentialAddressNo_Other.isOn = false;
        isPlayerNo.isOn = false;
        isPlayerYes.isOn = false;
        residentialAddressNo.isOn = false;
        residentialAddressYes.isOn = false;
        inputUsername.text = "";
        inputSurname.text = "";
        inputEmail.text = "";
        inputMobileNumber.text = "";
        inputNickname.text = "";
        inputDOB.text = "";
        PEPInputDOB.text = "";
        inputPassword.text = "";
        inputBankId.text = "";
        pepName.text = "";
        relationToPEP.text = "";
        cityName.text = "";
        zipCode.text = "";
        address.text = "";
        PEPPanel.SetActive(false);
        residentialAddressYes_Panel.SetActive(false);
        residentialAddressNo_Panel.SetActive(false);
        datePickerDOB.Clear();
        PEPDatePickerDOB.Clear();
        inputSelectHalls.text = "";
        inputSelectCountry.text = "";
        inputPassword.contentType = TMP_InputField.ContentType.Password;
        dateDOB = new DateTime(2000, 1, 18);
        PEPdateDOB = new DateTime(2000, 1, 18);

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

        foreach (Toggle toggle in togglesPEP)
        {
            toggle.isOn = false;
        }
        foreach (Toggle toggle in residentialAddressToggles)
        {
            toggle.isOn = false;
        }

        toggleGifts.isOn = false;
        toggleOther.isOn = false;
        toggleSalary.isOn = false;
        toggleSale.isOn = false;
        toggleSocial.isOn = false;
        toggleStocks.isOn = false;
        isPEPToggleGroup.SetAllTogglesOff();
        residentialAddressToggleGroup.SetAllTogglesOff();
        residentialAddressToggleGroup_Other.SetAllTogglesOff();
        isPEPToggleGroup.allowSwitchOff = true;
        residentialAddressToggleGroup.allowSwitchOff = true;
        residentialAddressToggleGroup_Other.allowSwitchOff = true;
    }

    private bool Validate()
    {
        string username = inputUsername.text;
        string NamePEP = pepName.text;
        string RelationPEP = relationToPEP.text;
        string surname = inputSurname.text;
        string email = inputEmail.text;
        string hallNames = inputSelectHalls.text;
        string countryNames = inputSelectCountry.text;
        string nickname = inputNickname.text;
        string mobileNumber = inputMobileNumber.text;
        string password = inputPassword.text;
        string dateOfBirth = inputDOB.text;
        string dateOfBirthPEP = PEPInputDOB.text;
        string bankID = inputBankId.text;
        string cityName = this.cityName.text;
        string zipCode = this.zipCode.text;
        string address = this.address.text;


#if (!UNITY_IOS && !UNITY_ANDROID) || UNITY_EDITOR
        dateDOB = datePickerDOB.GetDate();
        PEPdateDOB = PEPDatePickerDOB.GetDate();
#endif
        Utility.Instance.Validate_Date(dateDOB);
        Utility.Instance.Validate_Date(PEPdateDOB);

        // Validate basic required fields
        if (string.IsNullOrEmpty(nickname))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterFirstName);
            return false;
        }

        if (nickname.Length < Constants.InputData.minimumNicknameLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumFirstNameLength + " " + Constants.InputData.minimumNicknameLength);
            return false;
        }

        if (string.IsNullOrEmpty(surname))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterLastName);
            return false;
        }

        if (string.IsNullOrEmpty(username))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterUsernameMessage);
            return false;
        }

        if (username.Length < Constants.InputData.minimumUsernameLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumUsernameLengthMessage + " " + Constants.InputData.minimumUsernameLength);
            return false;
        }

        if (!Utility.Instance.Validate_User_Name(username))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.InvalidUsernameFormatMessage);
            return false;
        }

        if (string.IsNullOrEmpty(password))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterPasswordMessage);
            return false;
        }

        if (password.Length < Constants.InputData.minimumPasswordLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumPasswordLengthMessage + " " + Constants.InputData.minimumPasswordLength);
            return false;
        }

        if (Utility.Instance.Validate_Space_In_Password(password))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.SpaceNotAllowedInPassword);
            return false;
        }

        // Validate date of birth
#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        if (string.IsNullOrEmpty(inputDOB.text))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup("Please enter Date of Birth");
            return false;
        }
#else
        if (!datePickerDOB.ValidateDate())
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterDateOfBirth);
            return false;
        }
#endif

        if (!Utility.Instance.Validate_Date(dateDOB))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.DatOfBirthInvalid);
            return false;
        }

        if (string.IsNullOrEmpty(mobileNumber))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterMobileNumber);
            return false;
        }

        if (mobileNumber.Length < Constants.InputData.mobileNumberLength)
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.MinimumMobileNumberLengthMessage + " " + Constants.InputData.mobileNumberLength);
            return false;
        }

        //if (string.IsNullOrEmpty(email))
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

        if (string.IsNullOrEmpty(hallNames))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectHall);
            return false;
        }

        // Validate residential address toggles
        if (!ValidateResidentialAddressToggles())
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectIsPlayerNorwayResident);
            return false;
        }

        // Validate residential address based on selection
        if (residentialAddressYes_Other.isOn)
        {
            if (string.IsNullOrEmpty(cityName))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseInputCityName);
                return false;
            }

            if (string.IsNullOrEmpty(zipCode))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseInputZipCode);
                return false;
            }

            if (string.IsNullOrEmpty(address))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseInputAddress);
                return false;
            }
        }
        else if (residentialAddressNo_Other.isOn)
        {
            if (string.IsNullOrEmpty(countryNames))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectCountry);
                return false;
            }

            if (!IsAtLeastOneToggleSelectedResidentialAddress())
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectPEPIncomeUsedToPlay);
                return false;
            }
        }

        // Validate PEP toggles
        if (!ValidateToggles())
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectIsPlayerPEP);
            return false;
        }

        // Validate PEP fields if "YES" is selected
        if (isPlayerYes.isOn)
        {
            if (!ValidateAddressToggles())
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectAddress);
                return false;
            }

            if (string.IsNullOrEmpty(NamePEP))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterPEPName);
                return false;
            }

            if (string.IsNullOrEmpty(RelationPEP))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterRelationPEPName);
                return false;
            }

#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
            if (string.IsNullOrEmpty(PEPInputDOB.text))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup("Please enter Date of Birth");
                return false;
            }
#else
            if (!PEPDatePickerDOB.ValidateDate())
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseEnterDateOfBirth);
                return false;
            }
#endif

            if (!Utility.Instance.Validate_Date(PEPdateDOB))
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.DatOfBirthInvalid);
                return false;
            }

            if (!IsAtLeastOneToggleSelected())
            {
                UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseSelectPEPIncomeUsedToPlay);
                return false;
            }
        }
        //else if (bankID == "")
        //{
        //    UIManager.Instance.messagePopup.DisplayMessagePopup("Please enter Bank account number");
        //    return false;
        //}
        //else if (bankID.Length != inputBankId.characterLimit)
        //{
        //    UIManager.Instance.messagePopup.DisplayMessagePopup($"Bank account number length should be {inputBankId.characterLimit}");
        //    return false;
        //}
        //else if (Photo_ID_Front_Texture == null && Photo_ID_Back_Texture == null)
        //{
        //    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseUploadPhotoId);
        //    return false;
        //}
        //else if (Photo_ID_Front_Texture == null)
        //{
        //    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseUploadFrontPhotoId);
        //    return false;
        //}
        //else if (Photo_ID_Back_Texture == null)
        //{
        //    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.PleaseUploadBackPhotoId);
        //    return false;
        //}
        //else if (Photo_ID_Front_Txt.text == Photo_ID_Back_Txt.text)
        //{
        //    UIManager.Instance.messagePopup.DisplayMessagePopup(Constants.LanguageKey.FrontAndBackPhotoIdsSameMessage);
        //    return false;
        //}

        return true;
    }

    private void SignupDataProcess(Socket socket, Packet packet, params object[] args)
    {
        Debug.Log($"Signup response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<LoginRegisterResponse> resonse = JsonUtility.FromJson<EventResponse<LoginRegisterResponse>>(Utility.Instance.GetPacketString(packet));
        if (resonse.status != EventResponse<LoginRegisterResponse>.STATUS_FAIL)
        {
            this.Close();
            UIManager.Instance.loginPanel.Open();
        }

        UIManager.Instance.messagePopup.DisplayMessagePopup(resonse.message);
    }

    internal void Signup_API_Response(string packet)
    {
        Debug.Log($"Signup response: {packet}");
        UIManager.Instance.DisplayLoader(false);

        EventResponse<LoginRegisterResponse> resonse = JsonUtility.FromJson<EventResponse<LoginRegisterResponse>>(packet);
        if (resonse.status != EventResponse<LoginRegisterResponse>.STATUS_FAIL)
        {
            this.Close();
            UIManager.Instance.loginPanel.Open();
        }

        UIManager.Instance.messagePopup.DisplayMessagePopup(resonse.message);
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

            // texture.Compress(false);
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
            uploadedPhotoText.SetActive(false);
            uploadedPhotoImage.gameObject.SetActive(true);
            uploadedPhotoImage.texture = texture;
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

            // texture.Compress(false);
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
            uploadedPhotoText.SetActive(false);
            uploadedPhotoImage.gameObject.SetActive(true);
            uploadedPhotoImage.texture = texture;
        }
    }

    public void Photo_ID_webgl_Callback(string url, int Fotoside)
    {
        Debug.Log("Photo_ID_webgl_Callback");
        StartCoroutine(LoadImageFromURL(url, Fotoside));
    }

    public void OnIsPlayerPEPToggleValueChange(bool yes)
    {
        isPEPToggleGroup.allowSwitchOff = false;
        if (yes)
        {
            PEPPanel.SetActive(true);
        }
        else
        {
            PEPPanel.SetActive(false);
            foreach (Toggle toggle in togglesPEP)
            {
                toggle.isOn = false;
            }
            residentialAddressToggleGroup.SetAllTogglesOff();
            residentialAddressToggleGroup.allowSwitchOff = true;
            residentialAddressNo.isOn = false;
            residentialAddressYes.isOn = false;
            relationToPEP.text = "";
            PEPInputDOB.text = "";
            pepName.text = "";
            PEPdateDOB = new DateTime(2000, 1, 18);
            PEPDatePickerDOB.Clear();
        }
        LayoutRebuilder.ForceRebuildLayoutImmediate(mainPanel);
        LayoutRebuilder.ForceRebuildLayoutImmediate(content);
        LayoutRebuilder.ForceRebuildLayoutImmediate(PEPPanel_Rect);
        LayoutRebuilder.ForceRebuildLayoutImmediate(residentialAddress_Panel_Rect);
    }

    public void OnPEPResidentialAddressToggleValueChange()
    {
        residentialAddressToggleGroup.allowSwitchOff = false;
    }

    public void OnResidentialAddressToggleValueChange(bool yes)
    {
        residentialAddressToggleGroup_Other.allowSwitchOff = false;
        if (yes)
        {
            residentialAddressYes_Panel.SetActive(true);
            residentialAddressNo_Panel.SetActive(false);
            countrySelectionPanel.ResetCountrySelection();
            inputSelectCountry.text = "";
            foreach (Toggle toggle in residentialAddressToggles)
            {
                toggle.isOn = false;
            }
        }
        else
        {
            residentialAddressNo_Panel.SetActive(true);
            residentialAddressYes_Panel.SetActive(false);
            zipCode.text = "";
            address.text = "";
            cityName.text = "";
        }
        LayoutRebuilder.ForceRebuildLayoutImmediate(mainPanel);
        LayoutRebuilder.ForceRebuildLayoutImmediate(content);
        LayoutRebuilder.ForceRebuildLayoutImmediate(PEPPanel_Rect);
        LayoutRebuilder.ForceRebuildLayoutImmediate(residentialAddress_Panel_Rect);
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
                    // texture.Compress(false);
                    texture = GetReadableTexture(texture);

                    if (Fotoside == 0)
                    {
                        Photo_ID_Front_Img_Path = url;
                        Photo_ID_Front_Img_Name = GetFileNameFromURL(url); // Implement this method to extract file name from URL
                        Photo_ID_Front_Texture = texture;
                        Photo_ID_Front_Txt.text = Photo_ID_Front_Img_Name;
                        Photo_ID_Front_Lbl.SetActive(false);
                        Photo_ID_Front_Txt.gameObject.SetActive(true);
                        Photo_ID_Front_Clear.SetActive(true);
                        Photo_ID_Front_Icon.SetActive(false);
                        uploadedPhotoText.SetActive(false);
                        uploadedPhotoImage.gameObject.SetActive(true);
                        uploadedPhotoImage.texture = texture;
                        Debug.LogError("side : " + Fotoside);

                        print($"path : {url}");
                        print($"name : {GetFileNameFromURL(url)}");
                        print($"full name : {Photo_ID_Front_Img_Name}");
                    }
                    else
                    {
                        Photo_ID_Back_Img_Path = url;
                        Photo_ID_Back_Img_Name = GetFileNameFromURL(url); // Implement this method to extract file name from URL
                        Photo_ID_Back_Texture = texture;
                        Photo_ID_Back_Txt.text = Photo_ID_Back_Img_Name;
                        Photo_ID_Back_Lbl.SetActive(false);
                        Photo_ID_Back_Txt.gameObject.SetActive(true);
                        Photo_ID_Back_Clear.SetActive(true);
                        Photo_ID_Back_Icon.SetActive(false);
                        uploadedPhotoText.SetActive(false);
                        uploadedPhotoImage.gameObject.SetActive(true);
                        uploadedPhotoImage.texture = texture;
                        Debug.LogError("side : " + Fotoside);

                        print($"path : {url}");
                        print($"name : {GetFileNameFromURL(url)}");
                        print($"full name : {Photo_ID_Back_Img_Name}");
                    }
                }
                else
                {
                    Debug.LogError("Failed to load texture from URL: " + url);
                }
            }
        }
    }

    //private IEnumerator LoadImageFromURL(string url  , int Fotoside)
    //{
    //    UnityWebRequest www = UnityWebRequestTexture.GetTexture(url);
    //    yield return www.SendWebRequest();

    //    if (www.isNetworkError || www.isHttpError)
    //    {
    //        Debug.LogError(www.error);
    //    }
    //    else
    //    {
    //        // Get the downloaded texture
    //        Texture2D texture = DownloadHandlerTexture.GetContent(www);

    //        // Handle the loaded texture as needed
    //        if (texture != null)
    //        {
    //            // Your existing texture processing code
    //            texture.Compress(false);
    //            texture = GetReadableTexture(texture);

    //            if(Fotoside == 0)
    //            {
    //                Photo_ID_Front_Img_Path = url;
    //                Photo_ID_Front_Img_Name = GetFileNameFromURL(url); // Implement this method to extract file name from URL
    //                Photo_ID_Front_Texture = texture;
    //                Photo_ID_Front_Txt.text = Photo_ID_Front_Img_Name;
    //                Photo_ID_Front_Lbl.SetActive(false);
    //                Photo_ID_Front_Txt.gameObject.SetActive(true);
    //                Photo_ID_Front_Clear.SetActive(true);
    //                Photo_ID_Front_Icon.SetActive(false);

    //                Debug.LogError("side : " + Fotoside);

    //                print($"path : {url}");
    //                print($"name : {GetFileNameFromURL(url)}");
    //                print($"full name : {Photo_ID_Front_Img_Name}");

    //            }
    //            else
    //            {
    //                Photo_ID_Back_Img_Path = url;
    //                Photo_ID_Back_Img_Name = GetFileNameFromURL(url); // Implement this method to extract file name from URL
    //                Photo_ID_Back_Texture = texture;
    //                Photo_ID_Back_Txt.text = Photo_ID_Back_Img_Name;
    //                Photo_ID_Back_Lbl.SetActive(false);
    //                Photo_ID_Back_Txt.gameObject.SetActive(true);
    //                Photo_ID_Back_Clear.SetActive(true);
    //                Photo_ID_Back_Icon.SetActive(false);

    //                Debug.LogError("side : " + Fotoside);

    //                print($"path : {url}");
    //                print($"name : {GetFileNameFromURL(url)}");
    //                print($"full name : {Photo_ID_Back_Img_Name}");
    //            }

    //        }
    //        else
    //        {
    //            Debug.LogError("Failed to load texture from URL: " + url);
    //        }
    //    }
    //}

    // Implement this method to extract file name from URL
    private string GetFileNameFromURL(string url)
    {
        Uri uri = new Uri(url);
        return Path.GetFileName(uri.LocalPath);
    }

    Texture2D GetReadableTexture(Texture2D source)
    {
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

    #endregion

    #region COROUTINES
    #endregion

    #region GETTER_SETTER
    public bool IsAtLeastOneToggleSelected()
    {
        foreach (Toggle toggle in togglesPEP)
        {
            if (toggle.isOn)
            {
                return true;
            }
        }
        return false;
    }

    public bool IsAtLeastOneToggleSelectedResidentialAddress()
    {
        foreach (Toggle toggle in residentialAddressToggles)
        {
            if (toggle.isOn)
            {
                return true;
            }
        }
        return false;
    }

    public bool ValidateToggles()
    {
        if (!isPlayerYes.isOn && !isPlayerNo.isOn)
        {
            return false;
        }
        else
        {
            return isPlayerYes.isOn || isPlayerNo.isOn;
        }
    }

    public bool ValidateResidentialAddressToggles()
    {
        if (!residentialAddressYes_Other.isOn && !residentialAddressNo_Other.isOn)
        {
            return false;
        }
        else
        {
            return residentialAddressNo_Other.isOn || residentialAddressYes_Other.isOn;
        }
    }

    public bool ValidateAddressToggles()
    {
        if (!residentialAddressNo.isOn && !residentialAddressYes.isOn)
        {
            return false;
        }
        else
        {
            return residentialAddressNo.isOn || residentialAddressYes.isOn;
        }
    }
    #endregion
}

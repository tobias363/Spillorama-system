using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using I2.Loc;
using Newtonsoft.Json;
using pingak9;
using TMPro;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Networking;
using UnityEngine.UI;

public class Utility : MonoBehaviour
{
    #region PUBLIC_VARIABLES
    public static Utility Instance = null;


    [Header("Boolean Variables")]
    public bool LogEnable = false;
    #endregion

    #region PRIVATE_VARIABLES
    [Header("Testing Devices")]
    [SerializeField] private List<TestingDeviceData> TestingDeviceList = new List<TestingDeviceData>();

    [Header("Panels")]
    [SerializeField] private Reporter reporter;

    [Header("List")]
    [SerializeField] private List<PlayerProfileSpriteData> playerProfileSpriteList = new List<PlayerProfileSpriteData>();
    [SerializeField] private List<Sprite> spriteListGame1Balls;
    [SerializeField] private List<Sprite> spriteListGame2Balls;
    [SerializeField] private List<TicketColorData> listTicketColorData = new List<TicketColorData>();
    public Versions versions;
    private bool isRunningDeviceIsIpad = false;
    #endregion

    #region UNITY_CALLBACKS
    private void Awake()
    {
        if (Instance == null)
            Instance = this;

        bool isLogEnable = IsRunningOnTestingDevice();
        Debug.Log("CurrentLanguage : " + CurrentLanguage);
        Debug.unityLogger.logEnabled = isLogEnable;
        if (reporter)
            reporter.gameObject.SetActive(isLogEnable);

#if UNITY_IOS
        isRunningDeviceIsIpad = SystemInfo.deviceModel.Contains("iPad") || UnityEngine.iOS.Device.generation.ToString().Contains("iPad");
        Debug.Log("Running device is iPad: " + isRunningDeviceIsIpad);
#endif
    }

    public void RefreshLogMode()
    {
        bool isLogEnable = IsRunningOnTestingDevice();
        Debug.unityLogger.logEnabled = isLogEnable;
        reporter.gameObject.SetActive(isLogEnable);
    }
    #endregion

    #region DELEGATE_CALLBACKS
    #endregion

    #region PUBLIC_METHODS

    public void MoveObject(Transform obj, Vector3 fromPos, Vector3 toPos, float time)
    {
        StartCoroutine(MoveObjectSmoothly(obj, fromPos, toPos, time));
    }

    public void MoveObject(Transform obj, Vector3 toPos, float time)
    {
        StartCoroutine(MoveObjectSmoothly(obj, obj.localPosition, toPos, time));
    }

    public void ChangeScale(Transform obj, Vector3 fromScale, Vector3 toScale, float time)
    {
        StartCoroutine(ChangeScaleSmoothly(obj, fromScale, toScale, time));
    }

    public void ChangeScale(Transform obj, Vector3 toScale, float time)
    {
        StartCoroutine(ChangeScaleSmoothly(obj, obj.localScale, toScale, time));
    }

    public string StringListToJsonString(List<string> stringList)
    {
        //"[\"5fc5e5fc8fe51a2fb40f58dc\",\"5fc5e5fc8fe51a2fb40f58dd\"]"

        string listString = "[";

        for (int i = 0; i < stringList.Count; i++)
        {
            if (i > 0)
                listString += ",";

            listString += "\"" + stringList[i] + "\"";
        }
        listString += "]";

        return listString;
    }


    public string StringListToJsonStringGame5(List<(string id, int price)> stringList)
    {
        // var itemList = stringList.Select(tuple => new { id = tuple.id, price = tuple.price }).ToList();
        // var purchaseTicket = new { list = itemList };

        // string jsonString = JsonConvert.SerializeObject(purchaseTicket);
        // return jsonString;
        // var purchaseTicket = new { list = stringList };
        List<TicketData> ticketDataList = new List<TicketData>();
        foreach (var ticket in stringList)
        {
            //Debug.Log($"Ticket - ID: {ticket.id}, Price: {ticket.price}");
            ticketDataList.Add(new TicketData() { id = ticket.id, price = ticket.price });
        }
        string jsonString = JsonUtility.ToJson(new TicketListWrapper(ticketDataList));
        return jsonString;
    }

    public List<Vector2> CopyVectorListData(List<Vector2> data)
    {
        List<Vector2> newData = new List<Vector2>();

        foreach (Vector2 v in data)
        {
            newData.Add(v);
        }

        return newData;
    }

    public void RefreshContentSizeFitter(ContentSizeFitter contentSizeFitter, ScrollRect scrollRect = null)
    {
        if (contentSizeFitter != null && contentSizeFitter.IsActive())
            StartCoroutine(RefreshContentSizeFitterIenum(contentSizeFitter, scrollRect));
    }

    public void RotateObject(Transform obj, Vector3 fromRotation, Vector3 toRotation, float time)
    {
        StartCoroutine(RotateObjectSmoothly(obj, fromRotation, toRotation, time));
    }

    public void DownloadPlayerProfileImage(string playerId, string url, Image imgSource)
    {
        foreach (PlayerProfileSpriteData data in playerProfileSpriteList)
        {
            if (data.playerId == playerId)
            {
                data.lastprofilePicUrl = url;
                if (data.profilePic == url)
                {
                    imgSource.sprite = data.sprite;
                    return;
                }
            }
        }
        StartCoroutine(DownloadPlayerProfileImageCall(playerId, url, imgSource));
    }

    public Sprite GetPlayerProfileImage(string playerId)
    {
        foreach (PlayerProfileSpriteData data in playerProfileSpriteList)
            if (data.playerId == playerId)
                return data.sprite;
        return null;
    }

    public string GetPacketString(BestHTTP.SocketIO.Packet packet)
    {
        JSONArray arr = new JSONArray(packet.ToString());
        return arr.getString(arr.length() - 1);
    }

    public Sprite GetGame1BallSprite(string color)
    {
        if (color == "blue")
            return spriteListGame1Balls[0];
        else if (color == "green")
            return spriteListGame1Balls[1];
        else if (color == "red")
            return spriteListGame1Balls[2];
        else if (color == "yellow")
            return spriteListGame1Balls[3];
        else
            return spriteListGame1Balls[4];
    }

    public Sprite GetGame2BallSprite(string color)
    {
        if (color == "blue")
            return spriteListGame2Balls[0];
        else if (color == "green")
            return spriteListGame2Balls[1];
        else if (color == "red")
            return spriteListGame2Balls[2];
        else if (color == "yellow")
            return spriteListGame2Balls[3];
        else
            return spriteListGame2Balls[4];
    }

    public TicketColorData GetTicketColorData(string color)
    {
        foreach (TicketColorData colorData in listTicketColorData)
        {
            if (colorData.name == color)
                return colorData;
        }

        return listTicketColorData[0];
    }

    public string GetApplicationVersionWithOS()
    {
#if UNITY_EDITOR
        return "v" + Application.version + "u";
#elif PLATFORM_STANDALONE
        return "v" + Application.version + "s"; 
#elif UNITY_ANDROID
		return "v" + Application.version + "a";	
#elif UNITY_IOS
		return "v" + Application.version + "i";	
#elif PLATFORM_WEBGL
       return "v" + Application.version + "w";
#else
	 return "v" + Application.version + "x";
#endif
    }

    public string GetUnityUserAgent()
    {
        return
            "Unity/" + Application.unityVersion + " " +
            Application.platform + " " +
            SystemInfo.operatingSystem + " " +
            "DeviceModel/" + SystemInfo.deviceModel + " " +
            "DeviceName/" + SystemInfo.deviceName + " " +
            "CPU/" + SystemInfo.processorType + " " +
            "RAM/" + SystemInfo.systemMemorySize + "MB";
    }

    /// <summary>
    /// Date time string format should be "dd/MM/yyyy HH:mm:ss"
    /// </summary>
    /// <param name="dateTime"></param>
    /// <returns></returns>
    public DateTime GetDateTime(string dateTime)
    {
        dateTime = dateTime.Replace("-", "/");
        return DateTime.ParseExact(dateTime, "dd/MM/yyyy HH:mm:ss", null);
    }

    /// <summary>
    /// Date time string format should be "dd/MM/yyyy HH:mm:ss"
    /// UTC to local conversion
    /// </summary>
    /// <param name="dateTime"></param>
    /// <returns></returns>
    public DateTime GetDateTimeLocal(string dateTime)
    {
        dateTime = dateTime.Replace("-", "/");
        return TimeZone.CurrentTimeZone.ToLocalTime(GetDateTime(dateTime));
        //return DateTime.ParseExact(dateTime, "dd/MM/yyyy HH:mm:ss", null);
    }



    /// <summary>
    /// Date time string format should be "dd/MM/yyyy HH:mm:ss"
    /// UTC to local conversion
    /// </summary>
    /// <param name="dateTime"></param>
    /// <returns></returns>
    public DateTime GetDateTimeLocalGameStatus(string dateTime)
    {
        dateTime = dateTime.Replace("-", "/");
        return TimeZone.CurrentTimeZone.ToLocalTime(GetDateTimeGameStatus(dateTime).HasValue ? GetDateTimeGameStatus(dateTime).Value : DateTime.Parse(dateTime));
    }

    /// <summary>
    /// Date time string format should be "dd/MM/yyyy HH:mm:ss"
    /// </summary>
    /// <param name="dateTime"></param>
    /// <returns></returns>
    public DateTime? GetDateTimeGameStatus(string dateTime)
    {
        try
        {
            dateTime = dateTime.Replace("-", "/");
            return DateTime.ParseExact(dateTime, "dd/MM/yyyy hh:mm tt", null);
        }
        catch (FormatException)
        {
            Debug.Log("The string was not recognized as a valid DateTime formate.");
            return null;
        }
    }

    public string GetDateTime(DateTime dateTime)
    {
        return dateTime.Day + "/" + dateTime.Month + "/" + dateTime.Year;
    }

    public void ClearPlayerCredentials()
    {
        UIManager.Instance.gameAssetData.PlayerId = "";
        UIManager.Instance.loginPanel.Reset();
        PlayerPrefs.SetInt(PlayerLoginConstans.REMEMBER_CREDENTIALS, PlayerLoginConstans.RememberMeDisabled);
        PlayerPrefs.SetString(PlayerLoginConstans.EMAILUSERNAME, "");
        PlayerPrefs.SetString(PlayerLoginConstans.PASSWORD, "");
    }

    public void SavePlayerCredentials(PlayerCredentials creds)
    {
        if (!creds.isRemember)
            return;

        PlayerPrefs.SetInt(PlayerLoginConstans.REMEMBER_CREDENTIALS, creds.isRemember == true ? PlayerLoginConstans.RememberMeEnabled : PlayerLoginConstans.RememberMeDisabled);
        PlayerPrefs.SetString(PlayerLoginConstans.EMAILUSERNAME, creds.emailUsername);
        PlayerPrefs.SetString(PlayerLoginConstans.PASSWORD, creds.password);
        PlayerPrefs.SetString(PlayerLoginConstans.HALL_Name, creds.hallName);
        PlayerPrefs.SetString(PlayerLoginConstans.HALL_ID, creds.hallId);
    }

    public PlayerCredentials LoadPlayerCredentials()
    {
        bool isRemember = PlayerPrefs.GetInt(PlayerLoginConstans.REMEMBER_CREDENTIALS, PlayerLoginConstans.RememberMeDisabled) == 1;
        string emailUsername = PlayerPrefs.GetString(PlayerLoginConstans.EMAILUSERNAME, "");
        string password = PlayerPrefs.GetString(PlayerLoginConstans.PASSWORD, "");
        string hallname = PlayerPrefs.GetString(PlayerLoginConstans.HALL_Name, "");
        string hallid = PlayerPrefs.GetString(PlayerLoginConstans.HALL_ID, "");

        PlayerCredentials playerCredentials = new PlayerCredentials(emailUsername, password, isRemember, hallname, hallid);
        return playerCredentials;
    }

    public void OpenDatePicker(UnityAction<DateTime> unityAction, int year = 2000, int month = 1, int day = 18)
    {
        NativeDialog.OpenDatePicker(year, month, day, null,
            (DateTime _date) =>
            {
                unityAction.Invoke(_date);
                DestroyImmediate(GameObject.Find("MobileDateTimePicker"));
            });
    }

    public bool ValidateEmail(string email)
    {
        Regex regex = new Regex(@"^([\w\.\-]+)@([\w\-]+)((\.(\w){2,3})+)$");
        Match match = regex.Match(email);

        return match.Success;
    }

    public bool Validate_Space_In_Password(string password)
    {
        return password.Contains(" ");
    }

    public bool Validate_Date(DateTime date)
    {
        if (date > DateTime.Now)
            return false;
        return true;
    }

    public bool Validate_User_Name(string user_Name)
    {
        Regex regex = new Regex(@"^[A-Za-z][A-Za-z0-9_]{2,19}$");
        return regex.Match(user_Name).Success;
    }
    public bool ValidatePhoneNumber(string phoneNumber)
    {
        string phonePattern = @"^\+?[1-9]\d{1,14}$"; // Simple international phone number regex
        return Regex.IsMatch(phoneNumber, phonePattern);
    }


    public bool IsRunningOniPad()
    {
        return isRunningDeviceIsIpad;
    }

    public bool IsStandAloneVersion()
    {
#if UNITY_STANDALONE_WIN || UNITY_STANDALONE_LINUX || UNITY_STANDALONE_OSX
        return true;
#else
        return false;
#endif
    }

    public bool IsRunningOnTestingDevice()
    {
        if (LogEnable)
            return true;

#if UNITY_EDITOR
        return true;
#endif

        foreach (TestingDeviceData data in TestingDeviceList)
        {
            if (data.deviceId == DeviceId)
            {
                Debug.Log("Testing device found!");
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// date string format will be dd/MM/yyyy
    /// </summary>
    /// <param name="dateTime"></param>
    /// <returns></returns>
    public string GetDateString(DateTime dateTime)
    {
        return dateTime.Day.ToString("00") + "/" + dateTime.Month.ToString("00") + "/" + dateTime.Year;
    }

    /// <summary>
    /// date string format will be yyyy-MM-dd
    /// </summary>
    public string GetDateStringYearMonthDay(DateTime dateTime)
    {
        return dateTime.Year + "-" + dateTime.Month.ToString("00") + "-" + dateTime.Day.ToString("00");
    }

    public void OpenLink(string url)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
		ExternalCallClass.Instance.OpenUrl(url);
#else
        Application.OpenURL(url);
#endif
    }

    public void StretchAllZero(RectTransform rectTra)
    {
        rectTra.SetAnchor(AnchorPresets.StretchAll);
        rectTra.offsetMin = new Vector2(0, rectTra.offsetMin.y);
        rectTra.offsetMax = new Vector2(0, rectTra.offsetMax.y);
        rectTra.offsetMin = new Vector2(rectTra.offsetMin.x, 0);
        rectTra.offsetMax = new Vector2(rectTra.offsetMax.x, 0);
    }
    #endregion

    #region COLOR_CODES
    public Color32 GetYellowColor()
    {
        return new Color32(254, 219, 57, 255);
    }

    public Color32 GetDeactive()
    {
        return new Color32(255, 255, 255, 128);
    }

    public static void ClearChilds(Transform t)
    {
        for (int i = 0; i < t.childCount; i++) Destroy(t.GetChild(i).gameObject);
    }

    public static string GetColoredString(string str, Color32 c32)
    {
        string color = $"#{c32.r:X}{c32.g:X}{c32.b:X}";
        return $"<color={color}>{str}</color>";
    }
    #endregion

    #region PRIVATE_METHODS
    #endregion

    #region COROUTINES
    private IEnumerator MoveObjectSmoothly(Transform obj, Vector3 fromPos, Vector3 toPos, float time)
    {
        float i = 0;

        while (i < 1)
        {
            i += Time.deltaTime * (1 / time);
            if (obj != null && obj.gameObject.activeInHierarchy)
            {
                obj.localPosition = Vector3.Lerp(fromPos, toPos, i);
            }
            yield return 0;
        }
    }

    private IEnumerator ChangeScaleSmoothly(Transform obj, Vector3 fromScale, Vector3 toScale, float time)
    {
        float i = 0;

        while (i < 1)
        {
            i += Time.deltaTime * (1 / time);
            if (obj != null && obj.gameObject.activeInHierarchy)
            {
                obj.localScale = Vector3.Lerp(fromScale, toScale, i);
            }
            yield return 0;
        }
    }

    private IEnumerator RefreshContentSizeFitterIenum(ContentSizeFitter contentSizeFitter, ScrollRect scrollRect = null)
    {

        contentSizeFitter.enabled = false;

        Canvas.ForceUpdateCanvases();

        yield return new WaitForEndOfFrame();
        contentSizeFitter.enabled = true;

        Canvas.ForceUpdateCanvases();

        if (scrollRect != null)
            StartCoroutine(RefreshScrollRectIenum(scrollRect));
    }

    private IEnumerator RefreshScrollRectIenum(ScrollRect scrollRect)
    {
        yield return new WaitForEndOfFrame();
        scrollRect.ScrollToBottom();
    }

    private IEnumerator RotateObjectSmoothly(Transform obj, Vector3 fromRotation, Vector3 toRotation, float time)
    {
        float i = 0;

        while (i < 1)
        {
            i += Time.deltaTime * (1 / time);
            obj.eulerAngles = Vector3.Lerp(fromRotation, toRotation, i);
            yield return 0;
        }

        obj.eulerAngles = toRotation;
    }

    internal IEnumerator DownloadPlayerProfileImageCall(string playerId, string url, Image imgSource, bool ignoreCondition = false)
    {
        UnityWebRequest www = UnityWebRequestTexture.GetTexture(new Uri(Constants.ServerDetails.BaseUrl + url));
        yield return www.SendWebRequest();
        Debug.Log(www.url);
        Debug.Log(www.uri);
        if (www.result == UnityWebRequest.Result.ConnectionError || www.result == UnityWebRequest.Result.ProtocolError)
        {
            Debug.Log(www.error);
        }
        else
        {
            Texture2D myTexture = ((DownloadHandlerTexture)www.downloadHandler).texture;

            Sprite mySprite = myTexture != null ? Sprite.Create(myTexture, new Rect(0, 0, myTexture.width, myTexture.height), Vector2.zero) : UIManager.Instance.gameAssetData.defaultAvatar;

            PlayerProfileSpriteData data = null;
            foreach (PlayerProfileSpriteData profileData in playerProfileSpriteList)
            {
                if (profileData.playerId == playerId)
                {
                    data = profileData;
                    if (data.lastprofilePicUrl == url || ignoreCondition)
                    {
                        profileData.sprite = mySprite;
                        data.profilePic = url;
                    }
                    break;
                }
            }

            if (data == null)
            {
                data = new PlayerProfileSpriteData();
                data.playerId = playerId;
                data.profilePic = url;
                data.lastprofilePicUrl = url;
                data.sprite = mySprite;
                playerProfileSpriteList.Add(data);
            }
            if ((imgSource != null && data.lastprofilePicUrl == url) || (imgSource != null && ignoreCondition))
            {
                imgSource.sprite = data.sprite;
                switch (UIManager.Instance.Current_Game_Number)
                {
                    case 1:
                        UIManager.Instance.game1Panel.game1GamePlayPanel.Change_Profile_Pic(playerId);
                        break;
                    case 2:
                        UIManager.Instance.game2Panel.game2PlayPanel.Change_Profile_Pic(playerId);
                        break;
                    case 3:
                        UIManager.Instance.game3Panel.game3GamePlayPanel.Change_Profile_Pic(playerId);
                        break;
                    case 4:
                        break;
                }
            }
        }
    }


    public void ForceTranslate(string sourceText, string sourceLanguage, string targetLanguage, System.Action<string> result)
    {
        if (LocalizationManager.CurrentLanguageCode == "en-US")
        {
            result.Invoke(sourceText);
        }
        else
        {
            I2.Loc.GoogleTranslation.Translate(sourceText, sourceLanguage, targetLanguage, (string Translation, string Error) =>
            {
                result.Invoke(Translation);
            });
        }
    }


    #endregion

    #region GETTER_SETTER
    public bool IsMultipleScreenSupported
    {
        set
        {
            PlayerPrefs.SetInt("MULTIPLE_SCREEN_SUPPORT", value == true ? 1 : 0);
        }
        get
        {
            return PlayerPrefs.GetInt("MULTIPLE_SCREEN_SUPPORT", 0) == 0 ? false : true;
        }
    }

    public bool IsSplitScreenSupported
    {
        set
        {
            PlayerPrefs.SetInt("SPLIT_SCREEN_SUPPORT", value ? 1 : 0);
        }
        get
        {
#if UNITY_IOS || UNITY_ANDROID || UNITY_WEBGL
            return false;
#else
            return PlayerPrefs.GetInt("SPLIT_SCREEN_SUPPORT", 0) != 0;
#endif
        }
    }

    public string DeviceId
    {
        get
        {
#if UNITY_WEBGL
            const string key = "UniqueID";
            if (!PlayerPrefs.HasKey(key))
            {
                PlayerPrefs.SetString(key, System.Guid.NewGuid().ToString());
                PlayerPrefs.Save(); // Critical for WebGL!
            }
            return PlayerPrefs.GetString(key);
#else
            return SystemInfo.deviceUniqueIdentifier;
#endif
        }
    }

    public string CurrentLanguage
    {
        get
        {
            if (LocalizationManager.CurrentLanguage.Contains("English"))
            {
                return "en";
            }
            else
            {
                return "nor";
            }
        }
    }


    public string UpdateLanguage
    {
        get
        {
            if (LocalizationManager.CurrentLanguage.Contains("English"))
            {
                return "nor";
            }
            else
            {
                return "en";
            }
        }
    }

    public string AppVersion
    {
        get
        {
            return Application.version;
        }
    }

    public string OSname
    {
        get
        {
#if UNITY_ANDROID
            return "android";
#elif UNITY_IOS
            return "iOS";
#elif UNITY_WEBGL
            return "webgl";
#else
            return "other";
#endif
        }
    }
    #endregion
}


public static class MyExtension
{
    /// <summary>
	/// Convert string to camel case.
	/// </summary>
	/// <returns>The camel case string.</returns>
	/// <param name="str">String.</param>
	public static string ToPascalCase(this string str)
    {
        string[] words = str.Split(' ');
        string newString = "";

        foreach (string s in words)
        {
            newString += s.ToCharArray()[0].ToString().ToUpper() + s.Substring(1) + " ";
        }

        return newString;
    }

    /// <summary>
    /// Open the specified component.
    /// </summary>
    /// <param name="component">Component.</param>
    public static void Open(this MonoBehaviour component)
    {
        if (component.gameObject != null)
            component.gameObject.SetActive(true);
    }

    /// <summary>
    /// Open the specified component.
    /// </summary>
    /// <param name="component"></param>
    public static void Open(this GameObject component)
    {
        if (component != null)
            component.SetActive(true);
    }

    /// <summary>
    /// Close the specified component.
    /// </summary>
    /// <param name="component">Component.</param>
    public static void Close(this MonoBehaviour component)
    {
        if (component.gameObject != null)
            component.gameObject.SetActive(false);
    }

    /// <summary>
    /// Close the specified component.
    /// </summary>
    /// <param name="component"></param>
    public static void Close(this GameObject component)
    {
        if (component != null)
            component.SetActive(false);
    }

    /// <summary>
    /// Set scrollbar to top
    /// </summary>
    /// <param name="scrollRect"></param>
    public static void ScrollToTop(this ScrollRect scrollRect)
    {
        scrollRect.normalizedPosition = new Vector2(0, 1);
    }

    /// <summary>
    /// Set scrollbar to bottom
    /// </summary>
    /// <param name="scrollRect"></param>
    public static void ScrollToBottom(this ScrollRect scrollRect)
    {
        scrollRect.normalizedPosition = new Vector2(0, 0);
    }

    /// <summary>
    /// Get the string/text of TMPUGUI as a lowercase string/text
    /// </summary>
    /// <param name="tmpInput"></param>
    /// <returns></returns>
    public static string GetTextToLower(this TMP_InputField tmpInput)
    {
        return tmpInput.text.ToLower();
    }

    public static string ToTime(this int time)
    {
        float m = time / 60;
        float s = time % 60;
        return $"{m:00}:{s:00}";
    }

}

#region Dynamic Transform
/* Demo Code
 _ImgTransform.SetAnchor(AnchorPresets.TopRight);
 _ImgTransform.SetAnchor(AnchorPresets.TopRight,-10,-10);
 
 ImgTransform.SetPivot(PivotPresets.TopRight);

RectTransformExtensions.SetAnchor (textProductId.GetComponent<RectTransform> (), AnchorPresets.StretchAll, 0, 0);
*/
public enum AnchorPresets
{
    TopLeft,
    TopCenter,
    TopRight,

    MiddleLeft,
    MiddleCenter,
    MiddleRight,

    BottomLeft,
    BottomCenter,
    BottomRight,
    BottomStretch,

    VertStretchLeft,
    VertStretchRight,
    VertStretchCenter,

    HorStretchTop,
    HorStretchMiddle,
    HorStretchBottom,

    StretchAll
}

public enum PivotPresets
{
    TopLeft,
    TopCenter,
    TopRight,

    MiddleLeft,
    MiddleCenter,
    MiddleRight,

    BottomLeft,
    BottomCenter,
    BottomRight,
}

public static class RectTransformExtensions
{
    //////////////////////////////////////////////////////////////////
    public static void SetLeft(this RectTransform rt, float left)
    {
        rt.offsetMin = new Vector2(left, rt.offsetMin.y);
    }

    public static void SetRight(this RectTransform rt, float right)
    {
        rt.offsetMax = new Vector2(-right, rt.offsetMax.y);
    }

    public static void SetTop(this RectTransform rt, float top)
    {
        rt.offsetMax = new Vector2(rt.offsetMax.x, -top);
    }

    public static void SetBottom(this RectTransform rt, float bottom)
    {
        rt.offsetMin = new Vector2(rt.offsetMin.x, bottom);
    }
    //////////////////////////////////////////////////////////////////

    public static void SetAnchor(this RectTransform source, AnchorPresets allign, int offsetX = 0, int offsetY = 0)
    {
        source.anchoredPosition = new Vector3(offsetX, offsetY, 0);

        switch (allign)
        {
            case (AnchorPresets.TopLeft):
                {
                    source.anchorMin = new Vector2(0, 1);
                    source.anchorMax = new Vector2(0, 1);
                    break;
                }
            case (AnchorPresets.TopCenter):
                {
                    source.anchorMin = new Vector2(0.5f, 1);
                    source.anchorMax = new Vector2(0.5f, 1);
                    break;
                }
            case (AnchorPresets.TopRight):
                {
                    source.anchorMin = new Vector2(1, 1);
                    source.anchorMax = new Vector2(1, 1);
                    break;
                }

            case (AnchorPresets.MiddleLeft):
                {
                    source.anchorMin = new Vector2(0, 0.5f);
                    source.anchorMax = new Vector2(0, 0.5f);
                    break;
                }
            case (AnchorPresets.MiddleCenter):
                {
                    source.anchorMin = new Vector2(0.5f, 0.5f);
                    source.anchorMax = new Vector2(0.5f, 0.5f);
                    break;
                }
            case (AnchorPresets.MiddleRight):
                {
                    source.anchorMin = new Vector2(1, 0.5f);
                    source.anchorMax = new Vector2(1, 0.5f);
                    break;
                }

            case (AnchorPresets.BottomLeft):
                {
                    source.anchorMin = new Vector2(0, 0);
                    source.anchorMax = new Vector2(0, 0);
                    break;
                }
            case (AnchorPresets.BottomCenter):
                {
                    source.anchorMin = new Vector2(0.5f, 0);
                    source.anchorMax = new Vector2(0.5f, 0);
                    break;
                }
            case (AnchorPresets.BottomRight):
                {
                    source.anchorMin = new Vector2(1, 0);
                    source.anchorMax = new Vector2(1, 0);
                    break;
                }

            case (AnchorPresets.HorStretchTop):
                {
                    source.anchorMin = new Vector2(0, 1);
                    source.anchorMax = new Vector2(1, 1);
                    break;
                }
            case (AnchorPresets.HorStretchMiddle):
                {
                    source.anchorMin = new Vector2(0, 0.5f);
                    source.anchorMax = new Vector2(1, 0.5f);
                    break;
                }
            case (AnchorPresets.HorStretchBottom):
                {
                    source.anchorMin = new Vector2(0, 0);
                    source.anchorMax = new Vector2(1, 0);
                    break;
                }

            case (AnchorPresets.VertStretchLeft):
                {
                    source.anchorMin = new Vector2(0, 0);
                    source.anchorMax = new Vector2(0, 1);
                    break;
                }
            case (AnchorPresets.VertStretchCenter):
                {
                    source.anchorMin = new Vector2(0.5f, 0);
                    source.anchorMax = new Vector2(0.5f, 1);
                    break;
                }
            case (AnchorPresets.VertStretchRight):
                {
                    source.anchorMin = new Vector2(1, 0);
                    source.anchorMax = new Vector2(1, 1);
                    break;
                }

            case (AnchorPresets.StretchAll):
                {
                    source.anchorMin = new Vector2(0, 0);
                    source.anchorMax = new Vector2(1, 1);
                    break;
                }
        }
    }

    public static void SetPivot(this RectTransform source, PivotPresets preset)
    {

        switch (preset)
        {
            case (PivotPresets.TopLeft):
                {
                    source.pivot = new Vector2(0, 1);
                    break;
                }
            case (PivotPresets.TopCenter):
                {
                    source.pivot = new Vector2(0.5f, 1);
                    break;
                }
            case (PivotPresets.TopRight):
                {
                    source.pivot = new Vector2(1, 1);
                    break;
                }

            case (PivotPresets.MiddleLeft):
                {
                    source.pivot = new Vector2(0, 0.5f);
                    break;
                }
            case (PivotPresets.MiddleCenter):
                {
                    source.pivot = new Vector2(0.5f, 0.5f);
                    break;
                }
            case (PivotPresets.MiddleRight):
                {
                    source.pivot = new Vector2(1, 0.5f);
                    break;
                }

            case (PivotPresets.BottomLeft):
                {
                    source.pivot = new Vector2(0, 0);
                    break;
                }
            case (PivotPresets.BottomCenter):
                {
                    source.pivot = new Vector2(0.5f, 0);
                    break;
                }
            case (PivotPresets.BottomRight):
                {
                    source.pivot = new Vector2(1, 0);
                    break;
                }
        }
    }
}
#endregion
[System.Serializable]
public class TicketData
{
    public string id;
    public int price;
}

[System.Serializable]
public class TicketListWrapper
{
    public List<TicketData> list;

    public TicketListWrapper(List<TicketData> tickets)
    {
        list = tickets;
    }
}
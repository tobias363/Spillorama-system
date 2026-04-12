using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using BestHTTP;
using BestHTTP.SocketIO;
using UnityEngine;
using UnityEngine.UI;

public class ScreenSaverManager : MonoBehaviour
{
    public static ScreenSaverManager Instance = null;

    public GameObject screenSaverUI; // The UI GameObject for the screen saver
    public Image displayImage; // The UI image for the display screen saver image

    //public Toggle screenSaverToggle; // The toggle to enable/disable screen saver
    public float inactivityDuration = 0f; // 10 minutes

    public bool screenSaverToggle = false; // The toggle to enable/disable screen saver

    [Header("Serializable Class")]
    public List<ImageTime> imageTimes = new List<ImageTime>();

    private float inactivityTimer;
    private bool screenSaverActive = false;

    private float screensSaverImageTimer;

#if !BESTHTTP_DISABLE_CACHING
    private bool allDownloadedFromLocalCache;
#endif

    public Dictionary<string, Sprite> downloadedSceenSaverImages;

    private List<HTTPRequest> activeRequests = new List<HTTPRequest>();

    private int currentImageIndex = 0;

    private Coroutine displayImagesCoroutine;

    public float duration = 1f; // Duration of the fade

    #region UNITY_CALLBACKS

    void Awake()
    {
        if (Instance == null)
            Instance = this;

        GameSocketManager.SocketConnectionInitialization += EnableBroadcast;
    }

    void Start()
    {
        downloadedSceenSaverImages = new Dictionary<string, Sprite>();

        ScreenSaverToggle = false;
        inactivityTimer = 0f;
        screensSaverImageTimer = 0f;
        screenSaverUI.SetActive(false);
    }

    void Update()
    {
        // Reset timer if user interaction is detected
        if (Input.anyKeyDown || MouseMoved() || Input.touchCount > 0)
        {
            ResetInactivityTimer();
            if (screenSaverActive)
            {
                DeactivateScreenSaver();
            }
        }

        // Update the timer if the screen saver is enabled
        if (ScreenSaverToggle && !UIManager.Instance.lobbyPanel.walletPanel.isActiveAndEnabled && (!UIManager.Instance.gameAssetData.IsLoggedIn || UIManager.Instance.lobbyPanel.isActiveAndEnabled))
        {
            inactivityTimer += Time.deltaTime;

            //if (!screenSaverActive)
            //    Debug.Log(ConvertFloatToTimeFormat(inactivityTimer));

            //InactivityDuration
            if (inactivityTimer >= InactivityDuration && !screenSaverActive)
            {
                ActivateScreenSaver();
            }
        }
    }

    #endregion

    #region PRIVATE_METHODS

    void ResetInactivityTimer()
    {
        inactivityTimer = 0f;
        currentImageIndex = 0;
        screensSaverImageTimer = 0f;
    }

    void ActivateScreenSaver()
    {
        screenSaverUI.transform.SetAsLastSibling();
        screenSaverActive = true;
        screenSaverUI.SetActive(true);

        FadeIn();

        // If Game 5 is running, then disable all elements.
        UIManager.Instance.CloseAllGameElements();

        if (displayImagesCoroutine == null)
        {
            displayImagesCoroutine = StartCoroutine(DisplayImages());
        }
    }

    void DeactivateScreenSaver()
    {
        screenSaverActive = false;
        screenSaverUI.SetActive(false);

        FadeOut();

        // If the game 5 is running and disables all elements, then reactive all elements.
        UIManager.Instance.ActiveAllGameElements();

        if (displayImagesCoroutine != null)
        {
            StopCoroutine(displayImagesCoroutine);
            displayImagesCoroutine = null;
        }

        ResetInactivityTimer();
    }

    private string ConvertFloatToTimeFormat(float timeInSeconds)
    {
        int minutes = Mathf.FloorToInt(timeInSeconds / 60);
        int seconds = Mathf.FloorToInt(timeInSeconds % 60);
        return $"{minutes:D2}:{seconds:D2}";
    }

    private bool MouseMoved()
    {
        return Mathf.Abs(Input.GetAxis("Mouse X")) > 0.01f || Mathf.Abs(Input.GetAxis("Mouse Y")) > 0.01f;
    }

    public void EnableBroadcast()
    {
        GameSocketManager.socketManager?.Socket?.On(Constants.BroadcastName.updateScreenSaver, UpdateScreenSaverData);
    }

    private void UpdateScreenSaverData(Socket socket, Packet packet, object[] args)
    {
        Debug.Log($"{Constants.BroadcastName.updateScreenSaver} Broadcast Response : {packet}");

        ModifyScreenSaverData resp = JsonUtility.FromJson<ModifyScreenSaverData>(Utility.Instance.GetPacketString(packet));

        //if (!UIManager.Instance.gameAssetData.IsLoggedIn)
        //return;

        ScreenSaverToggle = resp.screenSaver;

        if (screenSaverToggle)
        {
            float totalSecond = int.Parse(resp.screenSaverTime) * 60;
            InactivityDuration = totalSecond;

            for (int i = 0; i < resp.imageTime.Count; i++)
            {
                // Use List.Find to search for the item with the matching id
                ImageTime foundItem = imageTimes.Find(item => item.id == resp.imageTime[i].id);

                // Check if an item was found
                if (foundItem != null)
                {
                    //Debug.Log("Item found: " + foundItem.id); // Example of handling the found item

                    if (!foundItem.image.Equals(resp.imageTime[i].image))
                    {
                        //Debug.Log($"Image Url has changed for this {foundItem.id} item");

                        foundItem.image = resp.imageTime[i].image;

                        //Download updated image and save in dictionary.
                        DownloadImage(resp.imageTime[i].image);
                    }

                    if (!foundItem.time.Equals(resp.imageTime[i].time))
                    {
                        //Debug.Log($"Time has changed for this {foundItem.id} item");
                        foundItem.time = resp.imageTime[i].time;
                    }
                }
                else
                {
                    //Debug.Log("Item with id " + resp.imageTime[i].id + " not found.");

                    this.imageTimes.Add(resp.imageTime[i]);

                    //Download new image and save in dictionary.
                    DownloadImage(resp.imageTime[i].image);
                }
            }

            // Get the ids from the new list
            var newIds = resp.imageTime.Select(i => i.id).ToHashSet();

            // Remove items from the current list if their id is not in the new list
            this.imageTimes.RemoveAll(i => !newIds.Contains(i.id));
        }
        else
        {
            if (screenSaverActive)
            {
                DeactivateScreenSaver();
            }
            else
            {
                ResetInactivityTimer();
            }
        }
    }

    #endregion

    public void GetScreenSaverDetails()
    {
        EventManager.Instance.GetScreenSaverDetails((socket, packet, arga) =>
        {
            //Debug.Log($"ScreenSaver Response : {packet}");

            EventResponse<ModifyScreenSaverData> response = JsonUtility.FromJson<EventResponse<ModifyScreenSaverData>>(Utility.Instance.GetPacketString(packet));
            if (response.status == Constants.EventStatus.SUCCESS)
            {
                ScreenSaverToggle = response.result.screenSaver;
                if (response.result.screenSaver)
                {
                    float totalSecond = int.Parse(response.result.screenSaverTime) * 60;
                    InactivityDuration = totalSecond;
                    SaveScreenSaverImagesAndDownload(response.result.imageTime);
                }
            }
        });
    }

    public void SaveScreenSaverImagesAndDownload(List<ImageTime> imageTimes)
    {
        this.imageTimes = new List<ImageTime>();

        this.imageTimes = imageTimes;

        DownloadImages();
    }

    #region Download Screen Saver Images

    public void DownloadImages()
    {
        // Set these metadatas to its initial values
#if !BESTHTTP_DISABLE_CACHING
        allDownloadedFromLocalCache = true;
#endif

        for (int i = 0; i < imageTimes.Count; ++i)
        {
            //Debug.Log($"Screen Saver Image Download Uri {Constants.ServerDetails.BaseUrl + imageTimes[i].image}");

            // Set a blank placeholder texture, overriding previously downloaded texture
            //this._images[i].texture = null;

            // Construct the request
            var request = new HTTPRequest(new Uri(Constants.ServerDetails.BaseUrl + imageTimes[i].image), ImageDownloaded);

            // Set the Tag property, we can use it as a general storage bound to the request
            //Debug.Log(this._images[i]);
            //request.Tag = this._images[i];

            // Tag the request with the unique ID
            //Debug.Log(ExtractFilename(imageTimes[i].image));
            request.Tag = ExtractFilename(imageTimes[i].image);

            // Send out the request
            request.Send();

            this.activeRequests.Add(request);
        }

        //this._cacheLabel.text = string.Empty;
    }

    public void DownloadImage(string url)
    {
        // Set these metadatas to its initial values
#if !BESTHTTP_DISABLE_CACHING
        allDownloadedFromLocalCache = true;
#endif

        Debug.Log($"Screen Saver Image Download Uri {Constants.ServerDetails.BaseUrl + url}");

        // Construct the request
        var request = new HTTPRequest(new Uri(Constants.ServerDetails.BaseUrl + url), ImageDownloaded);

        // Set the Tag property, we can use it as a general storage bound to the request
        // Tag the request with the unique ID
        Debug.Log(ExtractFilename(url));
        request.Tag = ExtractFilename(url);

        // Send out the request
        request.Send();

        this.activeRequests.Add(request);
    }

    /// <summary>
    /// Callback function of the image download http requests
    /// </summary>
    void ImageDownloaded(HTTPRequest req, HTTPResponse resp)
    {
        switch (req.State)
        {
            // The request finished without any problem.
            case HTTPRequestStates.Finished:
                if (resp.IsSuccess)
                {
                    //Debug.Log("resp.IsFromCache : " + resp.IsFromCache);
                    // The target RawImage reference is stored in the Tag property
                    //RawImage rawImage = req.Tag as RawImage;
                    //rawImage.texture = resp.DataAsTexture2D;

                    // Create a Sprite from the downloaded texture
                    Texture2D texture = resp.DataAsTexture2D;
                    if (texture != null)
                    {
                        // Get the unique ID from the request tag
                        string uniqueID = (string)req.Tag;
                        //Debug.Log("uniqueID : " + uniqueID);
                        // Create a sprite from the texture
                        Sprite sprite = Sprite.Create(texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f));
                        sprite.name = uniqueID;
                        if (!downloadedSceenSaverImages.ContainsKey(uniqueID))
                        {
                            // Save the sprite in the dictionary
                            downloadedSceenSaverImages.Add(uniqueID, sprite);
                            //downloadedScreenSaverImages[uniqueID] = sprite;
                        }

                        //Debug.Log($"Image with ID {uniqueID} saved successfully.");
                    }

#if !BESTHTTP_DISABLE_CACHING
                    // Update the cache-info variable
                    allDownloadedFromLocalCache = allDownloadedFromLocalCache && resp.IsFromCache;
#endif
                }
                else
                {
                    Debug.LogWarning(string.Format("Request finished Successfully, but the server sent an error. Status Code: {0}-{1} Message: {2}",
                                                    resp.StatusCode,
                                                    resp.Message,
                                                    resp.DataAsText));
                }
                break;

            // The request finished with an unexpected error. The request's Exception property may contain more info about the error.
            case HTTPRequestStates.Error:
                Debug.LogError("Request Finished with Error! " + (req.Exception != null ? (req.Exception.Message + "\n" + req.Exception.StackTrace) : "No Exception"));
                break;

            // The request aborted, initiated by the user.
            case HTTPRequestStates.Aborted:
                Debug.LogWarning("Request Aborted!");
                break;

            // Connecting to the server is timed out.
            case HTTPRequestStates.ConnectionTimedOut:
                Debug.LogError("Connection Timed Out!");
                break;

            // The request didn't finished in the given time.
            case HTTPRequestStates.TimedOut:
                Debug.LogError("Processing the request Timed Out!");
                break;
        }

        this.activeRequests.Remove(req);

        if (this.activeRequests.Count == 0)
        {
            /*#if !BESTHTTP_DISABLE_CACHING
                        if (this.allDownloadedFromLocalCache)
                            this._cacheLabel.text = "All images loaded from local cache!";
                        else
            #endif
                            this._cacheLabel.text = string.Empty;*/
        }
    }

    private string ExtractFilename(string url)
    {
        if (!string.IsNullOrEmpty(url))
        {
            // Find the index of the last '/'
            int lastSlashIndex = url.LastIndexOf('/');

            // Find the index of '.jpeg'
            int dotIndex = url.LastIndexOf('.');

            // Extract the filename
            string filename = url.Substring(lastSlashIndex + 1, dotIndex - lastSlashIndex - 1);

            // Print the result
            Console.WriteLine(filename);

            return filename;
        }
        else
        {
            return "";
        }
    }

    #endregion

    #region Display screen saver images for the specified time

    IEnumerator DisplayImages()
    {
        while (true)
        {
            if (imageTimes.Count == 0)
                yield break;

            // Get the current image data
            ImageTime imageTime = imageTimes[currentImageIndex];

            screensSaverImageTimer += Time.deltaTime;

            //if (screenSaverActive)
            //Debug.Log($"Image Index : {currentImageIndex} {imageTime.time} : {ConvertFloatToTimeFormat(screensSaverImageTimer)}");

            // Get the key on saved image data.
            string key = ExtractFilename(imageTime.image);
            //Debug.Log("Key : " + key);
            // Check if the image is already cached
            if (downloadedSceenSaverImages.TryGetValue(key, out Sprite cachedSprite))
            {
                // Use the cached image
                //Debug.Log("Use the cached image");
                displayImage.sprite = cachedSprite;
            }
            else
            {
                // Download and cache the image
                //Debug.Log("Download and cache the image");
                DownloadImage(imageTime.image);
                /*UnityWebRequest request = UnityWebRequestTexture.GetTexture(imageData.imageUrl);
                yield return request.SendWebRequest();

                if (request.result == UnityWebRequest.Result.Success)
                {
                    Texture2D texture = DownloadHandlerTexture.GetContent(request);
                    Sprite sprite = Sprite.Create(texture, new Rect(0, 0, texture.width, texture.height), new Vector2(0.5f, 0.5f));
                    displayImage.sprite = sprite;

                    // Cache the sprite
                    imageCache[imageData.id] = sprite;
                }
                else
                {
                    Debug.LogError("Error downloading image: " + request.error);
                }*/
            }

            // Wait for the specified time
            //yield return new WaitForSeconds(int.TryParse( "2"), );
            yield return new WaitForSeconds(int.TryParse(imageTime.time, out int seconds) ? seconds : 0);

            // Reset current screen saver image time.
            screensSaverImageTimer = 0f;
            //Debug.Log("===== New Screen Saver Image =====");

            // Move to the next image
            currentImageIndex = (currentImageIndex + 1) % imageTimes.Count;
        }
    }

    #endregion

    public void FadeIn()
    {
        // Use LeanTween.alpha to animate the alpha of the image
        LeanTween.alpha(displayImage.rectTransform, 1f, duration); // 1f is the target alpha value, duration is the time in seconds
    }

    public void FadeOut()
    {
        // Use LeanTween.alpha to animate the alpha of the image to 0
        LeanTween.alpha(displayImage.rectTransform, 0f, duration); // 0f is the target alpha value, duration is the time in seconds
    }

    public bool ScreenSaverToggle
    {
        get
        {
            return screenSaverToggle;
        }
        set
        {
            screenSaverToggle = value;
        }
    }

    public float InactivityDuration
    {
        get
        {
            return inactivityDuration;
        }
        set
        {
            inactivityDuration = value;
        }
    }
}
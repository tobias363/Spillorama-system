using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using SFB;
using UnityEngine.Events;
using UnityEngine.Networking;

[RequireComponent(typeof(Button))]
public class PhotoUtilityWebGL : MonoBehaviour, IPointerDownHandler
{
    #region PUBLIC_VARIABLES
    //public RawImage output;
    public bool ovalSelection;
    public bool autoZoom;
    #endregion

    #region PRIVATE_VARIABLES
    private float minAspectRatio = 1;
    private float maxAspectRatio = 1;
    #endregion

    #region UNITY_EVENT_CALLBACK
    //public CustomUnityEventSprite eventPictureSprite;
    public OnImageSelected OnTextureSelected;
    #endregion

#if UNITY_WEBGL && !UNITY_EDITOR
    //
    // WebGL
    //
    [DllImport("__Internal")]
    private static extern void UploadFile(string gameObjectName, string methodName, string filter, bool multiple);

    public void OnPointerDown(PointerEventData eventData) {
        UploadFile(gameObject.name, "OnFileUpload", ".png, .jpg", false);
    }

    // Called from browser
    public void OnFileUpload(string url) {
        StartCoroutine(OutputRoutine(url));
    }
#else
    //
    // Standalone platforms & editor
    //
    public void OnPointerDown(PointerEventData eventData) { }

    void Start()
    {
        var button = GetComponent<Button>();
        button.onClick.AddListener(OnClick);
    }

    private void OnClick()
    {
        var paths = StandaloneFileBrowser.OpenFilePanel("Title", "", "png", false);
        if (paths.Length > 0)
        {
            StartCoroutine(OutputRoutine(new System.Uri(paths[0]).AbsoluteUri));
        }
    }
#endif

    private IEnumerator OutputRoutine(string url)
    {
        UnityWebRequest req = UnityWebRequestTexture.GetTexture(url);
        yield return req.SendWebRequest();

        OnTextureSelected.Invoke(DownloadHandlerTexture.GetContent(req));
    }

    private void CropPhoto(Texture2D screenshot)
    {
        ImageCropper.Instance.Show(screenshot, (bool result, Texture originalImage, Texture2D croppedImage) =>
        {
            if (result)
            {
                Sprite newSprite = Sprite.Create(croppedImage, new Rect(0, 0, croppedImage.width, croppedImage.height), new Vector2(0.5f, 0.5f));
                //eventPictureSprite.Invoke(newSprite);
            }

            DestroyImmediate(screenshot, true);            
        },settings: new ImageCropper.Settings()
            {
                ovalSelection = ovalSelection,
                autoZoomEnabled = autoZoom,
                imageBackground = Color.black, // transparent background // Color.clear
                selectionMinAspectRatio = minAspectRatio,
                selectionMaxAspectRatio = maxAspectRatio
            },
            croppedImageResizePolicy: (ref int width, ref int height) =>
            {
                width /= 2;
                height /= 2;
            });
    }
}

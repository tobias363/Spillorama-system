using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class PhotoUtility : MonoBehaviour
{
    #region PUBLIC_VARIABLES

    public bool ovalSelection;
    public bool autoZoom;
    #endregion

    #region PRIVATE_VARIABLES
    [SerializeField] private GameObject gameObjectOptionPopup;

    private float minAspectRatio = 1;
    private float maxAspectRatio = 1;
    #endregion

    #region UNITY_EVENT_CALLBACK
    //public CustomUnityEventSprite eventPictureSprite;
    public OnImageSelected OnProfilePictureSelected;
    #endregion

    #region PUBLIC_METHODS
    public void OnGalleryButtonTap()
    {
        PickImage(512);
    }

    public void OnCameraButtonTap()
    {
        //TakePicture(512);
    }

    public void ClosePanel()
    {
        this.Close();
    }

    public void ReceiveImage(string dataUrl)
    {
        string s_dataUrlPrefix = "data:image/png;base64,";

        if (dataUrl.StartsWith(s_dataUrlPrefix))
        {
            byte[] pngData = System.Convert.FromBase64String(dataUrl.Substring(s_dataUrlPrefix.Length));

            // Create a new Texture (or use some old one?)
            Texture2D tex = new Texture2D(1, 1); // does the size matter?
            if (tex.LoadImage(pngData))
            {
                CropPhoto(tex);
            }
            else
            {
                this.Close();
                Debug.LogError("could not decode image");
            }
        }
        else
        {
            this.Close();
            Debug.LogError("Error getting image:" + dataUrl);
        }
    }
    #endregion

    #region PRIVATE_METHODS	
    //private void TakePicture(int maxSize)
    //{
    //	NativeCamera.Permission permission = NativeCamera.TakePicture((path) =>
    //	{			
    //		if (path != null)
    //		{
    //			Texture2D texture = NativeCamera.LoadImageAtPath(path, maxSize);
    //			if (texture == null)
    //			{
    //				Debug.Log("Couldn't load texture from " + path);
    //				return;
    //			}

    //			CropPhoto(texture);
    //			//OnProfilePictureSelected.Invoke(texture);
    //		}
    //	}, maxSize);

    //	Debug.Log("Permission result: " + permission);
    //}

    private void PickImage(int maxSize)
    {
        NativeGallery.Permission permission = NativeGallery.GetImageFromGallery((path) =>
        {
            if (path != null)
            {
                Texture2D texture = NativeGallery.LoadImageAtPath(path, maxSize);
                if (texture == null)
                {
                    Debug.Log("Couldn't load texture from " + path);
                    return;
                }

                CropPhoto(texture);
                //OnProfilePictureSelected.Invoke(texture);
            }
        }, "Select image", "image/*");

        Debug.Log("Permission result: " + permission);
    }

    private void CropPhoto(Texture2D screenshot)
    {
        ImageCropper.Instance.Show(screenshot, (bool result, Texture originalImage, Texture2D croppedImage) =>
        {
            if (result)
            {
                OnProfilePictureSelected.Invoke(croppedImage);
                //Sprite newSprite = Sprite.Create(croppedImage, new Rect(0, 0, croppedImage.width, croppedImage.height), new Vector2(0.5f,0.5f));				
                //eventPictureSprite.Invoke(newSprite);				
            }

            DestroyImmediate(screenshot, true);
            this.Close();
        },
            settings: new ImageCropper.Settings()
            {
                ovalSelection = ovalSelection,
                autoZoomEnabled = autoZoom,
                imageBackground = Color.black, // transparent background // Color.clear
                markTextureNonReadable = false,
                selectionMinAspectRatio = minAspectRatio,
                selectionMaxAspectRatio = maxAspectRatio
            },
            croppedImageResizePolicy: (ref int width, ref int height) =>
            {
                width /= 2;
                height /= 2;
            });
    }
    #endregion

}

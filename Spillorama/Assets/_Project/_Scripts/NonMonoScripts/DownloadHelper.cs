using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

public class DownloadHelper
{
    public static IEnumerator DownloadImage(string url, Action<Texture2D> callback)
    {
        Debug.Log($"Image URL : {url}");
        UnityWebRequest request = UnityWebRequestTexture.GetTexture(url);
        yield return request.SendWebRequest();

        if (request.isNetworkError || request.isHttpError)
        {
            Debug.LogError($"{request.error}");
        }
        else
        {
            callback(DownloadHandlerTexture.GetContent(request));
        }
    }
}

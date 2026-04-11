using System.Collections;
using TMPro;
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;
using UnityEngine.ResourceManagement.ResourceProviders;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

public class LoadingPanel : MonoBehaviour
{
    public UtilityLoaderPanel utilityLoaderPanel;

    [SerializeField] private TextMeshProUGUI txtVersion, txtVersion2;

    public AssetReference scene;

    public Slider downloadSlider;

    private void Awake()
    {
        if (txtVersion)
        {
            txtVersion.text = txtVersion2.text = GetApplicationVersionWithOS();
            txtVersion.transform.parent.transform.gameObject.SetActive(true);
        }
    }

    private void Start()
    {
        utilityLoaderPanel.ShowLoader(Constants.LanguageKey.LoadingMessage);

        Addressables.InitializeAsync().Completed += (obj) =>
        {
            Debug.Log("Initialized Addressables...");
            StartCoroutine(LoadScene());
            //Addressables.LoadSceneAsync(scene).Completed += SceneLoadCompleted;
        };
    }

    IEnumerator LoadScene()
    {
        var obj = Addressables.LoadSceneAsync(scene, LoadSceneMode.Single);


        while (!obj.IsDone)
        {
            // Calculate the downloading percentage
            float progress = obj.PercentComplete * 100f;

            // Update your UI with the downloading percentage
            UpdateDownloadProgress(progress);

            yield return null;
        }

        // Yield until the initial loading is complete
        yield return obj;



        // Check for errors or completion after the loading is complete
        if (obj.OperationException != null)
        {
            Debug.Log("Exception");
        }
        if (obj.Status == AsyncOperationStatus.Failed)
        {
            Debug.Log("Failed");
        }
        if (obj.Status == AsyncOperationStatus.Succeeded)
        {
            Debug.Log("Succeeded");
            obj.Result.ActivateAsync();
        }
        else
        {
            Debug.LogError("Failed to load scene at address: " + obj);
        }
    }

    // Add a method to update the UI with the downloading percentage
    private void UpdateDownloadProgress(float progress)
    {
        // Update your UI with the downloading percentage

        downloadSlider.value = progress / 100f;
        utilityLoaderPanel.txtLoadingMessage.text = Constants.LanguageKey.DownloadingMessage +" " + progress.ToString("F1") + "%" ;
    }

    public void OnAssetBundleClick()
    {
        //if (thisCheckAmbience.isAmbienceDownloaded)
        //{
        //utilityLoaderPanel?.gameObject.SetActive(true);
        //}
        //else
        //{
        //StartCoroutine(StartDownloadingAndCaching());
        //}
    }

    private void SceneLoadCompleted(AsyncOperationHandle<SceneInstance> obj)
    {
        Debug.Log("SceneLoadCompleted 1 : " + obj.Result);
        Debug.Log("SceneLoadCompleted 2 : " + obj.Status);
        Debug.Log("SceneLoadCompleted 3 : " + obj.ToString());
        if (obj.Status == AsyncOperationStatus.Succeeded)
        {
            Debug.Log("SceneLoadCompleted : " + obj.Result);
            //handle = obj;
        }
    }

    //Downloading ambience if not downloaded and saved in cache memory
    //private IEnumerator StartDownloadingAndCaching()
    //{
    //    bool isDone = false;

    //    AsyncOperationHandle downloadDependencies = Addressables.DownloadDependenciesAsync(scene);
    //    if (!downloadDependencies.IsDone)
    //    {
    //        thisCheckAmbience.loaderObj.SetActive(true);
    //        thisCheckAmbience.txt_DownloadSize.text = $"Downloading...";
    //    }

    //    downloadDependencies.Completed += (operation) =>
    //    {
    //        isDone = true;
    //        thisCheckAmbience.OnAmbienceDownloadComplete();
    //    };

    //    while (!isDone)
    //    {
    //        thisCheckAmbience.downloadingPercentage.SetText($"{Mathf.FloorToInt(downloadDependencies.PercentComplete * 100)}%");
    //        // Debug.LogError($"{downloadDependencies.PercentComplete}");
    //        yield return null;
    //    }
    //    thisCheckAmbience.loaderObj.SetActive(false);
    //}

    public string GetApplicationVersionWithOS()
    {
#if UNITY_EDITOR
        return "v" + Application.version + "u";
#elif UNITY_ANDROID
		return "v" + Application.version + "a";	
#elif UNITY_IOS
		return "v" + Application.version + "i";	
#else
		return "v" + Application.version;
#endif
    }
}
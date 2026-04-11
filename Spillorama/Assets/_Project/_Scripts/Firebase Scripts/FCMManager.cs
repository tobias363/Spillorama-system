using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using BestHTTP;

#if UNITY_STANDALONE_WIN
using System.IO;
using System;
using System.Collections.Concurrent;
#endif

#if UNITY_ANDROID
using UnityEngine.Android;
#endif

#if UNITY_ANDROID || UNITY_IOS
using Firebase;
using Firebase.Extensions;
using Firebase.Messaging;
#endif

public class FCMManager : MonoBehaviour
{
    public static FCMManager Instance;

    void Awake()
    {
        Instance = this;
    }

#if UNITY_STANDALONE_WIN
    private FileSystemWatcher watcher;
    private string notifPath;
    private string lastContent = "";

    // Thread-safe queue for incoming messages
    private ConcurrentQueue<(string title, string body)> notificationQueue
        = new ConcurrentQueue<(string, string)>();

    void Start()
    {
        StartWindowsWatcher();
    }

    void StartWindowsWatcher()
    {
        string folder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Spillorama"
        );
        notifPath = Path.Combine(folder, "unity_notification.txt");

        if (!Directory.Exists(folder))
            Directory.CreateDirectory(folder);

        watcher = new FileSystemWatcher
        {
            Path = folder,
            Filter = "unity_notification.txt",
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.CreationTime,
            EnableRaisingEvents = true
        };

        watcher.Changed += OnNotificationFileChanged;
        watcher.Created += OnNotificationFileChanged;

        Debug.Log("👀 Unity watching unity_notification.txt for tray notifications...");
    }

    private void OnNotificationFileChanged(object sender, FileSystemEventArgs e)
    {
        try
        {
            string content = File.ReadAllText(notifPath).Trim();
            if (!string.IsNullOrEmpty(content) && content != lastContent)
            {
                lastContent = content;

                string[] parts = content.Split('|');
                if (parts.Length >= 2)
                {
                    string title = parts[0];
                    string body = parts[1];

                    // ✅ enqueue instead of calling Unity UI directly
                    notificationQueue.Enqueue((title, body));
                }
            }
        }
        catch (Exception ex)
        {
            Debug.LogError("❌ Failed to read unity_notification.txt: " + ex.Message);
        }
    }

    void Update()
    {
        // ✅ dequeue and handle on Unity main thread
        while (notificationQueue.TryDequeue(out var notif))
        {
            HandleWindowsNotification(notif.title, notif.body);
        }
    }

    private void HandleWindowsNotification(string title, string body)
    {
        if (UIManager.Instance != null && UIManager.Instance.messagePopup != null)
        {
            UIManager.Instance.DisplayFirebaseNotificationUpperTray($"{title}\n{body}");
            Debug.Log($"📨 In-game notification: {title} | {body}");
        }
        else
        {
            Debug.LogWarning("⚠️ UIManager/messagePopup missing.");
        }
    }

    void OnDestroy()
    {
        if (watcher != null)
        {
            watcher.EnableRaisingEvents = false;
            watcher.Dispose();
            watcher = null;
        }
    }
#endif

#if UNITY_ANDROID || UNITY_IOS
    void Start()
    {
#if UNITY_ANDROID
        if (!Permission.HasUserAuthorizedPermission("android.permission.POST_NOTIFICATIONS"))
        {
            Permission.RequestUserPermission("android.permission.POST_NOTIFICATIONS");
        }
#endif
        // #if UNITY_IOS
        //         var authOptions = Unity.Notifications.iOS.AuthorizationOption.Alert | Unity.Notifications.iOS.AuthorizationOption.Badge | Unity.Notifications.iOS.AuthorizationOption.Sound;
        //         Unity.Notifications.iOS.iOSNotificationCenter.RequestAuthorization(authOptions, granted =>
        //         {
        //             Debug.Log("iOS Notification permission granted: " + granted);
        //         });
        // #endif

        FirebaseApp.CheckAndFixDependenciesAsync().ContinueWithOnMainThread(task =>
        {
            if (task.Result == DependencyStatus.Available)
            {
                Debug.Log("Firebase is ready!");

                FirebaseMessaging.TokenReceived += OnTokenReceived;
                FirebaseMessaging.MessageReceived += OnMessageReceived;

                FirebaseMessaging.GetTokenAsync().ContinueWithOnMainThread(tokenTask =>
                {
                    if (tokenTask.IsCompleted && !tokenTask.IsFaulted)
                    {
                        string token = tokenTask.Result;
                        Debug.Log("FCM Token (manual fetch): " + token);
                        FirebaseMessaging.MessageReceived += OnMessageReceived;
                        // CopyToClipboard(token);
                    }
                });
            }
            else
            {
                Debug.LogError("Firebase dependencies unavailable: " + task.Result);
            }
        });
    }

    void OnTokenReceived(object sender, TokenReceivedEventArgs token)
    {
        Debug.Log("Received FCM Token: " + token.Token);
        UpdateFirebaseToken(token.Token);
        UIManager.Instance.gameAssetData.playerGameData.firebaseToken = token.Token;
        // CopyToClipboard(token.Token);
    }

    bool isAppInForeground;
    private void OnApplicationPause(bool pauseStatus)
    {
        isAppInForeground = !pauseStatus;
        if (pauseStatus)
        {
            Debug.Log("App is in background.");
        }
        else
        {
            Debug.Log("App is in foreground.");
        }
    }

    void OnMessageReceived(object sender, MessageReceivedEventArgs e)
    {
        Debug.Log("FCM Message Received");

        // Always try to get title/body from data first, fallback to notification
        string title = "";
        string body = "";

        if (e.Message.Data != null)
        {
            if (e.Message.Data.ContainsKey("title"))
                title = e.Message.Data["title"];
            if (e.Message.Data.ContainsKey("body"))
                body = e.Message.Data["body"];
        }

        if (string.IsNullOrEmpty(title) && e.Message.Notification != null)
            title = e.Message.Notification.Title;
        if (string.IsNullOrEmpty(body) && e.Message.Notification != null)
            body = e.Message.Notification.Body;

        Debug.Log($"[FCM] Title: {title} | Body: {body}");

        if (isAppInForeground)
        {
            if (!string.IsNullOrEmpty(title) && !string.IsNullOrEmpty(body))
            {
#if UNITY_ANDROID || UNITY_IOS
                UIManager.Instance.DisplayFirebaseNotificationUpperTray($"{title}\n{body}");
#endif
            }
            else
            {
                Debug.Log("Title or body is empty.");
            }
        }
        else
        {
            Debug.Log("App is not in foreground.");
            //             try
            //             {
            // #if UNITY_ANDROID
            //             Debug.Log("Android Notification");
            //             var notif = new Unity.Notifications.Android.AndroidNotification
            //             {
            //                 Title = title,
            //                 Text = body,
            //                 FireTime = DateTime.Now
            //             };
            //             Debug.Log("Android Notification: " + notif.Title + " " + notif.Text);
            //             Unity.Notifications.Android.AndroidNotificationCenter.SendNotification(notif, "default_channel");
            // #endif

            // #if UNITY_IOS
            //                 Debug.Log("iOS Notification");
            //                 var timeTrigger = new Unity.Notifications.iOS.iOSNotificationTimeIntervalTrigger
            //                 {
            //                     TimeInterval = new TimeSpan(0, 0, 1),
            //                     Repeats = false
            //                 };

            //                 var notification = new Unity.Notifications.iOS.iOSNotification
            //                 {
            //                     Identifier = Guid.NewGuid().ToString(),
            //                     Title = title,
            //                     Body = body,
            //                     ShowInForeground = false,
            //                     ForegroundPresentationOption = Unity.Notifications.iOS.PresentationOption.None,
            //                     Trigger = null
            //                 };

            //                 Debug.Log("iOS Notification: " + notification.Title + " " + notification.Body);
            //                 Unity.Notifications.iOS.iOSNotificationCenter.ScheduleNotification(notification);
            // #endif
            //             }
            //             catch (Exception ex)
            //             {
            //                 Debug.LogError("FCM Message parse error: " + ex.Message);
            //             }
        }

        // // Show in-game popup (replace with your popup logic)
        // if (UIManager.Instance != null && UIManager.Instance.messagePopup != null)
        // {
        //     if (!string.IsNullOrEmpty(title) && !string.IsNullOrEmpty(body))
        //     {
        //         UIManager.Instance.DisplayFirebaseNotificationUpperTray($"{title}\n{body}");
        //     }
        //     else
        //     {
        //         Debug.LogWarning("Title or body is empty.");
        //     }
        // }
        // else
        // {
        //     Debug.LogWarning("UIManager or messagePopup not set.");
        // }
    }
#endif

    // void Update()
    // {
    //     if (Input.GetKeyDown(KeyCode.U))
    //     {
    //         UpdateFirebaseToken("FCM-dummy");
    //     }
    // }

    void CopyToClipboard(string text)
    {
        GUIUtility.systemCopyBuffer = text;
        Debug.Log("Copied to clipboard: " + text);
    }

    public void UpdateFirebaseToken(string token)
    {
        if (UIManager.Instance.gameAssetData.PlayerId != "" && string.IsNullOrEmpty(UIManager.Instance.gameAssetData.playerGameData.firebaseToken))
        {
            EventManager.Instance.UpdateFirebaseToken(token, (socket, packet, args) =>
            {
                //Debug.Log("Server response: " + packet.ToString());
            });
        }
    }

    void HandleMessage(IDictionary<string, string> data)
    {
        if (data.ContainsKey("message"))
        {
            UIManager.Instance.messagePopup.DisplayMessagePopup(data["message"]);
        }
    }

#if UNITY_WEBGL
    bool isAppInForeground;
    private void OnApplicationPause(bool pauseStatus)
    {
        isAppInForeground = !pauseStatus;
        if (pauseStatus)
        {
            Debug.Log("App is in background.");
        }
        else
        {
            Debug.Log("App is in foreground.");
        }
    }

    public void OnWebTokenReceived(string token)
    {
        Debug.Log("Web FCM Token: " + token);
        // UpdateFirebaseToken(token);
        UIManager.Instance.gameAssetData.playerGameData.firebaseToken = token;
    }

    public void OnWebMessageReceived(string payloadJson)
    {
        Debug.Log("Web FCM Message: " + payloadJson);
        try
        {
            var message = JsonUtility.FromJson<PushPayload>(payloadJson);
            if (message?.notification != null)
            {
                // Application.ExternalCall("ShowBrowserNotification", message.notification.title, message.notification.body);
                Debug.Log("Web FCM Message: " + message.notification.title + " " + message.notification.body);
            }
        }
        catch (Exception ex)
        {
            Debug.LogError("Error parsing WebGL FCM message: " + ex.Message);
        }
    }

    [Serializable]
    public class PushPayload
    {
        public Notification notification;
    }

    [Serializable]
    public class Notification
    {
        public string title;
        public string body;
    }
#endif
}

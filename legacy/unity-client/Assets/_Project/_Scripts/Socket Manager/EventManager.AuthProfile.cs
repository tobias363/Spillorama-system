using System;
using System.Collections;
using System.Collections.Generic;
using BestHTTP.JSON;
using BestHTTP.SocketIO;
using BestHTTP.SocketIO.Events;
using UnityEngine;
using UnityEngine.Networking;

public partial class EventManager
{
    public void RefreshAuthToken(string refreshToken, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("refreshToken", refreshToken);
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);
        GameSocketManager.socketManager.Socket.Emit("RefreshAccessToken", action, Json.Decode(jsonObj.toString()));
    }

    public void Login(bool forceLoin, string emailUsername, string password, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("forceLoin", forceLoin);
        jsonObj.put("name", emailUsername);
        jsonObj.put("password", password);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);
        jsonObj.put("firebaseToken", UIManager.Instance.gameAssetData.playerGameData.firebaseToken);

        Debug.Log("Login Event: " + jsonObj.toString());
        GameSocketManager.socketManager.Socket.Emit("LoginPlayer", action, Json.Decode(jsonObj.toString()));
    }

    public void LoginWithUniqueId(bool forceLoin, string id, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("forceLogin", forceLoin);
        jsonObj.put("id", id);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);

        Debug.Log("LoginWithUniqueId Event: " + jsonObj.toString());
        GameSocketManager.socketManager.Socket.Emit("LoginWithUniqueId", action, Json.Decode(jsonObj.toString()));
    }

    public void LoginPlayer(bool forceLogin, string emailUsername, string password, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("forceLogin", forceLogin);
        jsonObj.put("name", emailUsername);
        jsonObj.put("password", password);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);
#if UNITY_STANDALONE_WIN
        jsonObj.put("firebaseToken", "windowsTrayApp");
#else
        jsonObj.put("firebaseToken", UIManager.Instance.gameAssetData.playerGameData.firebaseToken);
#endif
        jsonObj.put("language", Utility.Instance.CurrentLanguage);

        Debug.Log("New Login Event: " + jsonObj.toString());
        GameSocketManager.socketManager.Socket.Emit("LoginPlayer", action, Json.Decode(jsonObj.toString()));
    }

    public void GetPlayerDetails(string playerID, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", playerID);
        GameSocketManager.socketManager.Socket.Emit("PlayerDetails", action, Json.Decode(jsonObj.toString()));
    }

    public void VerifyByBankId(string playerID, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", playerID);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);

        Debug.Log("VerifyByBankId : " + jsonObj.toString());
        GameSocketManager.socketManager.Socket.Emit("verifyByBankId", action, Json.Decode(jsonObj.toString()));
    }

    public void AdminHallDisplayLogin(Socket adminSocket, string roomId, string hallId, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("roomId", roomId);
        jsonObj.put("hallId", hallId);

        Debug.Log("AdminHallDisplayLogin Event: " + jsonObj.toString());
        adminSocket.Emit("AdminHallDisplayLogin", action, Json.Decode(jsonObj.toString()));
    }

    public void Signup(string username, string bankId, string email, string mobileNumber, string nickname, string dateOfBirth, string password, List<HallData> hallList, SocketIOAckCallback action, Texture2D front, Texture2D back)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("username", username);
        jsonObj.put("email", email);
        jsonObj.put("phone", mobileNumber);
        jsonObj.put("nickname", nickname);
        jsonObj.put("dob", dateOfBirth);
        jsonObj.put("password", password);
        jsonObj.put("bankId", bankId);
        jsonObj.put("hall", JsonUtility.ToJson(new ListJsonT<HallData>(hallList)));
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);

        string frontPhotoString = "";
        if (front != null)
            frontPhotoString = GetBase64String(front);
        jsonObj.put("photoFront", frontPhotoString);

        string backPhotoString = "";
        if (back != null)
            backPhotoString = GetBase64String(back);
        jsonObj.put("photoBack", backPhotoString);
        Debug.Log("RegisterPlayer Event: " + jsonObj.toString());
        GameSocketManager.socketManager.Socket.Emit("RegisterPlayer", action, Json.Decode(jsonObj.toString()));
    }

    internal IEnumerator ImageUpload(Texture2D front, Texture2D back, string front_Img_Path, string back_Img_Path, string front_Img_Name, string back_Img_Name)
    {
        WWWForm form = new WWWForm();
        form.AddField("appVersion", Utility.Instance.AppVersion);
        form.AddField("deviceId", Utility.Instance.DeviceId);
        form.AddField("os", Utility.Instance.OSname);
        form.AddField("language", Utility.Instance.CurrentLanguage);

        string frontPhotoString = "";
        if (front != null)
            frontPhotoString = GetBase64String(front);
        form.AddField("photoFront", frontPhotoString);

        string backPhotoString = "";
        if (back != null)
            backPhotoString = GetBase64String(back);
        form.AddField("photoBack", backPhotoString);

        Debug.Log("ImageUpload API:");

        using (UnityWebRequest www = UnityWebRequest.Post($"{Constants.ServerDetails.BaseUrl}/player/profile/image/update ", form))
        {
            www.SetRequestHeader("Authorization", $"Bearer {UIManager.Instance.gameAssetData.playerGameData.authToken}");
            yield return www.SendWebRequest();

            if (www.result != UnityWebRequest.Result.Success)
            {
                Debug.Log(www.error);
                UIManager.Instance.profilePanel.ImageUpload_API_Response(www.downloadHandler.text);
            }
            else
            {
                Debug.Log($"ImageUpload response : {www.downloadHandler.text}");
                UIManager.Instance.profilePanel.ImageUpload_API_Response(www.downloadHandler.text);
            }
        }
    }

    internal IEnumerator SignUp_API(
        string username,
        string surname,
        string bankId,
        string email,
        string mobileNumber,
        string nickname,
        string dateOfBirth,
        string password,
        List<HallData> hallList,
        Texture2D front,
        Texture2D back,
        string front_Img_Path,
        string back_Img_Path,
        string front_Img_Name,
        string back_Img_Name,
        bool isPEP,
        bool residentialAddressInNorway,
        string pepName,
        string pepRelationship,
        string pepDateOfBirth,
        bool salary,
        bool propertySaleOrLease,
        bool stocks,
        bool socialSupport,
        bool giftsOrInheritance,
        bool other,
        bool isResidentialAddressInNorway,
        string cityName,
        string zipCode,
        string address,
        string country,
        bool playBySalary,
        bool playByPropertySaleOrLease,
        bool playByStocks,
        bool playBySocialSupport,
        bool playByGiftsOrInheritance,
        bool playByOther
    )
    {
        WWWForm form = new WWWForm();
        form.AddField("username", username);
        form.AddField("surname", surname);
        form.AddField("email", email);
        form.AddField("phone", mobileNumber);
        form.AddField("nickname", nickname);
        form.AddField("dob", dateOfBirth);
        form.AddField("password", password);
        form.AddField("bankId", bankId);
        form.AddField("hall", JsonUtility.ToJson(new ListJsonT<HallData>(hallList)));
        form.AddField("appVersion", Utility.Instance.AppVersion);
        form.AddField("deviceId", Utility.Instance.DeviceId);
        form.AddField("os", Utility.Instance.OSname);
        form.AddField("language", Utility.Instance.CurrentLanguage);
        form.AddField("isPEP", isPEP.ToString().ToLower());
        form.AddField("residentialAddressInNorway", residentialAddressInNorway.ToString().ToLower());
        form.AddField("pepName", pepName);
        form.AddField("pepRelationship", pepRelationship);
        form.AddField("pepDateOfBirth", pepDateOfBirth);
        form.AddField("salary", salary.ToString().ToLower());
        form.AddField("propertySaleOrLease", propertySaleOrLease.ToString().ToLower());
        form.AddField("stocks", stocks.ToString().ToLower());
        form.AddField("socialSupport", socialSupport.ToString().ToLower());
        form.AddField("giftsOrInheritance", giftsOrInheritance.ToString().ToLower());
        form.AddField("other", other.ToString().ToLower());
        form.AddField("isResidentialAddressInNorway", isResidentialAddressInNorway.ToString().ToLower());
        form.AddField("city", cityName);
        form.AddField("zipCode", zipCode);
        form.AddField("address", address);
        form.AddField("country", country);
        form.AddField("playBySalary", playBySalary.ToString().ToLower());
        form.AddField("playByPropertySaleOrLease", playByPropertySaleOrLease.ToString().ToLower());
        form.AddField("playByStocks", playByStocks.ToString().ToLower());
        form.AddField("playBySocialSupport", playBySocialSupport.ToString().ToLower());
        form.AddField("playByGiftsOrInheritance", playByGiftsOrInheritance.ToString().ToLower());
        form.AddField("playByOther", playByOther.ToString().ToLower());

        Debug.Log(
            $"SignUp API - All Fields: username={username}, surname={surname}, email={email}, phone={mobileNumber}, nickname={nickname}, dob={dateOfBirth}, password={password}, bankId={bankId}, hall={JsonUtility.ToJson(new ListJsonT<HallData>(hallList))}, appVersion={Utility.Instance.AppVersion}, deviceId={Utility.Instance.DeviceId}, os={Utility.Instance.OSname}, language={Utility.Instance.CurrentLanguage}, isPEP={isPEP}, residentialAddressInNorway={residentialAddressInNorway}, pepName={pepName}, pepRelationship={pepRelationship}, pepDateOfBirth={pepDateOfBirth}, salary={salary}, propertySaleOrLease={propertySaleOrLease}, stocks={stocks}, socialSupport={socialSupport}, giftsOrInheritance={giftsOrInheritance}, other={other}, isResidentofNorway={isResidentialAddressInNorway}, city={cityName}, zipCode={zipCode}, address={address}, country={country}, playBySalary={playBySalary}, playByPropertySaleOrLease={playByPropertySaleOrLease}, playByStocks={playByStocks}, playBySocialSupport={playBySocialSupport}, playByGiftsOrInheritance={playByGiftsOrInheritance}, playByOther={playByOther}"
        );

        string frontPhotoString = "";
        if (front != null)
            frontPhotoString = GetBase64String(front);
        form.AddField("photoFront", frontPhotoString);

        string backPhotoString = "";
        if (back != null)
            backPhotoString = GetBase64String(back);
        form.AddField("photoBack", backPhotoString);

        Debug.Log("RegisterPlayer API:");

        using (UnityWebRequest www = UnityWebRequest.Post($"{Constants.ServerDetails.BaseUrl}/player/register", form))
        {
            yield return www.SendWebRequest();

            if (www.result != UnityWebRequest.Result.Success)
            {
                Debug.Log(www.error);
                UIManager.Instance.signupPanel.Signup_API_Response(www.downloadHandler.text);
            }
            else
            {
                Debug.Log($"Sign up response : {www.downloadHandler.text}");
                Debug.Log($"Sign up response : {pepDateOfBirth}");
                UIManager.Instance.signupPanel.Signup_API_Response(www.downloadHandler.text);
            }
        }
    }

    public void PlayerForgetPassword(string emailUsername, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("email", emailUsername);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);

        Debug.Log("Forget Password Event: " + jsonObj.toString());
        GameSocketManager.socketManager.Socket.Emit("playerForgotPassword", action, Json.Decode(jsonObj.toString()));
    }

    public void UpdateFirebaseToken(string firebaseToken, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("firebaseToken", firebaseToken);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);

        GameSocketManager.socketManager.Socket.Emit("UpdateFirebaseToken", action, Json.Decode(jsonObj.toString()));
    }

    public void PlayerChangePassword(string oldPassword, string newPassword, string verifyNewPassword, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("oldPassword", oldPassword);
        json.put("newPassword", newPassword);
        json.put("verifyNewPassword", verifyNewPassword);
        json.put("deviceId", Utility.Instance.DeviceId);
        json.put("os", Utility.Instance.OSname);

        Debug.Log($"playerChangePassword: {json.toString()}");
        GameSocketManager.socketManager.Socket.Emit("playerChangePassword", action, Json.Decode(json.toString()));
    }

    public void PlayerProfile(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log($"PlayerProfile: {json.toString()}");
        GameSocketManager.socketManager.Socket.Emit("Playerprofile", action, Json.Decode(json.toString()));
    }

    public void GetApprovedHallList(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log($"GetApprovedHallList: {json.toString()}");
        GameSocketManager.socketManager.Socket.Emit("GetApprovedHallList", action, Json.Decode(json.toString()));
    }

    public void DeletePlayerAccount(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log($"DeletePlayerAccount  : {json.toString()}");
        GameSocketManager.socketManager.Socket.Emit("DeletePlayerAccount", action, Json.Decode(json.toString()));
    }

    public void Logout(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log($"Logout: {json.toString()}");
        GameSocketManager.socketManager.Socket.Emit("Logout", action, Json.Decode(json.toString()));
    }

    public void UpdateProfile(string userName, string surname, string nickname, string mobile, string email, string bankId, Texture2D imageBase64, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("username", userName);
        json.put("surname", surname);
        json.put("nickname", nickname);
        json.put("phone", mobile);
        json.put("email", email);
        json.put("bankId", bankId);

        string profilePic = "";
        if (imageBase64 != null)
        {
            profilePic = GetBase64String(imageBase64);
            json.put("profilePic", profilePic);
        }

        Debug.Log($"UpdateProfile: {json.toString()}");
        GameSocketManager.socketManager.Socket.Emit("UpdateProfile", action, Json.Decode(json.toString()));
    }

    public void VerifyPassword(string pass, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("password", pass);
        json.put("appVersion", Utility.Instance.AppVersion);
        json.put("deviceId", Utility.Instance.DeviceId);
        json.put("os", Utility.Instance.OSname);
        Debug.Log($"password: {json.toString()}");
        GameSocketManager.socketManager.Socket.Emit("VerifyPassword", action, Json.Decode(json.toString()));
    }

    private string GetBase64String(Texture2D texture)
    {
        byte[] bytes = texture.EncodeToPNG();
        string s = Convert.ToBase64String(bytes);
        return $"{s}";
    }
}

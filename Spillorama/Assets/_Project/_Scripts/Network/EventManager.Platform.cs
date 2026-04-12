using BestHTTP.JSON;
using BestHTTP.SocketIO;
using BestHTTP.SocketIO.Events;
using UnityEngine;

public partial class EventManager
{
    public void SwitchHall(string hallId, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("hallId", hallId);
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);

        Debug.Log("SwitchHall Event: " + jsonObj.toString());
        AisSocket?.Emit("SwitchHall", action, Json.Decode(jsonObj.toString()));
    }

    public void PlayerHallLimit(SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);

        Debug.Log("PlayerHallLimit Event: " + jsonObj.toString());
        AisSocket?.Emit("PlayerHallLimit", action, Json.Decode(jsonObj.toString()));
    }

    public void StopGameByPlayers(SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);

        Debug.Log("StopGameByPlayers : " + jsonObj.toString());
        GameSocketManager.SocketGame1.Emit("StopGameByPlayers", action, Json.Decode(jsonObj.toString()));
    }

    public void TvscreenUrlForPlayers(SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("deviceType", Utility.Instance.OSname);

        Debug.Log("TvscreenUrlForPlayers : " + jsonObj.toString());
        GameSocketManager.SocketGame1.Emit("TvscreenUrlForPlayers", action, Json.Decode(jsonObj.toString()));
    }

    public void DepositMoney(double amount, string setOperation, string userAgentData, SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        json.put("amount", amount);
        json.put("operation", setOperation);
        json.put("appVersion", Utility.Instance.AppVersion);
        json.put("deviceId", Utility.Instance.DeviceId);
        json.put("os", Utility.Instance.OSname);
        json.put("userAgentData", userAgentData);
        Debug.Log($"DepositMoney: {json.toString()}");
        AisSocket?.Emit("DepositMoney", action, Json.Decode(json.toString()));
    }

    public void DepositMoney(bool saveCard, string cardHolderName, string cardNumber, string cardExpiry, string cvv, double amount, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("saveCard", saveCard);
        jsonObj.put("cardHolderName", cardHolderName);
        jsonObj.put("cardNumber", cardNumber);
        jsonObj.put("cardExpiry", cardExpiry);
        jsonObj.put("cvv", cvv);
        jsonObj.put("amount", amount);

        Debug.Log("DepositMoney Event: " + jsonObj.toString());
        AisSocket?.Emit("DepositMoney", action, Json.Decode(jsonObj.toString()));
    }

    public void WithdrawMoney(double amount, string withdrawType, string password, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("amount", amount);
        jsonObj.put("withdrawType", withdrawType);
        jsonObj.put("password", password);

        Debug.Log("WithdrawMoney Event: " + jsonObj.toString());
        AisSocket?.Emit("WithdrawMoney", action, Json.Decode(jsonObj.toString()));
    }

    public void TransactionHistory(SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log("TransactionHistory Event: " + jsonObj.toString());
        AisSocket?.Emit("TransactionHistory", action, Json.Decode(jsonObj.toString()));
    }

    public void EnableNotification(bool enableNotification, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("flag", enableNotification);

        Debug.Log("EnableNotification Event: " + jsonObj.toString());
        AisSocket?.Emit("EnableNotification", action, Json.Decode(jsonObj.toString()));
    }

    public void updatePlayerLanguage(SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.UpdateLanguage);

        Debug.Log("updatePlayerLanguage Event: " + jsonObj.toString());
        AisSocket?.Emit("updatePlayerLanguage", action, Json.Decode(jsonObj.toString()));
    }

    public void SetLimit(long limit, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("limit", limit);

        Debug.Log("SetLimit Event: " + jsonObj.toString());
        AisSocket?.Emit("SetLimit", action, Json.Decode(jsonObj.toString()));
    }

    public void BlockMySelf(int days, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("days", days);

        Debug.Log("BlockMySelf Event: " + jsonObj.toString());
        AisSocket?.Emit("BlockMySelf", action, Json.Decode(jsonObj.toString()));
    }

    public void VoucherList(SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log("VoucherList Event: " + jsonObj.toString());
        AisSocket?.Emit("VoucherList", action, Json.Decode(jsonObj.toString()));
    }

    public void RedeemVoucher(string voucherId, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("voucherId", voucherId);

        Debug.Log("RedeemVoucher Event: " + jsonObj.toString());
        AisSocket?.Emit("RedeemVoucher", action, Json.Decode(jsonObj.toString()));
    }

    public void HallList(SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", "");
        AisSocket?.Emit("HallList", action, Json.Decode(jsonObj.toString()));
    }

    public void GetScreenSaverDetails(SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", "");
        AisSocket?.Emit("ScreenSaver", action, Json.Decode(jsonObj.toString()));
    }

    public void GameStatistics(SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log("GameStatistics Event: " + jsonObj.toString());
        AisSocket?.Emit("GameStatistics", action, Json.Decode(jsonObj.toString()));
    }

    public void MyWinnings(string filter_by, string date, string game_type, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("filter_by", filter_by);
        jsonObj.put("date", date);
        jsonObj.put("game_type", game_type);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log("MyWinnings Event: " + jsonObj.toString());
        AisSocket?.Emit("myWinnings", action, Json.Decode(jsonObj.toString()));
    }

    public void LastHourLossProfit(SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log("LastHourLossProfit Event: " + jsonObj.toString());
        AisSocket?.Emit("lastHourLossProfit", action, Json.Decode(jsonObj.toString()));
    }

    public void CheckPlayerBreakTime(string gameType, SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("gameType", gameType);

        Debug.Log("CheckPlayerBreakTime Event: " + jsonObj.toString());
        AisSocket?.Emit("CheckPlayerBreakTime", action, Json.Decode(jsonObj.toString()));
    }

    public void PlayerNotifications(SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log("playerNotifications Event: " + jsonObj.toString());
        AisSocket?.Emit("PlayerNotifications", action, Json.Decode(jsonObj.toString()));
    }

    public void Leaderboard(SocketIOAckCallback action)
    {
        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log("Leaderboard Event: " + jsonObj.toString());
        AisSocket?.Emit("Leaderboard", action, Json.Decode(jsonObj.toString()));
    }

    public void FAQ(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("slug", "faq");
        Debug.Log($"FAQ: {json.toString()}");
        AisSocket?.Emit("FAQ", action, Json.Decode(json.toString()));
    }

    public void Terms(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("slug", "terms_and_condition");
        Debug.Log($"Terms: {json.toString()}");
        AisSocket?.Emit("Terms", action, Json.Decode(json.toString()));
    }

    public void Aboutus(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("slug", "about_us");
        Debug.Log($"Aboutus: {json.toString()}");
        AisSocket?.Emit("Aboutus", action, Json.Decode(json.toString()));
    }

    public void ResponsibleGameing(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("slug", "responsible_gameing");
        Debug.Log($"ResponsibleGameing: {json.toString()}");
        AisSocket?.Emit("ResponsibleGameing", action, Json.Decode(json.toString()));
    }

    public void Links(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("slug", "links");
        Debug.Log($"Links: {json.toString()}");
        AisSocket?.Emit("Links", action, Json.Decode(json.toString()));
    }

    public void Support(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        json.put("slug", "support");
        Debug.Log($"Support: {json.toString()}");
        AisSocket?.Emit("Support", action, Json.Decode(json.toString()));
    }

    public void Home(SocketIOAckCallback action)
    {
        JSON_Object json = new JSON_Object();
        Debug.Log($"Home: {json.toString()}");
        AisSocket?.Emit("Home", action, Json.Decode(json.toString()));
    }

    public void PlayerUpdateInterval(SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        AisSocket?.Emit("PlayerUpdateInterval", action, Json.Decode(jsonObject.toString()));
    }

    public void ReconnectPlayer(SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("deviceId", Utility.Instance.DeviceId);
        jsonObject.put("os", Utility.Instance.OSname);
        jsonObject.put("firebaseToken", UIManager.Instance.gameAssetData.playerGameData.firebaseToken);
        AisSocket?.Emit("ReconnectPlayer", action, Json.Decode(jsonObject.toString()));
    }

    internal void AvailableGames(SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObject.put("hallId", UIManager.Instance.Player_Hall_ID);
        Debug.Log("AvailableGames: " + jsonObject.toString());
        AisSocket?.Emit("AvailableGames", action, Json.Decode(jsonObject.toString()));
    }

    internal void Game1Status(SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("playerId", UIManager.Instance.gameAssetData.PlayerId);

        Debug.Log("Game1Status: " + jsonObject.toString());
        AisSocket?.Emit("Game1Status", action, Json.Decode(jsonObject.toString()));
    }

    internal void IsHallClosed(SocketIOAckCallback action)
    {
        JSON_Object jsonObject = new JSON_Object();
        jsonObject.put("hallId", UIManager.Instance.gameAssetData.playerCredentials.hallId);

        Debug.Log("IsHallClosed: " + jsonObject.toString());
        AisSocket?.Emit("IsHallClosed", action, Json.Decode(jsonObject.toString()));
    }

    public void PlayerSettings(SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);

        Debug.Log("PlayerSettings Event: " + jsonObj.toString());
        AisSocket?.Emit("PlayerSettings", action, Json.Decode(jsonObj.toString()));
    }

    public void PlayerSoundAndVoiceSettings(string settingType, int settingValue, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("settingType", settingType);
        jsonObj.put("settingValue", settingValue);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);
        jsonObj.put("deviceId", Utility.Instance.DeviceId);
        jsonObj.put("os", Utility.Instance.OSname);

        Debug.Log("PlayerSoundAndVoiceSettings Event: " + jsonObj.toString());
        AisSocket?.Emit("PlayerSoundAndVoiceSettings", action, Json.Decode(jsonObj.toString()));
    }

    public void AddOrUpdateBlockRule(string newRules, SocketIOAckCallback action)
    {
        if (!HasInternetConnection)
            return;

        JSON_Object jsonObj = new JSON_Object();
        jsonObj.put("playerId", UIManager.Instance.gameAssetData.PlayerId);
        jsonObj.put("newRules", newRules);
        jsonObj.put("language", Utility.Instance.CurrentLanguage);
        jsonObj.put("appVersion", Utility.Instance.AppVersion);

        Debug.Log("AddOrUpdateBlockRule Event: " + jsonObj.toString());
        AisSocket?.Emit("AddOrUpdateBlockRule", action, Json.Decode(jsonObj.toString()));
    }
}

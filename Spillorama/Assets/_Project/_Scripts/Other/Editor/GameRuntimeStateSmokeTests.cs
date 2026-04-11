using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using TMPro;

public static class GameRuntimeStateSmokeTests
{
    private const string ScenePath = "Assets/_Project/_Scenes/Game.unity";
    private const BindingFlags Flags =
        BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

    public static void RunGameRuntimeStateSmokeTest()
    {
        try
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            if (!scene.IsValid() || !scene.isLoaded)
                throw new Exception($"Could not open scene: {ScenePath}");

            var uiManager = UnityEngine.Object.FindFirstObjectByType<UIManager>(FindObjectsInactive.Include);
            if (uiManager == null)
                throw new Exception("UIManager component not found in Game scene.");

            InitializeSingletons(uiManager);

            ValidateGame4State(uiManager);
            ValidateGame5State(uiManager);

            Debug.Log("[GameRuntimeStateSmoke] PASS");
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Debug.LogError("[GameRuntimeStateSmoke] FAIL " + ex);
            EditorApplication.Exit(1);
        }
    }

    private static void ValidateGame4State(UIManager uiManager)
    {
        var panel = uiManager.game4Panel.game4GamePlayPanel;
        uiManager.game4Panel.OpenPanel();

        SetPrivateField(
            panel,
            "game4Data",
            new Game4Data
            {
                betData = new BetData
                {
                    ticket1Multiplier = new List<int> { 1, 2 },
                    ticket2Multiplier = new List<int> { 1, 2 },
                    ticket3Multiplier = new List<int> { 1, 2 },
                    ticket4Multiplier = new List<int> { 1, 2 }
                },
                ticketPrice = 10
            }
        );
        SetPrivateField(panel, "ticketPrice", 10);
        SetPrivateField(panel, "isGameRunningStatus", false);
        SetPrivateField(panel, "ticketList", new List<PrefabBingoGame4Ticket5x3>());

        var btnPlay = GetPrivateField<Button>(panel, "btnPlay");
        var btnDecreaseBet = GetPrivateField<Button>(panel, "btnDecreaseBet");
        var btnIncreaseBet = GetPrivateField<Button>(panel, "btnIncreaseBet");
        var highlight = GetPrivateField<Image>(panel, "imgSelectTicketHighlight");

        panel.TicketCount = 1;
        Require(panel.BetValue == 10, "Game4 BetValue should reflect ticket count * ticket price * multiplier.");
        Require(btnPlay.interactable, "Game4 play button should be interactable when one ticket is selected.");

        panel.OnTicketButtonTap();
        Require(panel.IsTicketOptionEnable, "Game4 ticket option mode should toggle on.");
        Require(!btnPlay.gameObject.activeSelf, "Game4 play button should hide while ticket option mode is active.");
        Require(highlight.gameObject.activeSelf, "Game4 ticket highlight should be visible in ticket option mode.");

        panel.OnTicketButtonTap();
        Require(!panel.IsTicketOptionEnable, "Game4 ticket option mode should toggle off.");
        Require(btnPlay.gameObject.activeSelf, "Game4 play button should return when ticket option mode closes.");

        panel.IsGamePlayInProcess = true;
        Require(!btnPlay.interactable, "Game4 play button should disable while gameplay is in process.");
        Require(!btnDecreaseBet.gameObject.activeSelf, "Game4 decrease bet button should hide while gameplay is in process.");
        Require(!btnIncreaseBet.gameObject.activeSelf, "Game4 increase bet button should hide while gameplay is in process.");

        panel.IsGamePlayInProcess = false;
        Require(btnDecreaseBet.gameObject.activeSelf, "Game4 decrease bet button should restore after gameplay process ends.");
        Require(btnIncreaseBet.gameObject.activeSelf, "Game4 increase bet button should restore after gameplay process ends.");
    }

    private static void ValidateGame5State(UIManager uiManager)
    {
        var panel = uiManager.game5Panel.game5GamePlayPanel;
        uiManager.game5Panel.OpenPanel();

        var btnPlay = GetPrivateField<Button>(panel, "btnPlay");
        var txtLastWithdrawNumber = GetPrivateField<TextMeshProUGUI>(panel, "txtLastWithdrawNumber");

        panel.IsGamePlayInProcess = true;
        Require(!btnPlay.interactable, "Game5 play button should disable while gameplay is in process.");
        Require(panel.roulateSpinner.IsRotating, "Game5 roulette spinner should rotate while gameplay is in process.");

        panel.IsGamePlayInProcess = false;
        Require(btnPlay.interactable, "Game5 play button should restore when gameplay is not in process.");
        Require(!panel.roulateSpinner.IsRotating, "Game5 roulette spinner should stop when gameplay is not in process.");

        panel.LastWithdrawNumber = 17;
        Require(txtLastWithdrawNumber.text == "17", "Game5 last withdraw number should update UI text.");
    }

    private static T GetPrivateField<T>(object target, string fieldName)
    {
        var field = target.GetType().GetField(fieldName, Flags);
        if (field == null)
            throw new Exception($"Field {target.GetType().Name}.{fieldName} not found.");

        return (T)field.GetValue(target);
    }

    private static void SetPrivateField(object target, string fieldName, object value)
    {
        var field = target.GetType().GetField(fieldName, Flags);
        if (field == null)
            throw new Exception($"Field {target.GetType().Name}.{fieldName} not found.");

        field.SetValue(target, value);
    }

    private static void Require(bool condition, string message)
    {
        if (!condition)
            throw new Exception(message);
    }

    private static void InitializeSingletons(UIManager uiManager)
    {
        UIManager.Instance = uiManager;

        var utility = UnityEngine.Object.FindFirstObjectByType<Utility>(FindObjectsInactive.Include);
        if (utility != null)
            Utility.Instance = utility;

        var soundManager = UnityEngine.Object.FindFirstObjectByType<SoundManager>(FindObjectsInactive.Include);
        if (soundManager != null)
            SoundManager.Instance = soundManager;

        var gameSocketManager = UnityEngine.Object.FindFirstObjectByType<GameSocketManager>(FindObjectsInactive.Include);
        if (gameSocketManager != null)
            GameSocketManager.Instance = gameSocketManager;

        var eventManager = UnityEngine.Object.FindFirstObjectByType<EventManager>(FindObjectsInactive.Include);
        if (eventManager != null)
            EventManager.Instance = eventManager;
    }
}

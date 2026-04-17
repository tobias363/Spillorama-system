using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class GameInteractionContractSmokeTests
{
    private const string ScenePath = "Assets/_Project/_Scenes/Game.unity";
    private const BindingFlags Flags =
        BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

    public static void RunGameInteractionContractSmokeTest()
    {
        try
        {
            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new Exception($"Could not open scene: {ScenePath}");
            }

            var uiManager = UnityEngine.Object.FindFirstObjectByType<UIManager>(FindObjectsInactive.Include);
            if (uiManager == null)
            {
                throw new Exception("UIManager component not found in Game scene.");
            }

            var eventManager = UnityEngine.Object.FindFirstObjectByType<EventManager>(FindObjectsInactive.Include);
            if (eventManager == null)
            {
                throw new Exception("EventManager component not found in Game scene.");
            }

            var failures = new List<string>();

            ValidateGame1(uiManager, failures);
            ValidateGame2(uiManager, failures);
            ValidateGame3(uiManager, failures);
            ValidateGame4(uiManager, failures);
            ValidateGame5(uiManager, failures);
            ValidateEventContracts(eventManager, failures);

            if (failures.Count > 0)
            {
                throw new Exception("Game interaction contract failures: " + string.Join(", ", failures));
            }

            Debug.Log("[GameInteractionContractSmoke] PASS");
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Debug.LogError("[GameInteractionContractSmoke] FAIL " + ex);
            EditorApplication.Exit(1);
        }
    }

    private static void ValidateGame1(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.topBarPanel", uiManager.topBarPanel, failures);
        CheckObject("UIManager.game1Panel", uiManager.game1Panel, failures);
        if (uiManager.topBarPanel != null)
        {
            CheckObject("TopBarPanel.hallGameListPanel", uiManager.topBarPanel.hallGameListPanel, failures);
            if (uiManager.topBarPanel.hallGameListPanel != null)
            {
                CheckObject(
                    "HallGameListPanel.game1PurchaseTicket",
                    uiManager.topBarPanel.hallGameListPanel.game1PurchaseTicket,
                    failures
                );
                CheckObject(
                    "HallGameListPanel.game1ViewPurchaseTicket",
                    uiManager.topBarPanel.hallGameListPanel.game1ViewPurchaseTicket,
                    failures
                );

                if (uiManager.topBarPanel.hallGameListPanel.game1PurchaseTicket != null)
                {
                    CheckMethod(
                        uiManager.topBarPanel.hallGameListPanel.game1PurchaseTicket.GetType(),
                        "Buy_Tickets_Btn",
                        failures
                    );
                    CheckMethod(
                        uiManager.topBarPanel.hallGameListPanel.game1PurchaseTicket.GetType(),
                        "View_Purchased_Ticket",
                        failures
                    );
                }
            }
        }

        if (uiManager.game1Panel == null)
            return;

        CheckObject("Game1Panel.game1TicketPurchasePanel", uiManager.game1Panel.game1TicketPurchasePanel, failures);
        if (uiManager.game1Panel.game1TicketPurchasePanel != null)
        {
            var type = uiManager.game1Panel.game1TicketPurchasePanel.GetType();
            CheckMethod(type, "OpenPanel", failures, typeof(GameData));
            CheckMethod(type, "OpenPanel", failures, typeof(GameData), typeof(Game1PurchaseDataResponse));
            CheckMethod(type, "OnBuyButtonTap", failures);
            CheckMethod(type, "RefreshTotalTicketCount", failures);
            CheckMethod(type, "ClosePanel", failures);
        }

        CheckObject("Game1Panel.game1GamePlayPanel", uiManager.game1Panel.game1GamePlayPanel, failures);
        if (uiManager.game1Panel.game1GamePlayPanel != null)
        {
            var type = uiManager.game1Panel.game1GamePlayPanel.GetType();
            CheckMethod(type, "Reconnect", failures);
            CheckMethod(type, "OnLuckyNumberSelection", failures, typeof(int));
            CheckMethod(type, "HighlightLuckyNumber", failures);
        }
    }

    private static void ValidateGame2(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game2Panel", uiManager.game2Panel, failures);
        if (uiManager.game2Panel == null)
            return;

        CheckObject("Game2Panel.game2TicketPurchasePanel", uiManager.game2Panel.game2TicketPurchasePanel, failures);
        if (uiManager.game2Panel.game2TicketPurchasePanel != null)
        {
            var type = uiManager.game2Panel.game2TicketPurchasePanel.GetType();
            CheckMethod(type, "OpenPanel", failures, typeof(GameData));
            CheckMethod(type, "OpenPanel", failures, typeof(string));
            CheckMethod(type, "Game2TicketPurchaseDataCall", failures);
            CheckMethod(type, "OnLuckyNumberTap", failures);
            CheckMethod(type, "OnBuyButtonTap", failures);
            CheckMethod(type, "OpenPlayPanel", failures);
            CheckMethod(type, "BuyMoreBoardsButtonTap", failures);
            CheckMethod(type, "AdvancePurchaseForTodaysGame", failures);
        }

        CheckObject("Game2Panel.game2PlayPanel", uiManager.game2Panel.game2PlayPanel, failures);
        if (uiManager.game2Panel.game2PlayPanel != null)
        {
            var type = uiManager.game2Panel.game2PlayPanel.GetType();
            CheckMethod(type, "Reconnect", failures);
            CheckMethod(type, "BuyMoreBoardsButtonTap", failures);
            CheckMethod(type, "AdvancePurchaseForTodaysGame", failures);
            CheckMethod(type, "OnLuckyNumberSelection", failures, typeof(int));
            CheckMethod(type, "HighlightLuckyNumber", failures);
        }
    }

    private static void ValidateGame3(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game3Panel", uiManager.game3Panel, failures);
        if (uiManager.game3Panel == null)
            return;

        CheckObject("Game3Panel.game3TicketPurchasePanel", uiManager.game3Panel.game3TicketPurchasePanel, failures);
        if (uiManager.game3Panel.game3TicketPurchasePanel != null)
        {
            var type = uiManager.game3Panel.game3TicketPurchasePanel.GetType();
            CheckMethod(type, "OpenPanel", failures, typeof(GameData));
            CheckMethod(type, "OnBuyButtonTap", failures);
            CheckMethod(type, "ModifyTicketCount", failures, typeof(bool));
            CheckMethod(type, "ClosePanel", failures);
        }

        CheckObject("Game3Panel.game3GamePlayPanel", uiManager.game3Panel.game3GamePlayPanel, failures);
        if (uiManager.game3Panel.game3GamePlayPanel != null)
        {
            var type = uiManager.game3Panel.game3GamePlayPanel.GetType();
            CheckMethod(type, "Reconnect", failures);
            CheckMethod(type, "BuyMoreBoardsButtonTap", failures);
            CheckMethod(type, "OnLuckyNumberSelection", failures, typeof(int));
            CheckMethod(type, "HighlightLuckyNumber", failures);
        }
    }

    private static void ValidateGame4(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game4Panel", uiManager.game4Panel, failures);
        if (uiManager.game4Panel?.game4GamePlayPanel == null)
            return;

        var panel = uiManager.game4Panel.game4GamePlayPanel;
        CheckObject("Game4GamePlayPanel.fortuneWheelManager", panel.fortuneWheelManager, failures);
        CheckObject("Game4GamePlayPanel.treasureChestPanel", panel.treasureChestPanel, failures);
        CheckObject("Game4GamePlayPanel.mysteryGamePanel", panel.mysteryGamePanel, failures);

        var type = panel.GetType();
        CheckMethod(type, "OnPlayButtonTap", failures);
        CheckMethod(type, "OnWheelOfFortuneButtonTap", failures);
        CheckMethod(type, "OnTreasureChestButtonTap", failures);
        CheckMethod(type, "OnMysteryGameButtonTap", failures);
    }

    private static void ValidateGame5(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game5Panel", uiManager.game5Panel, failures);
        if (uiManager.game5Panel?.game5GamePlayPanel == null)
            return;

        var panel = uiManager.game5Panel.game5GamePlayPanel;
        CheckObject("Game5GamePlayPanel.game5FreeSpinJackpot", panel.game5FreeSpinJackpot, failures);
        CheckObject("Game5GamePlayPanel.game5JackpotRouletteWheel", panel.game5JackpotRouletteWheel, failures);

        var type = panel.GetType();
        CheckMethod(type, "OnPlayButtonTap", failures);
        CheckMethod(type, "Reconnect", failures);

        CheckMethod(
            panel.game5FreeSpinJackpot.GetType(),
            "Open",
            failures,
            typeof(BestHTTP.SocketIO.Socket),
            typeof(string),
            typeof(string),
            typeof(WheelOfFortuneData)
        );
        CheckMethod(
            panel.game5FreeSpinJackpot.GetType(),
            "ReconnectOpen",
            failures,
            typeof(BestHTTP.SocketIO.Socket),
            typeof(string),
            typeof(string),
            typeof(MiniGameData)
        );
        CheckMethod(
            panel.game5JackpotRouletteWheel.GetType(),
            "Open",
            failures,
            typeof(BestHTTP.SocketIO.Socket),
            typeof(string),
            typeof(string),
            typeof(SpinDetails),
            typeof(List<RouletteData>)
        );
        CheckMethod(
            panel.game5JackpotRouletteWheel.GetType(),
            "ReconnectOpen",
            failures,
            typeof(BestHTTP.SocketIO.Socket),
            typeof(string),
            typeof(string),
            typeof(MiniGameData)
        );
    }

    private static void ValidateEventContracts(EventManager eventManager, List<string> failures)
    {
        var type = eventManager.GetType();
        CheckMethodByArity(type, "CancelGameTickets", 3, failures);
        CheckMethodByArity(type, "Set_Auto_Lucky_Number_For_Game_1", 2, failures);
        CheckMethodByArity(type, "Get_Auto_Lucky_Number_For_Game_1", 1, failures);
        CheckMethodByArity(type, "ReconnectPlayer", 1, failures);
        CheckMethodByArity(type, "WheelOfFortuneData", 4, failures);
        CheckMethodByArity(type, "PlayWheelOfFortune", 3, failures);
        CheckMethodByArity(type, "TreasureChestData", 4, failures);
        CheckMethodByArity(type, "SelectTreasureChest", 4, failures);
        CheckMethodByArity(type, "MysteryGameData", 4, failures);
        CheckMethodByArity(type, "SelectMystery", 6, failures);
    }

    private static void CheckObject(string owner, UnityEngine.Object value, List<string> failures)
    {
        if (value == null)
        {
            failures.Add(owner);
        }
    }

    private static void CheckMethod(Type ownerType, string methodName, List<string> failures, params Type[] parameterTypes)
    {
        var method = ownerType.GetMethod(methodName, Flags, null, parameterTypes, null);
        if (method == null)
        {
            failures.Add(ownerType.Name + "." + methodName);
        }
    }

    private static void CheckMethodByArity(Type ownerType, string methodName, int parameterCount, List<string> failures)
    {
        var method = Array.Find(
            ownerType.GetMethods(Flags),
            candidate => candidate.Name == methodName && candidate.GetParameters().Length == parameterCount
        );

        if (method == null)
        {
            failures.Add(ownerType.Name + "." + methodName + "/" + parameterCount);
        }
    }
}

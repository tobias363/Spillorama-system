using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class GameFlowContractSmokeTests
{
    private const string ScenePath = "Assets/_Project/_Scenes/Game.unity";
    private const BindingFlags Flags =
        BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;

    public static void RunGameFlowContractSmokeTest()
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
            ValidateGameplayEventContracts(eventManager, failures);

            if (failures.Count > 0)
            {
                throw new Exception("Game flow contract failures: " + string.Join(", ", failures));
            }

            Debug.Log("[GameFlowContractSmoke] PASS");
            EditorApplication.Exit(0);
        }
        catch (Exception ex)
        {
            Debug.LogError("[GameFlowContractSmoke] FAIL " + ex);
            EditorApplication.Exit(1);
        }
    }

    private static void ValidateGame1(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game1Panel", uiManager.game1Panel, failures);
        if (uiManager.game1Panel == null)
            return;

        CheckMethod(uiManager.game1Panel.GetType(), "OpenTicketPurchasePanel", failures, typeof(GameData));
        CheckMethod(
            uiManager.game1Panel.GetType(),
            "OpenTicketPurchasePanel",
            failures,
            typeof(GameData),
            typeof(Game1PurchaseDataResponse)
        );
        CheckMethod(uiManager.game1Panel.GetType(), "OpenGamePlayPanel", failures, typeof(GameData));
        CheckMethod(
            uiManager.game1Panel.GetType(),
            "OpenGamePlayPanel",
            failures,
            typeof(GameData),
            typeof(string)
        );
        CheckMethod(uiManager.game1Panel.GetType(), "ClosePanel", failures);
        CheckMethod(uiManager.game1Panel.GetType(), "Set_Game_1_Purchase_Data", failures, typeof(string), typeof(int), typeof(List<Game1TicketPurchase>));

        CheckObject("Game1Panel.game1GamePlayPanel", uiManager.game1Panel.game1GamePlayPanel, failures);
        if (uiManager.game1Panel.game1GamePlayPanel == null)
            return;

        CheckMethod(
            uiManager.game1Panel.game1GamePlayPanel.GetType(),
            "OpenPanel",
            failures,
            typeof(GameData),
            typeof(string)
        );
        CheckMethod(uiManager.game1Panel.game1GamePlayPanel.GetType(), "CallSubscribeRoom", failures);
        CheckMethod(uiManager.game1Panel.game1GamePlayPanel.GetType(), "Reconnect", failures);
        CheckMethod(uiManager.game1Panel.game1GamePlayPanel.GetType(), "OnLuckyNumberTap", failures);
        CheckMethod(uiManager.game1Panel.game1GamePlayPanel.GetType(), "OpenChangeMarkerBackgroundPanel", failures);
    }

    private static void ValidateGame2(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game2Panel", uiManager.game2Panel, failures);
        if (uiManager.game2Panel == null)
            return;

        CheckMethod(uiManager.game2Panel.GetType(), "OpenTicketBuyPanel", failures, typeof(GameData));
        CheckMethod(uiManager.game2Panel.GetType(), "OpenTicketBuyPanel", failures, typeof(string));
        CheckMethod(
            uiManager.game2Panel.GetType(),
            "OpenGamePlayPanel",
            failures,
            typeof(GameData),
            typeof(string)
        );
        CheckMethod(uiManager.game2Panel.GetType(), "ClosePanel", failures);
        CheckMethod(
            uiManager.game2Panel.GetType(),
            "Set_Blind_Purchase_Data",
            failures,
            typeof(string),
            typeof(int),
            typeof(int)
        );

        CheckObject("Game2Panel.game2PlayPanel", uiManager.game2Panel.game2PlayPanel, failures);
        if (uiManager.game2Panel.game2PlayPanel == null)
            return;

        CheckMethod(
            uiManager.game2Panel.game2PlayPanel.GetType(),
            "OpenPanel",
            failures,
            typeof(GameData),
            typeof(string)
        );
        CheckMethod(uiManager.game2Panel.game2PlayPanel.GetType(), "CallSubscribeRoom", failures);
        CheckMethod(uiManager.game2Panel.game2PlayPanel.GetType(), "Reconnect", failures);
        CheckMethod(uiManager.game2Panel.game2PlayPanel.GetType(), "BuyMoreBoardsButtonTap", failures);
        CheckMethod(uiManager.game2Panel.game2PlayPanel.GetType(), "AdvancePurchaseForTodaysGame", failures);
    }

    private static void ValidateGame3(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game3Panel", uiManager.game3Panel, failures);
        if (uiManager.game3Panel == null)
            return;

        CheckMethod(
            uiManager.game3Panel.GetType(),
            "OpenTicketPurchasePanel",
            failures,
            typeof(GameData)
        );
        CheckMethod(
            uiManager.game3Panel.GetType(),
            "OpenGamePlayPanel",
            failures,
            typeof(GameData),
            typeof(string)
        );
        CheckMethod(uiManager.game3Panel.GetType(), "ClosePanel", failures);
        CheckMethod(
            uiManager.game3Panel.GetType(),
            "Set_Game_3_Purchase_Data",
            failures,
            typeof(string),
            typeof(int)
        );

        CheckObject("Game3Panel.game3GamePlayPanel", uiManager.game3Panel.game3GamePlayPanel, failures);
        if (uiManager.game3Panel.game3GamePlayPanel == null)
            return;

        CheckMethod(
            uiManager.game3Panel.game3GamePlayPanel.GetType(),
            "OpenPanel",
            failures,
            typeof(GameData),
            typeof(string)
        );
        CheckMethod(uiManager.game3Panel.game3GamePlayPanel.GetType(), "CallSubscribeRoom", failures);
        CheckMethod(uiManager.game3Panel.game3GamePlayPanel.GetType(), "Reconnect", failures);
        CheckMethod(uiManager.game3Panel.game3GamePlayPanel.GetType(), "BuyMoreBoardsButtonTap", failures);
        CheckMethod(uiManager.game3Panel.game3GamePlayPanel.GetType(), "OnLuckyNumberTap", failures);
    }

    private static void ValidateGame4(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game4Panel", uiManager.game4Panel, failures);
        if (uiManager.game4Panel == null)
            return;

        CheckMethod(uiManager.game4Panel.GetType(), "OpenPanel", failures);
        CheckMethod(uiManager.game4Panel.GetType(), "ClosePanel", failures);

        CheckObject("Game4Panel.game4GamePlayPanel", uiManager.game4Panel.game4GamePlayPanel, failures);
        if (uiManager.game4Panel.game4GamePlayPanel == null)
            return;

        CheckMethod(
            uiManager.game4Panel.game4GamePlayPanel.GetType(),
            "SetData",
            failures,
            typeof(Game4Theme),
            typeof(Game4Data),
            typeof(bool)
        );
        CheckMethod(uiManager.game4Panel.game4GamePlayPanel.GetType(), "OnPlayButtonTap", failures);
        CheckMethod(uiManager.game4Panel.game4GamePlayPanel.GetType(), "Game4ChangeTickets", failures);
        CheckMethod(uiManager.game4Panel.game4GamePlayPanel.GetType(), "OnWheelOfFortuneButtonTap", failures);
        CheckMethod(uiManager.game4Panel.game4GamePlayPanel.GetType(), "OnTreasureChestButtonTap", failures);
        CheckMethod(uiManager.game4Panel.game4GamePlayPanel.GetType(), "OnMysteryGameButtonTap", failures);
    }

    private static void ValidateGame5(UIManager uiManager, List<string> failures)
    {
        CheckObject("UIManager.game5Panel", uiManager.game5Panel, failures);
        if (uiManager.game5Panel == null)
            return;

        CheckMethod(uiManager.game5Panel.GetType(), "OpenPanel", failures);
        CheckMethod(uiManager.game5Panel.GetType(), "ClosePanel", failures);

        CheckObject("Game5Panel.game5GamePlayPanel", uiManager.game5Panel.game5GamePlayPanel, failures);
        if (uiManager.game5Panel.game5GamePlayPanel == null)
            return;

        CheckMethod(uiManager.game5Panel.game5GamePlayPanel.GetType(), "SetData", failures, typeof(Game5Data));
        CheckMethod(uiManager.game5Panel.game5GamePlayPanel.GetType(), "OnPlayButtonTap", failures);
        CheckMethod(uiManager.game5Panel.game5GamePlayPanel.GetType(), "CallSubscribeRoom", failures);
        CheckMethod(uiManager.game5Panel.game5GamePlayPanel.GetType(), "Reconnect", failures);
    }

    private static void ValidateGameplayEventContracts(EventManager eventManager, List<string> failures)
    {
        var type = eventManager.GetType();
        CheckMethodByArity(type, "PurchaseGame1Tickets", 5, failures);
        CheckMethodByArity(type, "Game2BuyTickets", 8, failures);
        CheckMethodByArity(type, "PurchaseGame3Tickets", 5, failures);
        CheckMethodByArity(type, "Game4Play", 7, failures);
        CheckMethodByArity(type, "Game5Play", 3, failures);
        CheckMethodByArity(type, "SubscribeRoomGame1", 3, failures);
        CheckMethodByArity(type, "SubscribeRoomGame2", 3, failures);
        CheckMethodByArity(type, "SubscribeRoom", 4, failures);
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
            candidate =>
                candidate.Name == methodName && candidate.GetParameters().Length == parameterCount
        );

        if (method == null)
        {
            failures.Add(ownerType.Name + "." + methodName + "/" + parameterCount);
        }
    }
}

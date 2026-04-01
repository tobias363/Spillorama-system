var Sys = require('../../../Boot/Sys');

module.exports = function(Socket) {
    try {
        /*Socket.on("AdminHallDisplayLogin", async function(data, responce) {
            console.log("AdminHallDisplayLogin Called............!!!!!!!!", data)
            responce(await Sys.Game.Game1.Controllers.GameController.adminHallDisplayLogin(Socket, data));
        });
        // [ Done ]
        Socket.on("ApplyVoucherCode", async function(data, responce) {
            //console.log("Game2TicketPurchaseData  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameController.ApplyVoucherCode(Socket, data));
        });

        // [ Done ]
        Socket.on("GetGame1PurchaseData", async function(data, responce) {
            console.log("GetGame1PurchaseData: ", data);
            responce(await Sys.Game.Game1.Controllers.GameController.GetGame1PurchaseData(Socket, data));
        });

        // [ Done ]
        Socket.on("PurchaseGame1Tickets", async function(data, responce) {
            console.log("PurchaseGame1Tickets: ", data);
            responce(await Sys.Game.Game1.Controllers.GameController.PurchaseGame1Tickets(Socket, data));
        });

        // [ Done ]
        Socket.on("CancelGameTickets", async function(data, responce) {
            //console.log("CancelGameTickets  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameController.cancelGameTickets(Socket, data));
        });

        // [ Done ]
        Socket.on("SendGameChat", async function(data, responce) {
            //console.log("SendGameChat  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameController.sendGameChat(Socket, data));
        });

        // [ Done ]
        Socket.on("GameChatHistory", async function(data, responce) {
            //console.log("GameChatHistory  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameController.gameChatHistory(Socket, data));
        });

        Socket.on("HallGameList", async function(data, responce) {
            console.log("HallGameList: ", data);
            responce(await Sys.Game.Game1.Controllers.GameController.hallGameList(Socket, data));
        });

        Socket.on("SubscribeRoom", async function(data, responce) {
            console.log("SubscribeRoom  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameController.subscribeRoom(Socket, data));
        });

        Socket.on("LeftRoom", async function(data, responce) {
            //console.log("LeftRoom  Called :", data);
            await Sys.Game.Game1.Controllers.GameController.leftRoom(Socket, data);
        });

        Socket.on("SelectLuckyNumber", async function(data, responce) {
            console.log("SelectLuckyNumber  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameController.SelectLuckyNumber(Socket, data));
        });

        Socket.on("CheckForWinners", async function(data, responce) {
            console.log("CheckForWinners  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameProcess.checkForWinners(Socket, data));
        });

        Socket.on("GameFinished", async function(data, responce) {
            console.log("GameFinished  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameProcess.gameFinished(Socket, data));
        });

        Socket.on("CheckForGameFinished", async function(data, responce) {
            console.log("CheckForGameFinished  Called :", data);
            responce(await Sys.Game.Game1.Controllers.GameProcess.checkForGameFinished(Socket, data));
        });

        Socket.on("WheelOfFortuneData", async function(data, responce) {
            responce(await Sys.Game.Game1.Controllers.GameProcess.WheelOfFortuneData(Socket, data));
        });

        Socket.on("PlayWheelOfFortune", async function(data, responce) {
            responce(await Sys.Game.Game1.Controllers.GameProcess.PlayWheelOfFortune(Socket, data));
        });

        Socket.on("WheelOfFortuneFinished", async function(data, responce) {
            responce(await Sys.Game.Game1.Controllers.GameProcess.WheelOfFortuneFinished(Socket, data));
        });

        Socket.on("TreasureChestData", async function(data, responce) {
            responce(await Sys.Game.Game1.Controllers.GameProcess.TreasureChestData(Socket, data));
        });

        Socket.on("SelectTreasureChest", async function(data, responce) {
            responce(await Sys.Game.Game1.Controllers.GameProcess.SelectTreasureChest(Socket, data));
        });

        Socket.on("MysteryGameData", async function(data, responce) {
            responce(await Sys.Game.Game1.Controllers.GameProcess.MysteryGameData(Socket, data));
        });

        Socket.on("MysteryGameFinished", async function(data, responce) {
            responce(await Sys.Game.Game1.Controllers.GameProcess.MysteryGameFinished(Socket, data));
        });*/


    } catch (e) {
        console.log("Error in Game1 Socket Handler : ", e);
    }

}
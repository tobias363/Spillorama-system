const Sys = require('../../../Boot/Sys');

module.exports = function(Socket) {
    try {
        Socket.on("Game1Room", async function(data, responce) {
            try {
                console.log("Game1Room Called............!!!!!!!!", data)
                responce(await Sys.Game.Game1.Controllers.GameController.Game1Room(Socket, data));
            } catch (error) {
                console.log("Error in Game1Room:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SubscribeRoom", async function(data, responce) {
            try {
                console.log("SubscribeRoom  Called :", data);
                responce(await Sys.Game.Game1.Controllers.GameController.subscribeRoom(Socket, data));
            } catch (error) {
                console.log("Error in SubscribeRoom:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });
        
        Socket.on("PurchaseGame1Tickets", async function(data, responce) {
            try {
                console.log("purchaseGame1Tickets Called............!!!!!!!!", data)
                responce(await Sys.Game.Game1.Controllers.GameController.PurchaseGame1Tickets(Socket, data));
            } catch (error) {
                console.log("Error in PurchaseGame1Tickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("CancelGame1Tickets", async function(data, responce) {
            try {
                console.log("CancelGameTickets Called............!!!!!!!!", data)
                responce(await Sys.Game.Game1.Controllers.GameController.cancelGameTickets(Socket, data));
            } catch (error) {
                console.log("Error in CancelGame1Tickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("UpcomingGames", async function(data, responce) {
            try {
                console.log("UpcomingGames Called............!!!!!!!!", data)
                responce(await Sys.Game.Game1.Controllers.GameController.upcomingGames(Socket, data));
            } catch (error) {
                console.log("Error in UpcomingGames:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SelectLuckyNumber", async function(data, responce) {
            try {
                console.log("SelectLuckyNumber  Called :", data);
                responce(await Sys.Game.Game1.Controllers.GameController.selectLuckyNumber(Socket, data));
            } catch (error) {
                console.log("Error in SelectLuckyNumber:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("ViewPurchasedTickets", async function(data, responce) {
            try {
                console.log("viewPurchasedTickets  Called :", data);
                responce(await Sys.Game.Game1.Controllers.GameController.viewPurchasedTickets(Socket, data));
            } catch (error) {
                console.log("Error in ViewPurchasedTickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("ReplaceElvisTickets", async function(data, responce) {
            try {
                console.log("replaceElvisTickets  Called :", data);
                responce(await Sys.Game.Game1.Controllers.GameController.replaceElvisTickets(Socket, data));
            } catch (error) {
                console.log("Error in ReplaceElvisTickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("StartGame", async function(data, responce) {
            try {
                console.log("StartGame Called............!!!!!!!!", data)
                responce(await Sys.Game.Game1.Controllers.GameProcess.StartGame(Socket, data));
            } catch (error) {
                console.log("Error in StartGame:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SendGameChat", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameController.sendGameChat(Socket, data));
            } catch (error) {
                console.log("Error in SendGameChat:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("GameChatHistory", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameController.gameChatHistory(Socket, data));
            } catch (error) {
                console.log("Error in GameChatHistory:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("LeftRoom", async function(data, responce) {
            try {
                console.log("LeftRoom Called............!!!!!!!!", data)
                await Sys.Game.Game1.Controllers.GameController.leftRoom(Socket, data);
            } catch (error) {
                console.log("Error in LeftRoom:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("AdminHallDisplayLogin", async function(data, responce) {
            try {
                console.log("AdminHallDisplayLogin Called............!!!!!!!!", data)
                responce(await Sys.Game.Game1.Controllers.GameController.adminHallDisplayLogin(Socket, data));
            } catch (error) {
                console.log("Error in AdminHallDisplayLogin:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("gameFinished", async function(data, responce) {
            try {
                console.log("gameFinished Called............!!!!!!!!", data)
                responce(await Sys.Game.Game1.Controllers.GameProcess.gameFinished(Socket, data));
            } catch (error) {
                console.log("Error in gameFinished:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("WheelOfFortuneData", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameProcess.wheelOfFortuneData(Socket, data));
            } catch (error) {
                console.log("Error in WheelOfFortuneData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("PlayWheelOfFortune", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameProcess.playWheelOfFortune(Socket, data));
            } catch (error) {
                console.log("Error in PlayWheelOfFortune:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("WheelOfFortuneFinished", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameProcess.wheelOfFortuneFinished(Socket, data));
            } catch (error) {
                console.log("Error in WheelOfFortuneFinished:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("TreasureChestData", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameProcess.TreasureChestData(Socket, data));
            } catch (error) {
                console.log("Error in TreasureChestData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SelectTreasureChest", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameProcess.SelectTreasureChest(Socket, data));
            } catch (error) {
                console.log("Error in SelectTreasureChest:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("MysteryGameData", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameProcess.mysteryGameData(Socket, data));
            } catch (error) {
                console.log("Error in MysteryGameData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SelectMystery", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameProcess.selectMysteryAuto(Socket, data));
            } catch (error) {
                console.log("Error in SelectMystery:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("ColorDraftGameData", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameProcess.colorDraftGameData(Socket, data));
            } catch (error) {
                console.log("Error in ColorDraftGameData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SelectColorDraft", async function(data, responce) {
            try {
                console.log("SelectColorDraft called from user", data)
                responce(await Sys.Game.Game1.Controllers.GameProcess.selectColorDraftAuto(Socket, data));
            } catch (error) {
                console.log("Error in SelectColorDraft:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });
        
        Socket.on("CancelTicket", async function(data, responce) {
            try {
                console.log("Cancel Individual Ticket Called............!!!!!!!!", data)
                responce(await Sys.Game.Game1.Controllers.GameController.cancelIndividualGameTickets(Socket, data));
            } catch (error) {
                console.log("Error in CancelTicket:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("StopGameByPlayers", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameController.stopGameByPlayers(Socket, data));
            } catch (error) {
                console.log("Error in StopGameByPlayers:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("TvscreenUrlForPlayers", async function(data, responce) {
            try {
                responce(await Sys.Game.Game1.Controllers.GameController.tvscreenUrlForPlayers(Socket, data));
            } catch (error) {
                console.log("Error in TvscreenUrlForPlayers:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });
        
    } catch (e) {
        console.log("Error in Game1 Socket Handler : ", e);
    }

}
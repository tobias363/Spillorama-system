const Sys = require('../../../Boot/Sys');

module.exports = function(Socket) {
    try {
        Socket.on("isGameAvailbaleForVerifiedPlayer", async function(data, response) {
            try {
                console.log("🚀 ~ Socket.on ~ isGameAvailbaleForVerifiedPlayer:", data)
                response(await Sys.Game.Game4.Controllers.GameController.isGameAvailbaleForVerifiedPlayer(Socket, data));
            } catch (error) {
                console.log("Error in isGameAvailbaleForVerifiedPlayer:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });
        // [ Done ]
        Socket.on("ApplyVoucherCode", async function(data, responce) {
            try {
                //console.log("Game2TicketPurchaseData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.ApplyVoucherCode(Socket, data));
            } catch (error) {
                console.log("Error in ApplyVoucherCode:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Game4Data", async function(data, responce) {
            try {
                //console.log("Game2TicketPurchaseData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.Game4Data(Socket, data));
            } catch (error) {
                console.log("Error in Game4Data:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Game4ChangeTickets", async function(data, responce) {
            try {
                //console.log("Game2BuyTickets  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.Game4ChangeTickets(Socket, data));
            } catch (error) {
                console.log("Error in Game4ChangeTickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Game4Play", async function(data, responce) {
            try {
                //console.log("SubscribeRoom  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.Game4Play(Socket, data));
            } catch (error) {
                console.log("Error in Game4Play:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("WheelOfFortuneData", async function(data, responce) {
            try {
                //console.log("TreasureChestData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.WheelOfFortuneData(Socket, data));
            } catch (error) {
                console.log("Error in WheelOfFortuneData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("WheelOfFortuneFinished", async function(data, responce) {
            try {
                //console.log("TreasureChestData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.WheelOfFortuneFinished(Socket, data));
            } catch (error) {
                console.log("Error in WheelOfFortuneFinished:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });


        // [ Done ]
        Socket.on("PlayWheelOfFortune", async function(data, responce) {
            try {
                //console.log("TreasureChestData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.PlayWheelOfFortune(Socket, data));
            } catch (error) {
                console.log("Error in PlayWheelOfFortune:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("TreasureChestData", async function(data, responce) {
            try {
                //console.log("TreasureChestData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.TreasureChestData(Socket, data));
            } catch (error) {
                console.log("Error in TreasureChestData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("SelectTreasureChest", async function(data, responce) {
            try {
                //console.log("TreasureChestData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.SelectTreasureChest(Socket, data));
            } catch (error) {
                console.log("Error in SelectTreasureChest:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("MysteryGameData", async function(data, responce) {
            try {
                //console.log("TreasureChestData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.MysteryGameData(Socket, data));
            } catch (error) {
                console.log("Error in MysteryGameData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("MysteryGameFinished", async function(data, responce) {
            try {
                //console.log("TreasureChestData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.MysteryGameFinished(Socket, data));
            } catch (error) {
                console.log("Error in MysteryGameFinished:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Game4ThemesData", async function(data, responce) {
            try {
                //console.log("TreasureChestData  Called :", data);
                responce(await Sys.Game.Game4.Controllers.GameController.Game4ThemesData(Socket, data));
            } catch (error) {
                console.log("Error in Game4ThemesData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

    } catch (e) {
        console.log("Error in Game4 Socket Handler : ", e);
    }

}
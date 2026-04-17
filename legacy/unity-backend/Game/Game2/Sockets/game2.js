const Sys = require('../../../Boot/Sys');

module.exports = function(Socket) {
    try {

        // Before subscribe it will be called
        Socket.on("Game2Room", async function (data, responce) {
            try {
                //console.log("Game2Room  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.game2Room(Socket, data));
            } catch (error) {
                console.log("Error in Game2Room:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Sunscribe player to upcoming game
        Socket.on("SubscribeRoom", async function(data, responce) {
            try {
                //console.log("SubscribeRoom  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.subscribeRoom(Socket, data));
            } catch (error) {
                console.log("Error in SubscribeRoom:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // To list all the upcoming game2
        Socket.on("Game2PlanList", async function (data, responce) {
            try {
                //console.log("Game2PlanList  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.game2List(Socket, data));
            } catch (error) {
                console.log("Error in Game2PlanList:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // It will generate 40 tickets for player if not present for particular game 
        Socket.on("Game2TicketPurchaseData", async function(data, responce) {
            try {
                //console.log("Game2TicketPurchaseData  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.game2Ticket(Socket, data));
            } catch (error) {
                console.log("Error in Game2TicketPurchaseData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // It will be called when we directly buy tickets
        Socket.on("Game2BuyBlindTickets", async function (data, responce) {
            try {
                //console.log("Game2BuyBlindTickets  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.blindTicketPurchase(Socket, data));
            } catch (error) {
                console.log("Error in Game2BuyBlindTickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // It will be called when we choose ticket 
        Socket.on("Game2BuyTickets", async function(data, responce) {
            try {
                //console.log("Game2BuyTickets  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.game2TicketPurchased(Socket, data));
            } catch (error) {
                console.log("Error in Game2BuyTickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

         // Cancel all the tickets for particular player for current game
         Socket.on("CancelGameTickets", async function(data, responce) {
            try {
                //console.log("CancelGameTickets  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.cancelGameTickets(Socket, data));
            } catch (error) {
                console.log("Error in CancelGameTickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Cancel single ticket for particular player for current game
        Socket.on("CancelTicket", async function (data, responce) {
            try {
                //console.log("cancelTicket called in game 2", data)
                responce(await Sys.Game.Game2.Controllers.GameController.cancelTicket(Socket, data));
            } catch (error) {
                console.log("Error in CancelTicket:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SelectLuckyNumber", async function (data, responce) {
            try {
                //console.log("Game2LuckyNumber  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.game2LuckyNumber(Socket, data));
            } catch (error) {
                console.log("Error in SelectLuckyNumber:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SendGameChat", async function(data, responce) {
            try {
                //console.log("SendGameChat  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.sendGameChat(Socket, data));
            } catch (error) {
                console.log("Error in SendGameChat:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("GameChatHistory", async function(data, responce) {
            try {
                //console.log("GameChatHistory  Called :", data);
                responce(await Sys.Game.Game2.Controllers.GameController.gameChatHistory(Socket, data));
            } catch (error) {
                console.log("Error in GameChatHistory:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("LeftRoom", async function(data, responce) {
            try {
                //console.log("leftroom called in game 2", data)
                Sys.Game.Game2.Controllers.GameController.leftRoom(Socket, data);
            } catch (error) {
                console.log("Error in LeftRoom:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("LeftRocketRoom", async function (data, responce) {
            try {
                //console.log("leftrocketroom called in game 2", data)
                Sys.Game.Game2.Controllers.GameController.leftRocketRoom(Socket, data);
            } catch (error) {
                console.log("Error in LeftRocketRoom:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on('disconnecting', async function(){
            try {
                //console.log("disconnecting game 2");
                await Sys.Game.Common.Controllers.GameController.clearRoomsSockets(Socket) ;
            } catch (error) {
                console.log("Error in disconnecting:", error);
            }
        });

        // It is not used in game 2 
        // Socket.on("ApplyVoucherCode", async function(data, responce) {
        //     responce(await Sys.Game.Game2.Controllers.GameController.ApplyVoucherCode(Socket, data));
        // });


    } catch (e) {
        console.log("Error in Game2 Socket Handler : ", e);
    }

}
const Sys = require('../../../Boot/Sys');

module.exports = function(Socket) {
    try {

        Socket.on("Game3Room", async function (data, responce) {
            try {
                // console.log("Game2Room  Called :", data);
                responce(await Sys.Game.Game3.Controllers.GameController.game3Room(Socket, data));
            } catch (error) {
                console.log("Error in Game3Room:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SubscribeRoom", async function(data, responce) {
            try {
                console.log("SubscribeRoom  Called :", data);
                responce(await Sys.Game.Game3.Controllers.GameController.subscribeRoom(Socket, data));
            } catch (error) {
                console.log("Error in SubscribeRoom:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("Game3PlanList", async function (data, responce) {
            try {
                // console.log("Game2PlanList  Called :", data);
                responce(await Sys.Game.Game3.Controllers.GameController.game3List(Socket, data));
            } catch (error) {
                console.log("Error in Game3PlanList:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });
       
        // [ Done ]
        Socket.on("GetGame3PurchaseData", async function(data, responce) {
            try {
                console.log("GetGame3PurchaseData: ", data);
                responce(await Sys.Game.Game3.Controllers.GameController.GetGame3PurchaseData(Socket, data));
            } catch (error) {
                console.log("Error in GetGame3PurchaseData:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("PurchaseGame3Tickets", async function(data, responce) {
            try {
                console.log("PurchaseGame3Tickets: ", data);
                responce(await Sys.Game.Game3.Controllers.GameController.PurchaseGame3Tickets(Socket, data));
            } catch (error) {
                console.log("Error in PurchaseGame3Tickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("CancelGameTickets", async function(data, responce) {
            try {
                //console.log("CancelGameTickets  Called :", data);
                responce(await Sys.Game.Game3.Controllers.GameController.cancelGameTickets(Socket, data));
            } catch (error) {
                console.log("Error in CancelGameTickets:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("CancelTicket", async function (data, responce) {
            try {
                console.log("cancelTicket called in game 3", data)
                responce(await Sys.Game.Game3.Controllers.GameController.cancelTicket(Socket, data))
            } catch (error) {
                console.log("Error in CancelTicket:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });


        Socket.on("LeftRoom", async function(data, responce) {
            try {
                //console.log("LeftRoom  Called :", data);
                await Sys.Game.Game3.Controllers.GameController.leftRoom(Socket, data);
            } catch (error) {
                console.log("Error in LeftRoom:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("SelectLuckyNumber", async function(data, responce) {
            try {
                console.log("SelectLuckyNumber  Called :", data);
                responce(await Sys.Game.Game3.Controllers.GameController.SelectLuckyNumber(Socket, data));
            } catch (error) {
                console.log("Error in SelectLuckyNumber:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("SendGameChat", async function(data, responce) {
            try {
                //console.log("SendGameChat  Called :", data);
                responce(await Sys.Game.Game3.Controllers.GameController.sendGameChat(Socket, data));
            } catch (error) {
                console.log("Error in SendGameChat:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // [ Done ]
        Socket.on("GameChatHistory", async function(data, responce) {
            try {
                //console.log("GameChatHistory  Called :", data);
                responce(await Sys.Game.Game3.Controllers.GameController.gameChatHistory(Socket, data));
            } catch (error) {
                console.log("Error in GameChatHistory:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        // Not using
        // Socket.on("ApplyVoucherCode", async function(data, responce) {
        //     responce(await Sys.Game.Game3.Controllers.GameController.ApplyVoucherCode(Socket, data));
        // });

        Socket.on('disconnecting', async function(){
            try {
                console.log("disconnecting game 3");
                await Sys.Game.Common.Controllers.GameController.clearRoomsSockets(Socket) ;
            } catch (error) {
                console.log("Error in disconnecting:", error);
            }
        });

    } catch (e) {
        console.log("Error in Game3 Socket Handler : ", e);
    }

}
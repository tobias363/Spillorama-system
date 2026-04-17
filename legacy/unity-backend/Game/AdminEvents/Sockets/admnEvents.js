const Sys = require('../../../Boot/Sys');

module.exports = function (Socket) {
  try {
    Socket.on("joinHall", async function (data, responce) {
      try {
        console.log("Join Hall event called!", data)
        await Socket.join(data.hallId);
        console.log("Subscriber will now recieve Game 1 realtime updates in",data.hallId);
        return responce({"status":"success"});
      } catch (error) {
        console.log("Error in joinHall:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("joinRoom", async function (data, responce) {
      try {
        console.log("Join Room event called!", data)
        await Socket.join(data.roomId);
        console.log("Subscriber will now recieve Game 1 realtime updates in", data.roomId);
        return responce({ "status": "success" });
      } catch (error) {
        console.log("Error in joinRoom:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("getNextGame", async function (data, responce) {
      try {
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.getNextGame(data));
      } catch (error) {
        console.log("Error in getNextGame:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("getOngoingGame", async function (data, responce) {
      try {
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.getOnGoingGame(data));
      } catch (error) {
        console.log("Error in getOngoingGame:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("getHallBalance", async function (data, responce) {
      try {
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.getHallBalance(data));
      } catch (error) {
        console.log("Error in getHallBalance:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("onHallReady", async function (data, responce) {
      try {
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.getHallStatus(data));
      } catch (error) {
        console.log("Error in onHallReady:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("getWithdrawPenddingRequest", async function (data, responce) {
      try {
        console.log("getWithdrawPenddingRequest Call",data);
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.getWithdrawPenddingRequest(data));
      } catch (error) {
        console.log("Error in getWithdrawPenddingRequest:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    }); 

    Socket.on("gameCountDownTimeUpdate", async function (data, responce) {
      try {
        console.log("gameCountDownTimeUpdate Call",data);
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.gameCountDownTimeUpdate(data));
      } catch (error) {
        console.log("Error in gameCountDownTimeUpdate:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("secondToDisplaySingleBallUpdate", async function (data, responce) {
      try {
        console.log("secondToDisplaySingleBallUpdate Call",data);
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.secondToDisplaySingleBallUpdate(data));
      } catch (error) {
        console.log("Error in secondToDisplaySingleBallUpdate:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("checkTransferHallAccess", async function (data) {
      try {
        await Sys.Game.AdminEvents.AdminController.AdminController.checkTransferHallAccess(data);
      } catch (error) {
        console.log("Error in checkTransferHallAccess:", error);
      }
    });

    Socket.on("transferHallAccess", async function (data, responce) {
      try {
        console.log("transferHallAccess Call",data);
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.transferHallAccess(data));
      } catch (error) {
        console.log("Error in transferHallAccess:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

    Socket.on("approveTransferHallAccess", async function (data, responce) {
      try {
        console.log("approveTransferHallAccess Call",data);
        return responce(await Sys.Game.AdminEvents.AdminController.AdminController.approveTransferHallAccess(data));
      } catch (error) {
        console.log("Error in approveTransferHallAccess:", error);
        if (responce) return responce({ status: "error", message: error.message });
      }
    });

  } catch (error) {
    console.log("Error In Admin Socket Event Handler : ", error);
  }

}
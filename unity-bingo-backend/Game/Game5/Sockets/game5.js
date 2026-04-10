const Sys = require('../../../Boot/Sys');

module.exports = function(Socket) {
    try {
        Socket.on("isGameAvailbaleForVerifiedPlayer", async function(data, response) {
            try {
                response(await Sys.Game.Game5.Controllers.GameController.isGameAvailbaleForVerifiedPlayer(Socket, data));
            } catch (error) {
                console.log("Error in isGameAvailbaleForVerifiedPlayer:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });
        
        Socket.on("Game5Data", async function(data, response) {
            try {
                response(await Sys.Game.Game5.Controllers.GameController.GameData(Socket, data));
            } catch (error) {
                console.log("Error in Game5Data:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });

        Socket.on("SwapTicket", async function(data, response) {
            try {
                response(await Sys.Game.Game5.Controllers.GameController.swapTicket(Socket, data));
            } catch (error) {
                console.log("Error in SwapTicket:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });

        Socket.on("Game5Play", async function(data, response) {
            try {
                response(await Sys.Game.Game5.Controllers.GameController.game5Play(Socket, data));
            } catch (error) {
                console.log("Error in Game5Play:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });

        Socket.on("checkForWinners", async function(data, response){
            try {
                response(await Sys.Game.Game5.Controllers.GameProcess.check(Socket, data));
            } catch (error) {
                console.log("Error in checkForWinners:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });

        Socket.on("LeftRoom", async function(data, response){
            try {
                response(await Sys.Game.Game5.Controllers.GameController.leftRoom(Socket, data));
            } catch (error) {
                console.log("Error in LeftRoom:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });

        Socket.on("WheelOfFortuneData", async function(data, response){
            try {
                response(await Sys.Game.Game5.Controllers.GameProcess.wheelOfFortuneData(Socket, data));
            } catch (error) {
                console.log("Error in WheelOfFortuneData:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });

        Socket.on("PlayWheelOfFortune", async function(data, responce) {
            try {
                responce(await Sys.Game.Game5.Controllers.GameProcess.playWheelOfFortune(Socket, data));
            } catch (error) {
                console.log("Error in PlayWheelOfFortune:", error);
                if (responce) return responce({ status: "error", message: error.message });
            }
        });

        Socket.on("SelectWofAuto", async function(data, response) {
            try {
                response(await Sys.Game.Game5.Controllers.GameProcess.selectWofAuto(Socket, data));
            } catch (error) {
                console.log("Error in SelectWofAuto:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });

        Socket.on("SelectRouletteAuto", async function(data, response){
            try {
                console.log("SelectRouletteAuto  called from user", data)
                response(await Sys.Game.Game5.Controllers.GameProcess.selectRouletteAuto(Socket, data));
            } catch (error) {
                console.log("Error in SelectRouletteAuto:", error);
                if (response) return response({ status: "error", message: error.message });
            }
        });
        
    } catch (e) {
        console.log("Error in Game5 Socket Handler : ", e);
    }

}
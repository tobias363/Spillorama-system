const { logger } = require('handlebars');
const Sys = require('../../../Boot/Sys');
const moment = require('moment');
let hallRequestTime = []
const { getMyGroupHalls } = require('../../../gamehelper/game1-process');
const { saveGameDataToRedisHmset, getGameDataFromRedisHmset } = require('../../../gamehelper/all');
module.exports = {

  getNextGame: async function (data) {
    try {
      console.log("Get next Game called", data);
      const startDate = new Date();
      const endDate = new Date();
      startDate.setHours(0, 0, 0);
      endDate.setHours(23, 59, 59);

      console.log(startDate, endDate);
      const nextGame = await Sys.Game.AdminEvents.Services.GameServices.getByData({
        gameType: 'game_1',
        status: "active",
        halls: data.hallId,
        stopGame: false,
        'otherData.isClosed': false,
        startDate: {
          $gte: startDate,
          $lte: endDate
        }
      }, {
        select: { gameNumber: 1, gameName: 1, halls: 1, withdrawNumberArray: 1, groupHalls: 1, withdrawNumberList: 1, seconds: 1, 'otherData.masterHallId': 1, 'otherData.agents': 1, 'otherData.minseconds': 1, 'otherData.maxseconds': 1, 'otherData.agents': 1, 'otherData.isTestGame': 1, parentGameId: 1, countDownTime: 1,specialGame:1, jackpotDraw: 1, jackpotPrize: 1 },
        sort: { startDate: 1, sequence: 1 }
      });

      if (nextGame.length) {
        console.log("nextGame", nextGame[0]);

        return {
          status: "success",
          data: nextGame[0]
        }
      }
      return {
        status: "fail",
        data: null
      }
    } catch (error) {
      console.error("Error while fetching next game", error);
      return {
        status: "fail",
        data: null
      }
    }
  },

  getOnGoingGame: async function (data) {
    try {
      console.log("Ongoing Game fetch data called", data);
      const startDate = new Date();
      const endDate = new Date();
      startDate.setHours(0, 0, 0);
      endDate.setHours(23, 59, 59);

      console.log(startDate, endDate);
      const ongoingGame = await Sys.Game.AdminEvents.Services.GameServices.getGameData({
        gameType: 'game_1',
        $or: [{
          "status": "running",
        }, {
          "status": "finish",
          "otherData.gameSecondaryStatus": "running",
        }],
        halls: data.hallId,
        startDate: {
          $gte: startDate,
          $lte: endDate
        }
      }, {
        select: { gameNumber: 1, gameName: 1, withdrawNumberArray: 1,seconds: 1, groupHalls: 1, withdrawNumberList: 1, winners: 1, 'otherData.masterHallId': 1, 'otherData.agents': 1, 'otherData.minseconds': 1, 'otherData.maxseconds': 1, 'otherData.agents': 1, 'otherData.isTestGame': 1, parentGameId: 1, adminWinners: 1, wofWinners: 1, status: 1, 'otherData.minigameManualReward': 1 }
      });
      console.log("ongoing game", ongoingGame?.gameNumber, "in hall", data.hallId);

      if(ongoingGame && ongoingGame?.parentGameId){
        let checkForUpcomingGame = await  module.exports.checkIftoEnableUpcomingGameButton(ongoingGame?.parentGameId);
        if(checkForUpcomingGame?.isEnable){
          ongoingGame.isEnableUpcomingGameButton = true;
        }
      }

      if(ongoingGame?.groupHalls){
        let myGroupHalls = getMyGroupHalls(ongoingGame?.groupHalls, data?.hallId);  
        ongoingGame.myGroupHalls = myGroupHalls.filter(hall => hall.status === "active"); // only send active hall, don't include stopped halls 
      }

      if (ongoingGame) {
        ongoingGame.canDistributeWOFPrize =
          ongoingGame?.gameName === "Wheel of Fortune" &&
          ongoingGame?.status === "finish" &&
          ongoingGame?.wofWinners?.length > 0 &&
          ongoingGame.wofWinners.every(winner => winner.playerType === "Physical");
        ongoingGame.wofPrize = ongoingGame?.otherData?.minigameManualReward || 0;
      }
      
      
      return {
        status: "success",
        data: ongoingGame
      }
    } catch (error) {
      console.error("Error while fetching ongoing game1", error);
      return {
        status: "fail",
        data: null
      }
    }
  },

  getHallBalance: async function (data) {
    try {
      console.log("get hall shift balance", data);
      const shift = await Sys.App.Services.AgentServices.getSingleShiftData({ _id: data.shiftId });
      let hall = await Sys.App.Services.HallServices.getSingleHallData({ _id: shift.hallId }, { hallCashBalance: 1 });
      return {
        shiftId: shift._id.toString(),
        hallId: shift.hallId,
        dailyBalance: shift.dailyBalance,
        totalCashIn: shift.totalCashIn,
        totalCashOut: shift.totalCashOut,
        totalHallCashBalance: hall.hallCashBalance
      }
    } catch (error) {
      console.error("Error while fetching hall balance", error);
      return {
        shiftId: null,
        hallId: null,
        dailyBalance: null,
        totalCashIn: null,
        totalCashOut: null,
        totalHallCashBalance: null
      }
    }
  },

  getHallStatus: async function (data) {
    try {
      await Sys.App.Controllers.agentcashinoutController.setHallStausWithColorCode({ gameId: data.gameId, hallId: data.hallId });
      return {
        status: "success"
      };
    } catch (e) {
      console.log("Error in sending hall status");
    }
  },

  getWithdrawPenddingRequest: async function (data) {
    try {
      console.log("get withdraw pending request", data);
      let { hallId } = data
      let query = {
        status: "pending",
        hallId: hallId,
        view: false
      };
      let reqDepositCount = await Sys.App.Services.transactionServices.getCountDeposit(query);

      let reqWithdrawCount = await Sys.App.Services.transactionServices.getCountWithdraw(query);
      let reqCount = reqDepositCount + reqWithdrawCount;
      return { status: "success", reqCount: reqCount };
    } catch (error) {
      console.log("error", error);
      return { status: "fail" };
    }
  },
  gameCountDownTimeUpdate: async function (data) {
    try {
      console.log("gameCountDownTimeUpdate Data", data);
      let { id, time, current_language } = data

      if (Number(time) < 1) {
        return {
          status: "fail",
          message: "Please select a greater than 0 minute"
        }
      }

      const Game = await Sys.Game.AdminEvents.Services.GameServices.getByData({
        gameType: 'game_1',
        status: "active",
        _id: id
      })

      if (!Game) {
        return {
          status: "fail",
          message: "Game not found"
        }
      }

      await Sys.Game.AdminEvents.Services.GameServices.updateGameData({ _id: id }, {
        countDownTime: Number(time)
      })

      return {
        status: "success",
        message: await Sys.Helper.bingo.getSingleTraslateData(["countdown_update_success"], current_language) //"Countdown time updated successfully"
      }

    } catch (error) {
      console.log("error gameCountDownTimeUpdate", error);
      return {
        status: "fail"
      }
    }

  },

  secondToDisplaySingleBallUpdate: async function (data) {
    try {
      console.log("secondToDisplaySingleBallUpdate Data", data);
      let { gameId, secondValue, current_language } = data

      if (Number(secondValue) < 1) {
        return {
          status: "fail",
          message: "Please select a greater than 0 second"
        }
      }

      const result = await Sys.Game.AdminEvents.Services.GameServices.updateGameData(
        { _id: gameId }, { seconds: Number(secondValue) }
      );
   
      if (!result.matchedCount) return { status: "fail", message: "Game not found" };
      if (result.modifiedCount) {
        let redisGame = await getGameDataFromRedisHmset('game1', gameId,[ 'seconds',"_id" ]);
        if(redisGame && redisGame?._id){
          await saveGameDataToRedisHmset('game1', gameId, { seconds: Number(secondValue) });
        }
      }

      return {
        status: "success",
        message: await Sys.Helper.bingo.getSingleTraslateData(["seconds_of_display_single_ball_update_success"], current_language) //"Second to display single ball updated successfully"
      }

    } catch (error) {
      console.log("error secondToDisplaySingleBallUpdate", error);
      return {
        status: "fail"
      }
    }

  },

  checkTransferHallAccess: async function (data) {
    try {
      const { hallId } = data;
      const now = moment();
      const startDate = now.clone().startOf('day').toDate();
      const endDate = now.clone().endOf('day').toDate();
  
      const currentHallGame = await Sys.Game.AdminEvents.Services.GameServices.getSingleGameData({
        gameType: 'game_1',
        status: 'active',
        halls: hallId,
        stopGame: false,
        'otherData.isClosed': false,
        startDate: { $gte: startDate, $lte: endDate }
      }, { parentGameId: 1 }, { sort: { startDate: 1, sequence: 1 } });
  
      const parentGameId = currentHallGame?.parentGameId;
      if (!parentGameId) {
        return { status: "fail", message: "Transfer hall access is not present" };
      }
  
      const dailySchedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData(
        { _id: parentGameId },
        { 'otherData.transferHall': 1 }
      );
  
      const transferHall = dailySchedule?.otherData?.transferHall;
      if (
        transferHall?.validTill &&
        transferHall?.transferHallId === hallId &&
        moment(transferHall.validTill).isAfter(moment())
      ) {
        console.log("transferHall.validTill", transferHall.validTill);
        await Sys.Io.of('admin').to(hallId).emit('hallTransferRequest', {
          id: hallId,
          message: "Hall Transfer Request"
        });
  
        return { status: "success", message: "Transfer hall access is present" };
      }
  
      return { status: "fail", message: "Transfer hall access is not present" };
  
    } catch (error) {
      console.error("Error in checkTransferHallAccess:", error);
      return { status: "error", message: "Internal server error" };
    }
  },
  
  transferHallAccess: async function (data) {
    try {
      const { 
        transferHallId, 
        hallId, 
        current_language, 
        actionTakenByRole = "agent", 
        dailyScheduleId = null 
      } = data;

      // Check for existing request first
      if (hallRequestTime[hallId]?._idleTimeout > 0) {
        return {
          status: "fail",
          message: await Sys.Helper.bingo.getSingleTraslateData(["request_already_sent"], current_language)
        };
      }

      let scheduleData = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData(
        { _id: dailyScheduleId },
        { masterHall: 1, 'otherData.transferHall': 1 }
      );

      let masterHallId = scheduleData?.masterHall?.id;
      if(masterHallId == transferHallId){
        return {
          status: "fail",
          message: await Sys.Helper.bingo.getSingleTraslateData(["already_master_hall"], current_language)
        };
      }

      // Check if there is already trasfer request for particular daily schedule
      const transferHall = scheduleData?.otherData?.transferHall;
      if (
        transferHall?.validTill &&
        moment(transferHall.validTill).isAfter(moment())
      ) {
        return { status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["transfer_hall_request_already_sent"], current_language) };
      }

      // Prepare data for parallel operations
      const hallIdDat = `${hallId}_${transferHallId}`;
      const validTill = new Date(Date.now() + 60000); // 1 minute from now
      const transferHallData = {
        hallId,
        transferHallId,
        actionTakenByRole,
        validTill
      };

      // Execute operations in parallel
      const [translate] = await Promise.all([
        Sys.Helper.bingo.getSingleTraslateData(["waitin_for_hall_res"], current_language),
        Sys.Io.of('admin').to(transferHallId).emit('hallTransferRequest', { 
          id: transferHallId, 
          message: "Hall Transfer Request" 
        }),
        dailyScheduleId && Sys.App.Services.scheduleServices.updateDailySchedulesData(
          { _id: dailyScheduleId },
          { $set: { 'otherData.transferHall': transferHallData } }
        )
      ]);

      // Set timeout after successful operations
      createTime(hallIdDat, actionTakenByRole, current_language);

      return {
        status: "success",
        message: translate
      };

    } catch (error) {
      console.error("Error in transferHallAccess:", error);
      return {
        status: "fail",
        message: "Something went wrong"
      };
    }
  },

  approveTransferHallAccess: async function (data) {
    try {
      const { id, parentGameId, type, current_language } = data;
      
      // Fetch translations and initial data in parallel
      const [translate, dailySchedule] = await Promise.all([
        Sys.Helper.bingo.getTraslateData([
          "no_next_game_found", 
          "no_hall_data_found", 
          "request_timeout", 
          "approve_success", 
          "reject_success", 
          "master_hall_transfer_reject", 
          "master_hall_request_accepted"
        ], current_language),
        Sys.App.Services.scheduleServices.getDailySingleSchedulesData(
          { _id: parentGameId }, 
          { masterHall: 1, 'otherData.transferHall': 1 }
        )
      ]);

      // Extract transfer hall data
      const transferHall = dailySchedule?.otherData?.transferHall;
      const requestedBy = transferHall?.actionTakenByRole || "agent";
      const hallReqId = transferHall 
        ? `${transferHall.hallId}_${id}`
        : `${dailySchedule?.masterHall?.id}_${id}`;

      // Early validation for agent requests
      if (requestedBy === "agent") {
        const nextGameCount = await Sys.Game.AdminEvents.Services.GameServices.getGameCount({
          parentGameId,
          gameType: 'game_1',
          status: "active",
        });

        if (nextGameCount === 0) {
          return {
            status: "fail",
            message: translate.no_next_game_found
          };
        }
      }

      // Validate hall data
      const hallData = await Sys.Game.AdminEvents.Services.GameServices.getSingleHallData(
        { _id: id },
        { _id: 1, name: 1 }
      );

      if (!hallData) {
        return {
          status: "fail",
          message: translate.no_hall_data_found
        };
      }

      // Check request timeout
      if (hallRequestTime[hallReqId]?._idleTimeout < 0) {
        return {
          status: "fail",
          message: translate.request_timeout
        };
      }

      // Clear the timeout
      clearTimeout(hallRequestTime[hallReqId]);

      // Prepare common update data
      const updateData = {
        'otherData.transferHall': {}
      };

      if (type === 'approve') {
        // Add master hall data for approval
        updateData.masterHall = {
          id: hallData._id.toString(),
          name: hallData.name
        };

        // Execute approval operations in parallel
        await Promise.all([
          Sys.App.Services.scheduleServices.updateDailySchedulesData(
            { _id: parentGameId },
            { $set: updateData }
          ),
          Sys.Game.AdminEvents.Services.GameServices.updateManyGameData(
            { parentGameId },
            { 'otherData.masterHallId': id }
          )
        ]);

        // Emit socket events
        Sys.Io.of('admin').to(dailySchedule?.masterHall?.id).emit('pageRefresh');
        Sys.Io.of('admin').to(id).emit('pageRefresh');

        if (requestedBy === "admin") {
          Sys.Io.of('admin').emit('adminTrasferAccessResponse', {
            status: "success",
            dailyScheduleId: parentGameId,
            message: translate.master_hall_request_accepted
          });
        }

        return {
          status: "success",
          message: translate.approve_success
        };
      }

      // Handle rejection
      await Sys.App.Services.scheduleServices.updateDailySchedulesData(
        { _id: parentGameId },
        { $set: updateData }
      );

      // Emit appropriate response based on request type
      if (requestedBy === "agent") {
        Sys.Io.of('admin').to(dailySchedule?.masterHall?.id).emit('popupResponce', {
          message: translate.master_hall_transfer_reject
        });
      } else {
        Sys.Io.of('admin').emit('adminTrasferAccessResponse', {
          status: "fail",
          message: translate.master_hall_transfer_reject
        });
      }

      return {
        status: "error",
        message: translate.reject_success
      };

    } catch (error) {
      console.error("Error in approveTransferHallAccess:", error);
      return {
        status: "fail",
        message: "Something went wrong"
      };
    }
  },

  checkIftoEnableUpcomingGameButton: async function(parentGameId) {
    try {
      // Fetch games based on conditions
      const allGames = await Sys.App.Services.GameService.getGamesByData(
          { gameType: "game_1", parentGameId: parentGameId, status: { $ne: "finish" } },
          { status: 1, sequence: 1, stopGame: 1 }
      );
      console.log("allGames---", allGames, parentGameId)
      if (!allGames?.length) return {isEnable: false}

      // Sort games by sequence in ascending order
      allGames.sort((a, b) => a.sequence - b.sequence);

      // Filter for active or running games that are not stopped
      const activeGames = allGames.filter(g => g.status === 'running' || (g.status === 'active' && !g.stopGame));

      if (activeGames.length === 1) {
          const activeGame = activeGames[0];

          // Check if activeGame has the highest sequence
          const hasHighestSequence = allGames.every(g => g.sequence <= activeGame.sequence);

          if (!hasHighestSequence) {
              console.log("The active game does not have the highest sequence. Enable the upcoming game button.");
              return {isEnable: true}
          }
          
      }
      return {isEnable: false}
    } catch (error) {
      console.error("Error fetching or processing games:", error);
    }
  },

}

async function createTime(hallId, actionTakenByRole, current_language) {
  try {
    clearTimeout(hallRequestTime[hallId])
    hallRequestTime[hallId] = setTimeout(async (hallId) => {
      clearTimeout(hallRequestTime[hallId])
      hallId = hallId.split("_")
      if (hallId) {
        let translate = await Sys.Helper.bingo.getSingleTraslateData(["hall_has_not_responded_to_master_hall_transfer_request"], current_language);
        if(actionTakenByRole == "agent"){
          Sys.Io.of('admin').to(hallId[0]).emit('popupResponce', { message: translate });
        }else{
          Sys.Io.of('admin').emit('adminTrasferAccessResponse', { status: "fail", message: translate });
        }
      }
    }, 60000, hallId);
  } catch (error) {
    console.log("error", error);
  }

}
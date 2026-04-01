const Sys = require('../../../Boot/Sys');
const moment = require('moment');
const fs = require("fs");
const fastcsv = require("fast-csv");
const path = require('path');
const fortuna = require('javascript-fortuna');
fortuna.init();
const exactMath = require('exact-math');
const { i18next, translate } = require('../../../Config/i18n');
const Timeout = require('smart-timeout');
const Game1Helper = require('../../../gamehelper/game1');
const { isPlayerBlockedFromGame } = require('../../../gamehelper/player_common.js');
const { createErrorResponse, getPlayerIp, checkPlayerSpending, updatePlayerHallSpendingData, checkGamePlayAtSameTime } = require('../../../gamehelper/all.js');
const { getAllJackpotPrizes, getNextGame } = require('../../../gamehelper/game1');
const { formatWinningTickets } = require('../../../gamehelper/game1-process');

module.exports = {

    Game1Room: async function (socket, data) {
        try {
            const { playerId, language: inputLang = "nor" } = data;
            if (!playerId) return Game1Helper.createErrorResponse("player_not_found", inputLang);
    
            /** -------- Fetch Player (only required fields) -------- */
            const player = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                { _id: playerId },
                {
                    hall: 1,
                    selectedLanguage: 1,
                    bankIdAuth: 1,
                    isVerifiedByHall: 1,
                    isAlreadyApproved: 1,
                    blockRules: 1
                }
            );
    
            if (!player)
                return Game1Helper.createErrorResponse("player_not_found", inputLang);
    
            const language = player.selectedLanguage || inputLang;
    
            /** -------- Check if Player is Blocked -------- */
            const playerIp = getPlayerIp({
                handshake: { headers: socket?.handshake?.headers },
                conn: { remoteAddress: socket?.conn?.remoteAddress }
            });
    
            const isBlocked = await isPlayerBlockedFromGame({
                hallId: player.hall.id,
                playerIp,
                gameType: "game",
                blockRules: player.blockRules,
            });
    
            if (isBlocked)
                return createErrorResponse("player_blocked_game", language, 400);
    
            /** -------- Player Verification -------- */
            if (!Game1Helper.isPlayerVerified(player))
                return Game1Helper.createErrorResponse("verify_to_play_game", language);
    
            /** -------- Validate Hall -------- */
            if (!Game1Helper.isValidHall(player.hall))
                return Game1Helper.createErrorResponse("no_ongoing_game", language);
    
            /** -------- Fetch Running/Upcoming Games -------- */
            const query = Game1Helper.findActiveRunningGameQuery(player.hall.id);
    
            const games = await Sys.Game.Game1.Services.GameServices.getByData(
                query,
                {
                    _id: 1,
                    gameName: 1,
                    status: 1,
                    players: 1,
                    subGames: 1,
                    otherData: 1,
                    startDate: 1
                },
                { sort: { startDate: 1 } }
            );
    
            if (!games?.length)
                return Game1Helper.createErrorResponse("no_ongoing_game", language);
    
            const { runningGame, upcomingGame } =
                Game1Helper.processRunningUpcomingGames(games, playerId);
    
            // console.log("runningGame:", runningGame);
            // console.log("upcomingGame:", upcomingGame);
            return {
                status: "success",
                result: { runningGame, upcomingGame },
                message: await translate({
                    key: "games_found",
                    language
                }),
                statusCode: 200
            };
    
        } catch (error) {
            console.log("Error In Game1Room:", error);
            return Game1Helper.createErrorResponse("something_went_wrong", data.language || "nor");
        }
    },

    subscribeRoom: async function (socket, data) {
        // local helper for fire-and-forget async calls
        const fireAndForget = (p) => p.catch(err => console.error('background task error', err));
        try {
          // ---- 1) destructure + defaults ----
          const {
            playerId,
            gameId,
            language: inputLanguage = "nor",
            isInternal = false,
            callCount: inputCallCount = 0
          } = data || {};
      
          let language = inputLanguage;
          const callCount = isInternal ? inputCallCount : 0;
      
          // ---- 2) basic validation ----
          if (!playerId) return Game1Helper.createErrorResponse("player_not_found", language);
          if (!gameId) return Game1Helper.createErrorResponse("no_ongoing_game", language);
      
          // ---- 3) fetch minimal player data ----
          const player = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
            { _id: playerId },
            { status: 1, hall: 1, selectedLanguage: 1, _id: 1 }
          );
      
          if (!player) return Game1Helper.createErrorResponse("player_not_found", language);
      
          language = player.selectedLanguage || language;
          if ((player.status || '').toLowerCase() !== 'active') {
            return Game1Helper.createErrorResponse("player_not_active", language);
          }
      
          // ---- 4) build room query (use local moment instances) ----
          const today = moment().startOf('day');
          const tomorrow = moment(today).add(2, 'day');
      
          const roomQuery = {
            _id: gameId,
            halls: { $in: [player.hall.id] },
            stopGame: false,
            'otherData.gameSecondaryStatus': { $ne: "finish" },
            'otherData.isClosed': false,
            startDate: { $gte: today.toDate(), $lt: tomorrow.toDate() }
          };
      
          // ---- 5) fetch room with only required fields ----
          const room = await Sys.Game.Game1.Services.GameServices.getSingleByData(roomQuery, {
            players: 1,
            subGames: 1,
            status: 1,
            withdrawNumberList: 1,
            winners: 1,
            gameName: 1,
            jackpotPrize: 1,
            parentGameId: 1,
            earnedFromTickets: 1,
            otherData: 1,
            sequence: 1,
            isNotificationSent: 1,
            adminWinners: 1,
            jackpotDraw: 1,
            countDownDateTime: 1
          });
      
          // ---- 6) redirect to upcoming if no room or needs redirect ----
          if (!room || Game1Helper.shouldRedirectToNextGame(room)) {
            const resp = await module.exports.checkForUpcomingGameForSubscribeRoom(socket, { language, playerId, callCount });
            if (resp && resp.status === "fail") resp.messageType = resp.message;
            return resp;
          }
      
          // ---- 7) update player's socket info in background (non-blocking) ----
          if (room.players) {
            fireAndForget(
              Sys.Game.Game1.Services.GameServices.updateGameNested(
                { _id: room._id, "players.id": playerId },
                { $set: { "players.$.socketId": socket.id, "players.$.isPlayerOnline": true } },
                { new: true }
              )
            );
          }
      
          // ---- 8) Parallelize independent I/O: patternListing, tickets, jackpot calc, minigame ----
          // NOTE: patternListing uses controller method; tickets are filtered by player and game
          const [
            patternListingResult,
            allPurchasedTickets,
            minigameData
          ] = await Promise.all([
            Sys.Game.Game1.Controllers.GameProcess.patternListing(room._id),
            Sys.Game.Game1.Services.GameServices.getTicketListData(
              { playerIdOfPurchaser: player._id, gameId: room._id },
              { ticketId: 1, ticketParentId: 1, ticketPrice: 1, hallName: 1, ticketColorName: 1, ticketColorType: 1, tickets: 1, isTicketSubmitted: 1, supplier: 1, developer: 1 }
            ),
            Game1Helper.getMinigameData(room, language)
          ]);
      
          // Process pattern list quickly (sync)
          const finalPatternList = Game1Helper.processPatternList(patternListingResult.patternList, room.winners);
      
          // Format tickets (sync)
          const ticketsArr = Game1Helper.formatPurchasedTickets(allPurchasedTickets || []);
      
          // Jackpot calculation can be done as a separate async call if heavy, keep parallel
          const jackPotPromise = module.exports.getJackpotData(
            room.gameName,
            (room.withdrawNumberList || []).length,
            room.jackpotDraw,
            room.jackpotPrize,
            room.subGames,
            room.parentGameId
          );
      
          // ---- 9) join socket room and set socket metadata ----
          await socket.join(room._id);
          socket.myData = {
            playerID: playerId,
            gameId: room._id,
            gameType: 'game_1',
            gameName: room.gameName || 'Spillorama',
            isAdmin: false
          };
      
          // ---- 10) get online players and emit (sequential after join) ----
          const onlinePlayers = await getOnlinePlayers('/Game1', room._id);
      
          // emit updated online count to room (use namespace)
          Sys.Io.of(Sys.Config.Namespace.Game1).to(room._id).emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });
      
          // resolve jackpot promise (it was parallel)
          const jackPotData = await jackPotPromise;
      
          // ---- 11) Build subscribe response (single helper) ----
          const result = await Game1Helper.createSubscribeRoomResponse(
            room,
            player,
            finalPatternList,
            ticketsArr,
            onlinePlayers,
            jackPotData,
            minigameData,
            language
          );
      
          // Send to the connecting socket only
          Sys.Io.of(Sys.Config.Namespace.Game1).to(socket.id).emit('SubscribeRoom', result);
            
          return {
            status: 'success',
            result,
            message: 'Player Subscribed Successfully.'
          };
      
        } catch (error) {
          console.error("Error in subscribeRoom:", error);
          return {
            status: 'fail',
            result: null,
            message: await translate({ key: "something_went_wrong", language: data?.language || "nor" }),
            statusCode: 500
          };
        }
      },      
    
    PurchaseGame1Tickets: async function (socket, data) {
        try {
            console.log("PurchaseGame1Tickets data:", data);
            const language = data.language || "nor";
            if (data.purchaseType == null) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "purchasetype_not_found", language: language }), // 'PurchaseType is not found',
                }
            }
    
            // Parallel data fetching with Promise.all
            const [player, room] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: data.playerId },
                    { userType: 1, uniqueExpiryDate: 1, isCreatedByAdmin: 1, hall: 1, username: 1, 
                    points: 1, walletAmount: 1, monthlyWallet: 1, monthlyWalletAmountLimit: 1, 
                    uniqueId: 1, socketId: 1, selectedLanguage: 1, blockRules: 1 }
                ),
                Sys.Game.Game1.Services.GameServices.getSingleByData(
                    { _id: data.gameId },
                    { halls: 1, 'otherData.isTestGame': 1 }
                ),
            ]);
    
            if (!player) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }
            if (!room) {
                return {
                    status: 'fail',
                    result: null,
                    messageType: await translate({ key: "game_not_found", language: player.selectedLanguage }), // "No Game Available",
                    message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found'
                }
            }
            if(room?.otherData?.isTestGame){
                return {
                    status: 'fail',
                    result: null,
                    messageType: await translate({ key: "game1_test_game_validation", language: player.selectedLanguage }), // "No Game Available",
                    message: await translate({ key: "game1_test_game_validation", language: player.selectedLanguage }), // 'Game data is not found'
                }
            }
            // Check if player is already in a running game
            // const isRunningGame = await checkGamePlayAtSameTime(data.playerId,"game_1");
            // if (isRunningGame.status) {
            //     return {
            //         status: 'fail',
            //         result: null,
            //         message: await translate({ key: `game_already_started_${isRunningGame.gameType}`, language: player.selectedLanguage }), // 'PurchaseType is not found',
            //     }
            // }

            // check if player is blocked from game
            const isPlayerBlocked = await isPlayerBlockedFromGame({
                hallId: player.hall.id,
                playerIp: getPlayerIp({
                    handshake: { headers: socket?.handshake?.headers },
                    conn: { remoteAddress: socket?.conn?.remoteAddress }
                }),
                gameType: "game",
                blockRules: player?.blockRules,
            });

            if (isPlayerBlocked) {
                return await createErrorResponse("player_blocked_game", player.selectedLanguage, 400);
            }
    
            let hallData = await Sys.Game.Common.Services.GameServices.getSingleHallData({ _id: player.hall.id })
            
            let ip = socket?.handshake?.headers['x-forwarded-for'] ? socket?.handshake?.headers['x-forwarded-for'].split(',')[0] : socket?.conn?.remoteAddress;
            ip = convertIPv6MappedToIPv4(ip);
            let userTicketType = ip == hallData.ip ? 'Terminal' : 'Web';
    
            // check for voucher 
            let voucherData = '';
            let vId = '';
            if (data.voucherCode != undefined && data.voucherCode != null && data.voucherCode != "") {
    
                let vocherTransaction = await Sys.Game.Common.Services.PlayerServices.transactionData({ playerId: data.playerId, voucherCode: data.voucherCode })
                //console.log('vocherTransaction2: ', vocherTransaction[0]);
                if (vocherTransaction.length == 0) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "vourcher_not_purchased", language: player.selectedLanguage }), // 'This Voucher Code is not Purchased by You..!!',
                        statusCode: 400
                    }
                }
    
                if (!vocherTransaction[0].isVoucherApplied) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_not_applied", language: player.selectedLanguage }), // 'This Voucher Code is not Applied by You..!!',
                        statusCode: 400
                    }
                }
    
                voucherData = await Sys.App.Services.VoucherServices.getSingleData({ _id: vocherTransaction[0].voucherId });
                vId = vocherTransaction[0]._id;
                if (!voucherData) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_not_valid", language: player.selectedLanguage }), //'This Voucher is not Vaild or Deleted by Admin!!',
                    }
                }
    
                if (voucherData.status != 'active') {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_blocked", language: player.selectedLanguage }), // 'This Voucher is Blocked by Admin!!',
                    }
                }
    
                let currentDate = Date.now();
                let expiryDate = new Date(voucherData.expiryDate);
                if (currentDate > expiryDate) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "voucher_expired", language: player.selectedLanguage }), //'This Voucher is Expired',
                    }
                }
    
            }
    
            let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId, status: { $in: ['active', 'running'] } }, { graceDate: 1, startDate: 1, halls: 1, subGames: 1, gameName: 1, gameNumber: 1, players: 1, disableTicketPurchase: 1, parentGameId: 1, day: 1, stopGame: 1 });
    
            if (gameData === null) {
                console.log("something went wrong, game data not found")
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "game_started", language: player.selectedLanguage }), // 'Game Already Started',
                    statusCode: 401
                }
            }
    
            if (gameData.disableTicketPurchase == true) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "ticket_purchase_disabled", language: player.selectedLanguage }), // 'Ticket purchase has been disabled for this game',
                    statusCode: 401
                }
            }
            if (gameData.stopGame == true) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }), // 'Something went wrong',
                    statusCode: 401
                }
            }
    
            // check for game time and unique id expired time
            if (player.userType == "Unique") {
                if (player.uniqueExpiryDate <= gameData.startDate) {
                    console.log("Your Unique Id will be Expired before starting of the game, please Contact Administrator.")
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "unique_id_will_expire", language: player.selectedLanguage }), // 'Your Unique Id will be Expired before starting of the game, please Contact Administrator.',
                        statusCode: 401
                    }
                }
            }
    
            // check player is allowed or not to play in defined halls
            //console.log("halls of game and player", gameData.halls, player.hall);
            if (gameData.halls.length > 0) {
                if (player.userType == "Unique" && player.isCreatedByAdmin == true) {
                    console.log("Unique userType with admin creator, so no need to check for hall")
                } else {
                    let playerHalls = [];
                    if (player.hall.status == "Approved") {
                        playerHalls.push(player.hall.id.toString());
                    }
                    let gameHalls = gameData.halls.map(function (item) {
                        return item.toString();
                    });
                    console.log("player approved halls", playerHalls, gameHalls)
                    const isHallmatched = playerHalls.some(r => gameHalls.includes(r));
                    console.log("isHallmatched", isHallmatched)
                    if (isHallmatched == false) {
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({ key: "not_allowed_to_play_in_hall", language: player.selectedLanguage }), // 'You are not allowed to play in this hall!',
                            statusCode: 401
                        }
                    }
                }
            }
    
            // Get total ticket price from subgame tickets
            let subgame = gameData.subGames[0].options;
            let TotalAmountOfTickets = 0;
            let ticketColorTypeArray = [];
            let ticketQnty = 0;
            const ticketDetails = {};
            let playerPurTickets = JSON.parse(data.purchasedTickets).list;
            //let playerPurTickets = [{ticketName: 'Large Yellow', ticketQty: 3}, {ticketName: 'Small Yellow', ticketQty: 3}]; //[{ticketName: 'Large Yellow', ticketQty: 3}, {ticketName: 'Small Yellow', ticketQty: 3}];
            console.log("playerPurTickets", playerPurTickets, typeof playerPurTickets)
            if (gameData.gameName == "Traffic Light") {
                
                let ticketQ = playerPurTickets[0].ticketQty;
                playerPurTickets = [];
                playerPurTickets.push({ ticketName: 'Traffic Light', ticketQty: ticketQ })
    
            } else if (gameData.gameName == "Elvis") {
                //let playerPurTicketsTemp = [{ticketName: 'Elvis', ticketQty: 2}];
                let elvisQnty = playerPurTickets[0].ticketQty;
    
                let selectedElvisinAdminTemp = gameData.subGames[0].ticketColorTypes;
                let selectedElvisinAdmin = [1, 2, 3, 4, 5];
                if (gameData.subGames[0].ticketColorTypes.length > 0) {
                    selectedElvisinAdmin = selectedElvisinAdminTemp.map((element, index) => {
                        return parseInt(element.slice(11));
                    });
                }
                console.log("selectedElvisinAdmin", selectedElvisinAdmin);
    
                let selected = randomWithProbability(elvisQnty, selectedElvisinAdmin);
                //console.log("selected", selected);
                playerPurTickets = [];
                for (let s = 0; s < selected.length; s++) {
                    playerPurTickets.push({ ticketName: 'Small Elvis' + selected[s], ticketQty: 1 })
                }
                //console.log("playerPurTicketsTemp elvis tickets", playerPurTicketsTemp)
            }
            console.log("playerPurTickets final", playerPurTickets);
            if (subgame.length > 0) {
                let isTicketsFound = false;
    
                if (playerPurTickets.length > 0) {
                    for (let p = 0; p < playerPurTickets.length; p++) {
                        if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName == "Traffic Light") {
                            isTicketsFound = true;
                            TotalAmountOfTickets += subgame[0].ticketPrice * parseInt(playerPurTickets[p].ticketQty);
                            let availableTrafficLightTickets = [];
                            for (let t = 0; t < subgame.length; t++) {
                                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId }, {
                                    $inc: { 'subGames.$[].options.$[o].totalPurchasedTickets': (parseInt(playerPurTickets[p].ticketQty)) }
                                }, { arrayFilters: [{ "o.ticketName": subgame[t].ticketName }], new: true });
                                availableTrafficLightTickets.push(subgame[t].ticketName);
                            }
                            for (let c = 0; c < parseInt(playerPurTickets[p].ticketQty); c++) {
                                for (let t = 0; t < availableTrafficLightTickets.length; t++) {
                                    if (availableTrafficLightTickets[t] == 'Small Red') {
                                        console.log("Small Red ticket found", availableTrafficLightTickets[t]);
    
                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(1)).fill({ ticketName: availableTrafficLightTickets[t], price: subgame[0].ticketPrice, type: "traffic-red" }));
                                        ticketQnty = ticketQnty + 1;
    
    
                                    } else if (availableTrafficLightTickets[t] == 'Small Yellow') {
                                        console.log("Small Yellow ticket found", availableTrafficLightTickets[t]);
    
                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(1)).fill({ ticketName: availableTrafficLightTickets[t], price: subgame[0].ticketPrice, type: "traffic-yellow" }));
                                        ticketQnty = ticketQnty + 1;
    
                                    } else if (availableTrafficLightTickets[t] == 'Small Green') {
                                        console.log("Small Green ticket found", availableTrafficLightTickets[t]);
    
                                        ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(1)).fill({ ticketName: availableTrafficLightTickets[t], price: subgame[0].ticketPrice, type: "traffic-green" }));
                                        ticketQnty = ticketQnty + 1;
    
                                    }
                                }
                            }
    
                        } else {
                            const index = subgame.findIndex((e) => e.ticketName == playerPurTickets[p].ticketName);
                            if (index != -1) {
                                isTicketsFound = true;
                                console.log("subgame[s].ticketPrice & total tickets to purchase", playerPurTickets[p].ticketName, playerPurTickets[p].ticketQty);
    
                                Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId }, {
                                    $inc: { 'subGames.$[].options.$[o].totalPurchasedTickets': (parseInt(playerPurTickets[p].ticketQty)) }
                                }, { arrayFilters: [{ "o.ticketName": playerPurTickets[p].ticketName }], new: true });
    
                                TotalAmountOfTickets += subgame[index].ticketPrice * parseInt(playerPurTickets[p].ticketQty);
                                //ticketColorTypeArray.push({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice });
    
                                if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName.includes('Small Red')) {
                                    console.log("Small Red ticket found", playerPurTickets[p].ticketName);
    
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "traffic-red" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);
    
    
                                } else if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName.includes('Small Yellow')) {
                                    console.log("Small Yellow ticket found", playerPurTickets[p].ticketName);
    
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "traffic-yellow" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);
    
                                } else if (gameData.gameName == "Traffic Light" && playerPurTickets[p].ticketName.includes('Small Green')) {
                                    console.log("Small Green ticket found", playerPurTickets[p].ticketName);
    
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "traffic-green" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);
    
                                }
    
                                else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis1')) {
                                    console.log("elvis1 ticket found", playerPurTickets[p].ticketName);
    
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);
    
                                } else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis2')) {
                                    console.log("elvis2 ticket found", playerPurTickets[p].ticketName);
    
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);
    
                                } else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis3')) {
                                    console.log("elvis3 ticket found", playerPurTickets[p].ticketName);
    
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);
    
                                } else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis4')) {
                                    console.log("elvis4 ticket found", playerPurTickets[p].ticketName);
    
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);
    
                                } else if (playerPurTickets[p].ticketName.toLowerCase().includes('elvis5')) {
                                    console.log("elvis5 ticket found", playerPurTickets[p].ticketName);
    
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 2)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "elvis" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 2);
    
                                }
    
                                else if (playerPurTickets[p].ticketName.toLowerCase().includes('small')) {
                                    console.log("small ticket found", playerPurTickets[p].ticketName);
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "small" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);
                                } else if (playerPurTickets[p].ticketName.toLowerCase().includes('large')) {
                                    console.log("large ticket found", playerPurTickets[p].ticketName);
                                    ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty * 3)).fill({ ticketName: subgame[index].ticketName, price: subgame[index].ticketPrice, type: "large" }));
                                    ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty * 3);
                                }
    
                                //ticketColorTypeArray = ticketColorTypeArray.concat(Array(parseInt(playerPurTickets[p].ticketQty)).fill({ ticketType: subgame[index].ticketType, price: subgame[index].ticketPrice, ticketColorName: subgame[index].ticketName }));
    
                                //ticketQnty = ticketQnty + parseInt(playerPurTickets[p].ticketQty);
                            } else {
                                isTicketsFound = false;
                                break;
                            }
                        }
                    }
                } else {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "select_tickets", language: player.selectedLanguage }), // 'Plese Select Tickets',
                    }
                }
    
                if (isTicketsFound == false) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "something_went_wrong", language: player.selectedLanguage }), // 'Something went wrong!',
                    }
                }
                //console.log("TotalAmountOfTickets and ticketColorTypeArray",ticketQnty, TotalAmountOfTickets, ticketColorTypeArray)
    
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "ticket_not_found", language: player.selectedLanguage }), // 'No tickets found',
                }
            }
    
            // check how many tickets player can purchase
            let alreadyPurchaseCount = await Sys.Game.Game1.Services.GameServices.getTicketCount({ playerIdOfPurchaser: player._id, gameId: gameData._id });
            if (alreadyPurchaseCount >= 30) {
                return {
                    status: 'fail',
                    result: {
                        playerId: player._id,
                        username: player.username,
                    },
                    message: await translate({ key: "already_purchased_tickets", language: player.selectedLanguage }), // 'Sorry ..!! You have already purchased 30 tickets , now can`t purchased anymore..!!  ',
                    statusCode: 401
                }
            } else {
                if (parseInt(alreadyPurchaseCount) + parseInt(ticketQnty) > 30) {
                    let purchaseCount = 30 - parseInt(alreadyPurchaseCount);
                    if (gameData.gameName == "Elvis") {
                        purchaseCount = parseInt(purchaseCount / 2);
                    } else if (gameData.gameName == "Traffic Light") {
                        purchaseCount = parseInt(purchaseCount / 3);
                    }
                    return {
                        status: 'fail',
                        result: {
                            playerId: player._id,
                            username: player.username,
                        },
                        message: await translate({ key: "purchase_limited_ticket", language: player.selectedLanguage, isDynamic: true, number: purchaseCount }), // 'Sorry ..!! You can purchase only ' + purchaseCount + ' tickets..!! ',
                        statusCode: 401
                    }
                }
            }
    
            // deduct wallet and update voucher
            if (TotalAmountOfTickets > 0 && data.voucherCode != undefined && data.voucherCode != null && data.voucherCode != '') {
                let offAmount = (TotalAmountOfTickets * voucherData.percentageOff) / 100;
                TotalAmountOfTickets = (TotalAmountOfTickets - offAmount);
                console.log("payable amount", payableAmount);
                await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: vId }, { isVoucherUse: true })
            }
            console.log("TotalAmountOfTickets after deducting voucher amount", TotalAmountOfTickets, ticketColorTypeArray);
            //Counting tickets for hall update
            const ticketFinalData = {};
            for (let i = 0; i < ticketColorTypeArray.length; i++) {
                if (ticketDetails[ticketColorTypeArray[i].ticketName.split(' ').join('').toLowerCase()]) {
                    ticketDetails[ticketColorTypeArray[i].ticketName.split(' ').join('').toLowerCase()].count += 1;
                } else {
                    ticketDetails[ticketColorTypeArray[i].ticketName.split(' ').join('').toLowerCase()] = {
                        type: ticketColorTypeArray[i].type,
                        count: 1
                    }
                }
            }
    
            const tikectKeys = Object.keys(ticketDetails);
    
            for (let i = 0; i < tikectKeys.length; i++) {
                if (ticketDetails[tikectKeys[i]].type == "large") {
                    ticketFinalData[tikectKeys[i]] = ticketDetails[tikectKeys[i]].count / 3;
                } else {
                    ticketFinalData[tikectKeys[i]] = ticketDetails[tikectKeys[i]].count;
                }
            }
    
            console.log("final ticket count data", ticketFinalData);

            // Check player spending limit before deducting wallet amount
            let deductPlayerSpending = await checkPlayerSpending({ playerId: data.playerId, hallId: player.hall.id, amount: +TotalAmountOfTickets });
            if(!deductPlayerSpending.isValid){
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: deductPlayerSpending.error, language: player.selectedLanguage }), // 'Ticket purchase has been disabled for this game',
                    statusCode: 401
                }
            }
    
            let purchasedSlug = data.purchaseType;
            let deductUserWallet = "";
            if (purchasedSlug == 'points') {
    
                if (player.points < TotalAmountOfTickets) {
                    return {
                        status: 'fail',
                        result: {
                            playerId: player._id,
                            username: player.username,
                        },
                        message: await translate({ key: "Insufficient_balance", language: player.selectedLanguage }), // 'Insufficient Balance ..!',
                        statusCode: 401
                    }
                }
                deductUserWallet = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: -TotalAmountOfTickets } });
    
            } else if (purchasedSlug == 'realMoney') {
    
                if (player.walletAmount < TotalAmountOfTickets) {
                    return {
                        status: 'fail',
                        result: {
                            playerId: player._id,
                            username: player.username,
                        },
                        message: await translate({ key: "Insufficient_balance", language: player.selectedLanguage }), // 'Insufficient Balance ..!',
                        statusCode: 401
                    }
                }
                //[ Monthly Wallet Amount Limit ]
                if (player.monthlyWallet == true && player.monthlyWalletAmountLimit < TotalAmountOfTickets) {
                    return {
                        status: 'fail',
                        result: {
                            playerId: player._id,
                            username: player.username,
                        },
                        message: await translate({ key: "update_wallet_limit", language: player.selectedLanguage }), // 'Please Update Your Monthly Wallet Amount Limit.!!',
                        statusCode: 401
                    }
                }
    
                deductUserWallet = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: -TotalAmountOfTickets, monthlyWalletAmountLimit: -TotalAmountOfTickets } });
    
            } else if (purchasedSlug == 'voucher') {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "voucher_not_applied_for_game", language: player.selectedLanguage }), // 'Voucher for this game can not applied now..!!',
                    statusCode: 401
                }
            }
            
            //[ Normal Ticket Buying...!!! ]
            let finalDataTicketTemp = [];
            console.time("Game 1 tickets purcahse find tickets");
            const uniqueIdentifier = Date.now().toString(36) + Math.random().toString(36).substring(2) + data.playerId + data.gameId + ticketQnty;
            console.log("uniqueIdentifier---", uniqueIdentifier);
            let resultBlock = await assignTickets(data.playerId, data.gameId, ticketQnty, 0, uniqueIdentifier);
            console.log("resultBlock---", resultBlock)
            if (resultBlock.success) {
                finalDataTicketTemp = await Sys.Game.Game1.Services.GameServices.getStaticByData(
                    { playerIdOfPurchaser: data.playerId, gameId: data.gameId, uniqueIdentifier: uniqueIdentifier },
                    { tickets: 1, ticketId: 1, _id: 1 }
                );
            } else {
                console.log("Ticket assignment failed. Partial allocation:", resultBlock.ticketIds);
            }
            console.timeEnd("Game 1 tickets purcahse find tickets");
            // const duplicateIfSingle = (arr) => {
            //     let final = []
            //     if(finalDataTicketTemp.length == 1){
            //         final.push(arr[0]);
            //         final.push(arr[0])
            //     }
            //     return final;
            // };
            // finalDataTicketTemp = duplicateIfSingle(finalDataTicketTemp);
           
            //console.log("selected static ticket", finalDataTicketTemp, data.playerId);
            let userType = "Online";
            let playerTicketType = "Online";
            if (player.userType == "Unique") {
                userType = "Unique";
            }
            if (data.hasOwnProperty('playerTicketType')) {
                playerTicketType = data.playerTicketType
            }
            let groupOfHall = await Sys.App.Services.HallServices.getSingleHallData({ _id: player.hall.id }, { groupHall: 1 })
            let playerPurchasedTickets = [];
            console.time("Game 1 tickets purcahse insert tickets");
            if (finalDataTicketTemp.length >= parseInt(ticketQnty)) {
    
                let dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData({ _id: await Sys.Helper.bingo.obId(gameData.parentGameId) }, {}, {});
                let ticketLargeArr = [];
    
                ticketLargeArr = finalDataTicketTemp.map((ticketData, r) => {
                    const ticket = [...ticketData.tickets]; // Avoid modifying the original ticket array
                    ticket[2][2] = { Number: 0, checked: true };
                
                    return {
                        insertOne: {
                            document: {
                                isAgentTicket: data.isAgentTicket,
                                agentId: data.agentId,
                                gameId: data.gameId,
                                gameType: "game_1",
                                gameName: gameData.gameName,
                                ticketId: ticketData.ticketId,
                                tickets: ticket,
                                isPurchased: true,
                                playerIdOfPurchaser: data.playerId,
                                playerNameOfPurchaser: player.username,
                                hallId: player.hall.id,
                                hallName: player.hall.name,
                                groupHallId: groupOfHall.groupHall.id,
                                groupHallName: groupOfHall.groupHall.name,
                                ticketColorType: ticketColorTypeArray[r]?.type || "small",
                                ticketColorName: ticketColorTypeArray[r]?.ticketName || "Small Yellow",
                                ticketPrice: ticketColorTypeArray[r]?.price || 0,
                                ticketParentId: ticketData.id,
                                userType,
                                userTicketType,
                                ticketPurchasedFrom: purchasedSlug,
                                gameStartDate: gameData.startDate,
                                uniquePlayerId: userType === "Online" ? '' : player.uniqueId,
                                playerTicketType,
                                supplier: "Smart Gaming",
                                developer: "Bingoentreprenøren AS",
                                createdAt: Date.now(),
                                dailyScheduleId: dailySchedule.dailyScheduleId,
                                subGame1Id: dailySchedule.days[gameData.day][0],
                                otherData: { hallNumber: hallData?.number || '' }
                            }
                        }
                    };
                });
    
                room?.halls.forEach(hall => {
                    console.log("Call getTicketDataRefresh",);
                    Sys.Io.of('admin').to(hall).emit('getTicketDataRefresh', { message: "Ticket Purchase" });
                })
    
                let latestGame = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { disableTicketPurchase: 1 });
                if (latestGame.disableTicketPurchase == true) {
                    if (data.voucherCode != undefined && data.voucherCode != null && data.voucherCode != '') {
                        await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: vId }, { isVoucherUse: false })
                    }
                    if (purchasedSlug == 'points') {
                        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: TotalAmountOfTickets } });
                    } else if (purchasedSlug == 'realMoney') {
                        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: TotalAmountOfTickets, monthlyWalletAmountLimit: TotalAmountOfTickets } });
                    }
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "ticket_purchase_disabled", language: player.selectedLanguage }), // 'Ticket purchase has been disabled for this game',
                        statusCode: 401
                    }
                }
    
                let ticketInsert = await Sys.App.Services.GameService.bulkWriteTicketData(ticketLargeArr);
                console.log("inserted ids", ticketInsert.insertedIds)
                if (ticketInsert.insertedIds) {
                    playerPurchasedTickets = Object.values(ticketInsert.insertedIds)
                }
    
            } else {
                // revert player amount
                if (data.voucherCode != undefined && data.voucherCode != null && data.voucherCode != '') {
                    await Sys.Game.Common.Services.PlayerServices.updateOneTransaction({ _id: vId }, { isVoucherUse: false })
                }
                if (purchasedSlug == 'points') {
                    await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { points: TotalAmountOfTickets } });
                } else if (purchasedSlug == 'realMoney') {
                    await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: data.playerId }, { $inc: { walletAmount: TotalAmountOfTickets, monthlyWalletAmountLimit: TotalAmountOfTickets } });
                }
    
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "tickets_not_available", language: player.selectedLanguage }), // 'Tickets Not Available!',
                    statusCode: 401
                }
            }
            console.timeEnd("Game 1 tickets purcahse insert tickets");
            // afer deducting player wallet, update game stats
            // console.log("Player after deducting wallet amount", deductUserWallet);
            let updatedGame = "";
            let luckyNumber = 0;
            if (data.luckyNumber == 0) {
                luckyNumber = getRandomArbitrary(1, 75)
            } else {
                luckyNumber = data.luckyNumber;
            }
            const isPurchasedUpdated = gameData.players.findIndex((e) => e.id == data.playerId);
            if (isPurchasedUpdated != -1) {
                let hallId = gameData.players[isPurchasedUpdated].hall;
                    if(!hallId.includes(player.hall.id)){
                        hallId.push(player.hall.id);
                    }
                let totalPurchasedTickets = (gameData.players[isPurchasedUpdated].totalPurchasedTickets + ticketQnty);
                updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: gameData._id, 'players.id': gameData.players[isPurchasedUpdated].id },
                    {
                        $set: {
                            'players.$.luckyNumber': luckyNumber,
                        },
                        $inc: {
                            ticketSold: ticketQnty,
                            earnedFromTickets: TotalAmountOfTickets,
                            finalGameProfitAmount: TotalAmountOfTickets,
                            'players.$.ticketPrice': TotalAmountOfTickets,
                            'players.$.totalPurchasedTickets': ticketQnty,
                        },
                        $set:{'players.$.hall': hallId}
                    },
                    { new: true }
                );
    
                let incObj = {};
                let filterArr = [];
                let tempAlpha = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
    
                if (gameData.gameName == "Traffic Light") {
                    for (let s = 0; s < subgame.length; s++) {
                        incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = playerPurTickets[0].ticketQty;
                        filterArr.push({ [tempAlpha[s] + ".ticketName"]: subgame[s].ticketName })
                    }
                } else if (gameData.gameName == "Elvis") {
                    for (let s = 0; s < subgame.length; s++) {
                        let purchaseCount = playerPurTickets.filter((obj) => obj.ticketName == subgame[s].ticketName).length;
                        incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = purchaseCount;
                        filterArr.push({ [tempAlpha[s] + ".ticketName"]: subgame[s].ticketName })
                    }
                } else {
                    for (let s = 0; s < playerPurTickets.length; s++) {
                        incObj["players.$.purchaseTicketTypes.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = playerPurTickets[s].ticketQty;
                        filterArr.push({ [tempAlpha[s] + ".ticketName"]: playerPurTickets[s].ticketName })
                    }
                }
    
                Object.entries(ticketFinalData).forEach(([key, value]) => {
                    incObj[`groupHalls.$[group].halls.$[hall].ticketData.${key}`] = value
                    incObj[`groupHalls.$[group].halls.$[hall].userTicketType.${userTicketType}.${key}`] = value
                });
    
                filterArr.push({ "group.halls.id": player.hall.id.toString() }, { "hall.id": player.hall.id.toString() })
    
    
                //console.log("update player tickets count", incObj, filterArr)
                await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: data.gameId, 'players.id': data.playerId }, {
                    $inc: incObj
                }, { arrayFilters: filterArr, new: true });
    
    
            } else {
                let purchaseTicketTypes = [];
                for (let s = 0; s < subgame.length; s++) {
                    if (gameData.gameName == "Traffic Light") {
                        purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: playerPurTickets[0].ticketQty })
                    } else {
                        if (gameData.gameName == "Elvis") {
                            let purchaseCount = playerPurTickets.filter((obj) => obj.ticketName == subgame[s].ticketName).length;
                            purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: purchaseCount })
                        } else {
                            let purchaseCount = 0;
                            let index = playerPurTickets.findIndex((e) => e.ticketName == subgame[s].ticketName);
                            if (index != -1) {
                                purchaseCount = playerPurTickets[index].ticketQty;
                            }
                            purchaseTicketTypes.push({ ticketName: subgame[s].ticketName, ticketPrice: subgame[s].ticketPrice, totalPurchasedTickets: purchaseCount })
                        }
    
                    }
    
                }
    
                let newPlayer = {
                    id: data.playerId,
                    name: player.username,
                    socketId: socket.id,
                    totalPurchasedTickets: ticketQnty,
                    ticketPrice: TotalAmountOfTickets,
                    isPlayerOnline: false,
                    userType: player.userType,
                    luckyNumber: luckyNumber,
                    purchaseTicketTypes: purchaseTicketTypes,
                    purchasedSlug: purchasedSlug,
                    hall: [player.hall.id],
                }
                const updateQuery = {
                    $push: { "players": newPlayer },
                    $inc: {
                        ticketSold: ticketQnty,
                        earnedFromTickets: TotalAmountOfTickets,
                        finalGameProfitAmount: TotalAmountOfTickets
                    }
                }
    
                Object.entries(ticketFinalData).forEach(([key, value]) => {
                    updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].ticketData.${key}`] = value
                    updateQuery["$inc"][`groupHalls.$[group].halls.$[hall].userTicketType.${userTicketType}.${key}`] = value
                });
    
                updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: gameData._id },
                    updateQuery,
                    {
                        arrayFilters: [{ "group.halls.id": player.hall.id.toString() }, { "hall.id": player.hall.id.toString() }],
                        new: true
                    }
                );
            }
    
            //Sys.Io.of(Sys.Config.Namespace.Game1).to(data.gameId).emit('UpdatePlayerRegisteredCount', { playerRegisteredCount: updatedGame.players.length });
    
            let newExtraTransaction = {
                playerId: player._id,
                gameId: updatedGame._id,
                transactionSlug: "extraTransaction",
                typeOfTransaction: "Game Joined",
                action: "debit", // debit / credit
                purchasedSlug: purchasedSlug, // point /realMoney,
                game1Slug: "buyTicket",
                totalAmount: TotalAmountOfTickets,
            }
    
            Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "purchase",
                playerId: player._id,
                hallId: player.hall.id,
                purchase: TotalAmountOfTickets
            });
            await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +TotalAmountOfTickets, type: deductPlayerSpending.type, gameStatus: 1 });
    
            console.log("This Player [ ", player.username, " ] Tickets Purchased Successfully..!!");
    
            //if (player.enableNotification == true) {
    
            let TimeMessage = {
                en: await translate({ key: "game1_ticket_purchase_notification", language: 'en', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: finalDataTicketTemp.length }),
                nor: await translate({ key: "game1_ticket_purchase_notification", language: 'nor', isDynamic: true, number: gameData.gameNumber, number1: gameData.gameName, number2: finalDataTicketTemp.length })
            };
    
            //gameData.gameNumber + " [ " + gameData.gameName + " ] " + finalDataTicketTemp.length + " Tickets Purchased Successfully..!! ";
    
            let notificationDate = gameData.startDate;
            console.log("notificationDate", notificationDate)
    
            let ticketMessage = {
                en: await translate({ key: "game1_purchase_noti", language: 'en', isDynamic: true, number: finalDataTicketTemp.length, number1: gameData.gameName }),
                nor: await translate({ key: "game1_purchase_noti", language: 'nor', isDynamic: true, number: finalDataTicketTemp.length, number1: gameData.gameName })
            };
    
            let notification = {
                notificationType: 'purchasedTickets',
                message: TimeMessage,
                ticketMessage: ticketMessage, // `You bought ${finalDataTicketTemp.length} ticket of "${gameData.gameName}" Game..!!`,
                price: `${TotalAmountOfTickets}`,
                date: notificationDate
            }
    
            let dataNotification = {
                playerId: player._id,
                gameId: gameData._id,
                notification: notification
            }
    
            await Sys.Game.Common.Services.NotificationServices.create(dataNotification);
            
            let result = '';
            if (playerTicketType == "Physical") {
                result = finalDataTicketTemp[0];
            }
    
            // update ticketId for each ball and update tickets state for already drawn balls
            const ticketsConfData = await module.exports.setPurchasedTicketsIdBallWise(playerPurchasedTickets, gameData._id);
            await module.exports.processDrawnNumbers(gameData._id, ticketsConfData);
            
            if (gameData.gameName == "Spillerness Spill" || gameData.gameName == "Spillerness Spill 2" || gameData.gameName == "Spillerness Spill 3" || gameData.gameName == "Innsatsen") {
                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('adminRefreshRoom', {});
                let {patternList, jackPotData} = await Sys.Game.Game1.Controllers.GameProcess.patternListing(gameData._id);
                Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('PatternChange', { patternList, jackPotData });
            }

            Sys.Io.to(player?.socketId).emit('PlayerHallLimit', { });
    
            //let gameFinal = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, {ticketIdForBalls: 1});
            //console.log("final data", gameFinal.ticketIdForBalls)
            return {
                status: 'success',
                result: result,
                message: await translate({ key: "tickets_purcahsed", language: player.selectedLanguage }), // 'Tickets purchased successfully..!!'
            }
    
        } catch (error) {
            console.log("Error game1TicketPurchased", error);
        }
    },

    cancelGameTickets: async function (socket, data) {
        try {
            console.log('cancelGameTickets', data);
            const { playerId, hallIds = null, gameId, isRefund = false } = data;
            let language = data.language || "nor";
        
            // Run player and game validation in parallel for faster response
            const [player, gameData] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: playerId },
                    { socketId: 1, username: 1, selectedLanguage: 1, hall: 1 }
                ),
                Sys.Game.Game1.Services.GameServices.getSingleByData(
                    { _id: gameId },
                    {
                        status: 1,
                        players: 1,
                        gameNumber: 1,
                        gameName: 1,
                        startDate: 1,
                        otherData: 1,
                        halls: 1,
                        parentGameId: 1,
                    }
                )
            ]);
            
            language = player?.selectedLanguage || language;
            
            // Quick validations with early returns
            if (!player) {
                return Game1Helper.createErrorResponse('player_not_found', language, 400);
            }
            
            if (!gameData) {
                return Game1Helper.createErrorResponse('game_not_found', language, 400);
            }
            
            if (
                gameData.status === 'cancel' ||
                gameData.status === 'running' ||
                gameData.status === 'finish' ||
                gameData.otherData.disableCancelTicket
            ) {
                return Game1Helper.createErrorResponse('can_not_cancel_ticket', language, 400);
            }

            const playerIndex = gameData.players.findIndex((e) => e.id === playerId);
            if (playerIndex === -1) {
                return Game1Helper.createErrorResponse('error_cancelling_tickets', language, 400);
            }
        
            // Proceed with cancellation
            let { ticketPrice, totalPurchasedTickets, purchasedSlug, purchaseTicketTypes, hall } =
                gameData.players[playerIndex];
        
            if (gameData.players[playerIndex].id !== data.playerId) {
                console.log('error in cancelling ticket, player mismatch');
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({
                        key: 'went_wrong_cancelling_tickets',
                        language: language,
                    }),
                    statusCode: 500,
                };
            }

            // Handle ticket mapping and deletion
            const prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData(
                { gameId: data.gameId, playerIdOfPurchaser: data.playerId, ...(hallIds && { hallId: { $in: hallIds } }) },
                { tickets: 1, ticketColorName: 1, ticketColorType: 1, userTicketType: 1, hallId: 1, ticketPrice:1, count:1,ticketKey:1, ticketId:1 }
            );
            if(!hallIds){
                // Update game data
                const updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: gameId, 'players.id': playerId },
                    {
                        $pull: { players: { id: data.playerId } },
                        $inc: {
                            ticketSold: -totalPurchasedTickets,
                            earnedFromTickets: -ticketPrice,
                            finalGameProfitAmount: -ticketPrice,
                        },
                    }
                );
            
                if (!updateGame) {
                    console.log('error in cancelling ticket');
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({
                            key: 'went_wrong_cancelling_tickets',
                            language: player.selectedLanguage,
                        }),
                        statusCode: 500,
                    };
                }
            }else{
                totalPurchasedTickets = prTickets.length;
                ({ ticketPrice, purchasedSlug } =
                    await module.exports.prepareTicketDeletionsForUpdate(
                        gameId,
                        playerId.toString(),
                        prTickets
                    )
                );

                if (hallIds && hallIds.length > 0) {

                    const hallSet = new Set(hall);
                    const removeHallList = hallIds.filter(hallId => hallSet.has(hallId));
                    console.log("hall", hall);
                    console.log("removeHallList", removeHallList);
                    /* ---------- Remove halls in parallel ---------- */
                    if (removeHallList.length > 0) {
                        const results = await Promise.all(
                            removeHallList.map(hallId =>
                                Sys.Game.Game1.Services.GameServices.updateGameNested(
                                    {
                                        _id: gameId,
                                        'players.id': playerId,
                                        'players.hall': hallId,
                                    },
                                    {
                                        $pull: { 'players.$.hall': hallId },
                                    },
                                    { new: true }
                                )
                            )
                        );
                        if (results.some(r => !r)) {
                            console.log('error in cancelling ticket');
                            return {
                                status: 'fail',
                                result: null,
                                message: await translate({
                                    key: 'went_wrong_cancelling_tickets',
                                    language: player.selectedLanguage,
                                }),
                                statusCode: 500,
                            };
                        }
                    }

                    /* ---------- Prepare update object ---------- */
                    const updateData = {
                        $inc: {
                            ticketSold: -totalPurchasedTickets,
                            earnedFromTickets: -ticketPrice,
                            finalGameProfitAmount: -ticketPrice,
                        },
                    };
                    // If all halls are removed, remove player
                    if (hall.length === removeHallList.length) {
                        updateData.$pull = { players: { id: playerId } };
                    } else {
                        updateData.$inc['players.$.ticketPrice'] = -ticketPrice;
                        updateData.$inc['players.$.totalPurchasedTickets'] = -totalPurchasedTickets;
                    }

                    /* ---------- Final game update ---------- */
                    const updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                        { _id: gameId, 'players.id': playerId },
                        updateData,
                        { new: true }
                    );

                    if (!updateGame) {
                        console.log('error in cancelling ticket');
                        return {
                            status: 'fail',
                            result: null,
                            message: await translate({
                                key: 'went_wrong_cancelling_tickets',
                                language: player.selectedLanguage,
                            }),
                            statusCode: 500,
                        };
                    }
                }

            }
        
            // Create transaction
            if (isRefund) {
                await Game1Helper.createRefundTransaction({
                    playerId: playerId,
                    gameId: gameId,
                    ticketPrice,
                    purchasedSlug,
                });
            } else {
                await Game1Helper.createCancelTransaction({
                playerId: playerId,
                gameId: gameId,
                ticketPrice,
                purchasedSlug,
            });
            }
            let stopGamedata = {
                playerId: playerId,
                gameId: gameId,
                gameName: gameData.gameName,
                purchaseTicketTypes: purchaseTicketTypes,
                hallIds: hallIds ? hallIds : null,
            }
            await Sys.App.Controllers.agentcashinoutController.updateDailyTransactionByStopGame(stopGamedata);
            // Update ticket types
            if (purchaseTicketTypes.length > 0 && !hallIds) {
                const incObj = {};
                const filterArr = [];
                const tempAlpha = [
                'a',
                'b',
                'c',
                'd',
                'e',
                'f',
                'g',
                'h',
                'i',
                'j',
                'k',
                'l',
                'm',
                'n',
                'o',
                'p',
                'q',
                'r',
                's',
                't',
                'u',
                'v',
                'w',
                'x',
                'y',
                'z',
                ];
                for (let s = 0; s < purchaseTicketTypes.length; s++) {
                    incObj[
                        `subGames.$[].options.$[${tempAlpha[s]}].totalPurchasedTickets`
                    ] = -purchaseTicketTypes[s].totalPurchasedTickets;
                    filterArr.push({ [`${tempAlpha[s]}.ticketName`]: purchaseTicketTypes[s].ticketName });
                }
                await Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: gameId },
                    { $inc: incObj },
                    { arrayFilters: filterArr }
                );
            }
        
            // // Handle ticket mapping and deletion
            // const prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData(
            //     { gameId: data.gameId, playerIdOfPurchaser: data.playerId, ...(hallIds && { hallId: { $in: hallIds } }) },
            //     { tickets: 1, ticketColorName: 1, ticketColorType: 1, userTicketType: 1, hallId: 1 }
            // );
        
            const removeTicketIds = prTickets.map((ticket) => ticket._id);
            if (removeTicketIds.length > 0) {
                await module.exports.removeCanceledTicketsMapping(removeTicketIds, gameId);
            }
            if(!hallIds){
                // Calculate ticket counts per hall
                const getCountTicket = prTickets.reduce((obj, ticket) => {
                    const hallId = ticket.hallId;
                    if (!obj[hallId]) {
                    obj[hallId] = { Physical: {}, Terminal: {}, Web: {} };
                    }
                    const colorKey = ticket.ticketColorName.split(' ').join('').toLowerCase();
                    if (obj[hallId][ticket.userTicketType][colorKey]) {
                    obj[hallId][ticket.userTicketType][colorKey].count += 1;
                    } else {
                    obj[hallId][ticket.userTicketType][colorKey] = {
                        type: ticket.ticketColorType,
                        count: 1,
                    };
                    }
                    return obj;
                }, {});
            
                Object.entries(getCountTicket).forEach(([hallId, ticketData]) => {
                    Object.entries(ticketData).forEach(([ticketType, ticketDetails]) => {
                    Object.entries(ticketDetails).forEach(([colorKey, ticket]) => {
                        if (ticket.type === 'large') {
                        ticket.count = ticket.count / 3;
                        }
                    });
                    });
                });
                
                // Update hall ticket counts
                // Prepare all update operations
                const updateOperations = Object.entries(getCountTicket).map(([hallId, ticketData]) => {
                    const updateQuery = { $inc: {} };
                    for (const [ticketType, ticketDetails] of Object.entries(ticketData)) {
                        for (const [colorKey, ticket] of Object.entries(ticketDetails)) {
                            const updatePath = `groupHalls.$[group].halls.$[hall].userTicketType.${ticketType}.${colorKey}`;
                            const ticketDataPath = `groupHalls.$[group].halls.$[hall].ticketData.${colorKey}`;
                            updateQuery.$inc[updatePath] = -ticket.count;
                            updateQuery.$inc[ticketDataPath] = -ticket.count;
                        }
                    }
                    return Sys.Game.Game1.Services.GameServices.updateGameNested(
                        { _id: gameData._id },
                        updateQuery,
                        { arrayFilters: [{ 'group.halls.id': hallId }, { 'hall.id': hallId }] }
                    );
                });
                
                // Execute all database operations in parallel
                await Promise.all([
                    // Update hall ticket counts
                    ...updateOperations,
                    
                    // Delete tickets
                    Sys.App.Services.GameService.deleteTicketManydata({
                        playerIdOfPurchaser: data.playerId,
                        gameId: data.gameId,
                    }),
                    
                    // Update static tickets
                    Sys.Game.Game1.Services.GameServices.updateManyStaticData(
                        { playerIdOfPurchaser: data.playerId, isPurchased: true, gameId: gameData._id },
                        { isPurchased: false, playerIdOfPurchaser: '', gameId: '' }
                    ),
                ]);
            }else{
                let ticketIds = prTickets.map((ticket) => ticket.ticketId);
                await Promise.all([
                    // Delete tickets
                    Sys.App.Services.GameService.deleteTicketManydata({
                        playerIdOfPurchaser: data.playerId,
                        gameId: data.gameId,
                        ...(hallIds && { hallId: { $in: hallIds } }),
                    }),
                    
                    // Update static tickets
                    Sys.Game.Game1.Services.GameServices.updateManyStaticData(
                        { playerIdOfPurchaser: data.playerId, isPurchased: true, gameId: gameData._id, ticketId: { $in: ticketIds } },
                        { isPurchased: false, playerIdOfPurchaser: '', gameId: '' }
                    ),
                ]);
            }
            // Create notification
            if (isRefund) {
                await Game1Helper.createRefundNotification({
                    playerId: playerId,
                    gameId: gameId,
                    gameNumber: gameData.gameNumber,
                    gameName: gameData.gameName,
                    ticketQty: totalPurchasedTickets,
                    ticketPrice,
                    startDate: gameData.startDate,
                    language: language,
                })
            }else{
                await Game1Helper.createCancelNotification({
                    playerId: playerId,
                    gameId: gameId,
                    gameNumber: gameData.gameNumber,
                    gameName: gameData.gameName,
                    ticketQty: totalPurchasedTickets,
                    ticketPrice,
                    startDate: gameData.startDate,
                    language: language,
                })
            }
            //Sys.Io.to(player.socketId).emit('PlayerHallLimit', { });
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
            // Emit events after database operations complete
            gameData?.halls.forEach((hall) => {
                Sys.Io.of('admin')
                .to(hall)
                .emit('refresh', { scheduleId: gameData.parentGameId });
            });
            
            // Emit game events
            await Game1Helper.emitSalesGameEvents(gameData);
        
            return {
                status: 'success',
                result: '',
                message: await translate({
                    key: 'ticket_cancellation_success',
                    language: language,
                }),
            };
        } catch (e) {
          console.error('Error in cancelGameTickets:', e);
          return new Error(e);
        }
    },

    upcomingGames: async function (socket, data) {
        try {
            const language = data.language || "nor";
    
            if (!data.gameId) return Game1Helper.createErrorResponse("something_went_wrong", language);
    
            // fetch player + schedule in parallel (fastest way)
            const [player, schedule] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices
                    .getOneByData({ _id: data.playerId }, { hall: 1, selectedLanguage: 1 }),
    
                Sys.Game.Game1.Services.GameServices
                    .getSingleByData({ _id: data.gameId }, { parentGameId: 1 })
            ]);
    
            if (!player) return Game1Helper.createErrorResponse("player_not_found", language);
            if (!Game1Helper.isValidHall(player.hall)) {
                return Game1Helper.createErrorResponse("no_game_available", player.selectedLanguage);
            }
    
            // Precalculate today's date range
            const start = moment().startOf("day").toDate();
            const end = moment().startOf("day").add(2, "day").toDate();
            // upcoming games query
            const games = await Sys.Game.Game1.Services.GameServices.getByData(
                {
                    gameType: "game_1",
                    halls: { $in: [player.hall.id] },
                    parentGameId: schedule.parentGameId,
                    status: { $in: ["active", "running"] },
                    stopGame: false,
                    disableTicketPurchase: false,
                    "otherData.isClosed": false,
                    startDate: { $gte: start, $lt: end }
                },
                { 
                    gameName: 1, 
                    status: 1, 
                    players: 1, 
                    sequence: 1, 
                    subGames: 1, 
                    otherData: 1, 
                    _id: 1
                },
                { sort: { startDate: 1, sequence: 1 } }
            );
    
            if (games.length === 0) return Game1Helper.createErrorResponse("no_game_available", player.selectedLanguage);
    
            const playerId = data.playerId;
            const upcomingGame = [];
            let lastSequence = -1;
    
            for (const game of games) {
                // break early if out of order
                if (game.sequence <= lastSequence) break;
                lastSequence = game.sequence;
    
                // Build a fast lookup map for players inside the game
                const map = {};
                for (const p of game.players) {
                    if (p.id == playerId) {
                        map[playerId] = p;
                        break; // important: break early → O(1)
                    }
                }
    
                const playerInfo = map[playerId] || {};
                const ticketInfo = Game1Helper.getTicketTypes(game);
                upcomingGame.push({
                    gameId: game._id,
                    gameName: game.gameName,
                    status: game.status,
                    ticketTypes: ticketInfo.types,
                    purchasedTickets: playerInfo.totalPurchasedTickets || 0,
                    maxPurchaseTicket: 30,
                    gameType: ticketInfo.gameType,
                    replaceAmount:
                        game.gameName === "Elvis"
                            ? game.otherData.replaceTicketPrice || 0
                            : 0,
                    luckyNumber: playerInfo.luckyNumber || 0,
                    isCancelAllowed: game.otherData?.disableCancelTicket !== true,
                    isTestGame: game.otherData?.isTestGame ?? false
                });
            }
            return {
                status: "success",
                result: upcomingGame,
                message: "Games Found",
                statusCode: 200
            };
        } catch (err) {
            console.log("Error In upcomingGames:", err);
            return Game1Helper.createErrorResponse("something_went_wrong", data.language || "nor", 500);
        }
    },
    

    selectLuckyNumber: async function (socket, data) {
        try {
            const startTime = Date.now();
            const { playerId, gameId, luckyNumber, language = "nor" } = data;
            // Validate required parameters
            if (!playerId) {
                return await Game1Helper.createErrorResponse("playerid_not_found", language);
            }

            if (!gameId) {
                return await Game1Helper.createErrorResponse("game_not_found", language);
            }

            if (luckyNumber == null) {
                return await Game1Helper.createErrorResponse("lucky_number_not_found", language);
            }

            // Get player data
            // Get player and game data in parallel
            const [player, gameData] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: playerId }, 
                    { username: 1, selectedLanguage: 1 }
                ),
                Sys.Game.Game1.Services.GameServices.getSingleByData(
                    { _id: gameId }, 
                    { status: 1 }
                )
            ]);
            
            if (!player) {
                return await Game1Helper.createErrorResponse("player_not_found", language);
            }

            if (!gameData) {
                return await Game1Helper.createErrorResponse("game_not_found", player.selectedLanguage);
            }

            // Check game status
            if (gameData.status !== 'active') {
                return await Game1Helper.createErrorResponse("game_already_started", player.selectedLanguage);
            }

            // Update player's lucky number in game document
            const updatePromise = Sys.Game.Game1.Services.GameServices.updateGameNested(
                { _id: gameData._id, 'players.id': playerId },
                { $set: { 'players.$.luckyNumber': luckyNumber } },
                { new: true }
            );

            // Update all tickets for this player in this game
            const ticketUpdatePromise = Sys.Game.Game1.Services.GameServices.updateManyTicketData(
                { gameId, playerIdOfPurchaser: playerId }, 
                { $set: { luckyNumber } }
            );

            // Run updates in parallel
            await Promise.all([updatePromise, ticketUpdatePromise]);
            console.log("selectLuckyNumber exec time:", Date.now() - startTime, "ms");
            return {
                status: 'success',
                result: "",
                message: await translate({ key: "lucky_number_updated", language: player.selectedLanguage }),
                statusCode: 200
            };
            
        } catch (error) {
            console.log("Error selectLuckyNumber", error);
            return Game1Helper.createErrorResponse("something_went_wrong", data?.language || "nor", 500);
        }
    },
    
    viewPurchasedTickets: async function (socket, data) {
        try {
            const startTime = Date.now();
            const { playerId, gameId, language = "nor" } = data;
            // Early validation for required parameters
            if (!playerId) {
                return await Game1Helper.createErrorResponse("playerid_not_found", language, 400);
            }
            
            if (!gameId) {
                return await Game1Helper.createErrorResponse("game_not_found", language, 400);
            }
            
            // Get player data and tickets in parallel
            const [player, allPurchasedTickets] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: playerId }, 
                    { status: 1, selectedLanguage: 1 }
                ),
                Sys.Game.Game1.Services.GameServices.getTicketListData(
                    { 
                        playerIdOfPurchaser: playerId, 
                        gameId 
                    }, 
                    { 
                        ticketId: 1, 
                        ticketPrice: 1, 
                        hallName: 1, 
                        ticketColorName: 1, 
                        ticketColorType: 1, 
                        tickets: 1, 
                        isTicketSubmitted: 1, 
                        supplier: 1, 
                        developer: 1 
                    }
                )
            ]);
            
            if (!player) {
                return await Game1Helper.createErrorResponse("player_not_found", language, 401);
            }
            
            if (player.status.toLowerCase() !== 'active') {
                return await Game1Helper.createErrorResponse("player_not_active", language, 401);
            }

            // Process tickets in a more efficient way
            const ticketsArr = allPurchasedTickets.map(ticket => {
                const { 
                    id, 
                    ticketId, 
                    ticketPrice, 
                    hallName, 
                    ticketColorName, 
                    ticketColorType, 
                    tickets, 
                    isTicketSubmitted, 
                    supplier, 
                    developer 
                } = ticket;
                
                // Process ticket color
                let ticketColor = ticketColorName;
                if (ticketColorType === "elvis") {
                    ticketColor = ticketColorName.slice(6);
                }
                
                // Flatten ticket numbers more efficiently
                const ticketCellNumberList = tickets.flat().map(cell => cell.Number);
                
                // Return formatted ticket data
                return {
                    id,
                    ticketNumber: ticketId,
                    ticketPrice,
                    ticketCellNumberList,
                    hallName,
                    ticketColor,
                    ticketCompleted: isTicketSubmitted,
                    supplierName: supplier,
                    developerName: developer
                };
            });
            console.log("viewPurchasedTickets exec time:", Date.now() - startTime, "ms");
            // Prepare response
            return {
                status: 'success',
                result: ticketsArr,
                message: await translate({ key: "player_purcahsed_tickets", language: language })
            };

        } catch (e) {
            console.log("Error in viewPurchasedTickets : ", e);
            return await Game1Helper.createErrorResponse("something_went_wrong", data?.language || "nor", 500);
        }
    },

    replaceElvisTickets: async function (soket, data) {
        try {
            // Destructure all needed variables from data
            const { 
                playerId, 
                gameId, 
                ticketId1, 
                ticketId2, 
                replaceAmount, 
                purchaseType: purchasedSlug,
                language = "nor" 
            } = data;
            
            // Validate required inputs
            if (!ticketId1 || !ticketId2) {
                return Game1Helper.createErrorResponse("provid_ticketds", language);
            }

            // Execute player and game queries in parallel
            const [player, game] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: playerId }, 
                    { status: 1, hall: 1, username: 1, points: 1, walletAmount: 1, selectedLanguage: 1 }
                ),
                Sys.Game.Game1.Services.GameServices.getSingleByData(
                    { _id: gameId }, 
                    { players: 1, status: 1, subGames: 1, gameName: 1, otherData: 1, isNotificationSent: 1, halls: 1 }
                )
            ]);

            // Quick validations
            if (!player) {
                return Game1Helper.createErrorResponse("player_not_found", language);
            }
            
            const playerLanguage = player.selectedLanguage || language;
            
            if (!game || game.gameName !== "Elvis") {
                return Game1Helper.createErrorResponse("game_not_found", playerLanguage);
            }
            
            if (game.isNotificationSent) {
                return Game1Helper.createErrorResponse("can_not_replace_ticket", playerLanguage);
            }
            
            // Validate replacement amount
            const gameReplacePrice = game.otherData?.replaceTicketPrice || 0;
            if (+gameReplacePrice !== +replaceAmount) {
                return Game1Helper.createErrorResponse("something_went_wrong", playerLanguage);
            }

            // Get tickets in one query
            const tickets = await Sys.Game.Game1.Services.GameServices.getTicketListData(
                { 
                    playerIdOfPurchaser: playerId, 
                    gameId: gameId, 
                    _id: { $in: [ticketId1, ticketId2] } 
                }, 
                { ticketId: 1, ticketParentId: 1, ticketColorName: 1, ticketColorType: 1, tickets: 1, isTicketSubmitted: 1, supplier: 1, developer: 1, userTicketType: 1 }
            );
            
            if (tickets.length !== 2) {
                return Game1Helper.createErrorResponse("ticket_not_found", playerLanguage);
            }

            // Extract ticket IDs for later use
            const playerPurchasedTickets = [...new Set(tickets.map(ticket => ticket._id))];
            
            // Get Elvis ticket types from game data
            const TotalAmountOfTickets = +parseFloat(replaceAmount).toFixed(2);
            
            // Verify and deduct wallet balance
            const deductResult = await Game1Helper.deductPlayerBalance(player, TotalAmountOfTickets, purchasedSlug);
            if (!deductResult.success) {
                return Game1Helper.createErrorResponse(deductResult.errorKey, playerLanguage, 401);
            }
            let deductPlayerSpending = await checkPlayerSpending({ playerId: player._id, hallId: player.hall.id, amount: +replaceAmount });
            if(!deductPlayerSpending.isValid){
                return Game1Helper.createErrorResponse(deductPlayerSpending.error, playerLanguage, 401);
            }
            // Select new Elvis ticket color
            const selectedElvisinAdminTemp = game.subGames[0].ticketColorTypes;
            const selectedElvisinAdmin = selectedElvisinAdminTemp.length > 0 
                ? selectedElvisinAdminTemp.map(element => parseInt(element.slice(11)))
                : [1, 2, 3, 4, 5];
            
            const selected = randomWithProbability(1, selectedElvisinAdmin);
            const ticketColorName = `Small Elvis${selected[0]}`;
            
            // Get normalized ticket color names for DB updates
            const newAddedTickets = ticketColorName.split(" ").join("").toLowerCase();
            const removedTickets = tickets[0].ticketColorName.split(" ").join("").toLowerCase();

            // Get replacement tickets efficiently
            const ticketQnty = 2;
            const replacementTickets = await Game1Helper.getReplacementTickets(playerId, gameId, ticketQnty);
            
            if (!replacementTickets.success) {
                await Game1Helper.refundPlayerBalance(playerId, TotalAmountOfTickets, purchasedSlug);
                return Game1Helper.createErrorResponse("something_went_wrong", playerLanguage);
            }

            const finalDataTicketTemp = replacementTickets.tickets;

            // Process tickets in parallel with Promise.all
            const amount = parseFloat(TotalAmountOfTickets / finalDataTicketTemp.length).toFixed(2);
            const updatePromises = finalDataTicketTemp.map((ticketData, index) => {
                const ticket = [...ticketData.tickets];
                ticket[2][2] = { Number: 0, checked: true };
                
                const updatedTicket = { 
                    tickets: ticket, 
                    ticketColorName, 
                    ticketId: ticketData.ticketId, 
                    ticketParentId: ticketData.id
                };
                
                return Sys.Game.Game1.Services.GameServices.findOneAndUpdateTicket(
                    { _id: tickets[index]._id, playerIdOfPurchaser: playerId }, 
                    { $set: updatedTicket, $inc: { totalReplaceAmount: amount } }, 
                    { new: true }
                );
            });
            
            await Promise.all(updatePromises);
            console.log("newAddedTickets", newAddedTickets);
            console.log("removedTickets", removedTickets);
            // Execute the remaining operations in parallel
            await Promise.all([
                // Remove ticket mapping
                module.exports.removeCanceledTicketsMapping(playerPurchasedTickets, gameId),
                
                // Update ticket IDs for balls
                module.exports.setPurchasedTicketsIdBallWise(playerPurchasedTickets, gameId),
                
                // Update ticket counts in halls
               
                Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: gameId },
                    {
                        $inc: {
                            ...(newAddedTickets !== removedTickets ? {
                                [`groupHalls.$[group].halls.$[hall].ticketData.${newAddedTickets}`]: 2,
                                [`groupHalls.$[group].halls.$[hall].ticketData.${removedTickets}`]: -2,
                                [`groupHalls.$[group].halls.$[hall].userTicketType.${tickets[0].userTicketType}.${newAddedTickets}`]: 2,
                                [`groupHalls.$[group].halls.$[hall].userTicketType.${tickets[0].userTicketType}.${removedTickets}`]: -2
                            } : {
                                // No changes needed when ticket types are the same
                            })
                        }
                    },
                    {
                        arrayFilters: [
                            { "group.halls.id": player.hall.id.toString() }, 
                            { "hall.id": player.hall.id.toString() }
                        ],
                        new: true
                    }
                ),
                
                // Create transaction record
                Sys.Helper.gameHelper.createTransactionPlayer({
                    playerId: player._id,
                    gameId: gameId,
                    transactionSlug: "extraTransaction",
                    typeOfTransaction: "Replaced Tickets",
                    action: "debit",
                    purchasedSlug: purchasedSlug,
                    totalAmount: TotalAmountOfTickets,
                    game1Slug: "replaceTicket"
                }),
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "purchase",
                    playerId: player._id,
                    hallId: player.hall.id,
                    purchase: replaceAmount
                }),
                updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +replaceAmount, type: deductPlayerSpending.type, gameStatus: 1 }),
                
                // Update game with received amount
                Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: gameId },
                    {
                        $inc: {
                            'otherData.elvisReceivedReplaceAmount': TotalAmountOfTickets
                        }
                    },
                    { new: true }
                )
            ]);
            
            game?.halls.forEach(hall => {
                console.log("Call getTicketDataRefresh",);
                Sys.Io.of('admin').to(hall).emit('getTicketDataRefresh', { message: "Ticket Purchase" });
            })

            // Return success response
            return {
                status: 'success',
                message: await translate({ key: "tickets_replaced", language: playerLanguage })
            };

        } catch (error) {
            console.log("Error in replaceElvisTickets: ", error);
            // Use more descriptive error message and include the stack trace in logs
            console.error(error.stack || error);
            return Game1Helper.createErrorResponse("something_went_wrong", "nor", 500);
        }
    },

    sendGameChat: async function (socket, data) {
        try {
            // Destructure all needed variables from data
            const { 
                playerId, 
                gameId, 
                message, 
                emojiId, 
                language = "nor" 
            } = data;
            
            // Execute player and game queries in parallel
            const [player, gameData] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: playerId }, 
                    { username: 1, profilePic: 1, userProfilePic: 1, selectedLanguage: 1 }
                ),
                Sys.Game.Game1.Services.GameServices.getSingleByData(
                    { _id: gameId }, 
                    { status: 1 }
                )
            ]);

            if (!player) {
                return Game1Helper.createErrorResponse("player_not_found", language, 400);
            }

            if (!gameData) {
                return Game1Helper.createErrorResponse("game_not_found", player.selectedLanguage);
            }

            // Prepare chat data
            const chatData = {
                playerId: player.id,
                name: player.username,
                profilePic: player.userProfilePic || "/assets/profilePic/gameUser.jpg",
                emojiId,
                roomId: gameData._id,
                message,
                socketId: socket.id,
                createdAt: Date.now()
            };

            // Insert chat data
            const chats = await Sys.Game.Game1.Services.ChatServices.insertData(chatData);

            // Prepare response data
            const responseData = {
                playerId: chats.playerId,
                name: chats.name,
                profilePic: chats.profilePic,
                message: chats.message,
                emojiId: chats.emojiId,
                dateTime: await Sys.Helper.bingo.gameUTCTime(chats.createdAt)
            };

            // Emit event to all clients in the game room
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('GameChat', responseData);

            return {
                status: 'success',
                result: '',
                message: 'Chat boardcast send Successfully..!!'
            };

        } catch (error) {
            console.log("Error sendGameChat", error);
            return Game1Helper.createErrorResponse("something_went_wrong", "nor", 500);
        }
    },

    gameChatHistory: async function (socket, data) {
        try {
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { username: 1, profilePic: 1, selectedLanguage: 1 });
            if (player) {
                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { status: 1 });
                if (gameData === null) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found',
                    }
                }
                let history = [];
                let allChatData = await Sys.Game.Game1.Services.ChatServices.getByData({ roomId: gameData._id });

                for (var i = 0; i < allChatData.length; i++) {
                    let objData = {
                        playerId: allChatData[i].playerId,
                        name: allChatData[i].name,
                        profilePic: allChatData[i].profilePic,
                        message: allChatData[i].message,
                        emojiId: allChatData[i].emojiId,
                        dateTime: await Sys.Helper.bingo.gameUTCTime(allChatData[i].createdAt),
                    }
                    history.push(objData);
                }

                let onlinePlayers = await getOnlinePlayers('/Game1', gameData._id);
                await Sys.Io.of(Sys.Config.Namespace.Game1).to(gameData._id).emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });

                let result = {
                    onlinePlayerCount: onlinePlayers,
                    history: history
                }

                return {
                    status: 'success',
                    result: result,
                    message: 'Game Chat History send Successfully..!!'
                }

            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }

        } catch (error) {
            console.log("Error sendGameChat", error);
        }

    },

    leftRoom: async function (socket, data) {
        try {
            console.log("leftroom called")
            let language = "nor";
            if (data.language) {
                language = data.language;
            }
            if (!data.gameId) {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "game_not_found", language: language }), // 'Game data is not found',
                    statusCode: 400
                }
            }
            let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: data.playerId }, { username: 1, profilePic: 1, selectedLanguage: 1 });
            if (player) {
                let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.gameId }, { status: 1 });
                if (gameData === null) {
                    return {
                        status: 'fail',
                        result: null,
                        message: await translate({ key: "game_not_found", language: player.selectedLanguage }), // 'Game data is not found',
                    }
                }

                await leaveRoom(socket, data.gameId);

                let onlinePlayers = await getOnlinePlayers('/Game1', data.gameId);
                console.log("onlinePlayers in leftRoom", onlinePlayers);

                Sys.Io.of(Sys.Config.Namespace.Game1)
                    .to(gameData._id)
                    .emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });

                return {
                    status: 'success',
                    result: null,
                    message: await translate({ key: "player_left", language: player.selectedLanguage }), //'player left successfully!',
                }
            } else {
                return {
                    status: 'fail',
                    result: null,
                    message: await translate({ key: "player_not_found", language: language }), // 'No Player Found!',
                    statusCode: 400
                }
            }
        } catch (e) {
            console.log("Error in leftRoom : ", e);
            return new Error(e);
        }
    },

    adminHallDisplayLogin: async function (socket, data) {
        try {
            let gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData({ _id: data.roomId }, { status: 1, withdrawNumberList: 1, winners: 1, adminWinners: 1, subGames: 1, gameName: 1, sequence: 1, jackpotPrize: 1, otherData: 1, earnedFromTickets: 1, parentGameId: 1, wofWinners: 1, tChectWinners: 1, mystryWinners: 1, colorDraftWinners: 1, multipleWinners: 1, countDownDateTime: 1, jackpotDraw: 1, day: 1 });
            
            if (!gameData) {
                return {
                    status: 'fail',
                    result: null,
                    message: 'Game Not Found!',
                }
            }
            //console.log("socket before", socket)
            socket.join(data.roomId); // Subscribe Room.

            // Join socket to hall also
            //data.hallId = "66d685876a0b63bbbd8b75aa"; // Need to make it dynamic once set up frm front end, need to send it from frontend
            if(data.hallId){
                socket.join(socket.join(data.hallId)); // Subscribe Room.
            }
            socket.myData = {};
            socket.myData.gameType = 'game_1';
            socket.myData.gameName = 'Spillorama';
            socket.myData.isAdmin = true;
            let gameStatus = gameData.status;
            let totalWithdrawCount = gameData.withdrawNumberList.length;
            let fullHouseWinners = 0;
            let patternsWon = 0;
            let withdrawNumberList = gameData.withdrawNumberList;
            let winningList = [];

            for (let w = 0; w < gameData.winners.length; w++) {
                if (gameData.winners[w].isFullHouse == true) {
                    fullHouseWinners = fullHouseWinners + 1;
                }
            }

            if (gameData.winners.length > 0) {
                const patternUnique = [...new Set(gameData.winners.map(item => item.lineType))];
                //console.log("patternUnique", patternUnique)
                patternsWon = patternUnique.length;
            }
            console.log("Socket While Join Room: ", socket.id, socket.myData);

            let winningListTemp = [];
            if (gameData.status == "finish") {
                if (gameData.winners.length) {
                    winningListTemp = [...gameData.winners.reduce((mp, o) => {
                        if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, count: 0, finalWonAmount: 0 });
                        mp.get(o.lineType).count++;
                        mp.get(o.lineType).finalWonAmount = +parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4);
                        return mp;
                    }, new Map).values()];
                }
            } else {
                console.log("gameData.adminWinners", gameData.adminWinners)
                if (gameData.adminWinners && gameData.adminWinners.length) {
                    winningListTemp = [...gameData.adminWinners.reduce((mp, o) => {
                        if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, count: 0, finalWonAmount: 0 });
                        mp.get(o.lineType).count++;
                        mp.get(o.lineType).finalWonAmount = +parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4);
                        return mp;
                    }, new Map).values()];
                }
            }


            for (let w = 0; w < winningListTemp.length; w++) {
                winningList.push({
                    "id": winningListTemp[w].lineType,
                    "displayName": winningListTemp[w].lineTypeDisplay,
                    "winnerCount": winningListTemp[w].count,
                    "prize": winningListTemp[w].finalWonAmount,
                    //"prize": (gameData.status == "finish") ? winningListTemp[w].finalWonAmount : 0,
                })
            }

            // Get pattern list from helper function only and removed old code from hear 27/8/25
            let {patternList, jackPotData} = await Sys.Game.Game1.Controllers.GameProcess.patternListing(data.roomId, {winners: gameData.winners, subGames: gameData.subGames, gameName: gameData.gameName, earnedFromTickets: gameData.earnedFromTickets, parentGameId: gameData.parentGameId, jackpotPrize: gameData.jackpotPrize, jackpotDraw: gameData.jackpotDraw, withdrawNumberList: gameData.withdrawNumberList});
            
            patternList = (patternList || []).map(p => ({
                id: p.name,
                displayName: p.name,
                winnerCount: 0,
                prize: p.amount,
                prizeArray: p.prizeArray
            }));

            let finalWinningList = [];
            if (winningList.length > 0) {
                for (let p = 0; p < patternList.length; p++) {
                    let index = winningList.findIndex(x => x.id == patternList[p].id);
                    if (index >= 0) {
                        finalWinningList.push(winningList[index]);
                    } else {
                        finalWinningList.push(patternList[p]);
                    }
                }
            } else {
                finalWinningList = patternList
            }

            console.log("patternList and winningList---", patternList, winningList, finalWinningList)
            let minigameData = {};
            if (gameData.gameName == "Wheel of Fortune" || gameData.gameName == "Treasure Chest") {
                if (gameStatus == "finish") {
                    console.log("gameData.wofWinners--", gameData.wofWinners, gameData.otherData)
                    let isDisplayWheel = false;
                    if (gameData.wofWinners && gameData.wofWinners.length > 0) {
                        let onlinePlayerCount = gameData.wofWinners.filter(e => (e.playerType == "Unique" || e.playerType == "Online")).length;
                        console.log("onlinePlayerCount---", onlinePlayerCount)
                        if (onlinePlayerCount >= 1) {
                            isDisplayWheel = true;
                        }
                    }

                    let winningTicketNumbers = {};
                    let wonAmount = 0;
                    if (gameData.gameName == "Wheel of Fortune" && gameData.otherData.isMinigamePlayed == true) {
                        let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                        for (let w = 0; w < gameData.wofWinners.length; w++) {
                            if (gameData.wofWinners[w].playerType == "Physical") {
                                physicalWinners.push({ ticketNumber: gameData.wofWinners[w].ticketNumber, winningAmount: gameData.wofWinners[w].WinningAmount });
                            } else if (gameData.wofWinners[w].playerType == "Online") {
                                onlineWinners.push({ ticketNumber: gameData.wofWinners[w].ticketNumber, winningAmount: gameData.wofWinners[w].WinningAmount });
                            } else {
                                uniqueWinners.push({ ticketNumber: gameData.wofWinners[w].ticketNumber, winningAmount: gameData.wofWinners[w].WinningAmount });
                            }
                        }
                        wonAmount = gameData.wofWinners[0].WinningAmount;
                        winningTicketNumbers = { physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners }
                    }

                    if (gameData.gameName == "Treasure Chest" && gameData.otherData.isMinigamePlayed == true) {
                        let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                        if (gameData.tChectWinners && gameData.tChectWinners.length > 0) {
                            for (let w = 0; w < gameData.tChectWinners.length; w++) {
                                if (gameData.tChectWinners[w].playerType == "Physical") {
                                    physicalWinners.push({ ticketNumber: gameData.tChectWinners[w].ticketNumber, winningAmount: gameData.tChectWinners[w].WinningAmount });
                                } else if (gameData.tChectWinners[w].playerType == "Online") {
                                    onlineWinners.push({ ticketNumber: gameData.tChectWinners[w].ticketNumber, winningAmount: gameData.tChectWinners[w].WinningAmount });
                                } else {
                                    uniqueWinners.push({ ticketNumber: gameData.tChectWinners[w].ticketNumber, winningAmount: gameData.tChectWinners[w].WinningAmount });
                                }
                            }
                            wonAmount = gameData.tChectWinners[0].WinningAmount;
                            winningTicketNumbers = { physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners }
                        }

                    }
                    console.log("winningTicketNumbers & wonAmount", winningTicketNumbers, wonAmount)

                    let currentTurnCountTimer = 10;
                    let wofStopTurnCountTimer = 10;
                    if (gameData.gameName == "Wheel of Fortune" || gameData.gameName == "Treasure Chest") {
                        if (Timeout.exists(gameData._id.toString())) {
                            let currentTurnCountTimerTemp = Timeout.remaining(gameData._id.toString());
                            if (currentTurnCountTimerTemp) {
                                currentTurnCountTimer = Math.ceil(currentTurnCountTimerTemp / 1000);
                            }
                            console.log("timeout remianing of minigames", currentTurnCountTimer)
                        }

                        // Check remaining time if timer exists for wof to stop
                        if(gameData.gameName == "Wheel of Fortune"){
                            const wof_spin_timeout = `${gameData._id.toString()}_wof_spin_wheel`
                            if (Timeout.exists(wof_spin_timeout)) {
                                const currentTurnCountTimerTemp = Timeout.remaining(wof_spin_timeout);
                                if (currentTurnCountTimerTemp) {
                                    wofStopTurnCountTimer = Math.ceil(currentTurnCountTimerTemp / 1000);
                                }
                                console.log("timeout remianing of wof stop minigames Tv screen", wofStopTurnCountTimer)
                            }
                        }
                    }

                    const isSpinByAdmin = gameData?.otherData?.isSpinByAdmin;
                    minigameData = {
                        "gameName": gameData.gameName,
                        //"isMinigameActivated": gameData.otherData.isMinigameActivated,
                        "isMinigamePlayed": gameData.otherData.isMinigamePlayed,
                        //"isMinigameFinished": gameData.otherData.isMinigameFinished
                        "isDisplayWheel": isDisplayWheel,
                        "isMinigameActivated": gameData.otherData.isMinigameActivated,
                        "isMinigameFinished": gameData.otherData.isMinigameFinished,
                        "wonAmount": wonAmount,
                        "winningTicketNumbers": winningTicketNumbers,
                        "turnTimer":  isSpinByAdmin ? 0 : parseInt(currentTurnCountTimer),
                        "isWofSpinStopped": gameData?.otherData?.isWofSpinStopped ?? false, // it will be true for wof after spin stopped broadcast sent
                        "showAutoTurnCount": isSpinByAdmin ? false : true,
                        "remainingStopTimer": wofStopTurnCountTimer //  this is for wof game
                    }
                }
            }
            let wonAmount = 0, winningTicketNumbers = [];
            if (gameData.gameName == "Mystery") {
                let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                if (gameData.mystryWinners && gameData.mystryWinners.length > 0) {
                    for (let w = 0; w < gameData.mystryWinners.length; w++) {
                        if (gameData.mystryWinners[w].playerType == "Physical") {
                            physicalWinners.push({ ticketNumber: gameData.mystryWinners[w].ticketNumber, winningAmount: gameData.mystryWinners[w].WinningAmount });
                        } else if (gameData.mystryWinners[w].playerType == "Online") {
                            onlineWinners.push({ ticketNumber: gameData.mystryWinners[w].ticketNumber, winningAmount: gameData.mystryWinners[w].WinningAmount });
                        } else {
                            uniqueWinners.push({ ticketNumber: gameData.mystryWinners[w].ticketNumber, winningAmount: gameData.mystryWinners[w].WinningAmount });
                        }
                    }
                    wonAmount = gameData.mystryWinners[0].WinningAmount;
                    winningTicketNumbers = { physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners }
                }
                minigameData = {
                    "gameName": gameData.gameName,
                    "isMinigamePlayed": gameData.otherData.isMinigamePlayed,
                    "isDisplayWheel": false,
                    "isMinigameActivated": gameData.otherData.isMinigameActivated,
                    "isMinigameFinished": gameData.otherData.isMinigameFinished,
                    "wonAmount": wonAmount,
                    "winningTicketNumbers": winningTicketNumbers,
                    //"mysteryHistory": gameData.otherData.mysteryHistory
                }
            } else if (gameData.gameName == "Color Draft") {
                let physicalWinners = [], onlineWinners = [], uniqueWinners = [];
                if (gameData.colorDraftWinners && gameData.colorDraftWinners.length > 0) {
                    for (let w = 0; w < gameData.colorDraftWinners.length; w++) {
                        if (gameData.colorDraftWinners[w].playerType == "Physical") {
                            physicalWinners.push({ ticketNumber: gameData.colorDraftWinners[w].ticketNumber, winningAmount: gameData.colorDraftWinners[w].WinningAmount });
                        } else if (gameData.colorDraftWinners[w].playerType == "Online") {
                            onlineWinners.push({ ticketNumber: gameData.colorDraftWinners[w].ticketNumber, winningAmount: gameData.colorDraftWinners[w].WinningAmount });
                        } else {
                            uniqueWinners.push({ ticketNumber: gameData.colorDraftWinners[w].ticketNumber, winningAmount: gameData.colorDraftWinners[w].WinningAmount });
                        }
                    }
                    wonAmount = gameData.colorDraftWinners[0].WinningAmount;
                    winningTicketNumbers = { physicalWinners: physicalWinners, onlineWinners: onlineWinners, uniqueWinners: uniqueWinners }
                }
                minigameData = {
                    "gameName": gameData.gameName,
                    "isMinigamePlayed": gameData.otherData.isMinigamePlayed,
                    "isDisplayWheel": false,
                    "isMinigameActivated": gameData.otherData.isMinigameActivated,
                    "isMinigameFinished": gameData.otherData.isMinigameFinished,
                    "wonAmount": wonAmount,
                    "winningTicketNumbers": winningTicketNumbers,
                    "miniGameHistory": gameData.otherData.miniGameHistory
                }
            }

            if (gameStatus == "finish" && gameData.otherData.isMinigameActivated == true) {
                if (gameData.winners.length > 0) {
                    let isIndex = gameData.winners.findIndex((e) => (e.enabledSpinner == true));
                    if (isIndex >= 0) {
                        minigameData.isForAdmin = (gameData.winners[isIndex].userType == "Physical") ? true : false
                    }
                }
            }

            // show last winning pattern
            let winningTickets = [];
            if (gameData.adminWinners && gameData.adminWinners.length > 0) {
                //const lastLineTypeDisplay = gameData.adminWinners[gameData.adminWinners.length - 1].lineTypeDisplay;
                //const adminWinners = gameData.adminWinners.filter(winner => winner.lineTypeDisplay === lastLineTypeDisplay);
                const maxDrawNumber = Math.max(...gameData.adminWinners.map(winner => winner?.drawNumber));
                const adminWinners = gameData.adminWinners.filter(winner => winner.drawNumber === maxDrawNumber);
                const resultArray = [...adminWinners.reduce((mp, o) => {
                    if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, winningTickets: [] }); // update winningTicket to winningTickets
                    mp.get(o.lineType).winningTickets.push({ ticket: o.ticketCellArray, wonElement: o.wonElements });
                    return mp;
                }, new Map).values()];
                console.log("adminWinners and resultArray", adminWinners, resultArray)
                // for (let w = 0; w < resultArray.length; w++) {

                //     if (resultArray[w].winningTicket && resultArray[w].winningTicket.length > 0) {
                //         for (let i = 0; i < resultArray[w].winningTicket.length; i++) {
                //             if (resultArray[w].lineType == "Frame") {
                //                 let frame = ["0:0", "0:1", "0:2", "0:3", "0:4", "1:0", "1:4", "2:0", "2:4", "3:0", "3:4", "4:0", "4:1", "4:2", "4:3", "4:4"];
                //                 const frameSet = new Set(frame);
                //                 const filteredArray = resultArray[w].winningTicket[i].ticket.map((row, rowIndex) =>
                //                     row.map((item, colIndex) => {
                //                         const coord = `${rowIndex}:${colIndex}`;
                //                         return frameSet.has(coord) ? item : "";
                //                     })
                //                 );
                //                 winningTickets.push({ numbers: filteredArray, patternName: resultArray[w].lineType });
                //             } else if (resultArray[w].lineType == "Picture") {
                //                 let picture = ["1:1", "1:2", "1:3", "2:1", "2:2", "2:3", "3:1", "3:2", "3:3"];
                //                 const frameSet = new Set(picture);
                //                 const filteredArray = resultArray[w].winningTicket[i].ticket.map((row, rowIndex) =>
                //                     row.map((item, colIndex) => {
                //                         const coord = `${rowIndex}:${colIndex}`;
                //                         return frameSet.has(coord) ? item : "";
                //                     })
                //                 );
                //                 winningTickets.push({ numbers: filteredArray, patternName: resultArray[w].lineType });
                //             } else if (resultArray[w].lineType == "Row 1" && resultArray[w].winningTicket[i].wonElement.columns.length > 0) {
                //                 const showColumnAsRow = (arr, columnIndex) => {
                //                     const column = arr.map(row => row[columnIndex]);
                //                     return arr.map((row, index) => index === columnIndex ? column : ["", "", "", "", ""]);
                //                 };
                //                 const result = showColumnAsRow(resultArray[w].winningTicket[i].ticket, (+resultArray[w].winningTicket[i].wonElement.columns[0]));
                //                 winningTickets.push({ numbers: result, patternName: resultArray[w].lineType });
                //             } else {
                //                 const result = resultArray[w].winningTicket[i].ticket.map((row, index) => {
                //                     return resultArray[w].winningTicket[i].wonElement.rows.includes(index) ? row : ["", "", "", "", ""];
                //                 });
                //                 winningTickets.push({ numbers: result, patternName: resultArray[w].lineType });
                //             }
                //         }
                //     }
                // }
                winningTickets = resultArray.flatMap(item => formatWinningTickets(item) || []);
            }
        
            // let finalWinningTickets = [];
            // if (winningTickets.length > 0) {
            //     finalWinningTickets = winningTickets.map(item => ({
            //         numbers: item.numbers.flat().map(String),
            //         patternName: item.patternName
            //     }));
            // }

            // next withdraw number for tv screen
            let nextWithdrawBall = gameData.otherData?.nextWithdrawBall ?? { number: null, color: null };
            
            //const lastWithdrawCount = withdrawNumberList.at(-1)?.totalWithdrawCount ?? -1;
            //const newWithdrawNumberList = (lastWithdrawCount === -1) ? withdrawNumberList:  [...withdrawNumberList, {number: nextWithdrawBall.number, color: nextWithdrawBall.color, totalWithdrawCount: lastWithdrawCount + 1 }];
            
            const newWithdrawNumberList = !gameData.otherData?.nextWithdrawBall ? withdrawNumberList:  [...withdrawNumberList, {number: nextWithdrawBall.number, color: nextWithdrawBall.color, totalWithdrawCount: withdrawNumberList.length + 1 }];
            
            // get next game from sequence and parentGame
            const nextGame = await getNextGame({parentGameId: gameData?.parentGameId, sequence: gameData?.sequence, day: gameData?.day})
            
            let result = {
                gameStatus: (gameStatus == "finish") ? "Finished" : (gameStatus == "active") ? "Waiting" : (gameStatus == "running") ? "Running" : gameStatus, //gameStatus,
                totalWithdrawCount: totalWithdrawCount,
                fullHouseWinners: fullHouseWinners,
                patternsWon: patternsWon,
                withdrawNumberList: newWithdrawNumberList, // withdrawNumberList,
                winningList: finalWinningList,
                gameName: gameData?.otherData?.customGameName || gameData.gameName, //gameData.gameName,
                gameCount: gameData.sequence,
                totalBallsDrawn: withdrawNumberList.length,
                minigameData: minigameData,
                isMinigameData: Object.keys(minigameData).length > 0, // added as per unity requirement as object check was not working in frontend
                gameFinishAdminData: {
                    totalWithdrawCount: totalWithdrawCount,
                    fullHouseWinners: fullHouseWinners,
                    patternsWon: patternsWon, // gameData.multipleWinners.length,
                    winners: gameData.otherData.winnerAdminResultArray
                },
                gameId: data.roomId,
                isGamePaused: (gameData.otherData.isPaused == true) ? true : false,
                pauseGameStats: gameData.otherData.pauseGameStats, 
                pauseGameMessage: "Checking the claimed tickets.",
                winningTickets: winningTickets, //finalWinningTickets,
                countDownDateTime: gameData.countDownDateTime,
                nextNumber: nextWithdrawBall,
                jackPotData,
                nextGame: { gameName: nextGame?.otherData?.customGameName || nextGame.gameName, sequence: nextGame.sequence },  // it will be { gameName, sequence }

            };
            console.log("result", result)

            await Sys.Io.of(Sys.Config.Namespace.Game1).to(socket.id).emit('SubscribeRoomAdmin', result);
            console.log("broadcast sent successfully.", socket.id)
            return {
                status: "success",
                message: "Game Found!"
            }
        } catch (e) {
            console.log("Error in adminHallDisplayLogin ", e);
        }
    },

    deleteDailySchedules: async function () {
        try {
            let queryGame1 = {
                status: { $in: ["active", "running"] },
                isSavedGame: false,
                endDate: { $lt: moment() },
            };
            let dailyScheduleList = await Sys.App.Services.scheduleServices.getDailySchedulesByData(queryGame1);
            console.log("dailyScheduleList---", dailyScheduleList)
            if (dailyScheduleList.length > 0) {
                for (let d = 0; d < dailyScheduleList.length; d++) {
                    let endDate = dailyScheduleList[d].endDate;
                    console.log("endDate of daily schedule", endDate, moment(endDate), moment());
                    if (moment() > moment(endDate)) {
                        await Sys.App.Services.scheduleServices.updateDailySchedulesData({ _id: dailyScheduleList[d]._id }, {
                            $set: { "status": "finish" }
                        });
                        await Sys.Game.Game1.Services.GameServices.updateManyData(
                            { "parentGameId": dailyScheduleList[d]._id },
                            { $set: { "status": "finish" } }
                        );
                    }
                }
            }

            // Restore all the registered tickets to default for all the halls
            console.log("Remove all the registered tickets")
            //Sys.App.Services.scheduleServices.deleteManyAgentRegisteredTicket({});

            // Now as we are not deleting or resetting registered ticket and we are removing hold tivkets 
            // Remove IDs in holdTicketIds from both soldTicketIds and holdTicketIds
            Sys.App.Services.scheduleServices.updateManyAgentRegisteredTicketData(
                {},
                [
                    {
                        $set: {
                          allRange: {
                            $map: {
                              input: "$allRange",
                              as: "range",
                              in: {
                                // Keep all the fields of the range object as they are
                                $mergeObjects: [
                                  "$$range", // Keep all fields of the range object unchanged
                                  {
                                    // Apply $setDifference to soldTicketIDs
                                    soldTicketIDs: {
                                      $setDifference: ["$$range.soldTicketIDs", "$$range.holdTicketIds"]
                                    },
                                    // Clear holdTicketIds
                                    holdTicketIds: []
                                  }
                                ]
                              }
                            }
                          }
                        }
                      }
                ]
            );
            Sys.App.Services.scheduleServices.deleteManyAgentSellPhysicalTicket({});

            return { status: "success" };
        } catch (error) {
            console.log("Error deleteDailySchedules", error);
        }
    },

    csvImport: async function (req, res) {
        try {
            // TEKNOBINGO 2, TEKNOBINGO 3 & TEKNOBINGO 4 Hall name and Ids will change in future
            let halls =
                [
                    { name: "Furuset Bingo", number: "1", uniqueHallName: "TEKNOBINGO 1", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [450001, 453000] }, { type: "Small Yellow", range: [453001, 456000] }, { type: "Large White", range: [456001, 459000] }, { type: "Large Yellow", range: [459001, 462000] }, { type: "traffic-light", range: [462001, 465000] }] },
                    { name: "Open", number: "123", uniqueHallName: "TEKNOBINGO 2", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [468001, 471000] }, { type: "Small Yellow", range: [471000, 474000] }, { type: "Large White", range: [474001, 477000] }, { type: "Large Yellow", range: [477001, 480000] }, { type: "traffic-light", range: [480001, 483000] }] },
                    { name: "Open", number: "123", uniqueHallName: "TEKNOBINGO 3", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [486001, 489000] }, { type: "Small Yellow", range: [489001, 492000] }, { type: "Large White", range: [492001, 495000] }, { type: "Large Yellow", range: [495001, 498000] }, { type: "traffic-light", range: [498001, 501000] }] },
                    { name: "Open", number: "123", uniqueHallName: "TEKNOBINGO 4", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [504001, 507000] }, { type: "Small Yellow", range: [507001, 510000] }, { type: "Large White", range: [510001, 513000] }, { type: "Large Yellow", range: [513001, 516000] }, { type: "traffic-light", range: [516001, 519000] }] },
                    //{name: "Spillorama Stokke", number: "8", uniqueHallName: "TEKNOBINGO 4", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [504001,507000] }, { type: "Small Yellow", range: [507001,510000] }, { type: "Large White", range: [510001,513000] }, { type: "Large Yellow", range: [513001,516000] }, { type: "traffic-light", range: [516001,519000] }] },
                    { name: "Spillorama Gulset", number: "790", uniqueHallName: "TEKNOBINGO 5", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [522001, 525000] }, { type: "Small Yellow", range: [525001, 528000] }, { type: "Large White", range: [528001, 531000] }, { type: "Large Yellow", range: [531001, 534000] }, { type: "traffic-light", range: [534001, 537000] }] },
                    { name: "Spillorama Hokksund", number: "120", uniqueHallName: "TEKNOBINGO 6", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [540001, 543000] }, { type: "Small Yellow", range: [543001, 546000] }, { type: "Large White", range: [546001, 549000] }, { type: "Large Yellow", range: [549001, 552000] }, { type: "traffic-light", range: [552001, 555000] }] },
                    { name: "Teknobingo Skien", number: "580", uniqueHallName: "TEKNOBINGO 7", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [558001, 561000] }, { type: "Small Yellow", range: [561001, 564000] }, { type: "Large White", range: [564001, 567000] }, { type: "Large Yellow", range: [567001, 570000] }, { type: "traffic-light", range: [570001, 573000] }] },
                    { name: "Teknobingo Stathelle", number: "260", uniqueHallName: "TEKNOBINGO 8", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [576001, 579000] }, { type: "Small Yellow", range: [579001, 582000] }, { type: "Large White", range: [582001, 585000] }, { type: "Large Yellow", range: [585001, 588000] }, { type: "traffic-light", range: [588001, 591000] }] },
                    { name: "Teknobingo Kragerø", number: "560", uniqueHallName: "TEKNOBINGO 9", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [600001, 603000] }, { type: "Small Yellow", range: [603001, 606000] }, { type: "Large White", range: [606001, 609000] }, { type: "Large Yellow", range: [609001, 612000] }, { type: "traffic-light", range: [612001, 615000] }] },
                    { name: "Teknobingo Brumunddal", number: "540", uniqueHallName: "TEKNOBINGO 10", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [618001, 621000] }, { type: "Small Yellow", range: [621001, 624000] }, { type: "Large White", range: [624001, 627000] }, { type: "Large Yellow", range: [627001, 630000] }, { type: "traffic-light", range: [630001, 633000] }] },
                    { name: "Teknobingo Lillehammer", number: "220", uniqueHallName: "TEKNOBINGO 11", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [636001, 639000] }, { type: "Small Yellow", range: [639001, 642000] }, { type: "Large White", range: [642001, 645000] }, { type: "Large Yellow", range: [645001, 648000] }, { type: "traffic-light", range: [648001, 651000] }] },
                    { name: "Spillorama Hamar", number: "100", uniqueHallName: "TEKNOBINGO 12", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [654001, 657000] }, { type: "Small Yellow", range: [657001, 660000] }, { type: "Large White", range: [660001, 663000] }, { type: "Large Yellow", range: [663001, 666000] }, { type: "traffic-light", range: [666001, 669000] }] },
                    { name: "Teknobingo Vinstra", number: "240", uniqueHallName: "TEKNOBINGO 13", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [672001, 675000] }, { type: "Small Yellow", range: [675001, 678000] }, { type: "Large White", range: [678001, 681000] }, { type: "Large Yellow", range: [681001, 684000] }, { type: "traffic-light", range: [684001, 687000] }] },
                    { name: "Teknobingo Heimdal", number: "600", uniqueHallName: "TEKNOBINGO 14", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [690001, 693000] }, { type: "Small Yellow", range: [693001, 696000] }, { type: "Large White", range: [696001, 699000] }, { type: "Large Yellow", range: [699001, 702000] }, { type: "traffic-light", range: [702001, 705000] }] },
                    { name: "Teknobingo Sunndalsøra", number: "300", uniqueHallName: "TEKNOBINGO 15", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [708001, 711000] }, { type: "Small Yellow", range: [711001, 714000] }, { type: "Large White", range: [714001, 717000] }, { type: "Large Yellow", range: [717001, 720000] }, { type: "traffic-light", range: [720001, 723000] }] },
                    { name: "Teknobingo Larvik", number: "140", uniqueHallName: "TEKNOBINGO 16", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [726001, 729000] }, { type: "Small Yellow", range: [729001, 732000] }, { type: "Large White", range: [732001, 735000] }, { type: "Large Yellow", range: [735001, 738000] }, { type: "traffic-light", range: [738001, 741000] }] },
                    { name: "Teknobingo Orkanger", number: "280", uniqueHallName: "TEKNOBINGO 17", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [750001, 753000] }, { type: "Small Yellow", range: [753001, 756000] }, { type: "Large White", range: [756001, 759000] }, { type: "Large Yellow", range: [759001, 762000] }, { type: "traffic-light", range: [762001, 765000] }] },
                    { name: "Teknobingo Årnes", number: "520", uniqueHallName: "TEKNOBINGO 18", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [768001, 771000] }, { type: "Small Yellow", range: [771001, 774000] }, { type: "Large White", range: [774001, 777000] }, { type: "Large Yellow", range: [777001, 780000] }, { type: "traffic-light", range: [780001, 783000] }] },
                    { name: "Spillorama Bodø", number: "620", uniqueHallName: "TEKNOBINGO 19", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [786001, 789000] }, { type: "Small Yellow", range: [789001, 792000] }, { type: "Large White", range: [792001, 795000] }, { type: "Large Yellow", range: [795001, 798000] }, { type: "traffic-light", range: [798001, 801000] }] },
                    { name: "Teknobingo Sortland", number: "460", uniqueHallName: "TEKNOBINGO 20", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [804001, 807000] }, { type: "Small Yellow", range: [807001, 810000] }, { type: "Large White", range: [810001, 813000] }, { type: "Large Yellow", range: [813001, 816000] }, { type: "traffic-light", range: [816001, 819000] }] },
                    { name: "Teknobingo Finnsnes", number: "440", uniqueHallName: "TEKNOBINGO 21", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [822001, 825000] }, { type: "Small Yellow", range: [825001, 828000] }, { type: "Large White", range: [828001, 831000] }, { type: "Large Yellow", range: [831001, 834000] }, { type: "traffic-light", range: [834001, 837000] }] },
                    { name: "Teknobingo Harstad", number: "480", uniqueHallName: "TEKNOBINGO 22", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [840001, 843000] }, { type: "Small Yellow", range: [843001, 846000] }, { type: "Large White", range: [846001, 849000] }, { type: "Large Yellow", range: [849001, 852000] }, { type: "traffic-light", range: [852001, 855000] }] },
                    { name: "Teknobingo Fauske", number: "500", uniqueHallName: "TEKNOBINGO 23", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [858001, 861000] }, { type: "Small Yellow", range: [861001, 864000] }, { type: "Large White", range: [864001, 867000] }, { type: "Large Yellow", range: [867001, 870000] }, { type: "traffic-light", range: [870001, 873000] }] },
                    { name: "Teknobingo Gran", number: "320", uniqueHallName: "TEKNOBINGO 24", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [876001, 879000] }, { type: "Small Yellow", range: [879001, 882000] }, { type: "Large White", range: [882001, 885000] }, { type: "Large Yellow", range: [885001, 888000] }, { type: "traffic-light", range: [888001, 891000] }] },
                    { name: "Spillorama Notodden", number: "160", uniqueHallName: "TEKNOBINGO 25", supplier: "Bingo Entreprenøren AS", contractor: "BINGOENTREPRENØREN AS", tickets: [{ type: "Small White", range: [900001, 903000] }, { type: "Small Yellow", range: [903001, 906000] }, { type: "Large White", range: [906001, 909000] }, { type: "Large Yellow", range: [909001, 912000] }, { type: "traffic-light", range: [912001, 915000] }] },
                ];

            let trafficlightTemp = ['Small Red', 'Small Yellow', 'Small Green']; //["red", "yellow", "green"];
            let trafficlight = ['Small Red', 'Small Yellow', 'Small Green']; //["red", "yellow", "green"]

            const csvPath = path.join(__dirname, '../../../hallsTickets.csv');
            console.log("csv path", csvPath)

            let ticketsToInsert = [];
            const BATCH_SIZE = 1000;
            let ticketIds = []
            // fs.createReadStream(csvPath) 
            //     .pipe(fastcsv.parse({ headers: false, delimiter: '\t' }))
            //     .on("data", async function(data) {
            //         const ticketNumber = parseInt(data[0]);
            //         console.log("ticketNumber---", ticketNumber)
            //         for (const hall of halls) {
            //             const ticketType = findTicketType(hall, ticketNumber);
            //             console.log("ticketType11---", ticketType)
            //             if (ticketType) {
            //                 let ticketColor = "";
            //                 if(ticketType.type == "traffic-light"){
            //                     ticketColor = trafficlight[0];
            //                     trafficlight.shift();
            //                     if(trafficlight.length == 0){
            //                         trafficlight = [...trafficlightTemp];
            //                     }
            //                 }else{
            //                     ticketColor = ticketType.type;
            //                 }

            //                 const newTicket = {
            //                     ticketId: data[0],
            //                     tickets: [

            //                         [{ Number: data[1], checked: false }, { Number: data[2], checked: false }, { Number: data[3], checked: false }, { Number: data[4], checked: false }, { Number: data[5], checked: false }],

            //                         [{ Number: data[6], checked: false }, { Number: data[7], checked: false }, { Number: data[8], checked: false }, { Number: data[9], checked: false }, { Number: data[10], checked: false }],

            //                         [{ Number: data[11], checked: false }, { Number: data[12], checked: false }, { Number: data[13], checked: false }, { Number: data[14], checked: false }, { Number: data[15], checked: false }] ,  

            //                         [{ Number: data[16], checked: false }, { Number: data[17], checked: false }, { Number: data[18], checked: false }, { Number: data[19], checked: false }, { Number: data[20], checked: false }],

            //                         [{ Number: data[21], checked: false }, { Number: data[22], checked: false }, { Number: data[23], checked: false }, { Number: data[24], checked: false }, { Number: data[25], checked: false }],

            //                     ],
            //                     isPurchased: false,
            //                     playerIdOfPurchaser: "",
            //                     ticketType: (ticketType.type == "traffic-light") ? "traffic-light" : "standard",
            //                     ticketColor: ticketColor,
            //                     hallName: hall.name,
            //                     gameId: "",
            //                     hallNumber: hall.number,
            //                     uniqueHallName: hall.uniqueHallName,
            //                     supplier: hall.supplier,
            //                     contractor: hall.contractor,
            //                 };

            //                 ticketsToInsert.push(newTicket);
            //                 ticketIds.push(data[0])
            //                 // If we reach the batch size, insert all collected documents
            //                 if (ticketsToInsert.length === BATCH_SIZE) {console.log("inside----", ticketIds)
            //                     await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(ticketsToInsert, { ordered: true });
            //                     ticketsToInsert.length = 0; // Clear the array
            //                     ticketIds.length = 0;
            //                 }
            //             }
            //         }
            //     })
            //     .on('end', async () => {console.log("end--")
            //         // Insert any remaining documents
            //         if (ticketsToInsert.length > 0) {
            //             await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(ticketsToInsert, { ordered: true });
            //         }
            //         console.log('CSV file successfully processed');
            //     });


            return new Promise((resolve, reject) => {
                const csvStream = fs.createReadStream(csvPath)
                    .pipe(fastcsv.parse({ headers: false, delimiter: '\t' }))
                    .on('data', async (data) => {
                        csvStream.pause();  // Pause data stream to wait for async operations

                        const ticketNumber = parseInt(data[0]);
                        //console.log("ticketNumber---", ticketNumber)
                        for (const hall of halls) {
                            const ticketType = findTicketType(hall, ticketNumber);

                            if (ticketType) {
                                let ticketColor = "";
                                if (ticketType.type == "traffic-light") {
                                    ticketColor = trafficlight[0];
                                    trafficlight.shift();
                                    if (trafficlight.length == 0) {
                                        trafficlight = [...trafficlightTemp];
                                    }
                                } else {
                                    ticketColor = ticketType.type;
                                }

                                const newTicket = {
                                    ticketId: data[0],
                                    tickets: [

                                        [{ Number: data[1], checked: false }, { Number: data[2], checked: false }, { Number: data[3], checked: false }, { Number: data[4], checked: false }, { Number: data[5], checked: false }],

                                        [{ Number: data[6], checked: false }, { Number: data[7], checked: false }, { Number: data[8], checked: false }, { Number: data[9], checked: false }, { Number: data[10], checked: false }],

                                        [{ Number: data[11], checked: false }, { Number: data[12], checked: false }, { Number: data[13], checked: false }, { Number: data[14], checked: false }, { Number: data[15], checked: false }],

                                        [{ Number: data[16], checked: false }, { Number: data[17], checked: false }, { Number: data[18], checked: false }, { Number: data[19], checked: false }, { Number: data[20], checked: false }],

                                        [{ Number: data[21], checked: false }, { Number: data[22], checked: false }, { Number: data[23], checked: false }, { Number: data[24], checked: false }, { Number: data[25], checked: false }],

                                    ],
                                    isPurchased: false,
                                    playerIdOfPurchaser: "",
                                    ticketType: (ticketType.type == "traffic-light") ? "traffic-light" : "standard",
                                    ticketColor: ticketColor,
                                    hallName: hall.name,
                                    gameId: "",
                                    hallNumber: hall.number,
                                    uniqueHallName: hall.uniqueHallName,
                                    supplier: hall.supplier,
                                    contractor: hall.contractor,
                                };

                                ticketsToInsert.push(newTicket);
                                ticketIds.push(data[0])

                            }
                        }

                        if (ticketsToInsert.length >= BATCH_SIZE) {
                            try {
                                console.log("insert tickets---", ticketIds.length)
                                await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(ticketsToInsert, { ordered: true });
                                ticketsToInsert = [];
                                ticketIds.length = 0;
                            } catch (err) {
                                return reject(err);
                            }
                        }

                        csvStream.resume();
                    })
                    .on('end', async () => {
                        if (ticketsToInsert.length > 0) {
                            try {
                                console.log("insert tickets---", ticketIds.length)
                                await Sys.App.Services.GameService.insertManyStaticPhysicalTicketData(ticketsToInsert, { ordered: true });
                            } catch (err) {
                                return reject(err);
                            }
                        }
                        console.log('CSV file successfully processed');
                        res.send('Data inserted successfully!');
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error('Error reading CSV file:', err);
                        reject(err);
                    });
            });


        } catch (e) {
            console.log("error in importing data", e)
        }
    },

    // processCsvData: async function(){
    //     try{

    //     }catch(e){

    //     }
    // }

    cancelIndividualGameTickets: async function (socket, data) {
        try {
            console.log('cancelIndividualGameTickets called', data);
            const { playerId, gameId, ticketId1, ticketId2, ticketId3 } = data;
            let language = data.language || "nor";
        
            // Run player and game validation in parallel for faster response
            const [player, gameData] = await Promise.all([
                Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: playerId },
                    { username: 1, selectedLanguage: 1, hall: 1 }
                ),
                Sys.Game.Game1.Services.GameServices.getSingleByData(
                    { _id: gameId },
                    {
                        status: 1,
                        players: 1,
                        gameNumber: 1,
                        gameName: 1,
                        startDate: 1,
                        otherData: 1,
                        halls: 1,
                        parentGameId: 1,
                        subGames: 1
                    }
                )
            ]);
            
            language = player?.selectedLanguage || language;
            
            // Quick validations with early returns
            if (!player) {
                return Game1Helper.createErrorResponse('player_not_found', language, 400);
            }
            
            if (!gameData) {
                return Game1Helper.createErrorResponse('game_not_found', language, 400);
            }
            
            if (
                gameData.status === 'cancel' ||
                gameData.status === 'running' ||
                gameData.status === 'finish' ||
                gameData.otherData.disableCancelTicket
            ) {
                return Game1Helper.createErrorResponse('can_not_cancel_ticket', language, 400);
            }

            if (!gameData.players.some(p => p.id === playerId)) {
                return Game1Helper.createErrorResponse('error_cancelling_tickets', language, 400);
            }
        
            // Validate ticket IDs
            const ticketIds = [ticketId1, ticketId2, ticketId3].filter(Boolean);
            const { gameName } = gameData;
            
            if (
                ticketIds.length === 0 ||
                (gameName === 'Elvis' && ticketIds.length !== 2) ||
                (gameName === 'Traffic Light' && ticketIds.length !== 3)
            ) {
                return Game1Helper.createErrorResponse('error_cancelling_tickets', language, 400);
            }
        
            // Fetch tickets
            const tickets = await Sys.Game.Game1.Services.GameServices.getTicketListData(
                { playerIdOfPurchaser: playerId, gameId, _id: { $in: ticketIds } },
                {
                    ticketId: 1,
                    ticketParentId: 1,
                    ticketColorName: 1,
                    ticketColorType: 1,
                    tickets: 1,
                    ticketPrice: 1,
                    userTicketType: 1,
                    hallId: 1,
                }
            );
        
            if (
                !tickets?.length ||
                (gameName === 'Elvis' && tickets.length !== 2) ||
                (gameName === 'Traffic Light' && tickets.length !== 3) ||
                (tickets.some(t => t.ticketColorType === 'large') && tickets.length !== 3)
            ) {
                return Game1Helper.createErrorResponse('error_cancelling_tickets', language, 400);
            }
        
            // Calculate ticket price and quantity
            let ticketPrice = 0;
            let ticketQty = tickets.length;
            const purchasedSlug = 'realMoney';
            const subgame = gameData.subGames[0].options;
            const incObj = {};
            const filterArr = [];
            const ticketHallId = tickets[0].hallId.toString();
            
            // Handle game-specific ticket validation and pricing
            // Handle ticket validation and pricing based on game type
            if (gameName === 'Traffic Light') {
                // Validate all three colors are present
                const trafficColors = ['Small Red', 'Small Yellow', 'Small Green'];
                const ticketColors = tickets.map(t => t.ticketColorName);
                
                if (!trafficColors.every(color => ticketColors.includes(color))) {
                    return Game1Helper.createErrorResponse('error_cancelling_tickets', language, 400);
                }
                
                // Update ticket counts for all subgames
                subgame.forEach((sg, index) => {
                    const alpha = String.fromCharCode(97 + index);
                    incObj[`players.$.purchaseTicketTypes.$[${alpha}].totalPurchasedTickets`] = -1;
                    incObj[`subGames.$[].options.$[${alpha}].totalPurchasedTickets`] = -1;
                    filterArr.push({ [`${alpha}.ticketName`]: sg.ticketName });
                });
                
                ticketPrice = subgame[0].ticketPrice;
                ticketQty = 3;
            } else {
                // Common logic for Elvis and other games
                const ticketColorName = tickets[0].ticketColorName;
                const subgameIndex = subgame.findIndex(sg => sg.ticketName === ticketColorName);
                
                if (subgameIndex !== -1) {
                    const alpha = String.fromCharCode(97 + subgameIndex);
                    incObj[`players.$.purchaseTicketTypes.$[${alpha}].totalPurchasedTickets`] = -1;
                    incObj[`subGames.$[].options.$[${alpha}].totalPurchasedTickets`] = -1;
                    filterArr.push({ [`${alpha}.ticketName`]: ticketColorName });
                }
                
                // Set ticket price and quantity based on game type
                if (gameName === 'Elvis') {
                    ticketPrice = subgame[0].ticketPrice;
                    ticketQty = 2; // Explicitly set for Elvis game
                } else {
                    ticketPrice = tickets[0].ticketPrice;
                    // ticketQty is already set to tickets.length by default
                }
            }
            // let deductPlayerSpending = await checkPlayerSpending({ playerId: data.playerId, hallId: player.hall.id, amount: +ticketPrice });
            // if(!deductPlayerSpending.isValid){
            //     return Game1Helper.createErrorResponse(deductPlayerSpending.error, language, 401);
            // }
            // Update game data
            const updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                { _id: gameId, 'players.id': playerId },
                {
                    $inc: {
                        ticketSold: -ticketQty,
                        earnedFromTickets: -ticketPrice,
                        finalGameProfitAmount: -ticketPrice,
                        'players.$.ticketPrice': -ticketPrice,
                        'players.$.totalPurchasedTickets': -ticketQty,
                    },
                },
                { new: true }
            );
            
            if (!updateGame) {
                console.log('error in cancelling ticket');
                return Game1Helper.createErrorResponse('went_wrong_cancelling_tickets', language, 500);
            }
            
            // Create transaction and update ticket types in parallel
            filterArr.push(
                { 'group.halls.id': ticketHallId },
                { 'hall.id': ticketHallId }
            );
            
            const [_, ticketTypeUpdate] = await Promise.all([
                Game1Helper.createCancelTransaction({
                    playerId,
                    gameId,
                    ticketPrice,
                    purchasedSlug,
                }),
                Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: gameId, 'players.id': playerId },
                    { $inc: incObj },
                    { arrayFilters: filterArr, new: true }
                )
            ]);
            
            // Handle ticket mapping and deletion
            const removeTicketIds = tickets.map(ticket => ticket._id);
            await module.exports.removeCanceledTicketsMapping(removeTicketIds, gameData._id);
        
            // Calculate ticket counts by type and color
            const ticketCounts = tickets.reduce((obj, ticket) => {
                const ticketType = ticket.userTicketType;
                const colorKey = ticket.ticketColorName.split(' ').join('').toLowerCase();
                
                if (!obj[ticketType][colorKey]) {
                    obj[ticketType][colorKey] = {
                        type: ticket.ticketColorType,
                        count: 0
                    };
                }
                
                obj[ticketType][colorKey].count += 1;
                return obj;
            }, { Physical: {}, Terminal: {}, Web: {} });
            
            // Prepare update query for database
            const updateQuery = { $inc: {} };
            
            // Process each ticket type and color
            Object.entries(ticketCounts).forEach(([ticketType, colors]) => {
                Object.entries(colors).forEach(([colorKey, data]) => {
                    const count = data.type === 'large' ? -(data.count / 3) : -data.count;
                    updateQuery.$inc[`groupHalls.$[group].halls.$[hall].userTicketType.${ticketType}.${colorKey}`] = count;
                });
            });
            
            // Execute database operations in parallel
            await Promise.all([
                // Update the game data in database
                Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: gameData._id },
                    updateQuery,
                    {
                        arrayFilters: [
                            { 'group.halls.id': ticketHallId },
                            { 'hall.id': ticketHallId }
                        ]
                    }
                ),
                
                // Delete tickets
                Sys.App.Services.GameService.deleteTicketManydata({
                    playerIdOfPurchaser: playerId,
                    gameId,
                    _id: { $in: ticketIds },
                }),
                
                // Create notification
                Game1Helper.createCancelNotification({
                    playerId: player._id,
                    gameId: gameData._id,
                    gameNumber: gameData.gameNumber,
                    gameName: gameData.gameName,
                    ticketQty,
                    ticketPrice,
                    startDate: gameData.startDate,
                    language: player.selectedLanguage,
                })
            ]);

            // Emit events
            gameData?.halls.forEach((hall) => {
                Sys.Io.of('admin').to(hall).emit('refresh', { scheduleId: gameData.parentGameId });
            });
            
            await Game1Helper.emitSalesGameEvents(gameData);
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "cancel",
                playerId: playerId,
                hallId: ticketHallId,
                cancel: ticketPrice
            });
            await updatePlayerHallSpendingData({ playerId: playerId, hallId: ticketHallId, amount: +ticketPrice, type: "normal", gameStatus: 2 });
            return {
                status: 'success',
                result: '',
                message: await translate({
                    key: 'ticket_cancellation_success',
                    language: player.selectedLanguage,
                }),
            };
        } catch (e) {
            console.error('Error in cancelIndividualGameTickets:', e);
            return new Error(e);
        }
    },

    checkForUpcomingGameForSubscribeRoom: async function(socket, data) {
        const { playerId, language, callCount = 0 } = data;
        const MAX_CALLS = 2; // Set a reasonable limit for recursive calls
        
        // Early return if we've exceeded the maximum call depth
        if (callCount > MAX_CALLS) {
            return {
                status: 'fail',
                result: null,
                messageType: await translate({ key: "game_not_found", language: language }),
                message: await translate({ key: "game_not_found", language: language }),
            };
        }
        
        try {
            // Use Promise to handle the Game1Room request asynchronously
            const newGame = await module.exports.Game1Room(socket, { 
                language: language, 
                playerId: playerId 
            });
            
            if (newGame && newGame.status === "success") {
                let nextGameId = null;
                
                // Use optional chaining for safer property access
                if (newGame.result?.runningGame && Object.keys(newGame.result.runningGame).length > 0) {
                    nextGameId = newGame.result.runningGame?.gameId ?? null;
                } else if (newGame.result?.upcomingGame && Object.keys(newGame.result.upcomingGame).length > 0) {
                    nextGameId = newGame.result.upcomingGame?.gameId ?? null;
                }
                
                console.log("nextGameId in checkForUpcomingGameForSubscribeRoom---", nextGameId);
                
                if (nextGameId) {
                    // Use setImmediate to avoid blocking the event loop
                    return new Promise(resolve => {
                        setImmediate(async () => {
                            try {
                                const subscribeRoomRes = await module.exports.subscribeRoom(socket, { 
                                    language: language, 
                                    playerId: playerId, 
                                    gameId: nextGameId, 
                                    callCount: (callCount + 1), 
                                    isInternal: true 
                                });
                                resolve(subscribeRoomRes);
                            } catch (err) {
                                resolve({
                                    status: 'fail',
                                    result: null,
                                    message: await translate({ key: "something_went_wrong", language: language }),
                                    statusCode: 500
                                });
                            }
                        });
                    });
                }
            }
            
            // Default failure response
            return {
                status: 'fail',
                result: null,
                messageType: await translate({ key: "game_not_found", language: language }),
                message: await translate({ key: "game_not_found", language: language }),
            };
            
        } catch (error) {
            console.log("Error in checkForUpcomingGameForSubscribeRoom:", error);
            return {
                status: 'fail',
                result: null,
                message: await translate({ key: "something_went_wrong", language: language }),
                statusCode: 500
            };
        }
    },

    /**
     * Stop a running game for a player
     * @param {object} socket - The socket object
     * @param {object} data - The data object containing the playerId and language
     * @return {object} - The response object containing a status and a message
     */
    stopGameByPlayers: async function(socket, data){
        try {
            const { playerId, language = "nor" } = data;
            console.log("playerid and language", playerId, language)
            // Get player data with the provided playerId
            let player = null;
            if(playerId){
                player = await Sys.Game.Common.Services.PlayerServices.getOneByData({ _id: playerId, selectedLanguage: 1 }, { hall: 1 });
            }
            // If player found, update language with their selected language
            //const playerLanguageGame = player ? player.selectedLanguage : language;
            const playerLanguageAdmin = (player ? player.selectedLanguage : language) === "en" ? "english" : "norwegian";
            
            // Get player IP from socket
            let playerIp = socket.handshake.headers['x-forwarded-for'] ? socket.handshake.headers['x-forwarded-for'].split(',')[0] : socket.conn.remoteAddress;
            playerIp = playerIp.startsWith('::ffff:') ? playerIp.slice(7) : playerIp;
            console.log("playerIp---", playerIp);
            // Get hall by IP
            const hall = await Sys.App.Services.HallServices.getSingleHallData({ ip: playerIp }, { name: 1 });
    
            // If no hall or hall id doesn't match player's hall, return error
            if (!hall || (player && hall.id !== player.hall?.id)) {
                return {
                    status: 'fail',
                    message: await Sys.Helper.bingo.getSingleTraslateData(['you_are_not_allowed_to_perform_this_operation'], playerLanguageAdmin),
                };
            }

            const runningGame = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                {
                    gameType: 'game_1',
                    halls: { $in: [hall.id] },
                    stopGame: false,
                    'otherData.isClosed': false,
                    startDate: {
                        $gte: moment().startOf('day').toDate(),
                        $lt: moment().endOf('day').toDate()
                    },
                    $or: [
                        { "status": "finish", "otherData.gameSecondaryStatus": "running" },
                        { "status": "running" },
                    ],
                },
                { gameNumber: 1, gameName: 1, otherData: 1, status: 1 }
            );

            if (!runningGame) {
                return {
                    status: "fail",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['there_is_no_running_game_to_stop'], playerLanguageAdmin) || 'There is no ongoing game to stop',
                };
            }

            if (runningGame.otherData?.isPaused) {
                return {
                    status: "fail",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['game_already_paused'], playerLanguageAdmin) || 'Game is already paused',
                };
            }

            if (runningGame.status === "finish") {
                if (
                    ["Wheel of Fortune", "Treasure Chest", "Mystery", "Color Draft"].includes(runningGame.gameName) &&
                    (runningGame.otherData?.isMinigameActivated || runningGame.otherData?.isMinigameExecuted)
                ) {
                    // Handle minigame-specific logic if needed
                } else {
                    return {
                        status: "fail",
                        message: await Sys.Helper.bingo.getSingleTraslateData(['game_already_finished'], playerLanguageAdmin) || 'Game is already finished',
                    };
                }
            }

            if (runningGame.status === "active" && !Timeout.exists(runningGame._id.toString())) {
                return res.send({
                    status: "fail",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['pause_running_game_only'], playerLanguageAdmin) || 'You can only pause running game, Current game has not started yet'
                });
            }

            // Stop the game
            const stopGameResponse = await Sys.Game.Game1.Controllers.GameProcess.stopGame(runningGame.id, playerLanguageAdmin, false);
            if (stopGameResponse?.status === "success") {
                return {
                    status: "success",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['game_paused_successfully'], playerLanguageAdmin) || 'Game is paused',
                };
            } else {
                return {
                    status: "fail",
                    message: stopGameResponse.message,
                };
            }
    
        } catch (e) {
            console.log("Error in stop game by players", e);
        }
    },

    tvscreenUrlForPlayers: async function(socket, data){
        try{
            console.log("tvscreenUrlForPlayers---", data);
            let { language = "en", deviceType } = data;
            const playerLanguageAdmin = language === "en" ? "english" : "norwegian";
            if(deviceType == "webgl"){
                deviceType = "web"
            }
            // Get player IP from socket
            let playerIp = socket.handshake.headers['x-forwarded-for'] ? socket.handshake.headers['x-forwarded-for'].split(',')[0] : socket.conn.remoteAddress;
            playerIp = playerIp.startsWith('::ffff:') ? playerIp.slice(7) : playerIp;
            console.log("playerIp---", playerIp);
            // Get hall by IP
            const hall = await Sys.App.Services.HallServices.getSingleHallData({ ip: playerIp }, { name: 1, groupHall: 1 });
            
            // If no hall or hall id doesn't match player's hall, return error
            if (!hall || !hall?.groupHall) {
                return {
                    status: 'fail',
                    result: "",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['you_are_not_allowed_to_perform_this_operation'], playerLanguageAdmin),
                };
            }

            let goh = await Sys.App.Services.GroupHallServices.getGroupHall({ _id: hall?.groupHall?.id }, { tvId: 1 });
            if (!goh) {
                return {
                    status: 'fail',
                    result: "",
                    message: await Sys.Helper.bingo.getSingleTraslateData(['you_are_not_allowed_to_perform_this_operation'], playerLanguageAdmin),
                };
            }

            return {
                status: 'success',
                result:  `${Sys.Config.App[Sys.Config.Database.connectionType].url}tv/${goh.tvId}?deviceType=${deviceType}`,
                message: "TV Screen Url Found."
            }; 

        }catch(e){
            console.log("Error in tv screen by players", e);
        }
    },

    /**
     * @function getJackpotData
     * @description Get jackpot data to be shown on the game screen.
     * @param {string} gameName - The name of the game.
     * @param {number} withdrawCount - The number of balls withdrawn.
     * @param {number} jackpotDraw - The number of balls in the jackpot.
     * @param {object} jackpotPrize - The prize for the jackpot.
     * @param {object} subGames - The subgames object.
     * @param {string} parentGameId - The id of the parent game.
     * @returns {object} - The jackpot data.
     */
    getJackpotData: async function(gameName, withdrawCount, jackpotDraw, jackpotPrize, subGames, parentGameId) {
        let jackPotData = { isDisplay: false };
        try{
            const isJackpotGame = gameName === "Jackpot";
            const isOddsenGame = gameName.startsWith("Oddsen");
            const isInnsatsenGame = gameName === "Innsatsen";

            const jackpotFullHousePrize = await getJackpotHighestPrice({allWinningOptions: subGames[0].options, pattern:'Full House', defaultValue: +subGames[0].options[0].winning['Full House']});

            /**
             * @function setJackpotData
             * @description Set jackpot data.
             * @param {number} draw - The number of balls in the jackpot.
             * @param {number} winningAmount - The prize for the jackpot.
             * @param {boolean} isDisplay - Whether to display the jackpot data.
             * @returns {object} - The jackpot data.
             */
            const setJackpotData = (draw, winningAmount, isDisplay, tvScreenWinningAmount, isDisplayOnTVScreen) => ({
                draw, winningAmount, isDisplay, tvScreenWinningAmount, isDisplayOnTVScreen
            });
        
            // If it is a Jackpot game and the number of withdrawn balls is less than the jackpot draw,
            if (isJackpotGame) {
                const maxJackpotPrize = Math.max(...Object.values(jackpotPrize));
                if (withdrawCount < (+jackpotDraw + 1) ) {
                    return setJackpotData(jackpotDraw, maxJackpotPrize, true, maxJackpotPrize, true);
                }
                return setJackpotData(jackpotDraw, jackpotFullHousePrize, false, jackpotFullHousePrize, true);
            } 
            // If it is an Oddsen game and the number of withdrawn balls is less than the oddsen draw,
            if (isOddsenGame) {
                const oddsenDraw = parseInt(gameName.split(" ")[1], 10);
                if (withdrawCount < (oddsenDraw + 1)) {
                    const oddsenPrize = subGames[0].options[0].winning[`Full House Within ${oddsenDraw} Balls`];
                    return setJackpotData(oddsenDraw, oddsenPrize, true, oddsenPrize, true);
                }
                return setJackpotData(oddsenDraw, jackpotFullHousePrize, false, jackpotFullHousePrize, true);
                
            } 
            // If it is an Innsatsen game and the number of withdrawn balls is less than the jackpot draw,
            if (isInnsatsenGame) {
                const dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData(
                    { _id: parentGameId }, 
                    { innsatsenSales: 1 }
                );
                const fullHousePrize = +parseFloat(subGames[0].options[0].winning["Full House"]).toFixed(2);
                if(dailySchedule && dailySchedule.innsatsenSales !== undefined){
                    // Get the amount before sales and the full house prize.
                    const innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
                    if(withdrawCount < (+jackpotDraw + 1)){
                        // Calculate the winning amount.
                        const winningAmount = Math.min( (innBeforeSales + fullHousePrize), 2000);
                        return setJackpotData(jackpotDraw, winningAmount, true, winningAmount, true);
                    }
                }
                return setJackpotData(jackpotDraw, jackpotFullHousePrize, false, jackpotFullHousePrize, true);
            }

            return jackPotData;
        }catch(e){
            console.log("Error in getJackpotData---", getJackpotData)
            return { isDisplay: false };
        }
        
    
    },
    // This function if used when we use ball mapping in game collection
    setPurchasedTicketsIdBallWiseOld: async function(playerPurchasedTickets, gameId) {
        const prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData(
            { _id: { $in: playerPurchasedTickets } }, 
            { tickets: 1 }
        );
    
        if (prTickets.length === 0) return new Map(); // Return empty Map if no tickets
    
        let bulkUpdateTicketData = [];
        let ticketsConfData = new Map(); // Use a Map for fast lookups
    
        prTickets.forEach(prTicket => {
            let ticketBallData = prTicket.tickets.flatMap((row, rowIndex) =>
                row.map((ticket, colIndex) =>
                    ticket.Number !== 0 ? [`ticketIdForBalls.${ticket.Number}`, { 
                        ticketId: prTicket._id, 
                        position: `${rowIndex}:${colIndex}` 
                    }] : null
                ).filter(Boolean) // Remove null entries
            );
    
            // Store data in Map for fast lookup
            ticketBallData.forEach(([key, value]) => {
                if (!ticketsConfData.has(key)) {
                    ticketsConfData.set(key, []);
                }
                ticketsConfData.get(key).push(value);
            });
    
            bulkUpdateTicketData.push({
                updateOne: {
                    filter: { _id: gameId },
                    update: { $push: Object.fromEntries(ticketBallData) }
                }
            });
        });
    
        // Bulk write in parallel (non-blocking)
        await Sys.Game.Game1.Services.GameServices.bulkWriteGameData(bulkUpdateTicketData, { ordered: false });
    
        return ticketsConfData;
    },
    // This function if used when we use ball mapping in game collection
    processDrawnNumbersOld: async function(gameId, ticketsConfData) {
        // Fetch drawn numbers once
        const ballDrawn = await Sys.Game.Game1.Services.GameServices.getSingleByData(
            { _id: gameId }, 
            { withdrawNumberArray: 1 }
        );
    
        if (!ballDrawn?.withdrawNumberArray?.length) return;
    
        let bulkUpdateTicketData = [];
    
        ballDrawn.withdrawNumberArray.forEach(drawNumber => {
            let selectedElements = ticketsConfData.get(`ticketIdForBalls.${drawNumber}`);
            if (!selectedElements) return;
    
            selectedElements.forEach(selectedElement => {
                let [row, col] = selectedElement.position.split(':');
                bulkUpdateTicketData.push({
                    updateOne: {
                        filter: { _id: selectedElement.ticketId },
                        update: { $set: { [`tickets.${row}.${col}.checked`]: true } }
                    }
                });
            });
        });
    
        if (bulkUpdateTicketData.length > 0) {
            await Sys.Game.Game1.Services.GameServices.bulkWriteTicketData(bulkUpdateTicketData, { ordered: false });
        }
    },
    /**
     * This function is used to set purchased tickets id ball wise in the new ball mapping collection
     * @param {array} playerPurchasedTickets - Array of ticket ids purchased by the player
     * @param {string} gameId - Game id
     * @returns {object} - Object with ball numbers as keys and array of ticket id and position as values
     */
    setPurchasedTicketsIdBallWise: async function (playerPurchasedTickets, gameId) {
        const prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData(
            { _id: { $in: playerPurchasedTickets } },
            { tickets: 1 }
        );
    
        if (!prTickets.length) return {}; // No tickets found
    
        const bulkInsertData = new Map();
        const ticketConfData = Object.create(null); // Faster object creation
    
        for (const { _id: ticketId, tickets } of prTickets) {
            for (let rowIndex = 0; rowIndex < tickets.length; rowIndex++) {
                const row = tickets[rowIndex];
                for (let colIndex = 0; colIndex < row.length; colIndex++) {
                    const ticket = row[colIndex];
                    if (ticket.Number === 0) continue; // Skip invalid numbers
    
                    const ballNumber = ticket.Number;
                    const position = `${rowIndex}:${colIndex}`;
    
                    // Bulk insert preparation
                    if (!bulkInsertData.has(ballNumber)) {
                        bulkInsertData.set(ballNumber, {
                            filter: { gameId, ballNumber },
                            update: { $push: { tickets: { $each: [] } } },
                            upsert: true
                        });
                    }
                    bulkInsertData.get(ballNumber).update.$push.tickets.$each.push({ ticketId, position });
    
                    // Return data preparation
                    (ticketConfData[ballNumber] ||= []).push({ ticketId, position });
                }
            }
        }
    
        // Bulk write if there are updates
        if (bulkInsertData.size) {
            await Sys.Game.Game1.Services.GameServices.bulkWriteTicketBallMappingData(
                [...bulkInsertData.values()].map(updateOne => ({ updateOne })),
                { ordered: false }
            );
        }
    
        return ticketConfData;
    },
    /**
     * This function processes the drawn numbers and updates the ticket data accordingly.
     * @param {string} gameId - The ID of the game.
     * @param {Map} ticketsConfData - A map containing ticket configuration data with ball numbers as keys.
     */
    processDrawnNumbers: async function (gameId, ticketsConfData) {
        try {
            // Fetch drawn numbers from the game data
            const gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                { _id: gameId },
                { withdrawNumberArray: 1 }
            );
           
            // Check if there are any drawn numbers
            if (!gameData?.withdrawNumberArray?.length) return;

            const ticketUpdatesMap = new Map();

            // Iterate over each drawn ball number
            gameData.withdrawNumberArray.forEach(ballNumber => {
                // Check if the ball number exists in the tickets configuration data
                if (ticketsConfData[ballNumber]) {console.log("inisde conf")
                    ticketsConfData[ballNumber].forEach(({ ticketId, position }) => {
                        let [row, col] = position.split(':');

                        // Initialize update map for the ticket if not already present
                        if (!ticketUpdatesMap.has(ticketId)) {
                            ticketUpdatesMap.set(ticketId, { filter: { _id: ticketId }, update: { $set: {} } });
                        }

                        // Mark the ticket cell as checked
                        ticketUpdatesMap.get(ticketId).update.$set[`tickets.${row}.${col}.checked`] = true;
                    });
                }
            });
            
            // Convert the map to a bulk update array
            const bulkUpdateTicketData = Array.from(ticketUpdatesMap.values()).map(updateOne => ({ updateOne }));

            // Perform bulk write if there are any updates
            if (bulkUpdateTicketData.length > 0) {
                await Sys.Game.Game1.Services.GameServices.bulkWriteTicketData(bulkUpdateTicketData, { ordered: false });
            }
        } catch (error) {
            // Log and throw error for further handling
            console.error("Error in processDrawnNumbers:", error);
            throw new Error(error);
        }
    },
    /**
     * This function is used to remove ticketIds from ballmapping collection.
     * It takes an array of ticketIds and a gameId as parameters.
     * It performs a bulk removal using $pull to remove the tickets from the ballmapping collection.
     * 
     * @param {Array<string>} canceledTicketIds - The ticketIds to remove from ballmapping collection.
     * @param {string} gameId - The gameId of the game.
     */
    removeCanceledTicketsMapping: async function (canceledTicketIds, gameId) {
        if (!canceledTicketIds.length) return;
    
        try {
            // Perform bulk removal using $pull
            await Sys.Game.Game1.Services.GameServices.bulkWriteTicketBallMappingData(
                canceledTicketIds.map(ticketId => ({
                    updateMany: {
                        filter: { gameId, "tickets.ticketId": ticketId },
                        update: { $pull: { tickets: { ticketId } } }
                    }
                })),
                { ordered: false }
            );
        } catch (error) {
            console.error("Error removing canceled tickets:", error);
            throw new Error(error);
        }
    },
    
    // Purchase ticket dynamic for testing purposes
    purchaseTickets: async function (req, res) {
        try {
            let gameId = req.body.gameId;

            // Fetch online players
            let players = await Sys.Game.Game1.Services.PlayerServices.getByData(
                { userType: "Bot" },
                { username: 1, selectedLanguage: 1 }
            );

            console.log("GameId:", gameId, "| Online Players:", players.length);

            // Get the Socket.IO namespace
            const game1Namespace = Sys.Io.of("/Game1");

            if (!players.length) {
                return res.status(400).json({ success: false, message: "No online players found" });
            }

            // Function to create event data for each player
            const createEventData = (playerId) => ({
                playerId,
                gameId,
                luckyNumber: 25,
                purchaseType: "realMoney",
                voucherCode: "",
                playerTicketType: "Online",
                purchasedTickets: JSON.stringify({
                    list: [
                        { ticketName: "Small Yellow", ticketQty: 300 },
                        { ticketName: "Large White", ticketQty: 100 },
                    ],
                }),
            });

            // Batch processing configuration
            const batchSize = 50; // Process 50 players at a time
            let successful = [];
            let failed = [];

            const processBatch = async (batch) => {
                await Promise.all(
                    batch.map(async (player) => {
                        try {
                            let eventData = createEventData(player._id);
                            await module.exports.PurchaseGame1Tickets(game1Namespace, eventData);
                            successful.push({ playerId: player._id, status: "success" });
                        } catch (error) {
                            console.error(`Purchase failed for player ${player._id}:`, error);
                            failed.push({ playerId: player._id, error: error.message || error });
                        }
                    })
                );
            };

            // Process players in batches
            for (let i = 0; i < players.length; i += batchSize) {
                const batch = players.slice(i, i + batchSize);
                await processBatch(batch);

                // Prevent blocking the event loop
                await new Promise((resolve) => setImmediate(resolve));
            }

            res.status(200).json({
                success: true,
                message: "Tickets processed ",
                successful,
                failed,
            });
        } catch (error) {
            console.error("Error in purchasing tickets:", error);
            res.status(500).json({ success: false, message: "Error purchasing tickets" });
        }
    },

    /**
     * Handles the purchase of tickets for a game dynamic for testing.
     * @param {Object} req - The request object containing gameId.
     * @param {Object} res - The response object to send the result.
     */
    purchaseTickets1: async function (req, res) {
        try {
            let gameId = req.body.gameId;

            // Fetch online players of type "Bot"
            let players = await Sys.Game.Game1.Services.PlayerServices.getByData(
                { userType: "Bot" },
                { username: 1, selectedLanguage: 1 }
            );

            console.log("GameId:", gameId, "| Online Players:", players.length);

            // Get the Socket.IO namespace for Game1
            const game1Namespace = Sys.Io.of("/Game1");

            if (!players.length) {
                // Return early if no players are found
                return res.status(400).json({ success: false, message: "No online players found" });
            }

            let successful = [];
            let failed = [];

            /**
             * Creates event data for a player.
             * @param {String} playerId - The ID of the player.
             * @returns {Object} The event data for the player.
             */
            const createEventData = (playerId) => ({
                playerId,
                gameId,
                luckyNumber: 25,
                purchaseType: "realMoney",
                voucherCode: "",
                playerTicketType: "Online",
                purchasedTickets: JSON.stringify({
                    list: [
                        { ticketName: "Small Yellow", ticketQty: 100 },
                        { ticketName: "Large Yellow", ticketQty: 100 },
                    ],
                }),
            });

            // Process each player sequentially
            for (const player of players) {
                try {
                    let eventData = createEventData(player._id);

                    // Await each call to ensure sequential execution
                    await module.exports.PurchaseGame1Tickets(game1Namespace, eventData);

                    successful.push({ playerId: player._id, status: "success" });
                } catch (error) {
                    console.error(`Purchase failed for player ${player._id}:`, error);
                    failed.push({ playerId: player._id, error: error.message || error });
                }

                // Prevent blocking the event loop
                await new Promise((resolve) => setImmediate(resolve));
            }

            // Respond with the results of the ticket processing
            res.status(200).json({
                success: true,
                message: "Tickets processed",
                successful,
                failed,
            });
        } catch (error) {
            console.error("Error in purchasing tickets:", error);
            res.status(500).json({ success: false, message: "Error purchasing tickets" });
        }
    },

    // Update player, subgame, grouphall tickets countand price
    prepareTicketDeletionsForUpdate: async function(gameId, playerId, tickets) {
        try {
            const ticketGroups = {};
            let totalPrice = 0;
            let purchasedSlug = "realMoney";
            const bulkOps = [];
        
            // Step 1: Group tickets by ticketColorName + hallId + userType
            for (const t of tickets) {
                const ticketKey = t.ticketColorName.replace(/\s+/g, '').toLowerCase();
                const groupKey = `${ticketKey}|${t.hallId}|${t.userTicketType}`;
            
                if (!ticketGroups[groupKey]) {
                    ticketGroups[groupKey] = {
                        ticketColorName: t.ticketColorName,
                        ticketKey,
                        hallId: t.hallId,
                        userTicketType: t.userTicketType,
                        ticketColorType: t.ticketColorType,
                        ticketPrice: t.ticketPrice,
                        count: 0
                    };
                }
            
                ticketGroups[groupKey].count++;
            }
            console.log("ticketGroups---", ticketGroups)

            for (const group of Object.values(ticketGroups)) {
                const { ticketColorName, ticketKey, hallId, userTicketType, ticketColorType, ticketPrice, count } = group;
            
                let groupSize = 1;
                if (ticketColorType === 'large' || ticketColorType.startsWith('traffic-')) groupSize = 3;
                else if (ticketColorType === 'elvis') groupSize = 2;
            
                const deleteCount = groupSize === 1 ? count : Math.floor(count / groupSize);
                const remaining = groupSize === 1 ? 0 : count % groupSize;
            
                const refundAmount = (deleteCount + remaining) * ticketPrice;
                totalPrice += refundAmount;
            
                console.log("group:", ticketColorName, "groupSize:", groupSize, "deleteCount:", deleteCount, "remaining:", remaining, "refundAmount:", refundAmount, "runningTotal:", totalPrice);
            
                if (deleteCount > 0) {
                    // Only add player-specific update 
                
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: gameId, "players.id": playerId },
                            update: {
                                $inc: {
                                    [`players.$[player].purchaseTicketTypes.$[pt].totalPurchasedTickets`]: -deleteCount
                                }
                            },
                            arrayFilters: [
                                { "player.id": playerId },
                                { "pt.ticketName": ticketColorName }
                            ]
                        }
                    });
                    
            
                    // Add general updates for subGames and groupHalls
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: gameId },
                            update: {
                                $inc: {
                                    [`subGames.$[].options.$[opt].totalPurchasedTickets`]: -deleteCount,
                                    [`groupHalls.$[].halls.$[hall].userTicketType.${userTicketType}.${ticketKey}`]: -deleteCount,
                                    [`groupHalls.$[].halls.$[hall].ticketData.${ticketKey}`]: -deleteCount
                                }
                            },
                            arrayFilters: [
                                { "opt.ticketName": ticketColorName },
                                { "hall.id": hallId }
                            ]
                        }
                    });
                }
            }
            
            // Perform one bulk write at the end
            console.log("bulkOps string", JSON.stringify(bulkOps))
            if (bulkOps.length > 0) {
                await Sys.App.Services.GameService.bulkWriteGameData(bulkOps);
            }
            
            console.log("Final total refund price:", totalPrice);
        
            return { ticketPrice: +totalPrice.toFixed(2), purchasedSlug };
        } catch (error) {
            console.error("Error preparing ticket deletions:", error);
            return { ticketPrice: 0, purchasedSlug: "realMoney" }; 
        }
    
    },

}

function randomWithProbability(count, selectedElvisinAdmin) {

    let notRandomNumbersTemp = [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5];
    let notRandomNumbers = notRandomNumbersTemp.filter(function (el) {
        return selectedElvisinAdmin.includes(el);
    });
    console.log("notRandomNumbers", notRandomNumbers)
    let selected = [];
    for (let i = 0; i < count; i++) {
        let idx = Math.floor(Math.random() * notRandomNumbers.length);
        let number = notRandomNumbers[idx];
        if (selectedElvisinAdmin.length < 5) {
            notRandomNumbers.splice(idx, 1);
        }
        selected.push(number);
    }
    return selected;
}

function getOnlinePlayers(namespace, roomId) {
    return new Promise((resolve, reject) => {
        const sockets = Object.values(Sys.Io.of(namespace).in(roomId).clients().connected);
        let adminCounts = 0;
        for (let s = 0; s < sockets.length; s++) {
            let socket = sockets[s];
            if (socket.myData && socket.myData.isAdmin) {
                console.log("socket has property", socket.myData.isAdmin)
                if (socket.myData.isAdmin == true) {
                    adminCounts = adminCounts + 1;
                }
            }
        }
        if (adminCounts < 0) {
            adminCounts = 0;
        }

        Sys.Io.of(namespace).in(roomId).clients((error, clients) => {
            if (error) {
                return reject(error);
            } else {
                let finalCount = clients.length;
                if (clients.length > 1 && adminCounts > 0) {
                    finalCount = parseInt(clients.length - adminCounts)
                }
                console.log("finalCount--", adminCounts, clients.length, finalCount)
                resolve(finalCount);
            }
        });
    });
}

function getRandomArbitrary(min, max) {
    //return Math.floor(Math.random() * (max - min) + min);
    return Math.floor(fortuna.random() * (max - min) + min);
}

// Function to find ticket type based on number
function findTicketType(hall, ticketNumber) {
    for (const ticket of hall.tickets) {
        if (ticketNumber >= ticket.range[0] && ticketNumber <= ticket.range[1]) {
            return ticket;
        }
    }
    return null;
}

function convertIPv6MappedToIPv4(ip) {
    // Check if the input is an IPv6-to-IPv4 mapped address
    const isIPv6Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.test(ip);

    if (isIPv6Mapped) {
        // Extract the IPv4 portion (last 32 bits) and return it as an IPv4 address
        const ipv4Address = ip.replace(/^::ffff:/, '');
        return ipv4Address;
    }
    return ip;
}

async function getJackpotHighestPrice(data){
    try{
        const { allWinningOptions, pattern, defaultValue=0 } = data;
        let highestWinning = 0;
        if(allWinningOptions.length > 0){
            for(let i=0; i < allWinningOptions.length; i++){
                let patternListTemp = allWinningOptions[i].winning;
                let winning = patternListTemp[pattern];
                if(+winning > +highestWinning){
                    highestWinning = +winning;
                }
            }
            return highestWinning;
        }
        return defaultValue;
    }catch(e){
        return defaultValue;
    }
    
}

/**
 * Assign a given number of tickets to a player.
 * @param {ObjectId} playerId The _id of the player to assign tickets to.
 * @param {ObjectId} gameId The _id of the game the tickets belong to.
 * @param {Number} ticketQnty The number of tickets to assign.
 * @param {Number} [totalAssigned=0] The total number of tickets already assigned.
 * @param {String} [uniqueIdentifier] The unique identifier to assign to the tickets.
 * @returns {Object} An object containing a success flag and a message.
 */
async function assignTickets(playerId, gameId, ticketQnty, totalAssigned = 0, uniqueIdentifier) {
    try {
        let maxRetries = 3; // Prevent infinite loops
        let attempts = 0;

        while (totalAssigned < ticketQnty && attempts < maxRetries) {
            attempts++;

            // Step 1: Find available tickets (only fetch the remaining required amount)
            let availableTickets = await Sys.Game.Game1.Services.GameServices.getStaticByData(
                { isPurchased: false, gameId: { $ne: gameId } }, 
                { _id: 1 }, 
                { limit: ticketQnty - totalAssigned }
            );
            console.log("availableTickets----", availableTickets)
            if (availableTickets.length === 0) {
                return { success: false, message: "Not enough available tickets" };
            }

            let ticketIdArray = availableTickets.map(ticket => ticket._id);
           
            console.log(`Attempt ${attempts} - Assigned Tickets:`);

            // Step 2: Atomically update selected tickets // , isPurchased: false, gameId: { $ne: gameId }
            let updateResult = await Sys.Game.Game1.Services.GameServices.updateManyStaticData(
                { _id: { $in: ticketIdArray }, isPurchased: false, gameId: { $ne: gameId } },
                { $set: { isPurchased: true, playerIdOfPurchaser: playerId, gameId: gameId, uniqueIdentifier: uniqueIdentifier } }
            );

            totalAssigned += updateResult.modifiedCount; // 

            // Step 3: Ensure total assigned tickets match required count
            if (totalAssigned >= ticketQnty) {
                return { success: true }; 
            }

            console.warn(`Retrying... Attempt ${attempts}/${maxRetries}`);
        }

        return { success: false, message: "Ticket assignment failed after retries" };

    } catch (error) {
        console.error("Error assigning tickets:", error);
        return { success: false, message: "An error occurred" };
    }
}
// Helper function to promisify socket.leave
function leaveRoom(socket, roomId) {
    return new Promise((resolve) => {
        socket.leave(roomId, async function () {
            console.log("Left room:", roomId);
            resolve();
        });
    });
}

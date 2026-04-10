/**
 * Game1 Helper Functions
 * Contains reusable helper functions specific to Game1 operations
 */

const Sys = require('../Boot/Sys');
const moment = require('moment');
const { translate } = require('../Config/i18n');
const Timeout = require('smart-timeout');
const { updatePlayerHallSpendingData } = require('./all');

/**
 * Check if player is verified or approved to play games
 * @param {Object} player - The player object
 * @returns {boolean} - Whether the player is verified
 */
function isPlayerVerified(player) {
    const isVerifiedByBankID = player.bankIdAuth && 
                               Object.keys(player.bankIdAuth).length > 0 && 
                               player.bankIdAuth.status === "COMPLETED";
    const isVerifiedByHall = player.isVerifiedByHall;
    return player.isAlreadyApproved || isVerifiedByBankID || isVerifiedByHall;
}

/**
 * Check if hall is valid
 * @param {Object} hall - The hall object
 * @returns {boolean} - Whether the hall is valid
 */
function isValidHall(hall) {
    return hall && 
           hall.hasOwnProperty('id') && 
           hall.id !== "" && 
           hall.status === "Approved";
}

/**
 * Build query to get games for a hall
 * @param {string} hallId - The hall ID
 * @returns {Object} - The MongoDB query object
 */
function findActiveRunningGameQuery(hallId) {
    return {
        gameType: "game_1",
        halls: { $in: [hallId] },
        $or: [
            { status: { $ne: "finish" } },
            { 'otherData.gameSecondaryStatus': "running" }
        ],
        stopGame: false,
        'otherData.isClosed': false,
        startDate: {
            $gte: moment().startOf('day').toDate(),
            $lt: moment().startOf('day').add(2, 'day').toDate()
        }
    };
}

/**
 * Process games to extract running and upcoming game information
 * @param {Array} games - The list of games
 * @param {string} playerId - The player ID
 * @returns {Object} - Object containing runningGame and upcomingGame
 */
function processRunningUpcomingGames(games, playerId) {
    // Sort games by status priority
    let status = { 'running': 1, 'active': 2, 'completed': 3, 'finish': 4 };
    games.sort((a, b) => status[a.status] - status[b.status]);
    
    let runningGame = {};
    let upcomingGame = {};
    
    // Process running game
    const runningIndex = games.findIndex(x => 
        (x.status === 'running' || x.otherData?.gameSecondaryStatus === "running")
    );
    
    if (runningIndex >= 0) {
        runningGame = formatRunningGame(games[runningIndex], playerId);
    }
    
    // Process upcoming game
    const upcomingIndex = games.findIndex(x => x.status === 'active');
    if (upcomingIndex >= 0) {
        upcomingGame = formatUpcomingGame(games[upcomingIndex], playerId);
    }
    
    return { runningGame, upcomingGame };
}

/**
 * Format running game data
 * @param {Object} game - The running game object
 * @param {string} playerId - The player ID
 * @returns {Object} - Formatted running game data
 */
function formatRunningGame(game, playerId) {
    let gameType = "color";
    let replaceAmount = 0;
    
    if (game.gameName === "Elvis") {
        gameType = "elvis";
        replaceAmount = game.otherData?.replaceTicketPrice || 0;
    } else if (game.gameName === "Traffic Light") {
        gameType = "traffic-light";
    }
    
    // Find player's purchased tickets
    const playerIndex = game.players?.findIndex(x => x.id == playerId);
    const purchasedTicket = playerIndex >= 0 ? game.players[playerIndex].totalPurchasedTickets : 0;
    
    return {
        gameId: game._id,
        gameName: game.gameName,
        status: game.status,
        purchasedTickets: purchasedTicket,
        maxPurchaseTicket: 30,
        gameType: gameType,
        replaceAmount: replaceAmount,
        isTestGame: game?.otherData?.isTestGame ?? false
    };
}

/**
 * Format upcoming game data
 * @param {Object} game - The upcoming game object
 * @param {string} playerId - The player ID
 * @returns {Object} - Formatted upcoming game data
 */
function formatUpcomingGame(game, playerId) {
    // Skip games scheduled too far in advance
    if (moment(game.startDate).subtract(24, 'h').isAfter(moment())) {
        return {};
    }
    
    const ticketTypes = getTicketTypes(game);
    
    // Find player's purchased tickets
    const playerIndex = game.players?.findIndex(x => x.id == playerId);
    const purchasedTicket = playerIndex >= 0 ? game.players[playerIndex].totalPurchasedTickets : 0;
    
    return {
        gameId: game._id,
        gameName: game.gameName,
        status: game.status,
        ticketTypes: ticketTypes.types,
        purchasedTickets: purchasedTicket,
        maxPurchaseTicket: 30,
        gameType: ticketTypes.gameType,
        isTestGame: game?.otherData?.isTestGame ?? false
    };
}

/**
 * Get ticket types for a game
 * @param {Object} game - The game object
 * @returns {Object} - Object containing ticket types and game type
 */
function getTicketTypes(game) {
    let gameType = "color";
    let types = [];
    
    if (game.gameName === "Elvis") {
        gameType = "elvis";
        if (game.subGames?.[0]?.options?.[0]?.ticketPrice) {
            types.push({ 
                name: "Elvis", 
                price: game.subGames[0].options[0].ticketPrice 
            });
        }
    } else if (game.gameName === "Traffic Light") {
        gameType = "traffic-light";
        if (game.subGames?.[0]?.options?.[0]?.ticketPrice) {
            types.push({ 
                name: "Traffic Light", 
                price: game.subGames[0].options[0].ticketPrice 
            });
        }
    } else if (gameType === "color" && game.subGames?.[0]?.options?.length > 0) {
        // Add all ticket types for color games
        for (const option of game.subGames[0].options) {
            types.push({ 
                name: option.ticketName, 
                price: option.ticketPrice 
            });
        }
    }
    
    return { types, gameType };
}

/**
 * Create a standardized error response
 * @param {string} messageKey - The translation key for the error message
 * @param {string} language - The language code
 * @returns {Object} - The error response object
 */
async function createErrorResponse(messageKey, language, statusCode = 400) {
    return {
        status: 'fail',
        result: null,
        message: await translate({ key: messageKey, language }),
        statusCode: statusCode
    };
}

/**    
     * SubscribeRoom  Function
     * Helper to determine if we should redirect to next game 
     * @param {Object} room - The room object
     * @returns {boolean} - Whether to redirect to next game
     */
function shouldRedirectToNextGame(room) {
    return room?.otherData?.gameSecondaryStatus === "finish"
    // For regular games
    // if (room.gameName !== "Mystery" && room.gameName !== "Color Draft" && 
    //     room.gameName !== "Wheel of Fortune" && room.gameName !== "Treasure Chest") {
    //     return room.status === "finish";
    // }
    
    // // For Mystery games
    // if (room.gameName === "Mystery") {
    //     return room.status === "finish" && room.otherData.mysteryTurnCounts > 4;
    // }
    
    // // For Color Draft, Wheel of Fortune, Treasure Chest
    // return room.status === "finish" && room.otherData.isMinigameFinished === true;
}

/**
 * Process the pattern list data from a room
 * @param {Array} patternList - The list of patterns
 * @param {Array} winners - The winners array from the room
 * @returns {Array} - Processed pattern list with win status
 */
function processPatternList(patternList, winners) {
    const winningCombinations = [...new Set(winners.map(item => item.lineType))];
    return patternList.map(pattern => ({
        ...pattern,
        isWon: winningCombinations.includes(pattern.name)
    }));
}

/**
 * Format purchased tickets into a standardized format
 * @param {Array} purchasedTickets - Raw purchased tickets data
 * @returns {Array} - Formatted ticket data
 */
function formatPurchasedTickets(purchasedTickets) {
    return purchasedTickets.map(ticket => {
        let ticketColor = ticket.ticketColorName;
        if (ticket.ticketColorType === "elvis") {
            ticketColor = ticket.ticketColorName.slice(6);
        }
        
        // Extract cell numbers from the ticket
        const ticketCellNumberList = [];
        for (let t = 0; t < ticket.tickets.length; t++) {
            for (let n = 0; n < ticket.tickets[t].length; n++) {
                ticketCellNumberList.push(ticket.tickets[t][n].Number);
            }
        }
        
        return {
            id: ticket.id,
            ticketNumber: ticket.ticketId,
            ticketPrice: ticket.ticketPrice,
            ticketCellNumberList: ticketCellNumberList,
            hallName: ticket.hallName,
            ticketCompleted: ticket.ticketCompleted,
            ticketColor: ticketColor,
            ticketCompleted: ticket.isTicketSubmitted,
            supplierName: ticket.supplier,
            developerName: ticket.developer,
        };
    });
}

/**
 * Get minigame data for special game types
 * @param {Object} room - The room object
 * @param {string} language - The language code
 * @returns {Promise<Object>} - Minigame data
 */
async function getMinigameData(room, language) {
    try {
        let minigameData = { playerId: "" };
        if (room.status === "finish" && (room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest" || room.gameName == "Color Draft")){
            let prizeList = [];
            let currentTurnCountTimer = 10;
            let wofStopTurnCountTimer = 10;
            // Get prize list based on game type
            if (room.gameName === "Wheel of Fortune") {
                const wheelOfFortuneList = await Sys.App.Services.otherGameServices.getByData({ slug: 'wheelOfFortune' });
                prizeList = wheelOfFortuneList.wheelOfFortuneprizeList;
            } else if(room.gameName === "Treasure Chest") {
                const treasureChestList = await Sys.App.Services.otherGameServices.getByData({ slug: 'treasureChest' });
                prizeList = treasureChestList.treasureChestprizeList;
            } else if(room.gameName === "Color Draft") {
                prizeList = room?.otherData?.miniGameResults ?? [];
            }
            
            // Check remaining time if timer exists
            if (Timeout.exists(room._id.toString())) {
                const currentTurnCountTimerTemp = Timeout.remaining(room._id.toString());
                if (currentTurnCountTimerTemp) {
                    currentTurnCountTimer = Math.ceil(currentTurnCountTimerTemp / 1000);
                }
                console.log("timeout remianing of minigames", currentTurnCountTimer)
            }

            //for treasure, color and mystery game: dont show timer if won by only physical player
            const isSpinByAdmin = room?.otherData?.isSpinByAdmin;

            let wonAmount = 0;
            if(room.gameName === "Color Draft" && room?.otherData?.isMinigameFinished === true){
                const history = room?.otherData?.miniGameHistory || [];
                if (history.length === 2 && history[0].color === history[1].color) {
                    wonAmount = +history[0].amount || 0;
                } else if (history.length === 3) {
                    const colors = history.map(h => h.color);
                    const amounts = history.map(h => +h.amount || 0);
                    // Check if all colors are unique
                    const allUnique = new Set(colors).size === colors.length;
                    if (allUnique) {
                        wonAmount = amounts.reduce((sum, amt) => sum + amt, 0);
                    } else {
                        wonAmount = amounts.slice(0, 2).reduce((sum, amt) => sum + amt, 0);
                    }
                }
            }else if(room.gameName == "Wheel of Fortune" || room.gameName == "Treasure Chest"){
                wonAmount = +room?.otherData?.miniGameResults?.[0]?.winningAmount || 0;
                // Check remaining time if timer exists for wof to stop
                if(room.gameName == "Wheel of Fortune"){
                    const wof_spin_timeout = `${room._id.toString()}_wof_spin_wheel`
                    if (Timeout.exists(wof_spin_timeout)) {
                        const currentTurnCountTimerTemp = Timeout.remaining(wof_spin_timeout);
                        if (currentTurnCountTimerTemp) {
                            wofStopTurnCountTimer = Math.ceil(currentTurnCountTimerTemp / 1000);
                        }
                        console.log("timeout remianing of wof stop minigames", wofStopTurnCountTimer)
                    }
                }
            }
            
            // Build minigame data
            minigameData = {
                gameName: room.gameName,
                isDisplayWheel: (room.gameName === "Wheel of Fortune") ? true: false,
                isMinigameActivated: room?.otherData?.isMinigameActivated,
                isMinigamePlayed: room?.otherData?.isMinigamePlayed,
                isMinigameFinished: room?.otherData?.isMinigameFinished,
                wonAmount: wonAmount, //(room?.otherData?.miniGameResults && room?.otherData?.miniGameResults?.length > 0) ? room?.otherData?.miniGameResults[0]?.winningAmount : 0,
                prizeList: prizeList,
                turnTimer: isSpinByAdmin ? 0 : (room?.otherData?.isMinigamePlayed == true ? 0 : parseInt(currentTurnCountTimer)),
                isWofSpinStopped: room?.otherData?.isWofSpinStopped ?? false,
                playerId: "",
                showAutoTurnCount: isSpinByAdmin ? false : true,
                history: room?.otherData?.miniGameHistory,
                remainingStopTimer: room?.otherData?.isMinigamePlayed == true ? 0: wofStopTurnCountTimer //  this is for wof game
            };
        }
        
        // Set the player ID for spinner if applicable
        if (room.status === "finish" && room.otherData.isMinigameActivated === true && room.winners.length > 0) {
            const spinnerIndex = room.winners.findIndex(winner => winner.enabledSpinner === true);
            if (spinnerIndex >= 0) {
                minigameData.playerId = room.winners[spinnerIndex].playerId;
            }
        }
        
        return minigameData;
    } catch (error) {
        console.error("Error in getMinigameData:", error);
        return { playerId: "", error: error.message };
    }
}

/**
 * Create a standardized subscribe room response object
 * @param {Object} room - The room object
 * @param {Object} player - The player object
 * @param {Array} finalPatternList - The processed pattern list
 * @param {Array} ticketsArr - Formatted tickets array
 * @param {number} onlinePlayers - Count of online players
 * @param {Object} jackPotData - Jackpot data
 * @param {Object} minigameData - Minigame data
 * @param {string} language - Player's language
 * @returns {Promise<Object>} - The formatted response
 */
async function createSubscribeRoomResponse(room, player, finalPatternList, ticketsArr, onlinePlayers, jackPotData, minigameData, language) {
    // Determine if lucky number can be edited
    const editLuckyFlag = (room.status === 'active');
    
    // Find player's lucky number
    const playerData = room.players.find(item => item.id.toString() === player._id.toString());
    const luckyNumber = playerData ? playerData.luckyNumber : "";
    
    // Calculate player's total winnings
    let totalWon = 0;
    if (room.adminWinners && room.adminWinners.length > 0) {
        totalWon = room.adminWinners
            .filter(winner => winner.playerId.toString() === player._id.toString())
            .reduce((sum, winner) => sum + winner.wonAmount, 0);
    }
    
    // Calculate player's total bet amount
    let playerTotalBetAmount = 0;
    if (room.players && room.players.length > 0) {
        const playerIndex = room.players.findIndex(x => x.id.toString() === player._id.toString());
        if (playerIndex >= 0) {
            playerTotalBetAmount = room.players[playerIndex].ticketPrice || 0;
        }
    }
    
    // Create and return the response object
    return {
        activePlayers: onlinePlayers,
        editLuckyNumber: editLuckyFlag,
        luckyNumber: luckyNumber,
        maxWithdrawCount: 75,
        patternList: finalPatternList,
        totalWithdrawCount: room.withdrawNumberList.length,
        withdrawNumberList: room.withdrawNumberList,
        ticketList: ticketsArr,
        gameId: room._id.toString(),
        replaceAmount: (room.gameName === "Elvis") ? (room.otherData?.replaceTicketPrice || 0) : 0,
        gameStatus: (room.status === "finish") ? "Finished" : room.status,
        gameName: (room.gameName === "Mystery") ? "Mystery" : room.gameName,
        gameCount: room.sequence,
        disableBuyAfterBalls: 3,
        totalBetAmount: playerTotalBetAmount,
        isReplaceDisabled: room.isNotificationSent,
        totalWon: +totalWon,
        jackPotData: jackPotData,
        minigameData: minigameData,
        isGamePaused: (room.otherData?.isPaused === true),
        pauseGameMessage: await translate({ key: "pause_message", language }),
        countDownDateTime: room.countDownDateTime,
        isTestGame: room?.otherData?.isTestGame ?? false
    };
}

/**
   * Creates a transaction for ticket cancellation.
   * @param {Object} params - Transaction parameters.
   * @returns {Promise<void>}
   */
async function createCancelTransaction({
    playerId,
    gameId,
    ticketPrice,
    purchasedSlug,
  }) {
    console.log("🚀 ~ createCancelTransaction:***********", playerId, gameId, ticketPrice, purchasedSlug);
    try {
      const transaction = {
        playerId,
        gameId,
        transactionSlug: 'extraTransaction',
        typeOfTransaction: 'Cancel Ticket',
        action: 'credit',
        purchasedSlug,
        totalAmount: ticketPrice,
        game1Slug: 'cancelTicket',
      };
      await Sys.Helper.gameHelper.createTransactionPlayer(transaction);

      if (purchasedSlug === 'points') {
        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
          { _id: playerId },
          { $inc: { points: ticketPrice } }
        );
      } else if (purchasedSlug === 'realMoney') {
        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
          { _id: playerId },
          {
            $inc: { walletAmount: ticketPrice, monthlyWalletAmountLimit: ticketPrice },
          }
        );
      }
    } catch (e) {
      console.error('Error in createCancelTransaction:', e);
      throw new Error(e);
    }
}

async function createRefundTransaction({
    playerId,
    gameId,
    ticketPrice,
    purchasedSlug,
  }) {
    console.log("🚀 ~ createRefundTransaction:***********", playerId, gameId, ticketPrice, purchasedSlug);
    try {
      const transaction = {
        playerId,
        gameId,
        transactionSlug: 'extraTransaction',
        typeOfTransaction: 'Refund',
        action: 'credit',
        purchasedSlug,
        totalAmount: ticketPrice,
        game1Slug: 'refund',
      };
      await Sys.Helper.gameHelper.createTransactionPlayer(transaction);

      if (purchasedSlug === 'points') {
        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
          { _id: playerId },
          { $inc: { points: ticketPrice } }
        );
      } else if (purchasedSlug === 'realMoney') {
        await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
          { _id: playerId },
          {
            $inc: { walletAmount: ticketPrice, monthlyWalletAmountLimit: ticketPrice },
          }
        );
      }
    } catch (e) {
      console.error('Error in createRefundTransaction:', e);
      throw new Error(e);
    }
}

/**
   * Creates a notification for ticket cancellation.
   * @param {Object} params - Notification parameters.
   * @returns {Promise<void>}
   */
async function createCancelNotification({
    playerId,
    gameId,
    gameNumber,
    gameName,
    ticketQty,
    ticketPrice,
    startDate,
    language,
  }) {
    try {
      const TimeMessage = {
        en: await translate({
          key: 'game1_ticket_cancel_notification',
          language: 'en',
          isDynamic: true,
          number: gameNumber,
          number1: gameName,
        }),
        nor: await translate({
          key: 'game1_ticket_cancel_notification',
          language: 'nor',
          isDynamic: true,
          number: gameNumber,
          number1: gameName,
        }),
      };

      const ticketMessage = {
        en: await translate({
          key: 'game1_ticket_cancel_message',
          language: 'en',
          isDynamic: true,
          number: ticketQty,
          number1: gameName,
        }),
        nor: await translate({
          key: 'game1_ticket_cancel_message',
          language: 'nor',
          isDynamic: true,
          number: ticketQty,
          number1: gameName,
        }),
      };

      const notification = {
        notificationType: 'cancelTickets',
        message: TimeMessage,
        ticketMessage,
        price: ticketPrice,
        date: startDate,
      };

      await Sys.Game.Common.Services.NotificationServices.create({
        playerId,
        gameId,
        notification,
      });
    } catch (e) {
      console.error('Error in createCancelNotification:', e);
      throw new Error(e);
    }
  }

  async function createRefundNotification({
    playerId,
    gameId,
    gameNumber,
    gameName,
    ticketQty,
    ticketPrice,
    startDate,
    language,
  }) {
    try {
      const TimeMessage = {
        en: await translate({
          key: 'refund_tickets',
          language: 'en',
          isDynamic: true,
          number: gameNumber,
          number1: gameName,
        }),
        nor: await translate({
          key: 'refund_tickets',
          language: 'nor',
          isDynamic: true,
          number: gameNumber,
          number1: gameName,
        }),
      };

      const ticketMessage = {
        en: await translate({
          key: 'refund_tickets',
          language: 'en',
          isDynamic: true,
          number: ticketQty,
          number1: gameName,
        }),
        nor: await translate({
          key: 'refund_tickets',
          language: 'nor',
          isDynamic: true,
          number: ticketQty,
          number1: gameName,
        }),
      };

      const notification = {
        notificationType: 'refundTickets',
        message: TimeMessage,
        ticketMessage,
        price: ticketPrice,
        date: startDate,
      };

      await Sys.Game.Common.Services.NotificationServices.create({
        playerId,
        gameId,
        notification,
      });
    } catch (e) {
      console.error('Error in createRefundNotification:', e);
      throw new Error(e);
    }
  }

  /**
   * Emits socket events for specific games.
   * @param {Object} gameData - Game data.
   * @returns {Promise<void>}
   */
  async function emitSalesGameEvents(gameData) {
    try {
      if (
        [
          'Spillerness Spill',
          'Spillerness Spill 2',
          'Spillerness Spill 3',
          'Innsatsen',
        ].includes(gameData.gameName)
      ) {
        Sys.Io.of(Sys.Config.Namespace.Game1)
          .to(gameData._id)
          .emit('adminRefreshRoom', {});
        const {patternList, jackPotData} = await Sys.Game.Game1.Controllers.GameProcess.patternListing(
          gameData._id
        );
        
        Sys.Io.of(Sys.Config.Namespace.Game1)
          .to(gameData._id)
          .emit('PatternChange', { patternList, jackPotData });
      }
    } catch (e) {
      console.error('Error in emitGameEvents:', e);
      throw new Error(e);
    }
}

// Helper function to deduct player balance
async function deductPlayerBalance(player, amount, purchaseType) {
    try {
        if (purchaseType === 'points') {
            if (player.points < amount) {
                return { success: false, errorKey: "Insufficient_balance" };
            }
            
            const deductResult = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: player._id }, 
                { $inc: { points: -amount } }
            );
            
            if (deductResult.points < 0) {
                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: player._id }, 
                    { $inc: { points: amount } }
                );
                return { success: false, errorKey: "Insufficient_balance" };
            }
        } else if (purchaseType === 'realMoney') {
            if (player.walletAmount < amount) {
                return { success: false, errorKey: "Insufficient_balance" };
            }
            
            const deductResult = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: player._id }, 
                { $inc: { walletAmount: -amount } }
            );
            
            if (deductResult.walletAmount < 0) {
                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: player._id }, 
                    { $inc: { walletAmount: amount } }
                );
                return { success: false, errorKey: "Insufficient_balance" };
            }
        } else if (purchaseType === 'voucher') {
            return { success: false, errorKey: "voucher_not_applied_for_game" };
        }
        
        return { success: true };
    } catch (error) {
        console.error("Error in deductPlayerBalance:", error);
        return { success: false, errorKey: "something_went_wrong" };
    }
}

// Helper function to get replacement tickets
async function getReplacementTickets(playerId, gameId, quantity) {
    try {
        const ticketTemp = await Sys.Game.Game1.Services.GameServices.getStaticByData(
            { 
                isPurchased: false, 
                gameId: { $ne: gameId } 
            }, 
            { isPurchased: 1, tickets: 1, ticketId: 1 }, 
            { limit: (parseInt(quantity) + 100) }
        );
        
        if (!ticketTemp || ticketTemp.length < quantity) {
            return { success: false };
        }

        // Get new tickets and mark them as purchased
        const finalDataTicketTemp = [];
        for (let i = 0; i < ticketTemp.length && finalDataTicketTemp.length < quantity; i++) {
            const updatedTicket = await Sys.Game.Game1.Services.GameServices.updateStaticGameCustom(
                { _id: ticketTemp[i]._id, isPurchased: false }, 
                { isPurchased: true, playerIdOfPurchaser: playerId, gameId: gameId }
            );
            
            if (updatedTicket) {
                finalDataTicketTemp.push(ticketTemp[i]);
            }
        }

        if (finalDataTicketTemp.length < quantity) {
            return { success: false };
        }

        return { success: true, tickets: finalDataTicketTemp };
    } catch (error) {
        console.error("Error in getReplacementTickets:", error);
        return { success: false };
    }
}
          
// Helper function to refund player balance
async function refundPlayerBalance(playerId, amount, purchaseType) {
    try {
        if (purchaseType === 'points') {
            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: playerId }, 
                { $inc: { points: amount } }
            );
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "cancel",
                playerId: playerId,
                hallId: '',
                cancel: amount
            });
            await updatePlayerHallSpendingData({ playerId: playerId, hallId: '', amount: +amount, type: 'normal', gameStatus: 2 });
        } else if (purchaseType === 'realMoney') {
            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: playerId }, 
                { $inc: { walletAmount: amount } }
            );
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "cancel",
                playerId: playerId,
                hallId: '',
                cancel: amount
            });
            await updatePlayerHallSpendingData({ playerId: playerId, hallId: '', amount: +amount, type: 'normal', gameStatus: 2 });
        }
        return { success: true };
    } catch (error) {
        console.error("Error in refundPlayerBalance:", error);
        return { success: false, errorKey: "something_went_wrong" };
    }
}

// Helper function to get jackpot prize
async function getAllJackpotPrizes({ jackpotPrize, ticketColorTypes }) {
    try {
        const colors = [...new Set(ticketColorTypes.map(t => t.split(' ').pop().toLowerCase()))];
        return Object.entries(jackpotPrize)
            .filter(([color]) => colors.includes(color.toLowerCase()))
            .map(([, prize]) => +prize);
    } catch (error) {
        console.error("Error in getAllJackpotPrizes:", error);
        return [];
    }
}

/**
 * Get the next game in a sequence for a given parent game.
 *
 * This function looks up the next game using the `parentGameId` and a `sequence` number.
 * It only returns **one game** whose sequence is greater than the given one.
 * 
 * @param {Object} params - The input parameters.
 * @param {string} params.parentGameId - The parent game ID to filter games.
 * @param {number} params.sequence - The current sequence number.
 * @returns {Promise<Object|null>} - Returns the next game object if found, otherwise null.
 */
async function getNextGame({ parentGameId, sequence, day = moment().format('ddd') }) {
    try {
        // Find the next game with sequence greater than the given one
        const nextGame = await Sys.Game.Game1.Services.GameServices.getSingleByData(
            {
                parentGameId: parentGameId,
                status: "active",
                stopGame: false,
                sequence: { $gt: sequence }, // Only games with sequence greater than current
                day: day
            },
            {
                gameName: 1, sequence: 1, _id: 0, 'otherData.customGameName': 1  
            },
            {
                sort: { sequence: 1 } // Get the nearest next game
            }
        );
        const result = nextGame ? nextGame : { gameName: "", sequence: "", 'otherData.customGameName': "" };
        console.log("nextGame---", parentGameId, sequence, day, nextGame);
        return result;
    } catch (error) {
        console.error("Error in getting next game:", error);
        return { gameName: "", sequence: "" };
    }
}


// Export all helper functions
module.exports = {
    isPlayerVerified,
    isValidHall,
    findActiveRunningGameQuery,
    processRunningUpcomingGames,
    formatRunningGame,
    formatUpcomingGame,
    getTicketTypes,
    createErrorResponse,
    shouldRedirectToNextGame,
    processPatternList,
    formatPurchasedTickets,
    getMinigameData,
    createSubscribeRoomResponse,
    createCancelTransaction,
    createRefundTransaction,
    createCancelNotification,
    createRefundNotification,
    emitSalesGameEvents,
    deductPlayerBalance,
    getReplacementTickets,
    refundPlayerBalance,
    getAllJackpotPrizes,
    getNextGame
}; 
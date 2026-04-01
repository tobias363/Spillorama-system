/**
 * Game Helper Functions
 * Contains reusable helper functions for all game operations
 * 
 * Available Helper Functions:
 * - isPlayerVerified: Checks if a player is verified or approved to play games
 * - isValidHall: Checks if a hall is valid for gameplay
 * - createErrorResponse: Creates a standardized error response with translations
 * - createSuccessResponse: Creates a standardized success response with translations
 * - createCancelTransaction: Creates a transaction for ticket cancellation
 * - createCancelNotification: Creates a notification for ticket cancellation
 * - deductPlayerBalance: Deducts balance from player account based on purchase type
 * - refundPlayerBalance: Refunds balance to player account based on purchase type
 * - isGameAvailableForVerifiedPlayer: Checks if a game is available for a verified player
 * - checkPlayerBreakStatus: Checks if a player is currently on break
 * - formatDateTime: Formats date for game IDs
 * - generateRandomTicket: Generates a random ticket of 9 number from 1 to 37
 * Usage:
 * const gameHelper = require('../gamehelper/all.js');
 * const isVerified = gameHelper.isPlayerVerified(player);
 * const errorResponse = await gameHelper.createErrorResponse('error_key', 'en');
 * const breakStatus = gameHelper.checkPlayerBreakStatus(player);
 */

const Sys = require('../Boot/Sys');
const moment = require('moment');
const { translate } = require('../Config/i18n');
const RedisHelper = require('./redis');
const redis = require('../Config/Redis');
// const { getOnlinePlayers, compareTimeSlots } = require('./game2');
const Timeout = require('smart-timeout');
const fortuna = require('javascript-fortuna');
fortuna.init();
const { isPlayerBlockedFromGame } = require('./player_common');
const mongoSanitize = require('mongo-sanitize');
const xss = require('xss');
const path = require('path');
const fs = require('fs').promises;
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
 * Create a standardized error response
 * @param {string} messageKey - The translation key for the error message
 * @param {string} language - The language code
 * @returns {Object} - The error response object
 */
async function createErrorResponse(messageKey, language, statusCode = 400, needsTranslation = true, messageType = null, result = null, isDynamic = false, numbers = null) {
    const translationOptions = {
        key: messageKey,
        language,
    };
    // Include isDynamic and numbers if isDynamic is true
    if (isDynamic && numbers && Object.keys(numbers).length > 0) {
        translationOptions.isDynamic = true;
        for (const [key, value] of Object.entries(numbers)) {
            translationOptions[key] = value;
        }
    }
    const response = {
        status: 'fail',
        result: result || null,
        message: needsTranslation ? await translate(translationOptions) : messageKey,
        statusCode: statusCode,
    };
    
    if (messageType !== null) {
        response.messageType = await translate({ key: messageType, language });
    }
    
    return response;
}

/**
 * Creates a standardized success response
 * @param {any} result - The result data to include in the response
 * @param {string} message - The message or translation key for the success message
 * @param {string} language - The language code
 * @param {boolean} [needsTranslation=false] - Whether the message needs translation
 * @returns {Object} - The success response object
 */
async function createSuccessResponse(result, message, language, needsTranslation = false, isDynamic = false, numbers = null) {
    const translationOptions = {
        key: message,
        language,
    };
    // Only include isDynamic and numbers if isDynamic is true
    if (isDynamic && numbers && Object.keys(numbers).length > 0) {
        translationOptions.isDynamic = true;
        // Spread each key-value pair from `numbers` into `translationOptions`
        for (const [key, value] of Object.entries(numbers)) {
            translationOptions[key] = value;
        }
    }
    return {
        status: 'success',
        result: result,
        message: needsTranslation ? await translate(translationOptions) : message,
        statusCode: 200
    };
}

function compareTimeSlots(timeSlot1, timeSlot2, operation) {
    const [hours1, minutes1] = timeSlot1.split(':').map(Number);
    const [hours2, minutes2] = timeSlot2.split(':').map(Number);
    
    const time1 = hours1 * 60 + minutes1;
    const time2 = hours2 * 60 + minutes2;
    
    switch (operation) {
        case 'lt': return time1 < time2;
        case 'lte': return time1 <= time2;
        case 'gt': return time1 > time2;
        case 'gte': return time1 >= time2;
        default: return time1 < time2;
    }
};

async function getOnlinePlayers(namespace, roomId) {
    return new Promise((resolve, reject) => {
        Sys.Io.of(namespace).in(roomId).clients((error, clients) => {
            if (error)
                return reject(error);
            resolve(clients.length);
        });
    });
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


// Helper function to deduct player balance
async function deductPlayerBalance(player, amount, purchaseType) {
    try {
        if (purchaseType === 'points') {
            if (player.points < amount) {
                return { success: false, errorKey: "Insufficient_balance" };
            }
            let deductPlayerSpending = await checkPlayerSpending({ playerId: player._id, hallId: player.hall.id, amount: +amount });
            if(!deductPlayerSpending.isValid){
                return { success: false, errorKey: deductPlayerSpending.error };
            }
            
            const deductResult = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: player._id }, 
                { $inc: { points: -amount } }
            );
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "purchase",
                playerId: player._id,
                hallId: player.hall.id,
                purchase: amount
            });
            await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +amount, type: deductPlayerSpending.type, gameStatus: 1 });
            if (deductResult.points < 0) {
                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: player._id }, 
                    { $inc: { points: amount } }
                );
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "cancel",
                    playerId: player._id,
                    hallId: player.hall.id,
                    cancel: amount
                });
                await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +amount, type: deductPlayerSpending.type, gameStatus: 2 });
                return { success: false, errorKey: "Insufficient_balance" };
            }
            
            return { success: true, deductResult };
        } else if (purchaseType === 'realMoney') {
            if (player.walletAmount < amount) {
                return { success: false, errorKey: "Insufficient_balance" };
            }
            let deductPlayerSpending = await checkPlayerSpending({ playerId: player._id, hallId: player.hall.id, amount: +amount });
            if(!deductPlayerSpending.isValid){
                return { success: false, errorKey: deductPlayerSpending.error };
            }
            const deductResult = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: player._id }, 
                { $inc: { walletAmount: -amount } }
            );
            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                type: "purchase",
                playerId: player._id,
                hallId: player.hall.id,
                purchase: amount
            });
            await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +amount, type: deductPlayerSpending.type, gameStatus: 1 });
            if (deductResult.walletAmount < 0) {
                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: player._id }, 
                    { $inc: { walletAmount: amount } }
                );
                Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                    type: "cancel",
                    playerId: player._id,
                    hallId: player.hall.id,
                    cancel: amount
                });
                await updatePlayerHallSpendingData({ playerId: player._id, hallId: player.hall.id, amount: +amount, type: "normal", gameStatus: 2 }); //deductPlayerSpending.type
                return { success: false, errorKey: "Insufficient_balance" };
            }
            
            return { success: true, deductResult };
        } else if (purchaseType === 'voucher') {
            return { success: false, errorKey: "voucher_not_applied_for_game" };
        }
        
        return { success: true };
    } catch (error) {
        console.error("Error in deductPlayerBalance:", error);
        return { success: false, errorKey: "something_went_wrong" };
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
        } else if (purchaseType === 'realMoney') {
            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                { _id: playerId }, 
                { $inc: { walletAmount: amount } }
            );
        }
        return { success: true };
    } catch (error) {
        console.error("Error in refundPlayerBalance:", error);
        return { success: false, errorKey: "something_went_wrong" };
    }
}

/**
 * Checks if a player is on break
 * @param {Object} player - The player object with break time information
 * @returns {Object} - Object containing break status information
 */
function checkPlayerBreakStatus(player) {
    const currentTime = moment();
    let isBreak = false;
    
    // Check if player has break time set and is currently in break period
    const hasBreakTime = player.startBreakTime && player.endBreakTime;
    const isInBreakPeriod = hasBreakTime && 
                           currentTime >= player.startBreakTime && 
                           currentTime <= player.endBreakTime;
    
    if (isInBreakPeriod) {
        isBreak = true;
    }
    
    return {
        isBreak,
        startBreakTime: player.startBreakTime,
        endBreakTime: player.endBreakTime,
        hasBreakTime,
        isInBreakPeriod
    };
}

/**
 * Checks if a game is available for a verified player
 * This is an optimized, non-blocking function that can handle concurrent requests
 * @param {Object} params - Parameters for checking game availability
 * @param {string} params.playerId - The ID of the player to check
 * @param {string} params.language - The language code (defaults to 'nor')
 * @param {Object} params.PlayerServices - The Player service specific to the game
 * @param {Object} params.GameServices - The Game service specific to the game
 * @param {string} params.gameType - The type of game (e.g., 'game_5')
 * @returns {Promise<Object>} - The result of the availability check
 */
async function isGameAvailableForVerifiedPlayer({
    playerId,
    language = 'nor',
    PlayerServices,
    GameServices,
    gameType,
    socket
}) {
    try {
        // Fetch player data with required fields
        const player = await PlayerServices.getSingleData(
            { _id: playerId },
            {
                selectedLanguage: 1,
                bankIdAuth: 1,
                isVerifiedByHall: 1,
                isAlreadyApproved: 1,
                startBreakTime: 1,
                endBreakTime: 1,
                socketId: 1,
                hall: 1,
                blockRules: 1
            }
        ) || {};

        const playerLanguage = player.selectedLanguage || language;

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
            return await createErrorResponse("player_blocked_game", playerLanguage, 400);
        }

        // Check if player is verified using the helper function
        if (!isPlayerVerified(player)) {
            return await createErrorResponse("verify_to_play_game", playerLanguage);
        }

        // Check if player is on break using the helper function
        const breakStatus = checkPlayerBreakStatus(player);
        let isBreak = breakStatus.isBreak;
        
        // If player is in break period, check if they are in a running game
        if (isBreak) {
            let runningGame = null;
        
            if (gameType !== "game_4") {
                // Check if player is already in a running game
                runningGame = await GameServices.getSingleSubgameData(
                    {
                        status: "Running",
                        "player.id": playerId,
                        gameType
                    },
                    { _id: 1 }
                );
            } else {
                // game_4 specific break handling
                runningGame = await Sys.Game.Common.Services.GameServices.getSingleSubGameData(
                    {
                        status: "finish",
                        "otherData.playerId": playerId,
                        "otherData.isBallWithdrawn": false
                    }
                );
            }
        
            // If a valid game exists, allow play during break
            if (runningGame) {
                isBreak = false;
            }
        }
        
        const breakData = {
            isBreak,
            startBreakTime: player.startBreakTime,
            endBreakTime: player.endBreakTime
        };
        
        // Emit break time notification if player has a socket and break time
        if (player.socketId && player.startBreakTime) {
            Sys.Io.to(player.socketId).emit('breakTimeStart', breakData);
        }
        
        // Return success response
        return await createSuccessResponse(breakData, 'Game is avaibale for verified player!', playerLanguage, false);
    } catch (error) {
        console.error(`Error in isGameAvailableForVerifiedPlayer: ${error.message}`, error);
        return await createErrorResponse('something_went_wrong', language || 'nor', 500);
    }
}

/**
 * Formats a date into a string for game IDs
 * @param {number} dateData - The date timestamp to format
 * @returns {string} - Formatted date string (YYYYMMDDHHMMSS)
 */
function formatDateTime(dateData) {
    // Use moment.js to format the date
    // Format as YYYYMMDDHHMMSS
    return moment(dateData).format('YYYYMMDDHHmmssSSS');
}

function formatDateTimeGameName(dateData) {
    return moment(dateData).format('YYYYMMDD_hmmssSSS');
}

function gameUTCTime(dateData) {
    return moment(dateData).utc().format('DD-MM-YYYY HH:mm:ss');
}

function dateTimeFunction(dateData) {
    const m = moment(dateData);
    const hour12 = m.hours() % 12 || 12;
    return `${m.year()}${m.month() + 1}${m.date()}_${hour12}${m.format('mmss')}${m.milliseconds()}`;
}

function isDateInRange(dateToCheck, startDate, endDate) {
    return dateToCheck >= startDate && dateToCheck <= endDate;
}

/**
 * Converts a dot-separated string of numbers to a 2D array
 * @param {string} s - String containing numbers separated by dots
 * @returns {Array} - Array of numbers
 */
function get2DArrayFromString(s) {
    return s.replace(/\./g, ",").split`,`.map(x => +x);
};

/**
 * Process and validate a voucher code
 * @param {string} voucherCode - The voucher code to process
 * @param {string} playerId - The ID of the player using the voucher
 * @param {string} language - The player's selected language
 * @returns {Object} - Result object with status and voucher info
 */
async function processVoucherCode(voucherCode, playerId, language, markedAsUsed = true) {
    try {
        // If no voucher code provided, return empty success
        if (!voucherCode) {
            return { status: 'success', voucherInfo: null };
        }
        
        // Verify voucher
        const vocherTransaction = await Sys.Game.Common.Services.PlayerServices.transactionData({
            playerId,
            voucherCode
        });
        
        if (vocherTransaction.length === 0) {
            return await createErrorResponse("vourcher_not_purchased", language);
        }
        
        if (!vocherTransaction[0].isVoucherApplied) {
            return await createErrorResponse("voucher_not_applied", language);
        }
        
        // Get voucher data
        const voucherData = await Sys.App.Services.VoucherServices.getSingleData({
            _id: vocherTransaction[0].voucherId
        });
        
        if (!voucherData) {
            return await createErrorResponse("voucher_not_valid", language);
        }
        
        if (voucherData.status !== 'active') {
            return await createErrorResponse("voucher_blocked", language);
        }
        
        // Check expiry
        if (Date.now() > new Date(voucherData.expiryDate)) {
            return await createErrorResponse("voucher_expired", language);
        }
        
        // Mark voucher as used
        if (markedAsUsed) {
            await Sys.Game.Common.Services.PlayerServices.updateOneTransaction(
                { _id: vocherTransaction[0]._id },
                { isVoucherUse: true }
            );
        }
        
        return {
            status: 'success',
            voucherInfo: {
                voucherCode,
                voucherId: voucherData._id,
                percentageOff: voucherData.percentageOff,
                transactionId: vocherTransaction[0]._id
            }
        };
    } catch (error) {
        console.error('Error in processVoucherCode:', error);
        return await createErrorResponse("something_went_wrong", language);
    }
}


// Send Game Chat common function for game 2, game 3
async function sendGameChatCommon({
    data,
    PlayerServices,
    getGameServices,
    ChatServices,
    IoNamespace,
    socketId
}) {
    try {
        const { playerId, gameId, message, emojiId, language = "nor" } = data;

        // Run player & game lookup in parallel
        const [player, gameData] = await Promise.all([
            PlayerServices.getById(
                playerId,
                { username: 1, userProfilePic: 1, selectedLanguage: 1 }
            ),
            getGameServices(
                { _id: gameId },
                { _id: 1 }
            )
        ]);

        if (!player) return await createErrorResponse("player_not_found", language, 400);
        if (!gameData) return await createErrorResponse("game_not_found", player?.selectedLanguage || language, 400);

        // Prepare and insert chat data
        const chatData = {
            playerId: player.id,
            name: player.username,
            profilePic: player.userProfilePic || "/assets/profilePic/gameUser.jpg",
            emojiId,
            roomId: gameData._id,
            message,
            socketId,
            createdAt: Date.now()
        };

        const chats = await ChatServices.insertData(chatData);

        // Prepare response data
        const responseData = {
            playerId: chats.playerId,
            name: chats.name,
            profilePic: chats.profilePic,
            message: chats.message,
            emojiId: chats.emojiId,
            dateTime: gameUTCTime(chats.createdAt)
        };

        // Emit to room
        IoNamespace.to(gameData._id).emit('GameChat', responseData);

        return await createSuccessResponse(
            '',
            "Chat broadcast sent successfully!",
            player?.selectedLanguage || language,
            false
        );
    } catch (error) {
        console.error("Error in sendGameChatCommon:", error);
        return createErrorResponse("something_went_wrong", data?.language || "nor", 500);
    }
}

// Will be used for game 2 and game 3 get roomdata
// Game Chat History common function for game 2, game 3
async function gameChatHistoryCommon({ data, PlayerServices, getGameServices, ChatServices, IoNamespace, namespace }) {
    try {
        let { playerId, gameId, language = 'nor' } = data;

        // Fetch player and game in parallel
        const [player, gameData, allChatData] = await Promise.all([
            PlayerServices.getById(playerId, { selectedLanguage: 1 }),
            getGameServices({ _id: gameId }, { _id: 1 }),
            ChatServices.getByData(
                { roomId: gameId },
                { playerId: 1, name: 1, profilePic: 1, message: 1, emojiId: 1, createdAt: 1 }
            )
        ]);

        if (!player) return await createErrorResponse("player_not_found", language, 400);
        language = player.selectedLanguage || language;
        if (!gameData) return await createErrorResponse("game_not_found", player?.selectedLanguage || language, 400);

        // Prepare chat history
        const history = await Promise.all(allChatData.map(async (chat) => ({
            playerId: chat.playerId,
            name: chat.name,
            profilePic: chat.profilePic || "/assets/profilePic/gameUser.jpg",
            message: chat.message,
            emojiId: chat.emojiId,
            dateTime: gameUTCTime(chat.createdAt)
        })));

        // Get online players
        const onlinePlayers = await getOnlinePlayers(namespace, gameData._id);
        // Emit updates
        if(namespace == "/Game2"){
            IoNamespace.to(gameData._id).emit('UpdatePlayerRegisteredCount', { playerRegisteredCount: onlinePlayers });
        }
       
        IoNamespace.to(gameData._id).emit('GameOnlinePlayerCount', { onlinePlayerCount: onlinePlayers });

        // Final result
        return await createSuccessResponse( { onlinePlayerCount: onlinePlayers, history }, 'Game Chat History sent Successfully..!!', language, false );
    } catch (error) {
        console.error("Error in gameChatHistory:", error);
        return await createErrorResponse("something_went_wrong", language, 500);
    }
};

// Check break time with active games for game 2 and game 3 
async function checkPlayerBreakTimeWithActiveGames(playerId, startBreakTime, endBreakTime, currentTime, gameType = "game_2") {
    try {
        if (!startBreakTime || !endBreakTime) return false;
        
        const isInBreak = currentTime.isBetween(
            moment(startBreakTime),
            moment(endBreakTime)
        );
        if (isInBreak) {
            const activeGames = await Sys.Game.Game2.Services.GameServices.getGameCount({
                gameType: gameType,
                status: { $nin: ['finish'] },
                isNotificationSent: true,
                "players.id": playerId,
            });
            return activeGames === 0;
        }
        return false;
    } catch (error) {
        console.error("Error in checkPlayerBreakTime:", error);
        return false;
    }
}

async function emitBreakTimeStatus(socketId, startBreakTime, endBreakTime, isBreak) {
    try {
        if (startBreakTime) {
            await Sys.Io.to(socketId).emit('breakTimeStart', {
                isBreak,
                startBreakTime: startBreakTime,
                endBreakTime: endBreakTime
            });
        }
    } catch (error) {
        console.error("Error in emitBreakTimeStatus:", error);
        throw error;
    }
}

// Find game is avaiblae for particulr day and date
async function findAvailableGameForDay(game, date, dayName, startBreakTime, endBreakTime, isBreak, gameType) {
    const timeSlot = game.days[dayName];
    if (!timeSlot) return {};

    const isOpen = await isGameOpen(game, dayName, moment().format('HH:mm'));
    if (!isOpen) return {};

    const currentFormattedTime = date.format('HH:mm');
    
    // Only compare time if it's today
    const isToday = moment().isSame(date, 'day');
    const canCheckTime = !isToday || compareTimeSlots(currentFormattedTime, timeSlot[1], 'lt');
    if (canCheckTime) {
        const childGames = await getChildGamesCount(game, date, dayName);
        if (childGames >= 1) {
            return {
                gameId: game._id.toString(),
                gameName: game.gameName,
                namespaceString: gameType,
                isBreak,
                startBreakTime,
                endBreakTime
            };
        }
    }

    return {};
}

// check if game is open for a particular day and date
async function isGameOpen(gameData, day, currentTime) {
    if (!gameData.otherData?.closeDay?.length) {
        return true;
    }

    const date = day === moment().format('ddd') 
        ? moment().format('YYYY-MM-DD')
        : moment().add(1, 'day').format('YYYY-MM-DD');

    // const timeToCheck = day === moment().format('ddd')
    //     ? currentTime
    //     : gameData.days[day][0];

    // return !gameData.otherData.closeDay.some(closeDay => 
    //     closeDay.closeDate === date && 
    //     compareTimeSlots(timeToCheck, closeDay.startTime, 'gte') && 
    //     compareTimeSlots(timeToCheck, closeDay.endTime, 'lte')
    // );

    const timeToCheck = day === moment().format('ddd')
        ? moment().utc()
        : moment().add(1, 'day').set('hour', gameData.days[day][0].split(':')[0]).set('minute', gameData.days[day][0].split(':')[1]).set('second', 0).utc();
    console.log("time to check---", timeToCheck)
    return !gameData.otherData.closeDay.some(closeDay => 
        closeDay.closeDate === date && 
        moment(closeDay.utcDates.startTime).diff(moment(timeToCheck), 'seconds') > (24 * 60 * 60)
    );
}

// Helper function to get child games count
async function getChildGamesCount(game, date, day) {
    const startTime = date.startOf('day').toDate();
    const endTime = date.endOf('day').toDate();

    return await Sys.Game.Game2.Services.GameServices.getGameCount({
        parentGameId: game._id,
        status: { $ne: "finish" }, //status: 'active',
        startDate: {
            $gte: startTime,
            $lte: endTime
        },
        day: day
    });
}

// Subscribe player to game 2 and game 3
async function checkGameAvailability(gameData, currentTime, projection = {status: 1, purchasedTickets: 1, ticketPrice: 1, players: 1, jackPotNumber: 1, gameNumber: 1, isNotificationSent: 1, withdrawNumberList: 1, totalNoPurchasedTickets: 1, seconds: 1, winners: 1}) {
    const currentDay = moment().format('ddd');
    const nextDay = moment().add(1, 'day').format('ddd');
    
    // Try current day first, then next day
    for (const day of [currentDay, nextDay]) {
        if (!gameData.days[day]) continue;

        const result = await checkDayAvailability(gameData, day, currentTime, projection);
        if (result && result.length > 0 ) return result;
    }
    
    return null;
};

async function checkDayAvailability(gameData, day, currentTime, projection) {
    const isToday = day === moment().format('ddd');
    const timeSlot = gameData.days[day];
    
    // Check if game is closed for the day
    if (!await isGameOpen(gameData, day, currentTime)) {
        return null;
    }

    // For today, check if current time is before end time
    // For tomorrow, we don't need time check as we already verified it's open
    if (!isToday || compareTimeSlots(currentTime, timeSlot[1], 'lt')) {
        return await getGamesForDay(gameData._id, day, isToday, projection);
    }

    return null;
};

async function getGamesForDay(gameId, day, isToday, projection) {
    const date = new Date();
    if (!isToday) {
        date.setDate(date.getDate() + 1);
    }
    
    const startTime = new Date(date).setHours(0, 0, 0, 0);
    const endTime = new Date(date).setHours(23, 59, 59, 59);
    
    return await Sys.Game.Game2.Services.GameServices.getByData(
        {
            parentGameId: gameId,
            status: isToday ? { $in: ['running', 'active'] } : 'active',
            startDate: { 
                $gte: new Date(startTime), 
                $lte: new Date(endTime) 
            },
            day
        },
        projection,
        { sort: { createdAt: 1 } }
    );
};

function getAvailableBalls(withdrawnBalls, totalBalls) {
    const available = [];
    for (let i = 1; i <= totalBalls; i++) {
        if (!withdrawnBalls.includes(i)) {
            available.push(i);
        }
    }
    return available;
}

function getRandomBall(ballArray) {
    const index = Math.floor(fortuna.random() * ballArray.length);
    return ballArray[index];
}

function setGameTimer(timerKey, callback, timeMs) {
    try {
        if (Timeout.exists(timerKey)) {
            Timeout.clear(timerKey, erase = true);
        }

        Timeout.set(timerKey, callback, timeMs);
    } catch (error) {
        console.log("Error in setGameTimer:", error);
    }
}

async function cleanTimeAndData(timerKey, gameType, gameId ) {
    try {
        if (Timeout.exists(timerKey)) {
            Timeout.clear(timerKey, erase = true);
        }

        // Clean up Redis data if dataKey is provided
        redis.del(`${gameType}:${gameId}`);
        if (gameType == 'game5') {
            return;
        }else if(gameType == 'game2' || gameType == 'game3'){
            redis.del(`${gameType}_winners:${gameId}`);
          
            const patterns = [
                `${gameType}_tickets:${gameId}_*`,
                `${gameType}_ticket_meta:${gameId}_*`,
                `${gameType}_tickets_by_game:${gameId}`,
                `${gameType}_tickets_by_player:${gameId}_*`
            ];
            
            for (const pattern of patterns) {
                let cursor = 0;
                do {
                    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                    cursor = Number(nextCursor);
                    if (keys.length > 0) {
                        await redis.del(...keys);
                    }
                } while (cursor !== 0);
            }
        }else if(gameType == 'game1'){
            redis.del(`${gameType}:${gameId}`);
        }
    
    } catch (error) {
        console.log("Error in cleanTimeAndData:", error);
    }
}

async function syncGameToMongoDB(gameId, isDeleteData = false, gameType) {
    try {
        // update winners in game purchasedticket array 
        const winnerArr = await getGameDataFromRedis(`${gameType}_winners`, gameId);
        if(winnerArr.length > 0){
            const winnerIds = await Promise.all(
                winnerArr.map(winner => Sys.Helper.bingo.obId(winner.ticketId))
            );
            await Sys.Game.Game2.Services.GameServices.updateSingleGame(
                { _id: gameId }, 
                {
                    $set: {
                        'purchasedTickets.$[elem].ticketCompleted': true
                    }
                },
                {
                    arrayFilters: [{ 'elem.ticketId': { $in: winnerIds } }]
                }
            )
        }

        if(isDeleteData){
            if(gameType == 'game2'){
                await cleanTimeAndData(`${gameId}_timer`, 'game2', gameId);
            }
        }
        return true;
    } catch (error) {
        console.error('Error syncing game to MongoDB:', error);
        // Critical error - attempt emergency save to prevent data loss
        await cleanTimeAndData(`${gameId}_timer`, 'game2', gameId);
        return false;
    }
}


/**
 * Gets or sets multiple data items using Redis cache
 * @param {Array<Object>} dataRequests - Array of data request objects
 * @returns {Promise<Array>} - Array of requested data
 */
async function getMultipleDataWithCache(dataRequests, expiry = 86400) {
    try {
        const results = await Promise.all(
            dataRequests.map(async request => {
                const { type, query, fields, serviceFunction } = request;
                
                // Try to get from Redis first
                const cachedData = await RedisHelper.getData(type, JSON.stringify(query));
                
                if (cachedData) {
                    return cachedData;
                }

                // If not in Redis, fetch from database
                const data = await serviceFunction(query, fields);
                
                // Store in Redis if data exists (1 day expiry by default)
                if (data) {
                    await RedisHelper.saveData(type, JSON.stringify(query), data, expiry);
                }

                return data;
            })
        );
        return results;
    } catch (error) {
        console.error('Cache Multi Get Error:', error);
        // Fallback to direct database queries
        return await Promise.all(
            dataRequests.map(request => request.serviceFunction(request.query, request.fields))
        );
    }
}

/**
 * Gets or sets single data item using Redis cache
 * @param {string} type - The type of data (player, game, tickets etc)
 * @param {Object} query - The query parameters
 * @param {Object} fields - The fields to fetch
 * @param {Function} serviceFunction - The service function to call if cache miss
 * @returns {Promise<Object>} - The requested data
 */
async function getDataWithCache(type, query, fields, serviceFunction, expiry = 86400) {
    try {
        // Try to get from Redis first
        const cachedData = await RedisHelper.getData(type, JSON.stringify(query));
        
        if (cachedData) {
            return cachedData;
        }

        // If not in Redis, fetch from database
        const data = await serviceFunction(query, fields);
        
        // Store in Redis if data exists (1 hour expiry)
        if (data) {
            await RedisHelper.saveData(type, JSON.stringify(query), data, expiry);
        }

        return data;
    } catch (error) {
        console.error(`Cache Get Error (${type}):`, error);
        // Fallback to direct database query
        return await serviceFunction(query, fields);
    }
}

/**
 * Invalidates Redis cache for specific data
 * @param {string} type - The type of data
 * @param {Object} query - The query parameters
 * @returns {Promise<boolean>}
 */
async function invalidateCache(type, query) {
    return await RedisHelper.deleteData(type, JSON.stringify(query));
}

// For single type of data
// const tickets = await Sys.Helper.gameHelper.getDataWithCache(
//     'tickets',
//     { gameId: gameId, playerIdOfPurchaser: playerId },
//     { _id: 1, tickets: 1 },
//     Sys.Game.Game2.Services.GameServices.getTicketByData
// );

// // For multiple types of data
// const dataRequests = [
//     {
//         type: 'player',
//         query: { _id: playerId },
//         fields: { selectedLanguage: 1 },
//         serviceFunction: PlayerServices.getOneByData
//     }
//     // Add more requests as needed
// ];
// const results = await Sys.Helper.gameHelper.getMultipleDataWithCache(dataRequests);

// game2Ticket: async function (socket, data) {
//     try {
//         let language = data.language || "nor";

//         // Define data requests for Redis helper
//         const dataRequests = [
//             {
//                 type: 'player',
//                 query: { _id: data.playerId },
//                 fields: { selectedLanguage: 1 },
//                 serviceFunction: Sys.Game.Game2.Services.PlayerServices.getOneByData
//             },
//             {
//                 type: 'game',
//                 query: { _id: data.subGameId, status: "active" },
//                 fields: { 
//                     status: 1, 
//                     players: 1, 
//                     ticketPrice: 1, 
//                     purchasedTickets: 1, 
//                     minTicketCount: 1, 
//                     rocketLaunch: 1, 
//                     jackPotNumber: 1, 
//                     parentGameId: 1, 
//                     gameTypeId: 1 
//                 },
//                 serviceFunction: Sys.Game.Game2.Services.GameServices.getSingleGameByData
//             },
//             {
//                 type: 'tickets',
//                 query: { gameId: data.subGameId, playerIdOfPurchaser: data.playerId },
//                 fields: { _id: 1, tickets: 1, isPurchased: 1, ticketId: 1, playerIdOfPurchaser: 1 },
//                 serviceFunction: Sys.Game.Game2.Services.GameServices.getTicketByData
//             }
//         ];

//         // Fetch all data using Redis helper
//         const [player, gameData, _tickets] = await Sys.Helper.gameHelper.getMultipleDataWithCache(dataRequests);
//         let tickets = _tickets;

//         // Rest of the code remains the same...
//         // ... existing code ...

//         // After successful ticket generation, invalidate tickets cache
//         if (shouldGenerateTickets) {
//             await Sys.Helper.gameHelper.invalidateCache('tickets', { 
//                 gameId: data.subGameId, 
//                 playerIdOfPurchaser: data.playerId 
//             });
//         }

//         // ... rest of the existing code ...
//     } catch (error) {
//         console.error("Error game2Ticket", error);
//         return await createErrorResponse("something_went_wrong", data.language || "nor");
//     }
// },

// Load tickets for a game into Redis Using for game 2, used hmset in redis
async function loadTicketsToRedis(gameId, projection = {}, gameType) {
    try {
        // Get all purchased tickets for this game from MongoDB
        const tickets = await Sys.Game.Game5.Services.GameServices.getTicketsByData(
            { gameId: gameId, isPurchased: true }, 
            projection
        );
        console.log("load ticket lenght", tickets.length)
        if (!tickets || tickets.length === 0) {
            return false;
        }
        const BATCH_SIZE = 1000;
        for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
            const batch = tickets.slice(i, i + BATCH_SIZE);
            await insertTicketDataToRedis(batch, gameId, gameType);
        }
        
        return true;
    } catch (error) {
        console.error("Error loading tickets to Redis:", error);
        return false;
    }
}

const insertTicketDataToRedis = async (tickets, gameId, gameType) => {
    const pipeline = redis.pipeline();

    for (const ticket of tickets) {
        const ticketId = ticket._id.toString();
        const playerId = ticket.playerIdOfPurchaser?.toString() || '';
        const keySet = `${gameType}_tickets:${gameId}_${ticketId}`;
        const keyMeta = `${gameType}_ticket_meta:${gameId}_${ticketId}`;
        const numbers = ticket.tickets || [];

        if (numbers.length === 0) continue;

        

        if(gameType === "game2"){
            // Save ticket numbers as Set
            pipeline.sadd(keySet, ...numbers);
            pipeline.expire(keySet, 3600);

            // Save metadata as Hash
            pipeline.hmset(keyMeta, {
                _id: ticketId,
                playerIdOfPurchaser: playerId,
                ticketNumber: ticket.ticketId || '',
                hallName: ticket.hallName || '',
                hallId: ticket.hallId || '',
                groupHallName: ticket.groupHallName || '',
                groupHallId: ticket.groupHallId || '',
                tickets: JSON.stringify(numbers)
            });
            pipeline.expire(keyMeta, 3600);
        }else if(gameType === "game3"){
            pipeline.hmset(keyMeta, {
                _id: ticketId,
                playerIdOfPurchaser: playerId,
                ticketNumber: ticket.ticketId || '',
                gameId: gameId,
                hallName: ticket.hallName || '',
                hallId: ticket.hallId || '',
                groupHallName: ticket.groupHallName || '',
                groupHallId: ticket.groupHallId || '',
                tickets: JSON.stringify(numbers),
                winningCombinations: JSON.stringify(ticket.winningCombinations)
            });
            pipeline.expire(keyMeta, 3600);
        }
        
        // Add ticket key to game-wise index
        pipeline.sadd(`${gameType}_tickets_by_game:${gameId}`, keyMeta);
        pipeline.expire(`${gameType}_tickets_by_game:${gameId}`, 3600); // expires in 1 hour

        // Add ticket key to player-wise index
        if (playerId) {
            pipeline.sadd(`${gameType}_tickets_by_player:${gameId}_${playerId}`, keyMeta);
            pipeline.expire(`${gameType}_tickets_by_player:${gameId}_${playerId}`, 3600); // expires in 1 hour
        }
    }

    await pipeline.exec();
};

// By ticketId
//await getTicketsFromRedis({ gameId: 'g123', gameType: 'game2', ticketId: 't456' });

// All tickets by game
//await getTicketsFromRedis({ gameId: 'g123', gameType: 'game2' });

// All tickets for player in a game
//await getTicketsFromRedis({ gameId: 'g123', gameType: 'game2', playerId: 'p789' });
const getGameTicketsFromRedis = async ({ gameId, gameType, ticketId = null, playerId = null }) => {
    // Case 1: Direct fetch by ticketId
    if (ticketId) {
        const key = `${gameType}_ticket_meta:${gameId}_${ticketId}`;
        const data = await redis.hgetall(key);

        if (!data || Object.keys(data).length === 0) return [];

        if (data.tickets && typeof data.tickets === 'string') {
            try {
                data.tickets = JSON.parse(data.tickets);
            } catch { data.tickets = []; }
        }

        if (data.winningCombinations && typeof data.winningCombinations === 'string') {
            try {
                data.winningCombinations = JSON.parse(data.winningCombinations);
            } catch { data.winningCombinations = []; }
        }

        return [{ key, ...data }];
    }

    // Case 2: Use index set if playerId or gameId is provided
    let indexKey = null;

    if (playerId) {
        indexKey = `${gameType}_tickets_by_player:${gameId}_${playerId}`;
    } else if (gameId) {
        indexKey = `${gameType}_tickets_by_game:${gameId}`;
    }
    
    if (indexKey) {
        const ticketKeys = await redis.smembers(indexKey);
        if (!ticketKeys.length) return [];

        const pipeline = redis.pipeline();
        ticketKeys.forEach(key => pipeline.hgetall(key));
        const results = await pipeline.exec();

        return results.map(([err, data], i) => {
            if (err || !data) return null;
            if (data.tickets && typeof data.tickets === 'string') {
                try {
                    data.tickets = JSON.parse(data.tickets);
                } catch { data.tickets = []; }
            }
            if (data.winningCombinations && typeof data.winningCombinations === 'string') {
                try {
                    data.winningCombinations = JSON.parse(data.winningCombinations);
                } catch { data.winningCombinations = []; }
            }
            return { key: ticketKeys[i], ...data };
        }).filter(Boolean);
    }

    // Case 3: Fallback to SCAN (if no index exists or gameId not passed)
    const keys = [];
    let cursor = '0';
    const pattern = `${gameType}_ticket_meta:*`;

    do {
        const [nextCursor, batchKeys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
        cursor = nextCursor;
        keys.push(...batchKeys);
    } while (cursor !== '0');

    if (keys.length === 0) return [];

    const pipeline = redis.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    const results = await pipeline.exec();

    const filtered = results.map(([err, data], i) => {
        if (err || !data) return null;
        if (data.tickets && typeof data.tickets === 'string') {
            try {
                data.tickets = JSON.parse(data.tickets);
            } catch { data.tickets = []; }
        }
        if (data.winningCombinations && typeof data.winningCombinations === 'string') {
            try {
                data.winningCombinations = JSON.parse(data.winningCombinations);
            } catch { data.winningCombinations = []; }
        }
        return { key: keys[i], ...data };
    }).filter(Boolean);

    return filtered;
}

// Replace complete object if setTTL: true, if it is false then it will only update specific field
// First-time save with TTL
//await upsertGameDataHash('game2', gameId, gameData, { setTTL: true, ttl: 3600 });

// Later, update a few fields without TTL change
//await upsertGameDataHash('game2', gameId, { status: 'completed' });
const saveGameDataToRedisHmset = async (gameType, gameId, data = {}, options = { setTTL: false, ttl: 3600 }) => {
    try {
        const key = `${gameType}:${gameId}`;
        const fields = {};

        for (const [k, v] of Object.entries(data)) {
            fields[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        }

        const pipeline = redis.pipeline();
        pipeline.hmset(key, fields);

        if (options.setTTL) {
            pipeline.expire(key, options.ttl);
        }

        await pipeline.exec();
        return true;
    } catch (err) {
        console.error("Redis upsertGameDataHash error:", err);
        return false;
    }
}

const getGameDataFromRedisHmset = async (gameType, gameId, fields = null) => {
    try {
        const key = `${gameType}:${gameId}`;

        // Handle single field
        if (typeof fields === 'string') {
            const value = await redis.hget(key, fields);
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }

        // Handle multiple fields
        if (Array.isArray(fields)) {
            const values = await redis.hmget(key, fields);
            const result = {};

            fields.forEach((field, index) => {
                const val = values[index];
                try {
                    result[field] = JSON.parse(val);
                } catch {
                    result[field] = val;
                }
            });

            return result;
        }

        // Default: return all fields
        const rawData = await redis.hgetall(key);
        if (!rawData || Object.keys(rawData).length === 0) return null;

        const parsedData = {};
        for (const [key, value] of Object.entries(rawData)) {
            try {
                parsedData[key] = JSON.parse(value);
            } catch {
                parsedData[key] = value;
            }
        }

        return parsedData;
    } catch (error) {
        console.error(`Redis getGameDataFromRedis error:`, error);
        return null;
    }
};

/**
 * Get game data from Redis
 * @param {string} gameType - Game type (e.g., 'game5')
 * @param {string} gameId - Game ID to get data for
 * @returns {Promise<Object|null>} - Game data or null if not found
 */
async function getGameDataFromRedis(gameType, gameId) {
    return await RedisHelper.getData(gameType, gameId);
}

/**
 * Save game data to Redis
 * @param {string} gameType - Game type (e.g., 'game5') 
 * @param {string} gameId - Game ID
 * @param {Object} gameData - Game data to save
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<boolean>} - Success status
 */
async function saveGameDataToRedis(gameType, gameId, gameData, ttl = 3600) {
    return await RedisHelper.saveData(gameType, gameId, gameData, ttl);
}

function findGroupHall(groupHalls, playerHallId) {
    return groupHalls.find(group => 
        group.halls.some(hall => (hall.id || hall) === playerHallId)
    );
}

const validateBalance = async (player, totalAmount, purchaseType) => {
    try {
        if (purchaseType === 'points') {
            return player.points >= totalAmount ? true : { isValid: false, error: 'Insufficient_balance' };
        } else if (purchaseType === 'realMoney') {
            return player.walletAmount >= totalAmount ? true : { isValid: false, error: 'Insufficient_balance' };
        } else if (purchaseType === 'voucher') {
            return { isValid: false, error: 'voucher_not_applied_for_game' };
        } else {
            return { isValid: false, error: 'something_went_wrong' };
        }
    } catch (error) {
        console.error("Error in validateBalance:", error);
        return false;
    }
};


// Game 2 and 3 game start check helpers
const setupGameStartTime = async (game) => {
    try {
        const newStartDate = new Date();
        const TimeType = game.notificationStartTime.slice(-1);
        const notificationTime = parseInt(game.notificationStartTime); // Extract number part safely
        let secondsToAdd, TimeMessage;

        if (TimeType === "m") {
            secondsToAdd = (notificationTime * 60); // + 3;
            newStartDate.setSeconds(newStartDate.getSeconds() + secondsToAdd);
            TimeMessage = await getTranslatedMessages(game.gameNumber, notificationTime, 'minutes');
        } else {
            secondsToAdd = notificationTime;
            let newSec = (secondsToAdd * 1) + 10;
            newStartDate.setSeconds(newStartDate.getSeconds() + newSec);
            TimeMessage = await getTranslatedMessages(game.gameNumber, secondsToAdd, 'seconds');
        }

        return { newStartDate, secondsToAdd, TimeMessage };
    } catch (error) {
        console.error("Error in setupGameStartTime:", error);
        return { 
            newStartDate: new Date(Date.now() + 10000), // Default 10 seconds
            secondsToAdd: 10,
            TimeMessage: { 
                en: `Game will start soon`, 
                nor: `Spillet starter snart` 
            }
        };
    }
};

const getTranslatedMessages = async (gameNumber, time, type) => {
    try {
        const enMessage = await translate({
            key: `game1_start_noti_${type}`,
            language: 'en',
            isDynamic: true,
            number: gameNumber,
            number1: time
        });
    
        const norMessage = await translate({
            key: `game1_start_noti_${type}`,
            language: 'nor',
            isDynamic: true,
            number: gameNumber,
            number1: time
        });
        
        return { en: enMessage, nor: norMessage };
    } catch (error) {
        console.error("Error in getTranslatedMessages:", error);
        return { 
            en: `Game ${gameNumber} will start in ${time} ${type}`,
            nor: `Spill ${gameNumber} vil starte om ${time} ${type}`
        };
    }
}

const updateTicketsAndTransactions = async (gameId, startDate) => {
    try {
        let ticketUpdate = [
            {
                'updateMany': {
                    "filter": { "gameId": gameId.toString() },
                    "update": { '$set': { "gameStartDate": Date.now() } }
                }
            }
        ]
        let transactionUpdate = [
            {
                'updateMany': {
                    "filter": { "gameId": gameId.toString() },
                    "update": { '$set': { "gameStartDate": Date.now(), "otherData.exactGameStartTime": startDate } }
                }
            }
        ]
        await Sys.App.Services.GameService.bulkWriteTicketData(ticketUpdate);
        await Sys.App.Services.GameService.bulkWriteTransactionData(transactionUpdate);
    } catch (error) {
        console.error("Error in updateTicketsAndTransactions:", error);
    }
}

const sendNotificationsToPlayers = async (game, TimeMessage) => {
    try {
        // Single map operation to get both notifications and playerIds
        const { notifications, playerIds } = game.players.reduce((acc, player) => {
            acc.notifications.push({
                insertOne: {
                    document: {
                        playerId: player.id,
                        gameId: game._id,
                        notification: {
                            notificationType: 'Game Start Reminder',
                            message: TimeMessage
                        }
                    }
                }
            });
            acc.playerIds.push(player.id);
            return acc;
        }, { notifications: [], playerIds: [] });

        // Execute notifications in parallel
        await Promise.all([
            Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(notifications),
            Sys.Helper.gameHelper.sendNotificationToPlayers(
                game, 
                playerIds, 
                TimeMessage, 
                'Game Start Reminder'
            )
        ]);

        return true;
    } catch (error) {
        console.error("Error in sendNotificationsToPlayers:", error);
        throw error;
    }
}
// Game 2 and 3 game start check helpers

// Get player Ip from socket
function getPlayerIp(socket) {
    let playerIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() 
                   || socket.conn.remoteAddress;
    return playerIp?.startsWith('::ffff:') ? playerIp.slice(7) : playerIp;
}

// async function checkPlayerSpending(playerData) {
//   try {
//     const { playerId, hallId, amount } = playerData;

//     // Fetch only approved halls for the player
//     const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
//       { _id: playerId },
//       ["approvedHalls"]
//     );

//     const playerHall = player.approvedHalls.find(
//       (hall) => hall.id === hallId && hall.status === "Approved"
//     );

//     if (!playerHall) {
//       return { isValid: false, error: "Hall_not_approved" };
//     }

//     // --- Config and existing spending values ---
//     const dailyLimit = Sys.Setting.daily_spending;
//     const monthlyLimit = Sys.Setting.monthly_spending;
//     const isPlayByWinning = playerHall?.winning >= amount;

//     const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
//     const [todayYear, todayMonth, todayDay] = today.split("-");
//     const [hallYear, hallMonth, hallDay] = (playerHall.date || "").split("-");

//     let dailySpending = playerHall.dailySpending || 0;
//     let monthlySpending = playerHall.monthlySpending || 0;
//     let playerWinning = playerHall.winning || 0;

//     // --- Reset spending if date changed ---
//     const isSameYear = hallYear === todayYear;
//     const isSameMonth = isSameYear && hallMonth === todayMonth;
//     const isSameDay = isSameMonth && hallDay === todayDay;

//     if (!isSameYear || !isSameMonth) {
//       // Reset both daily + monthly
//       await resetSpending(playerId, hallId, today, true);
//       dailySpending = 0;
//       monthlySpending = 0;
//     } else if (!isSameDay) {
//       // Reset only daily
//       await resetSpending(playerId, hallId, today, false);
//       dailySpending = 0;
//     }

//     // --- Spending limit checks ---
//     if (dailySpending + amount > dailyLimit) {
//         if(playerWinning > 0 && (dailySpending > 0 && dailyLimit > dailySpending)){
//             let playerTotalLimit = dailySpending - playerWinning;
//             if(playerTotalLimit + amount > dailyLimit){
//                 return { isValid: false, error: "Daily_spending_limit_exceeded" };
//             }else{
//                 return { isValid: true, type: "all" };
//             }
//         }else{
//             return isPlayByWinning
//               ? { isValid: true, type: "winning" }
//               : { isValid: false, error: "Daily_spending_limit_exceeded" };
//         }
//     }

//     if (monthlySpending + amount > monthlyLimit) {
//       return isPlayByWinning
//         ? { isValid: true, type: "winning" }
//         : { isValid: false, error: "Monthly_spending_limit_exceeded" };
//     }

//     // Valid play
//     return { isValid: true, type: "normal" };
//   } catch (error) {
//     console.error("Error in checkPlayerSpending:", error);
//     return { isValid: false, error: "Something_went_wrong" };
//   }
// }

async function checkPlayerSpending(playerData) {
  try {
    const { playerId, hallId, amount } = playerData;

    // Fetch only approved halls for the player
    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: playerId },
      ["approvedHalls"]
    );

    const playerHall = player.approvedHalls.find(
      (hall) => hall.id === hallId && hall.status === "Approved"
    );

    if (!playerHall) {
      return { isValid: false, error: "Hall_not_approved" };
    }

    // --- Config and existing spending values ---
    const dailyLimit = Sys.Setting.daily_spending;
    const monthlyLimit = Sys.Setting.monthly_spending;
    const isPlayByWinning = playerHall?.winning >= amount;

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const [todayYear, todayMonth, todayDay] = today.split("-");
    const [hallYear, hallMonth, hallDay] = (playerHall.date || "").split("-");

    let dailySpending = playerHall.dailySpending || 0;
    let monthlySpending = playerHall.monthlySpending || 0;
    let playerWinning = playerHall.winning || 0;

    // --- Reset spending if date changed ---
    const isSameYear = hallYear === todayYear;
    const isSameMonth = isSameYear && hallMonth === todayMonth;
    const isSameDay = isSameMonth && hallDay === todayDay;

    if (!isSameYear || !isSameMonth) {
      // Reset both daily + monthly
      await resetSpending(playerId, hallId, today, true);
      dailySpending = 0;
      monthlySpending = 0;
    } else if (!isSameDay) {
      // Reset only daily
      await resetSpending(playerId, hallId, today, false);
      dailySpending = 0;
    }

    // --- Spending limit checks ---
    let requiredWinning = 0;
    let type = "normal";
    const dailyExcess = Math.max(0, dailySpending + amount - dailyLimit);
    const monthlyExcess = Math.max(0, monthlySpending + amount - monthlyLimit);

    // Determine required winning (max of both)
    requiredWinning = Math.max(dailyExcess, monthlyExcess);
    
    // Determine type
    if (requiredWinning > 0) {
        type = requiredWinning === amount ? "winning" : "all";
    }
  
    // --- Final decision ---
    if (requiredWinning > 0 && playerWinning < requiredWinning) {
        // Decide which limit failed (priority: daily > monthly)
        if (dailyExcess > 0) {
            return { isValid: false, error: "Daily_spending_limit_exceeded" };
        }
        if (monthlyExcess > 0) {
            return { isValid: false, error: "Monthly_spending_limit_exceeded" };
        }
    }
  
    // Allowed
    return { isValid: true, type };
  } catch (error) {
    console.error("Error in checkPlayerSpending:", error);
    return { isValid: false, error: "Something_went_wrong" };
  }
}
/**
 * Reset spending values for a player's hall
 */
async function resetSpending(playerId, hallId, todayDate, resetMonthly = false) {
  const updateFields = {
    "approvedHalls.$[elem].dailySpending": 0,
    "approvedHalls.$[elem].date": todayDate,
  };

  if (resetMonthly) {
    updateFields["approvedHalls.$[elem].monthlySpending"] = 0;
  }

  await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
    { _id: playerId, "approvedHalls.id": hallId },
    { $set: updateFields },
    { arrayFilters: [{ "elem.id": hallId }] }
  );
}

async function updatePlayerHallSpendingData(playerData) {
  try {
    console.log("updatePlayerHallSpendingData", playerData);

    let { playerId, hallId, amount, type, gameStatus } = playerData;

    const playerApprovedHalls = await Sys.App.Services.PlayerServices.getSinglePlayerData(
      { _id: playerId },
      ["approvedHalls", "hall.id"]
    );

    if (!hallId) {
      hallId = playerApprovedHalls?.hall?.id;
    }

    const playerHall = playerApprovedHalls.approvedHalls.find(
      hall => hall.id === hallId && hall.status === "Approved"
    );

    if (!playerHall) {
      return { isValid: false, error: "Hall_not_approved" };
    }

    // Build update object dynamically
    let update = {};

    if (gameStatus === 1) { // Ticket purchase
      if (type === "normal") {
        update.$inc = {
          "approvedHalls.$[elem].dailySpending": amount,
          "approvedHalls.$[elem].monthlySpending": amount,
        };
      } else if(type === "all"){
        const dailyLimit = Sys.Setting.daily_spending;
        const monthlyLimit = Sys.Setting.monthly_spending;

        const dailySpending = playerHall.dailySpending || 0;
        const monthlySpending = playerHall.monthlySpending || 0;

        // Remaining limits
        const dailyRemaining = Math.max(0, dailyLimit - dailySpending);
        const monthlyRemaining = Math.max(0, monthlyLimit - monthlySpending);

        // How much can still be counted as spending
        const spendingAllowed = Math.min(amount, dailyRemaining, monthlyRemaining);

        // Rest must come from winning
        const winningUsed = amount - spendingAllowed;

        update.$inc = {
          "approvedHalls.$[elem].dailySpending": spendingAllowed,
          "approvedHalls.$[elem].monthlySpending": spendingAllowed,
          "approvedHalls.$[elem].winning": -winningUsed,
        };
      } else{
        update.$inc = { "approvedHalls.$[elem].winning": -amount };
      }
    } else if (gameStatus === 2) { // Ticket cancel
      if (type === "normal") {
        const dailySpending = playerHall.dailySpending || 0;
        const monthlySpending = playerHall.monthlySpending || 0;
      
        // How much spending can we safely revert
        const spendingReverted = Math.min(
          amount,
          dailySpending,
          monthlySpending
        );
      
        // Remaining amount must have come from winnings
        const winningRestored = amount - spendingReverted;
      
        update.$inc = {
          "approvedHalls.$[elem].dailySpending": -spendingReverted,
          "approvedHalls.$[elem].monthlySpending": -spendingReverted,
          "approvedHalls.$[elem].winning": winningRestored,
        };
      } else {
        update.$inc = { "approvedHalls.$[elem].winning": amount };
      }
    } else if (gameStatus === 3) { // Game winner
      update.$inc = { "approvedHalls.$[elem].winning": amount };
    }

    if (Object.keys(update).length > 0) {
      await Sys.App.Services.PlayerServices.findOneandUpdatePlayer(
        { _id: playerId, "approvedHalls.id": hallId },
        update,
        { arrayFilters: [{ "elem.id": hallId }] }
      );
    }

    return { isValid: true, type: type || "normal" };

  } catch (error) {
    console.error("Error in updatePlayerHallSpendingData:", error);
    return { isValid: false, error: "Something_went_wrong" };
  }
}

/**
 * Core function: sanitize any data (string, object, array)
 */
function sanitizeInput(data, schema = null) {
    if (data === null || data === undefined) return data;
    // String sanitization
    if (typeof data === 'string') {
        let cleanStr = data.trim();
        cleanStr = xss(cleanStr);
        return cleanStr;
    }

    // Number / Boolean / Date
    if (typeof data === 'number' || typeof data === 'boolean') return data;
    if (data instanceof Date) return data;

    // Array
    if (Array.isArray(data)) {
        return data.map(item => sanitizeInput(item, schema ? schema[0] : null));
    }

    // Object: sanitize keys and values
    if (typeof data === 'object') {
        const sanitized = {};
        for (const key in data) {
            if (Object.hasOwnProperty.call(data, key)) {
                // Prevent MongoDB operators in keys
                if (key.startsWith('$') || key.includes('.')) continue;

                // Optional: enforce type if schema provided
                if (schema && schema[key]) {
                    sanitized[key] = sanitizeInput(data[key], schema[key]);
                } else {
                    sanitized[key] = sanitizeInput(mongoSanitize(data[key]));
                }
            }
        }
        
        return sanitized;
    }

    // fallback
    return data;
}

/**
 * Express middleware to sanitise data
 */
function sanitizeRequest(req, res, next) {
    try {
        req.body = sanitizeInput(req.body);
        req.query = sanitizeInput(req.query);
        req.params = sanitizeInput(req.params);
        next();
    } catch (err) {
        console.error("Sanitization error:", err);
        res.status(400).json({ message: 'Invalid input data' });
    }
}

async function getAvailableHallLimit(data){
	try{
        const { playerId, approvedHalls, selectedHallId, dailyMonthlyLimit= false } = data;

		if (!Array.isArray(approvedHalls) || approvedHalls.length === 0) return [];

		const dailyLimit = +Sys.Setting.daily_spending || 0;
		const monthlyLimit = +Sys.Setting.monthly_spending || 0;

		const result = [];
		for (let i = 0, len = approvedHalls.length; i < len; i++) {
			const h = approvedHalls[i];
			if (h.status !== "Approved") continue;

            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            const [todayYear, todayMonth, todayDay] = today.split("-");
            const [hallYear, hallMonth, hallDay] = (h.date || "").split("-");
        
            const isSameYear = hallYear === todayYear;
            const isSameMonth = isSameYear && hallMonth === todayMonth;
            const isSameDay = isSameMonth && hallDay === todayDay;

            if (!isSameYear || !isSameMonth) {
                // Reset both daily + monthly for this hall
                resetSpending(playerId, h.id, today, true);
                h.dailySpending = 0;
                h.monthlySpending = 0;
            } else if (!isSameDay) {
                // Reset only daily for this hall
                resetSpending(playerId, h.id, today, false);
                h.dailySpending = 0;
            }

			const dailySpending = h.dailySpending || 0;
			const monthlySpending = h.monthlySpending || 0;
			const winning = h.winning || 0;

            const remainingDailyLimit = Math.max(0, dailyLimit - dailySpending);
            const remainingMonthlyLimit = Math.max(0, monthlyLimit - monthlySpending);
      
            // Player can spend only the minimum of daily & monthly
            const spendableLimit = Math.min(
              remainingDailyLimit,
              remainingMonthlyLimit
            );
      
            const totalLimitAvailable = Math.floor(
              Math.max(0, spendableLimit + winning)
            );
            

			// let remainingMonthlyLimit = monthlyLimit - monthlySpending; 301-12 289
			// if (remainingMonthlyLimit < 0) remainingMonthlyLimit = 0;

			// const effectiveDailyLimit = remainingMonthlyLimit < dailyLimit ? remainingMonthlyLimit : dailyLimit;

			// const total = effectiveDailyLimit + winning - dailySpending;
            // const totalLimitAvailable = total <= 0 ? winning : Math.floor(total);

            let hallLimit = {
				hallId: h.id,
				hallName: h.name,
				totalLimitAvailable,
                groupHall: h.groupHall,
                isSelected: (h.id == selectedHallId) ? true: false
			}

            if(dailyMonthlyLimit){
                //const effectiveDaily = Math.max(0, effectiveDailyLimit - dailySpending);
                //const effectiveMonthly = Math.max(0, remainingMonthlyLimit);
                hallLimit.dailyLimit = { total: totalLimitAvailable, effective: spendableLimit, winning: winning }  //effective: effectiveDaily
                hallLimit.monthlyLimit = { total: remainingMonthlyLimit + winning, effective: remainingMonthlyLimit, winning: winning } //effective: effectiveMonthly
            }
			
			result.push(hallLimit);
		}
        
		return result;
	}catch(e){
		console.error("getAvailableHallLimit error:", e);
		return [];
	}
}

async function updateAgentHallNameSession({ hallId, newHallName }) {
    console.log()
    const sessionsDir = path.join(__dirname, '../sessions');
    try {
      const files = await fs.readdir(sessionsDir);
  
      for (const file of files) {
        const sessionFile = path.join(sessionsDir, file);
        let sessionData;
  
        try {
          const raw = await fs.readFile(sessionFile, 'utf8');
          sessionData = JSON.parse(raw);
        } catch (err) {
          console.log(`Error reading session file ${sessionFile}:`, err.message);
          continue;
        }
  
        const details = sessionData?.details;
        if (
          details &&
          details.is_admin === 'no' &&
          details?.role === 'agent'
        ) {
          const hallArr = details.hall || [];
          const idx = hallArr.findIndex(
            h => h.id?.toString() === hallId.toString()
          );
          
          if (idx >= 0) {
            hallArr[idx].name = newHallName;
            try {
              await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');
            } catch (err) {
              console.log(`Error writing session file ${sessionFile}:`, err.message);
            }
          }
        }
      }
      return { message: 'Session hall name update completed' };
    } catch (err) {
      console.log('Error processing sessions:', err);
      return { message: 'Internal server error' };
    }
}

async function checkGamePlayAtSameTime(playerId, gameType) {
    try {
        if (!playerId) return { status: false };

        const player = await Sys.Game.Common.Services.PlayerServices.getOneByData(
            { _id: playerId },
            { _id: 1, hall: 1 }
        );

        if (!player || !player.hall?.id) {
            return { status: false };
        }
        const hallId = player.hall?.id;
        const playerObjId = player._id;
        if(gameType == "game_1"){
            const games = await Sys.App.Services.GameService.getGamesByData(
                getActiveGamesQuery(hallId),
                { gameMode: 1, startDate: 1, graceDate: 1, status: 1, otherData: 1 },
                { sort: { startDate: 1 }, limit: 1 }
            );
            if (games.length > 0) {
                const result = await getGame1Status(games[0]);
                if(result.status == "Start at"){
                    return { status: false };
                }
            }
        }
        if(["game_2","game_3"].includes(gameType)){
            let PreOrderData = await Sys.Game.Common.Controllers.GameController.availableGameTypes(null, { hallId: hallId })
            let gameStatus = PreOrderData?.result?.[gameType]?.status || "Closed";
            if(gameStatus == "Start at"){
                return { status: false };
            }
        }
        let aggregateQuery = [
            {
              $match: {
                status: { $in: ["running", "active"] },
                gameType: { $in: ["game_2", "game_3"] },
                players: {
                  $elemMatch: {
                    id: playerObjId,
                    hall: hallId
                  }
                }
              }
            },
            {
              $match: {
                $or: [
                  {
                    status: "running"
                  },
                  {
                    status: "active",
                    $expr: {
                      $and: [
                        { $gte: ["$totalNoPurchasedTickets", "$minTicketCount"] },
                        { $eq: ["$isNotificationSent", true] }
                      ]
                    }
                  }
                ]
              }
            },
            {
              $project: {
                gameType: 1,
                startDate: 1,
                endDate: 1,
                days: 1
              }
            },
            {
              $limit: 1   // ⚡ stop at first eligible game
            }
          ];
          let aggregateQuery23 = [
            {
              $match: {
                status: { $in: ["running", "active"] },
                gameType: { $in: ["game_2", "game_3"] },
                "allHallsId": hallId,
                players: {
                  $elemMatch: {
                    id: { $ne: String(playerObjId) }
                  }
                }
              }
            },
            {
              $match: {
                $or: [
                  {
                    status: "running"
                  },
                  {
                    status: "active",
                    $expr: {
                      $and: [
                        { $gte: ["$totalNoPurchasedTickets", "$minTicketCount"] },
                        { $eq: ["$isNotificationSent", true] }
                      ]
                    }
                  }
                ]
              }
            },
            {
              $project: {
                gameType: 1,
                startDate: 1,
                endDate: 1,
                days: 1
              }
            },
            {
              $limit: 1   // ⚡ stop at first eligible game
            }
          ];

        const [
            gameData1,
            gameData23,
            gameData4,
            gameData5,
            preOderGameData1,
            preOderGameData23,
        ] = await Promise.all([
            Sys.App.Services.GameService.getSingleGameData(
                {
                    status: "running",
                    "players.id": String(playerObjId),
                    "players.hall": hallId,
                    gameType: "game_1"
                },
                { gameType: 1, startDate: 1, endDate: 1, days: 1}
            ),
            Sys.App.Services.GameService.aggregateQuery(aggregateQuery),
            Sys.App.Services.GameService.getSingleSubGameData(
                {
                    status: "finish",
                    "players.id": playerObjId,
                    "halls.id": hallId,
                    "otherData.isBallWithdrawn": false
                },
                { gameType: 1 }
            ),
            Sys.App.Services.GameService.getSingleSubgame5Data(
                {
                    status: "Running",
                    "player.id": String(playerObjId),
                    "halls.id": hallId
                },
                { gameType: 1 }
            ),
            Sys.App.Services.GameService.getSingleGameData(
                {
                    status: "running",
                    "players.id": { $ne: String(playerObjId) },
                    "allHallsId": hallId,
                    gameType: "game_1"
                },
                { gameType: 1, startDate: 1, endDate: 1, days: 1}
            ),
            Sys.App.Services.GameService.aggregateQuery(aggregateQuery23),
        ]);

        console.log("gameData checkGamePlayAtSameTime:", gameData1, gameData23, gameData4, gameData5,preOderGameData1, preOderGameData23);
        
        if(gameData1 && gameData1.gameType != gameType ){
            if((preOderGameData1 && preOderGameData1.gameType == gameType) || (preOderGameData23.length > 0 && preOderGameData23[0].gameType == gameType)){
                return { status: false };
            }else{
                return { status: true, gameType: gameData1.gameType };
            }
        }
        if (gameData23.length > 0 && gameData23[0].gameType != gameType) {
            if((preOderGameData1 && preOderGameData1.gameType == gameType) || (preOderGameData23.length > 0 && preOderGameData23[0].gameType == gameType)){
                return { status: false };
            }else{
                return { status: true, gameType: gameData23[0].gameType };
            }
        }
        if(gameData4 && gameData4.gameType != gameType){
            if((preOderGameData1 && preOderGameData1.gameType == gameType) || (preOderGameData23.length > 0 && preOderGameData23[0].gameType == gameType)){
                return { status: false };
            }else{
                return { status: true, gameType: gameData4.gameType };
            }
        }
        if(gameData5 && gameData5.gameType != gameType){
            if((preOderGameData1 && preOderGameData1.gameType == gameType) || (preOderGameData23.length > 0 && preOderGameData23[0].gameType == gameType)){
                return { status: false };
            }else{
                return { status: true, gameType: gameData5.gameType };
            }
        }
        return { status: false };
        
    } catch (error) {
        console.error("checkGamePlayAtSameTime error:", error);
        return { status: false };
    }
}
  

async function checkGamePlayAtSameTimeForRefund(player, gameId) {
    try {
        if (!player) return { status: false };

        const playerData = await Sys.Game.Common.Services.PlayerServices.getOneByData(
            { _id: player.id },
            { _id: 1, hall: 1 }
        );

        const playerObjId = playerData._id;
        const hall = player.hall;
        let aggregateQuery = [
            {
              $match: {
                _id: { $ne: gameId },
                status: { $in: ["running", "active"] },
                gameType: { $in: ["game_2", "game_3"] },
                players: {
                  $elemMatch: {
                    id: playerObjId,
                  }
                }
              }
            },
            {
              $match: {
                $or: [
                  {
                    status: "running"
                  },
                  {
                    status: "active",
                    $expr: {
                      $and: [
                        { $gte: ["$totalNoPurchasedTickets", "$minTicketCount"] },
                        { $eq: ["$isNotificationSent", true] }
                      ]
                    }
                  }
                ]
              }
            },
            {
              $project: {
                _id: 1,
                gameType: 1,
                players:1
              }
            },
            {
              $limit: 1   // ⚡ stop at first eligible game
            }
          ];

        const [
            gameData1,
            gameData23,
            gameData4,
            gameData5
        ] = await Promise.all([
            Sys.App.Services.GameService.getSingleGameData(
                {
                    _id: { $ne: gameId },
                    status: "running",
                    "players.id": String(playerObjId),
                    gameType: "game_1"
                },
                { gameType: 1, players:1 }
            ),
            Sys.App.Services.GameService.aggregateQuery(aggregateQuery),
            Sys.App.Services.GameService.getSingleSubGameData(
                {
                    _id: { $ne: gameId },
                    status: "finish",
                    "players.id": playerObjId,
                    "otherData.isBallWithdrawn": false
                },
                { gameType: 1, halls:1 }
            ),
            Sys.App.Services.GameService.getSingleSubgame5Data(
                {
                    _id: { $ne: gameId },
                    status: "Running",
                    "player.id": String(playerObjId),
                },
                { gameType: 1, halls:1 }
            )
        ]);

        console.log("gameData checkGamePlayAtSameTimeForRefund:", gameData1, gameData23, gameData4, gameData5);
        if(gameData1){
            let hallList = gameData1.players.find(p => p.id.toString() == playerObjId.toString())?.hall;
            let hallSet = new Set(hallList);
            let removeHallList = hall.filter(hallId => hallSet.has(hallId));
            if(removeHallList.length > 0){
                return { status: true, gameType: gameData1.gameType, hallIds: removeHallList };
            }
        }
        if (gameData23.length > 0) {
            let hallList = gameData23[0].players.find(p => p.id.toString() == playerObjId.toString())?.hall;
            console.log("hallList game23", hallList);
            const hallSet = new Set(hallList);
            console.log("hall game23", hall);
            const removeHallList = hall.filter(hallId => hallSet.has(hallId));
            console.log("removeHallList game23", removeHallList);
            if(removeHallList.length > 0){
                return { status: true, gameType: gameData23[0].gameType, hallIds: removeHallList };
            }
        }
        if(gameData4){
            if(hall.includes(gameData4.halls[0].id)){
                return { status: true, gameType: gameData4.gameType, hallIds: [gameData4.halls[0].id] };
            }
        }
        if(gameData5){
            if(hall.includes(gameData5.halls[0].id)){
                return { status: true, gameType: gameData5.gameType, hallIds: [gameData5.halls[0].id] };
            }
        }
        
        return { status: false };
        
    } catch (error) {
        console.error("checkGamePlayAtSameTime error:", error);
        return { status: false };
    }
}

// status for game 1
const getGame1Status = async (game, currentUtc = moment().utc()) => {
    try {
        if (game.status === "running" || game.otherData.gameSecondaryStatus === "running") {
            return { status: "Open" };
        }

        const gameStartUtc = moment(game.startDate).utc();
        const isManualMode = game.gameMode === "Manual";

        let timeDifferenceInMinutes = gameStartUtc.diff(currentUtc, 'seconds');
        if (timeDifferenceInMinutes > (24 * 3600)) {  // Difference in minutes , game start time is more than 24 hours
            return { status: "Closed", date: moment(game.startDate) }
        }
        
        // Handle partial close cases
        if (game.otherData.isPartialClose) {
            const closeStartUtc = moment(game.otherData.closeStartDate).utc();
            const closeEndUtc = moment(game.otherData.closeEndDate).utc().add(1, "minute");
           
            if (currentUtc < gameStartUtc) {
                if (isManualMode) {
                    const isCloseTimeStarted = gameStartUtc >= closeStartUtc || 
                        (moment(gameStartUtc).format('ddd') !== currentUtc.format('ddd') && 
                        gameStartUtc < closeStartUtc && 
                        closeStartUtc.diff(currentUtc) < (24 * 60 * 60000));
                    
                    return isCloseTimeStarted 
                        ? { status: "Start at", date: moment(closeEndUtc) }
                        : { status: "Start at", date: game.otherData.scheduleStartDate };
                }
                return { status: "Start at", date: moment(game.startDate) };
            }

            if (currentUtc >= gameStartUtc) {
                if (currentUtc < closeStartUtc) { //manula game will start but close time not reached
                    return { status: "Open", date: game.otherData.closeStartDate };
                }
                if (currentUtc >= closeStartUtc && currentUtc <= moment(closeEndUtc)) { //manual game start and close time also reached but not finished
                    return { status: "Start at", date: moment(closeEndUtc) };
                }
                if (currentUtc >= closeStartUtc && currentUtc >= moment(closeEndUtc)) { //manual game start and close time also reached and finished
                    return { status: "Open" };
                }
                return { status: "Start at", date: game.otherData.scheduleStartDate };
            }
        }

        // Handle non-partial close cases
        if (currentUtc >= gameStartUtc) {
            return { status: "Open" };
        }

        if (isManualMode) {
            return { status: "Start at", date: game.otherData.scheduleStartDate };
        }

        return currentUtc >= moment(game.otherData.scheduleStartDate).utc()
            ? { status: "Open" }
            : { status: "Start at", date: game.startDate };
    } catch (error) {
        console.error("Error in getGameStatus:", error);
        return { status: "Closed" };
    }
};

const getActiveGamesQuery = (hallId = null, preTime = moment().startOf('day').toDate(), aftTime = moment().add(24, 'hours').toDate()) => ({
    gameType: "game_1",
    stopGame: false,
    'otherData.isClosed': false,
    'otherData.isTestGame': false,
    $or: [
        { status: { $in: ["active", "running"] } },
        { 'otherData.gameSecondaryStatus': { $ne: "finish" } }
    ],
    ...(hallId && { halls: { $in: [hallId] } }),
    startDate: { $gte: preTime, $lt: aftTime },
});

// Export all helper functions
module.exports = {
    isPlayerVerified,
    isValidHall,
    createErrorResponse,
    createSuccessResponse,
    createCancelTransaction,
    createCancelNotification,
    deductPlayerBalance,
    refundPlayerBalance,
    isGameAvailableForVerifiedPlayer,
    checkPlayerBreakStatus,
    formatDateTime,
    formatDateTimeGameName,
    get2DArrayFromString,
    processVoucherCode,
    sendGameChatCommon,
    gameChatHistoryCommon,
    checkPlayerBreakTimeWithActiveGames,
    emitBreakTimeStatus,
    findAvailableGameForDay,
    checkGameAvailability,
    loadTicketsToRedis,
    getGameTicketsFromRedis,
    saveGameDataToRedisHmset,
    getGameDataFromRedisHmset,
    getGameDataFromRedis,
    saveGameDataToRedis,
    getAvailableBalls,
    getRandomBall,
    setGameTimer,
    cleanTimeAndData,
    syncGameToMongoDB,
    findGroupHall,
    validateBalance,
    getOnlinePlayers,
    compareTimeSlots,
    setupGameStartTime,
    updateTicketsAndTransactions,
    sendNotificationsToPlayers,
    getPlayerIp,
    dateTimeFunction,
    isDateInRange,
    checkPlayerSpending,
    updatePlayerHallSpendingData,
    sanitizeInput,
    sanitizeRequest,
    getAvailableHallLimit,
    updateAgentHallNameSession,
    checkGamePlayAtSameTime,
    checkGamePlayAtSameTimeForRefund
};
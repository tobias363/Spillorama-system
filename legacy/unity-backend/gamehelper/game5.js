/**
 * Game5 Helper Functions
 * Contains reusable helper functions specific to Game1 operations
 */

const Sys = require('../Boot/Sys');
const { translate } = require('../Config/i18n');
const exactMath = require('exact-math');
const fortuna = require('javascript-fortuna');
const Timeout = require('smart-timeout');
const redis = require('../Config/Redis');
fortuna.init();
const { 
    formatDateTime,
    createErrorResponse,
} = require('./all.js');
const RedisHelper = require('./redis');

/**
 * Processes mini-game data for Game5
 * @param {Object} ticket - The ticket data
 * @param {Object} subGame - The subgame data
 * @returns {Object} - Processed mini-game data
 */
function processMiniGameData(ticket, subGame) {
    if (!ticket || !subGame || !subGame.otherData) {
        return {};
    }

    const { bonusWinningStats } = ticket;
    if (!bonusWinningStats || bonusWinningStats.isJackpotWon || bonusWinningStats.isMiniGamePlayed) {
        return {};
    }

    const miniGameData = {
        ticketId: ticket._id,
        isMiniGameActivated: false,
        isMiniGamePlayed: false,
        isMiniGameFinished: false,
        autoTurnMoveTime: 10,
        autoTurnReconnectMovesTime: 0,
        isMiniGameSpinning: false,
        rouletteSpinRemaningTime: 0
    };

    // Process wheel of fortune game
    if (!bonusWinningStats.isMiniWofFinished) {
        if (!bonusWinningStats.isMiniWofGamePlayed && bonusWinningStats.isMiniWofActivated) {
            const currentTime = new Date().getTime();
            let currentTurnCountTimer = 10;
            const timeRemaining = bonusWinningStats.miniWofGamestartTimeMs - (currentTime - 10000);
            
            if (timeRemaining > 0) {
                currentTurnCountTimer = Math.round(timeRemaining / 1000);
            }

            return {
                ...miniGameData,
                gameType: "wheelOfFortune",
                isMiniGameActivated: true,
                autoTurnReconnectMovesTime: currentTurnCountTimer,
                gameData: { wofPrizeList: subGame.otherData.wofWinnings, wofWinnings: {} }
            };
        } else if (bonusWinningStats.isMiniWofGamePlayed) {
            return {
                ...miniGameData,
                gameType: "wheelOfFortune",
                isMiniGameActivated: true,
                isMiniGamePlayed: true,
                gameData: { 
                    wofPrizeList: subGame.otherData.wofWinnings, 
                    wofWinnings: bonusWinningStats.wofWinnings 
                }
            };
        }
    } 
    // Process roulette game
    else if (!bonusWinningStats.isMiniRouletteFinished) {
        if (!bonusWinningStats.isMiniGamePlayed && bonusWinningStats.isMiniRouletteActivated) {
            const currentTime = new Date().getTime();
            let currentTurnCountTimer = 10;
            const timeRemaining = bonusWinningStats.miniRouletteGamestartTimeMs - (currentTime - 10000);
            
            if (timeRemaining > 0) {
                currentTurnCountTimer = Math.round(timeRemaining / 1000);
            }

            let rouletteSpinRemaningTime = 10;
            if (bonusWinningStats.isMiniRouletteSpinning) {
                const spinTimeRemaining = bonusWinningStats.miniRouletteGameFinishTimeMs - (currentTime - 10000);
                if (spinTimeRemaining > 0) {
                    rouletteSpinRemaningTime = Math.round(spinTimeRemaining / 1000);
                }
            }

            return {
                ...miniGameData,
                gameType: "roulette",
                isMiniGameActivated: true,
                autoTurnReconnectMovesTime: currentTurnCountTimer,
                isMiniGameSpinning: bonusWinningStats.isMiniRouletteSpinning,
                rouletteSpinRemaningTime: rouletteSpinRemaningTime,
                gameData: { 
                    roulettePrizeList: subGame.otherData.rouletteData, 
                    spinDetails: { 
                        totalSpins: bonusWinningStats.wofWinnings.wofSpins, 
                        playedSpins: bonusWinningStats.wofWinnings.playedSpins, 
                        currentSpinNumber: (bonusWinningStats.wofWinnings.playedSpins + 1), 
                        spinHistory: bonusWinningStats.history
                    } 
                }
            };
        }
    }

    return miniGameData;
}

/**
 * Processes tickets for Game5
 * @param {Array} tickets - Array of ticket objects
 * @param {string} hallName - The hall name
 * @returns {Object} - Object containing ticketData and ticketIds
 */
function processTickets(tickets, hallName) {
    const ticketData = [];
    const ticketIds = [];

    for (const ticket of tickets) {
        ticketData.push({
            id: ticket._id,
            ticket: ticket.tickets,
            color: ticket.ticketColorName,
            price: ticket.ticketPrice,
            ticketId: ticket.ticketId,
            hallName: hallName,
            supplierName: ticket.supplier,
            developerName: ticket.developer
        });
        
        if (ticket._id) {
            ticketIds.push(ticket._id.toString());
        }
    }

    return { ticketData, ticketIds };
}

/**
 * Creates a new subgame for a game
 * @param {Object} params - Parameters for creating a new subgame
 * @param {Object} params.data - The player data
 * @param {Object} params.gameData - The game data
 * @param {Object} params.player - The player object
 * @param {Object} params.playerGroupHall - The player group hall
 * @param {boolean} params.isBotGame - Whether this is a bot game
 * @param {Object} params.GameServices - The Game service to use for saving
 * @returns {Promise<Object>} - The created subgame object
 */
async function createNewSubgame({
    data,
    gameData,
    player,
    isBotGame,
    GameServices
}) {
    try {
        const ID = Date.now();
        const createID = formatDateTime(ID);

        const subGameObj = {
            gameType: data.gameType || "game_5",
            parentGameId: gameData._id,
            gameNumber: createID + '_G5',
            totalEarning: 0,
            allPatternArray: gameData.otherData.allPatternArray,
            player: { id: data.playerId, username: player.username },
            groupHalls: player.groupHall,
            halls: [{id: player.hall.id, name: player.hall.name}],
            seconds: gameData.seconds,
            withdrawableBalls: gameData.otherData.withdrawableBalls,
            startDate: Date.now(),
            createdAt: Date.now(),
            'otherData.isBotGame': isBotGame === true,
            'otherData.isBotGameStarted': false
        };

        return await GameServices.insertSubgameData(subGameObj);
    } catch (error) {
        console.error('Error in createNewSubgame:', error);
        throw error;
    }
}

/**
 * Sets up ticket booking for a game
 * @param {Object} params - Parameters for setting up ticket booking
 * @param {Object} params.subGameData - The subgame data
 * @param {Object} params.gameData - The game data
 * @param {Object} params.player - The player object
 * @param {Object} params.playerGroupHall - The player group hall
 * @param {Object} params.data - The player data
 * @returns {Promise<void>}
 */
async function setupTicketBooking({
    subGameData,
    gameData,
    player,
    data
}) {
    try {
        const userType = player.userType === "Unique" || player.userType === "Bot" 
            ? player.userType 
            : "Online";
        
        const sendData = {
            slug: data.gameType || "game_5",
            ticketSize: Number(gameData.totalNoTickets),
            gameId: subGameData._id,
            playerId: data.playerId,
            userType: userType,
            uniquePlayerId: (userType === "Online") ? '' : player.uniqueId,
            isAgentTicket: (player.userType === "Unique" && player.isCreatedByAdmin === false),
            agentId: player.agentId,
            hallName: player.hall.name,
            groupHallName: player.groupHall.name,
            hallId: player.hall.id,
            groupHallId: player.groupHall.id,
            playerName: player.username,
            gameName: subGameData.gameNumber,
            purchaseType: "realMoney"
        };

        await Sys.Helper.bingo.ticketBook(sendData);
    } catch (error) {
        console.error('Error in setupTicketBooking:', error);
        throw error;
    }
}

async function generateRandomTicket(count, max) {
    const numbers = new Set();
    while (numbers.size < count) {
        numbers.add(Math.floor(fortuna.random() * max) + 1);
    }
    return Array.from(numbers);
}

/**
 * Process player tickets for Game5
 * Validates tickets, checks pricing, and prepares updates
 * 
 * @param {Object} params - The parameters object
 * @param {Array} params.playerPurTickets - Player's purchased tickets data
 * @param {Array} params.tickets - Available tickets from database
 * @param {string} params.playerLanguage - Player's language for error messages
 * @param {Object} params.createErrorResponse - Function to create standardized error responses
 * @returns {Object} Object containing bulkUpdateData, soldTicketIds, totalAmount and gameStartDate, or error response
 */
async function purchaseProcessTickets({
    playerPurTickets,
    gameId,
    playerLanguage,
}) {
    try {
        const bulkupdateTicketData = [];
        const soldTicketIds = [];
        let totalAmountOfTickets = 0;
        const gameStartDate = new Date();

        const tickets = await Sys.Game.Game5.Services.GameServices.getTicketsByData({ gameId }, {ticketPrice: 1});
        
        // Process tickets efficiently
        for (const ticket of tickets) {
            const purchasedTicket = playerPurTickets.find(e => e.id === ticket._id.toString());
            
            if (!purchasedTicket) {
                return {
                    error: await createErrorResponse("invalid_ticket_id", playerLanguage, 400)
                };
            }
            
            const ticketPrice = purchasedTicket.price;
            
            if (ticketPrice > 50) {
                return {
                    error: await createErrorResponse("max_ticket_bet", playerLanguage, 400)
                };
            }
            
            if (ticketPrice > 0) {
                totalAmountOfTickets += ticketPrice;
                bulkupdateTicketData.push({
                    updateOne: {
                        "filter": { _id: ticket._id },
                        "update": { 
                            $set: { 
                                ticketPrice, 
                                isPurchased: true, 
                                createdAt: gameStartDate, 
                                gameStartDate 
                            }
                        }
                    }
                });
                soldTicketIds.push(ticket._id.toString());
            }
        }

        // Check minimum bet amount
        if (totalAmountOfTickets <= 0) {
            return {
                error: await createErrorResponse("min_ticket_bet", playerLanguage, 400)
            };
        }
        
        return {
            bulkupdateTicketData,
            soldTicketIds,
            totalAmountOfTickets,
            gameStartDate
        };
    } catch (error) {
        console.error("Error in purchaseProcessTickets helper:", error);
        return {
            error: await createErrorResponse("something_went_wrong", playerLanguage, 500)
        };
    }
}

/**
 * Generates a random ticket price for Game5
 * Uses fortuna for secure random number generation
 * 
 * @param {number} min - Minimum price value (default: 1)
 * @param {number} max - Maximum price value (default: 50)
 * @returns {number} - Random price value between min and max (inclusive)
 */
function generateRandomTicketPrice(min = 1, max = 50) {
    // Generate random price between min and max (inclusive)
    return Math.floor(fortuna.random() * (max - min + 1)) + min;
}

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

function getBallColor(ball) {
    if (ball <= 9) return 'blue';
    if (ball <= 18) return 'red';
    if (ball <= 27) return 'purple';
    return 'green';
}

/**
 * Sends winning notification for Game5 (pattern wins or roulette wins)
 * @param {Object} params - Notification parameters
 * @param {string} params.playerId - ID of the player
 * @param {string} params.gameId - ID of the game
 * @param {number} params.gameNumber - Game number
 * @param {number} params.totalWonAmount - Total amount won
 * @param {string} params.firebaseToken - Player's firebase token
 * @param {string} params.notificationType - Type of notification ('pattern' or 'roulette')
 * @param {Array} [params.winningMultiplier] - Array of winning multipliers (only for pattern wins)
 */
async function sendGameNotification({ 
    playerId, 
    gameId, 
    gameNumber, 
    totalWonAmount, 
    firebaseToken,
    notificationType = 'pattern',
    winningMultiplier = []
}) {
    try {
        // Determine the notification key based on type
        const notificationKey = notificationType === 'roulette' 
            ? "game5_roulette_winning" 
            : "game5_winning";
        
        // Build translation parameters
        const translationParams = {
            key: notificationKey,
            isDynamic: true,
            number: gameNumber,
            number1: +parseFloat(totalWonAmount).toFixed(2),
            //number2: ''  // Default empty string
        };
        
        // Add multiplier info for pattern wins
        if (notificationType === 'pattern' && winningMultiplier.length > 0) {
            translationParams.number2 = winningMultiplier.join();
        }
        
        // Get translated messages
        const notiMessage = {
            en: await translate({
                ...translationParams,
                language: 'en'
            }),
            nor: await translate({
                ...translationParams,
                language: 'nor'
            })
        };

        // Prepare notification document
        const bulkArr = [{
            insertOne: {
                document: {
                    playerId,
                    gameId,
                    notification: {
                        notificationType: 'winning',
                        message: notiMessage
                    }
                }
            }
        }];

        // Send push notification if firebase token exists
        // if (firebaseToken) {
        //     const message = {
        //         notification: {
        //             title: "Spillorama",
        //             body: notiMessage
        //         },
        //         token: firebaseToken
        //     };
            
        //     // Use setImmediate for non-blocking operation
        //     setImmediate(() => Sys.Helper.gameHelper.sendWinnersNotifications(message));
        // }

        // Save notifications in database (non-blocking)
        Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
        
        return true;
    } catch (error) {
        console.error("Error sending game notifications:", error);
        return false;
    }
}

/**
 * Selects a number based on a probability distribution
 * @param {Object} probability - An object where keys are the possible outcomes and values are their probabilities in percentage
 * @returns {string} The selected outcome (key from the probability object)
 * 
 * Example usage:
 * selectNumberWithProbablility({ "red": 70, "black": 28, "green": 2 }) 
 * - Returns "red" 70% of the time, "black" 28% of the time, and "green" 2% of the time
 */
function selectNumberWithProbablility(probability) {
    // Generate a random number between 0 and 100
    const randomNumber = fortuna.random() * 100;
    let prob = 0;
    
    // Iterate through each outcome in the probability object
    for (const n in probability) {
        // Add the current outcome's probability to the running total
        prob += probability[n];
        //console.log("prob and random", prob, randomNumber)
        
        // If the random number is less than the cumulative probability,
        // select this outcome and return it
        if (randomNumber < prob) {
            return n;
        }
    }
}

/**
     * Determines the roulette outcome including winning ball and amount
     * @param {Array} rouletteData - Array of roulette balls with color and number
     * @param {number} ticketPrice - Price of the ticket
     * @returns {Object} - Object containing roulette ball and winnings
*/
async function determineRouletteOutcome(rouletteData, ticketPrice) {
    try {
        // Sort balls by color
        const redBalls = [], blackBalls = [], greenBalls = [];
        for (const ball of rouletteData) {
            if (ball.color === "red") redBalls.push(ball.number);
            else if (ball.color === "black") blackBalls.push(ball.number);
            else if (ball.color === "green") greenBalls.push(ball.number);
        }
        
        // Select color based on probability
        const selectedColor = selectNumberWithProbablility({ "red": 70, "black": 28, "green": 2 });
        
        // Determine winning ball and amount
        let ball, winnings;
        
        // Use a mapping object to avoid repetitive if-else statements
        const colorConfig = {
            red: { balls: redBalls, multiplier: 2 },
            black: { balls: blackBalls, multiplier: 4 },
            green: { balls: greenBalls, multiplier: 50 }
        };
        
        // Get the configuration for the selected color
        const config = colorConfig[selectedColor];
        
        // Select a random ball from the appropriate color array
        ball = config.balls[Math.floor(fortuna.random() * config.balls.length)];
        
        // Calculate winnings based on the multiplier for this color
        winnings = Math.round(exactMath.mul(ticketPrice, config.multiplier));
        
        return { rouletteBall: ball, rouletteWinnings: winnings };
    } catch (error) {
        console.log("Error in determineRouletteOutcome:", error);
        // Return default values in case of error
        return { rouletteBall: 0, rouletteWinnings: 0 };
    }
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

function cleanTimeAndData(timerKey, dataKey) {
    try {
        if (Timeout.exists(timerKey)) {
            Timeout.clear(timerKey, erase = true);
        }

        // Clean up Redis data if dataKey is provided
        if (dataKey) {
            redis.del(`game5:${dataKey}`);
        }
    
    } catch (error) {
        console.log("Error in cleanTimeAndData:", error);
    }
}

// Game process helper functions

// Load tickets for a game into Redis
async function loadTicketsToRedis(gameId) {
    try {
        // Get all purchased tickets for this game from MongoDB
        const tickets = await Sys.Game.Game5.Services.GameServices.getTicketsByData(
            { gameId: gameId }, 
            { tickets: 1, ticketColorName: 1, ticketPrice: 1, ticketId: 1, supplier: 1, developer: 1, isPurchased: 1 }
        );
        
        if (!tickets || tickets.length === 0) {
            return false;
        }
        
        // Adding more information to each ticket to ensure it's properly formatted
        const now = Date.now(); // Avoid multiple Date.now() calls
        const savePromises = tickets.map(ticket => {
            const ticketId = ticket._id ? ticket._id.toString() : `ticket-${now}-${Math.random().toString(36).substring(2, 9)}`;
            const enhancedTicket = {
                ...ticket,
                _id: ticketId,
                gameId,
                isPurchased: ticket.isPurchased,
                lastUpdated: now,
                ticketNumber: parseInt(ticket.ticketId.replace(/[^\d]/g, ''), 10)
            };

            return saveTicketToRedis(gameId, ticketId, enhancedTicket);
        });
        await Promise.all(savePromises);

        return true;
    } catch (error) {
        console.error("Error loading tickets to Redis:", error);
        return false;
    }
}

// Process tickets to determine winners - Redis only
async function processWinningTickets(gameId, withdrawnNumbers, winningPatterns, tickets) {
    try {
    
        // If no winning patterns provided, try to get them from Redis
        if (!winningPatterns || winningPatterns.length === 0) {
            console.log("No winning patterns provided");
            return;
        }
        
        // Create a Set of withdrawn numbers for fast O(1) lookups
        const withdrawnNumbersSet = new Set(withdrawnNumbers);
        
        // Store the current timestamp to avoid multiple Date.now() calls
        const currentTimestamp = Date.now();
        
        // Base bonus winning stats for all winning tickets
        const baseUpdateDoc = {
            isPlayerWon: true,
            'bonusWinningStats': {
                isMiniWofGamePlayed: false,
                isMiniWofActivated: false,
                miniWofGamestartTimeMs: currentTimestamp,
                isMiniWofFinished: false,
                isMiniGamePlayed: false,
                wofWinnings: {},
                history: [],
                finalWonAmount: 0,
                miniGameStatus: "Active",
                isMiniRouletteActivated: false,
                miniRouletteGamestartTimeMs: currentTimestamp,
                isMiniRouletteFinished: false,
                isMiniRouletteTimerRunning: false,
                isMiniRouletteSpinning: false,
                miniRouletteGameFinishTimeMs: currentTimestamp
            }
        };

        // Check each ticket against patterns
        for (const ticketData of tickets) {
            const ticket = ticketData.tickets;
            
            // Find winning pattern
            for (const pattern of winningPatterns) {
                let patternWon = true;
                
                if (pattern.patternElement.length > 0) {
                    for (let w = 0; w < pattern.pattern.length; w++) {
                        if (pattern.pattern[w] === 1 && !withdrawnNumbersSet.has(ticket[w])) {
                            patternWon = false;
                            break;
                        }
                    }
                } else {
                    patternWon = !ticket.some(num => withdrawnNumbersSet.has(num));
                }
               
                if (patternWon) {
                    const wonAmount = Math.round(exactMath.mul(ticketData.ticketPrice, pattern.multiplier));
                
                    // Create ticket updates object
                    // Create optimized ticket updates with direct property assignment
                    const ticketUpdates = {
                        ...baseUpdateDoc,
                        totalWinningOfTicket: wonAmount,
                        winningStats: {
                            patternWon: pattern,
                            finalWonAmount: wonAmount
                        }
                    };
                    
                    // Merge ticket data efficiently and save to Redis in one operation
                    await saveTicketToRedis(
                        gameId, 
                        ticketData._id.toString(), 
                        { ...ticketData, ...ticketUpdates }
                    );

                    break; // Found winning pattern, no need to check more patterns
                }
            }
        }
        return { };
    } catch (error) {
        console.log(`Error processing winning tickets: ${error.message}`, error);
        return { winners: [], ticketMatchers: [] };
    }
}

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
async function saveGameDataToRedis(gameType, gameId, gameData, ttl = 3600, subType = '') {
    return await RedisHelper.saveData(gameType, gameId, gameData, ttl, subType);
}


/**
 * Get ticket data from Redis
 * @param {string} gameId - Game ID
 * @param {string} ticketId - Ticket ID
 * @returns {Promise<Object|null>} - Ticket data or null if not found
 */
async function getTicketFromRedis(gameId, ticketId) {
    try {
        // Use consistent format with spillorama_ prefix
        const key = `game5_tickets:${gameId}_${ticketId}`;
        
        const data = await redis.get(key);
        
        if (!data) {
            return null;
        }
        
        try {
            const parsed = JSON.parse(data);
            return parsed;
        } catch (parseError) {
            console.error(`Error parsing ticket data: ${parseError.message}`);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching ticket from Redis: ${error.message}`, error);
        return null;
    }
}

/**
 * Get all tickets for a game from Redis
 * @param {string} gameId - Game ID
 * @returns {Promise<Array>} - Array of ticket data or empty array if none found
 */
async function getTicketFromRedisByGameId(gameId, isPurchased = true) {
    const prefix = redis.options.keyPrefix || '';
    const matchPattern = `${prefix}game5_tickets:${gameId}_*`;
    const tickets = [];
    let cursor = '0';
    try {
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', matchPattern, 'COUNT', 1000);
            cursor = nextCursor;

            if (!keys.length) continue;
           
            // Filter out minigame_active keys
            const filteredKeys = keys.filter(key => !key.includes('_minigame_active'));
            
            if (!filteredKeys.length) continue;
            // Use pipeline for batched GETs
            const pipeline = redis.pipeline();
            filteredKeys.forEach(key => pipeline.get(key));
            const results = await pipeline.exec();

            for (let i = 0; i < results.length; i++) {
                const [err, value] = results[i];
                if (err || !value) {
                    if (err) console.error(`Error fetching key ${filteredKeys[i]}: ${err.message}`);
                    continue;
                }

                try {
                    const parsed = JSON.parse(value);
                    if (parsed && typeof parsed === 'object') {
                        if (!isPurchased || parsed.isPurchased === true) {
                            tickets.push(parsed);
                        }
                    }
                } catch (parseErr) {
                    console.error(`JSON parse error for key ${filteredKeys[i]}: ${parseErr.message}`);
                }
            }
        } while (cursor !== '0');
        // Sort tickets by ticketNumber (already numeric)
        tickets.sort((a, b) => a.ticketNumber - b.ticketNumber);
        return tickets;

    } catch (error) {
        console.error('Error retrieving tickets from Redis:', error);
        return [];
    }
}

/**
 * Save ticket data to Redis
 * @param {string} gameId - Game ID
 * @param {string} ticketId - Ticket ID
 * @param {Object} ticketData - Ticket data to save
 * @param {number} [ttl=3600] - Time to live in seconds
 * @returns {Promise<boolean>} - Success status
 */
async function saveTicketToRedis(gameId, ticketId, ticketData, ttl = 3600) {
    try {
        // Ensure we have valid data
        if (!ticketData) {
            console.error("Cannot save null/undefined ticket data");
            return false;
        }
        
        // Stringify the data once
        const serializedData = JSON.stringify(ticketData);
        
        // Use consistent key format with spillorama_ prefix
        const standardKey = `game5_tickets:${gameId}_${ticketId}`;
        
        // Save with TTL
        if (ttl) {
            await redis.setex(standardKey, ttl, serializedData);
        } else {
            await redis.set(standardKey, serializedData);
        }
        
        return true;
    } catch (error) {
        console.error(`Error saving ticket to Redis: ${error.message}`, error);
        return false;
    }
}

// Delete data from Redis by type and id
async function deleteRedisDataByTypeAndId(type, id, subType = '') {
    await RedisHelper.deleteData(type, id, subType);
}

/**
 * Updates a nested field atomically only if it meets a specific condition
 * @param {string} prefix - Redis key prefix
 * @param {string} key - Redis key suffix
 * @param {string} fieldPath - Nested field path (dot notation)
 * @param {object} options - Operation options
 * @param {string} options.condition - Type of condition ('eq', 'neq', 'lt', 'gt', 'lte', 'gte', 'falsy', 'truthy')
 * @param {any} options.expectedValue - Value to compare against (for conditions that need it)
 * @param {any} options.newValue - Value to set if condition is met
 * @param {number} options.incrementBy - Amount to increment by (if using increment operation)
 * @returns {Promise<object>} Result of the operation
 */
// In gamehelper/redis.js
async function updateNestedFieldConditionally(prefix, key, fieldPath, options = {}) {
    try {
      const redisKey = `${prefix}:${key}`;
      const { 
        condition = 'eq', 
        expectedValue = null, 
        newValue = null,
        incrementBy = null 
      } = options;
      
      // Convert values to strings for Lua
      const strExpectedValue = expectedValue !== null ? 
        (typeof expectedValue === 'boolean' ? expectedValue.toString() : expectedValue) : 'nil';
      
      const strNewValue = newValue !== null ? 
        (typeof newValue === 'boolean' ? newValue.toString() : newValue) : 'nil';
      
      const strIncrementBy = incrementBy !== null ? incrementBy.toString() : 'nil';
      
      // Lua script for atomic conditional update - with fixed return format
      const luaScript = `
        local data = redis.call('GET', KEYS[1])
        if not data then 
          return "KEY_NOT_FOUND" 
        end
        
        local obj = cjson.decode(data)
        local fieldParts = {}
        for part in string.gmatch(ARGV[1], "[^.]+") do
          table.insert(fieldParts, part)
        end
        
        -- Navigate to the nested object
        local current = obj
        for i=1, #fieldParts-1 do
          if not current[fieldParts[i]] then
            current[fieldParts[i]] = {}
          end
          current = current[fieldParts[i]]
        end
        
        local lastField = fieldParts[#fieldParts]
        local currentValue = current[lastField]
        
        -- Convert values for comparison
        local convertedCurrentValue = currentValue
        local convertedExpectedValue = ARGV[3]
        
        -- Try to convert to numbers if possible
        if type(currentValue) == "number" or tonumber(currentValue) ~= nil then
          convertedCurrentValue = tonumber(currentValue) or 0
        end
        if tonumber(ARGV[3]) ~= nil then
          convertedExpectedValue = tonumber(ARGV[3])
        end
        
        -- Check condition
        local condition = ARGV[2]
        local conditionMet = false
        
        if condition == "eq" then
          conditionMet = convertedCurrentValue == convertedExpectedValue
        elseif condition == "neq" then
          conditionMet = convertedCurrentValue ~= convertedExpectedValue
        elseif condition == "lt" then
          conditionMet = convertedCurrentValue < convertedExpectedValue
        elseif condition == "gt" then
          conditionMet = convertedCurrentValue > convertedExpectedValue
        elseif condition == "lte" then
          conditionMet = convertedCurrentValue <= convertedExpectedValue
        elseif condition == "gte" then
          conditionMet = convertedCurrentValue >= convertedExpectedValue
        elseif condition == "falsy" then
          conditionMet = not currentValue
        elseif condition == "truthy" then
          conditionMet = currentValue
        elseif condition == "null" or condition == "nil" then
          conditionMet = currentValue == nil
        elseif condition == "notnull" or condition == "notnil" then
          conditionMet = currentValue ~= nil
        else
          return "INVALID_CONDITION"
        end
        
        if not conditionMet then
          return "CONDITION_NOT_MET"
        end
        
        -- Update the value based on the operation
        if ARGV[5] ~= "nil" then
          -- Increment operation
          current[lastField] = (tonumber(currentValue) or 0) + tonumber(ARGV[5])
        elseif ARGV[4] ~= "nil" then
          -- Set operation
          if ARGV[4] == "true" then
            current[lastField] = true
          elseif ARGV[4] == "false" then
            current[lastField] = false
          elseif tonumber(ARGV[4]) ~= nil then
            current[lastField] = tonumber(ARGV[4])
          else
            current[lastField] = ARGV[4]
          end
        end
        
        -- Save the updated object
        redis.call('SET', KEYS[1], cjson.encode(obj))
        return "SUCCESS"
      `;
      
      // Execute the Lua script
      const result = await redis.eval(
        luaScript,
        1,                // Number of keys
        redisKey,         // KEYS[1]
        fieldPath,        // ARGV[1] - The nested field path
        condition,        // ARGV[2] - The condition type
        strExpectedValue, // ARGV[3] - The expected value to compare against
        strNewValue,      // ARGV[4] - The new value to set
        strIncrementBy    // ARGV[5] - The increment value
      );
      
      // Process the result string
      if (result === "SUCCESS") {
        return { status: true };
      } else if (result === "CONDITION_NOT_MET") {
        return { status: false, reason: "CONDITION_NOT_MET" };
      } else if (result === "KEY_NOT_FOUND") {
        return { status: false, reason: "KEY_NOT_FOUND" };
      } else if (result === "INVALID_CONDITION") {
        return { status: false, reason: "INVALID_CONDITION" };
      } else {
        return { status: false, reason: "UNKNOWN_ERROR" };
      }
    } catch (error) {
      console.error("Error in RedisHelper.updateNestedFieldConditionally:", error);
      return { status: false, reason: "ERROR", error: error.message };
    }
}

/**
 * Sync all game and ticket data from Redis to MongoDB when game finishes
 * @param {string} gameId - Game ID to sync
 * @returns {Promise<boolean>} - Success status
 */
async function syncGameToMongoDB(gameId, isDeleteData = false) {
    try {
        // Get game data from Redis
        const gameData = await getGameDataFromRedis('game5', gameId);
    
        if (!gameData) {
            console.log('No game data in Redis to sync for game:', gameId);
            return false;
        }
        
        // Get all tickets from Redis
        const tickets = await getTicketFromRedisByGameId(gameId);
        
        // Prepare operations for atomic batch processing
        const operations = [];
        
        // 1. Update game in MongoDB
        operations.push(
            Sys.Game.Game5.Services.GameServices.updateSubgame(
                { _id: gameId },
                { $set: { ...gameData } }
            )
        );
        
        // 2. Update all tickets in MongoDB if there are any
        if (tickets && tickets.length > 0) {
            const bulkTicketOps = tickets.map(ticket => ({
                updateOne: {
                    filter: { _id: ticket._id },
                    update: { $set: ticket }
                }
            }));
            
            operations.push(
                Sys.Game.Game5.Services.GameServices.bulkWriteTickets(bulkTicketOps)
            );
        }
        
        // Execute all operations in parallel
        await Promise.all(operations);
        
        if(isDeleteData){
             // Clean up Redis data
            await RedisHelper.deleteData('game5', gameId);
            // Delete all ticket keys
            const ticketKeys = await redis.keys(`game5_tickets:${gameId}_*`);
          
            if (ticketKeys && ticketKeys.length > 0) {
                await redis.del(...ticketKeys);
            }
        }
        return true;
    } catch (error) {
        console.error('Error syncing game to MongoDB:', error);
        // Critical error - attempt emergency save to prevent data loss
        try {
            // Try to save at least the game data
            const gameData = await getGameDataFromRedis('game5', gameId);
            if (gameData) {
                await Sys.Game.Game5.Services.GameServices.updateSubgame({ _id: gameId }, { $set: gameData });
            }
        } catch (emergencyError) {
            console.error('Emergency save failed:', emergencyError);
        }
        return false;
    }
}


// Helper function to get updates from Redis for MongoDB sync with pending status
// async function getRedisUpdatesForSync(gameType, gameId) {
//     // Get game data from Redis
//     const gameData = await RedisHelper.getData(gameType, gameId);
   
//     // Initialize empty pending updates object
//     const pendingUpdates = {};
     
//     // If no Redis data, return empty updates
//     if (!gameData) {
//         return { pendingUpdates, gameData: null };
//     }

//     // Process pending updates if they exist
//     if (gameData.pendingDbUpdates) {
//         // Copy all pending fields from Redis to pendingUpdates
//         Object.keys(gameData.pendingDbUpdates).forEach(field => {
//             if (gameData.pendingDbUpdates[field] === true) {
//                 pendingUpdates[field] = gameData[field];
//             }
//         });
        
//         // Clear pending updates in Redis
//         gameData.pendingDbUpdates = {};
//     }

//     // Update Redis with cleared pendingDbUpdates and updated state
//     await RedisHelper.saveData('game5', gameId, gameData, 3600);
    
//     return { pendingUpdates, gameData };
// }


// async function findSingleTicketByQueryFromRedis(gameId, query = {}, projectionFields = null) {
//     const pattern = `${redis.options.keyPrefix || ''}game5_tickets:${gameId}_*`;
//     let cursor = '0';

//     try {
//         do {
//             const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
//             cursor = nextCursor;

//             if (!keys.length) continue;

//             const pipeline = redis.pipeline();
//             keys.forEach(key => pipeline.get(key));
//             const results = await pipeline.exec();

//             for (const [err, raw] of results) {
//                 if (err || !raw) continue;

//                 try {
//                     const ticket = JSON.parse(raw);

//                     // MongoDB-style query matching
//                     if (Object.entries(query).every(([key, value]) => {
//                         if (value.$in) return value.$in.includes(ticket[key]);
//                         return ticket[key] === value;
//                     })) {
//                         if (projectionFields) {
//                             return projectionFields.reduce((result, field) => {
//                                 result[field] = field.split('.').reduce((o, k) => o?.[k], ticket);
//                                 return result;
//                             }, {});
//                         }
//                         return ticket;
//                     }

//                 } catch (e) {
//                     console.error(`Error parsing ticket:`, e.message);
//                 }
//             }
//         } while (cursor !== '0');

//         return null;

//     } catch (error) {
//         console.error('Redis scan error:', error);
//         return null;
//     }
// }

// Export all helper functions
module.exports = {
    processMiniGameData,
    processTickets,
    createNewSubgame,
    setupTicketBooking,
    generateRandomTicket,
    purchaseProcessTickets,
    generateRandomTicketPrice,
    getAvailableBalls,
    getRandomBall,
    getBallColor,
    sendGameNotification,
    selectNumberWithProbablility,
    determineRouletteOutcome,
    setGameTimer,
    cleanTimeAndData,
    loadTicketsToRedis,
    processWinningTickets,
    getGameDataFromRedis,
    saveGameDataToRedis,
    getTicketFromRedis,
    getTicketFromRedisByGameId,
    saveTicketToRedis,
    deleteRedisDataByTypeAndId,
    updateNestedFieldConditionally,
    syncGameToMongoDB,
    //getRedisUpdatesForSync,
    //findSingleTicketByQueryFromRedis,
}; 
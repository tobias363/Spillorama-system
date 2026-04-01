const Sys = require('../Boot/Sys');
const moment = require('moment');
const { translate } = require('../Config/i18n');
const fs = require('fs').promises;
const path = require('path');
const redis = require('../Config/Redis');
const { v4: uuidv4 } = require("uuid");
const axios = require('axios');
/**
 * Validates and processes a user's profile picture
 * @param {string} photo - Base64 encoded image data or null
 * @returns {string} - Path to the saved profile picture or default image
 * @throws {Error} - If the image is invalid
 */
const validateUserProfilePic = async (photo) => {
    if (!photo) return '/assets/profilePic/gameUser.jpg';
    const id = await randomString(24);
    const pic = await picSave(id, photo);

    if (pic instanceof Error) {
        throw new Error('file_invalid');
    }
    return pic;
};

/**
 * Generates a random string of specified length
 * @param {number} length - Length of the random string to generate
 * @returns {string} - Random string containing alphanumeric characters
 */
const randomString = async (length) => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const charsLength = chars.length;
    let result = '';

    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * charsLength));
    }

    return result;
};

/**
 * Saves an image file from base64 data
 * @param {string} id - Unique identifier for the image
 * @param {string} imagedata - Base64 encoded image data
 * @returns {string|Error} - Path to saved image or Error object if save fails
 * 
 * Supported image formats:
 * - JPG (starts with '/')
 * - PNG (starts with 'i')
 * - GIF (starts with 'R')
 * - PDF (starts with 'J')
 */
const picSave = async (id, imagedata) => {
    try {
        const extMap = {
            '/': 'jpg',
            'i': 'png',
            'R': 'gif',
            'J': 'pdf'
        };

        const extension = extMap[imagedata.charAt(0)] || 'null';
        if (['pdf', 'gif', 'null'].includes(extension)) {
            throw new Error("Photo Save Issue");
        }

        const imgData = imagedata.replace(/^imgData:img\/\w+;base64,/, '');
        const buf = Buffer.from(imgData, 'base64');

        const folder = path.join(__dirname, '..', 'public', 'assets', 'profilePic');
        await fs.mkdir(folder, { recursive: true });

        const filename = `${id}_${Math.floor(100000 + Math.random() * 900000)}.${extension}`;
        const filepath = path.join(folder, filename);

        await fs.writeFile(filepath, buf);
        console.log('Photo saved successfully:', filename);

        return `/assets/profilePic/${filename}`;
    } catch (err) {
        console.error("Error in picSave:", err);
        return new Error("Photo Save Issue");
    }
};


/**
 * Processes and validates player hall assignment
 */
const processPlayerHall = async (player, hallId, hallBasedIp) => {
    try {
        let currentHall = {};
        let currentGroupHall = {};

        if (player.hall && player.hall.status !== undefined) {
            if (player.hall.status === "Rejected") {
                return {
                    success: false,
                    error: {
                        key: "request_rejected",
                        isDynamic: true,
                        numbers: { number: "xyz@gmail.com" }
                    }
                };
            }
            
            if (player.hall.status === "Pending") {
                return {
                    success: false,
                    error: {
                        key: "request_sent"
                    }
                };
            }
        }

        // If hall found based on IP and matches requested hallId
        if (hallBasedIp && hallId === hallBasedIp.id) {
            const approvedPlayerHalls = player.approvedHalls || [];
            const isHallFound = approvedPlayerHalls.find(hall => hall.id === hallBasedIp.id);

            if (!isHallFound) {
                // Create new hall assignment
                currentHall = {
                    id: hallBasedIp.id,
                    name: hallBasedIp.name,
                    status: "Approved",
                    groupHall: hallBasedIp.groupHall,
                };

                // Update player's approved halls
                await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer(
                    {
                        _id: player._id,
                        approvedHalls: {
                            $not: {
                                $elemMatch: {
                                    $or: [
                                        { id: currentHall.id },
                                        { name: currentHall.name }
                                    ]
                                }
                            }
                        }
                    },
                    {
                        $push: { approvedHalls: currentHall }
                    }
                );

                currentGroupHall = currentHall.groupHall;
            } else {
                currentHall = {
                    id: isHallFound.id,
                    name: isHallFound.name,
                    status: "Approved"
                };
                currentGroupHall = isHallFound.groupHall;
            }
        } else {
            // Check if player has access to requested hall
            const approvedPlayerHalls = player.approvedHalls || [];
            const isHallFound = approvedPlayerHalls.find(hall => hall.id === hallId);

            if (!isHallFound) {
                return { success: false, error: { key: "player_not_found_in_hall" } };
            }

            currentHall = {
                id: isHallFound.id,
                name: isHallFound.name,
                status: "Approved"
            };
            currentGroupHall = isHallFound.groupHall;
        }

        return { 
            success: true, 
            hall: currentHall, 
            groupHall: currentGroupHall 
        };
    } catch (error) {
        console.error('Error in processPlayerHall:', error);
        return { success: false, error: { key: "player_not_found_in_hall" } };
    }
}

/**
 * Handles daily attendance reward for player
 */
const handleDailyAttendance = async (player) => {
    if (player.isDailyAttendance) return;

    try {
        // Update player's daily attendance status
        await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer(
            { _id: player._id },
            { isDailyAttendance: true }
        );

        // Get daily attendance loyalty data
        const dataSlug = await Sys.App.Services.LoyaltyService.getByDataLoyalty(
            { slug: "dailyAttendance" }
        );

        if (dataSlug.length > 0) {
            const transactionData = {
                playerId: player._id,
                loyaltyId: dataSlug[0]._id,
                transactionSlug: "loyalty",
                action: "credit",
                purchasedSlug: "points",
                totalAmount: dataSlug[0].points,
            };

            await Sys.Helper.gameHelper.createTransactionPlayer(transactionData);
        }
    } catch (error) {
        console.error('Error in handleDailyAttendance:', error);
    }
}

/**
 * Handles player break time updates
 */
const handlePlayerLoginBreakTime = async (player) => {
    try {
        const currentTime = moment(new Date());
        await Sys.Game.Game2.Services.PlayerServices.updateSinglePlayer(
            { 
                _id: player.id,
                endBreakTime: { 
                    $ne: null,
                    $exists: true,
                    $lte: currentTime 
                }
            },
            {
                $set: {
                    startBreakTime: '',
                    endBreakTime: ''
                }
            }
        );
    } catch (error) {
        console.error('Error in handlePlayerBreakTime:', error);
    }
}

// get player block rules to show which rules are already set and which are available to set in settings page of application
const playerBlockRules = async function(data){
    try {
        const { allHalls = [], playerBlockRules = [] } = data;
        const allGameTypes = [
            { name: "Web", subTypes: [] },
            { name: "DataBingo", subTypes: ["Metronia", "Ok Bingo", "Franco", "Otium"] },
            { name: "Spilorama", subTypes: [] },
            { name: "Everything", subTypes: [] }
        ];
        const availableOptions = getAvailableOptionsPerHall(allHalls, allGameTypes, playerBlockRules);
        return availableOptions;
    } catch (e) {
        Sys.Log.info('Error in getting player block rules : ' + e);
        return [];
    }
}

// get available options with existing rules per hall
function getAvailableOptionsPerHall(allHalls, allGameTypes, playerBlockRules) {
    try {
        const blockedMap = {};
    
        // Step 1: Group blocked gameTypes by hall
        for (const { hallId, gameTypes } of playerBlockRules) {
            if (!blockedMap[hallId]) blockedMap[hallId] = {};
    
            for (const { name, subTypes } of gameTypes) {
                if (!blockedMap[hallId][name]) blockedMap[hallId][name] = new Set();
        
                for (const sub of subTypes || []) {
                    blockedMap[hallId][name].add(sub);
                }
            }
        }
    
        const result = [];
    
        // Step 2: For each hall, calculate available options
        for (const hallId of allHalls) {
            const blocked = blockedMap[hallId] || {};

            // Skip this hall if 'Everything' is already blocked
            const hasEverythingBlocked = blocked["Everything"];
            if (hasEverythingBlocked) {
                continue;
            }

            const gameTypes = [];
    
            for (const { name, subTypes } of allGameTypes) {
                if (name === "Everything") continue; // Skip here, handle separately below
                const blockedSubs = blocked[name] || new Set();
        
                if (!subTypes || subTypes.length === 0) {
                    if (!blocked[name]) {
                        gameTypes.push({ name, subTypes: [] });
                    }
                } else {
                    const remainingSubs = subTypes.filter(sub => !blockedSubs.has(sub));
                    if (remainingSubs.length > 0) {
                        gameTypes.push({ name, subTypes: remainingSubs });
                    }
                }
            }
    
            // Step 3: Handle 'Everything' inclusion logic
            const webSubs = allGameTypes.find(g => g.name === "Web")?.subTypes || [];
            const webBlocked = blocked["Web"] || new Set();
            const isWebBlocked = webSubs.length > 0
            ? webSubs.every(sub => webBlocked.has(sub))
            : !!blocked["Web"];
    
            const spiloramaSubs = allGameTypes.find(g => g.name === "Spilorama")?.subTypes || [];
            const spiloramaBlocked = blocked["Spilorama"] || new Set();
            const isSpiloramaBlocked = spiloramaSubs.length > 0
            ? spiloramaSubs.every(sub => spiloramaBlocked.has(sub))
            : !!blocked["Spilorama"];
    
            const dataBingoSubs = allGameTypes.find(g => g.name === "DataBingo")?.subTypes || [];
            const dataBingoBlocked = blocked["DataBingo"] || new Set();
            const isAllDataBingoBlocked = dataBingoSubs.every(sub => dataBingoBlocked.has(sub));
    
            const everythingGame = allGameTypes.find(g => g.name === "Everything");
            if (everythingGame && !(isWebBlocked && isSpiloramaBlocked && isAllDataBingoBlocked)) {
                gameTypes.push({ name: "Everything", subTypes: [] });
            }
    
            if (gameTypes.length > 0) {
                result.push({ hallId, gameTypes, days: [1,7,30,90,180,365] });
            }
        }
    
        return result;
    } catch (err) {
        console.error("Error in getAvailableOptionsPerHall:", err);
        return {};
    }
}

// add or update block rule
async function addOrUpdateBlockRule(blockRules = [], allHalls = [], newRules = []) {
    try {
        const rules = Array.isArray(newRules) ? newRules : [newRules];
        let updatedBlockRules = [...(blockRules || [])];
        let updated = false;

        for (const newRule of rules) {
            const { hallId, gameTypes = [], days } = newRule;

            if (!allHalls.includes(hallId)) {
                console.warn(`Skipped rule for hall '${hallId}' because it's not approved.`);
                continue;
            }

            const startDate = moment().startOf('day').toDate();
            const endDate = moment(startDate).add(days - 1, 'days').endOf('day').toDate();
            
            const isEverythingRule = gameTypes.some(gt => gt.name === 'Everything');

            const existingRulesForHall = updatedBlockRules.filter(r => r.hallId === hallId);

            const alreadyHasEverything = existingRulesForHall.some(
                r => r.gameTypes?.some(gt => gt.name === 'Everything')
            );

            // Prevent adding any rule if 'Everything' already exists for this hall
            if (alreadyHasEverything) {
                console.warn(`Skipped rule for '${hallId}' because 'Everything' already exists.`);
                continue;
            }

            if (isEverythingRule) {
                // Remove all rules for the same hall where days < newRule.days
                const rulesToRemove = updatedBlockRules.filter(
                    r => r.hallId === hallId && moment(r.endDate).isSameOrBefore(endDate, 'day')
                );
                  
                if (rulesToRemove.length > 0) {
                    updatedBlockRules = updatedBlockRules.filter(
                      r => !(r.hallId === hallId && moment(r.endDate).isSameOrBefore(endDate, 'day'))
                    );
                    updated = true;
                }

                // Check if exact same Everything rule already exists
                const sameDateEverythingExists = existingRulesForHall.some(
                    r => r.hallId === hallId &&
                    moment(r.endDate).isSame(endDate, 'day') &&
                    r.gameTypes?.some(gt => gt.name === 'Everything')
                );
                  
                if (sameDateEverythingExists) {
                    console.warn(`Skipped adding 'Everything' again for '${hallId}' with same endDate.`);
                    continue;
                }

                // Add the new Everything rule
                updatedBlockRules.push({
                    hallId,
                    days,
                    startDate,
                    endDate,
                    gameTypes: [{ name: "Everything", subTypes: [] }]
                });
                updated = true;
                continue;
            }

            // Regular gametype logic
            const existingRule = updatedBlockRules.find(
                r => r.hallId === hallId && moment(r.endDate).isSame(endDate, 'day')
            );

            if (existingRule) {
                for (const newGT of gameTypes) {
                    const { name, subTypes = [] } = newGT;
                    const cleanedSubs = subTypes.map(s => s.trim());

                    const existingGT = existingRule.gameTypes.find(gt => gt.name === name);
                    console.log("existingGT", existingGT)
                    if (existingGT) {
                        const currentSubs = new Set(existingGT.subTypes || []);
                        const beforeSize = currentSubs.size;

                        cleanedSubs.forEach(sub => currentSubs.add(sub));
                        if (currentSubs.size !== beforeSize) {
                            existingGT.subTypes = Array.from(currentSubs).sort();
                            updated = true;
                        }
                    } else {
                        console.log("new gameType for this rule")
                        existingRule.gameTypes.push({
                            name,
                            subTypes: cleanedSubs.sort()
                        });
                        updated = true;
                        console.log("updated", updated, updatedBlockRules)
                    }
                }
            } else {
                // New rule block
                const cleanedGameTypes = gameTypes.map(gt => ({
                    name: gt.name,
                    subTypes: (gt.subTypes || []).map(s => s.trim()).sort()
                }));
                updatedBlockRules.push({
                    hallId,
                    days,
                    startDate,
                    endDate,
                    gameTypes: cleanedGameTypes
                });
                updated = true;
            }
        }

        return updated ? updatedBlockRules : null;

    } catch (err) {
        console.error("Error in addOrUpdateBlockRule:", err);
        throw err;
    }
}

// helper function to get all existing and available block rules
const getExistingAndAvailableBlockRules = async (allHalls = [], blockRules = []) => {
    try {
        // Step 1: Fetch hallId → hallName mapping
        // const halls = await Sys.Game.Common.Services.GameServices.getHallData(
        //     { _id: { $in: allHalls } }, { _id: 1, name: 1 }
        // );
        // const hallMap = new Map();
        // halls.forEach(h => hallMap.set(h._id.toString(), h.name));

        // Step 1: Try to fetch hall map from Redis
        let hallMap = new Map();
        let hallCache = await redis.get('spilo_all_halls');

        if (hallCache) {
            const parsed = JSON.parse(hallCache);  // { hallId: { name, ip, number }, ... }
            hallMap = new Map(Object.entries(parsed)); // each value is an object
        } else {
            // Not in cache, fetch from DB and store in Redis
            const halls = await Sys.Game.Common.Services.GameServices.getHallData(
                {}, { _id: 1, name: 1, ip: 1,number: 1 }
            );
            const hallObj = {}; // to store in Redis
            halls.forEach(h => {
                const id = h._id.toString();
                const hallInfo = { name: h.name, ip: h.ip, number: h.number };
                hallMap.set(id, hallInfo);
                hallObj[id] = hallInfo;
            });
            await redis.set('spilo_all_halls', JSON.stringify(hallObj), 'EX', 86400); // Cache for 1 dayawait redis.set('spilo_all_halls', JSON.stringify(hallObj), 'EX', 86400); // cache for 1 day
        }
        
        // Step 2: Get available options (will be array of { hallId, gameTypes, days })
        const availableBlockOptionsRaw = await playerBlockRules({ allHalls, playerBlockRules: blockRules });

        const availableBlockOptions = availableBlockOptionsRaw.map(option => ({
            ...option,
            hallName: (hallMap.get(option.hallId)?.name) || ''
        }));

        // Step 3: Get existing block rules
        const existingBlockRules = blockRules?.map(rule => ({
            hallId: rule.hallId,
            hallName: (hallMap.get(rule.hallId)?.name) || '',
            gameTypes: rule.gameTypes.map(gt => ({
                name: gt.name,
                subTypes: gt.subTypes || []
            })),
            days: [rule.days],  // wrap number into array
            endDate: rule.endDate,
            ruleId: rule._id
        }));
        return { availableBlockOptions, existingBlockRules };
    }catch(err){
        console.error("Error in getExistingAndAvailableBlockRules:", err);
        throw err;
    }
}

// Function will be used to check if a player is blocked from a game or slot on frontend to restrict user for playing game or slot
async function isPlayerBlockedFromGame(data) {
    const { hallId, playerIp, gameType, blockRules = [] } = data;
    try {
        const now = moment();

        const currentHall = await Sys.Game.Common.Services.GameServices.getSingleHallByData({ _id: hallId }, {ip: 1, name: 1});
        if (!currentHall) return false;

        const hallIp = currentHall.ip;

        // Determine playing context: Web(Offline) or Spillorama(Online)
        const isWebPlay = !playerIp || playerIp !== currentHall.ip;

        // Get relevant block rules for this hall and date
        const activeRules = blockRules.filter(rule =>
            rule.hallId === hallId &&
            moment(rule.endDate).isSameOrAfter(now)
        );
        console.log("activeRules-", activeRules)
        
        for (const { gameTypes = [] } of activeRules) {
            for (const { name, subTypes = [] } of gameTypes) {
                // Everything blocks everything
                if (name === 'Everything') return true;

                // Block if Web and rule is Web
                if (name === 'Web' && isWebPlay && gameType === 'game') return true;

                // Block if Spilorama and rule is Spilorama
                if (name === 'Spilorama' && !isWebPlay && gameType === 'game') return true;

                // Block if DataBingo and gameType is one of its sub types
                const isSlotGame = ['Metronia', 'Ok Bingo', 'Franco', 'Otium'].includes(gameType);
                if (name === 'DataBingo' && isSlotGame && subTypes.length > 0 && subTypes.includes(gameType) ) {
                    return true;
                }
            }
        }

        return false; // No rule matched
    } catch (err) {
        console.error('Error checking player block status:', err);
        return false; // On error, allow game by default
    }
}

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

// generate random order number
async function generateUniqueOrderNum() {
    const sortableId = `${moment().format("YYYYMMDDHHmmssSSS")}`; // 17 digits
    const random = Math.floor(Math.random() * 1e10).toString().padStart(10, "0"); // 10 random digits
    return (sortableId + random).substring(0, 30); // max 30 chars
}

// Offline deposit for online players
const handleOfflineDeposit = async (player, data, orderNumber, socket) => {
    try {
        // Destructure variables at the top for better readability and performance
        const {
            _id: playerId,
            username: playerName,
            hall: { id: hallId, name: hallName },
            customerNumber,
            walletAmount,
            selectedLanguage
        } = player;

        const { amount, operation } = data;
        const currencyCode = Sys.Config.App[Sys.Config.Database.connectionType].verifonePayment.currencyCode;
        const timestamp = Date.now();
        const randomNum = Math.floor(100000 + Math.random() * 900000);

        // Fetch hall data
        const hallsData = await Sys.App.Services.HallServices.getSingleHallData(
            { _id: hallId }, 
            { groupHall: 1 }
        );

        // Prepare deposit transaction data
        const depositTxData = {
            playerId,
            playerName,
            orderNumber,
            amount: +amount,
            CurrencyCode: currencyCode,
            status: "pending",
            createdAt: timestamp,
            operation: "Offline",
            hallId,
            hallName,
            customerNumber,
            walletAmount: Number(walletAmount?.toFixed(2) || 0)
        };

        // Create deposit transaction
        const depositTx = await Sys.App.Services.depositMoneyServices.insertData(depositTxData);
        
        // Emit admin notification
        Sys.Io.of('admin').to(hallId).emit('widthdarwRequest', { data: 1 });

        // Generate transaction ID efficiently
        const transactionId = `TRN${await Sys.Helper.bingo.ordNumFunction(timestamp)}${randomNum}`;
        
        // Prepare transaction point data
        const transactionPointData = {
            transactionId,
            playerId,
            playerName,
            category: "credit",
            status: "pending",
            amtCategory: "realMoney",
            defineSlug: "extraTransaction",
            typeOfTransaction: "Deposit By Pay in Hall",
            typeOfTransactionTotalAmount: +amount,
            depositType: { 
                type: operation, 
                paymentBy: "", 
                depositId: depositTx._id, 
                orderNumber 
            },
            hallId,
            createdAt: timestamp,
            groupHall: hallsData.groupHall,
            hall: {
                id: hallId,
                name: hallName
            }
        };

        // Create transaction
        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);

        return {
            status: "offline-success",
            result: null,
            message: await translate({ key: "deposit_success_hall", language: selectedLanguage }),
        };
    } catch (error) {
        console.log("Error in handleOfflineDeposit:", error);
        throw error;
    }
};

// Helper function for online deposit operation by swedbankpay
const handleOnlineDeposit = async (player, data, orderNumber, amount, socket) => {
        // Destructure player data once for better performance
        const {
            _id: playerId,
            username: playerName,
            hall: { id: hallId, name: hallName },
            customerNumber,
            walletAmount,
            selectedLanguage
        } = player;

        const { os, userAgentData } = data;
    try {
        // Pre-calculate common values
        const timestamp = Date.now();
        const expiryDate = moment().add(1, 'days');  //add(30, 'minutes');
        const paymentLanguage = selectedLanguage === "en" ? "en-US" : "nb-NO";
        
        // Environment variables validation and caching
        const config = {
            payeeId: process.env.SWEDBANKPAY_PAYEE_ID,
            payeeName: process.env.SWEDBANKPAY_PAYEE_NAME,
            token: process.env.SWEDBANKPAY_TOKEN,
            currencyCode: process.env.SWEDBANKPAY_PAYMENT_CURRENCY_CODE || 'NOK',
            apiUrl: process.env.SWEDBANKPAY_PAYMENT_API_URL,
            hostUrls: JSON.parse(process.env.SWEDBANKPAY_HOST_URLS),
            paymentUrl: process.env.SWEDBANKPAY_PAYMENT_URL,
            completeUrl: process.env.SWEDBANKPAY_COMPLETE_URL,
            cancelUrl: process.env.SWEDBANKPAY_CANCEL_URL,
            callbackUrl: process.env.SWEDBANKPAY_CALLBACK_URL,
            termsOfServiceUrl: process.env.SWEDBANKPAY_TERMS_OF_SERVICE_URL,
        };

        // Validate required environment variables
        const requiredEnvVars = ['payeeId', 'payeeName', 'token', 'apiUrl'];
        const missingVars = requiredEnvVars.filter(key => !config[key]);
        if (missingVars.length > 0) {
            console.error('Missing required environment variables:', missingVars);
            return createErrorResponse("something_went_wrong", selectedLanguage);
        }

        let userAgent = userAgentData;
        if(!userAgent) {
            if(os === "android") {
                userAgent = "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.140 Mobile Safari/537.36"
            }else {
                userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
            }
        }

        // Prepare payment request body
        const requestBody = {
            paymentorder: {
                operation: 'Purchase',
                currency: config.currencyCode,
                amount: amount,
                vatAmount: 0,
                description: `OrderNo: ${orderNumber}`,
                userAgent,
                language: paymentLanguage,
                urls: {
                    termsOfServiceUrl: config.termsOfServiceUrl,
                    hostUrls: config.hostUrls,
                    paymentUrl: `${config.paymentUrl}/${orderNumber}`,
                    completeUrl: `${config.completeUrl}?order_number=${orderNumber}`,
                    //cancelUrl: `${config.cancelUrl}?order_number=${orderNumber}`,
                    callbackUrl: `${config.callbackUrl}?order_number=${orderNumber}`
                },
                payeeInfo: {
                    payeeId: config.payeeId,
                    payeeReference: orderNumber,
                    payeeName: config.payeeName,
                    orderReference: orderNumber
                },
                restrictedToInstruments: [
                    "CreditCard",
                    "Vipps",
                    //"Swish",
                    //"Trustly"
                ]

            }
        };
        
        // Make payment request with timeout
        const response = await axios.post(`${config.apiUrl}/psp/paymentorders`, requestBody, {
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': 'application/json;version=3.1'
            },
            timeout: 30000 // 30 second timeout
        });

        //console.log("Swedbank Pay response:", response.data);
        if (
            ![200, 201].includes(response.status) ||
            !response.data?.paymentOrder?.id ||
            !response.data?.operations?.find(op => op.rel === 'view-checkout')?.href
        ) {
            console.error("Invalid API response:", response?.data);
            return createErrorResponse("something_went_wrong", selectedLanguage);
        }
        
        const paymentOrder = response.data?.paymentOrder;
        const viewCheckout = response.data?.operations.find(op => op.rel === 'view-checkout');
        
        const checkoutID = paymentOrder?.id ? paymentOrder.id.split("/").pop() : null;
        // Create deposit record
        const depositData = {
            playerId,
            playerName,
            orderNumber,
            amount: +(amount/100),
            CurrencyCode: config.currencyCode,
            checkoutID,
            customerId: paymentOrder?.payeeInfo?.id,
            responseSource: viewCheckout?.href,
            status: "pending",
            createdAt: timestamp,
            expiryDate: expiryDate,
            operation: "Online",
            hallId,
            hallName,
            issuerId: os,
            'otherData.webglRefreshBroadcastCount': 0,
            'otherData.paymentOrderId': paymentOrder?.id,
            updatedAt: timestamp,
            customerNumber,
            walletAmount: Number(walletAmount?.toFixed(2) || 0)
        };

        await Sys.App.Services.depositMoneyServices.insertData(depositData);

        // Generate iframe URL
        const iframeUrl = `${Sys.Config.App[Sys.Config.Database.connectionType].url}payment/iframe/${orderNumber}`;
        console.log("Generated iframe URL:", iframeUrl);
        
        return {
            status: "success",
            result: iframeUrl,
            message: "Please proceed to pay."
        };
       
    } catch (error) {
        console.log("Error in handleOnlineDeposit:", JSON.stringify(error.response?.data?.problems));
        console.error("Error in handleOnlineDeposit:", {
            message: error.message,
            response: error.response?.data,
            details: error.response?.data?.details,
            stack: error.stack
        });
        
        return createErrorResponse("something_went_wrong", selectedLanguage);
    }
};

// swedbankHelper.js
async function verifyAndCaptureSwedbankPayment({checkout_path, transaction, player, isWebhook}) {
    try {
        const paymentResponse = await getSwedbankPaymentStatus({
            checkout_path
        });

        console.log("paymentResponse of verifyAndCaptureSwedbankPayment", paymentResponse);

        if (!paymentResponse?.paymentOrder) {
            return { status: "error", reason: "not_found" };
        }

        const { status, amount, remainingCaptureAmount, paid } = paymentResponse.paymentOrder;
        const operations = paymentResponse.operations ?? [];
        const checkoutID = transaction?.checkoutID;
        const updateTransaction = async (status, extra = {}) => {
            try {
                await Sys.App.Services.depositMoneyServices.updateData(
                    { _id: transaction._id, status: { $ne: "completed" } },
                    { status, ...extra }
                );
            } catch (dbErr) {
                console.error("DB update failed:", dbErr);
            }
        };

        switch (status) {
            case "Paid": {
                const captureUrl = operations.find(op => op.rel === "capture")?.href;
                const needsCapture = (
                    paid?.transactionType === "Authorization" &&
                    remainingCaptureAmount > 0 &&
                    captureUrl
                );

                if (needsCapture) { //isWebhook && 
                    try {
                        const payeeReferenceCheckout = await generateUniqueOrderNum(); //uuidv4();
                        const captureRes = await captureSwedbankPayment({
                            capture_url: captureUrl,
                            amount,
                            description: "Capturing the authorized payment",
                            payeeReferenceCheckout,
                            player,
                            transaction,
                            paymentBy: paid?.instrument
                        });

                        if (
                            captureRes.success &&
                            captureRes.data?.paymentOrder?.remainingReversalAmount === amount
                        ) {
                            return { status: "completed", details: captureRes.data };
                        }

                        return {
                            status: "pending",
                            reason: "capture_failed",
                            details: captureRes.error
                        };
                    } catch (capErr) {
                        console.error("Capture API error:", capErr);
                        return { status: "error", reason: "capture_exception", error: capErr.message };
                    }
                }

                if (isWebhook && paid?.transactionType === "Sale") {
                    const paymentBy = paid?.instrument;
                    const payeeReferenceCheckout = paid?.details;
                    addOnlineDepositMoneyTransaction(transaction, player, paymentBy, payeeReferenceCheckout);
                    //await updateTransaction("completed", { "otherData.details": paid?.details });
                    return { status: "completed" };
                }

                await Sys.App.Services.depositMoneyServices.updateData(
                    { _id: transaction._id, status: { $ne: "completed" } },
                    { 'otherData.isExecuted': true }
                );
                console.log("needsCapture, isWebhook, paid?.transactionType", needsCapture, isWebhook, paid?.transactionType)
                addOnlinePaymentPendingTransaction({player, amount: transaction?.amount, checkoutID})
                return { status: "pending" };
                //return { status: "completed" };
            }

            case "Failed":
                await updateTransaction("failed", {
                    transactionID: checkoutID,
                    paymentBy: paid?.instrument
                });
                return { status: "failed" };

            case "Aborted":
                await updateTransaction("aborted");
                return { status: "aborted" };

            case "Cancelled":
                await updateTransaction("cancelled");
                return { status: "cancelled" };

            default:
                await Sys.App.Services.depositMoneyServices.updateData(
                    { _id: transaction._id, status: { $ne: "completed" } },
                    { 'otherData.isExecuted': true }
                );
                addOnlinePaymentPendingTransaction({player, amount: transaction?.amount, checkoutID})
                return { status: "pending" };
        }
    } catch (err) {
        console.error("verifyAndCaptureSwedbankPayment error:", err);
        return { status: "error", reason: "exception", error: err.message };
    }
}

/**
 * Get payment order status from Swedbank Pay
 * @param {string} checkoutId - Payment order ID
 * @returns {Promise<{status: string, message: string, data?: object}>}
 */
const getSwedbankPaymentStatus = async ({checkout_path}) => {
  try {
    if (!checkout_path) throw new Error("Missing checkout_path");

    const url = `${process.env.SWEDBANKPAY_PAYMENT_API_URL}${checkout_path}?$expand=paid`;
    console.log("url", url);
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.SWEDBANKPAY_TOKEN}`,
        "Content-Type": "application/json;version=3.1", // or 2.0 if needed
      },
      timeout: 10000, // 10 seconds
    });

    return response.data;
  } catch (err) {
    console.log("err", err);
    console.error("Error in getSwedbankPaymentStatus:", err.message || err);
    throw err;
  }
}

/**
 * Capture a payment order (Authorization -> Capture)
 * @param {string} paymentOrderId - The paymentOrderId (GUID from create payment)
 * @param {number} amount - Amount to capture (in minor units, e.g., 100 = 1.00 NOK)
 * @param {string} vatAmount - VAT amount (optional, defaults to 0)
 * @param {string} description - Optional description for capture
 * @returns {Promise<Object>} Swedbank capture response
 */
async function captureSwedbankPayment({ capture_url, amount, vatAmount = 0, description = "Capture", payeeReferenceCheckout, player, transaction, paymentBy }) {
    try {
        const body = {
            transaction: {
                amount,
                vatAmount,
                description,
                payeeReference: payeeReferenceCheckout,
                receiptReference: payeeReferenceCheckout
            }
        };
        
        const response = await axios.post(capture_url, body, {
            headers: {
                Authorization: `Bearer ${process.env.SWEDBANKPAY_TOKEN}`,
                "Content-Type": "application/json;version=3.1"
            }
        });

        console.log("captureSwedbankPayment after response", response.data);
        console.log("amount of captureSwedbankPayment and response.data?.paymentOrder?.remainingReversalAmount", amount, response.data?.paymentOrder?.remainingReversalAmount);
        if (response.data?.paymentOrder?.remainingReversalAmount === amount) {
            //const paymentBy = response.data?.paymentOrder?.paid?.instrument;
            addOnlineDepositMoneyTransaction(transaction, player, paymentBy, payeeReferenceCheckout);
        }

        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        console.error("Swedbank Capture Error:", error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

const addOnlineDepositMoneyTransaction = async (transaction, player, paymentBy, payeeReferenceCheckout) => {
    try {
        console.log("transaction of addOnlineDepositMoneyTransaction", transaction, paymentBy);
        const { checkoutID, amount } = transaction;
        let updateTx = await Sys.App.Services.depositMoneyServices.updateData({ _id: transaction._id, status: { $ne: "completed" }, checkoutID }, {
            status: "completed",
            transactionID: checkoutID,
            paymentBy,
            'otherData.capturePayeeReference': payeeReferenceCheckout,
            updatedAt: Date.now(),
        });
        console.log("updateTx of addOnlineDepositMoneyTransaction---", updateTx);
        if (updateTx && updateTx.modifiedCount == 0) {
            console.log("Transaction is already completed, so no need to check again from webhook.");
            return { status: "completed" };
        } else {
            await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: transaction.playerId }, { $inc: { walletAmount: amount } });

            // check if pending transaction is already available, if available update the status otherwise add tx
            const filter = {
                playerId: player._id,
                //status: "pending",
                typeOfTransactionTotalAmount: amount,
                'depositType.depositId': checkoutID
            };
            const existingTransaction = await Sys.Game.Common.Services.PlayerServices.getSingleTransactionByData(filter, {status: 1});
            if (existingTransaction) {
                // Update existing pending transaction
                console.log("Found existing pending transaction, updating...");
                
                await Sys.Game.Common.Services.PlayerServices.updateByData(
                    filter,{ $set: { status: "success", updatedAt: Date.now() } }, { new: false }
                );
                
            }else{
                let transactionPointData = {
                    transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    playerId: player._id,
                    hallId: player.hall.id,
                    defineSlug: "extraTransaction",
                    typeOfTransaction: "Deposit",
                    category: "credit",
                    status: "success",
                    typeOfTransactionTotalAmount: amount,
                    amtCategory: "realMoney",
                    depositType: { type: "Online", depositId: checkoutID },
                    createdAt: Date.now(),
                }
                await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
            }

            return { status: "completed" };
        }
    } catch (dbErr) {
        console.error("DB update failed:", dbErr);
    }
}

async function addOnlinePaymentPendingTransaction({ player, amount, checkoutID }) {
    try {
        console.log("called addOnlinePaymentPendingTransaction");
        // check if pending transaction is already available, if available update the status otherwise add tx
        const filter = {
            playerId: player._id,
            //status: "pending",
            typeOfTransactionTotalAmount: amount,
            'depositType.depositId': checkoutID
        };
        const existingTransaction = await Sys.Game.Common.Services.PlayerServices.getSingleTransactionByData(filter, {status: 1});
        console.log("existingTransaction of addOnlinePaymentPendingTransaction----", existingTransaction)
        if (!existingTransaction) {
            let transactionPointData = {
                transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                playerId: player._id,
                hallId: player.hall.id,
                defineSlug: "extraTransaction",
                typeOfTransaction: "Deposit",
                category: "credit",
                status: "pending",
                typeOfTransactionTotalAmount: amount,
                amtCategory: "realMoney",
                depositType: { type: "Online", depositId: checkoutID },
                createdAt: Date.now(),
            }
            await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
        }
        return true;
    } catch (error) {
        console.error("Swedbank add pending tx Error:", error.response?.data || error.message);
    }
}



module.exports = {
   validateUserProfilePic,
   randomString,
   picSave,
   processPlayerHall,
   handleDailyAttendance,
   handlePlayerLoginBreakTime,
   playerBlockRules,
   addOrUpdateBlockRule,
   getExistingAndAvailableBlockRules,
   isPlayerBlockedFromGame,
   generateUniqueOrderNum,
   handleOfflineDeposit,
   handleOnlineDeposit,
   verifyAndCaptureSwedbankPayment
};
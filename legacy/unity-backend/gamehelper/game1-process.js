/**
 * Game1 Helper Functions
 * Contains reusable helper functions specific to Game1 operations
 */

const Sys = require('../Boot/Sys');
const moment = require('moment');
const { getSingleTraslateData } = require('../Helper/bingo');
const { translate } = require('../Config/i18n');
const exactMath = require('exact-math');
const { updatePlayerHallSpendingData, saveGameDataToRedisHmset, getGameDataFromRedisHmset } = require('./all');

const sendWinnersScreenToAdmin = async (gameId, roomName, winnerArray, withdrawNumberCount, isMinigamePlayed, sendBroadcast) => {
    try {
        if (shouldSendWinnersToAdmin(roomName, winnerArray) || isMinigamePlayed) {
            console.log("Send winners screen after the full house and before the minigames");
            return await broadcastAdminResults(winnerArray, gameId, withdrawNumberCount, sendBroadcast);
        }
        return [];
    } catch (error) {
        console.error("Error in sendWinnersScreenToAdmin:", error);
    }
}

//check if we need to send this to adming at this point or after the minigame completed
const shouldSendWinnersToAdmin = (roomName, winners) => {
    try {
        // if (roomName === "Wheel of Fortune") {
        //     let found = false;
        //     for (const w of winners) {
        //         if (w.lineType === "Full House") {
        //             found = true;
        //             if (w.userType !== "Physical") return false;
        //         }
        //     }
        //     return found;
        // }
        return !["Treasure Chest", "Mystery", "Color Draft", "Wheel of Fortune"].includes(roomName);
    } catch (error) {
        console.error("Error in shouldSendWinnersToAdmin:", error);
        return false;
    }
}

const broadcastAdminResults = async (winnerArray, gameId, totalWithdrawCount, sendBroadcast) => {
    try{
        let winnerAdminResultArray = [...winnerArray.reduce( (mp, o) => {
            if (!mp.has(o.lineType)) mp.set(o.lineType, { ...o, count: 0, finalWonAmount: 0, playerIdArray:[], halls: [] });
            mp.get(o.lineType).count++;
            mp.get(o.lineType).finalWonAmount= Math.round(mp.get(o.lineType).finalWonAmount + +o.wonAmount); //+parseFloat(mp.get(o.lineType).finalWonAmount + +o.wonAmount).toFixed(4) ;
            mp.get(o.lineType).playerIdArray.push({playerId: o.playerId, userType: o.userType, hallName: o.hallName, ticketNumber: o.ticketNumber, playerName: o.playerName, wonAmount: +o.wonAmount  });
            if (!mp.get(o.lineType).halls.includes(o.hallName)) {
                mp.get(o.lineType).halls.push(o.hallName);
            }
            return mp;
        }, new Map).values()];
        const fullHouseWinners = winnerAdminResultArray.reduce((sum, w) => sum + (w.isFullHouse ? w.count : 0), 0);
        
        winnerAdminResultArray = winnerAdminResultArray.map(({lineType, finalWonAmount, playerIdArray, count, halls})  => ({lineType, finalWonAmount, playerIdArray, count, halls}));
        
        // Add minigame winners to the winnerAdminResultArray
        const winnerAdminResultArrayWithMinigame = {
            totalWithdrawCount: totalWithdrawCount,
            fullHouseWinners,
            patternsWon: winnerAdminResultArray.length,
            winners: winnerAdminResultArray
        }
        console.log("winnerAdminResultArray---", winnerAdminResultArray, winnerArray)
        await Promise.all([
            Sys.Game.Game1.Services.GameServices.updateGame(
                { _id: gameId },
                { $set: { 'otherData.winnerAdminResultArray': winnerAdminResultArray } }
            ),
            sendBroadcast && Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('GameFinishAdmin', winnerAdminResultArrayWithMinigame)
        ]);

        return winnerAdminResultArrayWithMinigame;
    }catch(e){
        console.log("Error processing broadcastAdminResults")
    }
}

function validateAddressData(data) {
    if (!data) return { error: 'Address data is required' };

    const isTrue = v => v === true || v === 'true';
    const isFalse = v => v === false || v === 'false';
    const isEmpty = v => v == null || v.trim?.() === '';

    const { isResidentialAddressInNorway, city, zipCode, address, country, incomeSources } = data;

    if (!isTrue(isResidentialAddressInNorway) && !isFalse(isResidentialAddressInNorway))
        return { error: 'residential_address_required' };

    if (isTrue(isResidentialAddressInNorway)) {
        if (isEmpty(city)) return { error: 'city_required' };
        if (isEmpty(zipCode)) return { error: 'zip_code_required' };
        if (isEmpty(address)) return { error: 'address_required' };
    } else {
        if (isEmpty(country)) return { error: 'country_required' };
        if (!incomeSources || !Object.values(incomeSources).some(isTrue))
            return { error: 'income_source_required' };
    }

    return { 
        isValid: true,
        addressDetails: {
            residentialAddressInNorway: isTrue(isResidentialAddressInNorway),
            city: city,
            zipCode: zipCode,
            address: address,
            country: country,
            incomeSources: !isTrue(isResidentialAddressInNorway) ? {
                salary: isTrue(incomeSources?.playBySalary),
                propertySaleOrLease: isTrue(incomeSources?.playByPropertySaleOrLease),
                stocks: isTrue(incomeSources?.playByStocks),
                socialSupport: isTrue(incomeSources?.playBySocialSupport),
                giftsOrInheritance: isTrue(incomeSources?.playByGiftsOrInheritance),
                other: isTrue(incomeSources?.playByOther)
            } : undefined
        } 
    };
}

const countryNames = {
    getCountries() {
        return [
            'Other',
            'Afghanistan',
            'Albania',
            'Algeria',
            'Andorra',
            'Angola',
            'Antigua and Barbuda',
            'Argentina',
            'Armenia',
            'Australia',
            'Austria',
            'Azerbaijan',
            'Bahamas',
            'Bahrain',
            'Bangladesh',
            'Barbados',
            'Belarus',
            'Belgium',
            'Belize',
            'Benin',
            'Bhutan',
            'Bolivia',
            'Bosnia and Herzegovina',
            'Botswana',
            'Brazil',
            'Brunei',
            'Bulgaria',
            'Burkina Faso',
            'Burundi',
            'Cambodia',
            'Cameroon',
            'Canada',
            'Cape Verde',
            'Central African Republic',
            'Chad',
            'Chile',
            'China',
            'Colombia',
            'Comoros',
            'Congo',
            'Costa Rica',
            'Croatia',
            'Cuba',
            'Cyprus',
            'Czech Republic',
            'Denmark',
            'Djibouti',
            'Dominica',
            'Dominican Republic',
            'East Timor',
            'Ecuador',
            'Egypt',
            'El Salvador',
            'Equatorial Guinea',
            'Eritrea',
            'Estonia',
            'Ethiopia',
            'Fiji',
            'Finland',
            'France',
            'Gabon',
            'Gambia',
            'Georgia',
            'Germany',
            'Ghana',
            'Greece',
            'Grenada',
            'Guatemala',
            'Guinea',
            'Guinea-Bissau',
            'Guyana',
            'Haiti',
            'Honduras',
            'Hungary',
            'Iceland',
            'India',
            'Indonesia',
            'Iran',
            'Iraq',
            'Ireland',
            'Israel',
            'Italy',
            'Ivory Coast',
            'Jamaica',
            'Japan',
            'Jordan',
            'Kazakhstan',
            'Kenya',
            'Kiribati',
            'Korea, North',
            'Korea, South',
            'Kuwait',
            'Kyrgyzstan',
            'Laos',
            'Latvia',
            'Lebanon',
            'Lesotho',
            'Liberia',
            'Libya',
            'Liechtenstein',
            'Lithuania',
            'Luxembourg',
            'Macedonia',
            'Madagascar',
            'Malawi',
            'Malaysia',
            'Maldives',
            'Mali',
            'Malta',
            'Marshall Islands',
            'Mauritania',
            'Mauritius',
            'Mexico',
            'Micronesia',
            'Moldova',
            'Monaco',
            'Mongolia',
            'Montenegro',
            'Morocco',
            'Mozambique',
            'Myanmar',
            'Namibia',
            'Nauru',
            'Nepal',
            'Netherlands',
            'New Zealand',
            'Nicaragua',
            'Niger',
            'Nigeria',
            'Norway',
            'Oman',
            'Pakistan',
            'Palau',
            'Panama',
            'Papua New Guinea',
            'Paraguay',
            'Peru',
            'Philippines',
            'Poland',
            'Portugal',
            'Qatar',
            'Romania',
            'Russia',
            'Rwanda',
            'Saint Kitts and Nevis',
            'Saint Lucia',
            'Saint Vincent',
            'Samoa',
            'San Marino',
            'Sao Tome and Principe',
            'Saudi Arabia',
            'Senegal',
            'Serbia',
            'Seychelles',
            'Sierra Leone',
            'Singapore',
            'Slovakia',
            'Slovenia',
            'Solomon Islands',
            'Somalia',
            'South Africa',
            'Spain',
            'Sri Lanka',
            'Sudan',
            'Suriname',
            'Swaziland',
            'Sweden',
            'Switzerland',
            'Syria',
            'Taiwan',
            'Tajikistan',
            'Tanzania',
            'Thailand',
            'Togo',
            'Tonga',
            'Trinidad and Tobago',
            'Tunisia',
            'Turkey',
            'Turkmenistan',
            'Tuvalu',
            'Uganda',
            'Ukraine',
            'United Arab Emirates',
            'United Kingdom',
            'United States',
            'Uruguay',
            'Uzbekistan',
            'Vanuatu',
            'Vatican City',
            'Venezuela',
            'Vietnam',
            'Yemen',
            'Zambia',
            'Zimbabwe',
        ];
    }
};

const validateAndPauseGame = async (data) => {
    try {
        const { gameId, hallId, language } = data;

        const today = {
            $gte: moment().startOf('day').toDate(),
            $lt: moment().endOf('day').toDate()
        };

        const query = {
            _id: gameId,
            gameType: 'game_1',
            halls: { $in: [hallId] },
            stopGame: false,
            'otherData.isClosed': false,
            startDate: today,
            $or: [
                { status: "finish", "otherData.gameSecondaryStatus": "running" },
                { status: "running" },
                // { status: "active" }
            ],
        };

        const projection = { status: 1, 'otherData.isPaused': 1, players: 1, halls: 1, startDate: 1, gameNumber: 1, gameType: 1, gameName: 1, groupHalls: 1 };
        const runningGame = await Sys.App.Services.GameService.getSingleGameData(query, projection);

        if (!runningGame) {
            return { success: false, message: 'game_not_found', isTranslated: false };
        }

        const { status, otherData } = runningGame;

        if (status === "active") {
            return { success: false, message: 'you_can_only_stop_game_that_is_running', isTranslated: false };
        }

        if (status === "finish" && otherData?.gameSecondaryStatus === "finish") {
            return { success: false, message: 'game_already_finished', isTranslated: false };
        }

        if (otherData?.isPaused) {
            return { success: true, message: 'game_paused_successfully', game: runningGame, isTranslated: false };
        }

        const stopGameResponse = await Sys.Game.Game1.Controllers.GameProcess.stopGame(runningGame._id, language, false, true);

        return stopGameResponse?.status === "success"
            ? { success: true, message: 'game_paused_successfully', game: runningGame, isTranslated: false }
            : { success: false, message: stopGameResponse?.message || 'Something went wrong!', isTranslated: true };

    } catch (error) {
        console.error("Error in validateAndPauseGame:", error);
        return { success: false, message: 'something_went_wrong', isTranslated: false };
    }
};

const stopGameWithoutRefund = async (data) => {
    try {
        const validate = await validateAndPauseGame(data);
        if(validate.success){
           return { success: true, message: "game_stopped_without_refund_successfully" };
        } else {
            return { success: false, message: validate.message, isTranslated: validate.isTranslated };
        }
    } catch (error) {
        console.error("Error in stopGameWithoutRefund:", error);
        return { success: false, message: 'something_went_wrong' };
    }
}

const stopGameAndRefundAllHalls = async (data) => {
    try {
        const { gameId, hallId, language } = data;
        const validate = await validateAndPauseGame(data);
        if(validate.success){
            const refundResponse = await refundHallsAllPlayerTypes({gameId, hallId, language, isRefundAllHalls: true, refundHall: hallId, allAssignedHalls: validate?.game?.halls, gameStartDate: validate?.game?.startDate, gameNumber: validate?.game?.gameNumber, gameName: validate?.game?.gameName, gameType: validate?.game?.gameType, gameStatus: validate?.game?.status});
            if(refundResponse.success){
                return { success: true, message: "game_stopped_and_refunded_to_all_hall_players_successfully" };
            } else {
                return { success: false, message: refundResponse.message, isTranslated: false };
            }
        } else {
            return { success: false, message: validate.message, isTranslated: false };
        }
    } catch (error) {
        console.error("Error in stopGameAndRefundAllHalls:", error);
        return { success: false, message: 'something_went_wrong', isTranslated: false };
    }
}

const stopGameAndRefundSingleHalls = async (data) => {
    try {
        const { gameId, hallId, language, refundHallId } = data;
        const validate = await validateAndPauseGame(data);
       
        if(validate.success){
            if(validate?.game?.groupHalls){
                const allGroupHalls = validate.game.groupHalls;
                const isGameAlreadyStopped = allGroupHalls.some(item =>
                    item.selectedHalls.some(hall =>
                      hall.id === refundHallId && hall.status === 'stopped'
                    )
                );
                if(isGameAlreadyStopped){
                    return { success: false, message: "game_is_already_stopeed_for_the_selected_hall" };
                }
            }
            const refundResponse = await refundHallsAllPlayerTypes({gameId, hallId, language, isRefundAllHalls: false, refundHallId, allAssignedHalls: validate?.game?.halls, gameStartDate: validate?.game?.startDate, gameNumber: validate?.game?.gameNumber, gameName: validate?.game?.gameName, gameType: validate?.game?.gameType, gameStatus: validate?.game?.status});
            if(refundResponse.success){
                // Need to remove this hall and dont show this hall again in dropdown
                await Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: gameId },
                    { $set: {
                        "groupHalls.$[].selectedHalls.$[hall].status": "stopped"
                      } 
                    },
                    { arrayFilters:  [ { "hall.id": refundHallId } ] }
                );
                return { success: true, message: "game_stopped_and_refunded_to_hall_players_successfully" };
            } else {
                return { success: false, message: refundResponse.message, isTranslated: false };
            }
        } else {
            return { success: false, message: validate.message, isTranslated: false };
        }
    } catch (error) {
        console.error("Error in stopGameAndRefundSingleHalls:", error);
        return { success: false, message: 'something_went_wrong', isTranslated: false };
    }
}

// Refund online, physical players
const refundHallsAllPlayerTypes = async (data) => {
    try {
        const { isRefundAllHalls, gameId, allAssignedHalls, refundHallId, gameStatus } = data;
        if(isRefundAllHalls){
           const updatedGame = await Sys.App.Services.GameService.findOneAndUpdateGameData({ _id: gameId }, { $set: { "stopGame": true, status: "finish", "otherData.gameSecondaryStatus": "finish" } });
           refreshGameAfterRefund(updatedGame._id, updatedGame.halls);
        }
       // Run sequentially in background
       (async () => {
            try {
                if(isRefundAllHalls && gameStatus != "finish"){
                    await refundAllHallsOnlinePlayers(data);
                }
                await refundPhysicalTicket(data);
                refreshGameAfterRefund(gameId, allAssignedHalls);
            } catch (err) {
                console.error("Error in sequential refunding:", err);
            }
        })();
        return { success: true };
        //const success = onlineRes.success === true || physicalRes.success === true;
        //const result = { success, message: onlineRes?.message || physicalRes?.message };
        
    } catch (error) {
        console.error("Error in refundAllHalls:", error);
        return { success: false, message: 'something_went_wrong' };
    }
}

// Process single player refund, conditionally decide to refund if single or all halls
const refundAllHallsOnlinePlayers = async (data) => {
    try {
        const { gameId, isRefundAllHalls, refundHallId } = data;
    
        // Step 1: Fetch basic game data with only relevant fields
        const runningGame = await Sys.App.Services.GameService.getSingleGameData(
            { _id: gameId },
            { players: 1, gameNumber: 1, gameName: 1, halls: 1 }
        );
    
        const gamePlayers = runningGame?.players || [];
    
        // Step 2: Filter Online/Unique players and map them
        const gamePlayersMap = new Map();
        const playerIds = [];
    
        for (const player of gamePlayers) {
            if (player.userType === "Online" || player.userType === "Unique") {
                gamePlayersMap.set(player.id, player);
                playerIds.push(player.id);
            }
        }
    
        if (!playerIds.length) {
            return { success: true, message: 'refund_success' };
        }
  
        // Step 3: Fetch all required player details in one call
        const allPlayersDetails = await Sys.App.Services.PlayerServices.getAllPlayersData(
            { _id: { $in: playerIds } },
            { username: 1, selectedLanguage: 1, socketId: 1 }
        );
    
        // Step 4: Process each refund asynchronously
        const refundPromises = allPlayersDetails.map(async (player) => {
            const playerId = player._id.toString();
            const gamePlayerDetails = gamePlayersMap.get(playerId);
    
            try {
                if (isRefundAllHalls) {
                    if(gamePlayerDetails?.ticketPrice > 0 || gamePlayerDetails?.totalPurchasedTickets > 0){
                        return await refundOfAllHalls(data, player, gamePlayerDetails, runningGame);
                    }
                    return { success: true };
                }
        
                const isMultiHall = await checkplayerhasPurchasedMultiHallTickets({ gameId, playerId });
                const filteredTickets = isMultiHall.tickets.filter(t => t.hallId === refundHallId);
                console.log("isMultiHall", isMultiHall, filteredTickets);
                //if (isMultiHall.isMulti) {
                    if(filteredTickets.length > 0){
                        return await refundOfSpecificHall(data, player, gamePlayerDetails, runningGame, filteredTickets);
                    }
                //}
        
                // if (filteredTickets.length > 0) {
                //     return await refundOfAllHalls(data, player, gamePlayerDetails, runningGame);
                // }
        
                return { success: false, playerId, message: "No tickets to refund in this hall." };
            } catch (err) {
                console.error(`Refund error for player ${playerId}:`, err);
                return { success: false, playerId, error: err.message };
            }
        });
    
        // Step 5: Wait for all to settle
        const results = await Promise.allSettled(refundPromises);
    
        // Optional: Log or count results
        const summary = {
            success: results.filter(r => r.status === "fulfilled").length,
            failed: results.filter(r => r.status === "rejected").length
        };
        console.log("Refund Summary:", summary);
    
        return { success: true, message: 'refund_success', summary };
    } catch (error) {
        console.error("Error in refundAllHallsOnlinePlayers:", error);
        return { success: false, message: 'something_went_wrong' };
    }
};
 
// Process single player refund of all halls, Mail code that is previously used for refund
const refundOfAllHalls = async (data, player, gamePlayerDetails, runningGame) => {
    try {
        const { ticketPrice, totalPurchasedTickets, purchaseTicketTypes, purchasedSlug } = gamePlayerDetails;
        const { gameNumber, gameName, _id: runningGameId } = runningGame;
        const refundResponse = await refundWithNotifications({gameId: runningGameId, language: player.selectedLanguage, playerId: player._id, playerSocketId: player.socketId, gameNumber, gameName, ticketPrice, totalPurchasedTickets, purchasedSlug, isSubGameDbUpdate: true, purchaseTicketTypes, refundAllHalls: true, refundHallId: null });
        
        if(refundResponse.success){
            //refreshGameAfterRefund(runningGameId, runningGame.halls);
            return { success: true };
        } else {
            return { success: false, message: refundResponse.message };
        }
    } catch (error) {
        console.error("Error in refundOfAllHalls:", error);
        return { success: false, message: 'something_went_wrong' };
    }
};

// Process single player refund of specific hall
const refundOfSpecificHall = async (data, player, gamePlayerDetails, runningGame, tickets) => {
    try {
        const { refundHallId } = data;
        const { gameNumber, gameName, _id: runningGameId } = runningGame;
        const { ticketPrice, purchasedSlug } = await prepareTicketDeletionsForUpdate(runningGameId, player._id.toString(), tickets);
        if(ticketPrice > 0){
            const refundResponse = await refundWithNotifications({gameId: runningGameId, language: player.selectedLanguage, playerId: player._id, playerSocketId: player.socketId, gameNumber, gameName, ticketPrice, totalPurchasedTickets: tickets.length, purchasedSlug, isSubGameDbUpdate: false, purchaseTicketTypes: [], refundAllHalls: false, refundHallId });
            if(refundResponse.success){
                //refreshGameAfterRefund(runningGameId, [refundHallId]);
                return { success: true };
            } else {
                return { success: false, message: refundResponse.message };
            }
        }
        return { success: true };
    } catch (error) {
        console.error("Error in refundOfSpecificHall:", error);
    }
};

// check if the player has purchased tickets from multiple halls
const checkplayerhasPurchasedMultiHallTickets = async (data) => {
    try {
        const { gameId, playerId } = data;

        const tickets = await Sys.App.Services.GameService.getTicketsByData(
            { gameId, playerIdOfPurchaser: playerId, isPurchased: true },
            { _id: 1, ticketColorName: 1, hallId: 1, ticketColorType: 1, ticketPrice: 1, ticketPurchasedFrom: 1, userTicketType: 1 }
        );
       
        if (!tickets || tickets.length < 2) {
            return { isMulti: false, tickets };
        }

        const seenHalls = new Set();
        for (const ticket of tickets) {
            seenHalls.add(ticket.hallId);
            if (seenHalls.size > 1) {
                return { isMulti: true, tickets };
            }
        }

        return { isMulti: false, tickets };
    } catch (error) {
        console.error("Error in checkplayerhasPurchasedMultiHallTickets:", error);
        return { isMulti: false, tickets: [] };
    }
};

// process player refund with notifications
const refundWithNotifications = async (data) => {
    try {
        const { gameId, language, playerId, playerSocketId, gameNumber, gameName, ticketPrice, totalPurchasedTickets, purchasedSlug, isSubGameDbUpdate, purchaseTicketTypes, refundAllHalls, refundHallId } = data;
        console.log("data in refundWithNotifications", gameId, language, playerId, playerSocketId, gameNumber, gameName, ticketPrice, totalPurchasedTickets, purchasedSlug, isSubGameDbUpdate, purchaseTicketTypes, refundAllHalls, refundHallId, data);
        const playerIdString = playerId.toString();
        const gameIdString = gameId.toString();
        console.log("gameIdString", gameIdString);
        // 1. Remove player from game and update ticket stats
        let updateData = {
            $inc: {
                ticketSold: -totalPurchasedTickets,
                earnedFromTickets: -ticketPrice,
                finalGameProfitAmount: -ticketPrice
            }
        }
        if(refundAllHalls){
            updateData.$pull = { players: { id: playerIdString } };
        }else{
            updateData.$inc['players.$.ticketPrice'] = -ticketPrice;
            updateData.$inc['players.$.totalPurchasedTickets'] = -totalPurchasedTickets;
        }
        console.log("updateData", updateData);
        const updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
            { _id: gameId, 'players.id': playerIdString },
            updateData
        );

        if (!updateGame || updateGame instanceof Error) {
            console.log("Error removing player from game", playerIdString, gameIdString);
            return;
        }

        console.log("Refunding tickets for player", playerIdString);

        // 2. Refund user balance and log transaction
        const updateBalancePromise =
            purchasedSlug === "points"
                ? Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, { $inc: { points: ticketPrice } })
                : Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, {
                    $inc: {
                        walletAmount: ticketPrice,
                        monthlyWalletAmountLimit: ticketPrice
                    }
                });

        const transactionData = {
            playerId: playerId,
            gameId: gameIdString,
            transactionSlug: "extraTransaction",
            typeOfTransaction: "Refund",
            action: "credit",
            purchasedSlug,
            totalAmount: ticketPrice,
            game1Slug: "refund"
        };

        const transactionPromise = Sys.Helper.gameHelper.createTransactionPlayer(transactionData);
        Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
            type: "cancel",
            playerId: playerId,
            hallId: '',
            cancel: ticketPrice
        });
        await updatePlayerHallSpendingData({ playerId: playerId, hallId: refundHallId, amount: +ticketPrice, type: 'normal', gameStatus: 2 });
        let updateSubGamesPromise = Promise.resolve();
        // 3. Update subGames ticket stats if present
        if(isSubGameDbUpdate && purchaseTicketTypes?.length > 0){
            const incObj = {};
            const filterArr = [];
            const tempAlpha = [...'abcdefghijklmnopqrstuvwxyz'];

            for (let s = 0; s < purchaseTicketTypes.length; s++) {
                incObj[`subGames.$[].options.$[${tempAlpha[s]}].totalPurchasedTickets`] = -purchaseTicketTypes[s].totalPurchasedTickets;
                filterArr.push({ [`${tempAlpha[s]}.ticketName`]: purchaseTicketTypes[s].ticketName });
            }

            updateSubGamesPromise = Sys.Game.Game1.Services.GameServices.updateGameNested(
                { _id: gameId },
                { $inc: incObj },
                { arrayFilters: filterArr }
            );
        }
        

        // 4. Delete tickets and update static ticket flow (fire and forget if not critical)
        let ticketCleanupPromises = [];
        if(refundAllHalls){
            ticketCleanupPromises = [
                Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: playerId, gameId: gameIdString }),
                Sys.Game.Game1.Services.GameServices.updateManyStaticData(
                    { playerIdOfPurchaser: playerId, isPurchased: true, gameId: gameIdString },
                    { isPurchased: false, playerIdOfPurchaser: "", gameId: "" }
                )
            ];
        } else {
            ticketCleanupPromises = [
                Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: playerId, gameId: gameIdString, hallId: refundHallId }),
            ];
        }
        

        // 5. Send Notification (translate + notify)
        const TimeMessage = {
            en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: gameNumber, number1: gameName }),
            nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: gameNumber, number1: gameName })
        };

        const notificationData = {
            notificationType: 'refundTickets',
            message: TimeMessage
        };

        const notifyPromise = Sys.Game.Common.Services.NotificationServices.create({
            playerId: playerId,
            gameId: gameId,
            notification: notificationData
        });
        
        const socketEmitPromise = Sys.Io.to(playerSocketId).emit('NotificationBroadcast', notificationData);

        // 6. Await all non-dependent ops in parallel
        await Promise.all([
            updateBalancePromise,
            transactionPromise,
            updateSubGamesPromise,
            ...ticketCleanupPromises,
            notifyPromise,
            socketEmitPromise
        ]);

        Sys.Io.to(playerSocketId).emit('PlayerHallLimit', { playerId: playerId });

        return { success: true };

    } catch (error) {
        console.error("Error in processPlayerRefund:", error);
        return { success: false, message: 'something_went_wrong' };
    }
};

// Update player, subgame, grouphall tickets countand price
const prepareTicketDeletionsForUpdate = async (gameId, playerId, tickets) => {
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
        // Step 2: Loop through each group and apply precise updates
        // Hear added multiple update because arrayFilters can handle up to 10 unique filters only
        
        // for (const group of Object.values(ticketGroups)) {
        //     const { ticketColorName, ticketKey, hallId, userTicketType, ticketColorType, ticketPrice, count } = group;
        //     console.log("single group--", ticketColorName, ticketKey, hallId, userTicketType, ticketColorType, ticketPrice, count)
        //     // Determine how many tickets should be deleted
        //     let groupSize = 1;
        //     if (ticketColorType === 'large' || ticketColorType.startsWith('traffic-')) groupSize = 3;
        //     else if (ticketColorType === 'elvis') groupSize = 2;
        
        //     const deleteCount = groupSize === 1 ? count : Math.floor(count / groupSize);
        //     const remaining = groupSize === 1 ? 0 : count % groupSize;
        //     const refundAmount = (deleteCount + remaining) * ticketPrice;
        //     totalPrice += refundAmount;
        //     console.log("groupSize, deleteCount, remaining, refundAmount, totalPrice", groupSize, deleteCount, remaining, refundAmount, totalPrice)
        //     if (deleteCount > 0) {
        //         const $inc = {
        //             [`players.$[player].purchaseTicketTypes.$[pt].totalPurchasedTickets`]: -deleteCount,
        //             [`subGames.$[].options.$[opt].totalPurchasedTickets`]: -deleteCount,
        //             [`groupHalls.$[].halls.$[hall].userTicketType.${userTicketType}.${ticketKey}`]: -deleteCount,
        //             [`groupHalls.$[].halls.$[hall].ticketData.${ticketKey}`]: -deleteCount,
        //         };
        
        //         const arrayFilters = [
        //             { "player.id": playerId },
        //             { "pt.ticketName": ticketColorName },
        //             { "opt.ticketName": ticketColorName },
        //             { "hall.id": hallId }
        //         ];
        
        //         const updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
        //             { _id: gameId },{ $inc }, { arrayFilters }
        //         );
        //     }
        // }

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
   
};

// Refresh game after refund for admin and game
const refreshGameAfterRefund = async (gameId, halls) => {
    try {
        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
        Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
        Sys.Io.of('admin').emit('refreshSchedule', { scheduleId: gameId });
        halls.forEach(hall => {
            Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
        })
    } catch (error) {
        console.error("Error refreshing game after refund:", error);
    }
};

const chunkArray = async (array, size) => {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
}

// Refund physical ticket 
const refundPhysicalTicket = async (data) => {
    try {
        const { gameId, isRefundAllHalls, allAssignedHalls, refundHallId, gameStartDate, gameNumber, gameName, gameType } = data;
        const allHallIds = isRefundAllHalls ? allAssignedHalls : [refundHallId];
        if (!allHallIds.length) return { success: true, message: 'no_halls_to_refund' };
        
        const hallIdChunks = await chunkArray(allHallIds, 5);
        for (const hallChunk of hallIdChunks) {
            const chunkTickets = await Sys.App.Services.GameService.getTicketsByData(
                { gameId, hallId: { $in: hallChunk },  userTicketType: "Physical",  isPurchased: true,},
                { _id: 1, ticketColorName: 1, hallId: 1, ticketColorType: 1, ticketPrice: 1, ticketPurchasedFrom: 1, userTicketType: 1, agentId: 1, playerIdOfPurchaser: 1 }
            );

            if(chunkTickets.length == 0) continue;
        
            // Group by hallId and agentId
            const grouped = {};
            for (const ticket of chunkTickets) {
                const key = `${ticket.hallId}_${ticket.agentId}`;
                if (!grouped[key]) {
                    grouped[key] = { hallId: ticket.hallId, agentId: ticket.agentId, tickets: [] };
                }
                grouped[key].tickets.push(ticket);
            }
            console.log("grouped----", grouped)
            // Process each agent+hall group
            for (const { hallId, agentId, tickets } of Object.values(grouped)) {

                // Group tickets by playerIdOfPurchaser
                const groupedByPlayer = {};
                for (const ticket of tickets) {
                    const playerId = ticket.playerIdOfPurchaser;
                    if (!groupedByPlayer[playerId]) groupedByPlayer[playerId] = [];
                    groupedByPlayer[playerId].push(ticket);
                }
                console.log("groupedByPlayer---", JSON.stringify(groupedByPlayer))
                
                // Process each player in parallel
                const playerRefundTasks = Object.entries(groupedByPlayer).map(async ([playerId, playerTickets]) => {
                    try {
                        console.log("playerTickets---", playerTickets.length)
                        const { ticketPrice } = await prepareTicketDeletionsForUpdate(
                            await Sys.Helper.bingo.obId(gameId),
                            playerId,  // this will be considered as playerId
                            playerTickets
                        );
                        console.log("ticketPrice----", ticketPrice)
                        // Update player + game stats
                        await Sys.Game.Game1.Services.GameServices.updateGameNested(
                            { _id: gameId, 'players.id': playerId },
                            {
                                $inc: {
                                    ticketSold: -playerTickets.length,
                                    earnedFromTickets: -ticketPrice,
                                    finalGameProfitAmount: -ticketPrice,
                                    'players.$.ticketPrice': -ticketPrice,
                                    'players.$.totalPurchasedTickets': -playerTickets.length
                                }
                            }
                        );

                        // Refund to agent
                        await refundHallAgents({ hallId, agentId, gameId, ticketPrice, gameStartDate, gameNumber, gameName, gameType, allHallIds });

                    } catch (err) {
                        console.error(`Error refunding player ${playerId}:`, err);
                    }
                });

                await Promise.allSettled(playerRefundTasks); // doesn't block or fail on individual errors
            }

        }

        Sys.App.Services.GameService.deleteTicketManydata({ gameId: gameId, hallId: {$in: allHallIds}, userType: "Physical" });

        return {
            success: true,
        };
    } catch (error) {
        console.error("Error in refundPhysicalTicket:", error);
        return { success: false, message: 'something_went_wrong' };
    }
}

// Refund Hall Agents and update its session
const refundHallAgents = async (data) => {
    try {
        const { hallId, agentId, gameId, ticketPrice, gameStartDate, gameNumber, gameName, gameType, allHallIds } = data;

        // Fetch required hall data
        const hallData = await Sys.App.Services.HallServices.getSingleHallByData(
            { _id: hallId },
            {
                activeAgents: 1,
                groupHall: 1,
                name: 1,
                'otherData.todayShiftIdWithoutTransfer': 1,
                'otherData.lastWorkingDate': 1
            }
        );
       
        if (!hallData) return { success: false, message: 'something_went_wrong' };

        const { activeAgents, otherData, name: hallName, groupHall } = hallData;
        let agentToRefund = null;

        // Prefer active agent or fallback to latest shift agent
        if (activeAgents?.length > 0) {
            agentToRefund = activeAgents.find(agent => agent.id == agentId) || activeAgents[0];
        } else {
            const today = moment().startOf('day');
            const lastWorkingDate = moment(otherData?.lastWorkingDate).startOf('day');
            // check for today's active agent 
            if (lastWorkingDate.isSame(today)) {
                const startOfDay = today.toDate();
                const endOfDay = today.clone().endOf('day').toDate();

                const shiftQuery = {
                    hallId,
                    startTime: { $gte: startOfDay, $lt: endOfDay }
                };

                if (otherData.todayShiftIdWithoutTransfer) {
                    shiftQuery._id = otherData.todayShiftIdWithoutTransfer;
                }

                const lastShift = await Sys.App.Services.AgentServices.getSingleShiftData(
                    shiftQuery,
                    { agentId: 1 },
                    { createdAt: -1 }
                );
                console.log("shiftquery and lastshift--", shiftQuery, lastShift)
                if (lastShift?.agentId) {
                    const agent = await Sys.App.Services.AgentServices.getSingleAgentByData(
                        { _id: lastShift.agentId },
                        { name: 1 }
                    );

                    agentToRefund = {
                        id: lastShift.agentId.toString(),
                        shiftId: lastShift._id.toString(),
                        name: agent?.name || ''
                    };
                }
            }
        }
        console.log("agentToRefund---", agentToRefund)
        if (!agentToRefund) {
            return { success: false, message: 'something_went_wrong' };
        }

        const { id: currentAgentId, name, shiftId } = agentToRefund;

        // Create refund transaction
        let transactionPointData = {
            transactionId: 'TRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
            playerId: await Sys.Helper.bingo.obId(agentId),
            defineSlug: "extraTransaction",
            typeOfTransaction: "Refund",
            gameStartDate: gameStartDate,
            gameId: await Sys.Helper.bingo.obId(gameId),
            gameNumber: gameNumber,
            gameType: gameType,
            gameName: gameName,
            category: "debit",
            status: "success",
            typeOfTransactionTotalAmount: +ticketPrice,
            hallId: hallId,
            groupHallId: groupHall.id,
            game1Slug: "refund",
            groupHall: groupHall,
            hall: {
                name: hallName,
                id: hallId
            },
            amtCategory: "cash",
            userType: "Agent",
            createdAt: Date.now(),
        }
        await Sys.Game.Common.Services.PlayerServices.createTransaction(transactionPointData);
        
        // Log physical ticket transaction
        const physicalTransaction = {
            agentId: currentAgentId, //await Sys.Helper.bingo.obId(currentAgentId),
            agentName: name,
            shiftId,
            typeOfTransaction: "Physical Ticket Cancelled.",
            action: "debit",
            totalAmount: ticketPrice,
            hallId: hallId, //await Sys.Helper.bingo.obId(hallId),
            groupHallId: groupHall.id,
            hall: {
                name: hallName,
                id: hallId
            },
            groupHall,
            ticketData: [],
            userType: "Physical",
            paymentType: "Cash"
        };
        await Sys.Helper.gameHelper.physicalTicketTransactionsInHall(physicalTransaction);

        await Sys.Helper.gameHelper.updateSession({ agentId: currentAgentId, hallId: hallId, shiftId: shiftId })
        //refreshGameAfterRefund(gameId, allHallIds);
        return { success: true };
    } catch (error) {
        console.error("Error in refundHallAgents:", error);
        return { success: false, message: 'something_went_wrong' };
    }
};

// Get player verification status
const playerVerificationStatus = async (player) => {
    try {
        const { bankIdAuth = {}, isVerifiedByHall, isAlreadyApproved, otherData } = player;
        const { status: bankStatus, expiryDate } = bankIdAuth;
        const hasBankIdAuth = Object.keys(bankIdAuth).length > 0;

        const isVerifiedByBankID = hasBankIdAuth && bankStatus === 'COMPLETED';
        const isBankIdReverificationNeeded =
            hasBankIdAuth && isVerifiedByBankID &&
            (bankStatus === 'EXPIRED' || !!expiryDate);

        const canPlayGames = isAlreadyApproved || isVerifiedByBankID || isVerifiedByHall;

        return {
            isVerifiedByBankID,
            isVerifiedByHall,
            canPlayGames,
            isBankIdReverificationNeeded,
            idExpiryDate: isVerifiedByHall ? otherData?.hallVerification?.idExpiryDate ?? null : null
        };
    } catch (error) {
        console.error("Error in playerVerificationStatus:", error);
        return {
            isVerifiedByBankID: false,
            isVerifiedByHall: false,
            canPlayGames: false,
            isBankIdReverificationNeeded: false
        };
    }
}



// const calculateTotalTicketPrice = (ticketArray) => {
//     try {
//       let total = 0, large = 0, elvis = 0, traffic = 0;
//       let largePrice = 0, elvisPrice = 0, trafficPrice = 0;
  
//       for (const { ticketColorType: c, ticketPrice: p } of ticketArray) {
//         if (c === 'small') total += p;
//         else if (c === 'large') large++, largePrice ||= p;
//         else if (c === 'elvis') elvis++, elvisPrice ||= p;
//         else if (c.startsWith('traffic-')) traffic++, trafficPrice ||= p;
//       }
  
//       total += (large / 3) * largePrice;
//       total += (elvis / 2) * elvisPrice;
//       total += (traffic / 3) * trafficPrice;
  
//       return +parseFloat(total).toFixed(2);
//     } catch (err) {
//       console.error('Error calculating ticket price:', err);
//       return 0;
//     }
// };

// checkForWinners settlePendingWinners to process duplicate winners
async function processDuplicateWinners(finalWinners, gameId) {
    try {
        const isDuplicate = new Set(finalWinners.map(v => v.lineType)).size < finalWinners.length;
        if (!isDuplicate) return finalWinners;

        console.log('duplicates found', gameId);
        const winnerMap = finalWinners.reduce((map, winner) => {
            if (!map.has(winner.lineType)) {
                map.set(winner.lineType, { ...winner, count: 0, players: [] });
            }
            const entry = map.get(winner.lineType);
            entry.count++;
            entry.players.push(winner);
            return map;
        }, new Map);
        
        return Array.from(winnerMap.values()).flatMap(entry => {
            if (entry.count <= 1) return [entry];
        
            return entry.players.map(player => ({
                ...player,
                wonAmount: Math.round(exactMath.div(player.wonAmount, entry.count))
            }));
        });
    } catch (error) {
        console.error('Error in processDuplicateWinners:', error);
        return finalWinners; // Return original winners if processing fails
    }
}

// checkForWinners settlePendingWinners to emit winner data to agent panel all halls to update winning data
function emitWinnerData(halls, winnerArray) {
    try {
        // Pre-create payload and socket reference
        const payload = [winnerArray, { message: "Ticket Purchase" }];
        const ioAdmin = Sys.Io.of('admin');

        // Schedule emissions with process.nextTick
        halls.forEach(hall => {
            process.nextTick(() => {
                try {
                    winnerArray.forEach(winnerObj => 
                        ioAdmin.to(hall).emit('winnerDataRefresh', winnerObj, { message: "Ticket Purchase" })
                    );
                } catch (err) {
                    console.error(`Error emitting to hall ${hall}:`, err);
                }
            });
        });
    } catch (error) {
        console.error('Error in emitWinnerData:', error);
    }
}

// checkForWinners settlePendingWinners to notify players about their winning on specific player socketId
async function notifyPlayers(notifications, adminWinners, gameId) {
    try {
        await Promise.all(notifications.map(async ({ playerId }) => {
            try {
                const playerSocket = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                    { _id: playerId }, 
                    { socketId: 1 }
                );
                if (playerSocket) {
                    const totalWon = adminWinners
                        .filter(w => w.playerId === playerId)
                        .reduce((sum, w) => sum + w.wonAmount, 0);
                    
                    await Sys.Io.of(Sys.Config.Namespace.Game1)
                        .to(`/Game1#${playerSocket.socketId}`)
                        .emit('PatternCompleted', { gameId, ticketList: notifications, totalWon });
                }
            } catch (error) {
                console.error(`Error processing notification for player ${playerId}:`, error);
            }
        }));
    } catch (error) {
        console.error('Error in notifyPlayers:', error);
    }
}

// checkForWinners settlePendingWinners to update winning tickets
async function updateWinningTickets(winnerArray, room) {
    try {
        await Promise.all(winnerArray.map(async winner => {
            try {
                const updateData = {
                    $set: {
                        isPlayerWon: true,
                        isTicketSubmitted: true,
                        isWonByFullhouse: !!winner.isFullHouse,
                        ...(winner.userType === "Physical" && { 'otherData.isWinningDistributed': false })
                    },
                    $push: {
                        'otherData.winningStats': {
                            lineType: winner.lineTypeDisplay,
                            wonElements: winner.wonElements,
                            wonAmount: winner.wonAmount,
                            isWinningDistributed: false,
                            isJackpotWon: winner.isJackpotWon,
                            ballDrawned: room.withdrawNumberArray,
                            currentWithdrawBall: room.withdrawNumberArray?.at(-1),
                            currentWithdrawBallCount: room.withdrawNumberArray?.length
                        }
                    },
                    $inc: { totalWinningOfTicket: +parseFloat(winner.wonAmount).toFixed(4) }
                };
                
                return await Sys.Game.Game1.Services.GameServices.updateTicket(
                    { _id: winner.ticketId, playerIdOfPurchaser: winner.playerId },
                    updateData
                );
            } catch (error) {
                console.error(`Error updating winning ticket for winner ${winner.ticketId}:`, error);
                return null; // Continue with other updates even if one fails
            }
        }));
    } catch (error) {
        console.error('Error in updateWinningTickets:', error);
    }
}

// checkForWinners settlePendingWinners to insert player notitifications in db
async function sendPlayerNotifications(winnerArray, room, gameId) {
    try {
        let newArray = winnerArray.map(object => ({ ...object }))
        let winnerPlayerPatternWise = Object.values(newArray.reduce(function(r, e) {
            let key = e.playerId + '|' + e.lineType;
            if (!r[key]) r[key] = e;
            else {
                r[key].wonAmount += e.wonAmount;
            }
            return r;
        }, {}))
        
        const notifications = await Promise.all(winnerPlayerPatternWise
            .filter(w => w.userType !== "Physical")
            .map(async w => {
                try {
                    const player = await Sys.Game.Game1.Services.PlayerServices.getOneByData(
                        { _id: w.playerId },
                        { username: 1, walletAmount: 1, enableNotification: 1, socketId: 1, firebaseToken: 1, selectedLanguage: 1 }
                    );
                    if (!player) return null;

                    const message = await getWinnerMessage(w, room);
                    return {
                        insertOne: {
                            document: {
                                playerId: w.playerId,
                                gameId: room._id,
                                notification: { notificationType: 'winning', message }
                            }
                        }
                    };
                } catch (error) {
                    console.error(`Error processing notification for winner ${w.playerId}:`, error);
                    return null;
                }
            }));

        if (notifications.length) {
            await Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(notifications.filter(Boolean));
        }
    } catch (error) {
        console.error('Error in sendPlayerNotifications:', error);
    }
}

// checkForWinners settlePendingWinners sendPlayerNotifications to get winner message of specific pattern
async function getWinnerMessage(winner, room) {
    try {
        // Default values
        let messageKey = "game1_individual_pattern";
        let amountOrType =  +Number.parseFloat(winner.wonAmount || 0).toFixed(2); // Safe parsing
        let lineType = winner.lineTypeDisplay;

        // Determine message key and adjust parameters based on conditions
        if (winner.isWoF || winner.isTchest || winner.isMys || winner.isColorDraft) {
            const typeMap = {
                isWoF: "wof",
                isTchest: "tc",
                isMys: "mystery",
                isColorDraft: "cd"
            };
            const specialType = Object.keys(typeMap).find(key => winner[key]);
            messageKey = `game1_fullhouse_${typeMap[specialType]}`;
            amountOrType = lineType; // Repurpose amountOrType
            lineType = undefined;    // Clear lineType
        } else if (room.gameName === "Jackpot" && winner.isJackpotWon) {
            messageKey = "game1_fullhouse_jackpot";
        }

        // Construct base parameters immutably
        const baseParams = {
            key: messageKey,
            language: "en",
            isDynamic: true,
            number: room.gameNumber,
            number1: room.gameName,
            number2: amountOrType,
            ...(lineType && { number3: lineType }) // Conditionally add number3
        };

        // // Parallel translation for better performance
        // const [enTranslation, norTranslation] = await Promise.all([
        //     translate({ ...baseParams, language: "en" }),
        //     translate({ ...baseParams, language: "nor" })
        // ]);

        const enTranslation = await translate({ ...baseParams, language: "en" });
        const norTranslation = await translate({ ...baseParams, language: "nor" });
        
        return {
            en: enTranslation,
            nor: norTranslation
        };
    } catch (error) {
        console.error("Error in getWinnerMessage:", error);
        return {
            en: "Congratulations! You won!",
            nor: "Gratulerer! Du vant!"
        };
    }
}

// checkForWinners settlePendingWinners to broadcast tv screen winner ticket data and tv screen winning details
async function broadcastAdminNotifications(winnerArray, gameId) {
    try {
        const groupedWinners = Array.from(winnerArray.reduce((map, w) => {
            if (!map.has(w.lineType)) {
                map.set(w.lineType, {
                    ...w,
                    winnerCount: 0,
                    finalWonAmount: 0,
                    playerIds: new Set(),
                    winningTickets: []
                });
            }
            const entry = map.get(w.lineType);
            entry.winnerCount = entry.playerIds.add(w.playerId).size;
            entry.finalWonAmount = Math.round(entry.finalWonAmount + w.wonAmount);
            entry.winningTickets.push({ ticket: w.ticketCellArray, wonElement: w.wonElements });
            return map;
        }, new Map).values());
        
        await Promise.all(groupedWinners.map(async winner => {
            try {
                const winningTickets = formatWinningTickets(winner);
                const payload = {
                    id: winner.lineType,
                    displayName: winner.lineTypeDisplay,
                    winnerCount: winningTickets.length, //winner.winnerCount,
                    prize: winner.finalWonAmount,
                    winningTickets
                };
                await Sys.Io.of(Sys.Config.Namespace.Game1)
                    .to(gameId)
                    .emit('BingoWinningAdmin', payload);
            } catch (error) {
                console.error(`Error processing admin notification for winner ${winner.lineType}:`, error);
            }
        }));
    } catch (error) {
        console.error('Error in broadcastAdminNotifications:', error);
    }
}

// checkForWinners settlePendingWinners broadcastAdminNotifications to format winning tickets
function formatWinningTickets(winner) {
    try {
        if (!winner.winningTickets?.length) return [];
        const frameCoords = new Set([
            "0:0","0:1","0:2","0:3","0:4",
            "1:0","1:4","2:0","2:4","3:0","3:4",
            "4:0","4:1","4:2","4:3","4:4"
        ]);
        const pictureCoords = new Set([
            "1:1","1:2","1:3",
            "2:1","2:2","2:3",
            "3:1","3:2","3:3"
        ]);
        // updated method to retunr winnig ticket with row and columns
        return winner.winningTickets.map(({ ticket, wonElement }) => {
            try {
                const rows = wonElement?.rows || [];
                const cols = wonElement?.columns || [];
                const isFrame = winner.lineType === "Frame";
                const isPicture = winner.lineType === "Picture";

                const numbers = (ticket || []).flatMap((row, r) =>
                    row.map((cell, c) => {
                        // For these patterns, only consider rows, not columns
                        const onlyRowPatterns = ["Row 2", "Row 3", "Row 4"];
                        let isWinningCell;

                        if (onlyRowPatterns.includes(winner?.lineType)) {
                            isWinningCell = rows.includes(r) 
                        } else {
                            isWinningCell =
                                rows.includes(r) ||
                                cols.includes(c) ||
                                (isFrame && frameCoords.has(`${r}:${c}`)) ||
                                (isPicture && pictureCoords.has(`${r}:${c}`));
                        }
 
                        return isWinningCell ? String(cell) : "";
                    })
                );
        
                return {
                    numbers: numbers,
                    patternName: winner?.lineType
                };
            } catch (error) {
                console.error("Error processing winning ticket:", error);
                return {
                    numbers: [],
                    patternName: winner?.lineType
                };
            }
        });

        // return winner.winningTickets.map(({ ticket, wonElement }) => {
        //     try {
        //         if (winner.lineType === "Frame") {
        //             const frame = ["0:0", "0:1", "0:2", "0:3", "0:4", "1:0", "1:4", "2:0", "2:4", "3:0", "3:4", "4:0", "4:1", "4:2", "4:3", "4:4"];
        //             return filterPattern(ticket, new Set(frame));
        //         }
        //         if (winner.lineType === "Picture") {
        //             const picture = ["1:1", "1:2", "1:3", "2:1", "2:2", "2:3", "3:1", "3:2", "3:3"];
        //             return filterPattern(ticket, new Set(picture));
        //         }
        //         if (winner.lineType === "Row 1" && wonElement.columns?.length) {
        //             return showColumnAsRow(ticket, +wonElement.columns[0]);
        //         }
        //         return filterRows(ticket, wonElement.rows || []);
        //     } catch (error) {
        //         console.error("Error processing winning ticket:", error);
        //         return [];
        //     }
        // }).map(item => {
        //     try {
        //         return {
        //             numbers: item.flat().map(String),
        //             patternName: winner.lineType
        //         };
        //     } catch (error) {
        //         console.error("Error formatting ticket item:", error);
        //         return {
        //             numbers: [],
        //             patternName: winner.lineType || "Unknown"
        //         };
        //     }
        // });
    } catch (error) {
        console.error("Error in formatWinningTickets:", error);
        return [];
    }
}

function filterPattern(ticket, patternSet) {
    try {
        return ticket.map((row, rowIndex) =>
            row.map((item, colIndex) => {
                try {
                    const coord = `${rowIndex}:${colIndex}`;
                    return patternSet.has(coord) ? item : "";
                } catch (error) {
                    console.error("Error processing cell in filterPattern:", error);
                    return "";
                }
            })
        );
    } catch (error) {
        console.error("Error in filterPattern:", error);
        return [];
    }
}

function showColumnAsRow(arr, columnIndex) {
    try {
        const column = arr.map(row => row[columnIndex]);
        return arr.map((row, index) => index === columnIndex ? column : ["", "", "", "", ""]);
    } catch (error) {
        console.error("Error in showColumnAsRow:", error);
        return [];
    }
}

function filterRows(ticket, winningRows) {
    try {
        return ticket.map((row, index) => 
            winningRows.includes(index) ? row : ["", "", "", "", ""]
        );
    } catch (error) {
        console.error("Error in filterRows:", error);
        return [];
    }
}

// agentGameCheckBingo to broadcast tv screen winner ticket with unclaimed patterns
async function broadcastTvScreenWinners(data) {
    console.log("broadcastTvScreenWinners---", data)
    const { ticket, winnings, ticketNumber, total_draw_count, unclaimedWinners, id, hallId, gameStatus, groupOfHallsId } = data;
    try {
        const winningRows = new Set(), winningCols = new Set();
        const frameCoords = new Set([
          "0:0","0:1","0:2","0:3","0:4",
          "1:0","1:4","2:0","2:4","3:0","3:4",
          "4:0","4:1","4:2","4:3","4:4"
        ]);
        const pictureCoords = new Set([
          "1:1","1:2","1:3",
          "2:1","2:2","2:3",
          "3:1","3:2","3:3"
        ]);
        let hasFrame = false, hasPicture = false;
        const winners = [];
        const filteredWinners = [];

        // collect current row winners, we are not passing all winnings just win pattern at current ball
        // const filteredWinners = (winnings || [])
        // .filter(w => w.currentWithdrawBallCount == total_draw_count)
        // .map(w => {
        //     w.wonElements?.rows?.forEach(r => winningRows.add(r));
        //     w.wonElements?.columns?.forEach(c => winningCols.add(c));
        //     if (w.lineType === "Frame") hasFrame = true;
        //     if (w.lineType === "Picture") hasPicture = true;

        //     return {
        //         lineType: w.lineType,
        //         wonAmount: w.wonAmount,
        //         showPrize: false, // since we only keep unshown winners
        //         isWinningDistributed: w.isWinningDistributed
        //     };
        // });

        for (const w of winnings) {
            const winnerData = {
              lineType: w.lineType,
              wonAmount: w.wonAmount,
              showPrize: !(total_draw_count <= w.currentWithdrawBallCount && gameStatus != "finish"),
              isWinningDistributed: w.isWinningDistributed
            };
            winners.push(winnerData);
      
            if (w.currentWithdrawBallCount === total_draw_count) {
              w.wonElements?.rows?.forEach(r => winningRows.add(r));
              w.wonElements?.columns?.forEach(c => winningCols.add(c));
              if (w.lineType === "Frame") hasFrame = true;
              if (w.lineType === "Picture") hasPicture = true;
      
              filteredWinners.push(winnerData);
            }
        }

        const hasAnyWinners = filteredWinners.length > 0;
    
        // flatten ticket in one pass
        const flattenedTicket = (ticket || []).flatMap((row, r) =>
            row.map((cell, c) => ({
                Number: cell.Number,
                checked: cell.checked,
                show: hasAnyWinners
                    ? (() => {
                        const onlyRowPatterns = ["Row 2", "Row 3", "Row 4"];
                        let isWinningCell;
                        if (onlyRowPatterns.includes(filteredWinners[0]?.lineType)) {
                            isWinningCell = winningRows.has(r);
                        } else {
                            isWinningCell =
                                winningRows.has(r) ||
                                winningCols.has(c) ||
                                (hasFrame && frameCoords.has(`${r}:${c}`)) ||
                                (hasPicture && pictureCoords.has(`${r}:${c}`));
                        }
                        return isWinningCell;
                    })()
                    : cell.checked
            }))
        );
    
        const simplifiedUnclaimed = (unclaimedWinners || []).map(u => ({
            lineType: u.lineType,
            withdrawBall: u.currentWithdrawBall,
            withdrawBallCount: u.currentWithdrawBallCount,
            totalWithdrawCount: total_draw_count
        })).reverse();

        const payload =  {
            ticket: flattenedTicket,
            ticketNumber,
            totalWithdrawCount: total_draw_count,
            unclaimedWinners: simplifiedUnclaimed,
            winners,
            hallId
        };
        groupOfHallsId.forEach(async hall => {
            await Sys.Io.of(Sys.Config.Namespace.Game1).to(hall).emit('playerClaimWinner', payload);
        });
        // await Sys.Io.of(Sys.Config.Namespace.Game1).to(hallId).emit('playerClaimWinner', payload);
    } catch (err) {
        console.error("broadcastTvScreenWinners error:", err);
        const payload =  {
          ticket: [],
          ticketNumber: null,
          totalWithdrawCount: 0,
          unclaimedWinners: [],
          winners: []
        };
        // await Sys.Io.of(Sys.Config.Namespace.Game1)
        //     .to(id)
        //     .emit('playerClaimWinner', payload);
        await Sys.Io.of(Sys.Config.Namespace.Game1).to(hallId).emit('playerClaimWinner', payload);
    }
      
}

// checkForWinners settlePendingWinners to update game state like patternchange broadcast and refresh tickets in view pages
async function updateGameState(gameId) {
    try {
        const patternRoom = await Sys.Game.Game1.Services.GameServices.getSingleByData(
            { _id: gameId },
            { winners: 1, subGames: 1, jackpotPrize: 1, jackpotDraw: 1, gameName: 1, withdrawNumberArray: 1, otherData: 1, parentGameId: 1 }
        );
        
        const { patternList, jackPotData } = await Sys.Game.Game1.Controllers.GameProcess.patternListing(patternRoom._id);
        const winningCombinations = new Set(patternRoom.winners.map(item => item.lineType));
        const finalPatternList = patternList.map(p => ({
            ...p,
            isWon: winningCombinations.has(p.name)
        }));

        // const jackPotData = await Sys.Game.Game1.Controllers.GameController.getJackpotData(
        //     patternRoom.gameName,
        //     patternRoom.withdrawNumberArray.length,
        //     patternRoom.jackpotDraw,
        //     patternRoom.jackpotPrize,
        //     patternRoom.subGames,
        //     patternRoom.parentGameId
        // );

        await Promise.all([
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange', { patternList: finalPatternList, jackPotData }),
            Sys.Io.of('admin').to(gameId).emit('refreshTicketTable')
        ]);

        clearInterval(Sys.GameTimers[gameId]);
    } catch (error) {
        console.error('Error in updateGameState:', error);
    }
}

// Used when game is stopped by agent/player or auto pause for online players
// const settlePendingWinners = async (gameId, pendingWinners) => {
//     try {
//         // Step 1: Fetch only required fields from game
//         const { finalWinners = [], luckyNumberBonusWinners = [] } = pendingWinners || {};

//         if (!finalWinners.length && !luckyNumberBonusWinners.length) return;

//         const result = await Sys.Game.Game2.Services.GameServices.updateGame(
//             {
//               _id: gameId,
//               "otherData.pendingWinners": { $ne: {} }
//             },
//             {
//               $set: {
//                 "otherData.pendingWinners": {}
//               }
//             }
//         );
//         console.log("result of update pending winners", result)
//         if (result.modifiedCount === 0) {
//             console.log("Update skipped: pending winners already empty.");
//             return
//         }

//         // Step 2: Process duplicates and emit
//         const winnerArray = await processDuplicateWinners(finalWinners, gameId);

//         // Step 3: Push winners and bonus winners to game
//         const { halls, adminWinners, withdrawNumberArray, _id, gameName, gameNumber } = await Sys.Game.Game1.Services.GameServices.updateGameNew(gameId, {
//             $push: {
//                 ...(finalWinners.length && { winners: { $each: finalWinners } }),
//                 ...(luckyNumberBonusWinners.length && { luckyNumberBonusWinners: { $each: luckyNumberBonusWinners } }),
//                 adminWinners: { $each: winnerArray }
//             }
//         });
//         emitWinnerData(halls, winnerArray);

//         // Step 4: Prepare player notifications
//         const winningNotifications = finalWinners.map(winner => ({
//             ticketId: winner.ticketId,
//             fullHouse: !!winner.isFullHouse,
//             patternName: winner.lineTypeDisplay,
//             ticketNumber: winner.ticketNumber,
//             lineType: winner.lineType,
//             playerId: winner.playerId
//         }));

//         // Step 5: Run all remaining updates in parallel
//         await Promise.all([
//             notifyPlayers(winningNotifications, adminWinners, gameId),
//             updateWinningTickets(winnerArray, { withdrawNumberArray }),
//             sendPlayerNotifications(winnerArray, { _id, gameName, gameNumber }, gameId),
//             broadcastAdminNotifications(winnerArray, gameId),
//             updateGameState(gameId, {_id})
//         ]);

//     } catch (error) {
//         console.error("Error in settlePendingWinners:", error);
//     }
// }

const settlePendingWinners = async (gameId, pendingWinners) => {
    try {
        // Step 1: Fetch only required fields from game
        const { onlineWinners = [], onlineLuckyNumberBonusWinners = [] } = pendingWinners || {};

        if (!onlineWinners.length && !onlineLuckyNumberBonusWinners.length) return;

        const result = await Sys.Game.Game2.Services.GameServices.updateGame(
            {
              _id: gameId,
              "otherData.pendingWinners": { $ne: {} }
            },
            {
              $set: {
                "otherData.pendingWinners": {}
              }
            }
        );
        console.log("result of update pending winners", result)
        if (result.modifiedCount === 0) {
            console.log("Update skipped: pending winners already empty.");
            return
        }

        // Step 2: Process duplicates and emit
        const winnerArray = await processDuplicateWinners(onlineWinners, gameId);

        // Step 3: Push winners and bonus winners to game
        const { halls, adminWinners, withdrawNumberArray, _id, gameName, gameNumber, otherData, winners } = await Sys.Game.Game1.Services.GameServices.updateGameNew(gameId, {
            $push: {
                ...(onlineWinners.length && { winners: { $each: winnerArray } }),
                ...(onlineLuckyNumberBonusWinners.length && { luckyNumberBonusWinners: { $each: onlineLuckyNumberBonusWinners } }),
                adminWinners: { $each: winnerArray }
            }
        });
        saveGameDataToRedisHmset('game1', gameId, { winners: winners });
        emitWinnerData(halls, winnerArray);

        // Step 4: Prepare player notifications
        const winningNotifications = onlineWinners.map(winner => ({
            ticketId: winner.ticketId,
            fullHouse: !!winner.isFullHouse,
            patternName: winner.lineTypeDisplay,
            ticketNumber: winner.ticketNumber,
            lineType: winner.lineType,
            playerId: winner.playerId
        }));

        // Step 5: Run all remaining updates in parallel
        const promises = [
            notifyPlayers(winningNotifications, adminWinners, gameId),
            updateWinningTickets(winnerArray, { withdrawNumberArray }),
            broadcastAdminNotifications(winnerArray, gameId),
            updateGameState(gameId)
        ];

        // Conditionally add sendPlayerNotifications promise
        // if (otherData?.isAutoStopped === true) {
        //     promises.push(sendPlayerNotifications(winnerArray, { _id, gameName, gameNumber }, gameId));
        // }
        await Promise.allSettled(promises);

    } catch (error) {
        console.error("Error in settlePendingWinners:", error);
    }
}

async function nextGameCountDownStart(hallsId, parentGameId, delay = 5000) {
    try {
        console.log("nextGameCountDownStart Call",hallsId);
        
        // Set date range for today
        const startDate = new Date().setHours(0, 0, 0, 0);
        const endDate = new Date().setHours(23, 59, 59, 999);

        let nextGame = await Sys.Game.AdminEvents.Services.GameServices.getByData({
            gameType: 'game_1',
            halls: hallsId[0],
            status: "active",
             stopGame: false,
            'otherData.isClosed': false,
            startDate: {
                $gte: startDate,
                $lte: endDate
            }
        },{
            select: { countDownTime: 1, parentGameId: 1 },
            sort: { startDate: 1, sequence: 1 }
        });

        nextGame = nextGame[0];
        if (!nextGame) {
            console.log("No next game found for hall:", hallsId[0]);
            return;
        }

        console.log("current and old parentgameId", nextGame.parentGameId, parentGameId)
        if(nextGame.parentGameId.toString() != parentGameId.toString()){
            return;
        }
        
        const countDownDateTime = moment()
            .add(nextGame.countDownTime, 'minutes')
            .add(delay, 'milliseconds');
        
        // Update game with new countdown time
        await Sys.Game.Game1.Services.GameServices.updateGame(
            { _id: nextGame._id }, 
            { $set: { countDownDateTime: countDownDateTime.toDate() } }
        );
        const countDownTimeUTC = countDownDateTime.utc().format('YYYY-MM-DD HH:mm:ss.SSS');
        console.log("countDownTimeUTC", countDownDateTime, countDownTimeUTC);
        setTimeout(() => {
            Sys.Io.of(Sys.Config.Namespace.Game1).to(nextGame._id).emit('nextGameStartCountDownTime', {
                gameId: nextGame._id,
                countDownTime: countDownTimeUTC
            });
        }, delay);

    } catch (error) {
        console.log("error",error);
    }
    
}

// refresh game with count down
async function refreshGameOnFinish(gameId, halls, parentGameId) {
    try {
        // module.exports.nextGameCountDownStart(halls, parentGameId, 10000);
        // setTimeout(async function () {
        //     Sys.Game.Common.Controllers.GameController.game1StatusCron();
        // }, 5000);
        
        // halls?.forEach(hall => {
        //     Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
        // })

        // await Sys.Io.of('admin').to(gameId.toString()).emit('refreshTicketTable');
        // Sys.Io.of('admin').emit('refreshSchedule', {scheduleId: parentGameId});

        setTimeout(async function () {
            await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, { $set: {'otherData.gameSecondaryStatus': "finish", 'otherData.isMinigameFinished': true, 'otherData.isMinigameExecuted': true} });
            console.log("refreshGameOnFinish status updated");
            Sys.Game.Common.Controllers.GameController.game1StatusCron();
            module.exports.nextGameCountDownStart(halls, parentGameId, 0);
            halls?.forEach(hall => {
                Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
            })
            await Sys.Io.of('admin').to(gameId.toString()).emit('refreshTicketTable');
            Sys.Io.of('admin').emit('refreshSchedule', {scheduleId: parentGameId});
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
        }, 10000);

    } catch (error) {
        console.log("Error in refreshGameOnFinish:", error);
    }
}

// redresg game admin without count down
async function refreshGameWithoutCountDown(gameId, halls, time = 0, parentGameId) {
    try {
        setTimeout(async function () {
            await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, { $set: {'otherData.gameSecondaryStatus': "finish", 'otherData.isMinigameFinished': true, 'otherData.isMinigameExecuted': true} });
            console.log("refreshGameWithoutCountDown status updated");
            Sys.Game.Common.Controllers.GameController.game1StatusCron();
            Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  parentGameId});
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
            halls.forEach(hall => {
                Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
            })
        },time);
    } catch (error) {
        console.log("Error in refreshGameWithoutCountDown:", error);
    }
}

// Get halls list of specific groupof hall
function getMyGroupHalls(groupHalls, hallId) {
    try {
      for (const group of groupHalls) {
          if (group.selectedHalls.some(hall => hall.id === hallId)) {
              return group.selectedHalls;
          }
      }
      return [];
    } catch (error) {
      console.error("Error in getMyGroupHalls:", error);
      return [];
    }
}

/**
 * Determines whether a game should be automatically paused. 
 * Check if we need to auto pause game
 * Logic:
 * - If no data is provided, default to pausing the game (safety fallback).
 * - Extracts `hasOnlineWinner`, `isAutoStopped`, and `withdrawBallCount` from the given data.
 * - Returns true if:
 *   • There is already an online winner, OR
 *   • The game was auto-stopped, OR
 *   • 75 or more balls have been withdrawn.
 * - If an error occurs during execution, it logs the error and defaults to pausing the game.
 *
*/
function checkIfAutoPauseGame(data) {
    try {
        if (!data) return true; // fallback if data is null/undefined

        const { hasOnlineWinner, isAutoStopped, withdrawBallCount } = data;
        return hasOnlineWinner || isAutoStopped || withdrawBallCount >= 75;
    } catch (error) {
        console.error("Error in checkIfAutoPauseGame:", error);
        return true; // safe fallback: pause the game if an error occurs
    }
}


function getIndexesGreaterOrEqual(arr = [], threshold = 5) {
    if (!Array.isArray(arr)) return []; 
    return arr
      .map((n, i) => (n >= threshold ? i : -1))
      .filter(i => i !== -1);
}

/**
 * Determines which tickets should be considered winners when a ball is withdrawn.
 *
 * Process:
 * - If there are no unclaimed winners yet, all `patternWinners` are treated as new winners.
 * - Otherwise, each ticket in `patternWinners` is checked against previously unclaimed winners:
 *   • Non-physical tickets are always considered new winners.
 *   • For physical tickets, it looks for any previously unclaimed ticket with the same
 *     ticket ID and pattern (`lineTypeDisplay` matching `currentPattern`).
 *   • If no matching old ticket exists, the new ticket is considered a winner.
 *   • If matches exist, it compares the number of completed rows/columns between the
 *     new ticket and each old ticket:
 *       - A new ticket is only considered a winner if it has strictly more completed
 *         rows or columns than all of its matching old tickets.
 *
 * @param {Object} params
 * @param {Array} params.patternWinners - The list of tickets that potentially won with this ball.
 * @param {Array} params.unclaimedWinners - The list of winners already identified but not yet claimed.
 * @param {string} params.currentPattern - The current pattern being checked (e.g., line, house).
 * @returns {Array} The filtered list of new winning tickets.
 */
// async function getWinnersOnWithdrawBall({ patternWinners, unclaimedWinners, currentPattern, gameType, withdrawBall }) {
//     try {
//         console.log("patternWinners, unclaimedWinners, currentPattern", patternWinners, unclaimedWinners, currentPattern);
        
//         // add wonPatternAt in all patternWinners
//         const updatedWinners = patternWinners.map(newTicket => {
//             const position = findRowColumnPosition(newTicket.tickets, +withdrawBall);
        
//             const rowIndexes = newTicket?.rowChecks ? getIndexesGreaterOrEqual(newTicket.rowChecks, 5) : [];
//             const colIndexes = newTicket?.columnChecks ? getIndexesGreaterOrEqual(newTicket.columnChecks, 5) : [];
        
//             newTicket.wonPatternAt = {
//                 row: { indexes: rowIndexes, claimedAt: position?.row != null ? [position.row] : [] },
//                 column: { indexes: colIndexes, claimedAt: (currentPattern === "Row 1" && position?.col != null && colIndexes.length) ? [position.col] : [] }
//             };
        
//             return newTicket;
//         });

//         // If no unclaimed winners yet, consider all pattern winners as new
//         if (!unclaimedWinners || unclaimedWinners.length === 0) return updatedWinners;

//         // // Case 1: No unclaimed winners yet
//         // if (unclaimedWinners.length === 0) {
//         //     if (gameType === "Tv Extra") return patternWinners;
            
//         //     // This is required if ticket has not cliamed when row completed but it claims the same row on different number 
//         //     return patternWinners.filter(newTicket => {
//         //         try {
//         //             const position = findRowColumnPosition(newTicket.tickets, +withdrawBall);
//         //             const rowIndexes = getIndexesGreaterOrEqual(newTicket?.rowChecks, 5);
//         //             const colIndexes =  getIndexesGreaterOrEqual(newTicket?.columnChecks, 5);
                    
//         //             newTicket.wonPatternAt = {
//         //                 row: { indexes: rowIndexes, claimedAt: position?.row != null ? [position.row] : [] },
//         //                 column: { indexes: colIndexes, claimedAt: (position?.col != null && colIndexes.length > 0) ? [position.col] : [] } 
//         //             };
//         //             return true;
//         //         } catch (innerErr) {
//         //             console.error("Error while comparing newTicket with oldTickets:", innerErr);
//         //             return true; // fallback: include ticket
//         //         }
//         //     });
//         // }
        
//         // If gameType is "Tv Extra", implement different logic here
//         const specialPatterns = ["Frame", "Picture", "Full House"];
//         const isSpecialPattern = specialPatterns.includes(currentPattern);

//         return updatedWinners.filter(newTicket => {
//             try {
//               // Only Physical tickets are subject to checks
//               if (newTicket.userTicketType !== "Physical") return true;
          
//               const ticketId = newTicket._id?.toString();
          
//               // Helper to count wins in row/column
//               const countWins = arr => arr?.filter(v => v === 5).length || 0;
          
//               // Helper to get matching old tickets
//               const getMatchingOldTickets = (key, value) =>
//                 unclaimedWinners.filter(t => t.ticketId === ticketId && t[key] === value);
          
//               // Special pattern for Tv Extra game
//               if (isSpecialPattern && gameType === "Tv Extra") {
//                 const matchingOldTickets = getMatchingOldTickets("lineType", newTicket.wonPattern);
//                 return matchingOldTickets.length === 0;
//               }
          
//               // General matching old tickets based on currentPattern
//               const matchingOldTickets = getMatchingOldTickets("lineTypeDisplay", currentPattern);
//               if (matchingOldTickets.length === 0) return true;
          
//               // Check if withdrawBall position matches winning row/column
//               const position = findRowColumnPosition(newTicket.tickets, +withdrawBall);
//               console.log("position of withdraw number in ticket", position, newTicket.rowChecks, newTicket.columnChecks);
//               if (position) {
//                 const valid =
//                   currentPattern === "Row 1"
//                     ? newTicket.rowChecks[position.row] >= 5 || newTicket.columnChecks[position.col] >= 5
//                     : newTicket.rowChecks[position.row] >= 5;
          
//                 if (!valid) return false;
//               }
          
//               // Count new ticket wins
//               const newRowWins = countWins(newTicket.rowChecks);
//               const newColWins = countWins(newTicket.columnChecks);
          
//               // Include ticket if it has more wins than any matching old ticket
//               return matchingOldTickets.every((old, index, arr) => {
//                 const oldRowWins = old?.wonElements?.rows?.length || 0;
//                 const oldColWins = old?.wonElements?.columns?.length || 0;
//                 console.log("Comparing new wins (row:", newRowWins, ", col:", newColWins, ") with old (row:", oldRowWins, ", col:", oldColWins, ")");
                
//                 const isLast = index === arr.length - 1;

//                 if (isLast) {
//                     // Update row.claimedAt if new row wins increased
//                     if (newRowWins > oldRowWins && position?.row != null) {
//                         newTicket.wonPatternAt.row.claimedAt = [position.row];
//                     }

//                     // Update column.claimedAt if new column wins increased
//                     if (currentPattern === "Row 1" && newColWins > oldColWins && position?.col != null) {
//                         newTicket.wonPatternAt.column.claimedAt = [position.col];
//                     }
//                 }

//                 return newRowWins > oldRowWins || newColWins > oldColWins;
//               });
          
//             } catch (err) {
//               console.error("Error while comparing newTicket with oldTickets:", err);
//               return false; // skip ticket on error
//             }
//         });

//         // return patternWinners.filter(newTicket => {
//         //     try {
//         //         if (newTicket.userTicketType !== "Physical") return true;
//         //         console.log("isSpecialPattern and gameType", isSpecialPattern, gameType)
//         //         // For special patterns (Frame, Picture, Full House), check ALL ticket types
//         //         if (isSpecialPattern && gameType == "Tv Extra") {
//         //             const matchingOldTickets = unclaimedWinners.filter(t =>
//         //                 t.ticketId === newTicket._id?.toString() &&
//         //                 t.lineType === newTicket.wonPattern
//         //             );

//         //             console.log("matchingOldTickets for tv extra game---", matchingOldTickets);

//         //             // If ticket is already in unclaimedWinners, exclude it
//         //             if (matchingOldTickets.length > 0) {
//         //                 return false;
//         //             }
//         //             return true;
//         //         }

//         //         const matchingOldTickets = unclaimedWinners.filter(t =>
//         //             t.ticketId === newTicket._id?.toString() &&
//         //             t.lineTypeDisplay === currentPattern
//         //         );
        
//         //         console.log("matchingOldTickets---", matchingOldTickets);
        
//         //         if (matchingOldTickets.length === 0) return true;

//         //         // check if withdrawBall postion matches with then winning row/column
//         //         const position = findRowColumnPosition(newTicket.tickets, +withdrawBall);
//         //         console.log("position of withdraw number in ticket", position, newTicket.rowChecks, newTicket.columnChecks);
//         //         if(position){
//         //             const valid =
//         //             currentPattern === "Row 1"
//         //                 ? (newTicket.rowChecks[position.row] >= 5 || newTicket.columnChecks[position.col] >= 5)
//         //                 : (newTicket.rowChecks[position.row] >= 5)
//         //             if (!valid) return false;
//         //             newTicket.wonPatternAt = {
//         //                 row: { indexes: getIndexesGreaterOrEqual(newTicket?.rowChecks, 5), claimedAt: [position.row] },
//         //                 column: { indexes: getIndexesGreaterOrEqual(newTicket?.columnChecks, 5), claimedAt: currentPattern === "Row 1" ? [position.col] : [] } 
//         //             };
//         //         }
                
//         //         // once position matched then check for counts
//         //         const countWins = arr => arr?.filter(v => v === 5).length || 0;
        
//         //         const newRowWins = countWins(newTicket.rowChecks);
//         //         const newColWins = countWins(newTicket.columnChecks);
                
//         //         // Check if new ticket has more completed lines than any of the matching old tickets
//         //         return matchingOldTickets.every(old => {
//         //             const oldRowWins = old?.wonElements?.rows?.length || 0;
//         //             const oldColWins = old?.wonElements?.columns?.length || 0;
                  
//         //             console.log("Comparing new wins (row:", newRowWins, ", col:", newColWins, ") with old (row:", oldRowWins, ", col:", oldColWins, ")");
//         //             return newRowWins > oldRowWins || newColWins > oldColWins;
//         //         });
//         //     } catch (innerErr) {
//         //         console.error("Error while comparing newTicket with oldTickets:", innerErr);
//         //         return false; // In case of error, skip this ticket
//         //     }
//         // });
  
//     } catch (err) {
//       console.error("Error in getWinnersOnWithdrawBall:", err);
//       return []; // Return empty array in case of failure
//     }
// }

async function getWinnersOnWithdrawBall({ patternWinners, unclaimedWinners, currentPattern, gameType, withdrawBall, isForRunningGameAddedTickets }) {
    try {
        console.log("patternWinners, unclaimedWinners, currentPattern", patternWinners, unclaimedWinners, currentPattern);
        const specialPatterns = ["Frame", "Picture", "Full House"];
        const isSpecialPattern = specialPatterns.includes(currentPattern);
    
        // Single pass
        const result = [];
        for (const newTicket of patternWinners) {
            try {
                const position = findRowColumnPosition(newTicket.tickets, +withdrawBall);

                if (position && gameType !== "Tv Extra") {
                    const rowValid = newTicket.rowChecks[position.row] >= 5;
                    const colValid = newTicket.columnChecks?.[position.col] >= 5; // safe check

                    const isValid = currentPattern === "Row 1" ? (rowValid || colValid) : rowValid;

                    if (!isValid) continue; // ❌ Skip invalid tickets immediately
                } 
                
                if(gameType === "Tv Extra" && !position){
                    continue;
                }
        
                const rowIndexes = newTicket?.rowChecks ? getIndexesGreaterOrEqual(newTicket.rowChecks, 5) : [];
                const colIndexes = newTicket?.columnChecks ? getIndexesGreaterOrEqual(newTicket.columnChecks, 5) : [];
        
                newTicket.wonPatternAt = {
                    row: { indexes: rowIndexes, claimedAt: (position?.row != null && rowIndexes.length) ? [position.row] : [] },
                    column: {
                        indexes: colIndexes,
                        claimedAt: (currentPattern === "Row 1" && position?.col != null && colIndexes.length) ? [position.col] : []
                    }
                };
        
                // If no unclaimed winners yet → include all
                if (!unclaimedWinners || unclaimedWinners.length === 0 || (gameType !== "Tv Extra" && isForRunningGameAddedTickets === true) ) {
                    result.push(newTicket);
                    continue;
                }
        
                // Only check for Physical tickets unless Tv Extra with special patterns
                if (newTicket.userTicketType !== "Physical") {  //  && !(isSpecialPattern && gameType === "Tv Extra")
                    result.push(newTicket);
                    continue;
                }
        
                const ticketId = newTicket._id?.toString();
        
                const countWins = arr => arr?.filter(v => v === 5).length || 0;
        
                const getMatchingOldTickets = (key, value) =>
                    unclaimedWinners.filter(t => t.ticketId === ticketId && t[key] === value);
        
                let include = false;
        
                // Special Tv Extra case
                if (isSpecialPattern && gameType === "Tv Extra") {
                    const frameCoords = new Set([
                        "0:0","0:1","0:2","0:3","0:4",
                        "1:0","1:4","2:0","2:4","3:0","3:4",
                        "4:0","4:1","4:2","4:3","4:4"
                    ]);
                    const pictureCoords = new Set([
                        "1:1","1:2","1:3",
                        "2:1","2:2","2:3",
                        "3:1","3:2","3:3"
                    ]);
                   
                    // check if this ticket won Full House also
                    if (newTicket.wonPattern !== "Full House") {
                        const hasFullHouse = patternWinners.some(
                            p => p.ticketId === newTicket.ticketId && p.wonPattern === "Full House"
                        );
                        console.log("is full house won for tv screen---", hasFullHouse);
                        
                        // If this player won full house then we need to check withdraw number is present on this ticket, if yes then consider all winning patterns
                        if (hasFullHouse) { // position is already present, checke don the top of function
                            include = true;
                        }else{
                            const coordKey = `${position.row}:${position.col}`;
                            if(newTicket.wonPattern == "Frame"){
                                if (frameCoords.has(coordKey)){
                                    include = true;
                                }
                            }else if(newTicket.wonPattern == "Picture"){
                                if (pictureCoords.has(coordKey)){
                                    include = true;
                                }
                            }
                        }
                    }else{
                        include = true;
                    }

                    //const matchingOldTickets = getMatchingOldTickets("lineType", newTicket.wonPattern);
                    //include = matchingOldTickets.length === 0;
                    
                } else {
                    const matchingOldTickets = getMatchingOldTickets("lineTypeDisplay", currentPattern);
        
                    if (matchingOldTickets.length === 0) {
                        include = true;
                    } else {
                        if (position) {
                            // const valid =
                            // currentPattern === "Row 1"
                            //     ? newTicket.rowChecks[position.row] >= 5 || newTicket.columnChecks[position.col] >= 5
                            //     : newTicket.rowChecks[position.row] >= 5;
            
                            // if (!valid) {
                            //     include = false;
                            // } else {
                                const newRowWins = countWins(newTicket.rowChecks);
                                const newColWins = countWins(newTicket.columnChecks);
                
                                include = matchingOldTickets.every((old, index, arr) => {
                                    const oldRowWins = old?.wonElements?.rows?.length || 0;
                                    const oldColWins = old?.wonElements?.columns?.length || 0;
                                    console.log("Comparing new wins (row:", newRowWins, ", col:", newColWins, ") with old (row:", oldRowWins, ", col:", oldColWins, ")");
                                    const isLast = index === arr.length - 1;
                                    if (isLast) {
                                        if (newRowWins > oldRowWins && position?.row != null) {
                                            newTicket.wonPatternAt.row.claimedAt = [position.row];
                                            if(currentPattern === "Row 1"){
                                                newTicket.wonPatternAt.column.claimedAt = []
                                            }
                                        }
                                        if (currentPattern === "Row 1" && newColWins > oldColWins && position?.col != null) {
                                            newTicket.wonPatternAt.column.claimedAt = [position.col];
                                            newTicket.wonPatternAt.row.claimedAt = [];
                                        }
                                    }
                
                                    return newRowWins > oldRowWins || newColWins > oldColWins;
                                });
                            //}
                        }
                    }
                }
        
                if (include) result.push(newTicket);
            } catch (innerErr) {
                console.error("Error while processing ticket:", innerErr);
            }
        }
    
        return result;
    } catch (err) {
        console.error("Error in getWinnersOnWithdrawBall:", err);
        return [];
    }
}
  
// Helper function to distribute winners
/**
 * Splits a list of winners/tickets into physical and online groups.
 *
 * Process:
 * - Iterates through each item in the given list.
 * - Uses the `includeCheck` function to determine if the item should be processed.
 * - If the item’s `userType` is "Physical":
 *   • Creates a copy of the item.
 *   • If a `withdrawNumberArray` is provided, attaches it to the item as `ballDrawned`.
 *   • Adds the updated item to the `physicalArr`.
 * - Otherwise, the item is considered "Online" and is added to `onlineArr`.
 *
 * @param {Array} list - The list of items to split.
 * @param {Function} includeCheck - A predicate function that decides if an item should be included.
 * @param {Array} physicalArr - The array where physical user items will be collected.
 * @param {Array} onlineArr - The array where online user items will be collected.
 * @param {Array} [withdrawNumberArray=[]] - Optional array of withdrawn numbers to attach to physical items.
*/
const splitByUserType = (list, includeCheck, physicalArr, onlineArr, withdrawNumberArray = []) => {
    for (const w of list) {
        if (includeCheck(w)) {
            if (w.userType === "Physical") {
                const updated = { ...w };

                if (withdrawNumberArray.length > 0) {
                    updated.ballDrawned = withdrawNumberArray;
                }

                physicalArr.push(updated);
            } else {
                onlineArr.push(w);
            }
        }
    }
};

/**
 * Updates the game and ticket data when a winner is claimed.
 *
 * Steps:
 * 1. Verify the winner is not already in `claimedWinners`.
 * 2. Update the game document:
 *    - Move winner from `unclaimedWinners` → `claimedWinners`.
 *    - Add to `winners` and `adminWinners`.
 *    - Recalculate `wonAmount` for all winners of the same lineType.
 * 3. Update ticket documents:
 *    - For the matched ticket: push winner info, mark as won, increment total winnings.
 *    - For other tickets: bulk update `winningStats` and recompute total winnings.
 * 4. Notify all winners:
 *    - Emit to agents, broadcast to admin screens, notify players, update game state.
 *
 * @async
 * @param {Object} params
 * @param {string} params.gameId - ID of the game.
 * @param {Object} params.matchedWinner - The claimed winner (ticket, line, player).
 * @param {Object} params.winnerObject - Normalized winner data to store.
 * @returns {Promise<Object|undefined>} Updated `winningStats` for the matched ticket, or undefined on error.
*/
async function claimUpdateWinnersDB({ gameId, matchedWinner, winnerObject, isAdditionalWinners }) {
    try {
        console.log("matched winner before---", matchedWinner)
        const lineType = matchedWinner.lineType;
        const filterCondition = {
            ticketId: matchedWinner.ticketId,
            lineType,
            playerId: matchedWinner.playerId,
            drawNumber: matchedWinner.currentWithdrawBallCount
        };

        const query = { _id: gameId };
        if (isAdditionalWinners === false) {
            query['otherData.claimedWinners'] = { $not: { $elemMatch: filterCondition } };
        }
  
        const updatedGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
            query,
            [
            // Stage 1: Add the new winners and remove them from unclaimed
            {
                $set: {
                    otherData: {
                        $cond: [
                            { $eq: [isAdditionalWinners, false] },
                            {
                                $mergeObjects: [
                                    "$otherData",
                                    {
                                        claimedWinners: {
                                            $concatArrays: ["$otherData.claimedWinners", [matchedWinner]]
                                        },
                                        unclaimedWinners: {
                                            $filter: {
                                                input: "$otherData.unclaimedWinners",
                                                as: "uw",
                                                cond: {
                                                    $not: {
                                                        $and: [
                                                            { $eq: ["$$uw.ticketId", matchedWinner.ticketId] },
                                                            { $eq: ["$$uw.lineType", lineType] },
                                                            { $eq: ["$$uw.playerId", matchedWinner.playerId] },
                                                            { $eq: ["$$uw.drawNumber", matchedWinner.currentWithdrawBallCount] }
                                                        ]
                                                    }
                                                }
                                            }
                                        }
                                    }
                                ]
                            },
                            "$otherData"   // <-- if isAddition true, keep existing data
                        ]
                        
                    },
                    winners: { $concatArrays: ["$winners", [winnerObject]] },
                    adminWinners: { $concatArrays: ["$adminWinners", [winnerObject]] }
                }
            },
    
            // Stage 2: Calculate total winners for the given lineType
            {
                $set: {
                _totalForPattern: {
                    $size: {
                        $filter: {
                            input: "$winners",
                            as: "w",
                            cond: { $eq: ["$$w.lineType", lineType] }
                        }
                    }
                }
                }
            },
    
            // Stage 3: Update both winners & adminWinners
            {
                $set: {
                    winners: {
                        $map: {
                            input: "$winners",
                            as: "w",
                            in: {
                                $mergeObjects: [
                                "$$w",
                                {
                                    wonAmount: {
                                        $cond: [
                                            { $eq: ["$$w.lineType", lineType] },
                                            {
                                                $round: [
                                                    { $divide: ["$$w.tempWinningPrize", "$_totalForPattern"] }
                                                ]
                                            },
                                            "$$w.wonAmount"
                                        ]
                                    }
                                }
                                ]
                            }
                        }
                    },
                    adminWinners: {
                        $map: {
                            input: "$adminWinners",
                            as: "aw",
                            in: {
                                $mergeObjects: [
                                "$$aw",
                                {
                                    wonAmount: {
                                        $cond: [
                                            { $eq: ["$$aw.lineType", lineType] },
                                            {
                                                $round: [
                                                { $divide: ["$$aw.tempWinningPrize", "$_totalForPattern"] }
                                                ]
                                            },
                                            "$$aw.wonAmount"
                                        ]
                                    }
                                }
                                ]
                            }
                        }
                    }
                }
            },
    
            // Stage 4: Remove temporary field
            { $unset: "_totalForPattern" }
            ],
            { new: true}
        );
        saveGameDataToRedisHmset('game1', gameId, { winners: updatedGame.winners, adminWinners: updatedGame.adminWinners, otherData: updatedGame.otherData });
        // winings
        //const { finalGame, addiWinners } = await checkAdditionalRowWins(winnerObject, {gameName: updatedGame.gameName, gameId: updatedGame._id, ticketsWinningPrices: updatedGame.ticketsWinningPrices, winners: updatedGame.winners, earnedFromTickets: updatedGame.earnedFromTickets, jackpotDraw: updatedGame.jackpotDraw, jackpotPrize: updatedGame.jackpotPrize, parentGameId: updatedGame.parentGameId }, ticket, currentWithdrawBall, currentWithdrawBallCount );
       
        // Extract updated wonAmount for matchedWinner
        // const updatedWinner = updatedGame.winners.find(
        //     w => w.ticketId === matchedWinner.ticketId && w.lineType === matchedWinner.lineType
        // );
        // matchedWinner.wonAmount = updatedWinner?.wonAmount ?? matchedWinner.wonAmount;
        // console.log("updated matched winner---", matchedWinner)
        // const updatedTicket = await Sys.Game.Game1.Services.GameServices.updateTicketNested(
        //     { _id: matchedWinner.ticketId, playerIdOfPurchaser: matchedWinner.playerId },
        //     {
        //         $set: {
        //             isPlayerWon: true,
        //             isTicketSubmitted: true,
        //             isWonByFullhouse: !!matchedWinner.isFullHouse,
        //             'otherData.isWinningDistributed': false
        //         },
        //         $push: {
        //             'otherData.winningStats': matchedWinner
        //         },
        //         $inc: {
        //             totalWinningOfTicket: +parseFloat(matchedWinner.wonAmount).toFixed(4)
        //         }
        //     },
        //     {new: true}
        // );

        // 2. Build map: ticketId => winner object (single winner per ticketId)
        const winnersByTicket = updatedGame.winners
        .filter(w => w.lineType === lineType)
        .reduce((acc, w) => {
            // Create a shallow copy of winner object with rounded wonAmount
            acc[w.ticketId] = {
            ...w,
            wonAmount: Number(parseFloat(w.wonAmount).toFixed(2))
            };
            return acc;
        }, {});

        // Step 3: Separate matched ticket update (push + inc) from others
        const bulkUpdates = [];
        const bulkEmitWinnerData = [];
        let updatedTicket = null;
        for (const [ticketId, winner] of Object.entries(winnersByTicket)) {
            if (ticketId === matchedWinner.ticketId) {
                // For matched ticket: push new winner to winningStats and inc total directly
                matchedWinner.wonAmount = winner.wonAmount;
                //emitWinnerData(updatedGame?.halls, [winner]);
                bulkEmitWinnerData.push(winner);
                updatedTicket = await Sys.Game.Game1.Services.GameServices.updateTicketNested(
                    { _id: matchedWinner.ticketId, playerIdOfPurchaser: matchedWinner.playerId },
                    {
                        $set: {
                            isPlayerWon: true,
                            isTicketSubmitted: true,
                            isWonByFullhouse: !!matchedWinner.isFullHouse,
                            'otherData.isWinningDistributed': false,
                        },
                        $push: {
                            'otherData.winningStats': matchedWinner,
                        },
                        $inc: {
                            totalWinningOfTicket: +parseFloat(matchedWinner.wonAmount).toFixed(2),
                        },
                    },
                    { new: true }
                );
            } else {
                bulkEmitWinnerData.push(winner);
                // For other tickets: update existing winningStats elements
                bulkUpdates.push({
                    updateOne: {
                        filter: { _id: ticketId },
                        update: [
                        {
                            $set: {
                                'otherData.winningStats': {
                                    $map: {
                                        input: '$otherData.winningStats',
                                        as: 'ws',
                                        in: {
                                            $cond: [
                                                { $eq: ['$$ws.lineType', lineType] },
                                                {
                                                    $mergeObjects: ['$$ws', { wonAmount: winner.wonAmount }],
                                                },
                                                '$$ws',
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                        {
                            $set: {
                                totalWinningOfTicket: {
                                    $sum: {
                                        $map: {
                                            input: '$otherData.winningStats',
                                            as: 'ws',
                                            in: { $toDouble: '$$ws.wonAmount' },
                                        },
                                    },
                                },
                            },
                        },
                        ],
                    },
                });
            }
        }

        // Step 4: Bulk update all other tickets in one call
        if (bulkUpdates.length > 0) {
            await Sys.Game.Game1.Services.GameServices.bulkWriteTicketData(bulkUpdates);
        }
        
        if(bulkEmitWinnerData.length > 0){
            const winningNotifications = bulkEmitWinnerData.map(winner => ({
                ticketId: winner.ticketId,
                fullHouse: !!winner.isFullHouse,
                patternName: winner.lineType,
                ticketNumber: winner.ticketNumber,
                lineType: winner.lineType,
                playerId: winner.playerId
            }));
            await Promise.allSettled([
                emitWinnerData(updatedGame?.halls, bulkEmitWinnerData),   // Emit winners to agent
                broadcastAdminNotifications(bulkEmitWinnerData, gameId),  // Send winners data to TV Screen
                notifyPlayers(winningNotifications, updatedGame.winners, gameId), // Update to online players
                updateGameState(gameId)
            ]);
        }

        return { winningStats: updatedTicket?.otherData?.winningStats, winners: updatedGame.winners }
    } catch (e) {
      console.error("Error updating claim and unclaim winners", e);
    }
}

/**
 * Sends winning notifications to online players when the game should auto-stop.
 *
 * Steps:
 * 1. Fetch game data by ID (winners, game name, number, and withdrawn numbers).
 * 2. Exit early if there are no winners.
 * 3. Determine the last draw index from `withdrawNumberArray`.
 * 4. Filter winners who:
 *    - Belong to the last draw, AND
 *    - Are not "Physical" ticket holders (only online players).
 * 5. If such winners exist, send them notifications with game details.
 *
 * @async
 * @param {Object} params
 * @param {string} params.gameId - ID of the game to process.
*/
async function onlinePlayersAutoStopOnWinningNotification({gameId}){
	try{
        console.log("onlinePlayersAutoStopOnWinningNotification called")
		// const gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData(
		// 	{ _id: gameId },
		// 	{ winners: 1, gameName: 1, gameNumber: 1, withdrawNumberArray: 1 }
		// );
        gameData = await getGameDataFromRedisHmset('game1', gameId,["winners","gameName","gameNumber","withdrawNumberArray"]);
        if(!gameData){
            gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                	{ _id: gameId },
                	{ winners: 1, gameName: 1, gameNumber: 1, withdrawNumberArray: 1 }
                );
        }
		if (!gameData || !Array.isArray(gameData.winners) || gameData.winners.length === 0) return;
		const lastDrawIndex = gameData.withdrawNumberArray?.length;
        console.log("lastDrawIndex---", lastDrawIndex,gameData.withdrawNumberArray?.length )
		const winnersAtLastDraw = gameData.winners.filter(w => w.drawNumber === +lastDrawIndex && w.userTicketType !== "Physical");
		console.log("send winner notifications to online players---", winnersAtLastDraw)
        if (winnersAtLastDraw.length === 0) return;
        
		await sendPlayerNotifications(winnersAtLastDraw, { gameName: gameData.gameName, gameNumber: gameData.gameNumber }, gameId);
	}catch(e){
		console.log("Error in online player auto stop on winning notifications", e)
	}
}

/**
 * Checks if all "Full House" winners are of type "Physical".
 *
 * @param {Object} params - Function parameters.
 * @param {Array} params.winners - List of winner objects.
 * @returns {Promise<boolean>} - Returns true if there is at least one "Full House" winner 
 *                               and all of them are "Physical", otherwise false.
 */
async function isOnlyPhysicalWinner({ winners = [] }) {
    try {
        // Filter winners to only include "Full House" line type
        const fullHouseWinners = winners.filter(w => w?.lineType === "Full House");

        // If there are no "Full House" winners, return false
        if (fullHouseWinners.length === 0) {
            return false;
        }

        // Check if every "Full House" winner has userType "Physical"
        return fullHouseWinners.every(w => w?.userType === "Physical");

    } catch (error) {
        console.error("Error in isOnlyPhysicalWinner:", error);
        return false; // fallback in case of unexpected error
    }
}

function findRowColumnPosition(ticket, target) {
    console.log("find position, ticket, ", ticket, target)
    for (let row = 0; row < ticket.length; row++) {
        for (let col = 0; col < ticket[row].length; col++) {
            if (ticket[row][col].Number === target) {
                return { row, col };
            }
        }
    }
    return null;
}

function buildWinnerObj(t, currentBall, currentCount) {
    return {
        playerId: t.playerId,
        ticketId: t.ticketId,
        lineType: t.lineType,
        wonElements: t.wonElements,
        wonAmount: t.wonAmount,
        isWinningDistributed: false,
        isJackpotWon: t?.isJackpotWon ?? false,
        isFullHouse: t?.isFullHouse,
        ballDrawned: t.ballDrawned,
        currentWithdrawBall: t.ballNumber || currentBall,
        currentWithdrawBallCount: t.drawNumber || currentCount,
        isWonAmountAdjusted: false
    };
}

/**
 * getLineTypeNumbers
 *
 * This function extracts the "line types" still available to win from 
 * a game's ticketsWinningPrices data. It filters out already-won 
 * patterns (from winners), then maps pattern names into numeric codes:
 * 
 *   - "Row 1" → 1
 *   - "Row 2" → 2
 *   - "Row 3" → 3
 *   - "Row 4" → 4
 *   - "Full House" or any variant (e.g. "Full House Within 56 Balls") → 5
 * 
 * Returns an array of unique numbers, e.g. [1, 3, 5].
 *
 * @param {Object} data - Input object containing ticketsWinningPrices and winners
 * @param {Array} data.ticketsWinningPrices - Array of ticket patterns and prizes
 * @param {Array} data.winners - Array of already-won line objects with lineType
 * @returns {number[]} Array of unique line type numbers still available
 */
function getLineTypeNumbers({ ticketsWinningPrices, winners, gameName, patternCompletedCount, currentWithdrawBallCount, ticketId }) {
    try {
        // Early return if no data
        if (!ticketsWinningPrices?.[0]) return []; //|| !winners?.length

        // Build a Set of already-won patterns for O(1) lookups
        //const winningCombinations = new Set(winners.map(w => w.lineType));
    
        const winningCombinations = new Set(
            (winners || [])
              .filter(w =>
                w.drawNumber < currentWithdrawBallCount ||
                (w.drawNumber === currentWithdrawBallCount && w.ticketId === ticketId.toString())
              )
              .map(w => w.lineType)
        );
        console.log("addition winner winningCombinations checks--", winningCombinations)
        // Extract the patterns array from the first element
        let firstPatterns = Object.values(ticketsWinningPrices[0])[0] || [];

        const gameNamePatterns = {
            "Super Nils": () => Object.keys(firstPatterns[0].winningValue)
                .map(pattern => ({ pattern })),
            "Oddsen 56": () => firstPatterns.filter(p => p.pattern !== 'Full House Within 56 Balls'),
            "Oddsen 57": () => firstPatterns.filter(p => p.pattern !== 'Full House Within 57 Balls'),
            "Oddsen 58": () => firstPatterns.filter(p => p.pattern !== 'Full House Within 58 Balls')
        };

        firstPatterns = gameNamePatterns[gameName]?.() || firstPatterns;

        // Use a Set to keep numbers unique automatically
        const lineTypeNumbers = [];
    
        // Iterate patterns once (O(n))
        for (let i = 0; i < firstPatterns.length; i++) {
            const pattern = firstPatterns[i].pattern;
            // Skip if this pattern has already been won
            if (winningCombinations.has(pattern)) continue;

            // handle row patterns dynamically
            const match = /^Row (\d+)$/.exec(pattern);
            if (match) {
                const rowNum = Number(match[1]);
                if (rowNum <= patternCompletedCount) {
                    lineTypeNumbers.push({ pattern, rows: rowNum });
                }
            } else if (pattern.startsWith("Full House")) {
                // Full House only after all 4 rows completed
                if (patternCompletedCount >= 5) {
                    lineTypeNumbers.push({ pattern, rows: 5 });
                }
            }
        }
        return lineTypeNumbers;
    } catch (err) {
        console.error("Error in getLineTypeNumbers:", err);
        return [];
    }
}

/**
 * checkAdditionalRowWins
 *
 * For non-"Tv Extra" games, this checks if the player has completed 
 * more rows than the current lineType indicates. If so, it looks up 
 * the remaining patterns (via getLineTypeNumbers) and processes 
 * them one by one.
 *
 * @param {Object} params
 * @param {string} params.gameName - Current game name
 * @param {Object} params.winnerObject - Winner object containing lineType and wonElements
 * @param {Object} params.updatedGame - Game state containing ticketsWinningPrices & winners
 */
async function checkAdditionalRowWins({
    winnerObject,
    updatedGame,
    ticket,
    currentWithdrawBall,
    currentWithdrawBallCount,
    ticketId
}) {
    try {
        const {
            gameId,
            gameName,
            ticketsWinningPrices,
            winners,
            earnedFromTickets,
            jackpotDraw,
            jackpotPrize,
            parentGameId
        } = updatedGame;
        
        if (gameName === "Tv Extra") return { finalGame: null, addiWinners: [] };

        const lineType = winnerObject?.lineType || "";
        const rows = winnerObject?.wonElements?.rows || [];

        // Count completed rows
        const patternCompletedCount = rows.length; // rows.reduce((acc, n) => acc + (n >= 5), 0);

        // Skip Full House winners
        if (lineType.startsWith("Full House")) return { finalGame: null, addiWinners: [] };

        // Current row number (Row 2 -> 2)
        const currentRowNumber = parseInt(lineType.split(" ")[1], 10);
        console.log("patternCompletedCount,currentRowNumber ", patternCompletedCount, currentRowNumber)
        // If completed rows > current row -> check extra patterns
        if (patternCompletedCount > currentRowNumber) {
            const patternsToCheck = getLineTypeNumbers({
                ticketsWinningPrices,
                winners: !winners ? []: winners,
                gameName,
                patternCompletedCount,
                currentWithdrawBallCount,
                ticketId
            });

            console.log("patternsToCheck---", patternsToCheck)

            const allWinningPatternsWithPrize = Object.values(ticketsWinningPrices);
            const addiWinners = [];

            const position = findRowColumnPosition(ticket, +currentWithdrawBall);
            const ticketsRelatedBall = [{
                ticketId: winnerObject.ticketId,
                position: `${position?.row}:${position?.col}`
            }];
            console.log("allWinningPatternsWithPrize, position, ticketsRelatedBall", allWinningPatternsWithPrize, position, ticketsRelatedBall)
            let finalGame = null;

            for (const { pattern } of patternsToCheck) {
                let winningAmount = getWinningAmount({
                    winner: { ticketColorName: winnerObject.ticketColorName, _id: winnerObject.ticketId },
                    pattern,
                    gameName,
                    allWinningPatternsWithPrize,
                    ticketsRelatedBall,
                    earnedFromTickets,
                    withdrawBallCount: currentWithdrawBallCount
                });

                if (!winningAmount) continue;

                // Clone winnerObject to avoid mutation
                const newWinner = {
                    ...winnerObject,
                    lineType: pattern,
                    lineTypeDisplay: pattern,
                    isFullHouse: pattern === "Full House",
                    wonAmount: 0,
                    tempWinningPrize: 0,
                    isWoF: false,
                    isTchest: false,
                    isMys: false,
                    isColorDraft: false
                };

                if (pattern === "Full House") {
                    switch (gameName) {
                        case "Jackpot":
                            if (currentWithdrawBallCount <= jackpotDraw) {
                                const ticketColorTemp = newWinner.ticketColorName.slice(6).toLowerCase();
                                winningAmount = +jackpotPrize[ticketColorTemp] || 0;
                                newWinner.isJackpotWon = true;
                            }
                            break;
                        case "Ball X 10":
                            winningAmount = +(winningAmount + 10 * currentWithdrawBall).toFixed(2);
                            break;
                        case "Wheel of Fortune":
                            newWinner.isWoF = true;
                            winningAmount = 0;
                            break;
                        case "Treasure Chest":
                            newWinner.isTchest = true;
                            winningAmount = 0;
                            break;
                        case "Mystery":
                            newWinner.isMys = true;
                            winningAmount = 0;
                            break;
                        case "Color Draft":
                            newWinner.isColorDraft = true;
                            winningAmount = 0;
                            break;
                        case "Innsatsen":
                            if (currentWithdrawBallCount <= jackpotDraw) {
                                const dailySchedule = await Sys.App.Services.scheduleServices.getSingleDailySchedulesData(
                                    { _id: parentGameId },
                                    { innsatsenSales: 1 },
                                    {}
                                );

                                const innBeforeSales = +parseFloat(dailySchedule.innsatsenSales).toFixed(2);
                                winningAmount = Math.min(winningAmount + innBeforeSales, 2000);
                                newWinner.isJackpotWon = true;

                                await Sys.Game.Game1.Services.GameServices.updateGame(
                                    { _id: gameId },
                                    { $set: { "otherData.isInnsatsenJackpotWon": true } }
                                );
                            }
                            break;
                    }
                }

                newWinner.wonAmount = newWinner.tempWinningPrize = Math.round(+winningAmount ?? 0);
                addiWinners.push(newWinner);
            }
            return { finalGame, addiWinners }
        }

        return [];
    } catch (err) {
        console.error("Error in checkAdditionalRowWins:", err);
        return [];
    }
}

/**
 * Calculate winning amount for a specific winner and pattern
 * @param {Object} params - Function parameters
 * @param {Object} params.winner - Winner object containing ticket information
 * @param {string} params.pattern - Pattern name (e.g., "Row 1", "Full House")
 * @param {string} params.gameName - Name of the game
 * @param {Array} params.allWinningPatternsWithPrize - Array of winning patterns with prizes
 * @param {Array} params.ticketsRelatedBall - Tickets related to the drawn ball
 * @param {number} params.earnedFromTickets - Total earnings from tickets
 * @param {number} params.withdrawBallCount - Number of balls withdrawn
 * @returns {number} - Calculated winning amount
 */
const getWinningAmount = ({ winner, pattern, gameName, allWinningPatternsWithPrize, ticketsRelatedBall, earnedFromTickets, withdrawBallCount }) => {
    try {
        const winningAmountTemp = allWinningPatternsWithPrize[0][winner.ticketColorName];
       
        if (gameName === "Super Nils") {
            const position = ticketsRelatedBall[0]?.tickets?.find(t => t.ticketId.equals(winner._id))?.position?.split(':');
            const winningColumn = position ? ["B", "I", "N", "G", "O"][+position[1]] : null;
            return winningAmountTemp.find(x => x.pattern === winningColumn)?.winningValue[pattern] || 0;
        }

        if (["Spillerness Spill", "Spillerness Spill 2", "Spillerness Spill 3"].includes(gameName)) {
            let percentage = winningAmountTemp.find(x => x.pattern === pattern)?.winningValue || 0;
            let spillAmount = parseFloat((earnedFromTickets * percentage) / 100).toFixed(2);

            if (gameName === "Spillerness Spill" || (gameName === "Spillerness Spill 2" && pattern === "Full House")) {
                let minAmount = parseFloat(winningAmountTemp.find(x => x.pattern === pattern)?.minimumWinningValue || 0).toFixed(2);
                return Math.max(spillAmount, minAmount);
            }
            return spillAmount;
        }

        if (["Oddsen 56", "Oddsen 57", "Oddsen 58"].includes(gameName) && pattern === "Full House") {
            const threshold = parseInt(gameName.split(" ")[1], 10);
            const patternToCheck = withdrawBallCount > threshold ? "Full House" : `Full House Within ${threshold} Balls`;
            return winningAmountTemp.find(x => x.pattern === patternToCheck)?.winningValue || 0;
        }

        return winningAmountTemp?.find(x => x.pattern === pattern)?.winningValue || 0;
    } catch (error) {
        console.error("Error in getWinningAmount:", error);
        return 0;
    }
};

/**
 * Compute pattern wins using draw-index method.
 *
 * @param {Array<Array<{Number:number}>>} ticket - 5x5 ticket grid.
 * @param {number[]} withdrawBallsArray - sequence of drawn balls.
 * @param {string[]} [patternsToCheck=[]] - which patterns to check (default all).
 * @returns {Array} - list of win objects { patternName, withdrawBall, totalCount, totalWithdrawCountNow }.
 */
function getUnclaimedWinForTicket(ticket, withdrawBallsArray, patternsToCheck = [], withdrawBall) {
    try{
        const n = 5;
        const idxMap = new Map();
        withdrawBallsArray.forEach((b, i) => { if (!idxMap.has(b)) idxMap.set(b, i); });
  
        // Helper: when does a cell (number) get covered
        const getIndex = (num) => (num === 0 ? -1 : (idxMap.has(num) ? idxMap.get(num) : Infinity));
  
        // Collect numbers row-wise and col-wise
        const rowsNums = ticket.map(row => row.map(c => c.Number));
        const colsNums = [...Array(n)].map((_, c) => ticket.map(row => row[c].Number));
  
        // Completion index = max draw index among cells
        const rowComp = rowsNums.map(row => Math.max(...row.map(getIndex)));
        const colComp = colsNums.map(col => Math.max(...col.map(getIndex)));
  
        // Pattern-specific cell sets
        const pictureNums = ["1:1","1:2","1:3","2:1","2:2","2:3","3:1","3:2","3:3"]
            .map(s => { const [r,c] = s.split(":").map(Number); return ticket[r][c].Number; });
        const frameNums = ["0:0","0:1","0:2","0:3","0:4","1:0","1:4","2:0","2:4","3:0","3:4","4:0","4:1","4:2","4:3","4:4"]
            .map(s => { const [r,c] = s.split(":").map(Number); return ticket[r][c].Number; });
        const fullNums = rowsNums.flat();
  
        // Pattern definitions
        const patterns = {
            "Row 1": () => Math.min(...rowComp, ...colComp),          // any row/col
            "Row 2": () => [...rowComp].sort((a,b)=>a-b)[1],          // 2nd row
            "Row 3": () => [...rowComp].sort((a,b)=>a-b)[2],
            "Row 4": () => [...rowComp].sort((a,b)=>a-b)[3],
            "Picture": () => Math.max(...pictureNums.map(getIndex)),
            "Frame":   () => Math.max(...frameNums.map(getIndex)),
            "Full House": () => Math.max(...fullNums.map(getIndex))
        };
  
        const active = Object.entries(patterns).filter(([k]) =>
            !patternsToCheck.length || patternsToCheck.includes(k)
        );
  
        const res = [];
        const totalWithdrawCountNow = withdrawBallsArray.length;
  
        for (const [name, fn] of active) {
            const ci = fn();
            if (!isFinite(ci)) continue; // pattern never completed

            const lastBall = withdrawBallsArray[ci];  
            if (withdrawBall && lastBall === withdrawBall) continue; //added skip condition


            res.push({
                patternName: name,
                withdrawBall: withdrawBallsArray[ci],
                totalCount: ci + 1, // 1-based draw count
                totalWithdrawCountNow
            });
        }
        return res;
    }catch(e){
        console.log("error in getUnclaimedWinForTicket", e)
        return []
    }
}


async function updateUnclaimedWinForTicket({gameId, newAddedTickets, lineTypesToCheck, gameName, withdrawNumberArray, withdrawBall}){
    try{
        
        const newTicketIds = newAddedTickets.map(t => t.toString());
        
        const ticketsData = await Sys.App.Services.GameService.getTicketsByData(
            { gameId, _id: {$in: newTicketIds} },
            { tickets: 1 }
        );
        
        const allWins = [];

        const patternsToCheck = gameName === "Tv Extra" ? lineTypesToCheck : [lineTypesToCheck[0]];
        withdrawNumberArray?.length && withdrawNumberArray.pop();
        console.log("patternsToCheck----", patternsToCheck, withdrawNumberArray)
        // Loop over each ticket doc
        for (const t of ticketsData) {
            if (!t.tickets) continue;

            const wins = getUnclaimedWinForTicket(t.tickets, withdrawNumberArray, patternsToCheck, withdrawBall);
            // Attach extra info for tracking
            wins.forEach(win =>
                allWins.push({
                    gameId,
                    ticketId: t._id.toString(),
                    gameName,
                    ...win
                })
            );
        }
        allWins.sort((a, b) => a.totalCount - b.totalCount);
        console.log("all wins---", allWins)
        return true;
    }catch(e){
        console.log("Error in updateUnclaimedWinForTicket", e);
    }
}

async function saveGameRedisobj(room) {
    try {
        const roomId = room?._id?.toString();
        if (!roomId) return room;
        await saveGameDataToRedisHmset('game1', roomId, {
            _id: room?._id, 
            players: room?.players, 
            gameNumber: room?.gameNumber,
            parentGameId: room?.parentGameId,
            day: room?.day,
            seconds: room?.seconds,
            achiveBallArr: room?.withdrawNumberArray,
            history: room?.withdrawNumberList,
            nextWithdrawBall: room?.otherData?.nextWithdrawBall ?? { number: null, color: null },
            lastBallDrawnTime: null,
            status: room?.status,
            startDate: room?.startDate,
            otherData: room?.otherData,
            availableBalls: [], // not required
            isBotGame: room?.otherData?.isBotGame || false, // not required
            jackPotNumber: room?.jackPotNumber, // Not required
            totalTicketCount: room?.totalNoPurchasedTickets,
            luckyNumberPrize: room?.luckyNumberPrize,
            ticketPrice: room?.ticketPrice, // Not required
            allPlayerIds: room?.players.map(player => player.id),
            gameName: room?.gameName,
            sequence: room?.sequence,
            ballNumber: [],
            count: room?.withdrawNumberArray?.length,
            subGames: room?.subGames,
            purchasedTickets: [], // Not required
            trafficLightExtraOptions:room?.trafficLightExtraOptions,
            winners:room?.winners,
            withdrawNumberArray:room?.withdrawNumberArray,
            withdrawNumberList:room?.withdrawNumberList,
            allHallsId:room?.allHallsId,
            earnedFromTickets:room?.earnedFromTickets,
            ticketsWinningPrices:room?.ticketsWinningPrices,
            jackpotDraw:room?.jackpotDraw,
            jackpotPrize:room?.jackpotPrize,
            parentGameId:room?.parentGameId,
            halls:room?.halls,
            unclaimedWinners:room?.otherData?.unclaimedWinners,
            jackpotWinners:room?.jackpotWinners,
            gameType:room?.gameType,
            luckyNumberBonusWinners:room?.luckyNumberBonusWinners,
            adminWinners:room?.adminWinners,
            gameMode:room?.gameMode,
        });
        return await getGameDataFromRedisHmset('game1', roomId, [ 'players', 'subGames', 'seconds', 'gameName', 'parentGameId', 'earnedFromTickets', 'withdrawNumberArray', 'withdrawNumberList', 'jackpotDraw', 'allHallsId', 'halls', 'otherData', 'status',"_id"]);
    } catch (error) {
        console.error('Error in saveGameRedisobj:', error);
    }
}


// Export all helper functions
module.exports = {
    sendWinnersScreenToAdmin,
    validateAddressData,
    countryNames,
    stopGameWithoutRefund,
    stopGameAndRefundAllHalls,
    stopGameAndRefundSingleHalls,
    playerVerificationStatus,
    settlePendingWinners,
    nextGameCountDownStart,
    refreshGameOnFinish,
    refreshGameWithoutCountDown,
    getMyGroupHalls,
    checkIfAutoPauseGame,
    getWinnersOnWithdrawBall,
    splitByUserType,
    claimUpdateWinnersDB,
    onlinePlayersAutoStopOnWinningNotification,
    isOnlyPhysicalWinner,
    broadcastTvScreenWinners,
    formatWinningTickets,
    getLineTypeNumbers,
    buildWinnerObj,
    checkAdditionalRowWins,
    updateUnclaimedWinForTicket,
    saveGameRedisobj
}; 
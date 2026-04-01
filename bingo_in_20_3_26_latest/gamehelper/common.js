const Sys = require('../Boot/Sys');
const moment = require('moment');
const Timeout = require('smart-timeout');
const { compareTimeSlots } = require('./all');
const { translate } = require('../Config/i18n');

// startGameCron's Helper start
const getGameQueries = () => {
    try {
        const queryTime = moment().add(1, 'day').endOf('day').toDate();
        
        return {
            queryTime,
            subGameQuery: {
                status: "active",
                gameType: { $nin: ['game_1'] },
                startDate: { $lte: queryTime },
                day: moment().format('ddd'),
                'otherData.isBotGame': false
            },
            parentGameQuery: {
                status: { $in: ["active", "running"] },
                gameType: { $in: ['game_2', 'game_3'] },
                $or: [
                    {
                        startDate: { $lte: moment().toDate() },
                        endDate: { $gte: moment().toDate() }
                    },
                    {
                        startDate: { $gte: moment().add(1, 'day').startOf('day').toDate() },
                        endDate: { $gte: moment().add(1, 'day').startOf('day').toDate() }
                    }
                ]
            }
        };
    } catch (error) {
        console.error('Error in getGameQueries:', error);
        throw error;
    }
};

// Game 2 Processing
const processGame2 = async (game, queryTime) => {
    try {
        if (game.gameMode === 'auto') {
            await processGame2Auto(game, queryTime);
        } else if (game.gameMode === 'manual') {
            await processGame2Manual(game, queryTime);
        }
    } catch (error) {
        console.error('Error processing Game 2:', error);
    }
};

const processGame2Auto = async (game, queryTime) => {
    try {
        const { _id, gameNumber, parentGameId, minTicketCount, totalNoPurchasedTickets, status, otherData, day, startDate } = game;

        const runningGame = await Sys.Game.Game2.Services.GameServices.getSingleGameByData({
            status: "running",
            day: moment().format('ddd'),
            startDate: { $lte: queryTime },
            parentGameId: parentGameId
        }, {_id: 1});

        const index = Sys.Running.indexOf(`${gameNumber}`);
        
        if (!runningGame && 
            minTicketCount <= totalNoPurchasedTickets && 
            status === "active" && 
            index <= -1 && 
            !otherData.isBotGame && 
            day === moment().format('ddd') && 
            moment().isSameOrAfter(moment(startDate))) {
            
            const parentGame = await Sys.Game.Game2.Services.GameServices.getSingleParentGame({ _id: parentGameId }, {otherData: 1});
            if(parentGame.otherData.closeDay.some(closeDay => 
                closeDay.closeDate === moment().format('YYYY-MM-DD') && 
                compareTimeSlots(moment().format('HH:mm'), closeDay.startTime, 'gte') && 
                compareTimeSlots(moment().format('HH:mm'), closeDay.endTime, 'lte')
            )) {
                return;
            }
            await Sys.Game.Game2.Controllers.GameProcess.StartGameCheck(_id, otherData.parentGameCount);
        } else if (index <= -1) {
            await handleGame2NotStarted(game);
        }
    } catch (error) {
        console.error('Error in processGame2Auto:', error);
        throw error;
    }
};

const processGame2Manual = async (game) => {
    try {
        const { _id, gameNumber, parentGameId, totalNoPurchasedTickets, totalNoTickets, status, players } = game;
        const parentGame = await Sys.Game.Game2.Services.GameServices.getSingleParentGame({ _id: parentGameId }, {days: 1, stopGame: 1});
        if (totalNoPurchasedTickets === totalNoTickets && status === "active") {
            console.log('<================================================||  Game2 Starting (Manual) || ========================================================================>');
            console.log("gameId, game Number, player count and total purchased tickets", _id, gameNumber, players.length, totalNoPurchasedTickets);
            console.log('<========================================================================================================================>');
            await Sys.Game.Game2.Controllers.GameProcess.StartGame(game);
        } else {
            console.log('Game Not Start [ Refund Process- Manual ]');
            await Sys.Game.Game2.Controllers.GameController.processRefundAndFinishGame(
                updatedGame._id, 
                { stopGame: parentGame.stopGame, _id: parentGame._id }
            );
        }
    } catch (error) {
        console.error('Error in processGame2Manual:', error);
        throw error;
    }
};

const handleGame2NotStarted = async (game) => {
    try {
        const { _id, parentGameId, day, isNotificationSent } = game;
        
        const parentGame = await Sys.Game.Game2.Services.GameServices.getSingleParentGame({ _id: parentGameId }, {days: 1, stopGame: 1});
        const slot = parentGame.days[day];
        const currentDate = moment();
        const endTime = moment().set({
            hours: parseInt(slot[1].slice(0, 2)),
            minutes: parseInt(slot[1].slice(3, 5)),
            seconds: 0
        });

        const diff = moment.duration(endTime.diff(currentDate));

        if (diff.asMinutes() > 0 && !parentGame.stopGame && day === currentDate.format('ddd')) {
            if (isNotificationSent) {
                await Sys.Game.Common.Services.GameServices.updateGame(
                    { _id: _id },
                    {
                        notificationStartTime: parentGame.notificationStartTime,
                        isNotificationSent: false
                    }
                );
            }
        } else {
            await Sys.Game.Game2.Controllers.GameController.processRefundAndFinishGame(
                _id, 
                { stopGame: parentGame.stopGame, _id: parentGame._id }
            );
        }
    } catch (error) {
        console.error('Error in handleGame2NotStarted:', error);
        throw error;
    }
};

// Similarly for Game 3
const processGame3 = async (game, queryTime) => {
    try {
        if (game.gameMode === 'auto') {
            await processGame3Auto(game, queryTime);
        } else if (game.gameMode === 'manual') {
            await processGame3Manual(game);
        }
    } catch (error) {
        console.error('Error processing Game 3:', error);
    }
};

const processGame3Auto = async (game, queryTime) => {
    try {
        const { parentGameId, gameNumber, minTicketCount, totalNoPurchasedTickets, status } = game;
        
        const [runningGame, parentGame] = await Promise.all([
            Sys.Game.Game2.Services.GameServices.getSingleGameByData({
                status: "running",
                day: moment().format('ddd'),
                startDate: { $lte: queryTime },
                parentGameId: parentGameId
            }, {_id: 1}),
            Sys.Game.Game2.Services.GameServices.getSingleParentGame({ _id: parentGameId }, {days: 1, stopGame: 1, notificationStartTime: 1, subGames: 1, otherData: 1})
        ]);
        const index = Sys.Running.indexOf(`${gameNumber}`);

        if (!runningGame && 
            minTicketCount <= totalNoPurchasedTickets && 
            status === "active" && 
            index <= -1) {
            
            const isGameOpen = !parentGame.otherData.closeDay.some(closeDay => 
                closeDay.closeDate === moment().format('YYYY-MM-DD') && 
                compareTimeSlots(moment().format('HH:mm'), closeDay.startTime, 'gte') && 
                compareTimeSlots(moment().format('HH:mm'), closeDay.endTime, 'lte')
            );
            
            if(isGameOpen){
                await handleGame3Start(game, parentGame);
            }
        } else if (index <= -1) {
            await handleGame3NotStarted(game, parentGame);
        }
    } catch (error) {
        console.error('Error in processGame3Auto:', error);
        throw error;
    }
};

// handle games which notification is sent but game not started
const handleGame3Start = async (game, parentGame) => {
    try {
        // Handle game variables at top
        const { _id, day, startDate, gameType } = game;
        const { days, stopGame, subGames } = parentGame;
        const currentDate = moment();
        const dayConfig = days[day];
        const endTime = moment().set({
            hours: parseInt(dayConfig[1].slice(0, 2)),
            minutes: parseInt(dayConfig[1].slice(3, 5)),
            seconds: 0
        });

        const diff = moment.duration(endTime.diff(currentDate));

        if (diff.asMinutes() >= 0 && 
            !stopGame && 
            day === currentDate.format('ddd') && 
            currentDate.toDate() >= moment(dayConfig[0], 'HH:mm').toDate()) {
                console.log("This Game is Ready To Start", _id)
            await Sys.Game.Game3.Controllers.GameProcess.StartGameCheck(_id, subGames.length);
        } else if (moment(startDate).startOf('day').isBefore(moment().startOf('day')) || 
                (moment(startDate).startOf('day').isSame(moment().startOf('day')) && diff.asMinutes() <= -1)) {
                console.log("Refund to all players and Finish Game 1", _id);
                await Sys.Game.Game3.Controllers.GameController.processRefundAndFinishGame(_id, { stopGame: stopGame, _id: parentGame._id }
            );
        } else if(stopGame == true){
            // parent game is deleted from admin panel so refund to the players
            await Sys.App.Controllers.GameController.refundNextGame(_id, gameType, false);
        }
    } catch (error) {
        console.error('Error in handleGame3Start:', error);
        throw error;
    }
};

const handleGame3NotStarted = async (game, parentGame) => {
    try {
        // Handle game variables at top
        const { _id, day, isNotificationSent } = game;
        const { days, stopGame, notificationStartTime, _id: parentGameId } = parentGame;
        
        const currentDate = moment();
        const endTime = moment().set({
            hours: parseInt(days[day][1].slice(0, 2)),
            minutes: parseInt(days[day][1].slice(3, 5)),
            seconds: 0
        });

        const diff = moment.duration(endTime.diff(currentDate));

        if (diff.asMinutes() > 0 && !stopGame && day === currentDate.format('ddd')) {
            if (isNotificationSent) {
                await Sys.Game.Common.Services.GameServices.updateGame(
                    { _id: _id },
                    {
                        notificationStartTime: notificationStartTime,
                        isNotificationSent: false
                    }
                );
            } else {
                console.log("Waiting For Minimum Tickets to Be purchased.", _id);
            }
        } else {
            // Refund to all players and Finish Game when today's game timer is completed and player has purchased tickets for upcoming game
            console.log("Refund to all players and Finish Game 2", _id);
            await Sys.Game.Game3.Controllers.GameController.processRefundAndFinishGame(
                _id, 
                { stopGame: stopGame, _id: parentGameId }
            );
        }
    } catch (error) {
        console.error('Error in handleGame3NotStarted:', error);
        throw error;
    }
};

const processGame3Manual = async (game) => {
    try {
        const parentGame = await Sys.Game.Game2.Services.GameServices.getSingleParentGame({ _id: game.parentGameId }, {days: 1, stopGame: 1});
        if (game.purchasedTickets.length === game.totalNoTickets && game.status === "active") {
            console.log('<================================================||  Game2 Starting (Manual) || ========================================================================>');
            console.log("gameId, game Number, player count and total purchased tickets", game._id, game.gameNumber, game.players.length, game.totalNoPurchasedTickets);
            console.log('<========================================================================================================================>');
            await Sys.Game.Game3.Controllers.GameProcess.StartGame(game);
        } else {
            console.log("Game Not Start [ Refund Process- Manual ]");
            await Sys.Game.Game3.Controllers.GameController.processRefundAndFinishGame(game._id, { stopGame: parentGame.stopGame, _id: parentGame._id });
        }
    } catch (error) {
        console.error('Error in processGame3Manual:', error);
        throw error;
    }
};

// Check if need to create child games of game 2 & 3
const checkForChildGames = async (game, queryTime) => {
    try {
        const { _id, stopGame, days, otherData } = game;
        
        if (stopGame) {
            // If game is stopped manually by admin, update status to finish
            await Sys.Game.Game2.Services.GameServices.updateParentGame({
                _id: _id
            }, {
                status: "finish"
            });
            return;
        }

        const currentDate = moment();
        const currentDay = currentDate.format('ddd');
        const nextDay = moment().add(1, 'day').format('ddd');

        // Check if game has slots for current or next day
        // Check if game has no valid days to run
        const hasCurrentDaySlot = days[currentDay] !== undefined;
        const hasNextDaySlot = days[nextDay] !== undefined;
        
        if (!hasCurrentDaySlot && !(otherData?.isBotGame === false && hasNextDaySlot)) {
            return;
        }

        // Handle current day's games
        const timeSlot = days[currentDay];
        const currentTime = currentDate.format('HH:mm');
        
        if (timeSlot && compareTimeSlots(currentTime, timeSlot[1], 'lt')) {
            await createChildGamesIfNeeded(game, currentDay, false, queryTime);
        }else if(!otherData?.isBotGame && hasNextDaySlot){
            // Handle next day's games
            const nextDayTimeSlot = days[nextDay];
            if (nextDayTimeSlot) {
                const [hours, minutes] = nextDayTimeSlot[0].split(':').map(Number);
                const nextStart = moment().add(1, 'day').set({
                    hour: hours,
                    minute: minutes,
                    second: 0,
                    millisecond: 0
                });
                
                // Check if game starts within next 24 hours
                if (nextStart.diff(currentDate, 'hours', true) <= 24) {
                    await createChildGamesIfNeeded(game, nextDay, true, queryTime);
                }
            }
        }
    } catch (error) {
        console.error('Error in checkForChildGames:', error);
        throw error;
    }
};

const createChildGamesIfNeeded = async (game, day, isNextDay, queryTime) => {
    try {
        const { _id, gameType, otherData, totalNumberOfGames } = game;
        
        if(!isNextDay){
            let query = {
                parentGameId: _id,
                status: { $in: ["active", "running"] },
            };
            let childGames = 0;
            if (!otherData.isBotGame == true) {
                query = {
                    ...query,
                    day: day,
                    startDate: { $lte: new Date(queryTime) },
                }
            }
            childGames = await Sys.Game.Common.Services.GameServices.getGameCount(query);

            if (childGames == 0) {
                if (gameType == "game_2" && otherData.isBotGame == true) {
                    Sys.Game.Common.Controllers.GameController.createChildGame(_id, day);
                } else if (gameType == "game_3" && otherData.isBotGame == true) {
                    let cildGameCount = await Sys.Game.Common.Services.GameServices.getGameCount({
                        parentGameId: _id,
                    });
                    if (totalNumberOfGames > cildGameCount) {
                        Sys.Game.Common.Controllers.GameController.createChildGame(_id, day);
                    } else {
                        //stop the game if totalNumber of game count reached
                        await Sys.Game.Game2.Services.GameServices.updateParentGame({
                            _id: _id
                        }, {
                            stopGame: true
                        });
                    }
                } else {
                    Sys.Game.Common.Controllers.GameController.createChildGame(_id, day);
                }
            }
        }else {
            const startTime = moment().add(1, 'days').startOf('day');
            const endTime = moment().add(1, 'days').endOf('day');

            let query = {
                parentGameId: _id,
                status: "active",
                day: day,
                startDate: { 
                    $gte: startTime.toDate(), 
                    $lte: endTime.toDate() 
                }
            };
            if (otherData && otherData.isBotGame == true && gameType == "game_2") {
                query = {
                    parentGameId: _id,
                    status: { $in: ['active', 'running'] },
                }
            }
            const availableGameCount = await Sys.Game.Common.Services.GameServices.getGameCount(query);
            
            if (availableGameCount == 0) {
                //Create Single Set of child Games for next day slot.
                Sys.Game.Common.Controllers.GameController.createChildGame(_id, day, true);
            }
        }
    } catch (error) {
        console.error('Error in createChildGamesIfNeeded:', error);
        throw error;
    }
};

// Process daily schedules for game 1
const processDailySchedules = async () => {
    try {
        const dateGame1 = moment().add(24, 'hours');
        const dateGame1Copy = dateGame1.clone();

        const queryGame1 = {
            status: { $in: ["active", "running"] },
            isSavedGame: false,
            startDate: { $lte: dateGame1.toDate() },
            stopGame: false
        };

        const dailyScheduleList = await Sys.App.Services.scheduleServices.getDailySchedulesByData(queryGame1, {_id: 1, status: 1, stopGame: 1, specialGame: 1, startDate: 1, endDate: 1, startTime: 1, endTime: 1, days: 1, groupHalls: 1, allHallsId: 1, masterHall: 1, halls: 1, otherData: 1});

        // Process all schedules in parallel
        await Promise.all(dailyScheduleList.map(async (schedule) => {
            try {
                if (schedule.status === "running" && !schedule.stopGame) {
                    // Process all days in parallel
                    const dayPromises = Object.entries(schedule.days).map(async ([day, scheduleId]) => {
                        await processDaySchedule(schedule, day, scheduleId, dateGame1, dateGame1Copy);
                    });

                    await Promise.all(dayPromises);
                } else if (schedule.status === "running" && schedule.stopGame) {
                    // Handle stopped games
                    await Sys.App.Services.scheduleServices.updateDailySchedulesData(
                        { _id: schedule._id },
                        { status: "finish" }
                    );
                } else if (schedule.status === "active") {
                    // Handle active games
                    Sys.Io.of('admin').emit('gameCreatedFromDailySchedules', { 
                        scheduleId: schedule._id 
                    });
                    await Sys.App.Services.scheduleServices.updateDailySchedulesData(
                        { _id: schedule._id }, 
                        { status: "running" }
                    );
                }
            } catch (error) {
                console.error(`Error processing schedule ${schedule._id}:`, error);
            }
        }));

    } catch (error) {
        console.error('Error in processDailySchedules:', error);
    }
};

const processDaySchedule = async (schedule, day, scheduleId, dateGame1, dateGame1Copy) => {
    try {
        const currentDay = dateGame1.format('ddd');
        
        // Get special games data once and reuse
        const latestData = await getSpecialGamesData(schedule);

        if (currentDay === day && isDateInRange(dateGame1, moment(schedule.startDate), moment(schedule.endDate))) {
            const childGamesCount = await Sys.Game.Common.Services.GameServices.getGameCount({
                parentGameId: schedule._id,
                day: currentDay,
                startDate: { $gte: dateGame1Copy.startOf('day') },
            });

            if (childGamesCount <= 0) {
                await Sys.Game.Common.Controllers.GameController.createGame1FromSchedule(
                    {_id: schedule._id, groupHalls: schedule.groupHalls, allHallsId: schedule.allHallsId, masterHall: schedule.masterHall, halls: schedule.halls, specialGame: schedule.specialGame, otherData: schedule.otherData}, 
                    scheduleId, 
                    day, 
                    dateGame1,
                    latestData
                );
            }
        } else if (moment().format('ddd') === day && 
            isDateInRange(moment(), moment(schedule.startDate), moment(schedule.endDate))) {
        
            const childGamesCount = await Sys.Game.Common.Services.GameServices.getGameCount({
                parentGameId: schedule._id,
                day: day,
                startDate: { $gte: moment().startOf('day') },
            });

            if (childGamesCount <= 0) {
                await Sys.Game.Common.Controllers.GameController.createGame1FromSchedule(
                    {_id: schedule._id, groupHalls: schedule.groupHalls, allHallsId: schedule.allHallsId, masterHall: schedule.masterHall, halls: schedule.halls, specialGame: schedule.specialGame, otherData: schedule.otherData},  
                    scheduleId, 
                    day, 
                    moment(),
                    latestData
                );
            }
        }
    } catch (error) {
        console.error(`Error processing day schedule for day ${day}:`, error);
    }
};

// Process special games data
const getSpecialGamesData = async (schedule) => {
    try {
        if (schedule.specialGame) return [];

        const startDate = moment().startOf('day').toDate();
        const endDate = moment().endOf('day').toDate();

        const dataQuery = {
            status: { $in: ['running', 'active'] },
            stopGame: false,
            $or: [
                { startDate: { $gte: startDate, $lte: endDate } },
                { endDate: { $gte: startDate, $lte: endDate } }
            ],
            specialGame: true
        };

        const specialGames = await Sys.App.Services.scheduleServices.getDailySchedulesByData(dataQuery, {startTime: 1, endTime: 1, halls: 1});
        
        return specialGames.filter(game => 
            hasTimeOverlap(
                schedule.startTime,
                schedule.endTime,
                game.startTime,
                game.endTime
            )
        );
    } catch (error) {
        console.error('Error in getSpecialGamesData:', error);
        return [];
    }
};

// Helper function to check time overlap
const hasTimeOverlap = (startTime, endTime, dataStart, dataEnd) => {
    return (startTime >= dataStart && startTime <= dataEnd) ||  
           (endTime >= dataStart && endTime <= dataEnd) ||      
           (startTime <= dataStart && endTime >= dataEnd);
};

const isDateInRange = (dateToCheck, startDate, endDate) => {
    return dateToCheck >= startDate && dateToCheck <= endDate;
}

// Game 1 Processing
const processGame1 = async (game) => {
    try {
        if (Timeout.exists(game._id.toString())) return;

        const remainedTimeTostartGame = moment(game.startDate)
            .subtract(5, 'seconds')
            .diff(moment());

        if (game.gameMode === 'Auto' && remainedTimeTostartGame > 0) {
            await handleAutoGame1(game, remainedTimeTostartGame);
        } else if (game.gameMode === 'Manual' && remainedTimeTostartGame > 0) {
            await handleManualGame1(game, remainedTimeTostartGame);
        }
    } catch (error) {
        console.error('Error processing Game 1:', error);
    }
};

const handleAutoGame1 = async (game, remainedTime) => {
    try {
        let tempIndex = Sys.Timers.indexOf(game._id.toString());
        if (tempIndex !== -1) {
            if (Timeout.exists(game._id.toString())) return;
            Sys.Timers.splice(tempIndex, 1);
        }

        const indexId = Sys.Timers.push(game._id.toString());
        
        Timeout.set(Sys.Timers[indexId - 1], async () => {
            try {
                await Sys.Game.Game2.Services.GameServices.updateSingleGame(
                    { _id: game._id},
                    { $set: { "otherData.disableCancelTicket": true  } },
                );
               
                Sys.Io.of(Sys.Config.Namespace.Game1).to(game._id).emit('refreshUpcomingGames', {});

                const index = Sys.Timers.indexOf(game._id.toString());
                if (index !== -1) {
                    Timeout.clear(Sys.Timers[index], true);
                    Sys.Timers.splice(index, 1);
                }

                setTimeout(async () => {
                    try {
                        const reTimeTostartGame = moment(game.startDate).diff(moment());

                        if (reTimeTostartGame > 0) {
                            setTimeout(async () => {
                                try {
                                    await startGame1(game);
                                } catch (error) {
                                    console.error('Error starting game after delay:', error);
                                }
                            }, reTimeTostartGame);
                        } else {
                            await startGame1(game);
                        }
                    } catch (error) {
                        console.error('Error in setTimeout callback:', error);
                    }
                }, 1000);
            } catch (error) {
                console.error('Error in Game 1 auto timeout:', error);
            }
        }, remainedTime);
    } catch (error) {
        console.error('Error in handleAutoGame1:', error);
    }
};

const startGame1 = async (game) => {
    try {
        const updatedGame = await Sys.Game.Game2.Services.GameServices.updateSingleGame(
            { _id: game._id, status: "active" },
            { $set: { status: "running" } },
            { new: true }
        );

        if (updatedGame) {
            updatedGame?.halls.forEach(hall => {
                Sys.Io.of('admin').to(hall).emit('refresh', { message: "New Game Started" });
            });

            const transactionUpdate = [{
                'updateMany': {
                    "filter": { "gameId": updatedGame._id.toString() },
                    "update": { '$set': { "gameStartDate": Date.now() } }
                }
            }];

            await Sys.App.Services.GameService.bulkWriteTransactionData(transactionUpdate);
            await Sys.Game.Game1.Controllers.GameProcess.StartGame(updatedGame._id);
        }
    } catch (error) {
        console.error('Error in startGame1:', error);
    }
};

const handleManualGame1 = async (game, remainedTime) => {
    try {
        let tempIndex = Sys.Timers.indexOf(game._id.toString());
        if (tempIndex !== -1) {
            if (Timeout.exists(game._id.toString())) return;
            Sys.Timers.splice(tempIndex, 1);
        }

        const indexId = Sys.Timers.push(game._id.toString());
        
        Timeout.set(Sys.Timers[indexId - 1], async () => {
            try {
                const index = Sys.Timers.indexOf(game._id.toString());
                if (index !== -1) {
                    Timeout.clear(Sys.Timers[index], true);
                    Sys.Timers.splice(index, 1);
                }
            } catch (error) {
                console.error('Error in handleManualGame1 timeout:', error);
            }
        }, remainedTime + 5000);

    } catch (error) {
        console.error('Error in handleManualGame1:', error);
        throw error;
    }
};

// Cleanup Functions
const cleanupOldGames = async () => {
    try {
        const game1QueryToRemoveOldGames = {
            status: "active",
            gameType: "game_1",
            gameMode: "Auto",
            startDate: { $lt: moment().toDate() }
        };

        const game1ListRemove = await Sys.Game.Game2.Services.GameServices.getByData(game1QueryToRemoveOldGames, { gameType: 1, startDate: 1, gameMode: 1 }, {sort: {specialGame: -1}});

        await Promise.all(game1ListRemove.map(async (game) => {
            if (Timeout.exists(game._id.toString())) return;
            
            await Sys.Game.Game2.Services.GameServices.updateSingleGame(
                { _id: game._id },
                { $set: { status: "finish", "otherData.gameSecondaryStatus": "finish" } }
            );
            await Sys.App.Controllers.scheduleController.refundCancelledGame({ gameId: game._id });
        }));

        // remove games which end time completed
        let game1QueryToRemoveSheduleGames = {
            gameType: "game_1",
            status: { $in: ["active", "running"] },
            stopGame: false,
            graceDate: { $lt: moment().subtract(45, 'seconds').toDate() }
        }
        let schGame1Remove = await Sys.Game.Game2.Services.GameServices.getByData(game1QueryToRemoveSheduleGames, { gameType: 1, graceDate: 1, parentGameId: 1 }, {sort: {specialGame: -1}});
    
        if (schGame1Remove.length > 0) {
            const remainedTimeToRemove = moment(schGame1Remove[0].graceDate)
                .tz(Intl.DateTimeFormat().resolvedOptions().timeZone)
                .diff(moment().subtract(1, 'minutes').tz(Intl.DateTimeFormat().resolvedOptions().timeZone));
            
            
            setTimeout(async () => {
                try {
                    await Promise.all(schGame1Remove.map(async (game) => {
                        await Sys.App.Controllers.scheduleController.refundCancelledGame({ gameId: game._id });
                        Sys.Io.of('admin').emit('refreshSchedule', { scheduleId: game.parentGameId });
                    }));
                } catch (error) {
                    console.error('Error in scheduled games cleanup timeout:', error);
                }
            }, remainedTimeToRemove);
        }

        // update status of partialClose games starts
        let gam1partialCloseQuery = {
            gameType: "game_1",
            status: "active",
            stopGame: false,
            'otherData.isClosed': false,
            'otherData.isPartialClose': true,
            startDate: { $gte: moment().startOf('day').toDate(), $lt: moment(new Date()).add(24, 'hours') },
            $expr: {
                $and: [
                    { $lte: ["$otherData.closeStartDate", moment(new Date()).add(15, 'seconds').toDate()] },
                    { $gte: [{ $add: ["$otherData.closeEndDate", 15000] }, "$graceDate"] }
                ]
            }
        }
        let game1ParialCloseList = await Sys.Game.Game2.Services.GameServices.getByData(gam1partialCloseQuery, { gameType: 1, startDate: 1, gameMode: 1, otherData: 1, graceDate: 1 }, {sort: {specialGame: -1}});
        
        await Sys.Game.Common.Services.GameServices.updateManyData(gam1partialCloseQuery, { $set: { 'otherData.isClosed': true, 'otherData.isPartialClose': false } });
        // update status of partialClose gamed ends
    } catch (error) {
        console.error('Error in cleanupOldGames:', error);
    }
};
// startGameCron's Helper End

// Send game 1 notitifications starts
const processGame1Notification = async (game) => {
    try {
        const {
            _id, gameMode, startDate, notificationStartTime,
            players, gameNumber
        } = game;

        if (gameMode === "Manual") return;

        const currentTime = moment();
        const startTime = moment(startDate);
        if (currentTime >= startTime) return;

        const timeUnit = notificationStartTime.slice(-1);
        const timeValue = parseInt(notificationStartTime.slice(0, -1), 10);
        const secondsToAdd = timeUnit === "m" ? timeValue * 60 : timeValue;

        const notifyAt = moment(startTime).subtract(secondsToAdd, 'seconds');
        const diff = notifyAt.diff(currentTime);
        if (diff > 0 && diff < 76 * 1000) { // 10 *1000, 76 second because maximum notification time is 15 second for agme 1
            const remainedTimeToSendNoti = Math.max(diff - 5, 0);
            const message = await generateNotificationMessage(gameNumber, timeUnit, timeValue);
            
            // Update game so that it not called again from cron
            await Sys.Game.Game2.Services.GameServices.updateSingleGame({ _id }, { $set: { isNotificationSent: true } });

            setTimeout(() => scheduleGameNotification(_id, game, secondsToAdd, message), remainedTimeToSendNoti);
        }
    } catch (error) {
        console.error('Error in processGame1Notification:', error);
    }
}

const generateNotificationMessage = async (gameNumber, timeUnit, timeValue) => {
    try {
        const key = timeUnit === "m" ? "game1_start_noti_minutes" : "game1_start_noti_seconds";

        const TimeMessage = {
            en: await translate({
                key,
                language: 'en',
                isDynamic: true,
                number: gameNumber,
                number1: timeValue
            }),
            nor: await translate({
                key,
                language: 'nor',
                isDynamic: true,
                number: gameNumber,
                number1: timeValue
            })
        };

        return TimeMessage;
    } catch (error) {
        console.error('Error in generateNotificationMessage:', error);
        return { en: '', nor: '' };
    }
}

const scheduleGameNotification = async (gameId, game, secondsToAdd, message) => {
    try {
        const notification = {
            notificationType: 'gameStartReminder',
            message: message
        };
        const bulkArr = [];
        const playerIds = [];

        for (const { id, userType } of game.players) {
            if (userType !== "Physical") {
                bulkArr.push({
                    insertOne: {
                        document: {
                            playerId: id,
                            gameId: gameId,
                            notification
                        }
                    }
                });
                playerIds.push(id);
            }
        }
        Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);

        const latestGame = await Sys.Game.Game2.Services.GameServices.getByData(
            { _id: gameId },
            { 'otherData.isClosed': 1 },
            { sort: { specialGame: -1 } }
        );

        if (latestGame?.otherData?.isClosed) return;

        Sys.Helper.gameHelper.sendNotificationToPlayers(game, playerIds, message, 'gameStartReminder');

        let remaining = secondsToAdd;
        const intervalId = setInterval(() => {
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('countDownToStartTheGame', {
                gameId,
                count: remaining--
            });
            if (remaining < 0) clearInterval(intervalId);
        }, 1000);
    } catch (err) {
        console.error("Error in scheduleGameNotification:", err);
    }
}
// Send game 1 notitifications ends

const fixedPatternByName = async (patternName) => {
    try {
        let fixedPatternType = [];
        switch (patternName) {
            case 'Row 1':
                fixedPatternType = [
                    [1, 0, 0, 0, 0, 1, 0, 0,
                        0, 0, 1, 0, 0, 0, 0, 1,
                        0, 0, 0, 0, 1, 0, 0, 0,
                        0],
                    [0, 1, 0, 0, 0, 0, 1, 0,
                        0, 0, 0, 1, 0, 0, 0, 0,
                        1, 0, 0, 0, 0, 1, 0, 0,
                        0],
                    [0, 0, 1, 0, 0, 0, 0, 1,
                        0, 0, 0, 0, 1, 0, 0, 0,
                        0, 1, 0, 0, 0, 0, 1, 0,
                        0],
                    [0, 0, 0, 1, 0, 0, 0, 0,
                        1, 0, 0, 0, 0, 1, 0, 0,
                        0, 0, 1, 0, 0, 0, 0, 1,
                        0],
                    [0, 0, 0, 0, 1, 0, 0, 0,
                        0, 1, 0, 0, 0, 0, 1, 0,
                        0, 0, 0, 1, 0, 0, 0, 0,
                        1],
                    [1, 1, 1, 1, 1, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0],
                    [0, 0, 0, 0, 0, 1, 1, 1,
                        1, 1, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0],
                    [0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 1, 1, 1, 1, 1, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0],
                    [0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 1,
                        1, 1, 1, 1, 0, 0, 0, 0,
                        0],
                    [0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 1, 1, 1, 1,
                        1],
                ];
                break;
            case 'Row 2':
                fixedPatternType = [
                    [1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0],
                    [1, 1, 1, 1, 1, 0, 0, 0,
                        0, 0, 1, 1, 1, 1, 1, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0],
                    [1, 1, 1, 1, 1, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 1,
                        1, 1, 1, 1, 0, 0, 0, 0,
                        0],
                    [1, 1, 1, 1, 1, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 1, 1, 1, 1,
                        1],
                    [0, 0, 0, 0, 0, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0],
                    [0, 0, 0, 0, 0, 1, 1, 1,
                        1, 1, 0, 0, 0, 0, 0, 1,
                        1, 1, 1, 1, 0, 0, 0, 0,
                        0],
                    [0, 0, 0, 0, 0, 1, 1, 1,
                        1, 1, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 1, 1, 1, 1,
                        1],
                    [0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 0, 0, 0, 0,
                        0],
                    [0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 1, 1, 1, 1, 1, 0,
                        0, 0, 0, 0, 1, 1, 1, 1,
                        1],
                    [0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1]
                ];
                break;
            case 'Row 3':
                fixedPatternType = [
                    [1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 0,
                        0, 0, 0, 0, 0, 0, 0, 0,
                        0],
                    [1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 0, 0, 0, 0, 0, 1,
                        1, 1, 1, 1, 0, 0, 0, 0,
                        0],
                    [1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 0, 0, 0, 0, 0, 0,
                        0, 0, 0, 0, 1, 1, 1, 1,
                        1],
                    [1, 1, 1, 1, 1, 0, 0, 0,
                        0, 0, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 0, 0, 0, 0,
                        0],
                    [1, 1, 1, 1, 1, 0, 0, 0,
                        0, 0, 1, 1, 1, 1, 1, 0,
                        0, 0, 0, 0, 1, 1, 1, 1,
                        1],
                    [1, 1, 1, 1, 1, 0, 0, 0,
                        0, 0, 0, 0, 0, 0, 0, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1],
                    [0, 0, 0, 0, 0, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 0, 0, 0, 0,
                        0],
                    [0, 0, 0, 0, 0, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 0,
                        0, 0, 0, 0, 1, 1, 1, 1,
                        1],
                    [0, 0, 0, 0, 0, 0, 0, 0,
                        0, 0, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1],
                ];
                break;
            case 'Row 4':
                fixedPatternType = [
                    [1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 0, 0, 0, 0,
                        0],
                    [1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 0,
                        0, 0, 0, 0, 1, 1, 1, 1,
                        1],
                    [1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 0, 0, 0, 0, 0, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1],
                    [1, 1, 1, 1, 1, 0, 0, 0,
                        0, 0, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1],
                    [0, 0, 0, 0, 0, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 1,
                        1]
                ];
                break;
        }
        return fixedPatternType;
    } catch (error) {
        console.error('Error in fixedPatternByName:', error);
        return [];
    }
}

// Game 2 , 3 check game availability
function updateGame23Status(result, { gameType, todaySlot, nextDaySlot, currentTime, closeDayInfo }) {
    try {
        if (todaySlot.length && compareTimeSlots(currentTime, todaySlot[0], 'gte') && compareTimeSlots(currentTime, todaySlot[1], 'lt')) { //Game is available to be played
            const { closed, slots } = closeDayInfo.today;
            result[gameType].status = (closed && compareTimeSlots(currentTime, slots[0], 'gte') && 
                                      compareTimeSlots(currentTime, slots[1], 'lte')) ? "Closed" : "Open";
            result[gameType].date = null;
        } else if (todaySlot.length && compareTimeSlots(todaySlot[0], currentTime, 'gt')) { //Game is available to purchase ticket
            const { closed, slots } = closeDayInfo.today;
            if (closed && compareTimeSlots(todaySlot[0], slots[0], 'gte')) { // tomorrow is closed
                result[gameType].status = "Closed";
                result[gameType].date = null;
            } else { // tomorrow is opened
                const [hours, minutes] = todaySlot[0].split(':');
                result[gameType].status = "Start at";
                result[gameType].date = moment().set('hour', hours).set('minute', minutes).utc().format();
            }
        }  else if(!todaySlot.length || compareTimeSlots(currentTime, todaySlot[1], 'gte')){ //current day is not in timeslot
            if (nextDaySlot.length) {
                const [hours, minutes] = nextDaySlot[0].split(':');
                const nextStart = moment().add(1, 'day').set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
                
                if ((closeDayInfo.tomorrow.closed && compareTimeSlots(nextStart.format('HH:mm'), closeDayInfo.tomorrow.slots[0], 'gte')) || 
                    (nextStart.diff(moment(), 'hours', true) > 24)) {
                    result[gameType].status = "Closed";
                    result[gameType].date = null;
                } else {
                    result[gameType].status = "Start at";
                    result[gameType].date = moment().add(1, 'day').set('hour', hours).set('minute', minutes).utc().format();
                }
            } else {
                result[gameType].status = "Closed";
                result[gameType].date = null;
            }
        }
    } catch (error) {
        console.error('Error in updateGame23Status:', error);
    }
}

function getFinalDates(startDate, endDate, gameSchedule) {
    try {
        const scheduleStartDate = moment(startDate);
        const scheduleEndDate = moment(endDate);

        const startDay = scheduleStartDate.format('ddd');
        const endDay = scheduleEndDate.format('ddd');

        const getTime = (day, fallbackHour, fallbackMinute) => {
            const time = gameSchedule[day]?.[day === moment(startDate).format('ddd') ? 0 : 1];
            if (!time) return { hour: fallbackHour, minute: fallbackMinute };
            const [hour, minute] = time.split(':').map(Number);
            return { hour, minute };
        };

        const { hour: startHour, minute: startMinute } = getTime(startDay, 0, 0);
        const { hour: endHour, minute: endMinute } = getTime(endDay, 23, 59);
       
        scheduleStartDate.set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });
        scheduleEndDate.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });

        return { scheduleStartDate, scheduleEndDate };
    } catch (error) {
        console.error("Error in getFinalDates:", error);
        return { scheduleStartDate: null, scheduleEndDate: null };
    }
}

// Used for game 4 & 5
// function getGameStatusFor24HoursNew(finalStartDate, finalEndDate, gameSchedule, closedDays) {
//     console.log("getGameStatusFor24HoursNew called", finalStartDate, finalEndDate, gameSchedule, closedDays)
//     const currentMoment = moment();
//     const endMoment = moment(currentMoment).add(24, 'hours'); // 24 hours from the current time

//     let finalStatus = {};

//     // Get today's status
//     const today = moment(currentMoment).format('YYYY-MM-DD');
//     const todayDayOfWeek = moment(currentMoment).format('ddd');
//     const [todayStartTime, todayEndTime] = gameSchedule[todayDayOfWeek] || [];
//     const currentTime = currentMoment.format('HH:mm');

//     let todayStatus = {};
//     if (moment(today).isBefore(finalStartDate, 'day')) {  // Schedule is not started yet, need to check for tomorrow
//         todayStatus = { status: "Closed", date: null };
//     }

//     if (moment(today).isAfter(finalEndDate, 'day')) {// If complete schedule is over, no need to check anything
//         return finalStatus;
//     }

//     if (todayStatus && todayStatus.status != "Closed" && todayStartTime && todayEndTime) {
//         if (moment(currentTime, 'HH:mm').isBefore(moment(todayStartTime, 'HH:mm'))) { //  game will start today but not started
//             const [hours, minutes] = todayStartTime.split(":").map(Number);
//             todayStatus = { status: "Start at", date: moment().set({ hour: hours, minute: minutes }).utc().format() };
//         } else if (moment(currentTime, 'HH:mm').isSameOrAfter(moment(todayStartTime, 'HH:mm')) &&
//             moment(currentTime, 'HH:mm').isSameOrBefore(moment(todayEndTime, 'HH:mm'))) { // current time in between the todays slot
//             todayStatus = { status: "Open", date: null };
//         } else {
//             todayStatus = { status: "Closed", date: null }; // Since the game for today has already passed
//         }
//     } else {
//         todayStatus = { status: "Closed", date: null };
//     }
    
//     // Check if there are closed periods for today
//     if (todayStatus.status != "Closed") {
//         const todayClosedDay = closedDays.find(day => day.closeDate === today);
//         if (todayClosedDay) {
//             const { utcDates } = todayClosedDay;
//             const closedStart = moment(utcDates.startTime);
//             const closedEnd = moment(utcDates.endTime);
//             const todayEndMoment = moment(moment().format("YYYY-MM-DD") + " " + todayEndTime).tz('UTC'); //moment(`${moment().format('YYYY-MM-DD')}T${todayEndTime}`);
            
//             if (moment().isSameOrAfter(closedStart) && closedEnd.isSameOrAfter(todayEndMoment)) {
//                 todayStatus = { status: "Closed", date: null }; // Closed until game end time
//             } else if (moment().isSameOrAfter(closedStart) && closedEnd.isBefore(todayEndMoment)) {
//                 const openTime = closedEnd.add(1, "minute");
//                 if (moment() >= openTime) {
//                     todayStatus = { status: "Open", date: null };
//                 } else {
//                     todayStatus = { status: "Start at", date: openTime.utc().format() }
//                 }
//             }
//         }
//     }
//     console.log("todayStatus ater checking close day for today---", todayStatus, finalStartDate, finalEndDate)

//     // Check if today's status is "Closed" and there's a game within the next 24 hours
//     if (todayStatus.status === "Closed") {

//         const tomorrow = moment(currentMoment).add(1, 'day');
//         const tomorrowDayOfWeek = tomorrow.format('ddd');
//         const [tomorrowStartTime, tomorrowEndTime] = gameSchedule[tomorrowDayOfWeek] || [];
        
//         if (moment(tomorrow).isBefore(finalStartDate, 'day')) {
//             return { status: "Closed", date: null };
//         }
//         if (moment(tomorrow).isAfter(finalEndDate, 'day')) {
//             return { status: "Closed", date: null };
//         }

//         if (tomorrowStartTime && tomorrowEndTime) {
//             // Calculate tomorrow's start time
//             const tomorrowStartMoment = moment(moment(currentMoment).add(1, 'day').format("YYYY-MM-DD") + " " + tomorrowStartTime).tz('UTC'); //moment(`${tomorrow.format('YYYY-MM-DD')}T${tomorrowStartTime}`);
//             if (tomorrowStartMoment.isBefore(endMoment)) {
//                 const [hours, minutes] = tomorrowStartTime.split(":").map(Number);
//                 finalStatus = { status: "Start at", date: tomorrow.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 }).utc().format() };
//             } else {
//                 finalStatus = { status: "Closed", date: null };
//             }
//         } else {
//             finalStatus = { status: "Closed", date: null };
//         }

//         // Check if there are closed periods for tomorrow and adjust the status accordingly
//         const tomorrowClosedDay = closedDays.find(day => day.closeDate === moment(currentMoment).add(1, 'day').format('YYYY-MM-DD'));
//         if (tomorrowClosedDay && finalStatus.status === "Start at") {
//             const closedStart = moment(tomorrowClosedDay.utcDates.startTime);
//             const closedEnd = moment(tomorrowClosedDay.utcDates.endTime);

//             const tomorrowEndMoment = moment(moment(currentMoment).add(1, 'day').format("YYYY-MM-DD") + " " + tomorrowEndTime).tz('UTC'); //moment(`${tomorrow.format('YYYY-MM-DD')}T${tomorrowEndTime}`);
//             const adjustedClosedEnd = moment.min(closedEnd, tomorrowEndMoment); // Adjusted end time
           
//             if (closedStart.isSameOrBefore(finalStatus.date) && closedEnd.isSameOrAfter(tomorrowEndMoment)) {
//                 finalStatus = { status: "Closed", date: null };
//             } else if (closedStart.isSameOrAfter(finalStatus.date) && closedEnd.isBefore(tomorrowEndMoment)) {
//                 const openTime = closedEnd.add(1, "minute").endOf('minute');
//                 const timeDiffMilliseconds = openTime.diff(moment());
//                 if (timeDiffMilliseconds < (24 * 60 * 60 * 1000)) {
//                     finalStatus = { status: "Start at", date: openTime.utc().format() };
//                 } else {
//                     finalStatus = { status: "Closed", date: null };
//                 }

//             } else if (closedStart.isSameOrBefore(finalStatus.date) && adjustedClosedEnd.isBefore(tomorrowEndMoment)) {
//                 const openTime = adjustedClosedEnd.add(1, "minute").endOf('minute');
//                 const timeDiffMilliseconds = openTime.diff(moment());
//                 if (timeDiffMilliseconds < (24 * 60 * 60 * 1000)) {
//                     finalStatus = { status: "Start at", date: openTime.utc().format() };
//                 } else {
//                     finalStatus = { status: "Closed", date: null };
//                 }
//             }
//         }

//     } else {
//         finalStatus = todayStatus
//     }
//     return finalStatus;
// }

function getGameStatusFor24HoursNew(finalStartDate, finalEndDate, gameSchedule, closedDays) {
    const now = moment();
    const endTime24h = moment(now).add(24, 'hours');
    const todayStr = now.format('YYYY-MM-DD');
    const todayDay = now.format('ddd');

    // Helper to get start/end moment for a given date and time
    const getTimeMoment = (dateStr, timeStr) => moment(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm').utc();

    // Helper to check if the game is closed due to a closedDay entry
    const isClosedDueToClosedDay = (dateStr, startTime, endTime, isToday) => {
        const closed = closedDays.find(day => day.closeDate === dateStr);
        if (!closed) return null;
    
        const closedStart = moment(closed.utcDates.startTime);
        const closedEnd = moment(closed.utcDates.endTime);
        const gameEndMoment = getTimeMoment(dateStr, endTime);
        const gameStartMoment = getTimeMoment(dateStr, startTime);
        // Ignore break if it starts after game ends
        if (!isToday && (closedStart.isAfter(gameEndMoment) || closedStart.isAfter(gameStartMoment))) {
            return null; // No effect on game
        }
        
        // ignore if break is today before the game start
        if(isToday && closedEnd.isBefore(gameStartMoment)){
            return null;
        }
        
        // If current time is before the break starts
        if (isToday && now.isBefore(closedStart)) {
            return { status: "Open", date: null };
        }
    
        // If we are in the break period and the game ends during it
        if (now.isBetween(closedStart, closedEnd, null, '[]') && closedEnd.isSameOrAfter(gameEndMoment)) {
            return { status: "Closed", date: null };
        }
    
        // If the game can resume after the break
        const reopenTime = closedEnd.clone().add(1, 'minute');
        if (reopenTime.isBefore(endTime24h)) {
            if (now.isSameOrAfter(reopenTime)) {
                return { status: "Open", date: null }; // Already reopened
            } else {
                if(isToday){
                    return { status: "Start at", date: reopenTime.utc().format() }; // Will reopen soon
                }else{
                    if(reopenTime.isAfter(gameEndMoment)){
                        return { status: "Closed", date: null };
                    }else{
                        return { status: "Start at", date: reopenTime.utc().format() }; // Will reopen soon
                    }
                }
            }
        }
    
        return { status: "Closed", date: null };
    };
    

    const processDay = (date, dayOfWeek) => {
        if (date.isBefore(finalStartDate, 'day') || date.isAfter(finalEndDate, 'day')) {
            return { status: "Closed", date: null };
        }

        const [startTime, endTime] = gameSchedule[dayOfWeek] || [];
        if (!startTime || !endTime) return { status: "Closed", date: null };

        const gameStart = getTimeMoment(date.format('YYYY-MM-DD'), startTime);
        const gameEnd = getTimeMoment(date.format('YYYY-MM-DD'), endTime);
        console.log("diff---", gameStart.diff(now, 'hours'))
        if (gameStart.diff(now) > (24 * 60 * 60000) ) {  // - (1 * 60000)
            return { status: "Closed", date: null };
        } else if (now.isBefore(gameStart)) {
            return { status: "Start at", date: gameStart.utc().format() };
        } else if (now.isBetween(gameStart, gameEnd, null, '[]')) {
            return { status: "Open", date: null };
        } else {
            return { status: "Closed", date: null };
        }
    };

    // Process today
    let todayStatus = processDay(now, todayDay);
    console.log("todayStatus--", todayStatus)
    // Adjust for closedDays if needed
    if (todayStatus.status !== "Closed") {
        const [startTime, endTime] = gameSchedule[todayDay] || [];
        const closedCheck = isClosedDueToClosedDay(todayStr, startTime, endTime, true);
        if (closedCheck) todayStatus = closedCheck;
    }
    console.log("todayStatus after closed check--", todayStatus)
    // If today is closed, check tomorrow
    if (todayStatus.status === "Closed") {
        const tomorrow = moment(now).add(1, 'day');
        const tomorrowDay = tomorrow.format('ddd');
        const tomorrowStr = tomorrow.format('YYYY-MM-DD');

        let tomorrowStatus = processDay(tomorrow, tomorrowDay);
        console.log("tomorrowStatus--", tomorrowStatus)
        if (tomorrowStatus.status === "Start at") {
            const [startTime, endTime] = gameSchedule[tomorrowDay] || [];
            const closedCheck = isClosedDueToClosedDay(tomorrowStr, startTime, endTime, false);
            if (closedCheck) tomorrowStatus = closedCheck;
        }
        console.log("tomorrowStatus after closed check--", tomorrowStatus)
        return tomorrowStatus;
    }

    return todayStatus;
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

const bankIdEmailTranslation = async(verificationType) => {
    try{
        // Fetch translations once per language
        const translationKeys = [
            'verification_reminder',
            'important_notification_about_verification',
            'bankid_reminder_greeting',
            'bankid_reminder_alert_body',
            'bankid_reminder_expiry_text',
            'bankid_reminder_ensure',
            'bankid_reminder_restriction',
            'bankid_reminder_automated_footer',
            'your_trusted_gaming_platform',
            'automated_reminder_do_not_reply',
            'all_rights_reserved',
            'expiry_date',
            'day_s',
            'your_bankid_needs_to_be_reverified_to_continue_playing',
            'id_card_expiry_reminder',
            'bankid_verification_reminder'
        ];

        // Build input as: [key, values]
        const translationPairs = translationKeys.map(key => [key, { number1: verificationType }]);

        // Fetch all at once
        const englishTranslations = await Sys.Helper.bingo.getMultipleTranslateData(translationPairs, 'english');
        const norwegianTranslations = await Sys.Helper.bingo.getMultipleTranslateData(translationPairs, 'norwegian');
        return {englishTranslations, norwegianTranslations}
    }catch(e){
        console.error("Error in bankIdEmailTranslation:", error);
        return {englishTranslations: [], norwegianTranslations: []}
    }
};

const playerForgotPassTranslation = async(language) => {
    try{
        // Fetch translations once per language
        const translationKeys = [
            'player_forgot_pass_msg',
            'player_forgot_pass_btn_name',
            'player_forgot_pass_note',
            'player_forgot_reset_password',
            'greet_hi',
            'if_you_did_not_make_this_request',
            'you_can_safely_ignore_this_email',
            'thank_you',
            'click_link_to_reset_password',
        ];
        const translationPairs = translationKeys.map(key => [key, {}]);
        // Fetch all at once
        const translations = await Sys.Helper.bingo.getMultipleTranslateData(translationPairs, language);

        return {translations}
    }catch(e){
        console.error("Error in bankIdEmailTranslation:", error);
        return {translations: []}
    }
};

module.exports = {
    processGame2, 
    processGame3, 
    checkForChildGames, 
    getGameQueries, 
    processDailySchedules, 
    processGame1,
    cleanupOldGames,
    processGame1Notification,
    fixedPatternByName,
    updateGame23Status,
    getFinalDates,
    getGameStatusFor24HoursNew,
    getGame1Status,
    getActiveGamesQuery,
    bankIdEmailTranslation,
    playerForgotPassTranslation
};
var Sys = require('../../Boot/Sys');
const moment = require('moment');

module.exports = {
    allModal: async function (req, res) {
        console.log(" called function check user here : +++++++++++")
        let obj = { error: false };
        try {

            //obj.config=config;
            let modalType = req.body.modalType;
            let modalData = req.body.data;

            if (modalType == 'editPhysicalTicket') {

                console.log("++++++++++++++++++-------REQUEST BODY------------------ : ", req.body.data)
                obj.modalCondition = 'editPhysicalTicket';

                let query = {
                    _id: req.body.data.ticketId
                };

                obj.subGameData = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.data.gameId });
                obj.ticketData = await Sys.App.Services.GameService.getByIdTicket(query);


            }
            if (modalType == 'physicalTicket') {
                obj.modalCondition = 'physicalTicket';
                let subGamesOfMaster = await Sys.App.Services.GameService.getById({ _id: modalData.gameId });
                // let subGamesOfMaster = [];
                // if(dataGame){
                //     subGamesOfMaster=await Sys.App.Services.GameService.getGamesBySelectData({ parentGameId: dataGame._id },['_id','subGames']);

                // }
                // obj.gameData = dataGame;
                // obj.gameJSON = JSON.stringify(dataGame);
                // obj.subGamesMaster =  subGamesOfMaster;
                obj.subGamesData = subGamesOfMaster;


                console.log("+++++++++++++++++++ :", subGamesOfMaster.subGames[0].ticketColorTypesNo)

            }
            if (modalType == 'generatedTicket') {
                obj.modalCondition = 'generatedTicket';
                obj.generatedTicket = modalData.generatedTicket;
                obj.ticketId = modalData.ticketId;
            }

            if (modalType == 'printPhysicalTicket') {
                obj.modalCondition = 'printPhysicalTicket';
                obj.generatedTicket = modalData.generatedTicket;
                obj.ticketId = modalData.ticketId;

            }

            if (modalType == 'uniqueWalletAdd') {
                obj.modalCondition = 'uniqueTicketDeposit';
                obj.player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ _id: modalData.id }, ['_id', 'username', 'uniquePurchaseDate', 'uniqueExpiryDate', 'walletAmount']);

            }

            if (modalType == 'uniqueTicketWithdraw') {
                obj.modalCondition = 'uniqueTicketWithdraw';
                obj.player = await Sys.App.Services.uniqueServices.getSinglePlayerData({ _id: modalData.id }, ['_id', 'username', 'uniquePurchaseDate', 'uniqueExpiryDate', 'walletAmount']);
            }



            console.log(" config data : ", obj)
            return res.render('modal-page.html', obj);

        } catch (err) {
            console.log(" ------------------------ : ", err)
            obj.error = true;
            obj.message = err['message'];
            res.render('modal-page.html', obj);
        }
    },
    home: async function (req, res) {
        try {

            /*let activeGames = await Sys.App.Services.GameService.getByData({status: 'Running'});
            let activeTables = await Sys.App.Services.RoomServices.getByData({status: 'Running'});
            let newUsers = await Sys.App.Services.PlayerServices.getLimitPlayer({status: 'Running'});*/
            let query = { userType: "Online" };
            let totalApprovedPlayerQuery = { "hall.status": "Approved", "isDeleted": false, userType: "Online" }
            // convert timestamp to date time format
            /*for (var k = 0; k < newUsers.length; k++) {
              let dt = new Date(newUsers[k].createdAt);
              let createdAt = dt.toUTCString();
              newUsers[k].createdAt = createdAt;
            }*/

            // var date = new Date();
            // var today = date.getFullYear() + "-" + parseInt(date.getMonth() + 1) + "-" + date.getDate();
            // var yesterday = date.getFullYear() + "-" + parseInt(date.getMonth() + 1) + "-" + parseInt(date.getDate() - 1);
            // var tommorow = date.getFullYear() + "-" + parseInt(date.getMonth() + 1) + "-" + parseInt(date.getDate() + 1);
            // var winnerId = [];

            let groupHallsList = await Sys.App.Services.GroupHallServices.getByData({ "status": "active" }, { name: 1 });
            console.log("groupHallsList", groupHallsList);
            // let latestRequest = await Sys.App.Services.PlayerServices.getLimitPlayer({});

            if (req.session.details.role === "admin") {
                query["hall.status"] = "Pending";
                //query["hall.agent"] = { $nin: [null, {}] };
            } else if (req.session.details.role === "agent") {
                // query["groupHall"]["status"] = "Pending";
                // query["groupHall"]["id"] = req.session.details.groupHall.id;
                query["hall.status"] = "Pending";
                query['hall.id'] = req.session.details.hall[0].id;
            }
            let latestRequest = await Sys.App.Services.PlayerServices.getAllPlayerDataTableSelected(query, { username: 1, email: 1, hall: 1, createdAt: 1 }, 0, 5, { "updatedAt": -1 }); // getPlayerData(query, { "updatedAt": -1 },5);
            let pendingRequestCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);

            // Empty the Query variable
            query = { "hall": { "$nin": [null, {}, []] }, userType: { $ne: "Bot" } };
            let topPlayers = [];
            if (req.session.details.role === "admin") {
                topPlayers = await Sys.App.Services.PlayerServices.getAllPlayerDataTableSelected(query, { username: 1, profilePic: 1, walletAmount: 1 }, 0, 5, { "walletAmount": -1 });  //getTopPlayerWithLean(query);
            } else if (req.session.details.role === "agent") {  // && req.session.details.isPermission['Players Management']
                query['hall.id'] = req.session.details.hall[0].id;
                console.log("query of top player", query)
                topPlayers = await Sys.App.Services.PlayerServices.getAllPlayerDataTableSelected(query, { username: 1, profilePic: 1, walletAmount: 1 }, 0, 5, { "walletAmount": -1 });   //getTopPlayerWithLean(query);
            }
            //console.log('topPlayers: ',topPlayers);
            //console.log("before",latestRequest);
            // convert timestamp to date time format
            // for (var m = 0; m < latestRequest.length; m++) {
            //     let dt = new Date(latestRequest[m].createdAt);
            //     latestRequest[m].createdAtFormated = moment(dt).format('YYYY/MM/DD');
            // }


            // Total game Played
            //let getTotalGamePlayed = await Sys.App.Services.GameService.getGameCount();

            // let getTopPlayers = await Sys.App.Services.PlayerServices.getLimitedPlayerWithSort({}, 5, 'chips', -1);

            //console.log("total player",getTotalPlayer.length);
            /*var platformdataObj={};
            if(getTotalPlayer != 0){
                let platformQuery =[
                    
                    {
                        "$group":{
                            "_id":{"platform":"$status"},"count":{"$sum":1}
                        }
                    },
                    {"$project":{
                        "count":1,
                        "percentage":{
                            "$multiply":[
                                {"$divide":[100,getTotalPlayer]},"$count"
                            ]
                        }
                        }
                    }
                ];
                let getPlatformdata = await Sys.App.Services.PlayerServices.aggregateQuery(platformQuery);
                    platformdataObj.android=getPlatformdata.filter(platform => platform._id.status == 'active');
                    platformdataObj.ios=getPlatformdata.filter(platform => platform._id.status == 'inactive');
            }*/

            //dates of 31 days
            // let endDate = moment().format("DD MMMM  Y"); // total 31 days report
            // let startDate = moment().subtract(30, 'days').format("DD MMMM  Y");
            // console.log("req.session.details: ", req.session.details);

            //[Count of Player,Agents, Halls , GroupHalls]
            if (req.session.details.role === "agent") {
                totalApprovedPlayerQuery['hall.id'] = req.session.details.hall[0].id;
            }
            console.log("totalApprovedPlayerQuery---", totalApprovedPlayerQuery)
            let role_all_agent_allowFlag = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Agent Management'] || [];
                let stringReplace =req.session.details.isPermission['Agent Management'] || [];
                if(!stringReplace.length){
                    role_all_agent_allowFlag = false;
                }

                if (stringReplace.indexOf("role_all_agent_allow") == -1) {
                    role_all_agent_allowFlag = false;
                }
            }
            let agneQuery = {};
            let agentStatusQuery = {"status": "active"};
            if(!role_all_agent_allowFlag){
                agneQuery = {parentId: req.session.details.id};
                agentStatusQuery = { status: "active", parentId: req.session.details.id };
            }
            let getTotalPlayer = await Sys.App.Services.PlayerServices.getPlayerCount(totalApprovedPlayerQuery); // {"hall.status":"Approved","isDeleted":false}
            let getTotalAgent = await Sys.App.Services.AgentServices.agentCount(agneQuery);
            let activeAgents = await Sys.App.Services.AgentServices.agentCount(agentStatusQuery);
            let getTotalHall = await Sys.App.Services.HallServices.getHallCount();
            let activeHalls = await Sys.App.Services.HallServices.getHallCount({ "status": "active" });
            let getTotalGroupHall = await Sys.App.Services.GroupHallServices.getHallCount();
            let activeGroupHalls = await Sys.App.Services.GroupHallServices.getHallCount({ "status": "active" });
            // let getTotalOnlinePlayers = Sys.Io.engine.clientsCount;

            // let getTotalGamePlayed = await Sys.App.Services.GameService.getGameCount();
            // let getTotalGamePlayed = await Sys.App.Services.GameService.getGameData({gameName:'Game1'});
            // for (var i = 0; i < getTotalGamePlayed.length; i++) {
            //     var roomPlayers = runningRoom[i].players;
            //     for (var j = 0; j < roomPlayers.length; j++) {
            //         if (roomPlayers[j].status == "Playing") {
            //             totalPlayingPly += 1;
            //         }
            //     }
            // }
            // [ Game Data ]
            // let getTotalGamePlayed = await Sys.App.Services.GameService.getGameCount();
            // let totalPlayersInGame1 = await Sys.App.Services.GameService.getSelectedGameCount({ gameType: 'game_1' });
            // let totalGames = await Sys.App.Services.GameService.getSelectedGameCount();
            // let totalSubGame = await Sys.App.Services.GameService.getSelectedGameSubCount();
            // let totalTickets = await Sys.App.Services.GameService.getTicketCount();
            // let totalPlayersInGame2 = await Sys.App.Services.GameService.getSelectedGameCount({ gameType: 'game_2' });
            // let totalPlayersInGame3 = await Sys.App.Services.GameService.getSelectedGameCount({ gameType: 'game_3' });
            // let totalPlayersInGame4 = await Sys.App.Services.GameService.getSelectedGameCount({ gameType: 'game_4' });

            const keysArray = [
                "version",
                "total_numbers_of",
                "approved_players",
                "total_numbers_of_active",
                "agents",
                "group_of_halls",
                "halls",
                "latest_request",
                "total_pending_request",
                "top_5_players",
                "username",
                "emailId",
                "hall",
                "agent",
                "requested_date_and_time",
                "no_data_available_in_table",
                "view_all_pending_request",
                "ongoing_game",
                "game1",
                "game2",
                "game3",
                "game4",
                "game5",
                "daily_schedule_id",
                "start_date_end_date",
                "master_halls",
                "main_game_id",
                "game_name",
                "start_date",
                "end_date",
                "prize_of_lucky_number",
                "notification_start_time",
                "total_seconds_to_display_ball",
                "number_of_minimum_tickets_to_start_the_game",
                "status",
                "game_number",
                "hall_name",
                "home",
                "total_bet",
                "system_information",
                "no_data_available", "view_all_users", "dashboard", "view_all_game"
            ];
            let dashboard = await Sys.Helper.bingo.getTraslateData(keysArray, req.session.details.language)

            var data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                classActive: 'active',
                latestRequest: latestRequest,
                totalPendingRequest: pendingRequestCount,
                topPlayers: topPlayers,
                totalPlayer: getTotalPlayer,
                totalGroupHall: getTotalGroupHall,
                activeGroupHalls: activeGroupHalls,
                totalHall: getTotalHall,
                activeHalls: activeHalls,
                agentCount: getTotalAgent,
                activeAgents: activeAgents,
                groupHallsList: groupHallsList,
                dashboardTraslate: dashboard,
                navigation: dashboard,
                /* activeGames: activeGames,
                   activeTables: activeTables,
                   newUsers: newUsers,
                   winnersToday: winnersToday,
                   activePlayers: activePlayers,
                   topFiveWinner: topFiveWinner,
                   user: req.session.details,
                   latestRequest: latestRequest,
                   totalGamePlayed: module.exports.convertBigNumber(getTotalGamePlayed),
                   totalOnlinePlayers: getTotalOnlinePlayers,
                   topPlayers: getTopPlayers,
                   platformData:platformdataObj,
                   chartStartDate: startDate,
                   chartEndDate: endDate,
                   totalPlayingPly: totalPlayingPly,
                   totalRunningGame: runningRoom.length,
                   totalLinks: 0,
                   totalGamesPlayedHall: 0,
                   totalGames: Number(totalGames) + Number(totalSubGame),
                   totalTicketsSoldHall: 0,
                   totalTicketsSoldOnline: totalTickets,
                   totalPlayersInGame1: totalPlayersInGame1,
                   totalPlayersInGame2: totalPlayersInGame2,
                   totalPlayersInGame3: totalPlayersInGame3,
                   totalPlayersInGame4: totalSubGame,
                   totalGamesPlayedOnline: getTotalGamePlayed, 
                   */
            };
            return res.render('templates/dashboard', data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    convertBigNumber: function (number) {
        if (number >= 1000000) {
            let newValue = number;
            const suffixes = ["", "K", "M", "B", "T"];
            let suffixNum = 0;
            while (newValue >= 1000) {
                newValue /= 1000;
                suffixNum++;
            }

            newValue = newValue.toPrecision(3);

            newValue += suffixes[suffixNum];
            return newValue;
        }
        return number;


    },

    getMonthlyPlayedGameChart: async function (req, res) {
        let endDate = moment().add(1, 'days').format("YYYY-MM-DD"); // total 31 days report
        let startDate = moment().subtract(30, 'days').format("YYYY-MM-DD");

        let dateDiff = (moment().diff(moment().subtract(31, 'days'))); //  because range dont take last value

        console.log("start", startDate);
        console.log("end date", endDate);
        let query = [{
            $match: {
                createdAt: {
                    $gte: new Date(startDate),
                    $lt: new Date(endDate)

                }
            }
        },
        /*{
            $addFields:{
                createdAt: {
                    $subtract: [
                        '$createdAt',
                        {
                            $add: [
                                {$multiply: [{$hour: '$createdAt'}, 3600000]},
                                {$multiply: [{$minute: '$createdAt'}, 60000]},
                                {$multiply: [{$second: '$createdAt'}, 1000]},
                                {$millisecond: '$createdAt'}
                            ]
                        }
                    ]
                },
                dateRange:{$map:{
                    input:{ $range:[0, moment(dateDiff).unix(), 60*60*24] },
                    as: "asCuRange",
                    in:{$multiply:["$$asCuRange",  1000 ]}
                }},
            }
        },
        {
            $addFields:{ 
                dateRange:{
                    $map:{
                        input:"$dateRange",
                        in:{$add:[new Date(startDate),  "$$this" ]}
                    }
                },
            }
        },
        {$unwind:"$dateRange"},*/
        {
            $group: {
                _id: {
                    $add: [
                        { $dayOfYear: "$createdAt" },
                    ]
                },
                createdAt: { $first: "$createdAt" },
                count: { $sum: 1 }
            }
        },
        { $sort: { createdAt: 1 } },
            /*{
                $project:{
                    _id:0,
                    createdAt:"$_id",
                    total:"$count",
                }
            }*/

        ];

        let monthlyGamePlayed = await Sys.App.Services.GameService.aggregateQuery(query);

        let monthlyGamePlayedSubGame = await Sys.App.Services.GameService.aggregateQuerySubGame(query);

        let mergeArr = [...monthlyGamePlayed, ...monthlyGamePlayedSubGame];
        let dailyGamePlayedArray = [];
        let dateArray = [];
        for (user of mergeArr) {
            dailyGamePlayedArray.push(user.count);
            dateArray.push(moment(user.createdAt).format("DD-MM"));

        }
        return res.json({ dailyGamePlayedArray: dailyGamePlayedArray, dateArray: dateArray });
    },

    getGameUsageChart: async function (req, res) {

        let getTotalPlayer = await Sys.App.Services.PlayerServices.getPlayerCount();

        var platformdataObj = {};
        if (getTotalPlayer != 0) {
            let platformQuery = [

                {
                    "$group": {
                        "_id": { "platform_os": "$platform_os" },
                        "count": { "$sum": 1 } //status as platform 
                    }
                },
                {
                    "$project": {
                        "count": 1,

                        "percentage": {
                            "$multiply": [
                                { "$divide": [100, getTotalPlayer] }, "$count"
                            ]
                        }

                    }
                }
            ];

            let getPlatformdata = await Sys.App.Services.PlayerServices.aggregateQuery(platformQuery);
            console.log("getPlatformdata", getPlatformdata);

            // [ Android ]
            platformdataObj.android = getPlatformdata.filter(platform => platform._id.platform_os == 'android');
            console.log("platformdataObj.android", platformdataObj.android);

            // [ ios ]
            platformdataObj.ios = getPlatformdata.filter(platform => platform._id.platform_os == 'ios');
            console.log("platformdataObj.ios", platformdataObj.ios);

            // [ Webcount ]            
            platformdataObj.webCount = getPlatformdata.filter(platform => platform._id.platform_os == 'other' || platform._id.platform_os == '');
            console.log("platformdataObj.webCount", platformdataObj.webCount);

        }
        res.json(platformdataObj);
    },

    // [ Game History ]
    gameHistory: async function (req, res) {
        try {
            // 1] Last 10 Games
            // 2] gameNumber, gameName, players, tickets, earning
            let queryGame = [
                { $match: { 'status': 'finish' } },
                { $sort: { 'createdAt': -1 } },
                { $limit: 10 },
                {
                    $project: {
                        _id: 1,
                        gameNumber: 1,
                        gameName: 1,
                        gameTypeId: 1,
                        players: { $size: "$players" },
                        tickets: { $size: "$purchasedTickets" },
                        patternWinnerHistory: 1,
                        earning: { $multiply: [{ $size: "$purchasedTickets" }, "$ticketPrice"] },
                        purchasedTickets: 1,
                        createdAt: 1,
                    }
                }
            ];
            let gameData = await Sys.App.Services.GameService.aggregateQuery(queryGame);

            // console.log(" gameData gameData gameData : ",gameData)
            // console.log('gameData: ',gameData);



            let queryNewGame = [
                { $match: { 'status': 'finish' } },
                { $sort: { 'createdAt': -1 } },
                { $limit: 10 },
                {
                    $project: {
                        _id: 1,
                        gameNumber: 1,
                        gameName: 1,
                        gameTypeId: 1,
                        players: { $size: "$players" },
                        tickets: { $size: "$purchasedTickets" },
                        patternWinnerHistory: 1,
                        totalEarning: 1,
                        purchasedTickets: 1,
                        createdAt: 1,
                    }
                }
            ];


            let subGame = await Sys.App.Services.GameService.aggregateQuerySubGame(queryNewGame);

            console.log(" subGame subGame subGame : ", subGame.length)

            for (let n = 0; n < subGame.length; n++) {
                let earn = 0;
                for (let j = 0; j < subGame[n].patternWinnerHistory.length; j++) {
                    earn = earn + Number(subGame[n].patternWinnerHistory[j].patternPrize);
                }
                subGame[n].earn = earn;
            }

            //console.log('subGame: ', subGame);

            let mergeArr = [...gameData, ...subGame];

            //console.log('mergeArr: ', mergeArr);

            var limited = mergeArr.sort((a, b) => b.createdAt - a.createdAt);

            //console.log('limited: ', limited);

            let MargeLimit = limited.filter((val, i) => i < 10);

            // console.log('\x1b[36m%s\x1b[0m', '----------------------------------');
            // console.log('\x1b[36m%s\x1b[0m', '[ Limited Data :- ' + MargeLimit + ']');
            // console.log('\x1b[36m%s\x1b[0m', '----------------------------------');
            // console.log("++++++++++ MargeLimit : ",MargeLimit)

            res.json(MargeLimit);
        } catch (err) {
            console.log("gameHistory error", err);
        }
    },

    // [RUNNING GAMES]
    ongoingGames: async function (req, res) {
        try {
            // 1] Last 10 Games
            // 2] gameNumber, gameName, players, tickets, earning
            let finalData = [];
            console.log("req.params in ongoingGames", req.params.gameType);
            let gameType = 'game_2';
            if (req.params.gameType == 'myGame1') {
                gameType = 'game_1';
                let query = {
                    status: 'running',
                    isSavedGame: false,
                    stopGame: false
                }
                if (req.session.details.role === "agent") {
                    query.halls = { $in: [req.session.details.hall[0].id] }
                }
                let data = await Sys.App.Services.scheduleServices.getDailySchedulesDatatable(query, null, null, { startDate: 1 });
                console.log("game_1 data", data);
                for (let i = 0; i < data.length; i++) {
                    let dataGame = {}
                    dataGame = {
                        _id: data[i]._id,
                        dailyScheduleId: data[i].dailyScheduleId,
                        startDate: data[i].startDate,
                        endDate: data[i].endDate,
                        groupHalls: data[i].groupHalls,
                        masterHall: data[i].masterHall,
                        status: data[i].status,
                        isStop: data[i].stopGame
                    }
                    finalData.push(dataGame);
                }
                console.log("game_1 final data", data.length);
            } else if (req.params.gameType == 'myGame2' || req.params.gameType == 'myGame3') {
                gameType = (req.params.gameType == 'myGame3') ? 'game_3' : 'game_2';
                let queryGame = [
                    { $match: { 'status': 'running', 'gameType': gameType, 'stopGame': false } },
                    { $sort: { 'startDate': -1 } },
                    { $limit: 10 },
                    {
                        $project: {
                            _id: 1,
                            gameTypeId: 1,
                            gameNumber: 1,
                            gameName: 1,
                            startDate: 1,
                            endDate: 1,
                            luckyNumberPrize: 1,
                            notificationStartTime: 1,
                            groupHalls: 1,
                            seconds: 1,
                            minTicketCount: 1,
                            dailyScheduleId: 1,
                            masterHall: 1,

                        }
                    }
                ];
                if (req.session.details.role === "agent") {
                    queryGame[0]["$match"]['allHallsId'] = { $in: [req.session.details.hall[0].id] }
                }

                console.log('queryGame', queryGame);
                let gameData = await Sys.App.Services.GameService.aggregateQueryParentGame(queryGame);

                console.log("data of running games of game 2", gameData.length);

                let limited = gameData.sort((a, b) => b.startDate - a.startDate);

                let MargeLimit = limited.filter((val, i) => i < 10);

                for (let i = 0; i < MargeLimit.length; i++) {
                    let groupofHall = MargeLimit[i].groupHalls.map((data) => { return { name: data.name, id: data.id } });
                    finalData.push({
                        _id: MargeLimit[i]._id,
                        gameTypeId: MargeLimit[i].gameTypeId,
                        gameNumber: MargeLimit[i].gameNumber,
                        gameName: MargeLimit[i].gameName,
                        startDate: MargeLimit[i].startDate,
                        endDate: MargeLimit[i].endDate,
                        seconds: MargeLimit[i].seconds,
                        minTicketCount: MargeLimit[i].minTicketCount,
                        groupOfHalls: groupofHall,
                        luckyNumberPrize: MargeLimit[i].luckyNumberPrize,
                        notificationStartTime: MargeLimit[i].notificationStartTime
                    });
                }
            } else if (req.params.gameType == 'myGame4') {
                gameType = 'game_4';
            } else if (req.params.gameType == 'myGame5') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                let query = { 'otherData.isBotGame': false, startDate: { $gte: today }, status: 'Running' };
                finalData = await Sys.Game.Game5.Services.GameServices.getSubgameByData(query, { gameNumber: 1, earnedFromTickets: 1, startDate: 1, seconds: 1, halls: 1, status: 1 }, { limit: 100 });
            }

            return res.json(finalData);
        } catch (err) {
            console.log("ongoingGames error in dashboard", err);
            return res.json([]);
        }
    },

    // [Top 5 Players on dashboards]
    getTopPlayers: async function (req, res) {
        let keys = ["server_error","top_5_player_list"]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
        try {

            console.log("req.params in getTopPlayers", req.params);
            let topPlayers = [];
            if (req.params.id !== "0") {
                topPlayers = await Sys.App.Services.PlayerServices.getTopPlayerWithLean({ "groupHall.id": req.params.id });
            } else {
                topPlayers = await Sys.App.Services.PlayerServices.getTopPlayerWithLean({});
            }
            console.log("topPlayers", topPlayers.length);
            let result = [];
            for (let index = 0; index < topPlayers.length; index++) {
                const element = topPlayers[index];
                result.push({
                    _id: element._id,
                    username: element.username,
                    points: Math.round(element.points),
                    profilePic: element.profilePic
                });

            }
            console.log("result", result.length);
            // topPlayers.map(function (test) {
            //     return Math.round(test.points);
            // });
            return res.send({
                status: "success",
                message: translate.top_5_player_list,//"Top 5 players List",
                result: result
            });
        } catch (error) {
            console.log("Error in getTopPlayers :", error);
            return res.send({
                status: "fail",
                message: translate.server_error ,//"Server Error!",
                result: []
            });
        }
    },
}
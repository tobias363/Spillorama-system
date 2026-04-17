const Sys = require('../../Boot/Sys');
const moment = require('moment-timezone');
const Timeout = require('smart-timeout');
const { translate } = require('../../Config/i18n');
const { default: mongoose } = require('mongoose');
const { updatePlayerHallSpendingData, getAvailableHallLimit, checkGamePlayAtSameTimeForRefund } = require('../../gamehelper/all');
const fs = require('fs');
const path = require('path');
const { stopGameWithoutRefund, stopGameAndRefundAllHalls, stopGameAndRefundSingleHalls, getMyGroupHalls, claimUpdateWinnersDB, broadcastTvScreenWinners, buildWinnerObj, checkAdditionalRowWins, sendWinnersScreenToAdmin, nextGameCountDownStart, refreshGameWithoutCountDown } = require('../../gamehelper/game1-process');
module.exports = {
    addDailyBalance: async function (req, res) {
        try {
            let { amount } = req.body;
            let hallId, agentId;
            amount = parseFloat(amount);

            if (isNaN(amount) || amount <= 0) {
                // Adding translation to error messages
                let keys = ["amount_must_be_greater_than_zero"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                return res.json({ status: "fail", message: agentData.amount_must_be_greater_than_zero });
            }

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                hallId = req.session.details.hall[0].id;
                agentId = req.session.details.id;
            } else {
                // Translation for "Agent not found"
                let keys = ["agent_not_found"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                return res.json({ status: "fail", message: agentData.agent_not_found });
            }

            let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, hallCashBalance: 1, otherData: 1 });
            if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                if (!hallsData.activeAgents.some(agent => agent.id == agentId)) {
                    // Translation for 'Please ensure the previous agent logs out before adding balance'
                    let keys = ["previous_agent_logout_needed"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.json({ status: "fail", message: agentData.previous_agent_logout_needed });
                }

                if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                    // Translation for settlement pending message
                    let keys = ["previous_day_settlement_pending"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.json({ status: "fail", message: agentData.previous_day_settlement_pending });
                }

                if (hallsData.hallCashBalance < amount) {
                    // Translation for 'You cannot add amount more than Hall's total Cash Balance'
                    let keys = ["amount_more_than_hall_balance"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.json({ status: "fail", message: agentData.amount_more_than_hall_balance });
                }

                let newExtraTransaction = {
                    hallId: hallId,
                    agentId: agentId,
                    playerId: agentId,
                    agentName: req.session.details.name,
                    playerName: req.session.details.name,
                    action: "credit", // debit / credit
                    amount: +amount,
                    typeOfTransaction: "Add Daily Balance",
                    hall: req.session.details.hall[0],
                    groupHall: hallsData.groupHall,
                };

                let response = await Sys.Helper.gameHelper.dailyBalanceTransfer(newExtraTransaction);
                if (!response || response.status == "fail") {
                    // Translation for general failure message
                    let keys = ["something_went_wrong_please_try_again_later"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                }

                req.session.details.dailyBalance = +parseFloat(response.dailyBalance).toFixed(2);
                // Success response with translated message
                let keys = ["daily_balance_updated_successfully"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                res.json({ status: "success", message: agentData.daily_balance_updated_successfully, dailyBalance: +parseFloat(response.dailyBalance).toFixed(2) });

            } else {
                // Translation for failure message
                let keys = ["something_went_wrong_please_try_again_later"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
            }
        } catch (e) {
            console.log("Error while adding daily balance:", e);
            // Translation for general failure message
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
        }
    },


    getDailyBalance: async function (req, res) {
        try {
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    let index = hallsData.activeAgents.findIndex((e) => e.id == agentId);
                    if (index !== -1) {
                        let dailyBalance = hallsData.activeAgents[index].dailyBalance;
                        // Fetch translated success message
                        let keys = ["daily_balance_of_hall"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                        return res.json({ status: "success", message: agentData.daily_balance_of_hall, dailyBalance: +parseFloat(dailyBalance).toFixed(2) });
                    } else {
                        // Fetch translated "Agent not found" message
                        let keys = ["agent_not_found"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                        return res.json({ status: "fail", message: agentData.agent_not_found });
                    }
                } else {
                    // Fetch translated "Agent not found" message
                    let keys = ["agent_not_found"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.json({ status: "fail", message: agentData.agent_not_found });
                }

            } else {
                // Fetch translated "Agent not found" message
                let keys = ["agent_not_found"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                return res.json({ status: "fail", message: agentData.agent_not_found });
            }
        } catch (e) {
            console.log("Error while getting daily balance :", e);
            // Fetch translated failure message
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
        }
    },

    registerUserAddBalanceView: async function (req, res) {
        try {
            // Define the translation keys for necessary messages
            let keys = ["register_user_balance_error", "register_user_balance_success"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error") || agentData.register_user_balance_error,
                success: req.flash("success") || agentData.register_user_balance_success,
                session: req.session.details,
                action: "add",
                agentData: agentData,  // Add agentData
                navigation: agentData  // Add agentData directly for navigation
            };

            return res.render('cash-inout/register-user-balance', data);
        } catch (e) {
            console.log("Error in view of agent register user", e);
            // Optionally, add a translated error message here as well
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
        }
    },


    registerUserWithdrawBalanceView: async function (req, res) {
        try {
            // Check if the agent has permission for withdraw_username_uniqueId
            let withdraw_username_uniqueId = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Players Management'] || [];
                let stringReplace =req.session.details.isPermission['Players Management'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Players Management'];
                if (!stringReplace || stringReplace.indexOf("withdraw_username_uniqueId") == -1) {
                    withdraw_username_uniqueId = false;
                }
            }

            // If the agent does not have permission, redirect to the dashboard with an error
            if (withdraw_username_uniqueId == false) {
                let translate = await Sys.Helper.bingo.getTraslateData(["you_are_not_allowed_to_access_that_page"], req.session.details.language)
                req.flash('error', translate.you_are_not_allowed_to_access_that_page);//'You are Not allowed to access that page.');
                return res.redirect('/dashboard');
            }

            // Fetch translation data for messages
            let keys = ["register_user_balance_error", "register_user_balance_success", "navigation_message"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error") || agentData.register_user_balance_error,
                success: req.flash("success") || agentData.register_user_balance_success,
                session: req.session.details,
                action: "withdraw",
                agentData: agentData,  // Pass agentData with translated messages
                navigation: agentData   // Pass agentData for navigation as well
            };

            return res.render('cash-inout/register-user-balance', data);
        } catch (e) {
            console.log("Error in view of agent register user", e);
            // Optionally, add a translated error message here as well
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
        }
    },


    checkForValidAgentPlayer: async function (req, res) {
        // try {
        //     // Build the username regex pattern
        //     let username = '^' + req.body.userName + '$';
        //     console.log("username---", username);

        //     let userCount = 0;
        //     //let query = { 'hall.id': req.session.details.hall[0].id, userType: "Online" };
        //     let query = { 'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } }, userType: "Online" };

        //     if (username) {
        //         query.$or = [
        //             { customerNumber: isNaN(Number(req.body.userName)) ? null : Number(req.body.userName) },
        //             { username: { '$regex': username } }
        //         ];
        //         // Get the count of matching players
        //         userCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);
        //     }

        //     console.log("checkForValidAgentPlayer count", userCount);

        //     // Fetch the translated messages
        //     let keys = [
        //         "please_enter_valid_username",
        //         "something_went_wrong_please_try_again_later",
        //     ];
        //     let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

        //     // If player count is more than 0, return valid
        //     if (userCount > 0) {
        //         return res.send({ "valid": true });
        //     }

        //     // Otherwise, return invalid with the translated message
        //     return res.send({ "valid": false, "message": agentData.please_enter_valid_username });
        // } catch (e) {
        //     console.log("Error in checkForValidAgentPlayer", e);
        //     // Fetch the fallback error message from the translation keys
        //     let keys = ["something_went_wrong_please_try_again_later"];
        //     let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        //     return res.send({ "valid": false, "message": agentData.something_went_wrong_please_try_again_later });
        // }
        try {
            // Fetch the translated messages
            let keys = [
                "please_enter_valid_username",
                "something_went_wrong_please_try_again_later",
            ];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            // Build the username regex pattern for partial matching
            let username = req.body.userName; // No need for `^` or `$`

            let query;
            if (username == "") {
                return res.send({ "valid": [], "message":  agentData.please_enter_valid_username });
            }else{
                // query = {
                //     'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
                //     userType: "Online",
                //     $or: [
                //         { $expr: { $regexMatch: { input: { $toString: "$customerNumber" }, regex: username, options: "i" } } },
                //         { username: { $regex: username, $options: "i" } }, // Partial match in username
                //         { phone: { $regex: username, $options: "i" } }, // Partial match in phone number
                //     ]
                // };
                query = {
                    'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
                    userType: "Online",
                    $or: [
                        { $expr: { $regexMatch: { input: { $toString: "$customerNumber" }, regex: `^${username}`, options: "i" } } }, // Starts with customerNumber
                        { username: { $regex: `^${username}`, $options: "i" } }, // Starts with username
                        { phone: { $regex: `^${username}`, $options: "i" } }, // Starts with phone number
                    ]
                };
            }

            // Get the matching players
            let userData = await Sys.App.Services.PlayerServices.getByDataForSpecificFields(query);
            // Return result based on data found
            return res.send({ "valid": userData, "message": userData.length > 0 ? "" : agentData.please_enter_valid_username });

        } catch (e) {
            console.log("Error in checkForValidAgentPlayer", e);
            // Fetch the fallback error message from the translation keys
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            return res.send({ "valid": false, "message": agentData.something_went_wrong_please_try_again_later });
        }

    },


    getRegisterUserBalance: async function (req, res) {
        try {
            const { username, id, action } = req.query;
            console.log("username, id and action", username, id, action);

            // Translation keys for dynamic messages
            let keys = [
                "something_went_wrong_please_try_again_later",
                "user_not_found",
                "agent_not_found",
                "please_provide_username_or_id",
                "winnings"
            ];

            // Fetch translated messages using getTraslateData
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            // Check if the agent is logged in
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                let user;
                let query = {
                    //'hall.id': req.session.details.hall[0].id,
                    'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
                    userType: "Online",
                    $or: [
                        { customerNumber: isNaN(Number(username)) ? null : Number(username) },
                        { username: username }
                    ]
                };

                // Check if both id and username are provided, or just username
                if (id && username) {
                    query._id = id;
                    user = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { walletAmount: 1, approvedHalls: 1 });
                } else if (username) {
                    user = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { walletAmount: 1, approvedHalls: 1 });
                } else {
                    // If neither id nor username is provided, return a translated message
                    return res.json({ status: "fail", message: agentData.please_provide_username_or_id });
                }

                if (user) {
                    const userBalance = +parseFloat(user?.walletAmount).toFixed(2);
                    let addUserStats = {
                        totalWithdrawals: 0,
                        totalDeposits: 0,
                        totalWinning: 0,
                        totalTicketPurchases: 0,
                        totalProfitLoss: 0,
                        balance: userBalance,
                    };
                    if(action && action == "add"){
                        const startOfDay = moment().startOf('day').toDate();
                        const endOfDay = moment().endOf('day').toDate();
                        const pipeline = [
                            {
                                $match: {
                                    playerId: user._id.toString(),
                                    createdAt: { $gte: startOfDay, $lte: endOfDay },
                                    status: "success"
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalWithdrawals: {
                                        $sum: {
                                            $cond: [
                                                {  
                                                    $or: [
                                                        { $eq: ["$typeOfTransaction", "Withdraw in Hall"] },
                                                        { $eq: ["$typeOfTransaction", "Withdraw in Bank"] },
                                                        { $eq: ["$typeOfTransaction", "Withdraw Money By Agent"] },
                                                    ]
                                                },
                                                "$typeOfTransactionTotalAmount", 0
                                            ]
                                        }
                                    },
                                    totalDeposits: {
                                        $sum: {
                                            $cond: [
                                                {
                                                    $or: [
                                                        { $eq: ["$typeOfTransaction", "Deposit"] },
                                                        { $eq: ["$typeOfTransaction", "Deposit By Pay in Hall"] },
                                                        { $eq: ["$typeOfTransaction", "Add Money By Agent"] }
                                                        
                                                    ]
                                                },
                                                "$typeOfTransactionTotalAmount", 0
                                            ]
                                        }
                                    },
                                    totalBuy: {
                                        $sum: {
                                            $cond: [
                                                { $or: [
                                                    { $eq: ["$game1Slug", "buyTicket"] },
                                                    { $eq: ["$game1Slug", "replaceTicket"] },
                                                    { $eq: ["$defineSlug", "buyTicket"] },
                                                    { $and: [{ "$eq": ["$gameType", "game_5"] }, { "$eq": ["$typeOfTransaction", "Game Joined"] }] },
                                                    { $eq: [ "$typeOfTransaction", "Metronia Ticket Purchase"] },
                                                    { $eq: [ "$typeOfTransaction", "Metronia Add To Ticket"] }, 
                                                    { $eq: [ "$typeOfTransaction", "OK Bingo Ticket Purchase"] },
                                                    { $eq: [ "$typeOfTransaction", "OK Bingo Add To Ticket"] },
                                                ]}, "$typeOfTransactionTotalAmount", 0
                                            ]
                                        }
                                    },
                                    totalCancel: {
                                        $sum: {
                                            $cond: [
                                                { $or: [
                                                    { $eq: ["$game1Slug", "cancelTicket"] },
                                                    { $eq: ["$defineSlug", "cancelTicket"] },
                                                    { $eq: [ "$typeOfTransaction", "Metronia Close Ticket"] },
                                                    { $eq: [ "$typeOfTransaction", "OK Bingo Close Ticket"] },
                                                ]}, "$typeOfTransactionTotalAmount", 0
                                            ]
                                        }
                                    },
                                    totalWinning: { "$sum": "$winningPrice" }
                                }
                            },
                            {
                                $project: {
                                    _id: 0,
                                    totalWithdrawals: 1,
                                    totalDeposits: 1,
                                    totalTicketPurchases: { $subtract: ["$totalBuy", "$totalCancel"] },
                                    totalWinning: 1,
                                    totalProfitLoss: {
                                        $let: {
                                            vars: {
                                                totalSpent: { $subtract: ["$totalBuy", "$totalCancel"] }
                                            },
                                            in: {
                                                $cond: {
                                                    if: { $gt: ["$totalWinning", "$$totalSpent"] },
                                                    then: { $subtract: ["$totalWinning", "$$totalSpent"] }, // Profit (positive)
                                                    else: { $multiply: [{ $subtract: ["$$totalSpent", "$totalWinning"] }, -1] }  // Loss (negative)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        ];
                        const result = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(pipeline);
                        if(result && result.length > 0){
                            addUserStats = {
                                totalWithdrawals: result[0].totalWithdrawals || 0,
                                totalDeposits: result[0].totalDeposits || 0,
                                totalWinning: result[0].totalWinning || 0,
                                totalTicketPurchases: result[0].totalTicketPurchases || 0,
                                totalProfitLoss: result[0].totalProfitLoss || 0,
                                balance: userBalance,
                                remainingDailyLimit: "0 Kr",
                                remainingMontlyLimit: "0 Kr",
                            };
                        }
                        
                        const approvedHalls = await getAvailableHallLimit({ playerId: user._id, approvedHalls: user?.approvedHalls?.filter(item => item.id === req.session.details.hall[0].id), dailyMonthlyLimit: true });
                        
                        if(approvedHalls.length > 0){
                            let hallDailyLimit = approvedHalls[0]?.dailyLimit;
                            let hallMonthlyLimit = approvedHalls[0]?.monthlyLimit;
                            addUserStats.remainingDailyLimit = `${Math.floor(parseFloat(hallDailyLimit?.total || 0))} Kr (${Math.floor(parseFloat(hallDailyLimit?.effective || 0))} Kr, ${agentData.winnings}: ${Math.floor(parseFloat(hallDailyLimit?.winning || 0))} kr)`;
                            addUserStats.remainingMonthlyLimit = `${Math.floor(parseFloat(hallMonthlyLimit?.total || 0))} Kr (${Math.floor(parseFloat(hallMonthlyLimit?.effective || 0))} Kr, ${agentData.winnings}: ${Math.floor(parseFloat(hallMonthlyLimit?.winning || 0))} Kr)`;
                        }
                    }
                    return res.json({
                        status: "success",
                        balance: userBalance,
                        playerId: user.id,
                        addUserStats
                    });
                } else {
                    // If user is not found, return a translated error message
                    return res.json({ status: "fail", message: agentData.user_not_found });
                }
            } else {
                // If the agent is not found, return a translated message
                return res.json({ status: "fail", message: agentData.agent_not_found });
            }
        } catch (err) {
            console.log("error---", err)
            // If there's an error, return a general error message
            res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
        }
    },

    updateRegisterUserBalance: async function (req, res) {
        try {
            console.log("req.body of update balance", req.body);
            console.log("req.session.details", req.session.details);
            let withdraw_username_uniqueId = true;

            // Translation keys for dynamic messages
            let keys = [
                "something_went_wrong_please_try_again_later",
                "user_not_found",
                "agent_not_found",
                "not_allowed_to_perform_action",
                "not_allowed_to_perform_withdraw_action",
                "please_ensure_previous_agent_logs_out",
                "previous_day_settlement_pending",
                "not_enough_balance_to_withdraw",
                "insufficient_daily_balance",
                "valid_action_not_found",
                "successful_addition_message",
                "successful_withdrawal_message",
                "kr_has_been_success_added_to",
                "someones_account",
                "kr_has_been_success_withdraw_from"
            ];

            // Fetch translated messages using getTraslateData
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            if (!req.session.details.isSuperAdmin && req.body.action == "withdraw") {
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     // user = await Sys.App.Services.AgentServices.getById(req.session.details.id);
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Players Management'] || [];
                let stringReplace =req.session.details.isPermission['Players Management'] || [];
                if (!stringReplace || stringReplace.indexOf("withdraw_username_uniqueId") == -1) {
                    withdraw_username_uniqueId = false;
                }
            } else if (!req.session.details.isSuperAdmin && req.body.action == "add") {
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     // user = await Sys.App.Services.AgentServices.getById(req.session.details.id);
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Players Management'] || [];
                let stringReplace = req.session.details.isPermission['Players Management'];
                if (!stringReplace || stringReplace.indexOf("add") == -1) {
                    return res.json({ status: "fail", message: agentData.not_allowed_to_perform_action });
                }
            }

            if (withdraw_username_uniqueId == false) {
                return res.json({ status: "fail", message: agentData.not_allowed_to_perform_withdraw_action });
            }

            const { username, amount, paymentType, action, id } = req.body;

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        return res.json({ status: "fail", message: agentData.please_ensure_previous_agent_logs_out });
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                        return res.json({ status: "fail", message: agentData.previous_day_settlement_pending });
                    }
                    let typeOfTransaction = "";
                    let index = hallsData.activeAgents.findIndex((e) => e.id == agentId);
                    let dailyBalance = hallsData.activeAgents[index].dailyBalance;

                    let user;
                    let query = {
                        //'hall.id': req.session.details.hall[0].id,
                        'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
                        userType: "Online",
                        $or: [
                            { customerNumber: isNaN(Number(username)) ? null : Number(username) },
                            { username: username }
                        ]
                    };
                    if (id && username) {
                        query._id = id;
                        user = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { walletAmount: 1, userType: 1 });
                    } else if (username) {
                        user = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { walletAmount: 1, userType: 1 });
                    }

                    console.log("user of add balance", user);
                    if (!user) {
                        return res.json({ status: "fail", message: agentData.user_not_found });
                    }

                    if (action == "add") {
                        typeOfTransaction = "Add Money By Agent";
                    } else if (action == "withdraw") {
                        typeOfTransaction = "Withdraw Money By Agent"
                        if (user.walletAmount < +amount) {
                            return res.json({ status: "fail", message: agentData.not_enough_balance_to_withdraw });
                        }
                        console.log("dailyBalance of agent---", dailyBalance, amount);
                        if (paymentType == "Cash" && dailyBalance < +amount) {
                            return res.json({ status: "fail", message: agentData.insufficient_daily_balance });
                        }
                    } else {
                        res.json({ status: "fail", message: agentData.valid_action_not_found });
                    }

                    let transaction = {
                        playerId: user.id,
                        agentId: agentId,
                        hallId: hallId,
                        amount: +amount,
                        paymentType: paymentType,
                        agentName: req.session.details.name,
                        operation: action,
                        action: (action == "add") ? "credit" : "debit",
                        typeOfTransaction: typeOfTransaction,
                        hall: req.session.details.hall[0],
                        groupHall: hallsData.groupHall,
                        userType: user.userType
                    };

                    try {
                        let trResponse = await Sys.Helper.gameHelper.transferMoneyByHall(transaction);
                        console.log("trResponse of transfer money by hall", trResponse);
                        if (trResponse && trResponse.status == "success") {
                            let successMessage = `${amount} ${agentData.kr_has_been_success_added_to} ${username}${agentData.someones_account}.`;
                            if (action == "withdraw") {
                                successMessage = `${amount} ${agentData.kr_has_been_success_withdraw_from} ${username}${agentData.someones_account}.`;
                            }
                            if (paymentType == 'Cash') {
                                req.session.details.dailyBalance = trResponse.dailyBalance;
                            }

                            return res.json({ status: "success", message: successMessage, dailyBalance: req.session.details.dailyBalance, paymentType: paymentType, userwallet: trResponse.userwallet });
                        }
                        return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                    } catch (error) {
                        console.error('Error during transfer:', error);
                        return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                    }
                } else {
                    return res.json({ status: "fail", message: agentData.agent_not_found });
                }
            } else if (req.session.login && req.session.details.is_admin == 'yes' && req.session.details.role == "admin") {
                let typeOfTransaction = "";
                let user;

                if (id && username) {
                    user = await Sys.App.Services.PlayerServices.getSinglePlayerData({ _id: id, username: username }, { walletAmount: 1, userType: 1, hall: 1, groupHall: 1 });
                } else if (username) {
                    user = await Sys.App.Services.PlayerServices.getSinglePlayerData({ username: username }, { walletAmount: 1, userType: 1, hall: 1, groupHall: 1 });
                }

                if (!user) {
                    return res.json({ status: "fail", message: agentData.user_not_found });
                }

                if (action == "add") {
                    typeOfTransaction = "Add Money By Admin";
                } else if (action == "withdraw") {
                    typeOfTransaction = "Withdraw Money By Admin";
                    if (user.walletAmount < +amount) {
                        return res.json({ status: "fail", message: agentData.not_enough_balance_to_withdraw });
                    }
                } else {
                    res.json({ status: "fail", message: agentData.valid_action_not_found });
                }

                let transaction = {
                    playerId: user.id,
                    agentId: req.session.details.id,
                    hallId: user.hall.id,
                    amount: +amount,
                    paymentType: paymentType,
                    agentName: req.session.details.name,
                    operation: action,
                    action: (action == "add") ? "credit" : "debit",
                    typeOfTransaction: typeOfTransaction,
                    hall: { id: user.hall.id, name: user.hall.name },
                    groupHall: user.groupHall,
                    userType: user.userType
                };

                try {
                    let trResponse = await Sys.Helper.gameHelper.transferMoneyByAdmin(transaction);
                    console.log("trResponse of transfer money by hall", trResponse);
                    if (trResponse && trResponse.status == "success") {
                        let successMessage = `${amount} kr has been successfully added to ${username}'s account.`;
                        if (action == "withdraw") {
                            successMessage = `${amount} kr has been successfully withdrawn from ${username}'s account.`;
                        }

                        return res.json({ status: "success", message: successMessage, paymentType: paymentType, userwallet: trResponse.userwallet });
                    }
                    return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                } catch (error) {
                    console.error('Error during transfer:', error);
                    return res.json({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                }
            } else {
                return res.json({ status: "fail", message: agentData.agent_not_found });
            }
        } catch (e) {
            res.json({ status: "fail", message: 'Server error' });
        }
    },

    uniqueIdAddBalanceView: async function (req, res) {
        try {
            // Define translation keys for fetching messages
            let keys = [
                "add_money_unique_id",
                "withdraw_money_unique_id",
                "dashboard",
                "add_money",
                "withdraw_money",
                "enter_unique_id",
                "enter",
                "amount",
                "add",
                "withdraw",
                "cancel",
                "do_you_want_to_add_money_to_unique_id",
                "yes_add_money",
                "the_add_money_action_has_been_cancelled",
                "do_you_want_to_withdraw_money_from_unique_id",
                "yes_withdraw_money",
                "the_withdraw_money_action_has_been_cancelled",
                "are_you_sure",
                "cancel_button",
                "success",
                "failed",
                "cancelled",
            ];

            // Fetch translated messages using session language
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            // Prepare the data object to render the view
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                action: "add",
                agentData: agentData,  // Add the translated messages for agentData
                navigation: agentData   // Add translated messages for navigation (can be customized based on your need)
            };

            // Render the view with the translation data
            return res.render('cash-inout/unique-id-balance', data);
        } catch (e) {
            console.log("Error in view of unique id", e);
        }
    },

    uniqueIdWithdrawBalanceView: async function (req, res) {
        try {
            let keys = ["you_are_not_allowed_to_access_that_page"]
            let message = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
            let withdraw_username_uniqueId = true;
            if(!req.session.details.isSuperAdmin){
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Unique ID Modules'] || [];
                let stringReplace =req.session.details.isPermission['Unique ID Modules'] || [];
                if(!stringReplace.length){
                    let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                    req.flash('error',translate.no_permission )//'you_have_no_permission';
                    return res.redirect('/dashboard');
                }
                // let stringReplace = req.session.details.isPermission['Unique ID Modules'];
                if (!stringReplace || stringReplace.indexOf("withdraw_username_uniqueId") == -1) {
                    withdraw_username_uniqueId = false;
                }
            }
            if (withdraw_username_uniqueId == false) {
                req.flash('error', message.you_are_not_allowed_to_access_that_page);
                return res.redirect('/dashboard');
            }
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                action: "withdraw",
                message: message,
                navigation: message
            };
            return res.render('cash-inout/unique-id-balance', data);
        } catch (e) {
            console.log("Error in view of unique id", e);
        }
    },

    checkForValidUniqueId: async function (req, res) {
        try {
            let uniqueId = '^' + req.body.uniqueId + '$';
            console.log("uniqueId---", uniqueId, req.query);

            let userCount = 0;

            if (uniqueId) {
                const query = {
                    userType: "Unique",
                    uniqueId: { '$regex': uniqueId, $options: 'i' },
                    'hall.id': req.session.details.hall[0].id
                };

                if (req.query.action === 'add') {
                    query['uniqueExpiryDate'] = {
                        $gte: new Date()
                    };
                }

                userCount = await Sys.App.Services.PlayerServices.getPlayerCount(query);
            }

            // Define keys for translation
            let keys = ['please_enter_valid_unique_id'];
            let message = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            // Respond based on user count
            if (userCount > 0) {
                return res.send({ "valid": true });
            }

            return res.send({
                "valid": false,
                "message": message.please_enter_valid_unique_id || "Please enter valid Unique Id."
            });
        } catch (e) {
            console.log("Error in checkForValidUniqueId", e);
            res.status(500).send({ "valid": false, "message": "Internal Server Error." });
        }
    },

    getUniqueIdBalance: async function (req, res) {
        try {
            const { uniqueId, action } = req.query;
            let keys = ['user_not_found', 'agent_not_found', 'server_error'];
            let message = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            if (req.session.login) {
                let query = {
                    userType: "Unique",
                    uniqueId: uniqueId,
                }
                if (req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                    query['hall.id'] = req.session.details.hall[0].id;
                }
                if (action == 'add') {
                    query['uniqueExpiryDate'] = {
                        $gte: new Date()
                    };
                }

                const user = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { walletAmount: 1 });
                console.log("user of add balance", user);

                if (user) {
                    return res.json({
                        status: "success",
                        balance: +parseFloat(user.walletAmount).toFixed(2)
                    });
                } else {
                    return res.json({
                        status: "fail",
                        message: message.user_not_found || 'User not found'
                    });
                }
            } else {
                return res.json({
                    status: "fail",
                    message: message.agent_not_found || 'Agent not found'
                });
            }
        } catch (err) {
            console.log("Error in getUniqueIdBalance", err);
            return res.json({
                status: "fail",
                message: message.server_error || 'Server error'
            });
        }
    },

    updateUniqueIdBalance: async function (req, res) {
        try {
            // Define keys for translation
            let keys = [
                'not_allowed_to_perform_withdraw_action',
                'server_error'
            ];
            let message = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            let withdraw_username_uniqueId = true;

            // Check permissions for withdraw action
            if (!req.session.details.isSuperAdmin && req.body.action === "withdraw") {
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     // user = await Sys.App.Services.AgentServices.getById(req.session.details.id);
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Unique ID Modules'] || [];
                let stringReplace =req.session.details.isPermission['Unique ID Modules'] || [];
                if (!stringReplace || stringReplace.indexOf("withdraw_username_uniqueId") === -1) {
                    withdraw_username_uniqueId = false;
                }
            }
            // Check permissions for add action
            else if (!req.session.details.isSuperAdmin && req.body.action === "add") {
                // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
                // if (user == null || user.length == 0) {
                //     // user = await Sys.App.Services.AgentServices.getById(req.session.details.id);
                //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
                // }
                // let stringReplace = user.permission['Unique ID Modules'] || [];
                let stringReplace =req.session.details.isPermission['Unique ID Modules'] || [];
                if (!stringReplace || stringReplace.indexOf("add") === -1) {
                    return res.json({
                        status: "fail",
                        message: message.not_allowed_to_perform_withdraw_action || "You are Not allowed to perform Withdraw Action."
                    });
                }
            }

            if (!withdraw_username_uniqueId) {
                return res.json({
                    status: "fail",
                    message: message.not_allowed_to_perform_withdraw_action || "You are Not allowed to perform Withdraw Action."
                });
            }

            console.log("req.body of update balance", req.body);
            const { uniqueId, amount, paymentType, action } = req.body;

            // Call helper function to update balance
            let response = await module.exports.addUniqueIdBalance({
                action: action,
                isNew: false,
                amount: +amount,
                session: req.session,
                uniqueId: uniqueId,
                paymentType: paymentType
            }, req.session.details.language);

            console.log("response of add unique balance", response);

            // Update session balance for non-admin users
            if (response.status === "success" && req.session.details.is_admin === 'no') {
                if (paymentType === 'Cash') {
                    if (action === 'withdraw') {
                        req.session.details.dailyBalance = Number(req.session.details.dailyBalance) - (+amount);
                    } else {
                        req.session.details.dailyBalance = Number(req.session.details.dailyBalance) + (+amount);
                    }
                }
            }

            return res.json(response);
        } catch (e) {
            console.log("Error in updateUniqueIdBalance", e);
            return res.json({
                status: "fail",
                message: message.server_error || "Server error"
            });
        }
    },

    addUniqueIdBalance: async function (data, language) {
        try {
            console.log("req.body of unique id balance", data);
            const { hall, transactionType, paymentType, action, isNew, amount, session, uniqueId } = data;

            // Define translation keys
            let keys = [
                'only_cash_payment_type_is_allowed_for_unique_id_withdrawal',
                'previous_agent_logout_needed',
                'previous_day_settlement_required',
                'unique_id_not_found',
                'insufficient_balance_to_withdraw',
                'insufficient_daily_balance',
                'valid_action_not_found',
                'agent_not_found',
                'server_error',
                'transaction_error',
                'kr_has_been_success_added_to',
                'someones_account',
                "kr_has_been_success_withdraw_from"
            ];
            let messages = await Sys.Helper.bingo.getTraslateData(keys, language);

            if (session.login && session.details.is_admin !== 'yes' && session.details.role === "agent") {
                if (action === "withdraw" && paymentType !== "Cash") {
                    return {
                        status: "fail",
                        message: messages.only_cash_payment_type_is_allowed_for_unique_id_withdrawal || 'Only Cash payment Type is allowed for Unique id withdrawal'
                    };
                }
                const hallId = session.details.hall[0].id;
                const agentId = session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: hallId },
                    { activeAgents: 1, groupHall: 1, otherData: 1 }
                );

                if (hallsData && hallsData.activeAgents?.length > 0) {
                    if (!hallsData.activeAgents.some(agent => agent.id === agentId)) {
                        return {
                            status: "fail",
                            message: messages.previous_agent_logout_required || 'Please ensure the previous agent logs out to do the transactions.'
                        };
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending) {
                        return {
                            status: "fail",
                            message: messages.previous_day_settlement_required || 'Please do previous day settlement before doing any other Transactions.'
                        };
                    }

                    let typeOfTransaction = "";
                    let index = hallsData.activeAgents.findIndex((e) => e.id == agentId);
                    let dailyBalance = hallsData.activeAgents[index].dailyBalance;


                    const user = await Sys.App.Services.PlayerServices.getSinglePlayerData(
                        { userType: "Unique", uniqueId: uniqueId, 'hall.id': hallId },
                        { walletAmount: 1, userType: 1 }
                    );

                    if (!user) {
                        return {
                            status: "fail",
                            message: messages.unique_id_not_found || 'Unique Id not found'
                        };
                    }

                    if (isNew && action === "add") {
                        typeOfTransaction = transactionType;
                    } else if (!isNew && action === "add") {
                        typeOfTransaction = "Add Money By Agent";
                    } else if (action === "withdraw") {
                        typeOfTransaction = "Withdraw Money By Agent";
                        if (user.walletAmount < +amount) {
                            return {
                                status: "fail",
                                message: messages.insufficient_balance_to_withdraw || "Unique Id doesn't have enough amount to withdraw"
                            };
                        }
                        if (paymentType === "Cash" && hallsData.activeAgents[0].dailyBalance < +amount) {
                            return {
                                status: "fail",
                                message: messages.insufficient_daily_balance || "You don't have enough amount in your daily balance"
                            };
                        }
                    } else {
                        return {
                            status: "fail",
                            message: messages.valid_action_not_found || "Valid action not found"
                        };
                    }

                    let transaction = {
                        playerId: user.id,
                        agentId: agentId,
                        hallId: hallId,
                        amount: +amount,
                        paymentType: paymentType,
                        agentName: session.details.name,
                        operation: action,
                        action: action === "add" ? "credit" : "debit",
                        typeOfTransaction: typeOfTransaction,
                        hall: session.details.hall[0],
                        groupHall: hallsData.groupHall,
                        userType: user.userType
                    };

                    try {
                        await Sys.Helper.gameHelper.transferMoneyByHall(transaction);

                        let successMessage = `${amount} ${messages.kr_has_been_success_added_to} ${uniqueId}${messages.someones_account}.`
                        if (action == "withdraw") {
                            successMessage = `${amount} ${messages.kr_has_been_success_withdraw_from} ${uniqueId}${messages.someones_account}.`
                            dailyBalance = dailyBalance - (+amount);
                            userwallet = user.walletAmount - (+amount)
                        } else {
                            dailyBalance = dailyBalance + (+amount);
                            userwallet = user.walletAmount + (+amount)
                        }

                        return {
                            status: "success",
                            message: successMessage,
                            dailyBalance: dailyBalance,
                            paymentType: paymentType,
                            userwallet: userwallet
                        };
                    } catch (error) {
                        console.error('Error during transfer:', error);
                        return {
                            status: "fail",
                            message: messages.transaction_error || "Something went wrong, please try again later"
                        };
                    }
                } else {
                    return {
                        status: "fail",
                        message: messages.agent_not_found || 'Agent not found'
                    };
                }
            }

            if (session.login && session.details.is_admin === 'yes' && session.details.role === "admin") {
                if (action == "withdraw" && paymentType != "Cash") {
                    return {
                        status: "fail", message: messages.only_cash_payment_type_is_allowed_for_unique_id_withdrawal || 'Only Cash payment Type is allowed for Unique id withdrawal'
                    }
                }

                const user = await Sys.App.Services.PlayerServices.getSinglePlayerData({ userType: "Unique", uniqueId: uniqueId }, { walletAmount: 1, userType: 1, hall: 1, groupHall: 1 });
                console.log("user of add balance", user)
                if (!user) {
                    return {
                        message: messages.unique_id_not_found || 'Unique Id not found'
                    }
                }
                if (isNew == true && action == "add") {
                    typeOfTransaction = transactionType;
                } else if (isNew == false && action == "add") {
                    typeOfTransaction = "Add Money By Admin";
                } else if (action == "withdraw") {
                    typeOfTransaction = "Withdraw Money By Admin"
                    if (user.walletAmount < +amount) {
                        return {
                            message: messages.insufficient_balance_to_withdraw || "Unique Id doesn't have enough amount to withdraw"
                        }
                    }
                } else {
                    return {
                        status: "fail", message: messages.valid_action_not_found || "Valid action not found"
                    }
                }

                let transaction = {
                    playerId: user.id,
                    agentId: session.details.id,
                    hallId: user.hall.id,
                    amount: +amount,
                    paymentType: paymentType,
                    agentName: session.details.name,
                    operation: action,
                    action: (action == "add") ? "credit" : "debit",
                    typeOfTransaction: typeOfTransaction,
                    hall: session.details.hall[0],
                    groupHall: user.groupHall,
                    userType: user.userType
                }

                try {
                    let userwallet;
                    await Sys.Helper.gameHelper.transferMoneyByAdmin(transaction);
                    let successMessage = `${amount} kr has been successfully added to ${uniqueId}'s account.`;
                    if (action == "withdraw") {
                        successMessage = `${amount} kr has been successfully withdrawn from ${uniqueId}'s account.`
                        userwallet = user.walletAmount - (+amount)
                    } else {
                        userwallet = user.walletAmount + (+amount)
                    }
                    return {
                        status: "success", message: successMessage, paymentType: paymentType, userwallet: userwallet
                    }
                } catch (error) {
                    console.error('Error during transfer:', error);
                    return {
                        status: "fail", message: messages.transaction_error || "Something went wrong, please try again later"
                    }
                }
            } else {
                return {
                    status: "fail",
                    message: messages.agent_not_found || 'Agent not found'
                };
            }
        } catch (e) {
            console.error("Error in addUniqueIdBalance:", e);
            return {
                status: "fail",
                message: messages.server_error || 'Server error'
            };
        }
    },

    agentGameStatusForPause: async function (req, res) {
        try {
            // Translation keys
            const keys = [
                'previous_agent_logout_needed',
                'game_already_finished',
                'pause_running_game_only',
                'pause_game_not_started',
                'game_not_available',
                'login_required',
                'server_error'
            ];
            const messages = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            if (req.session.login && req.session.details.is_admin !== 'yes' && req.session.details.role === "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData(
                    { _id: hallId },
                    { activeAgents: 1, groupHall: 1 }
                );

                if (hallsData?.activeAgents?.some(agent => agent.id === agentId)) { // getSingleByData
                    const runningGame = await Sys.Game.Game1.Services.GameServices.getSingleGameByData(
                        {
                            gameType: 'game_1',
                            halls: { $in: [hallId] },
                            stopGame: false,
                            'otherData.isClosed': false,
                            startDate: {
                                $gte: moment().startOf('day').toDate(),
                                $lt: moment().endOf('day').toDate()
                            },
                            $or: [
                                { "status": "finish", "otherData.gameSecondaryStatus": "running" },
                                { "status": "running" },
                                { "status": "active" },
                            ],
                        },
                        { gameNumber: 1, gameName: 1, otherData: 1, status: 1 }
                    );

                    if (runningGame) {
                        if (runningGame.status === "finish") {
                            const gameName = runningGame.gameName;
                            const minigameActive = runningGame.otherData?.isMinigameActivated;
                            const minigameExecuted = runningGame.otherData?.isMinigameExecuted;

                            if (
                                ["Wheel of Fortune", "Treasure Chest", "Mystery", "Color Draft"].includes(gameName) &&
                                (minigameActive || minigameExecuted)
                            ) {
                                // Do nothing or handle minigame scenarios if needed
                            } else {
                                return res.send({
                                    status: "fail",
                                    message: messages.game_already_finished || 'Game is already finished'
                                });
                            }
                        } else if (runningGame.status === "active") {
                            if (Timeout.exists(runningGame._id.toString())) {
                                return res.send({
                                    status: "fail",
                                    message: messages.pause_running_game_only || 'You can only pause running game.'
                                });
                            } else {
                                return res.send({
                                    status: "fail",
                                    message: messages.pause_game_not_started || 'You can only pause running game, Current game has not started yet.'
                                });
                            }
                        }

                        const isGamePaused = runningGame.otherData?.isPaused || false;

                        return res.send({
                            status: "success",
                            runningGame: {
                                id: runningGame._id,
                                isPaused: isGamePaused,
                                status: runningGame.status
                            },
                            isGameAvailable: true,
                            isGamePaused: isGamePaused
                        });
                    } else {
                        return res.send({
                            status: "fail",
                            message: messages.game_not_available || 'Game not available'
                        });
                    }
                } else {
                    return res.send({
                        status: "fail",
                        message: messages.previous_agent_logout_required || 'Please ensure the previous agent logs out to pause the Game.'
                    });
                }
            } else {
                return res.send({
                    status: "fail",
                    message: messages.login_required || 'Something went wrong, please login and try again'
                });
            }
        } catch (error) {
            console.error("Error in agentGameStatusForPause:", error);
            res.send({
                status: "fail",
                message: messages.something_went_wrong || 'Something went wrong'
            });
        }
    },

    agentGameStop: async function (req, res) {
        try {
            console.log("Agent game stop called", req.body);

            // Translation keys
            const keys = [
                'previous_agent_logout_needed',
                'game_already_paused',
                'game_already_finished',
                'pause_running_game_only',
                'login_required',
                'server_error',
                'game_paused_successfully',
                'game_not_available_or_invalid_game_id'
            ];
            const messages = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            // Validate agent session
            if (!req.session.login || req.session.details.is_admin === 'yes' || req.session.details.role !== "agent") {
                return res.send({
                    status: "fail",
                    message: messages.something_went_wrong_please_try_again_later || 'Something went wrong, please login and try again',
                    showSearch: false
                });
            }

            const hallId = req.session.details.hall[0].id;
            const agentId = req.session.details.id;

            // Fetch hall data
            const hallsData = await Sys.App.Services.HallServices.getSingleHallData(
                { _id: hallId },
                { activeAgents: 1, groupHall: 1 }
            );

            if (!hallsData || !hallsData.activeAgents?.some(agent => agent.id === agentId)) {
                return res.send({
                    status: "fail",
                    message: messages.previous_agent_logout_required || 'Please ensure the previous agent logs out to pause the Game.',
                    showSearch: false
                });
            }

            // Fetch the running game
            const runningGame = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                {
                    _id: req.body.id,
                    gameType: 'game_1',
                    halls: { $in: [hallId] },
                    stopGame: false,
                    'otherData.isClosed': false,
                    startDate: {
                        $gte: moment().startOf('day').toDate(),
                        $lt: moment().endOf('day').toDate()
                    },
                    $or: [
                        { "status": "finish", "otherData.gameSecondaryStatus": "running" },
                        { "status": "running" },
                        { "status": "active" },
                    ],
                },
                { gameNumber: 1, gameName: 1, otherData: 1, status: 1 }
            );

            if (!runningGame) {
                return res.send({
                    status: "fail",
                    message: messages.game_not_available_or_invalid_game_id || 'Game not available or invalid game ID',
                    showSearch: false
                });
            }

            if (runningGame.otherData?.isPaused) {
                return res.send({
                    status: "fail",
                    message: messages.game_already_paused || 'Game is already paused',
                    showSearch: true
                });
            }

            if (runningGame.status === "finish") {
                if (
                    ["Wheel of Fortune", "Treasure Chest", "Mystery", "Color Draft"].includes(runningGame.gameName) &&
                    (runningGame.otherData?.isMinigameActivated || runningGame.otherData?.isMinigameExecuted)
                ) {
                    // Handle minigame-specific logic if needed
                } else {
                    return res.send({
                        status: "fail",
                        message: messages.game_already_finished || 'Game is already finished',
                        showSearch: false
                    });
                }
            }

            if (runningGame.status === "active" && !Timeout.exists(runningGame._id.toString())) {
                return res.send({
                    status: "fail",
                    message: messages.pause_running_game_only || 'You can only pause running game, Current game has not started yet.',
                    showSearch: false
                });
            }

            // Stop the game
            const stopGameResponse = await Sys.Game.Game1.Controllers.GameProcess.stopGame(runningGame.id, req.session.details.language, false, req.body?.isPauseWithoutAnnouncement === 'true' || req.body?.isPauseWithoutAnnouncement === true);
            if (stopGameResponse?.status === "success") {
                return res.send({
                    status: "success",
                    message: messages.game_paused_successfully || 'Game is paused',
                    showSearch: true
                });
            } else {
                return res.send({
                    status: "fail",
                    message: stopGameResponse.message,
                    showSearch: stopGameResponse.showSearch
                });
            }
        } catch (error) {
            console.error("Error in agentGameStop:", error);
            const messages = await Sys.Helper.bingo.getTraslateData(['something_went_wrong'], req.session.details.language);
            return res.send({
                status: "fail",
                message: messages.something_went_wrong || 'Something went wrong',
                showSearch: false
            });
        }
    },

    agentGameStatusForStart: async function (req, res) {
        try {
            console.log("Agent game status for start called", req.query);

            // Translation keys
            const keys = [
                'agent_logout_required_to_start_game',
                'game_already_running',
                'game_not_startable_other_running',
                'game_schedule_closed',
                'game_start_not_allowed',
                'game_already_started',
                'game_finished',
                'auto_game_not_allowed',
                'login_required',
                'server_error',
                'game_not_available',
                'something_went_wrong_please_try_again_later',
                'schedule_start_time_is'
            ];
            const messages = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            // Validate agent session
            if (!req.session.login || req.session.details.is_admin === 'yes' || req.session.details.role !== "agent") {
                return res.send({
                    status: "fail",
                    message: messages.something_went_wrong_please_try_again_later || 'Something went wrong, please login and try again'
                });
            }

            const hallId = req.session.details.hall[0].id;
            const agentId = req.session.details.id;

            // Fetch hall data
            const hallsData = await Sys.App.Services.HallServices.getSingleHallData(
                { _id: hallId },
                { activeAgents: 1, groupHall: 1 }
            );

            if (!hallsData || !hallsData.activeAgents?.some(agent => agent.id === agentId)) {
                return res.send({
                    status: "fail",
                    message: messages.agent_logout_required_to_start_game || 'Please ensure the previous agent logs out to Start the Game.'
                });
            }

            // Fetch the running game //getSingleByData
            const runningGame = await Sys.Game.Game1.Services.GameServices.getSingleGameByData(
                {
                    gameType: 'game_1',
                    halls: { $in: [hallId] },
                    stopGame: false,
                    'otherData.isClosed': false,
                    startDate: {
                        $gte: moment().startOf('day').toDate(),
                        $lt: moment().endOf('day').toDate()
                    },
                    $or: [
                        { status: "finish", "otherData.gameSecondaryStatus": "running" },
                        { status: "running" },
                        { status: "active" }
                    ]
                },
                { gameNumber: 1, gameName: 1, 'otherData.isPaused': 1, status: 1, parentGameId: 1, gameMode: 1, startDate: 1, subGames: 1 }
            );

            console.log("Running game of hall", runningGame, hallId);

            if (!runningGame) {
                return res.send({
                    status: "fail",
                    message: messages.game_not_available || 'Game not available'
                });
            }

            // Check if operation is "startGame" or "resumeGame"
            if (req.query.operationId === "startGame" && runningGame.id.toString() !== req.query.id.toString()) {
                return res.send({
                    status: "fail",
                    message: messages.game_not_startable_other_running || 'You cannot start the game as another game is running.'
                });
            }

            if (req.query.operationId === "resumeGame" && runningGame.id.toString() !== req.query.id.toString()) {
                return res.send({
                    status: "fail",
                    message: messages.something_went_wrong_please_try_again_later || 'Something went wrong, please refresh and try again.'
                });
            }

            let isGameAvailable = true;
            let isGamePaused = runningGame.otherData?.isPaused || false;

            // Handle game status and mode
            if (runningGame.status === "active") {
                if (runningGame.gameMode === "Manual") {
                    const schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData(
                        { _id: runningGame.parentGameId },
                        { otherData: 1 }
                    );

                    if (schedule?.otherData?.closeDay?.some(day =>
                        moment().isBetween(day.utcDates.startTime, day.utcDates.endTime)
                    )) {
                        return res.send({
                            status: "fail",
                            message: messages.game_schedule_closed || 'Cannot start the game as the schedule is closed at the moment.'
                        });
                    }

                    const startDate = moment(runningGame.startDate).utc();
                    if (moment().utc() < startDate) {
                        return res.send({
                            status: "fail",
                            message: `${messages.game_start_not_allowed || 'You cannot start the game at the moment.'} ${messages.schedule_start_time_is} `,
                            result: { date: startDate }
                        });
                    }

                    if (Timeout.exists(runningGame._id.toString())) {
                        return res.send({
                            status: "fail",
                            message: messages.game_already_started || 'Game is already started.'
                        });
                    }
                } else if (runningGame.gameMode === "Auto") {
                    return res.send({
                        status: "fail",
                        message: messages.auto_game_not_allowed || 'Cannot start Auto game from Agent portal.'
                    });
                }
            }

            if (runningGame.status === "finish") {
                if (!["Wheel of Fortune", "Treasure Chest", "Mystery", "Color Draft"].includes(runningGame.gameName)) {
                    return res.send({
                        status: "fail",
                        message: messages.game_finished || 'Game is already finished.'
                    });
                }
            }

            return res.send({
                status: "success",
                runningGame,
                isGameAvailable,
                isGamePaused,
                jackpotSelectedColors: runningGame.gameName == "Jackpot" ? [...new Set(runningGame.subGames[0].ticketColorTypes.map(t => t.split(' ')[1]))]   : []
            });

        } catch (error) {
            console.error("Error in agentGameStatusForStart:", error);
            const messages = await Sys.Helper.bingo.getTraslateData(['something_went_wrong'], req.session.details.language);
            return res.send({
                status: "fail",
                message: messages.something_went_wrong || 'Something went wrong',
            });
        }
    },

    //baaki hai
    agentGameStart: async function (req, res) {
        try {
            console.log("agent game start called", req.body)
            let gameAction = req.body.gameAction;
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        let keys = ["aplease_ensure_the_previous_agent_logs_out_to", "game"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                        return res.send({ status: "fail", message: agentData.aplease_ensure_the_previous_agent_logs_out_to + gameAction + agentData.game });

                        // return res.send({
                        //     status: "fail", message: `Please ensure the previous agent logs out to ${gameAction} Game.`
                        // });
                    }
                    const runningGame = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                        {
                            _id: req.body.id, gameType: 'game_1', halls: { $in: [hallId] }, stopGame: false, 'otherData.isClosed': false,
                            startDate: {
                                $gte: moment().startOf('day').toDate(),
                                $lt: moment().endOf('day').toDate()
                            },
                            $or: [{
                                "status": "finish",
                                "otherData.gameSecondaryStatus": "running",
                            }, {
                                "status": "running",
                            }, {
                                "status": "active",
                            }],
                        },
                        { gameNumber: 1, gameName: 1, otherData: 1, status: 1, countDownDateTime: 1 }
                    );

                    console.log("Running game of hall in start/resume function", runningGame, hallId);
                    if (runningGame) {

                        if (runningGame.countDownDateTime > new Date()) {
                            let keys = ["game_cannot_be_started_as_the_countdown_is_in_progress"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({ status: "fail", message: agentData.game_cannot_be_started_as_the_countdown_is_in_progress });
                            // return res.send({
                            //     status: "fail",
                            //     message: "Game cannot be started as the countdown is in progress.",
                            // });
                        }

                        if (req.query.operationId == "startGame") {
                            console.log("running and provided game id for start", runningGame.id, req.query.id)
                            if (runningGame.id != req.query.id) {
                                let keys = ["you_can_not_start_the_game_as_other_game_is_running"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                return res.send({ status: "fail", message: agentData.you_can_not_start_the_game_as_other_game_is_running });
                                // return res.send({
                                //     status: "fail",
                                //     message: "You can not start the game as other game is running",
                                // });
                            }
                        } else if (req.query.operationId == "resumeGame") {
                            console.log("running and provided game id for resume", runningGame.id, req.query.id)
                            if (runningGame.id != req.query.id) {
                                let keys = ["something_went_wrong_please_try_again_later"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                return res.send({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                                // return res.send({
                                //     status: "fail",
                                //     message: "Something went wrong, please refresh and try again",
                                // });
                            }
                        }

                        if ((runningGame.status == "running" || runningGame.status == "finish") && runningGame.otherData && runningGame.otherData.isPaused == true) {
                            console.log("game is paused so resume the game");
                            if (runningGame.status == "finish") {
                                if (runningGame.gameName == "Wheel of Fortune" || runningGame.gameName == "Treasure Chest" || runningGame.gameName == "Mystery" || runningGame.gameName == "Color Draft") {
                                    if (runningGame.otherData.isMinigameActivated == true && runningGame.otherData.gameSecondaryStatus != "finish") {
                                        //return res.send({status: "fail", message: 'Game is already Finished'})
                                    }
                                } else {
                                    let keys = ["game_is_already_finished"];
                                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                    return res.send({ status: "fail", message: agentData.game_is_already_finished });
                                    // return res.send({ status: "fail", message: 'Game is already Finished' })
                                }
                            }

                            let resumegame = await Sys.Game.Game1.Controllers.GameProcess.resumeGame({ gameId: runningGame.id, action: "Resume", language: req.session.details.language })
                            if (resumegame) {
                                return res.send({ status: "success", message: resumegame.message });
                            } else {
                                let keys = ["something_went_wrong_please_try_again_later"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                return res.send({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                                // return res.send({ status: "fail", message: 'Something went wrong, please login and try again' })
                            }
                        } else {
                            if ((runningGame.status == "running" || runningGame.status == "finish") && runningGame.otherData && runningGame.otherData.isPaused == false) {
                                let keys = ["game_is_already_running"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                return res.send({ status: "fail", message: agentData.game_is_already_running });
                            }
                            let startGame = await module.exports.startManualGame({ gameId: runningGame.id, jackpotPrizeWhite: req.body.jackpotPrizeWhite, jackpotPrizeYellow: req.body.jackpotPrizeYellow, jackpotPrizePurple: req.body.jackpotPrizePurple, jackpotDraw: req.body.jackpotDraw }, req.session.details.language)
                            if (startGame) {
                                if (startGame.status == "success") {
                                    return res.send({ status: "success", message: startGame.message });
                                } else {
                                    return res.send({ status: "fail", message: startGame.message, result: startGame?.result });
                                }

                            } else {
                                let keys = ["something_went_wrong_please_try_again_later"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                return res.send({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                                // return res.send({ status: "fail", message: 'Something went wrong, please login and try again' })
                            }
                            // return axios({
                            //     method: 'post',
                            //     url: req.body.hostUrl+'/startManualGame',  //Sys.Config.App[Sys.Config.Database.connectionType].url
                            //     data: {
                            //         id: req.body.id
                            //     },

                            // }).then(function (response) {
                            //     console.log("response of start manual game", response)
                            //     if(response.status == 200 && response.data){
                            //         res.send({status: "success", message: response.data.message});
                            //     }else{ 
                            //         res.send({status: "fail", message: 'Something went wrong, please login and try again'})
                            //     }
                            // }).catch(function (error) {
                            //     console.log("error of start manual game",error);
                            //     res.send({status: "fail", message: 'Something went wrong, please login and try again'})
                            // });

                        }
                    } else {
                        let keys = ["the_game", "no_game_found_to"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                        return res.send({ status: "fail", message: agentData.no_game_found_to + gameAction + agentData.game });
                        // return res.send({ status: "fail", message: `No game found to ${gameAction} the Game` });
                    }
                } else {
                    let keys = ["something_went_wrong_please_try_again_later"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.send({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                    // return res.send({ status: "fail", message: 'Something went wrong, please login and try again' })
                }

            } else {
                let keys = ["something_went_wrong_please_try_again_later"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                return res.send({ status: "fail", message: agentData.something_went_wrong_please_try_again_later });
                // return res.send({ status: "fail", message: 'Something went wrong, please login and try again' });
            }
        } catch (e) {
            console.log("Error in agent game status", e)
            const messages = await Sys.Helper.bingo.getTraslateData(['something_went_wrong'], req.session.details.language);
            return res.send({
                status: "fail",
                message: messages.something_went_wrong || 'Something went wrong',
            });
        }
    },

    startManualGame: async function (data, language) {
        try {
            let gameId = data.gameId;
            if (gameId) {
                let game = await Sys.App.Services.GameService.getSingleGameData({ _id: gameId }, { status: 1, gameMode: 1, notificationStartTime: 1, players: 1, parentGameId: 1, startDate: 1 ,gameName :1, subGames: 1}, {});
                console.log("startManualGame by agent", game);

                // check for closed dates
                if (game && game.status == "active" && game.gameMode == "Manual") {
                    let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: game.parentGameId }, { otherData: 1 }, {});
                    console.log("schedule", schedule, schedule.otherData.closeDay);
                    if (schedule.otherData.closeDay && schedule.otherData.closeDay.length > 0) {
                        for (let c = 0; c < schedule.otherData.closeDay.length; c++) {
                            if (moment() >= schedule.otherData.closeDay[c].utcDates.startTime && moment() <= schedule.otherData.closeDay[c].utcDates.endTime) {
                                let keys = ["can_not_start_game_schedule_close_moment"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
                                return {
                                    "status": "fail",
                                    "message": agentData.can_not_start_game_schedule_close_moment,
                                };
                            }
                        }
                    }

                    //let startDate = moment(moment().format("YYYY-MM-DD") + " " + moment(game.startDate).format("HH:mm")).tz('UTC');
                    //if (moment().tz('UTC') < startDate) {
                    const startDate = moment(game.startDate).utc();
                    if (moment().utc() < startDate) {
                        let keys = ["you_can_not_start_the_game_at_the_moment_schedule_start_time_is"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
                        return {
                            "status": "fail",
                            "message": agentData.you_can_not_start_the_game_at_the_moment_schedule_start_time_is, // + moment(moment().format("YYYY-MM-DD") + " " + moment(game.startDate).format("HH:mm")).format("DD/MM/YYYY HH:mm a"),   //${startDate.format("DD/MM/YYYY HH:mm a")}
                            "result": { date: startDate }
                        };
                    }

                }

                // check for closed dates

                if (game.gameMode == 'Manual' && (data.jackpotPrizeWhite || data.jackpotPrizeYellow || data.jackpotPrizePurple) && data.jackpotDraw) {
                    // validation for jackpot game
                    let ticketColorTypes = game.subGames[0].ticketColorTypes;
                    const isValid = (v, min, max) => v >= min && v <= max;
                    const colors = ["Yellow", "White", "Purple"];
                    if (
                        colors.some(c => ticketColorTypes.some(t => t.includes(c)) && !isValid(+data[`jackpotPrize${c}`], 4000, 50000)) || 
                        !isValid(+data.jackpotDraw, 50, 57)
                    ) {
                        return { "status": "fail", "message": await Sys.Helper.bingo.getSingleTraslateData(["invalid_prize_draw_values"], language) };
                    }
                    
                    // Need to work, update Jackpot Prize and draw
                    let jackpotPrize = {
                        'white': +data.jackpotPrizeWhite || 0,
                        'yellow': +data.jackpotPrizeYellow || 0,
                        'purple': +data.jackpotPrizePurple || 0
                    }
                    await Sys.Game.Game1.Services.GameServices.updateGameNew(game._id, { jackpotDraw: data.jackpotDraw, jackpotPrize: jackpotPrize });
                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                    let {patternList, jackPotData} = await Sys.Game.Game1.Controllers.GameProcess.patternListing(gameId);
                    //let patternList = patternListing.patternList;

                    //let room = await Sys.App.Services.GameService.getSingleGameData({ _id: gameId }, { jackpotPrize: 1, jackpotDraw: 1, subGames: 1, gameName: 1, withdrawNumberList: 1, parentGameId: 1 });
                    // Jackpot games count and winnings
                    // const jackPotData = await Sys.Game.Game1.Controllers.GameController.getJackpotData(
                    //     room.gameName,
                    //     room.withdrawNumberList.length,
                    //     room.jackpotDraw,
                    //     room.jackpotPrize,
                    //     room.subGames,
                    //     room.parentGameId
                    // );

                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange', { patternList: patternList, jackPotData: jackPotData });
                } else if (game.gameMode == 'Manual' && data.jackpotDraw) {
                    await Sys.Game.Game1.Services.GameServices.updateGameNew(game._id, { jackpotDraw: data.jackpotDraw });
                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('adminRefreshRoom', {});
                    let {patternList, jackPotData} = await Sys.Game.Game1.Controllers.GameProcess.patternListing(gameId);
                    //let patternList = patternListing.patternList;

                    //let room = await Sys.App.Services.GameService.getSingleGameData({ _id: gameId }, { jackpotPrize: 1, jackpotDraw: 1, subGames: 1, gameName: 1, withdrawNumberList: 1, parentGameId: 1 });
                    // Jackpot games count and winnings
                    // const jackPotData = await Sys.Game.Game1.Controllers.GameController.getJackpotData(
                    //     room.gameName,
                    //     room.withdrawNumberList.length,
                    //     room.jackpotDraw,
                    //     room.jackpotPrize,
                    //     room.subGames,
                    //     room.parentGameId
                    // );

                    Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('PatternChange', { patternList: patternList, jackPotData: jackPotData });
                }
                
                if (game.status == "active") {
                    if (Timeout.exists(game._id.toString())) {
                        console.log("timeout already exists", game._id.toString())
                        let keys = ["game_is_already_started"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
                        return {
                            "status": "fail",
                            "message": agentData.game_is_already_started
                        };
                        // return {
                        //     "status": "fail",
                        //     "message": "Game is already started."
                        // };
                    } else {
                        console.log("timeout not exists.")
                    }

                    if (game.gameMode == 'Manual') {
                        let tempIndex = Sys.Timers.indexOf(game._id.toString());
                        if (tempIndex !== -1) {
                            if (Timeout.exists(game._id.toString())) {
                                console.log("timeout already exists check in new timer set up", game._id.toString())
                                let keys = ["game_is_already_started"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
                                return {
                                    "status": "fail",
                                    "message": agentData.game_is_already_started
                                };
                                // return {
                                //     "status": "fail",
                                //     "message": "Game is already started."
                                // };
                            }
                            Sys.Timers.splice(tempIndex, 1);
                        }
                        let indexId = Sys.Timers.push(game._id.toString());
                        console.log("indexId---", indexId,);

                        let remainedTimeTostartGame = 0;
                        let TimeMessage = "";
                        let TimeType = game.notificationStartTime.slice(-1);
                        let keys = ["manual_game_start_second", "seconds", "minutes"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
                        let timeMessage = "";
                        if (TimeType == "m") {
                            let notificationTime = game.notificationStartTime.length <= 2 ? (game.notificationStartTime.substring(0, 1)) : (game.notificationStartTime.substring(0, 2));
                            remainedTimeTostartGame = notificationTime * 60;
                            TimeMessage = {
                                en: await translate({ key: "manual_game_start_minute", language: 'en', isDynamic: true, number: notificationTime , number1 : game.gameName}),
                                nor: await translate({ key: "manual_game_start_minute", language: 'nor', isDynamic: true, number: notificationTime ,number1 : game.gameName })
                            };

                            timeMessage = agentData.manual_game_start_second + " " + notificationTime + " " + agentData.minutes

                            //"The game Will Start in Next " + notificationTime + " Minutes";
                        } else {
                            remainedTimeTostartGame = game.notificationStartTime.length <= 2 ? (game.notificationStartTime.substring(0, 1)) : (game.notificationStartTime.substring(0, 2));
                            TimeMessage = {
                                en: await translate({ key: "manual_game_start_second", language: 'en', isDynamic: true, number: remainedTimeTostartGame , number1 : game.gameName }),
                                nor: await translate({ key: "manual_game_start_second", language: 'nor', isDynamic: true, number: remainedTimeTostartGame , number1 : game.gameName })
                            };
                            //"The game Will Start in Next " + remainedTimeTostartGame + " Seconds";
                            timeMessage = agentData.manual_game_start_second + " " + remainedTimeTostartGame + " " + agentData.seconds
                        }
                        console.log("remainedTimeTostartGame---", remainedTimeTostartGame, (remainedTimeTostartGame - 5))

                        await Promise.all(
                            game.players.map(async (player) => {
                                const isRunningGame = await checkGamePlayAtSameTimeForRefund(player, game._id);
                                if (isRunningGame?.status) {
                                    const socketId = player.socketId?.split('#')?.[1];
                                    if (!socketId) return;
                                    await Sys.Game.Common.Controllers.PlayerController.CheckForRefundAmount(
                                        socketId,
                                        {
                                            playerId: player.id.toString(),
                                            gameId: game._id,
                                            hallIds: isRunningGame.hallIds
                                            
                                        }
                                    );
                                }
                            })
                        );

                        let playerIds = [];
                        let bulkArr = [];
                        let notification = {};
                        for (let p = 0; p < game.players.length; p++) {
                            notification = {
                                notificationType: 'gameStartReminder',
                                message: TimeMessage
                            }
                            bulkArr.push({
                                insertOne: {
                                    document: {
                                        playerId: game.players[p].id,
                                        gameId: game._id,
                                        notification: notification
                                    }
                                }
                            })
                            if (game.players[p].userType != "Physical") {
                                playerIds.push(game.players[p].id);
                            }
                        }
                        Sys.Helper.gameHelper.sendNotificationToPlayers(game, playerIds, TimeMessage, notification.notificationType);
                        Sys.Game.Common.Services.NotificationServices.bulkWriteNotification(bulkArr);
                        await Sys.Game.Common.Services.GameServices.updateGame({ _id: game._id }, { $set: { isNotificationSent: true, timerStart: true } });
                        Sys.Io.of('admin').emit('updateSubgameTable', { gameId: game._id });

                        // Timeout.set(Sys.Timers[(indexId - 1)], async () => {
                        //     try {
                        //         console.log("---inside setTimeout---", game._id);

                        //         await Sys.Game.Game1.Services.GameServices.updateGameNew(game._id, { $set: { "otherData.disableCancelTicket": true } });  //disableTicketPurchase: true
                        //         Sys.Io.of(Sys.Config.Namespace.Game1).to(game._id).emit('refreshUpcomingGames', {});
                        //         // refresh upcoming and all game list

                        //         let index = Sys.Timers.indexOf(game._id.toString());
                        //         if (index !== -1) {
                        //             Timeout.clear(Sys.Timers[index], erase = true);
                        //             Sys.Timers.splice(index, 1);
                        //         }

                        //         //await Sys.Game.Common.Controllers.GameController.updateGame1TicketIds(game._id);  now we will do this functionality from ticket purchase and cancel

                        //         // Now start game 1 after 5 seconds
                        //         let delay = 5000;
                        //         if (remainedTimeTostartGame < 5) {
                        //             delay = (remainedTimeTostartGame * 1000);
                        //         }

                        //         setTimeout(async function () {
                        //             let updatedDataOfGame = await Sys.Game.Common.Services.GameServices.getSingleGameData({ _id: game._id });
                        //             if (updatedDataOfGame.status == 'active') {
                        //                 console.log('<====================================================================>');
                        //                 console.log('<=>                   || StartGame Game1 Starting (Manual) ||                   <=>');
                        //                 console.log('\x1b[36m%s\x1b[0m', '[ Game Details ]: ', updatedDataOfGame._id);
                        //                 console.log('\x1b[36m%s\x1b[0m', '[ Game Number ]: ', updatedDataOfGame.gameNumber);
                        //                 console.log('\x1b[36m%s\x1b[0m', '[ Game Players ]: ', updatedDataOfGame.players.length);
                        //                 console.log('\x1b[36m%s\x1b[0m', '[ Game Purchase Ticket ]: ', updatedDataOfGame.purchasedTickets.length);
                        //                 console.log('<====================================================================>');
                        //                 await Sys.Game.Game1.Services.GameServices.updateGameNew(updatedDataOfGame._id, { $set: { status: 'running', startDate: Date.now() } });
                        //                 updatedDataOfGame?.halls.forEach(hall => {
                        //                     Sys.Io.of('admin').to(hall).emit('refresh', { scheduleId: updatedDataOfGame.parentGameId });
                        //                 })
                        //                 Sys.Io.of('admin').emit('updateSubgameTable', { gameId: game._id });
                        //                 let ticketUpdate = [
                        //                     {
                        //                         'updateMany': {
                        //                             "filter": { "gameId": game._id.toString() },
                        //                             "update": { '$set': { "gameStartDate": Date.now() } }
                        //                         }
                        //                     }
                        //                 ]
                        //                 Sys.App.Services.GameService.bulkWriteTicketData(ticketUpdate);
                        //                 let transactionUpdate = [
                        //                     {
                        //                         'updateMany': {
                        //                             "filter": { "gameId": updatedDataOfGame._id.toString() },
                        //                             "update": { '$set': { "gameStartDate": Date.now() } }
                        //                         }
                        //                     }
                        //                 ]
                        //                 Sys.App.Services.GameService.bulkWriteTransactionData(transactionUpdate);
                        //                 await Sys.Game.Game1.Controllers.GameProcess.StartGame(updatedDataOfGame._id);
                        //             }
                        //         }, delay); // 5000



                        //     } catch (e) {
                        //         console.log("error in timeout of game 1 start", e);
                        //     }

                        // }, ((remainedTimeTostartGame - 5) * 1000));

                        // let secondsToAdd = +remainedTimeTostartGame; // (+remainedTimeTostartGame + 1);

                        // let timerStart = setInterval(async function () {
                        //     secondsToAdd = secondsToAdd - 1;
                        //     if (secondsToAdd <= 0) {
                        //         clearInterval(timerStart);
                        //     }else{
                        //         await Sys.Io.of(Sys.Config.Namespace.Game1).to(game._id).emit('countDownToStartTheGame', {
                        //             gameId: game._id,
                        //             count: secondsToAdd
                        //         });
                        //     } 
                        // }, 1000);

                        // Start the game with countdown using smart-timeout
                        module.exports.startGameWithCountdown(game, remainedTimeTostartGame, indexId);
                        return {
                            "status": "success",
                            "message": timeMessage,
                            "reminingTime": remainedTimeTostartGame
                        };

                    }
                    let keys = ["something_went_wrong_please_try_again_later"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
                    return {
                        "status": "fail",
                        "message": agentData.something_went_wrong_please_try_again_later
                    };
                    // return {
                    //     "status": "fail",
                    //     "message": "Something went wrong."
                    // };
                } else {
                    let keys = ["game_is_already_started"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
                    return {
                        "status": "fail",
                        "message": agentData.game_is_already_started
                    };
                    // return {
                    //     "status": "fail",
                    //     "message": "Game is already started."
                    // };
                }


            } else {
                let keys = ["something_went_wrong_please_try_again_later"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
                return {
                    "status": "fail",
                    "message": agentData.something_went_wrong_please_try_again_later
                };
                // return {
                //     "status": "fail",
                //     "message": "Something went wrong."
                // };
            }

        } catch (e) {
            console.log("Error in getGameAgents", e)
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, language);
            return {
                "status": "fail",
                "message": agentData.something_went_wrong_please_try_again_later
            };
            // return {
            //     "status": "fail",
            //     "message": "Something went wrong."
            // };
        }
    },

    /**
     * Initiates a countdown sequence before starting a game, with special handling for ticket purchases
     * 
     * @param {Object} game - The game object containing game details and ID
     * @param {number} remainedTimeTostartGame - The total time in seconds before the game should start
     * 
     * @description
     * This function manages a countdown sequence before starting a game with the following features:
     * 1. Broadcasts countdown updates to all connected clients every second
     * 2. Disables ticket purchases 5 seconds before game start
     * 3. Refreshes upcoming games list when tickets are disabled
     * 4. Automatically starts the game when countdown reaches zero
     * 
     * The countdown is implemented using a smart-timeout system to ensure accurate timing
     * and proper cleanup of resources.
     */
    startGameWithCountdown: async function (game, remainedTimeTostartGame, indexId) {
        try {
            console.log("---inside startGameWithCountdown---", game._id);

            // Function to disable ticket purchase
            const disableTicketPurchase = async () => {
                await Sys.Game.Game1.Services.GameServices.updateGameNew(game._id, {
                    $set: { "otherData.disableCancelTicket": true }
                });
                Sys.Io.of(Sys.Config.Namespace.Game1).to(game._id).emit('refreshUpcomingGames', {});
            };

            // If game should start immediately, skip countdown and process directly
            if (remainedTimeTostartGame <= 0) {
                await disableTicketPurchase();
                return module.exports.startGame(game); // Start the game immediately
            }
    
            let secondsToStart = Math.max(0, remainedTimeTostartGame - 1);
            let disableTicketsTime = 5; // disable ticket purchase before 5 second of gaem start
            let ticketDisabled = false;
    
            const countdownTick = async () => {
                if (secondsToStart >= 0) {
                    // Broadcast countdown
                    Sys.Io.of(Sys.Config.Namespace.Game1).to(game._id).emit('countDownToStartTheGame', {
                        gameId: game._id,
                        count: secondsToStart
                    });
                   
                    // Disable ticket purchase & refresh upcoming games 
                    if (secondsToStart <= disableTicketsTime && !ticketDisabled) {
                        ticketDisabled = true;
                        await disableTicketPurchase();
                    }
    
                    secondsToStart--;
                    
                    // Find the updated indexId before setting the timeout
                    let updatedIndexId = Sys.Timers.indexOf(game._id.toString());
                    if (updatedIndexId === -1) {
                        updatedIndexId = Sys.Timers.push(game._id.toString()) - 1; // Add it if missing
                    }

                    // Set timeout using the updated indexId
                    let timerKey = Sys.Timers[updatedIndexId] ? Sys.Timers[updatedIndexId] : game._id.toString();

                    if (Timeout.exists(timerKey)) {
                        Timeout.clear(timerKey);
                    }

                    Timeout.set(timerKey, countdownTick, 1000);
                } else {
                    module.exports.startGame(game); // Start game exactly when countdown reaches 0
                }
            };
            
            // Ensure no existing countdown before starting a new one
            let timerKey = Sys.Timers[indexId-1] ? Sys.Timers[indexId-1] : game._id.toString();
            if (Timeout.exists(timerKey)) {
                Timeout.clear(timerKey);
            }
            Timeout.set(timerKey, countdownTick, 1000);
        } catch (e) {
            console.log("Error in startGameWithCountdown", e);
        }
    },
    
    /**
     * Initiates the actual game start process after countdown completion
     * 
     * @param {Object} game - The game object containing game details and ID
     * 
     * @description
     * This function handles the actual game start process with the following features:
     * 1. Verifies game status is 'active' before proceeding
     * 2. Updates game status to 'running' and sets start time
     * 3. Broadcasts game start notifications to all connected clients
     * 4. Updates game start time for all associated tickets and transactions
     * 5. Logs detailed game information including:
     *    - Game ID
     *    - Game Number
     *    - Number of Players
     *    - Number of Purchased Tickets
     * 
     * The function is called automatically when the countdown reaches zero
     * and ensures all necessary game state updates and notifications are handled.
     */
    startGame: async function(game) {
        try {
            let updatedDataOfGame = await Sys.Game.Common.Services.GameServices.getSingleGameData({ _id: game._id });
    
            if (updatedDataOfGame.status == 'active') {
                console.log('<====================================================================>');
                console.log('<=>                   || StartGame Game1 Starting (Manual) ||                   <=>');
                console.log('\x1b[36m%s\x1b[0m', '[ Game Details ]: ', updatedDataOfGame._id);
                console.log('\x1b[36m%s\x1b[0m', '[ Game Number ]: ', updatedDataOfGame.gameNumber);
                console.log('\x1b[36m%s\x1b[0m', '[ Game Players ]: ', updatedDataOfGame.players.length);
                console.log('\x1b[36m%s\x1b[0m', '[ Game Purchase Ticket ]: ', updatedDataOfGame.purchasedTickets.length);
                console.log('<====================================================================>');
    
                await Sys.Game.Game1.Services.GameServices.updateGameNew(updatedDataOfGame._id, {
                    $set: { status: 'running', startDate: Date.now() }
                });
    
                updatedDataOfGame?.halls.forEach(hall => {
                    Sys.Io.of('admin').to(hall).emit('refresh', { scheduleId: updatedDataOfGame.parentGameId });
                });
    
                Sys.Io.of('admin').emit('updateSubgameTable', { gameId: game._id });
    
                let gameStartDate = Date.now();
                let ticketUpdate = [{
                    'updateMany': {
                        "filter": { "gameId": game._id.toString() },
                        "update": { '$set': { "gameStartDate": gameStartDate } }
                    }
                }];
    
                let transactionUpdate = [{
                    'updateMany': {
                        "filter": { "gameId": updatedDataOfGame._id.toString() },
                        "update": { '$set': { "gameStartDate": gameStartDate } }
                    }
                }];
    
                Sys.App.Services.GameService.bulkWriteTicketData(ticketUpdate);
                Sys.App.Services.GameService.bulkWriteTransactionData(transactionUpdate);
    
                await Sys.Game.Game1.Controllers.GameProcess.StartGame(updatedDataOfGame._id);
            }
    
            // Clear countdown timeout when game starts
            let index = Sys.Timers.indexOf(game._id.toString());
            if (index !== -1) {
                Timeout.clear(Sys.Timers[index], erase = true);
                Sys.Timers.splice(index, 1);
            }
        } catch (e) {
            console.log("Error in startGame function", e);
        }
    },

    viewCashoutDetails: async function (req, res) {
        try {
            let keys = [
                "cashout_details",
                "dashboard",
                "game_name",
                "physical_ticket_no",
                "ticket_type",
                "ticket_price",
                "winning_pattern",
                "total_winning",
                "rewarded_amount",
                "pending_amount",
                "action",
                "bingo_pattern",
                "ticket_id",
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                action: "add",
                hallId: req.session.details.hall[0].id,
                translate: translate,
                navigation: translate
            };
            return res.render('cash-inout/cashout_details', data);
        } catch (error) {
            console.error("Error while loading cashout details page", error);
            req.flash("error", "something went wrong.");
            return res.redirect('/dashboard');
        }
    },

    /**
     * Handles an agent's request to check if a bingo claim is valid for a given ticket.
     *
     * Steps:
     * 1. Validate agent session and hall access:
     *    - Ensure agent is logged in and has access to the hall.
     *    - Block multiple active agents unless in "view" mode.
     * 2. Fetch game and ticket data in parallel:
     *    - From `GameService` (game details, unclaimed winners, withdraw numbers).
     *    - From `TicketService` (ticket details and metadata).
     * 3. Validate ticket:
     *    - Ensure ticket exists and belongs to the correct hall (or master hall).
     * 4. Initialize and update ticket winning stats.
     * 5. If ticket is "Physical":
     *    - Check unclaimed winners for a match against the current draw and pattern.
     *    - If matched, build a winner object and update:
     *      - Game’s claimed/unclaimed winners.
     *      - Ticket’s `winningStats` with matched winner.
     * 6. Return the final response to the agent:
     *    - Ticket details, winnings, unclaimed winners, draw info, and pattern.
     * @async
     * @param {Object} req - Express request object, containing session and body:
     *    - body.ticketNumber {string} - Ticket being checked.
     *    - body.id {string} - Game ID.
     *    - body.isView {boolean} - Whether in view-only mode.
     * @param {Object} res - Express response object (sends status + results).
     * @returns {Promise<void>} Sends JSON response with `success` or `fail`.
    */
    agentGameCheckBingo: async function (req, res) {
        try {
            console.log("agent agentGameCheckBingo", req.body)
            const { ticketNumber, id: gameId, isView } = req.body;
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        if (!isView) {
                            let keys = ["please_ensure_the_previous_agent_logs_out_to_check_for_bingo"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.please_ensure_the_previous_agent_logs_out_to_check_for_bingo
                            });
                        }
                    }
                    // Get gameData and ticket both DB calls in parallel
                    const [gameData, ticket] = await Promise.all([
                        Sys.App.Services.GameService.getSingleGameData(
                            { _id: gameId },
                            { 'otherData.masterHallId': 1, 'otherData.unclaimedWinners': 1, 'otherData.currentPattern': 1, 'otherData.gameSecondaryStatus': 1, withdrawNumberArray: 1, gameName: 1, ticketsWinningPrices: 1, earnedFromTickets: 1, jackpotDraw: 1, jackpotPrize: 1, parentGameId: 1, status: 1, groupHalls: 1 },
                        ),
                        Sys.App.Services.GameService.getSingleTicketByData(
                            { ticketId: ticketNumber, gameType: "game_1", gameId: gameId },
                            { tickets: 1, otherData: 1, userType: 1, gameStartDate: 1, hallId: 1 }
                        )
                    ]);

                    // Check for invalid ticket (not found or hallId mismatch)
                    const isMasterHallMatch = gameData?.otherData?.masterHallId === hallId; // ticket?.hallId;
                    const isTicketHallMatch = ticket?.hallId === hallId;
                
                    // Master can view all the tickets and non master can view his halls tickets
                    if (!ticket || (!isMasterHallMatch && !isTicketHallMatch)) {
                        return res.send({
                            status: "fail",
                            message: await Sys.Helper.bingo.getSingleTraslateData(["ticket_not_valid_or_not_sold"], req.session.details.language)
                        });
                    }

                    // update ticket winning stats
                    if (!ticket.otherData) ticket.otherData = {};
                    if (!Array.isArray(ticket.otherData.winningStats)) {
                        ticket.otherData.winningStats = [];
                    }

                    
                    const isPhysical = ticket?.userType === "Physical";
                    const gameName = gameData?.gameName;
                    const gameStatus = gameData?.status;
                    const currentPattern = gameData?.otherData?.currentPattern || "Row 1";
                    const withdrawArr = gameData?.withdrawNumberArray || [];
                    const currentWithdrawBall = withdrawArr.at(-1);
                    const currentWithdrawBallCount = withdrawArr.length;
                    const tvExtraPatterns = ["Frame", "Picture", "Full House"];
                
                    // check for unclaimed winners and assign winnigs if player actually won at the moment
                    let winnings = [];
                    let unclaimedWinners = [];
                    let matchedWinners = [];
                    let winnerObjects = []
                    if(isPhysical){
                        const unclaimed = gameData?.otherData?.unclaimedWinners || [];
                        const ticketIdStr = ticket._id?.toString();
                        
                        for (let i = unclaimed.length - 1; i >= 0; i--) {
                            const t = unclaimed[i];
                            if (t.ticketId !== ticketIdStr) continue;
                            
                            const w = buildWinnerObj(t, currentWithdrawBall, currentWithdrawBallCount);
                        
                            if (
                                gameStatus != "finish" &&
                                w.currentWithdrawBall === currentWithdrawBall &&
                                w.currentWithdrawBallCount === currentWithdrawBallCount &&
                                (
                                    gameName === "Tv Extra"
                                      ? tvExtraPatterns.includes(w.lineType)
                                      : w.lineType === currentPattern
                                )
                            ) {
                                console.log("matched")
                                if (gameName === "Tv Extra") {
                                    matchedWinners.push(w);
                                    winnerObjects.push(t);
                                } else if (!matchedWinners.length) {
                                    matchedWinners.push(w);
                                    winnerObjects.push(t);
                                }
                            } else {
                                unclaimedWinners.unshift(w); // maintain order
                            }
                        }
                        console.log("matchedWinners---", matchedWinners, unclaimedWinners)
                        if (matchedWinners.length) {
                            // Process each winner one at a time
                            let latestWinners = null;
                            for (let i = 0; i < matchedWinners.length; i++) {
                                const { winningStats, winners } = await claimUpdateWinnersDB({
                                    gameId,
                                    matchedWinner: matchedWinners[i],
                                    winnerObject: winnerObjects[i],
                                    gameName,
                                    ticket: ticket.tickets,
                                    currentWithdrawBall,
                                    currentWithdrawBallCount,
                                    isAdditionalWinners: false
                                });
                    
                                if (winningStats && Object.keys(winningStats).length) {
                                    ticket.otherData.winningStats = winningStats;
                                } else {
                                    ticket.otherData.winningStats.push(matchedWinners[i]);
                                }
                                latestWinners = winners;
                            }
                            // check additional row winnings
                            if (gameName !== "Tv Extra" && gameStatus != "finish") {
                                const { addiWinners } = await checkAdditionalRowWins( { winnerObject: winnerObjects[0], updatedGame: {gameName, gameId: gameData._id, ticketsWinningPrices: gameData.ticketsWinningPrices, winners: latestWinners, earnedFromTickets: gameData.earnedFromTickets, jackpotDraw: gameData.jackpotDraw, jackpotPrize: gameData.jackpotPrize, parentGameId: gameData.parentGameId }, ticket: ticket.tickets, ticketId: ticket._id, currentWithdrawBall, currentWithdrawBallCount } );
                                console.log("addiWinners----", addiWinners)
                                if(addiWinners && addiWinners.length > 0){
                                    for (let i = 0; i < addiWinners.length; i++) {
                                        const winner = addiWinners[i];
                                        const w = buildWinnerObj(winner, currentWithdrawBall, currentWithdrawBallCount);
                                        const { winningStats, winners } = await claimUpdateWinnersDB({
                                            gameId,
                                            matchedWinner: w,
                                            winnerObject: addiWinners[i],
                                            gameName,
                                            ticket: ticket.tickets,
                                            currentWithdrawBall,
                                            currentWithdrawBallCount,
                                            isAdditionalWinners: true
                                        });
                            
                                        if (winningStats && Object.keys(winningStats).length) {
                                            ticket.otherData.winningStats = winningStats;
                                        } else {
                                            ticket.otherData.winningStats.push(w);
                                        }
                                        latestWinners = winners;
                                    }
                                }
                            }
                        }
                    }

                    // Get final winnings after evaluating matched unclaimed winner
                    winnings = ticket.otherData.winningStats;

                    // group of halls list
                    const groupOfHallsId = (gameData?.groupHalls ?? [])
                        .find(hall => hall.id === hallsData?.groupHall?.id)
                        ?.selectedHalls?.map(sh => sh.id) ?? [];
                    console.log("groupOfHallsId---", groupOfHallsId)
                    const response = { status: "success", ticket: ticket.tickets, winnings: winnings, ticketNumber: req.body.ticketNumber, id: gameId, isPhysical: isPhysical, gameStartDate: ticket.gameStartDate, total_draw_count: currentWithdrawBallCount, currentPattern, unclaimedWinners, hallId, gameStatus, groupOfHallsId };
                    
                    if(gameData?.otherData?.gameSecondaryStatus !== "finish"){
                        broadcastTvScreenWinners(response); // broadcast to TV Screen
                    }
                    
                    return res.send(response);
                    
                } else {
                    return res.send({
                        status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language)
                    });
                }

            } else {
                return res.send({
                    status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong_please_try_again_later"], req.session.details.language)
                });
            }
        } catch (e) {
            console.log("Error in agent game check bingo", e)
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            return res.send({
                status: "fail", message: agentData.something_went_wrong_please_try_again_later
            });
        }
    },

    agentphysicalTicketCashout: async function (req, res) {
        try {
            console.log("agent agentGameCheckBingo", req.body)
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, name: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        let keys = ["please_ensure_the_previous_agent_logs_out_to_cash_out"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                        return res.send({
                            status: "fail", message: agentData.please_ensure_the_previous_agent_logs_out_to_cash_out
                        });
                        // return res.send({
                        //     status: "fail", message: `Please ensure the previous agent logs out to Cash out.`
                        // });
                    }

                    let index = hallsData.activeAgents.findIndex((e) => e.id == agentId);
                    let dailyBalance = hallsData.activeAgents[index].dailyBalance;

                    let ticket = await Sys.App.Services.GameService.getSingleTicketByData({ ticketId: req.body.ticketNumber, gameType: "game_1", gameId: req.body.id }, { tickets: 1, otherData: 1, userType: 1, ticketPrice: 1, gameStartDate: 1, hallId: 1, gameId: 1, gameName: 1 });
                    console.log("ticket----", ticket)
                    if (ticket) {
                        if (ticket.userType != "Physical") {
                            let keys = ["you_can_only_cash_out_to_physical_players"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.you_can_only_cash_out_to_physical_players
                            });
                            // return res.send({ status: "fail", message: `You can only cash out to physical players` });
                        }

                        if (hallId != ticket.hallId) {
                            let keys = ["you_can_only_cash_out_to_your_halls_physical_players"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.you_can_only_cash_out_to_your_halls_physical_players
                            });
                            // return res.send({ status: "fail", message: `You can only cash out to your hall's physical players` });
                        }


                        const gameStartDate = moment(ticket.gameStartDate);
                        const currentDate = moment();
                        console.log("gameStartDate---", gameStartDate, currentDate);
                        if (currentDate.isAfter(gameStartDate, 'day')) {
                            let keys = ["you_can_only_cash_out_to_on_the_same_day_of_game_played"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.you_can_only_cash_out_to_on_the_same_day_of_game_played
                            });
                            // return res.send({ status: "fail", message: `You can only cash out on the same day of game played` });
                        }

                        let winnings = [];
                        if (ticket.otherData && ticket.otherData.winningStats) {
                            let allwinnings = ticket.otherData.winningStats;
                            if (req.body.lineType && allwinnings && allwinnings.length > 0) {
                                let winning = allwinnings.find(win => win.lineType == req.body.lineType);
                                if (winning) {
                                    winnings.push(winning);
                                }
                            }
                        }
                        if (winnings.length > 0) {
                            if (winnings[0].isWinningDistributed == false) {
                                let amount = winnings[0].wonAmount;
                                if (amount <= 0) {
                                    let keys = ["winning_amount_should_be_greater_then_zero"];
                                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                    return res.send({
                                        status: "fail", message: agentData.winning_amount_should_be_greater_then_zero
                                    });
                                    // return res.json({ status: "fail", message: "Winning amount should be greater than Zero" });
                                }
                                if (dailyBalance < +amount) {
                                    let keys = ["you_dont_have_enough_amount_in_your_daily_balance"];
                                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                    return res.send({
                                        status: "fail", message: agentData.you_dont_have_enough_amount_in_your_daily_balance
                                    });
                                    // return res.json({ status: "fail", message: "You don't have enough amount in your daily balance" });
                                }

                                await Sys.Helper.gameHelper.cashoutPhyscialTicketPatternbyPattern({
                                    agentId: agentId,
                                    agentName: req.session.details.name,
                                    hallId: hallsData._id,
                                    hallName: hallsData.name,
                                    groupHall: hallsData.groupHall,
                                    shiftId: req.session.details.shiftId,
                                    totalAmount: +amount,
                                    gameId: req.body.id,
                                    ticketNumber: req.body.ticketNumber,
                                    lineType: req.body.lineType,
                                    ticketId: ticket.id,
                                    ticketPrice: ticket.ticketPrice
                                    //typeOfTransaction: "Physical Ticket Winning Distribution"
                                });

                                let updatedTicketsData = await Sys.Game.Game1.Services.GameServices.updateTicketNested({ _id: ticket._id, gameId: req.body.id },
                                    {
                                        $set: {
                                            "otherData.winningStats.$[current].isWinningDistributed": true,
                                        }
                                    }, { arrayFilters: [{ "current.lineType": req.body.lineType }], new: true });


                                req.session.details.dailyBalance = Number(req.session.details.dailyBalance) - (+amount);
                                if(ticket?.gameName == "Wheel of Fortune" && ticket?.gameId && req.body.lineType == "Full House"){
                                    await Sys.Game.Game1.Services.GameServices.updateGameNew(ticket.gameId, {
                                        $set: { "otherData.minigameManualRewardStatus": "Success" }
                                    });
                                }
                                let keys = ["cashout_of", "kr_for", "pattern_successfully_completed"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                let gameData = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id }, { withdrawNumberArray: 1, status: 1});
                                return res.send({
                                    status: "success", message: agentData.cashout_of + " " + amount + agentData.kr_for + " " + req.body.lineType + " " + agentData.pattern_successfully_completed, ticket: ticket.tickets, winnings: updatedTicketsData.otherData.winningStats, ticketNumber: req.body.ticketNumber, id: req.body.id, isPhysical: (ticket.userType == "Physical") ? true : false, gameStartDate: ticket.gameStartDate, total_draw_count: gameData?.withdrawNumberArray?.length, gameStatus: gameData?.status
                                });
                                //return res.send({ status: "success", message: `Cashout of ${+amount} Kr for ${req.body.lineType} Pattern successfully Completed`, ticket: ticket.tickets, winnings: updatedTicketsData.otherData.winningStats, ticketNumber: req.body.ticketNumber, id: req.body.id, isPhysical: (ticket.userType == "Physical") ? true : false, gameStartDate: ticket.gameStartDate });
                            } else {
                                let keys = ["already_cashout_for", "pattern"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                return res.send({
                                    status: "fail", message: { status: "fail", message: `${agentData.already_cashout_for} ${req.body.lineType} ${agentData.pattern}`, isAlreadyCashout: true, ticket: ticket.tickets, winnings: ticket.otherData.winningStats, ticketNumber: req.body.ticketNumber, id: req.body.id, isPhysical: (ticket.userType == "Physical") ? true : false, gameStartDate: ticket.gameStartDate }
                                });
                                // return res.send({ status: "fail", message: `Already cashout for ${req.body.lineType} Pattern`, isAlreadyCashout: true, ticket: ticket.tickets, winnings: ticket.otherData.winningStats, ticketNumber: req.body.ticketNumber, id: req.body.id, isPhysical: (ticket.userType == "Physical") ? true : false, gameStartDate: ticket.gameStartDate });
                            }
                        } else {
                            let keys = ["no_winnings_available_for", "pattern"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.no_winnings_available_for + req.body.lineType + agentData.pattern
                            });
                            // return res.send({ status: "fail", message: `No winnings available for ${req.body.lineType} Pattern` });
                        }
                    }
                    let keys = ["invalid_ticket_id"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.send({
                        status: "fail", message: agentData.invalid_ticket_id
                    });
                    // return res.send({ status: "fail", message: 'Invalid Ticket ID' });
                } else {
                    let keys = ["something_went_wrong_please_try_again_later"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.send({
                        status: "fail", message: agentData.something_went_wrong_please_try_again_later
                    });
                    //return res.send({ status: "fail", message: 'Something went wrong, please login and try again' })
                }

            } else {
                let keys = ["something_went_wrong_please_try_again_later"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                return res.send({
                    status: "fail", message: agentData.something_went_wrong_please_try_again_later
                });
                // return res.send({ status: "fail", message: 'Something went wrong, please login and try again' });
            }
        } catch (e) {
            console.log("Error in agent physical ticket cash out", e)
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            return res.send({
                status: "fail", message: agentData.something_went_wrong_please_try_again_later
            });
            //res.send({ status: "fail", message: "Something went wrong" });
        }
    },

    agentphysicalTicketAddToWallet: async function (req, res) {
        try {
            console.log("agent agentphysicalTicketAddToWallet", req.body)
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;
                if(!req.body.username){
                    let keys = ["please_enter_valid_username"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.send({
                        status: "fail", message: agentData.please_enter_valid_username
                    });
                }
                let playerData = await Sys.App.Services.PlayerServices.getSinglePlayerByData({username: req.body.username, isDeleted: false});
                if(!playerData){
                    let keys = ["player_not_found"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.send({
                        status: "fail", message: agentData.player_not_found
                    });
                }
                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, name: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        let keys = ["please_ensure_the_previous_agent_logs_out_to_cash_out"];
                        let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                        return res.send({
                            status: "fail", message: agentData.please_ensure_the_previous_agent_logs_out_to_cash_out
                        });
                        // return res.send({
                        //     status: "fail", message: `Please ensure the previous agent logs out to Cash out.`
                        // });
                    }

                    let ticket = await Sys.App.Services.GameService.getSingleTicketByData({ ticketId: req.body.ticketNumber, gameType: "game_1", gameId: req.body.id }, { tickets: 1, otherData: 1, userType: 1, ticketPrice: 1, playerIdOfPurchaser: 1, gameStartDate: 1, hallId: 1, gameId: 1, gameName: 1 });
                    
                    if (ticket) {
                        if (ticket.userType != "Physical") {
                            let keys = ["you_can_only_cash_out_to_physical_players"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.you_can_only_cash_out_to_physical_players
                            });
                            // return res.send({ status: "fail", message: `You can only cash out to physical players` });
                        }

                        if (hallId != ticket.hallId) {
                            let keys = ["you_can_only_cash_out_to_your_halls_physical_players"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.you_can_only_cash_out_to_your_halls_physical_players
                            });
                            // return res.send({ status: "fail", message: `You can only cash out to your hall's physical players` });
                        }


                        const gameStartDate = moment(ticket.gameStartDate);
                        const currentDate = moment();
                       
                        if (currentDate.isAfter(gameStartDate, 'day')) {
                            let keys = ["you_can_only_cash_out_to_on_the_same_day_of_game_played"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.you_can_only_cash_out_to_on_the_same_day_of_game_played
                            });
                            // return res.send({ status: "fail", message: `You can only cash out on the same day of game played` });
                        }

                        let winnings = [];
                        if (ticket.otherData && ticket.otherData.winningStats) {
                            let allwinnings = ticket.otherData.winningStats;
                            if (req.body.lineType && allwinnings && allwinnings.length > 0) {
                                let winning = allwinnings.find(win => win.lineType == req.body.lineType);
                                if (winning) {
                                    winnings.push(winning);
                                }
                            }
                        }
                        if (winnings.length > 0) {
                            if (winnings[0].isWinningDistributed == false) {
                                let amount = winnings[0].wonAmount;
                                if (amount <= 0) {
                                    let keys = ["winning_amount_should_be_greater_then_zero"];
                                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                    return res.send({
                                        status: "fail", message: agentData.winning_amount_should_be_greater_then_zero
                                    });
                                    // return res.json({ status: "fail", message: "Winning amount should be greater than Zero" });
                                }
                               
                                await Sys.Helper.gameHelper.cashoutPhyscialTicketPatternbyPattern({
                                    agentId: agentId,
                                    agentName: req.session.details.name,
                                    hallId: hallsData._id,
                                    hallName: hallsData.name,
                                    groupHall: hallsData.groupHall,
                                    shiftId: req.session.details.shiftId,
                                    totalAmount: +amount,
                                    gameId: req.body.id,
                                    ticketNumber: req.body.ticketNumber,
                                    lineType: req.body.lineType,
                                    ticketId: ticket.id,
                                    ticketPrice: ticket.ticketPrice,
                                    isTransferToWallet: true,
                                    playerData: {id: playerData._id, username: playerData.username}
                                    //typeOfTransaction: "Physical Ticket Winning Distribution"
                                });

                                let updatedTicketsData = await Sys.Game.Game1.Services.GameServices.updateTicketNested({ _id: ticket._id, gameId: req.body.id },
                                    {
                                        $set: {
                                            "otherData.winningStats.$[current].isWinningDistributed": true,
                                        }
                                    }, { arrayFilters: [{ "current.lineType": req.body.lineType }], new: true });


                                if(ticket?.gameName == "Wheel of Fortune" && ticket?.gameId && req.body.lineType == "Full House"){
                                    await Sys.Game.Game1.Services.GameServices.updateGameNew(ticket.gameId, {
                                        $set: { "otherData.minigameManualRewardStatus": "Success" }
                                    });
                                }
                                let keys = ["cashout_of", "kr_for", "pattern_successfully_completed"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                let gameData = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id }, { withdrawNumberArray: 1, status: 1});
                                await Sys.App.Services.PlayerServices.findOneandUpdatePlayer({username: req.body.username, isDeleted: false}, {$inc: {walletAmount: +amount} }, {new: true});
                                await updatePlayerHallSpendingData({ playerId: playerData._id, hallId: ticket.hallId, amount: +amount, type: "normal", gameStatus: 3 });
                                return res.send({
                                    status: "success", message: agentData.cashout_of + " " + amount + agentData.kr_for + " " + req.body.lineType + " " + agentData.pattern_successfully_completed, ticket: ticket.tickets, winnings: updatedTicketsData.otherData.winningStats, ticketNumber: req.body.ticketNumber, id: req.body.id, isPhysical: (ticket.userType == "Physical") ? true : false, gameStartDate: ticket.gameStartDate, total_draw_count: gameData?.withdrawNumberArray?.length, gameStatus: gameData?.status
                                });
                                //return res.send({ status: "success", message: `Cashout of ${+amount} Kr for ${req.body.lineType} Pattern successfully Completed`, ticket: ticket.tickets, winnings: updatedTicketsData.otherData.winningStats, ticketNumber: req.body.ticketNumber, id: req.body.id, isPhysical: (ticket.userType == "Physical") ? true : false, gameStartDate: ticket.gameStartDate });
                            } else {
                                let keys = ["already_cashout_for", "pattern"];
                                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                                return res.send({
                                    status: "fail", message: { status: "fail", message: `${agentData.already_cashout_for} ${req.body.lineType} ${agentData.pattern}`, isAlreadyCashout: true, ticket: ticket.tickets, winnings: ticket.otherData.winningStats, ticketNumber: req.body.ticketNumber, id: req.body.id, isPhysical: (ticket.userType == "Physical") ? true : false, gameStartDate: ticket.gameStartDate }
                                });
                                // return res.send({ status: "fail", message: `Already cashout for ${req.body.lineType} Pattern`, isAlreadyCashout: true, ticket: ticket.tickets, winnings: ticket.otherData.winningStats, ticketNumber: req.body.ticketNumber, id: req.body.id, isPhysical: (ticket.userType == "Physical") ? true : false, gameStartDate: ticket.gameStartDate });
                            }
                        } else {
                            let keys = ["no_winnings_available_for", "pattern"];
                            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                            return res.send({
                                status: "fail", message: agentData.no_winnings_available_for + req.body.lineType + agentData.pattern
                            });
                            // return res.send({ status: "fail", message: `No winnings available for ${req.body.lineType} Pattern` });
                        }
                    }
                    let keys = ["invalid_ticket_id"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.send({
                        status: "fail", message: agentData.invalid_ticket_id
                    });
                    // return res.send({ status: "fail", message: 'Invalid Ticket ID' });
                } else {
                    let keys = ["something_went_wrong_please_try_again_later"];
                    let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    return res.send({
                        status: "fail", message: agentData.something_went_wrong_please_try_again_later
                    });
                    //return res.send({ status: "fail", message: 'Something went wrong, please login and try again' })
                }

            } else {
                let keys = ["something_went_wrong_please_try_again_later"];
                let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                return res.send({
                    status: "fail", message: agentData.something_went_wrong_please_try_again_later
                });
                // return res.send({ status: "fail", message: 'Something went wrong, please login and try again' });
            }
        } catch (e) {
            console.log("Error in agent physical ticket cash out", e)
            let keys = ["something_went_wrong_please_try_again_later"];
            let agentData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            return res.send({
                status: "fail", message: agentData.something_went_wrong_please_try_again_later
            });
            //res.send({ status: "fail", message: "Something went wrong" });
        }
    },

    getAgentCompletedGames: async function (req, res) {
        try {

            let gameData = [];
            let reqCount = 0;
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                let sort = { createdAt: -1 };

                const startDate = new Date();
                const endDate = new Date();
                startDate.setHours(0, 0, 0);
                endDate.setHours(23, 59, 59);

                let query = {
                    gameType: 'game_1',
                    status: "finish",
                    'otherData.gameSecondaryStatus': "finish",
                    halls: hallId,
                    startDate: {
                        $gte: startDate,
                        $lte: endDate
                    }
                };
                reqCount = await Sys.App.Services.GameService.getGameCount(query);

                let data = await Sys.App.Services.GameService.getGamesByData(query, { gameNumber: 1, gameName: 1, startDate: 1, subGames: 1, ticketSold: 1, earnedFromTickets: 1, totalWinning: 1, finalGameProfitAmount: 1, status: 1, gameMode: 1, groupHalls: 1, wofWinners: 1, 'otherData.minigameManualReward': 1, 'otherData.isTestGame': 1 }, { sort: sort }); //{ sort: sort, limit: length, skip: start }


                for (let i = 0; i < data.length; i++) {
                    // let ticketSoldObj = {};
                    // let totalSales = 0;
                    // let totalTicketsSold = 0;

                    // outerLoop: for (const groupHall of data[i].groupHalls) {
                    //     for (const hall of groupHall.halls) {
                    //     if (hall && hall.id === hallId) {
                    //         ticketSoldObj = hall.ticketData;
                    //         break outerLoop; // Breaks out of both loops
                    //     }
                    //     }
                    // }

                    // const updatedTickets = data[i].subGames[0].options.map(ticket => ({
                    //     ticketName: ticket.ticketName.split(' ').join('').toLowerCase(),
                    //     ticketPrice: ticket.ticketPrice
                    // }));

                    // updatedTickets.forEach(({ ticketName, ticketPrice }) => {
                    //     const ticketsSold = ticketSoldObj[ticketName] || 0;
                    //     totalSales += ticketPrice * ticketsSold;
                    //     totalTicketsSold += ticketsSold * (ticketName.includes('large') ? 3 : 1);
                    // });

                    // console.log("updatedTickets, obj, sale and ticket count--", updatedTickets, ticketSoldObj, totalSales, totalTicketsSold);


                    let dataGame = {
                        _id: data[i]._id,
                        gameNumber: data[i].gameNumber,
                        gameName: data[i].gameName,
                        startTime: moment(data[i].startDate).format("HH:mm"),
                        startTimeTemp: moment(data[i].startDate),
                        //totalTicketsSold: totalTicketsSold, //data[i].ticketSold,
                        //earnedFromTickets: totalSales, //+parseFloat(data[i].earnedFromTickets).toFixed(2),
                        //totalWinning: +parseFloat(data[i].totalWinning).toFixed(2),
                        //profit: +parseFloat(data[i].finalGameProfitAmount).toFixed(2),
                        //profitPercentage: +parseFloat(data[i].finalGameProfitAmount).toFixed(2),
                        status: data[i].status,
                        gameMode: data[i].gameMode,
                        isTestGame: data[i]?.otherData?.isTestGame ?? false,
                    }
                    if (data[i].gameName === "Wheel of Fortune") {
                        dataGame.wofPrize = data[i].otherData?.minigameManualReward || 0;
                        dataGame.canDistributeWOFPrize = data[i].wofWinners.every(winner => winner.playerType === "Physical")
                    }
                    gameData.push(dataGame);
                }
            }

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in getting agent completed game", e);
        }
    },

    productCartPage: async function (req, res) {
        try {
            let keys = [
                'please_add_product_in_you_hall_to_sell',
                "sell_Products",
                "dashboard",
                "sell_products",
                "view_cart",
                "cash",
                "card",
                "cart_details",
                "total_amount",
                "pay_by_username_customer_number",
                "enter_username_customer_number",
                "enter_username_customer_number_phone_number",
                "amount",
                "submit",
                "cancel",
                "failed",
                "please_add_product_to_purchase",
                "do_you_want_to_sell_product_to_username",
                "yes_sell_product",
                "the_sell_product_action_has_been_cancelled",
                "do_you_want_to_sell_the_product",
                "are_you_sure",
                "delete_button",
                "success",
                "failed",
                "cancelled"

            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            console.log("Product cart page called :", req.session.details.hall, req.session.details.dailyBalance);
            const hallData = await Sys.App.Services.HallServices.getSingleHallData({
                _id: req.session.details.hall[0].id
            }, { products: 1 })
            //find the products corresponding with current hall
            const products = await Sys.App.Services.ProductServices.getByData({ _id: { $in: hallData.products }, status: "active" });
            if (!products.length) {
                console.log("No products available in hall");
                req.flash("error", translate.please_add_product_in_you_hall_to_sell)
                // req.flash("error", "Please add product in your hall to sell.")
                return res.redirect('/agent/cashinout');
            }

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                products: products,
                translate: translate,
                navigation: translate
            };
            return res.render('cash-inout/product_cart', data);
        } catch (e) {
            console.error("Error in view of agent register user", e);
            req.flash("error", "Something went wrong.")
            return res.redirect('/agent/cashinout');
        }
    },

    createCart: async function (req, res) {
        try {
            console.log("create cart  called :", req.body);
            const { productList = [], userType, userName } = req.body;
            const hallData = await Sys.App.Services.HallServices.getSingleHallData({
                _id: req.session.details.hall[0].id
            })

            if (productList.length <= 0) {
                let keys = ['product_list_is_empty'];
                let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                req.flash("error", translate.product_list_is_empty)//"Product list is empty.")
                return res.redirect('/agent/sellProduct');
            }


            const finalProductList = productList.filter(p => p.quantity > 0);
            if (!finalProductList.length) {
                let keys = ['product_list_is_empty'];
                let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                req.flash("error", translate.product_list_is_empty)
                // req.flash("error", "Product list is empty.")
                return res.redirect('/agent/sellProduct');
            }

            let totalAmount = 0;
            finalProductList.forEach(p => {
                totalAmount = totalAmount + (p.quantity * p.price)
            })

            if (totalAmount < 0) {
                let keys = ['cart_total_amount_is_zero'];
                let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                req.flash("error", translate.cart_total_amount_is_zero)//"Cart total amount is zero.")
                return res.redirect('/agent/sellProduct');
            }

            let userDetails;

            if (userType !== "Physical") {
                const query = {
                    userType: userType,
                    username: userName,
                    "hall.id": req.session.details.hall[0].id,
                }

                if (userType == "Unique") {
                    query['uniqueExpiryDate'] = {
                        $gte: new Date()
                    }
                }

                userDetails = await Sys.App.Services.PlayerServices.getSinglePlayerData(query);

                // console.log("userDetails", userDetails);

                if (!userDetails) {
                    let keys = ['user_details_not_found'];
                    let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                    req.flash("error", translate.user_details_not_found)

                    // req.flash("error", "User details not found.");
                    return res.redirect('/agent/sellProduct');
                }
            }


            const productCart = {
                agentId: req.session.details.id,
                orderId: 'ORD' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                hallName: req.session.details.hall[0].name,
                hallId: req.session.details.hall[0].id,
                productList: finalProductList,
                userType: userType,
                userName: userName,
                agentName: req.session.details.name,
                userId: userDetails ? userDetails._id : req.session.details.id,
                status: "Cart Created",
                totalAmount: totalAmount,
                shiftId: req.session.details.shiftId
            }

            const cart = await Sys.App.Services.ProductServices.insertProductCartData(productCart);

            if (!cart) {
                let keys = ['something_went_wrong_please_try_again_later'];
                let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
                req.flash("error", translate.something_went_wrong_please_try_again_later)
                // req.flash("error", "Something went wrong.")
                return res.redirect('/agent/sellProduct');
            }
            let keys = ['cart_create_successfully'];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            // req.flash("success", "Cart created successfully.")
            req.flash("success", translate.cart_create_successfully)//"Cart created successfully.")
            res.redirect(`/agent/productCheckout?cartId=${cart._id}`);
            return;

        } catch (e) {
            console.error("Error in createCart api", e);
            let keys = ['something_went_wrong_please_try_again_later'];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            req.flash("error", translate.something_went_wrong_please_try_again_later)//"Something went wrong.")
            // req.flash("error", "Something went wrong.")
            return res.redirect('/agent/sellProduct');
        }
    },

    productCheckoutPage: async function (req, res) {
        try {
            console.log("product Checkout Page called", req.query);
            const { cartId } = req.query;
            let keys = [
                'product_cart_details_not_found',
                "sell_products_preview",
                "sell_products",
                "user_type",
                "customer_name",
                "product_name",
                "image",
                "price_per_quantity",
                "quantity",
                "total_amount",
                "action",
                "no_product_selected",
                "total_order_amount",
                "payment_type",
                "cash",
                "online_payment",
                "submit",
                "cancel",
                "please_confirm",
                "are_you_sure_to_place_order",
                "yes",
                "no",
                "success",
                "order_cancelled_successfully",
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            if (!cartId) {
                req.flash("error", translate.product_cart_details_not_found)//"Product cart details not found.")
                return res.redirect('/agent/sellProduct');
            }
            const cart = await Sys.App.Services.ProductServices.getFindOneCartByData({ _id: cartId, status: "Cart Created" });
            if (!cart) {
                req.flash("error", translate.product_cart_details_not_found)//"Product cart details not found.")
                return res.redirect('/agent/sellProduct');
            }

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                cart: cart,
                translate: translate,
                navigation: translate
            };
            return res.render('cash-inout/product_checkout', data);

        } catch (error) {
            console.error("Error in createCart api", error);
            let keys = ['something_went_wrong_please_try_again_later'];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            req.flash("error", translate.something_went_wrong_please_try_again_later)
            res.redirect('/agent/sellProduct');
            return;
        }
    },

    placeOrder: async function (req, res) {
        try {
            console.log("Place order api called", req.body);
            const { hallId, cartId, productList = [], paymentType } = req.body;
            let keys = ['order_placed_successfully', 'your_cart_is_empty', 'cart_details_not_found', "could_not_place_the_order"];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            let totalAmount = 0;
            let finalProductList = productList.filter(p => p.quantity >= 1);
            if (!finalProductList.length) {
                req.flash("error", translate.your_cart_is_empty)//"Your cart is empty!");
                res.redirect(`/agent/productCheckout?cartId=${cartId}`);
                return;
            }

            totalAmount = finalProductList.reduce((total, currentValue) => {
                return total + (currentValue.price * currentValue.quantity)
            }, 0)

            const cart = await Sys.App.Services.ProductServices.getFindOneCartByData({
                _id: cartId,
                status: "Cart Created",
                orderPlaced: false,
                shiftId: req.session.details.shiftId,
                agentId: req.session.details.id,
                hallId: hallId
            });

            if (!cart) {
                req.flash("error", translate.cart_details_not_found)//"Cart details not found.");
                res.redirect(`/agent/sellProduct`);
                return;
            }

            const transactionObject = {

                cartId: cart._id,
                orderId: cart.orderId,
                totalAmount: totalAmount,
                category: "credit",
                paymentType: paymentType,
                agentId: cart.agentId,
                agentName: req.session.details.name,
                userId: cart.userId,
                userType: cart.userType,
                userName: cart.userName,
                hallId: cart.hallId,
                hall: req.session.details.hall[0],
                shiftId: req.session.details.shiftId,
                typeOfTransaction: "Product Sales",
                productList: productList

            }

            const result = await Sys.Helper.gameHelper.productTransactionInHall(transactionObject);

            if (result.status == "success") {
                cart.productList = finalProductList;
                cart.orderPlaced = true;
                cart.totalAmount = totalAmount;
                cart.status = "Order Placed";
                cart.paymentMethod = paymentType;
                cart.updatedAt = new Date();
                cart.createdAt = new Date();

                await cart.save();
                // console.log("Cart updated", cart);

                if (paymentType == "Cash") {
                    req.session.details.dailyBalance = Number(req.session.details.dailyBalance) + totalAmount;
                }

                req.flash("success", translate.order_placed_successfully)//"Order placed successfully.");
                res.redirect(`/agent/sellProduct`);
                return;
            } else {
                req.flash("error", translate.could_not_place_the_order)//"Could not place the order.");
                res.redirect(`/agent/sellProduct`);
                return;
            }
        } catch (error) {
            console.error("Error while placing the order", error);
            let keys = ['something_went_wrong_please_try_again_later'];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            req.flash("error", translate.something_went_wrong_please_try_again_later)//"Something went wrong!");
            res.redirect(`/agent/productCheckout?cartId=${req.body.cartId}`);
            return;
        }
    },

    cancelOrder: async function (req, res) {
        let keys = ['something_went_wrong_please_try_again_later', "order_cancelled_successfully", "could_not_cancel_the_order"];
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            console.log("Cancel order api called", req.body);
            const { cartId } = req.body;
            const cart = await Sys.App.Services.ProductServices.deleteProductCart({ _id: cartId, orderPlaced: false, agnetId: req.session.details.id, shiftId: req.session.details.shiftId });
            console.log("deleteresult", cart);
            if (!cart.acknowledged || cart.deletedCount <= 0) {
                return res.json({ status: "fail", message: translate.could_not_cancel_the_order })//"Could not cancel the order.",  });
            }
            return res.json({ status: "success", message: translate.order_cancelled_successfully })//"Order cancelled successfully.",  });
        } catch (error) {
            console.error("Error while cancelling the order", error);
            return res.json({ message: translate.something_went_wrong_please_try_again_later, status: "fail" });
        }
    },

    sellagentTicketView: async function (req, res) {
        let keys = [
            "something_went_wrong_please_try_again_later",
            'game_not_found',
            "you_are_not_allowed_to_access_that_page",
            "please_ensure_the_previous_agent_logs_out_to_sell_tickets",
            "game_is_already_finished",
            "dashboard",
            "register_sold_ticket",
            "game",
            "final_id_of_the_stack",
            "data_updated_successfully",
            "ticket_type",
            "Initial_id",
            "final_id",
            "action",
            "submit",
            "cancel",
            "search",
            "show",
            "entries",
            "are_you_sure_you_want_to_delete_physical_ticket",
            "you_will_not_be_able_to_recover_this_physical_ticket",
            "delete_button",
            "cancel_button",
            "deleted",
            "physical_ticket_deleted_succesfully",
            "something_went_wrong",
            "deleted",
            "cancelled",
            "physical_ticket_not_deleted",
            "are_you_sure_you_want_to_remove_all_physical_ticket",
            "you_will_not_able_to_recover_this_physical_ticket",
        ];
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            let viewFlag = true;
            let addFlag = true;
            if (req.session.details.role == 'agent') {
                let stringReplace = req.session.details.isPermission['Physical Ticket Management'];
                if (stringReplace?.indexOf("view") == -1) {
                    viewFlag = false;
                }
                if (stringReplace?.indexOf("add") == -1) {
                    addFlag = false;
                }
            }
            if (viewFlag == false && addFlag == false) {
                req.flash('error', translate.you_are_not_allowed_to_access_that_page)//'You are Not allowed to access that page.');
                return res.redirect('/agent/cashinout');
            }

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        req.flash('error', translate.please_ensure_the_previous_agent_logs_out_to_sell_tickets)//'Please ensure the previous agent logs out to Sell tickets.');
                        return res.redirect('/agent/cashinout');
                    }
                }

                const gameData = await Sys.Game.Game1.Services.GameServices.getSingleByData(
                    {
                        _id: req.params.gameId, gameType: 'game_1', halls: { $in: [hallId] }, stopGame: false, 'otherData.isClosed': false,
                        startDate: {
                            $gte: moment().startOf('day').toDate(),
                            $lt: moment().endOf('day').toDate()
                        },
                    },
                    { gameNumber: 1, gameName: 1, status: 1 },
                );
                console.log("game data while selling the tickets", gameData, req.params.gameId)
                if (!gameData) {

                    req.flash('error', translate.game_not_found)//'Game not Found.');
                    return res.redirect('/agent/cashinout');
                }
                if (gameData.status == "finish") {
                    req.flash('error', translate.game_is_already_finished)//'Game is already finished.');
                    return res.redirect('/agent/cashinout');
                }
                const data = {
                    App: Sys.Config.App.details,
                    Agent: req.session.details,
                    error: req.flash("error"),
                    success: req.flash("success"),
                    session: req.session.details,
                    gameData: gameData,
                    translate: translate,
                    navigation: translate
                };
                return res.render('cash-inout/sell_ticket', data);

            } else {
                req.flash('error', translate.something_went_wrong_please_try_again_later)//'Something went wrong, please login and try again');
                res.redirect('/agent/cashinout');
            }

        } catch (e) {
            console.log("Error in view of agent register user", e);
        }
    },

    orderHistoryView: async function (req, res) {
        let viewFlag = true;
        let editFlag = true;
        let deleteFlag = true;
        let addFlag = true;
        if(!req.session.details.isSuperAdmin){
            // let user = await Sys.App.Services.UserServices.SingleUserData({ _id: req.session.details.id });
            // if (user == null || user.length == 0) {
            //     user = await Sys.App.Services.RoleServices.getSingleData({agentId: req.session.details.id});
            // }
            // let stringReplace = user.permission['Product Management'] || [];
            let stringReplace =req.session.details.isPermission['Product Management'] || [];
            if(!stringReplace.length){
                let translate = await Sys.Helper.bingo.getTraslateData(['no_permission'], req.session.details.language)
                req.flash('error',translate.no_permission )//'you_have_no_permission';
                return res.redirect('/dashboard');
            }
            if (stringReplace?.indexOf("view") == -1) {
                viewFlag = false;
            }
            if (stringReplace?.indexOf("edit") == -1) {
                editFlag = false;
            }
            if (stringReplace?.indexOf("delete") == -1) {
                deleteFlag = false;
            }
            if (stringReplace?.indexOf("add") == -1) {
                addFlag = false;
            }
        }
        let keys = [
            "something_went_wrong_please_try_again_later",
            "order_history",
            "from_date",
            "to_date",
            "cash",
            "online",
            "search_order_id",
            "order_from_date_alert",
            "order_to_date_alert",
            "hall_name",
            "reset",
            "order_id",
            "date_time",
            "player_name",
            "total_order",
            "view_order",
            "payment_type",
            "hall_name",
            "agent_name",
            "dashboard",
            "search",
            "show",
            "entries",
            "previous",
            "next",
            "submit",
            "action",
            "status",
            "cancel"
        ]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            console.log("Order History Page");
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                productManagement: 'active',
                viewFlag: viewFlag,
                editFlag: editFlag,
                deleteFlag: deleteFlag,
                addFlag: addFlag,
                orderHistory: 'active',
                orderH: translate,
                navigation: translate
            };

            if (req.session.details.role == "admin") {
                const halls = await Sys.App.Services.HallServices.getByData({}, { name: 1 });
                data.halls = halls;
            }

            return res.render('orders/orderhistory', data);

        } catch (error) {
            console.error("Error while rendering order history page", error);
            req.flash("error", translate.something_went_wrong_please_try_again_later)//"Something went wrong.")
            res.redirect('/dashboard');
            return;
        }
    },

    getOrderHistoryData: async function (req, res) {
        try {
            //console.log(`getOrderHistoryData called`, JSON.stringify(req.query, null, 2)); //JSON.stringify(req.query,null,2)
            const { start_date, end_date, hallName = '', paymentType = '' } = req.query;

            const start = parseInt(req.query.start);
            const length = parseInt(req.query.length);
            let search = req.query.search.value;
            const startTo = new Date(start_date);
            const endFrom = new Date(end_date);
            endFrom.setHours(23, 59, 59);
            startTo.setHours(0, 0, 0);
            const columns = req.query.columns[req.query.order[0].column].data;
            let sort_mode = -1;
            if (req.query.order[0]["dir"] == "asc") {
                sort_mode = 1;
            }
            let pipeline = [];
            let countQuery = {
                orderPlaced: true,
                createdAt: {
                    $gte: startTo,
                    $lte: endFrom
                }
            }
            let $match = {
                orderPlaced: true,
                createdAt: {
                    $gte: startTo,
                    $lte: endFrom
                }
            }

            if (paymentType) {
                $match['paymentMethod'] = paymentType;
                countQuery['paymentMethod'] = paymentType;
            }

            if (hallName) {
                $match['hallId'] = await Sys.Helper.bingo.obId(hallName);
                countQuery['hallId'] = hallName;
            }

            if (req.session.details.role !== "admin") {
                $match['hallId'] = await Sys.Helper.bingo.obId(req.session.details.hall[0].id);;
                countQuery['hallId'] = req.session.details.hall[0].id;
            }
            const sanitizeInput = (input) => {
                //return input.replace(/[*]/g, ''); // Remove '*' characters
                return input.replace(/[^\w\s]/g, '');
            };
            if (search) {
                search = sanitizeInput(search || "");
                $match['$or'] = [
                    { orderId: new RegExp(search) },
                    { userName: new RegExp(search, "i") },
                ]

                countQuery['$or'] = [
                    { orderId: new RegExp(search) },
                    { userName: new RegExp(search, "i") },
                ]

                if (req.session.details.role == "admin") {
                    $match['$or'].push({ agentName: new RegExp(search, "i") });
                    countQuery['$or'].push({ agentName: new RegExp(search, "i") })
                }
            }

            //match
            pipeline.push({ "$match": $match });
            let $project = {
                _id: 1,
                orderId: 1,
                createdAt: 1,
                totalAmount: 1,
                paymentMethod: 1,
                userName: 1,
                hallName: 1,
                agentName: 1
            }

            //project
            pipeline.push({ "$project": $project });

            //sort
            pipeline.push({
                $sort: {
                    [columns]: sort_mode,
                }
            })

            //skip
            pipeline.push({ $skip: start })

            //limit
            pipeline.push({ $limit: length })
            const productCount = await Sys.App.Services.ProductServices.getProductCartCount(countQuery);
            const result = await Sys.App.Services.ProductServices.getCartAggregationData(pipeline);
            console.log("Total Products", productCount);
            console.log("Total Result", result.length);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': productCount,
                'recordsFiltered': productCount,
                'data': result
            });
        } catch (error) {
            console.log("Error in order history Api :", error);
            //req.flash("error", "Something went wrong while loading order history table!!");
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    orderDetailsPage: async function (req, res) {
        let keys = ["something_went_wrong_please_try_again_later", "order_details_not_found"]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            console.log("order DetailsPage Page called", req.params);
            const { cartId } = req.params;
            if (!cartId) {
                req.flash("error", translate.order_details_not_found)//"Order details not found.")
                return res.redirect('/orderHistory');
            }
            const cart = await Sys.App.Services.ProductServices.getFindOneCartByData({ _id: cartId, orderPlaced: true });
            console.log("cart", cart);
            if (!cart) {
                req.flash("error", translate.order_details_not_found)//"Order details not found.")
                return res.redirect('/orderHistory');
            }
            let keys = [
                "something_went_wrong_please_try_again_later",
                "view_order_details",
                "player_type",
                "player_name",
                "order_date_time",
                "payment_type",
                "cash",
                "online",
                "hall_name",
                "order_id",
                "date_time",
                "player_name",
                "total_order",
                "hall_name",
                "product_name",
                "image",
                "price_per_quantity",
                "quantity",
                "total_amount",
                "no_product_selected",
                "total_order_amount",
                "back",
                "agent_name",
                "dashboard",
                "search",
                "show",
                "entries",
                "previous",
                "next",
                "submit",
                "action",
                "status",
                "cancel"
            ]
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                orderHistory: "active",
                cart: cart,
                orderH: translate,
                navigation: translate
            };
            return res.render('orders/vieworder', data);

        } catch (error) {
            console.error("Error in orderDetailsPage api", error);
            req.flash("error", translate.something_went_wrong_please_try_again_later)//"Something went wrong.")
            res.redirect('/orderHistory');
            return;
        }
    },

    physicalCashOutPage: async function (req, res) {
        let keys = [
            "something_went_wrong_please_try_again_later",
            "physical_cashout_details",
            "dashboard",
            "from_date",
            "to_date",
            "date",
            "game_name",
            "sub_game_name_id",
            "total_winnings",
            "pending_cashout",
            "action",
            "showing",
            "entries"
        ]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            console.log("Physical Cash Out Page");
            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                physicalCashOut: 'active',
                translate: translate,
                navigation: translate
            };

            return res.render('physicalTickets/physicalCashOut', data);

        } catch (error) {
            console.error("Error while rendering physical cashout page", error);
            req.flash("error", translate.something_went_wrong_please_try_again_later)//"Something went wrong.")
            res.redirect('/dashboard');
            return;
        }
    },

    getGamesInHall: async function (req, res) {
        let keys = ["something_went_wrong_please_try_again_later"]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            console.log(`getGamesInHall called`); //JSON.stringify(req.query,null,2)
            const { start_date, end_date } = req.query;
            const start = parseInt(req.query.start);
            const length = parseInt(req.query.length);
            const startTo = new Date(start_date);
            const endFrom = new Date(end_date);
            endFrom.setHours(23, 59, 59);
            startTo.setHours(0, 0, 0);
            // const columns = req.query.columns[req.query.order[0].column].data;
            // let sort_mode = -1;
            // if (req.query.order[0]["dir"] == "asc") {
            //     sort_mode = 1;
            // }

            const pipeline = [
                {
                    '$match': {
                        'gameType': 'game_1',
                        'halls': req.session.details.hall[0].id,
                        '$or': [
                            {
                                'status': 'running'
                            }, {
                                'status': 'finish',
                                'otherData.gameSecondaryStatus': 'finish'
                            }
                        ],
                        'stopGame': false,
                        'otherData.isClosed': false,
                        'startDate': {
                            '$gte': startTo,
                            '$lte': endFrom
                        }
                    }
                }, {
                    '$addFields': {
                        'id': {
                            '$toString': '$_id'
                        }
                    }
                }, {
                    '$project': {
                        'id': 1,
                        'gameName': 1,
                        'gameNumber': 1,
                        'startDate': 1,
                        'gameType': 1,
                        'totalWinning': 1
                    }
                }, {
                    '$lookup': {
                        'from': 'Ticket',
                        'localField': 'id',
                        'foreignField': 'gameId',
                        'pipeline': [
                            {
                                '$match': {
                                    'hallId': req.session.details.hall[0].id,
                                    'userType': 'Physical',
                                    'isPlayerWon': true
                                }
                            }, {
                                '$project': {
                                    'winnings': '$otherData.winningStats'
                                }
                            }
                        ],
                        'as': 'totalPhysicalWinnings'
                    }
                }, {
                    '$facet': {
                        'paginatedResults': [
                            {
                                '$sort': {
                                    startDate: -1
                                    //"_id": -1,
                                    //[columns]: sort_mode
                                }
                            },
                            {
                                '$skip': start
                            },
                            {
                                '$limit': length
                            }
                        ],
                        'totalCount': [
                            {
                                '$count': 'count'
                            }
                        ]
                    }
                }
            ]

            const result = await Sys.App.Services.GameService.aggregateQuery(pipeline);
            console.log("Total Result", result.length);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': result[0]?.totalCount[0]?.count || 0,
                'recordsFiltered': result[0]?.totalCount[0]?.count || 0,
                'data': result[0].paginatedResults || [],
            });
        } catch (error) {
            console.log("Error in physical cashout listing Api :", error);
            req.flash("error", translate.something_went_wrong_please_try_again_later)//"Something went wrong while loading physical cashout table!!");
            return res.status(500).send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    viewWonPhysicalTicketPage: async function (req, res) {
        let keys = [
            "something_went_wrong_please_try_again_later",
            "physical_cashout_details",
            "dashboard",
            "date",
            "sub_game_name",
            "physical_ticket_no",
            "ticket_type",
            "ticket_price",
            "winning_pattern",
            "total_winning",
            "rewarded_amount",
            "pending_amount",
            "action",
            "reward_all",
            "total_winnings",
            "rewarded",
            "bingo_pattern",
            "ticket_id",
            "pending",
            "view_tickets",
            "are_you_sure",
            "reward_all_pending_winings",
            "yes",
            "cancel_button",
            "success",
            "failed",
            "cancelled",
            "cancel_winning_distribution",
            "do_you_want_to_cash_out"
        ]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            console.log("Physical Won Ticket Page", req.params);
            const Query = {
                '_id': req.params.id,
                'gameType': 'game_1',
                'halls': req.session.details.hall[0].id,
                // 'userType': "Physical",
                // 'agentId': req.session.details.id,
                // 'isPlayerWon' : true
            }

            const gameData = await Sys.App.Services.GameService.getSingleGameData(Query, {
                gameName: 1,
                startDate: 1,
                totalWinning: 1
            });

            console.log(gameData);

            const data = {
                App: Sys.Config.App.details,
                Agent: req.session.details,
                error: req.flash("error"),
                success: req.flash("success"),
                session: req.session.details,
                physicalCashOut: 'active',
                gameData: gameData,
                hallId: req.session.details.hall[0].id,
                translate: translate,
                navigation: translate
            };

            return res.render('physicalTickets/physicalGameTicketList', data);

        } catch (error) {
            console.error("Error while rendering physical cashout page", error);
            req.flash("error", translate.something_went_wrong_please_try_again_later)//"Something went wrong.")
            res.redirect('/dashboard');
            return;
        }
    },

    getPhysicalWinningInGame: async function (req, res) {
        let keys = ["something_went_wrong_please_try_again_later"]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {

            console.log(`getPhysicalWinningInGame called`); //JSON.stringify(req.query,null,2);
            const { id } = req.query;
            const start = parseInt(req.query.start);
            const length = parseInt(req.query.length);
            const search = req.query.search.value;
            const columns = req.query.columns[req.query.order[0].column].data;
            let sort_mode = -1;
            if (req.query.order[0]["dir"] == "asc") {
                sort_mode = 1;
            }
            const query = {
                gameId: id,
                hallId: req.session.details.hall[0].id,
                userType: "Physical",
                isPlayerWon: true
            }

            if (search) {
                query['$or'] = [
                    { ticketId: new RegExp(search) },
                    { ticketColorName: new RegExp(search, "i") },
                ]
            }


            const result = await Sys.App.Services.GameService.getTicketDatatable(query, length, start, {
                "_id": -1,
                [columns]: sort_mode
            });
            console.log("Total Result", result.length);
            return res.send({
                'draw': req.query.draw,
                'recordsTotal': result.length,
                'recordsFiltered': result.length,
                'data': result
            });
        } catch (error) {
            console.log("Error in getPhysicalWinningInGame Api :", error);
            req.flash("error", translate.something_went_wrong_please_try_again_later + ' !!') //"Something went wrong while loading physical tickets !!");
            return res.status(500).send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    rewardAll: async function (req, res) {
        let keys = ["something_went_wrong_please_try_again_later", "unauthorized",
            "please_let_other_agent_end_their_session_in_the_hall",
            "rewards_distributed_successfully"
        ]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            console.log(`Reward All API Called :`, req.body); //JSON.stringify(req.query,null,2);
            const gameData = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id }, { groupHalls: 1 });
            const hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: req.session.details.hall[0].id }, { name: 1, activeAgents: 1, groupHall: 1 });

            if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                const index = hallsData.activeAgents.findIndex((e) => e.id == req.session.details.id);
                console.log("index of agent ", index)

                //Check if already any game 1 running in the hall
                if (index >= 0) {
                    try {
                        await Sys.Helper.gameHelper.assignWinningToAllPhysicalTicket({
                            agentId: req.session.details.id,
                            agentName: req.session.details.name,
                            hallId: hallsData._id,
                            hallName: hallsData.name,
                            groupHall: hallsData.groupHall,
                            shiftId: req.session.details.shiftId,
                            gameId: gameData._id,
                            dailyBalance: hallsData.activeAgents[index].dailyBalance,
                            language: req.session.details.language
                        })
                    } catch (error) {
                        return res.status(200).send({
                            status: "fail",
                            message: error.message
                        });
                    }


                    return res.status(200).send({
                        status: "success",
                        message: translate.rewards_distributed_successfully//"Rewards distributed successfully."
                    });
                } else {
                    return res.status(200).send({
                        status: "fail",
                        message: translate.please_let_other_agent_end_their_session_in_the_hall//"Please let other agent end their session in the hall."
                    });
                }
            } else {
                return res.status(200).send({
                    status: "fail",
                    message: translate.unauthorized //"Unauthorized."
                });
            }


        } catch (error) {
            console.log("Error in reward all Api :", error);
            return res.status(200).send({
                status: "fail",
                message: translate.something_went_wrong_please_try_again_later //"Something went wrong."
            });
        }
    },

    getPhysicalCashoutDetails: async function (req, res) {

        try {
            console.log(`getPhysicalCashoutDetails called`, req.session.details);
            const start = parseInt(req.query.start);
            const length = parseInt(req.query.length);
            const search = req.query.search.value;

            const sort = { createdAt: -1 };

            const query = {
                hallId: req.session.details.hall[0].id,
                'otherData.shiftId': req.session.details.shiftId,
                userType: "Physical",
                isPlayerWon: true
            }

            if (search) {
                query['$or'] = [
                    { ticketId: new RegExp(search) },
                    { ticketColorName: new RegExp(search, "i") },
                ]
            }
            const resultCount = await Sys.App.Services.GameService.getTicketCount(query);
            const result = await Sys.App.Services.GameService.getTicketsByData(query, { ticketId: 1, ticketColorName: 1, ticketPrice: 1, winningStats: 1, totalWinningOfTicket: 1, gameName: 1, otherData: 1, gameId: 1, tickets: 1, userType: 1, gameStartDate: 1 }, { sort: sort, limit: length, skip: start });

            return res.send({
                'draw': req.query.draw,
                'recordsTotal': resultCount,
                'recordsFiltered': resultCount,
                'data': result
            });
        } catch (error) {
            console.log("Error in getPhysicalWinningInGame Api :", error);
            req.flash("error", "Something went wrong while loading physical tickets !!");
            return res.status(500).send({
                'draw': req.query.draw,
                'recordsTotal': 0,
                'recordsFiltered': 0,
                'data': []
            });
        }
    },

    hallsStatusForGame: async function (data) {
        try {
            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: data.gameId }, { 'otherData.agents': 1, 'otherData.masterHallId': 1 }, {});

            const hallStatus = {};
            const agents = game.otherData.agents;

            const readyHalls = [];
            const notreadyHalls = [];
            agents.forEach(agent => {
                console.log("agent", agent)
                const hallId = agent.hallId;
                if (hallId != game.otherData.masterHallId) {
                    if (!hallStatus[hallId]) {
                        hallStatus[hallId] = { name: agent.hallName, isReady: agent.isReady };
                    } else if (agent.isReady) {
                        console.log("hallStatus", hallStatus, hallId)
                        hallStatus[hallId].isReady = true;
                    }
                } else if (readyHalls.length == 0 && hallId == game.otherData.masterHallId) {
                    readyHalls.push(agent.hallName)
                }
            });
            Object.values(hallStatus).forEach(hall => {
                if (hall.isReady) {
                    readyHalls.push(hall.name);
                } else {
                    notreadyHalls.push(hall.name);
                }
            });

            console.log("Ready Halls:", readyHalls);
            console.log("Not Ready Halls:", notreadyHalls);

            return {
                "status": "success",
                "readyHalls": readyHalls,
                "notreadyHalls": notreadyHalls
            };
        } catch (e) {
            console.log("Error in hall status for availability of game", e);
            return { status: "fail", readyHalls: [], notreadyHalls: [] }
        }
    },

    getGameHallStatus: async function (req, res) {
        try {
            let hallStatus = await module.exports.hallsStatusForGame({ gameId: req.query.gameId });
            if (hallStatus && hallStatus.status == "success") {
                readyHalls = hallStatus.readyHalls;
                notreadyHalls = hallStatus.notreadyHalls;
            }
            return res.json({ status: "success", readyHalls: readyHalls, notreadyHalls: notreadyHalls });
        } catch (e) {
            return res.json({ status: "fail", readyHalls: [], notreadyHalls: [] });
        }
    },

    updateGameHallStatus: async function (req, res) {
        try {
            let agentId = req.session.details.id;
            let hallId = req.session.details.hall[0].id;
            let isReady = req.body.isReady;
            console.log("agentId, halId and isReady", agentId, hallId, isReady)
            if (agentId && req.body.gameId && hallId && isReady) {
                let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.gameId }, { otherData: 1 }, {});
                // let data = await Sys.App.Services.GameService.updateGameData(
                //     { _id: game._id, "otherData.agents.id": mongoose.Types.ObjectId(agentId), "otherData.agents.hallId": mongoose.Types.ObjectId(hallId) }, 
                //     { $set: { "otherData.agents.$.isReady": true } }
                // );

                let data = await Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: req.body.gameId }, {
                    // $set: {
                    //     "otherData.agents.$[current].isReady": true
                    // },
                    $set: {
                        "otherData.agents.$[current].isReady": (isReady == "true") ? true : false
                    },
                }, { arrayFilters: [{ "current.id": mongoose.Types.ObjectId(agentId), "current.hallId": mongoose.Types.ObjectId(hallId) }], new: true })
                console.log("data----", data)
                if (data) {
                    /*let hallStatus = await module.exports.hallsStatusForGame({gameId: req.body.gameId});
                    let isHallReady = false;
                    if(hallStatus && hallStatus.status == "success"){
                        readyHalls = hallStatus.readyHalls;
                        notreadyHalls = hallStatus.notreadyHalls;
                        Sys.Io.of('admin').to(game.otherData.masterHallId).emit('onHallReady', {
                            gameId: req.body.gameId,
                            readyHalls: hallStatus.readyHalls,
                            notreadyHalls: hallStatus.notreadyHalls
                        });
                        isHallReady = readyHalls.includes(req.session.details.hall[0].name)
                    }
                    return res.send({
                        "status": "success",
                        isHallReady: isHallReady,
                        gameId: req.body.gameId
                    });*/

                    let hallStatus = await module.exports.setHallStausWithColorCode({ gameId: req.body.gameId, hallName: req.session.details.hall[0].name });
                    let currentHallClass = "btn-warning";
                    if (hallStatus && hallStatus.result) {
                        // Destructure result from hallStatus for easier access
                        const { redHalls, greenHalls, yellowHalls } = hallStatus.result;
                        // Check in which array myhallName exists
                        const myhallName = req.session.details.hall[0].name;
                        const hallType = (() => {
                            if (redHalls.includes(myhallName)) {
                                return "btn-danger";
                            }
                            if (greenHalls.includes(myhallName)) {
                                return "btn-success";
                            }
                            if (yellowHalls.includes(myhallName)) {
                                return "btn-warning";
                            }
                            return "btn-warning";
                        })();
                        currentHallClass = hallType
                    }
                    return res.send({
                        "status": "success",
                        isHallReady: hallStatus.result.isMyHallReady,
                        gameId: req.body.gameId,
                        currentHallClass: currentHallClass
                    });
                } else {
                    throw new Error('Something Went Wrong.')
                }
            }
            return res.send({
                "status": "fail"
            });
        } catch (e) {
            console.log("Error in updateGameHallStatus", e)
            return res.send({
                "status": "fail"
            });
        }
    },

    checkForValidAgentBalancePlayer: async function (req, res) {
        let keys = ["please_enter_valid_username"]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            let username = '^' + req.body.userName + '$'; console.log("username---", username)
            let userCount = 0;
            let query = { 'hall.id': req.session.details.hall[0].id, userType: "Online" };
            if (username) {
                query.$or = [
                    { customerNumber: isNaN(Number(req.body.userName)) ? null : Number(req.body.userName) },
                    { username: { '$regex': username } }
                ];
                userCount = await Sys.App.Services.PlayerServices.getPlayerCount(query)   //({ username: { '$regex': username }, 'hall.id': req.session.details.hall[0].id }); // , $options: 'i'
            }
            console.log("checkForValidAgentPlayer count", userCount)
            if (userCount > 0) {
                let user = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { walletAmount: 1 });
                return res.send({ "valid": true, balance: +parseFloat(user.walletAmount).toFixed(2), playerId: user.id });
            }
            return res.send({ "valid": false, "message": translate.please_enter_valid_username })//"Please enter valid username." });
        } catch (e) {
            console.log("Error in checkForValidAgentPlayer", e);
        }
    },

    sellProductAgent: async function (req, res) {
        let keys = ["please_do_previous_day_settlement_before_doing_any_other_tranasction",
            "product_list_is_empty",
            "cart_total_amount_is_zero",
            "something_went_wrong_please_try_again_later",
            "player_dont_have_enough_amount_to_purchase_the_product",
            "user_details_not_found",
            "product_purchased_successfully"
        ]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            console.log("create cart  called :", req.body);
            const { productList = [], username, id, amount, paymentType } = req.body;
            console.log(" productList = [], username, id, amount---", productList, username, id, amount)
            const hallData = await Sys.App.Services.HallServices.getSingleHallData({
                _id: req.session.details.hall[0].id
            })

            if (hallData.otherData?.isPreviousDaySettlementPending == true) {
                return res.json({ status: "fail", message: translate.please_do_previous_day_settlement_before_doing_any_other_tranasction })//'Please Do previous day settlement before doing any other Transactions.' });
            }

            if (productList.length <= 0) {
                return res.send({ status: "fail", message: translate.product_list_is_empty })//"Product list is empty." });
            }

            const finalProductList = productList.filter(p => p.quantity > 0);
            if (!finalProductList.length) {
                return res.send({ status: "fail", message: translate.product_list_is_empty });
            }

            let totalAmount = 0;
            finalProductList.forEach(p => {
                totalAmount = totalAmount + (p.quantity * p.price)
            })

            if (totalAmount < 0) {
                return res.send({ status: "fail", message: translate.cart_total_amount_is_zero }) //"Cart total amount is zero." });
            }

            if (totalAmount != amount) {
                return res.send({ status: "fail", message: translate.something_went_wrong_please_try_again_later })//"Something went wrong, please try again." });
            }

            let userDetails = null;
            if (paymentType == "customerNumber") {
                let query = {
                    'hall.id': req.session.details.hall[0].id,
                    userType: "Online",
                    $or: [
                        { customerNumber: isNaN(Number(username)) ? null : Number(username) },
                        { username: username }
                    ],
                    _id: id
                };
                userDetails = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { walletAmount: 1, userType: 1, hall: 1, groupHall: 1, username: 1, customerNumber: 1 })
                console.log("userDetails---", userDetails)
                if (!userDetails) {
                    return res.send({ status: "fail", message: translate.user_details_not_found })//"User details not found." });
                }
                if (userDetails.walletAmount < totalAmount) {
                    return res.json({ status: "fail", message: translate.player_dont_have_enough_amount_to_purchase_the_product })//"Player don't have enough amount to purchase the product." });
                }
            }

            let userType = (userDetails) ? userDetails.userType : paymentType;
            let userName = (userDetails) ? userDetails.username : req.session.details.name;
            //let customerNumber = userDetails.customerNumber;

            const productCart = {
                agentId: req.session.details.id,
                orderId: 'ORD' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                hallName: req.session.details.hall[0].name,
                hallId: req.session.details.hall[0].id,
                productList: finalProductList,
                userType: userType,
                userName: userName,
                agentName: req.session.details.name,
                userId: userDetails ? userDetails._id : req.session.details.id,
                status: "Order Placed",
                totalAmount: totalAmount,
                shiftId: req.session.details.shiftId,
                orderPlaced: true,
                paymentMethod: paymentType,
                groupHallName: hallData.groupHall.name,
                groupHallId: hallData.groupHall.id,
                updatedAt: new Date(),
                createdAt: new Date()
            }

            const cart = await Sys.App.Services.ProductServices.insertProductCartData(productCart);
            console.log("cart---", cart)
            if (!cart) {
                return res.send({ status: "fail", message: translate.something_went_wrong_please_try_again_later })//"Something went wrong." });
            }

            const transactionObject = {
                cartId: cart._id,
                orderId: cart.orderId,
                totalAmount: totalAmount,
                category: "credit",
                paymentType: "Cash",
                agentId: cart.agentId,
                agentName: req.session.details.name,
                userId: cart.userId,
                userType: cart.userType,
                userName: cart.userName,
                hallId: cart.hallId,
                hall: req.session.details.hall[0],
                shiftId: req.session.details.shiftId,
                typeOfTransaction: "Product Sales",
                productList: finalProductList,
                paymentType: cart.paymentMethod,

            }

            const response = await Sys.Helper.gameHelper.sellProductTransactionInHall(transactionObject);
            console.log("result---", response)
            if (paymentType == "Cash") {
                req.session.details.dailyBalance = (response.result.dailyBalance) ? +parseFloat(response.result.dailyBalance).toFixed(2) : Number(req.session.details.dailyBalance) + totalAmount;;
            }
            return res.send({ status: "success", message: translate.product_purchased_successfully, paymentType: cart.paymentMethod, dailyBalance: response.result.dailyBalance });

        } catch (e) {
            console.log("error", e)
            return res.send({ status: "fail", message: translate.something_went_wrong_please_try_again_later })//"Something went wrong." });
        }
    },

    controlDailyBalance: async function (req, res) {
        let keys = [
            "please_provide_all_the_required_data", "agent_not_found",
            "please_do_previous_agent_logs_out_before_doing_control_daily_balance",
            "please_do_previous_day_settlement_before_doing_any_other_tranasction",
            "control_daily_balance_updated_successfully",
            "something_went_wrong_please_try_again_later"
        ]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
        try {
            let { dailyBalance, totalCashBalance } = req.body;
            let hallId, agentId;
            dailyBalance = +parseFloat(dailyBalance).toFixed(2);
            totalCashBalance = +parseFloat(totalCashBalance).toFixed(2);
            if (isNaN(dailyBalance) || isNaN(totalCashBalance)) {
                return res.json({ status: "fail", message: translate.please_provide_all_the_required_data })//'Please provide all the required Data' });
            }

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                hallId = req.session.details.hall[0].id;
                agentId = req.session.details.id;
            } else {
                return res.json({ status: "fail", message: translate.agent_not_found })//'Agent not found' });
            }

            let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, hallCashBalance: 1, otherData: 1 });
            if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {

                if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                    return res.json({ status: "fail", message: translate.please_do_previous_agent_logs_out_before_doing_control_daily_balance })// 'Please ensure the previous agent logs out before Doing Control Daily balance.' });
                }

                if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                    return res.json({ status: "fail", message: translate.please_do_previous_day_settlement_before_doing_any_other_tranasction })//'Please Do previous day settlement before doing any other Transactions.' });
                }

                let index = hallsData.activeAgents.findIndex((e) => e.id == agentId);
                let agentShift = await Sys.App.Services.AgentServices.getSingleShiftData({ _id: hallsData.activeAgents[index].shiftId, agentId: agentId, hallId: hallId }, { dailyBalance: 1 });
                if (!agentShift) {
                    return res.json({ status: "success", message: translate.something_went_wrong_please_try_again_later })//"Something went wrong, please try again later." });

                }
                let dailyBalanceDiff = +parseFloat(dailyBalance - agentShift.dailyBalance).toFixed(2);
                let hallCashBalanceDiff = +parseFloat(totalCashBalance - hallsData.hallCashBalance).toFixed(2);;
                let action = null;
                let dailyBalanceAction = null;
                if (dailyBalance > agentShift.dailyBalance) {
                    dailyBalanceAction = "credit";
                    //dailyBalanceDiff = +parseFloat(dailyBalance - agentShift.dailyBalance).toFixed(2);
                } else if (dailyBalance < agentShift.dailyBalance) {
                    //dailyBalanceDiff = +parseFloat(agentShift.dailyBalance - dailyBalance).toFixed(2);
                    dailyBalanceAction = "debit";
                }

                if (totalCashBalance > hallsData.hallCashBalance) {
                    action = "credit";
                    //hallCashBalanceDiff = +parseFloat(totalCashBalance - hallsData.hallCashBalance).toFixed(2);
                } else if (totalCashBalance < hallsData.hallCashBalance) {
                    action = "debit";
                    //hallCashBalanceDiff = +parseFloat(hallsData.hallCashBalance - totalCashBalance).toFixed(2);
                }
                console.log("dailyBalance, hallCashBalance, dailyBalanceDiff, hallCashBalanceDiff, agentShift and hallsData---", dailyBalance, totalCashBalance, dailyBalanceDiff, hallCashBalanceDiff, agentShift, hallsData)


                if (action) {

                    let updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $inc: { "hallCashBalance": hallCashBalanceDiff } }, { new: true });

                    let hallTransaction = {
                        transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                        shiftId: hallsData.activeAgents[index].shiftId,
                        hallId: hallId,
                        agentId: agentId,
                        type: "ControlDailyBalance",
                        category: action,
                        amount: Math.abs(+hallCashBalanceDiff),
                        previousBalance: (action == "credit") ? +parseFloat(updatedHall.hallCashBalance - (Math.abs(+hallCashBalanceDiff))).toFixed(2) : +parseFloat(updatedHall.hallCashBalance + (Math.abs(+hallCashBalanceDiff))).toFixed(2),
                        afterBalance: +parseFloat(updatedHall.hallCashBalance).toFixed(2),
                        hall: req.session.details.hall[0],
                        groupHall: hallsData.groupHall,
                        createdAt: Date.now(),
                    }
                    await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction);

                    // let newExtraTransaction = {
                    //     hallId: hallId,
                    //     agentId: agentId,
                    //     playerId: agentId,
                    //     agentName: req.session.details.name,
                    //     playerName: req.session.details.name,
                    //     action: action, // debit / credit
                    //     amount: Math.abs(+hallCashBalanceDiff),
                    //     typeOfTransaction: "ControlDailyBalance",
                    //     //defineSlug:"addDailyBalance",
                    //     hall: req.session.details.hall[0],
                    //     groupHall: hallsData.groupHall,
                    // }

                    // let response = await Sys.Helper.gameHelper.dailyBalanceTransfer(newExtraTransaction);
                    // if(!response || response.status == "fail"){
                    //     res.json({ status: "success", message: "Something went wrong, please try again later." });
                    // }
                }

                if (dailyBalanceAction) {
                    let newExtraTransaction = {
                        hallId: hallId,
                        agentId: agentId,
                        playerId: agentId,
                        agentName: req.session.details.name,
                        playerName: req.session.details.name,
                        action: dailyBalanceAction, // debit / credit
                        amount: Math.abs(+dailyBalanceDiff),
                        typeOfTransaction: "ControlDailyBalance",
                        //defineSlug:"addDailyBalance",
                        hall: req.session.details.hall[0],
                        groupHall: hallsData.groupHall,
                    }

                    let response = await Sys.Helper.gameHelper.controlDailyBalance(newExtraTransaction);
                    console.log("response of daily balance through control daily balance", response)
                    if (!response || response.status == "fail") {
                        return res.json({ status: "success", message: translate.something_went_wrong_please_try_again_later })//"Something went wrong, please try again later." });
                    }
                }

                await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $inc: { "controlDailyBalance.dailyBalanceDiff": dailyBalanceDiff, "controlDailyBalance.hallCashBalanceDiff": hallCashBalanceDiff } }, { new: true });
                let updatedShift = await Sys.App.Services.AgentServices.updateShiftData({ _id: hallsData.activeAgents[index].shiftId, hallId: hallId, agentId: agentId }, { $set: { 'controlDailyBalance.isDone': true, 'controlDailyBalance.dailyBalance': dailyBalance, 'controlDailyBalance.totalCashBalance': totalCashBalance }, $inc: { 'controlDailyBalance.dailyBalanceDiff': dailyBalanceDiff, 'controlDailyBalance.hallCashBalanceDiff': hallCashBalanceDiff } }, { new: true });

                // Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                //     shiftId: updatedShift._id.toString(),
                //     hallId: updatedShift.hallId,
                //     dailyBalance: dailyBalance,
                //     totalDailyBalanceIn: updatedShift.totalDailyBalanceIn,
                //     totalCashIn: updatedShift.totalCashIn,
                //     totalCashOut: updatedShift.totalCashOut,
                //     toalCardIn: updatedShift.toalCardIn,
                //     totalCardOut: updatedShift.totalCardOut,
                // });
                req.session.details.dailyBalance = +parseFloat(updatedShift.dailyBalance).toFixed(2);
                return res.json({ status: "success", message: translate.control_daily_balance_updated_successfully, dailyBalance: +parseFloat(dailyBalance).toFixed(2) });
            } else {
                return res.json({ status: "fail", message: translate.something_went_wrong_please_try_again_later })//'Something went wrong, please try again later.' });
            }
        } catch (e) {
            console.log("Error while adding daily balance :", e);
            return res.json({ status: "fail", message: translate.something_went_wrong_please_try_again_later })//'Something went wrong, please try again later.' });
        }
    },

    settlement: async function (req, res) {
        let keys = [
            "agent_not_found",
            "please_ensure_the_previous_agent_logs_out_before_doing_settlement",
            "something_went_wrong_please_try_again_later",
            "settlement_data_update_successfully"
        ]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
        try {
            //console.log("settlement form data--", req.body);
            let {
                inAmountMetronia, outAmountMetronia, totalAmountMetronia,
                inAmountOkBingo, outAmountOkBingo, totalAmountOkBingo,
                inAmountFranco, outAmountFranco, totalAmountFranco,
                inAmountOtium, outAmountOtium, totalAmountOtium,
                inAmountNorskTippingDag, outAmountNorskTippingDag,
                inAmountNorskTotalt, outAmountNorskTotalt, totalAmountNorskTotalt,
                inAmountNorskRikstotoDag, outAmountNorskRikstotoDag, totalAmountNorskRikstotoDag,
                inAmountNorskRikstotoTotalt, outAmountNorskRikstotoTotalt, totalAmountNorskRikstotoTotalt,
                inAmountRekvisita, totalAmountRekvisita,
                inAmountSellProduct, totalAmountSellProduct,
                outAmountBilag, totalAmountBilag,
                outAmountBank, totalAmountBank,
                inAmountTransferredByBank, totalAmountTransferredByBank,
                inAmountAnnet, outAmountAnnet, totalAmountAnnet,
                dailyBalanceAtStartShift, dailyBalanceAtEndShift, dailyBalanceDifference,
                settlementToDropSafe, withdrawFromtotalBalance, totalDropSafe,
                shiftDifferenceIn, shiftDifferenceOut, shiftDifferenceTotal,
                settlmentNote,
                originalSettlementDate
            } = req.body;
            let hallId, agentId;

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                hallId = req.session.details.hall[0].id;
                agentId = req.session.details.id;
            } else {
                return res.json({ status: "fail", message: translate.agent_not_found })//'Agent not found' });
            }

            let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, hallCashBalance: 1, otherData: 1 });
            if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {

                if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                    return res.json({ status: "fail", message: translate.please_ensure_the_previous_agent_logs_out_before_doing_settlement })// 'Please ensure the previous agent logs out before Doing Settlement.' });
                }
                let index = hallsData.activeAgents.findIndex((e) => e.id == agentId);
                let agentShift = await Sys.App.Services.AgentServices.getSingleShiftData({ _id: hallsData.activeAgents[index].shiftId, agentId: agentId, hallId: hallId }, { dailyBalance: 1, createdAt: 1, hallCashBalance: 1 });
                if (!agentShift) {
                    return res.json({ status: "success", message: translate.something_went_wrong_please_try_again_later })//"Something went wrong, please try again later." });
                }

                let settlementDate = moment(agentShift.createdAt).format("DDMMYYYY")
                console.log("settlementDate---", settlementDate, moment(originalSettlementDate).format("DDMMYYYY"));
                if (originalSettlementDate && !moment(originalSettlementDate).startOf('day').isSame(moment(agentShift.createdAt).startOf('day'))) {
                    settlementDate = moment(originalSettlementDate).format("DDMMYYYY");
                }
                console.log("final settlement date", moment(originalSettlementDate).format("DDMMYYYY"))
                let billsArray = [];
                if (req.files && req.files.billImages) {
                    for (let i = 0; i < req.files.billImages.length; i++) {
                        let image = req.files.billImages[i];
                        console.log(image);
                        let re = /(?:\.([^.]+))?$/;
                        let extension = re.exec(image.name)[1];
                        let randomNum = Math.floor(100000 + Math.random() * 900000);
                        let fileName = settlementDate + '_' + randomNum + '.' + extension;
                        // Use the mv() method to place the file somewhere on your server
                        image.mv('public/assets/settlement/' + fileName, function (err) {
                            if (err) {
                                console.log("Error uploading Bills")
                            }
                        });
                        let imagePath = '/assets/settlement/' + fileName;
                        billsArray.push(imagePath);
                    }
                }

                console.log("billsArray---", billsArray);

                // update game 1 to 5 profit to settllment
                let fromDate = moment().startOf('day'); // .subtract(3, 'd')
                let toDate = moment().endOf('day');
                if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                    fromDate = moment(hallsData.otherData.previousDaySettlementDate).startOf('day');
                    toDate = moment(hallsData.otherData.previousDaySettlementDate).endOf('day');
                }

                let previousProfit = 0;
                let lastSettlement = await Sys.App.Services.AgentServices.getSingleSettlementData({ hallId: mongoose.Types.ObjectId(hallId), date: { $gte: new Date(fromDate), $lte: new Date(toDate) } }, { game1Profit: 1, game2Profit: 1, game3Profit: 1, game4Profit: 1, game5Profit: 1, allGameProfit: 1 }, { sort: { createdAt: -1 } });

                console.log("form and todate", fromDate, toDate)
                let query = [
                    {
                        '$match': {
                            'hallId': hallId,
                            'createdAt': {
                                '$gte': new Date(fromDate),
                                '$lte': new Date(toDate)
                            },
                            "isBotGame": false,
                            "gameType": {
                                "$exists": true,
                                "$ne": ""
                            }
                        }
                    }, {
                        '$group': {
                            '_id': {
                                'hallId': '$hallId',
                                'gameType': '$gameType',
                                'date': {
                                    '$dateToString': {
                                        'format': '%d-%m-%Y',
                                        'date': '$createdAt'
                                    }
                                }
                            },
                            'buyTicket': {
                                '$sum': {
                                    '$cond': [
                                        {
                                            '$or': [
                                                {
                                                    '$eq': [
                                                        '$game1Slug', 'buyTicket'
                                                    ]
                                                }, {
                                                    '$eq': [
                                                        '$defineSlug', 'buyTicket'
                                                    ]
                                                }, {
                                                    $and: [{ '$eq': ['$gameType', 'game_5'] }, { '$eq': ['$typeOfTransaction', 'Game Joined'] }]

                                                }, {
                                                    '$eq': [
                                                        '$game1Slug', 'replaceTicket'
                                                    ]
                                                }
                                            ]
                                        }, '$typeOfTransactionTotalAmount', 0
                                    ]
                                }
                            },
                            'cancelTicket': {
                                '$sum': {
                                    '$cond': [
                                        {
                                            '$or': [
                                                {
                                                    '$eq': [
                                                        '$game1Slug', 'cancelTicket'
                                                    ]
                                                }, {
                                                    '$eq': [
                                                        '$defineSlug', 'cancelTicket'
                                                    ]
                                                }
                                            ]
                                        }, '$typeOfTransactionTotalAmount', 0
                                    ]
                                }
                            },
                            'UTD': {
                                '$sum': '$winningPrice'
                            }
                        }
                    }, {
                        '$addFields': {
                            'OMS': {
                                '$subtract': [
                                    '$buyTicket', '$cancelTicket'
                                ]
                            },
                            'parseDate': {
                                '$dateFromString': {
                                    'dateString': "$_id.date",
                                    'format': "%d-%m-%Y"
                                }
                            }
                        }
                    }, {
                        '$group': {
                            '_id': {
                                'hallId': '$_id.hallId',
                                'date': '$_id.date',
                                'parseDate': '$parseDate'
                            },
                            'transactions': {
                                '$push': {
                                    'k': "$_id.gameType",
                                    'v': {
                                        '$subtract': [
                                            "$OMS",
                                            "$UTD"
                                        ]
                                    },
                                },
                            }
                        }
                    },
                    {
                        '$project': {
                            '_id': 0,
                            'date': '$_id.date',
                            'parseDate': '$_id.parseDate',
                            'games': { '$arrayToObject': '$transactions' },
                        },
                    },
                    {
                        "$sort": {
                            "parseDate": -1
                        }
                    }
                ];

                let data = await Sys.App.Services.PlayerServices.aggregateQueryTransaction(query);
                console.log("game profit---", data)
                for (let i = 0; i < data.length; i++) {
                    if (data[i]["games"]['game_1']) {
                        data[i].game1 = parseFloat(data[i]["games"]['game_1']).toFixed(3);
                    } else {
                        data[i].game1 = 0
                    }
                    if (data[i]["games"]['game_2']) {
                        data[i].game2 = parseFloat(data[i]["games"]['game_2']).toFixed(3)
                    } else {
                        data[i].game2 = 0
                    }
                    if (data[i]["games"]['game_3']) {
                        data[i].game3 = parseFloat(data[i]["games"]['game_3']).toFixed(3);
                    } else {
                        data[i].game3 = 0
                    }
                    if (data[i]["games"]['game_4']) {
                        data[i].game4 = parseFloat(data[i]["games"]['game_4']).toFixed(3);
                    } else {
                        data[i].game4 = 0
                    }
                    if (data[i]["games"]['game_5']) {
                        data[i].game5 = parseFloat(data[i]["games"]['game_5']).toFixed(3);
                    } else {
                        data[i].game5 = 0
                    }
                    delete data[i]["games"];
                }

                let game1 = 0, game2 = 0, game3 = 0, game4 = 0, game5 = 0, allGameProfit = 0;
                let individualSettlementProfits = {}
                if (data.length > 0) {
                    game1 = data[0].game1;
                    game2 = data[0].game2;
                    game3 = data[0].game3;
                    game4 = data[0].game4;
                    game5 = data[0].game5;
                    allGameProfit = +parseFloat(game1).toFixed(2) + +parseFloat(game2).toFixed(2) + +parseFloat(game3).toFixed(2) + +parseFloat(game4).toFixed(2) + +parseFloat(game5).toFixed(2);
                }
                console.log("lastSettlement and previousProfit---", lastSettlement, previousProfit, allGameProfit)

                if (lastSettlement) {
                    individualSettlementProfits = {
                        game1: +parseFloat(game1 - (+lastSettlement.game1Profit)).toFixed(2),
                        game2: +parseFloat(game2 - (+lastSettlement.game2Profit)).toFixed(2),
                        game3: +parseFloat(game3 - (+lastSettlement.game3Profit)).toFixed(2),
                        game4: +parseFloat(game4 - (+lastSettlement.game4Profit)).toFixed(2),
                        game5: +parseFloat(game5 - (+lastSettlement.game5Profit)).toFixed(2),
                        allGameProfit: +parseFloat(allGameProfit - (+lastSettlement.allGameProfit)).toFixed(2)
                    }
                } else {
                    individualSettlementProfits = {
                        game1: game1,
                        game2: game2,
                        game3: game3,
                        game4: game4,
                        game5: game5,
                        allGameProfit: allGameProfit
                    }
                }

                let formData = {
                    game1Profit: +parseFloat(game1).toFixed(2),
                    game2Profit: +parseFloat(game2).toFixed(2),
                    game3Profit: +parseFloat(game3).toFixed(2),
                    game4Profit: +parseFloat(game4).toFixed(2),
                    game5Profit: +parseFloat(game5).toFixed(2),
                    allGameProfit: +parseFloat(allGameProfit).toFixed(2), //+parseFloat(game1 + game2 + game3 + game4 + game5).toFixed(2),

                    inAmountMetronia: inAmountMetronia || 0,
                    outAmountMetronia: outAmountMetronia || 0,
                    totalAmountMetronia: totalAmountMetronia || 0,

                    inAmountOkBingo: inAmountOkBingo || 0,
                    outAmountOkBingo: outAmountOkBingo || 0,
                    totalAmountOkBingo: totalAmountOkBingo || 0,

                    inAmountFranco: inAmountFranco || 0,
                    outAmountFranco: outAmountFranco || 0,
                    totalAmountFranco: totalAmountFranco || 0,

                    inAmountOtium: inAmountOtium || 0,
                    outAmountOtium: outAmountOtium || 0,
                    totalAmountOtium: totalAmountOtium || 0,

                    inAmountNorskTippingDag: inAmountNorskTippingDag || 0,
                    outAmountNorskTippingDag: outAmountNorskTippingDag || 0,

                    inAmountNorskTotalt: inAmountNorskTotalt || 0,
                    outAmountNorskTotalt: outAmountNorskTotalt || 0,
                    totalAmountNorskTotalt: totalAmountNorskTotalt || 0,

                    inAmountNorskRikstotoDag: inAmountNorskRikstotoDag || 0,
                    outAmountNorskRikstotoDag: outAmountNorskRikstotoDag || 0,
                    totalAmountNorskRikstotoDag: totalAmountNorskRikstotoDag || 0,

                    inAmountNorskRikstotoTotalt: inAmountNorskRikstotoTotalt || 0,
                    outAmountNorskRikstotoTotalt: outAmountNorskRikstotoTotalt || 0,
                    totalAmountNorskRikstotoTotalt: totalAmountNorskRikstotoTotalt || 0,

                    inAmountRekvisita: inAmountRekvisita || 0,
                    totalAmountRekvisita: totalAmountRekvisita || 0,

                    inAmountSellProduct: inAmountSellProduct || 0,
                    totalAmountSellProduct: totalAmountSellProduct || 0,

                    outAmountBilag: outAmountBilag || 0,
                    totalAmountBilag: totalAmountBilag || 0,

                    outAmountBank: outAmountBank || 0,
                    totalAmountBank: totalAmountBank || 0,

                    inAmountTransferredByBank: inAmountTransferredByBank || 0,
                    totalAmountTransferredByBank: totalAmountTransferredByBank || 0,

                    inAmountAnnet: inAmountAnnet || 0,
                    outAmountAnnet: outAmountAnnet || 0,
                    totalAmountAnnet: totalAmountAnnet || 0,

                    dailyBalanceAtStartShift: dailyBalanceAtStartShift || 0,
                    dailyBalanceAtEndShift: dailyBalanceAtEndShift || 0,
                    dailyBalanceDifference: dailyBalanceDifference || 0,

                    settlementToDropSafe: settlementToDropSafe || 0,
                    withdrawFromtotalBalance: withdrawFromtotalBalance || 0,
                    totalDropSafe: totalDropSafe || 0,

                    shiftDifferenceIn: shiftDifferenceIn || 0,
                    shiftDifferenceOut: shiftDifferenceOut || 0,
                    shiftDifferenceTotal: shiftDifferenceTotal || 0,

                    settlmentNote,
                    billImages: billsArray,
                    hallId: hallId,
                    agentId: agentId,
                    shiftId: hallsData.activeAgents[index].shiftId,
                    hall: req.session.details.hall[0],
                    groupHall: hallsData.groupHall,
                    date: moment(settlementDate, "DDMMYYYY").set({ hour: moment().hour(), minute: moment().minute(), second: moment().second(), millisecond: moment().millisecond() }).toDate(), //(hallsData.otherData?.isPreviousDaySettlementPending == true) ? hallsData.otherData.previousDaySettlementDate : moment(agentShift.createdAt),
                    'otherData.individualSettlementProfits': individualSettlementProfits,
                    'otherData.agentName': req.session.details.name
                }

                let insertData = await Sys.App.Services.AgentServices.insertSettlementData(formData);
                console.log("insertData---", insertData);

                // Transfer daily balance to total hall cash balance
                let updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $inc: { "hallCashBalance": agentShift.dailyBalance } }, { new: true });

                let hallTransaction = {
                    transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                    shiftId: hallsData.activeAgents[index].shiftId,
                    hallId: hallId,
                    agentId: agentId,
                    type: "Add From Daily Balance",
                    category: "credit",
                    amount: Math.abs(+agentShift.dailyBalance),
                    previousBalance: +parseFloat(updatedHall.hallCashBalance - (Math.abs(+agentShift.dailyBalance))).toFixed(2),
                    afterBalance: +parseFloat(updatedHall.hallCashBalance).toFixed(2),
                    hall: req.session.details.hall[0],
                    groupHall: hallsData.groupHall,
                    createdAt: Date.now(),
                }
                await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction);

                let newExtraTransaction = {
                    hallId: hallId,
                    agentId: agentId,
                    playerId: agentId,
                    agentName: req.session.details.name,
                    playerName: req.session.details.name,
                    action: "debit", // debit / credit
                    amount: Math.abs(+agentShift.dailyBalance),
                    typeOfTransaction: "Deduct From Daily Balance",
                    //defineSlug:"addDailyBalance",
                    hall: req.session.details.hall[0],
                    groupHall: hallsData.groupHall,
                }

                let response = await Sys.Helper.gameHelper.controlDailyBalance(newExtraTransaction);
                console.log("response of daily balance through control daily balance", response)
                if (!response || response.status == "fail") {
                    return res.json({ status: "success", message: translate.something_went_wrong_please_try_again_later })//"Something went wrong, please try again later." });
                }

                //update daily balance, cash safe and total hall cash balance

                // firsr consider shift difference: shiftDifferenceTotal
                let shiftDifference = null;
                if (shiftDifferenceTotal > 0) {
                    shiftDifference = "credit";
                } else if (shiftDifferenceTotal < 0) {
                    shiftDifference = "debit";
                }
                if (shiftDifference) {
                    //let updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $inc: { "hallCashBalance": +shiftDifferenceTotal } }, { new: true });
                    let hallTransaction = {
                        transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                        shiftId: hallsData.activeAgents[index].shiftId,
                        hallId: hallId,
                        agentId: agentId,
                        type: "SettlementDifference",
                        category: shiftDifference,
                        amount: Math.abs(+shiftDifferenceTotal),
                        //previousBalance: (shiftDifference == "credit") ? +parseFloat(updatedHall.hallCashBalance - (Math.abs(+shiftDifferenceTotal))).toFixed(2) : +parseFloat(updatedHall.hallCashBalance + (Math.abs(+shiftDifferenceTotal))).toFixed(2),
                        //afterBalance: +parseFloat(updatedHall.hallCashBalance).toFixed(2),
                        hall: req.session.details.hall[0],
                        groupHall: hallsData.groupHall,
                        settlementId: insertData.id,
                        createdAt: Date.now(),
                    }
                    await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction);
                }

                // Now we need to update Total hall cash balance whatever is provided in settlement form
                let latestHallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, hallCashBalance: 1, otherData: 1 });
                let setHallTotalBalanceAction = null;
                let hallCashBalanceDiff = +parseFloat(dailyBalanceAtEndShift - latestHallsData.hallCashBalance).toFixed(2);;
                if (dailyBalanceAtEndShift > latestHallsData.hallCashBalance) {
                    setHallTotalBalanceAction = "credit";
                } else if (dailyBalanceAtEndShift < latestHallsData.hallCashBalance) {
                    setHallTotalBalanceAction = "debit";
                } else {
                    console.log("there is no misatch of daily balance so no need to do any thing");
                }
                if (setHallTotalBalanceAction) {
                    let updatedHall = await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $inc: { "hallCashBalance": hallCashBalanceDiff } }, { new: true });
                    let hallTransaction = {
                        transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                        shiftId: hallsData.activeAgents[index].shiftId,
                        hallId: hallId,
                        agentId: agentId,
                        type: "Settlement",
                        category: setHallTotalBalanceAction,
                        amount: Math.abs(+hallCashBalanceDiff),
                        previousBalance: (setHallTotalBalanceAction == "credit") ? +parseFloat(updatedHall.hallCashBalance - (Math.abs(+hallCashBalanceDiff))).toFixed(2) : +parseFloat(updatedHall.hallCashBalance + (Math.abs(+hallCashBalanceDiff))).toFixed(2),
                        afterBalance: +parseFloat(updatedHall.hallCashBalance).toFixed(2),
                        hall: req.session.details.hall[0],
                        groupHall: hallsData.groupHall,
                        settlementId: insertData.id,
                        createdAt: Date.now(),
                    }
                    await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction);
                }

                // update hall and agentShift dropSafe balance
                if (settlementToDropSafe && Math.abs(settlementToDropSafe) > 0) {
                    let category = null;
                    if (settlementToDropSafe > 0) {
                        category = "credit";
                    } else if (settlementToDropSafe < 0) {
                        category = "debit";
                    }

                    let hallTransaction = {
                        shiftId: hallsData.activeAgents[index].shiftId,
                        hallId: hallId,
                        agentId: agentId,
                        typeOfTransaction: (category == "credit") ? "Add Hall Safe Balance" : "Deduct Hall Safe Balance",
                        action: category,
                        amount: Math.abs(+settlementToDropSafe),
                        hall: req.session.details.hall[0],
                        groupHall: hallsData.groupHall,
                    }
                    await Sys.Helper.gameHelper.transferToDropSafe(hallTransaction);
                }

                if (latestHallsData.otherData?.isPreviousDaySettlementPending == true) {
                    let finalHall = await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $set: { "isSettled": false, 'otherData.isPreviousDaySettlementPending': false, controlDailyBalance: { dailyBalanceDiff: 0, hallCashBalanceDiff: 0 } } }, { new: true });
                    await Sys.App.Services.AgentServices.updateShiftData({ _id: hallsData.activeAgents[index].shiftId, hallId: hallId, agentId: agentId }, { $set: { totalDailyBalanceIn: 0, totalCashIn: 0, totalCashOut: 0, toalCardIn: 0, totalCardOut: 0, sellingByCustomerNumber: 0, hallCashBalance: finalHall.hallCashBalance, hallDropsafeBalance: finalHall.hallDropsafeBalance, previousSettlement: { dailyBalanceAtStartShift: +dailyBalanceAtStartShift, dailyBalanceAtEndShift: +dailyBalanceAtEndShift, dailyBalanceDifference: +dailyBalanceDifference, settlementToDropSafe: +settlementToDropSafe, withdrawFromtotalBalance: +withdrawFromtotalBalance, shiftDifferenceTotal: +shiftDifferenceTotal, dailyBalance: agentShift.dailyBalance, hallCashBalance: hallsData.hallCashBalance } } }, { new: true });
                    await Sys.App.Services.HallServices.updateHall({ _id: hallId, "activeAgents.id": agentId }, { $set: { "activeAgents.$.totalDailyBalanceIn": 0, "activeAgents.$.totalCashIn": 0, "activeAgents.$.totalCashOut": 0, "activeAgents.$.toalCardIn": 0, "activeAgents.$.totalCardOut": 0, "activeAgents.$.sellingByCustomerNumber": 0, "activeAgents.$.hallCashBalance": finalHall.hallCashBalance, "activeAgents.$.hallDropsafeBalance": finalHall.hallDropsafeBalance } }, { new: true });
                } else {
                    await Sys.App.Services.AgentServices.updateShiftData({ _id: hallsData.activeAgents[index].shiftId, hallId: hallId, agentId: agentId }, { $set: { settlement: { dailyBalanceAtStartShift: +dailyBalanceAtStartShift, dailyBalanceAtEndShift: +dailyBalanceAtEndShift, dailyBalanceDifference: +dailyBalanceDifference, settlementToDropSafe: +settlementToDropSafe, withdrawFromtotalBalance: +withdrawFromtotalBalance, shiftDifferenceTotal: +shiftDifferenceTotal, dailyBalance: agentShift.dailyBalance, hallCashBalance: hallsData.hallCashBalance } } }, { new: true });
                    await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $set: { "isSettled": true, 'otherData.isPreviousDaySettlementPending': false, controlDailyBalance: { dailyBalanceDiff: 0, hallCashBalanceDiff: 0 } } }, { new: true });
                }
                req.session.details.dailyBalance = 0;
                //send broadcast to admin
                module.exports.sendHallBalanceUpdateBroadcast(hallsData.activeAgents[index].shiftId, hallId);

                return res.json({ status: "success", message: translate.settlement_data_update_successfully })//"Settlement Data updated Successfully." });
            } else {
                return res.json({ status: "fail", message: translate.something_went_wrong_please_try_again_later })// 'Something went wrong, please try again later.' });
            }
        } catch (e) {
            console.log("Error while adding daily balance :", e);
            return res.json({ status: "fail", message: translate.something_went_wrong_please_try_again_later })// 'Something went wrong, please try again later.' });
        }
    },

    sendHallBalanceUpdateBroadcast: async function (shiftId, hallId) {
        try {
            const shiftData = await Sys.App.Services.AgentServices.getSingleShiftData({ _id: shiftId });
            const hall = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { hallCashBalance: 1 });
            Sys.Helper.gameHelper.sendHallBalanceUpdateBroadcast({
                shiftId: shiftData._id.toString(),
                hallId: shiftData.hallId,
                dailyBalance: shiftData.dailyBalance,
                totalDailyBalanceIn: shiftData.totalDailyBalanceIn,
                totalCashIn: shiftData.totalCashIn,
                totalCashOut: shiftData.totalCashOut,
                toalCardIn: shiftData.toalCardIn,
                totalCardOut: shiftData.totalCardOut,
                totalHallCashBalance: hall.hallCashBalance
            });
        } catch (e) {
            console.log("Error in sending broadcast");
        }
    },

    getSettlementDate: async function (req, res) {
        try {
            const hallId = req.session.details.hall[0].id;
            let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { otherData: 1 });
            let settlementDate = moment().format("YYYY-MM-DD");
            if (hallsData) {
                settlementDate = (hallsData.otherData?.isPreviousDaySettlementPending == true) ? moment(hallsData.otherData.previousDaySettlementDate).format("YYYY-MM-DD") : moment().format("YYYY-MM-DD");
            }
            // get report, this report is based on shift wise
            let reportResult = [{ machineName: "Metronia", totalIn: 0, totalOut: 0 }, { machineName: "OK Bingo", totalIn: 0, totalOut: 0 }];
            let report = await Sys.App.Controllers.machineApiController.getReportData(req, res);
            if (report && report.status == "success") {
                reportResult = report.result;
            }
            return res.send({ status: "success", date: settlementDate, result: reportResult });
        } catch (e) {
            return res.send({ status: "fail", date: moment().format("YYYY-MM-DD") });
        }
    },

    // updatePendingSettlements: async function(){
    //     try{
    //         console.log("upadte pending settlement called");
    //         const startOfYesterday = moment.tz('UTC').subtract(1, 'day').startOf('day').toDate();
    //         const endOfYesterday = moment.tz('UTC').subtract(1, 'day').endOf('day').toDate();
    //         let shiftData = await Sys.App.Services.AgentServices.getShiftByData({ createdAt: {$gte: startOfYesterday, $lt: endOfYesterday } }, { settlement: 1, hallId: 1, agentId: 1, isActive: true  } )
    //         console.log("previous day's settlements---- ", settlements);
    //         if(settlements.length > 0){
    //             for(s=0; s< shiftData.length; s++){
    //                 if( !shiftData?.settlement || !isObjectNonEmpty(shiftData.settlement) ){
    //                     console.log("settlement is not done yet", shiftData);

    //                 }
    //             }
    //         }
    //     }catch(e){
    //         console.log("Error updating pending settlement");
    //     }
    // }

    dontTransferTickets: async function (data) {
        try {
            console.log("dont need to transfer the tickets");
            const { agentId, hallId, shiftId } = data;

            let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, hallCashBalance: 1, otherData: 1 });
            console.log("hallsData---", hallsData, hallsData.activeAgents, agentId)
            if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                console.log("1111")
                if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                    console.log("2222")
                    return { status: "fail", message: 'Please ensure the previous agent logs out before adding balance.' };
                }
                await Sys.App.Services.scheduleServices.deleteAgentRegisteredTicket({ hallId: hallId });
            }
            return { status: "success" };
        } catch (error) {
            return { status: "fail", message: 'Please ensure the previous agent logs out before adding balance.' };
        }
    },

    setHallStausWithColorCode: async function (data) {
        try {
            const { gameId, hallName, hallId } = data;

            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: gameId }, { 'otherData.agents': 1, 'otherData.masterHallId': 1 }, {});

            const hallStatus = {};
            const agents = game.otherData.agents;

            const greenHalls = [];
            const redHalls = [];
            const yellowHalls = [];

            let isMyHallReady = false;
            agents.forEach(agent => {
                //console.log("agent---", agent)   
                const hallId = agent.hallId;
                if (!hallStatus[hallId]) {
                    hallStatus[hallId] = { id: hallId, name: agent.hallName, isReady: agent.isReady, isSold: agent.scannedTickets.isSold, isPending: agent.scannedTickets.isPending, isScanned: agent.scannedTickets.isScanned };
                } else if (agent.isReady == true || agent.scannedTickets.isSold == true || agent.scannedTickets.isPending == true || agent.scannedTickets.isScanned == true) {
                    hallStatus[hallId].isReady = agent.isReady;
                    hallStatus[hallId].isSold = agent.scannedTickets.isSold;
                    hallStatus[hallId].isPending = agent.scannedTickets.isPending;
                    hallStatus[hallId].isScanned = agent.scannedTickets.isScanned;
                }

                if (hallName && agent.hallName == hallName && agent.isReady == true) {
                    isMyHallReady = true;
                }

            });
            Object.values(hallStatus).forEach(hall => {
                if (hall.isReady == false && hall.id != game.otherData.masterHallId) {
                    redHalls.push(hall.name);
                } else if (hall.isReady == true && hall.isScanned == true && hall.isSold == true && hall.isPending == false) {
                    greenHalls.push(hall.name);
                } else if (hall.isReady == false && hall.id == game.otherData.masterHallId && hall.isScanned == true && hall.isSold == true && hall.isPending == false) {
                    greenHalls.push(hall.name);
                } else {
                    yellowHalls.push(hall.name)
                }
            });
            // send this broadcast to all hall to show different colors of status change button to(game.otherData.masterHallId)
            if (hallId) {
                await Sys.Io.of('admin').to(hallId).emit('onHallReady', {
                    gameId: gameId,
                    redHalls: redHalls,
                    greenHalls: greenHalls,
                    yellowHalls: yellowHalls
                });
            } else {
                await Sys.Io.of('admin').emit('onHallReady', {
                    gameId: gameId,
                    redHalls: redHalls,
                    greenHalls: greenHalls,
                    yellowHalls: yellowHalls
                });
            }
            return {
                "status": "success",
                result: { redHalls: redHalls, greenHalls: greenHalls, yellowHalls, isMyHallReady: isMyHallReady }
            };

        } catch (e) {
            return { status: "fail", message: 'Something went Wrong!' };
        }
    },

    getUpcomingGames: async function (req, res) {
        try {
            let order = req.query.order;
            let sort = { createdAt: 1 };

            let start = parseInt(req.query.start);
            let length = parseInt(req.query.length);
            //let search = req.query.search.value;

            let gameData = [];
            let reqCount = 0;
            if (req.session && req.session.details.role == 'agent') {
                console.log("agent hall---", req.session.details.hall)
                let masterHallId = (req.session.details.hall.length > 0) ? req.session.details.hall[0].id : ""
                let startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);
                let endofDay = new Date();
                endofDay.setHours(23, 59, 59, 999);
                let query = {
                    gameType: "game_1",
                    status: "active",
                    startDate: {
                        $gte: startOfDay,
                        $lte: endofDay
                    },
                    //'otherData.masterHallId': masterHallId
                    halls: { $in: [masterHallId] }
                };

                if (req.query.parentGameId) {
                    query.parentGameId = req.query.parentGameId;
                    // Check if schedule is already stopped, if yes then send empty array
                    let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: req.query.parentGameId }, { stopGame: 1 }, {});
                    if( !schedule ||  (schedule && schedule.stopGame == true) ){
                        let obj = {
                            'draw': req.query.draw,
                            'recordsTotal': reqCount,
                            'recordsFiltered': reqCount,
                            'data': gameData,
                        };
                        return res.send(obj);
                    } 
                }

                let pastGame = await Sys.App.Services.GameService.getSingleGame(
                    {
                        ...query,
                        status: { $in: ["running", "finish"] },  //  only running/finished
                    },
                    { sequence: 1, status: 1 },
                    { sort: { sequence: -1 } }  // highest sequence
                );
               
                if (pastGame) {
                    query.sequence = { $gt: pastGame.sequence };
                }

                let search = req.query.search.value;
                if (search != '') {
                    query.gameName = { $regex: '.*' + search + '.*', $options: 'i' };
                }

                reqCount = await Sys.App.Services.GameService.getGameCount(query);

                let data = await Sys.App.Services.GameService.getGamesByData(query, { subGames: 1, gameNumber: 1, gameName: 1, startDate: 1, ticketSold: 1, earnedFromTickets: 1, status: 1, gameMode: 1, stopGame: 1, otherData: 1 }, { sort: sort, limit: length, skip: start });

                for (let i = 0; i < data.length; i++) {
                    let ticket = [];
                    if (data[i].subGames[0].options.length > 0) {
                        for (let j = 0; j < data[i].subGames[0].options.length; j++) {
                            ticket.push({
                                color: data[i].subGames[0].options[j].ticketName,
                                price: data[i].subGames[0].options[j].ticketPrice
                            })
                        }
                    }
                    let dataGame = {
                        _id: data[i]._id,
                        gameNumber: data[i].gameNumber,
                        gameName: data[i].gameName,
                        startTime: moment(data[i].startDate).format("HH:mm"),
                        startTimeTemp: moment(data[i].startDate),
                        ticketColorPrice: ticket,
                        totalTicketsSold: data[i].ticketSold,
                        earnedFromTickets: +parseFloat(data[i].earnedFromTickets).toFixed(2),
                        status: data[i].status,
                        gameMode: data[i].gameMode,
                        isStopped: data[i].stopGame,
                        isMaster: (data[i].otherData.masterHallId == masterHallId) ? true : false,
                        isTestGame: data[i]?.otherData?.isTestGame ?? false,
                    }
                    gameData.push(dataGame);
                }

            }

            let obj = {
                'draw': req.query.draw,
                'recordsTotal': reqCount,
                'recordsFiltered': reqCount,
                'data': gameData,
            };

            res.send(obj);
        } catch (e) {
            console.log("Error in get upcoming games", e);
        }
    },

    // stopUpcomingGame: async function (req, res) {
    //     let keys = ["ticket_refund_successfully", "you_are_not_allowed_to_access_that_page", "something_went_wrong_please_try_again_later"]
    //     let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
    //     try {
    //         let hallId = (req.session.details.hall.length > 0) ? req.session.details.hall[0].id : ""
    //         if (req.session && req.session.details.role == 'agent' && hallId) {

    //             let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id }, { status: 1, stopGame: 1, 'otherData.masterHallId': 1 }, {});
    //             console.log("game---", game);
    //             if (game && game.otherData.masterHallId == hallId) {
    //                 let updatedGame = await Sys.App.Services.GameService.findOneAndUpdateGameData({ _id: req.body.id, status: "active" }, { "$set": { "stopGame": true } });
    //                 if (updatedGame && updatedGame.stopGame == true) {
    //                     if (updatedGame.players.length > 0) {
    //                         for (let p = 0; p < updatedGame.players.length; p++) {
    //                             let player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: updatedGame.players[p].id }, { username: 1 });
    //                             if (player) {
    //                                 let tiketPrice = updatedGame.players[p].ticketPrice;
    //                                 let ticketQty = updatedGame.players[p].totalPurchasedTickets;
    //                                 let purchasedTickets = updatedGame.players[p].purchaseTicketTypes;
    //                                 let purchasedSlug = updatedGame.players[p].purchasedSlug;

    //                                 let updateGame = await Sys.Game.Game1.Services.GameServices.updateGameNested(
    //                                     { _id: updatedGame._id, 'players.id': updatedGame.players[p].id },
    //                                     { $pull: { players: { id: updatedGame.players[p].id } }, $inc: { ticketSold: -ticketQty, earnedFromTickets: -tiketPrice, finalGameProfitAmount: -tiketPrice } },
    //                                 );
    //                                 console.log("updatedGame in cancelTicket of player", updatedGame.players[p].id, updatedGame._id, updateGame)

    //                                 if (updateGame instanceof Error || updateGame == null || updateGame == undefined) {
    //                                     console.log("error in cancelling ticket when stopped game", updatedGame.players[p].id, updatedGame._id);
    //                                 } else {
    //                                     console.log("cancel ticket purchased, revert user amount while stopped game", updatedGame.players[p].id);

    //                                     if (purchasedSlug == "points") {
    //                                         await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: updatedGame.players[p].id }, { $inc: { points: tiketPrice } });
    //                                         let newExtraTransaction = {
    //                                             playerId: player._id,
    //                                             gameId: updatedGame._id,
    //                                             transactionSlug: "extraTransaction",
    //                                             typeOfTransaction: "Refund",
    //                                             action: "credit", // debit / credit
    //                                             purchasedSlug: "points", // point /realMoney
    //                                             totalAmount: tiketPrice,
    //                                             game1Slug: "refund"
    //                                         }
    //                                         await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
    //                                         Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
    //                                             type: "cancel",
    //                                             playerId: player._id,
    //                                             hallId: player.hallId,
    //                                             cancel: tiketPrice
    //                                         });
    //                                     } else if (purchasedSlug == "realMoney") {
    //                                         await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: updatedGame.players[p].id }, { $inc: { walletAmount: tiketPrice, monthlyWalletAmountLimit: tiketPrice } });
    //                                         let newExtraTransaction = {
    //                                             playerId: player._id,
    //                                             gameId: updatedGame._id,
    //                                             transactionSlug: "extraTransaction",
    //                                             typeOfTransaction: "Refund",
    //                                             action: "credit", // debit / credit
    //                                             purchasedSlug: "realMoney", // point /realMoney
    //                                             totalAmount: tiketPrice,
    //                                              game1Slug: "refund"
    //                                         }
    //                                         await Sys.Helper.gameHelper.createTransactionPlayer(newExtraTransaction);
    //                                         Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
    //                                             type: "cancel",
    //                                             playerId: player._id,
    //                                             hallId: player.hallId,
    //                                             cancel: tiketPrice
    //                                         });
    //                                     }

    //                                     if (purchasedTickets.length > 0) {
    //                                         let incObj = {};
    //                                         let filterArr = [];
    //                                         let tempAlpha = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']
    //                                         for (let s = 0; s < purchasedTickets.length; s++) {
    //                                             incObj["subGames.$[].options.$[" + tempAlpha[s] + "].totalPurchasedTickets"] = -(purchasedTickets[s].totalPurchasedTickets);
    //                                             filterArr.push({ [tempAlpha[s] + ".ticketName"]: purchasedTickets[s].ticketName })
    //                                         }
    //                                         Sys.Game.Game1.Services.GameServices.updateGameNested({ _id: updatedGame._id }, {
    //                                             $inc: incObj
    //                                         }, { arrayFilters: filterArr, new: true });
    //                                     }

    //                                     Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: updatedGame.players[p].id, gameId: updatedGame._id });
    //                                     // update static tickets for predefined tickets flow
    //                                     Sys.Game.Game1.Services.GameServices.updateManyStaticData({ playerIdOfPurchaser: updatedGame.players[p].id, isPurchased: true, gameId: updatedGame._id }, { isPurchased: false, playerIdOfPurchaser: "", gameId: "" });

    //                                     let TimeMessage = updatedGame.gameNumber + " [ " + updatedGame.gameName + " ] " + translate.ticket_refund_successfully + "..!! ";

    //                                     let notification = {
    //                                         notificationType: 'refundTickets',
    //                                         message: TimeMessage
    //                                     }

    //                                     let dataNotification = {
    //                                         playerId: player._id,
    //                                         gameId: updatedGame._id,
    //                                         notification: notification
    //                                     }

    //                                     await Sys.Game.Common.Services.NotificationServices.create(dataNotification);

    //                                     await Sys.Io.to(player.socketId).emit('NotificationBroadcast', {
    //                                         notificationType: notification.notificationType,
    //                                         message: TimeMessage
    //                                     });

    //                                 }

    //                             }
    //                         }
    //                     }
    //                     Sys.Io.of(Sys.Config.Namespace.Game1).to(updatedGame._id).emit('RefreshRoom', {});
    //                     Sys.Io.of(Sys.Config.Namespace.Game1).to(updatedGame._id).emit('adminRefreshRoom', {});
    //                     Sys.Io.of('admin').emit('refreshSchedule', { scheduleId: updatedGame.parentGameId });
    //                     updatedGame?.halls.forEach(hall => {
    //                         Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
    //                     })
    //                 }
    //                 return res.send({ status: "success", message: "Success" });
    //             } else if (game && game.otherData.masterHallId != hallId) {
    //                 return res.send({ status: "fail", message: translate.you_are_not_allowed_to_access_that_page })//"You are not allowed to perform this action." });
    //             } else {
    //                 return res.send({ status: "fail", message: translate.something_went_wrong_please_try_again_later })//"Something went wrong while cancelling the Upcoming Game." });

    //             }

    //         }
    //         return res.send({ status: "fail", message: translate.something_went_wrong_please_try_again_later }) // "Something went wrong while cancelling the Upcoming Game." });
    //     } catch (e) {
    //         console.log("Error in stopping upcoming game", e);
    //     }
    // },

    stopUpcomingGame: async function (req, res) {
        const keys = [
            "ticket_refund_successfully",
            "you_are_not_allowed_to_access_that_page",
            "something_went_wrong_please_try_again_later"
        ];
        const translatedData = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
    
        try {
            const hallId = req.session.details.hall?.[0]?.id || "";
            const isAgent = req.session?.details?.role === "agent";
    
            if (!isAgent || !hallId) {
                return res.send({ status: "fail", message: translatedData.something_went_wrong_please_try_again_later });
            }
    
            const game = await Sys.App.Services.GameService.getSingleGameData(
                { _id: req.body.id },
                { status: 1, stopGame: 1, 'otherData.masterHallId': 1 },
                {}
            );
    
            if (!game) {
                return res.send({ status: "fail", message: translatedData.something_went_wrong_please_try_again_later });
            }
    
            if (game.otherData.masterHallId !== hallId) {
                return res.send({ status: "fail", message: translatedData.you_are_not_allowed_to_access_that_page });
            }
    
            const updatedGame = await Sys.App.Services.GameService.findOneAndUpdateGameData(
                { _id: req.body.id, status: "active" },
                { "$set": { "stopGame": true } }
            );
    
            if (!updatedGame?.stopGame) {
                return res.send({ status: "fail", message: translatedData.something_went_wrong_please_try_again_later });
            }
    
            const players = updatedGame.players || [];
            const refundPromises = players.map(async (playerData) => {
                const player = await Sys.Game.Game1.Services.PlayerServices.getOneByData({ _id: playerData.id }, { username: 1, socketId: 1, selectedLanguage: 1 });
                if (!player) return;
    
                const { ticketPrice, totalPurchasedTickets, purchaseTicketTypes, purchasedSlug } = playerData;
    
                const updateResult = await Sys.Game.Game1.Services.GameServices.updateGameNested(
                    { _id: updatedGame._id, 'players.id': playerData.id },
                    {
                        $pull: { players: { id: playerData.id } },
                        $inc: {
                            ticketSold: -totalPurchasedTickets,
                            earnedFromTickets: -ticketPrice,
                            finalGameProfitAmount: -ticketPrice
                        }
                    }
                );
    
                if (!updateResult || updateResult instanceof Error) {
                    console.log("Error removing player tickets", playerData.id);
                    return;
                }
    
                const updateData = {
                    points: purchasedSlug === "points" ? ticketPrice : 0,
                    walletAmount: purchasedSlug === "realMoney" ? ticketPrice : 0,
                    monthlyWalletAmountLimit: purchasedSlug === "realMoney" ? ticketPrice : 0,
                };
    
                await Sys.Game.Common.Services.PlayerServices.FindOneUpdate(
                    { _id: playerData.id },
                    { $inc: updateData }
                );
    
                const transaction = {
                    playerId: player._id,
                    gameId: updatedGame._id,
                    transactionSlug: "extraTransaction",
                    typeOfTransaction: "Refund",
                    action: "credit",
                    purchasedSlug,
                    totalAmount: ticketPrice,
                    game1Slug: "refund"
                };
                await Sys.Helper.gameHelper.createTransactionPlayer(transaction);
                let stopGamedata = {
                    playerId: player._id,
                    gameId: updatedGame._id,
                    gameName: updatedGame.gameName,
                    purchaseTicketTypes: purchaseTicketTypes,
                }
                await module.exports.updateDailyTransactionByStopGame(stopGamedata);
    
                // Update ticket types
                // if (purchaseTicketTypes?.length > 0) {
                //     const tempAlpha = 'abcdefghijklmnopqrstuvwxyz';
                //     const incObj = {};
                //     const filterArr = [];
    
                //     purchaseTicketTypes.forEach((pt, i) => {
                //         incObj[`subGames.$[].options.$[${tempAlpha[i]}].totalPurchasedTickets`] = -pt.totalPurchasedTickets;
                //         filterArr.push({ [`${tempAlpha[i]}.ticketName`]: pt.ticketName });
                //     });
    
                //     await Sys.Game.Game1.Services.GameServices.updateGameNested(
                //         { _id: updatedGame._id },
                //         { $inc: incObj },
                //         { arrayFilters: filterArr, new: true }
                //     );
                // }

                // Update Terminal,web count with ticketdata
                const prTickets = await Sys.Game.Game1.Services.GameServices.getTicketListData(
                    { gameId: updatedGame._id, playerIdOfPurchaser: playerData.id },
                    { tickets: 1, ticketColorName: 1, ticketColorType: 1, userTicketType: 1, hallId: 1, ticketPrice:1, count:1,ticketKey:1, ticketId:1 }
                );
                const ticketGroups = {};
                const bulkOps = [];
                for (const t of prTickets) {
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

                for (const group of Object.values(ticketGroups)) {
                    const { ticketColorName, ticketKey, hallId, userTicketType, ticketColorType, ticketPrice, count } = group;
                
                    let groupSize = 1;
                    if (ticketColorType === 'large') groupSize = 3;
                    else if (ticketColorType === 'elvis') groupSize = 2;
                
                    const deleteCountSubGame = groupSize === 1 ? count : Math.floor(count / groupSize);
                    console.log("group:", group, ticketColorName, "groupSize:", groupSize, "deleteCount:", deleteCountSubGame);
                    if (count > 0) {
                        // Add general updates for subGames and groupHalls
                        const groupHallsCount = (ticketColorType === 'large') ? -deleteCountSubGame: -count;
                        bulkOps.push({
                            updateOne: {
                                filter: { _id: updatedGame._id },
                                update: {
                                    $inc: {
                                        [`subGames.$[].options.$[opt].totalPurchasedTickets`]: -deleteCountSubGame,
                                        [`groupHalls.$[].halls.$[hall].userTicketType.${userTicketType}.${ticketKey}`]: groupHallsCount,
                                        [`groupHalls.$[].halls.$[hall].ticketData.${ticketKey}`]: groupHallsCount
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
    
                // Cleanup
                await Promise.all([
                    bulkOps.length && Sys.App.Services.GameService.bulkWriteGameData(bulkOps),
                    Sys.App.Services.GameService.deleteTicketManydata({ playerIdOfPurchaser: playerData.id, gameId: updatedGame._id }),
                    Sys.Game.Game1.Services.GameServices.updateManyStaticData(
                        { playerIdOfPurchaser: playerData.id, isPurchased: true, gameId: updatedGame._id },
                        { isPurchased: false, playerIdOfPurchaser: "", gameId: "" }
                    )
                ]);
    
                const message = {
                    en: await translate({ key: "refund_tickets", language: 'en', isDynamic: true, number: updatedGame.gameNumber, number1: updatedGame.gameName }),
                    nor: await translate({ key: "refund_tickets", language: 'nor', isDynamic: true, number: updatedGame.gameNumber, number1: updatedGame.gameName })
                };

                const notification = {
                    notificationType: "refundTickets",
                    message
                };
    
                await Sys.Game.Common.Services.NotificationServices.create({
                    playerId: player._id,
                    gameId: updatedGame._id,
                    notification
                });
                
                Sys.Io.to(player.socketId).emit('NotificationBroadcast', {notificationType: notification.notificationType, message: notification.message?.[player.selectedLanguage]});
                Sys.Io.to(player.socketId).emit('PlayerHallLimit', { });
            });
    
            await Promise.all(refundPromises);
    
            // Notify rooms and admins
            const gameId = updatedGame._id;
            const parentGameId = updatedGame.parentGameId;
    
            Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('RefreshRoom', {});
            Sys.Io.of(Sys.Config.Namespace.Game1).emit('adminRefreshRoom', {});
            Sys.Io.of('admin').emit('refreshSchedule', { scheduleId: parentGameId });
    
            updatedGame?.halls?.forEach(hall => {
                Sys.Io.of('admin').to(hall).emit('refresh', { message: "Game Finish" });
            });
    
            return res.send({ status: "success", message: "Success" });
        } catch (err) {
            console.error("Error in stopping upcoming game:", err);
            return res.send({ status: "fail", message: translatedData.something_went_wrong_please_try_again_later });
        }
    },

    updateDailyTransactionByStopGame: async function (data) {
        try {
            console.log("🚀 ~ updateDailyTransactionByStopGame:***********", data);
            if (data.purchaseTicketTypes.length > 0) {
                if (data.gameName == "Traffic Light") {
                    let ticketData = await Sys.App.Services.GameService.aggregateQueryTickets([
                        {
                            $match: {
                                playerIdOfPurchaser: data.playerId.toString(),
                                gameId: data.gameId.toString(),
                                ticketColorType: "traffic-red",
                                ...(data.hallIds ? { hallId: { $in: data.hallIds } } : {})
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    hallId: "$hallId"
                                },
                                ticketCount: { $sum: 1 }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                hallId: "$_id.hallId",
                                ticketCount: 1
                            }
                        }
                    ])
                    console.log("🚀 ~ ticketData:***********", ticketData);
                    for (let ticket of ticketData) {
                        let ticktData = data.purchaseTicketTypes[0];
                        let ticketPrice = ticktData.ticketPrice * ticket.ticketCount;
                        await Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                            type: "cancel",
                            playerId: data.playerId,
                            hallId: ticket.hallId,
                            cancel: ticketPrice
                        });
                        await updatePlayerHallSpendingData({ playerId: data.playerId, hallId: ticket.hallId, amount: +ticketPrice, type: "normal", gameStatus: 2 });
                    }
                } else {
                    let ticketData = await Sys.App.Services.GameService.aggregateQueryTickets([
                        {
                            $match: {
                                playerIdOfPurchaser: data.playerId.toString(),
                                gameId: data.gameId.toString(),
                                ...(data.hallIds ? { hallId: { $in: data.hallIds } } : {})
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    hallId: "$hallId",
                                    ticketColorName: "$ticketColorName",
                                    ticketColorType: "$ticketColorType"
                                },
                                ticketCount: { $sum: 1 }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                hallId: "$_id.hallId",
                                ticketColorName: "$_id.ticketColorName",
                                ticketColorType: "$_id.ticketColorType",
                                ticketCount: 1
                            }
                        }
                    ])
                    console.log("🚀 ~ ticketData:***********", ticketData);
                    for (let ticket of ticketData) {
                        let ticktData = data.purchaseTicketTypes.find((t) => t.ticketName == ticket.ticketColorName);
                        let ticketPrice = 0;
                        if (ticket.ticketColorType == "large") {
                            let ticketCount = ticket.ticketCount / 3;
                            ticketPrice = ticktData.ticketPrice * ticketCount;
                        } else if (ticket.ticketColorType == "small") {
                            ticketPrice = ticktData.ticketPrice * ticket.ticketCount;
                        } else if (ticket.ticketColorType == "elvis") {
                            let ticketCount = ticket.ticketCount / 2;
                            ticketPrice = ticktData.ticketPrice * ticketCount;
                        } else if (ticket.ticketColorType == "traffic-red") {
                            let ticketCount = ticket.ticketCount;
                            ticketPrice = ticktData.ticketPrice * ticketCount;
                        } else {
                            ticketPrice = ticktData.ticketPrice * ticket.ticketCount;
                        }
                        await Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                            type: "cancel",
                            playerId: data.playerId,
                            hallId: ticket.hallId,
                            cancel: ticketPrice
                        });
                        await updatePlayerHallSpendingData({ playerId: data.playerId, hallId: ticket.hallId, amount: +ticketPrice, type: "normal", gameStatus: 2 });
                    }
                }
            }
            return true;
        } catch (error) {
            console.log("Error in updating daily transaction by stop game", error);
            return false;
        }
    }, 

    checkResumeAligibility: async function (req, res) {
        let keys = ["game_resume_success", "game_not_found_or_not_stopped", "something_went_wrong_please_try_again_later", "next_game_already_started_or_tickets_are_sold"];
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        const gameId = req.query.id;

        try {

            let game = await Sys.App.Services.GameService.getSingleGameData({ _id: gameId });
            if (!game) {
                return res.json({ eligible: false, message: translate.game_not_found_or_not_stopped });
            }

            let masterHallId = (req.session.details.hall.length > 0) ? req.session.details.hall[0].id : ""
            let startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            let endofDay = new Date();
            endofDay.setHours(23, 59, 59, 999);

            let query = {
                gameType: "game_1",
                status: "active",
                startDate: {
                    $gte: startOfDay,
                    $lte: endofDay
                },
                'otherData.scheduleId': game?.otherData?.scheduleId,
                parentGameId: game?.parentGameId,
                halls: { $in: [masterHallId] },
            };
            let scheduleGames = await Sys.App.Services.GameService.getGamesData(query, { subGames: 1, gameNumber: 1, gameName: 1, startDate: 1, ticketSold: 1, earnedFromTickets: 1, status: 1, gameMode: 1, stopGame: 1, otherData: 1, sequence: 1 });
            const sortedGames = [...scheduleGames].sort((a, b) => a.sequence - b.sequence);

            const stoppedGame = sortedGames.find(g => g._id.toString() === gameId);
            if (!stoppedGame || stoppedGame.stopGame === false) {
                return res.json({ eligible: false, message: translate.game_not_found_or_not_stopped });
            }

            const previousGames = sortedGames.filter(g => g.sequence < stoppedGame.sequence);
            const hasEligiblePreviousGame = previousGames.some(g =>
                (g.status === "active" || g.status === "running") && g.stopGame === false
            );
            
            if (hasEligiblePreviousGame) {
                return res.json({ eligible: true, message: translate.game_resume_success });
            }

            const nextPlayableGame = sortedGames.find(g => g.sequence > stoppedGame.sequence && g.stopGame === false);
            const isNextPlayableGameStarted = nextPlayableGame && (
                nextPlayableGame.status === "running" ||
                nextPlayableGame.ticketSold > 0
            );
          
            if (isNextPlayableGameStarted) {
                return res.json({ eligible: false, message: translate.next_game_already_started_or_tickets_are_sold });
            }
            return res.json({ eligible: true, message: translate.game_resume_success });


            // // Check if any subsequent game has started or has tickets sold
            // const nextGameStarted = nextGame.some(game =>
            //     game.startDate > stoppedGame.startDate &&  // Next game in sequence
            //     (game.ticketSold > 0 || game.status === 'active') // Started or tickets sold
            // );

            // if (nextGameStarted) {
            //     res.json({ eligible: false, message: translate.next_game_already_started_or_tickets_are_sold });
            // }

        } catch (error) {
            return res.json({ eligible: false, message: translate.something_went_wrong_please_try_again_later });
        }
    },
    resumeUpcomingGame: async function (req, res) {
        let keys = ["game_resume_success", "you_are_not_allowed_to_access_that_page", "something_went_wrong_please_try_again_later"];
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
        try {
            let hallId = (req.session.details.hall.length > 0) ? req.session.details.hall[0].id : "";
            if (req.session && req.session.details.role == 'agent' && hallId) {
                let game = await Sys.App.Services.GameService.getSingleGameData({ _id: req.body.id }, { status: 1, stopGame: 1, 'otherData.masterHallId': 1, parentGameId: 1 }, {});
                
                if (game && game.otherData.masterHallId == hallId) {
                    // Check if schedule is already stopped, if yes then send Error
                    let schedule = await Sys.App.Services.scheduleServices.getDailySingleSchedulesData({ _id: game.parentGameId }, { stopGame: 1 }, {});
                    if( !schedule ||  (schedule && schedule.stopGame == true) ){
                        return res.send({ status: "fail", message: translate.something_went_wrong_please_try_again_later });
                    } 
                    let updatedGame = await Sys.App.Services.GameService.findOneAndUpdateGameData({ _id: req.body.id, status: "active" }, { "$set": { "stopGame": false } });
                    if (updatedGame && updatedGame.stopGame == false) {
                        Sys.Io.of(Sys.Config.Namespace.Game1).emit('RefreshRoom', {});
                        Sys.Io.of(Sys.Config.Namespace.Game1).emit('adminRefreshRoom', {}); //.to(updatedGame._id)
                        Sys.Io.of('admin').emit('refreshSchedule', { scheduleId: updatedGame.parentGameId });
                        updatedGame?.halls.forEach(hall => {
                            Sys.Io.of('admin').to(hall).emit('refresh', { message: translate.game_resume_success });
                        });
                    }
                    return res.send({ status: "success", message: translate.game_resumed_successfully });
                } else if (game && game.otherData.masterHallId != hallId) {
                    return res.send({ status: "fail", message: translate.you_are_not_allowed_to_access_that_page });
                } else {
                    return res.send({ status: "fail", message: translate.something_went_wrong_please_try_again_later });
                }
            }
            return res.send({ status: "fail", message: translate.something_went_wrong_please_try_again_later });
        } catch (e) {
            console.log("Error in resuming upcoming game", e);
        }
    },
    editSettlement: async function (req, res) {
        let keys = [
            "you_are_not_allowed_to_edit_settlement",
            "something_went_wrong_please_try_again_later",
            "please_ensure_the_previous_agent_logs_out_before_doing_settlement",
            "settlement_data_update_successfully"
        ]
        let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language)
        try {
            if (req.session.details.role == 'agent') {
                let stringReplace = req.session.details.isPermission['Hall Account Report'];
                console.log("stringReplace---", stringReplace, stringReplace.indexOf("edit"))
                if (!stringReplace || stringReplace.indexOf("edit") == -1) {
                    console.log("not allowed")
                    return res.json({ status: "fail", message: translate.you_are_not_allowed_to_edit_settlement + "." })//'You are not allowed to Edit Settlement.' });
                }
            }

            let {
                inAmountMetronia, outAmountMetronia, totalAmountMetronia,
                inAmountOkBingo, outAmountOkBingo, totalAmountOkBingo,
                inAmountFranco, outAmountFranco, totalAmountFranco,
                inAmountOtium, outAmountOtium, totalAmountOtium,
                inAmountNorskTippingDag, outAmountNorskTippingDag,
                inAmountNorskTotalt, outAmountNorskTotalt, totalAmountNorskTotalt,
                inAmountNorskRikstotoDag, outAmountNorskRikstotoDag, totalAmountNorskRikstotoDag,
                inAmountNorskRikstotoTotalt, outAmountNorskRikstotoTotalt, totalAmountNorskRikstotoTotalt,
                inAmountRekvisita, totalAmountRekvisita,
                inAmountSellProduct, totalAmountSellProduct,
                outAmountBilag, totalAmountBilag,
                outAmountBank, totalAmountBank,
                inAmountTransferredByBank, totalAmountTransferredByBank,
                inAmountAnnet, outAmountAnnet, totalAmountAnnet,
                dailyBalanceAtStartShift, dailyBalanceAtEndShift, dailyBalanceDifference,
                settlementToDropSafe, withdrawFromtotalBalance, totalDropSafe,
                shiftDifferenceIn, shiftDifferenceOut, shiftDifferenceTotal,
                settlmentNote,
                settlementId,
                settlementHallID,
                imagesToDelete,
                originalSettlementDate
            } = req.body;
            let hallId, agentId;

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                hallId = req.session.details.hall[0].id;
                agentId = req.session.details.id;
            } else if (req.session.login && req.session.details.is_admin == 'yes') {
                hallId = settlementHallID;
            } else {
                return res.json({ status: "fail", message: 'Agent not found' });
            }

            let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, hallCashBalance: 1, otherData: 1 });
            if (hallsData && (req.session.details.is_admin == 'yes' || (hallsData.activeAgents && hallsData.activeAgents.length > 0))) {

                let originalSettlement = await Sys.App.Services.AgentServices.getSingleSettlementData({ _id: settlementId }, { shiftId: 1, hallId: 1, agentId: 1, date: 1, dailyBalanceAtStartShift: 1, dailyBalanceAtEndShift: 1, dailyBalanceDifference: 1, settlementToDropSafe: 1, withdrawFromtotalBalance: 1, totalDropSafe: 1, shiftDifferenceIn: 1, shiftDifferenceOut: 1, shiftDifferenceTotal: 1, billImages: 1 });
                console.log("originalSettlement---", originalSettlement)
                if (!originalSettlement) {
                    return res.json({ status: "fail", message: translate.something_went_wrong_please_try_again_later }) //"Something went wrong, please try again later." });
                }

                if (req.session.login && req.session.details.is_admin == 'yes') {
                    agentId = originalSettlement.agentId;
                } else {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        return res.json({ status: "fail", message: translate.please_ensure_the_previous_agent_logs_out_before_doing_settlement })// 'Please ensure the previous agent logs out before Doing Settlement.' });
                    }
                    if (req.session.details.role == "agent" && originalSettlement.agentId != agentId) {
                        return res.json({ status: "fail", message: translate.you_are_not_allowed_to_edit_settlement })// "You are not allowed to edit this settlement." });
                    }
                }
                let agentShiftId = originalSettlement.shiftId;
                //let index = hallsData.activeAgents.findIndex((e) => e.id == agentId);
                let agentShift = await Sys.App.Services.AgentServices.getSingleShiftData({ _id: agentShiftId, agentId: agentId, hallId: hallId }, { dailyBalance: 1, createdAt: 1, hallCashBalance: 1 }); //hallsData.activeAgents[index].shiftId
                if (!agentShift) {
                    return res.json({ status: "fail", message: translate.something_went_wrong_please_try_again_later }) //"Something went wrong, please try again later." });
                }

                let settlementDate = moment(agentShift.createdAt).format("DDMMYYYY")
                console.log("settlementDate---", settlementDate)
                if (originalSettlementDate && !moment(originalSettlementDate).startOf('day').isSame(moment(agentShift.createdAt).startOf('day'))) {
                    settlementDate = moment(originalSettlementDate).format("DDMMYYYY");
                }
                console.log("final settlement date", moment(originalSettlementDate).format("DDMMYYYY"), settlementDate)
                let billsArray = originalSettlement.billImages;

                imagesToDelete = JSON.parse(imagesToDelete);
                if (imagesToDelete) {
                    billsArray = billsArray.filter(image => !imagesToDelete.includes(image));
                    const basePath = path.join(__dirname, '../../public');

                    for (const image of imagesToDelete) {
                        const imagePath = path.join(basePath, image);
                        fs.unlink(imagePath, (err) => {
                            if (err) {
                                console.error('Error deleting file:', err);
                            }
                        });
                    }

                }
                console.log("billsArray---", billsArray, req.files)
                if (req.files && req.files.billImages) {
                    let billImages = Array.isArray(req.files.billImages) ? req.files.billImages : [req.files.billImages];

                    for (let i = 0; i < billImages.length; i++) {
                        let image = billImages[i];

                        let re = /(?:\.([^.]+))?$/;
                        let extension = re.exec(image.name)[1];
                        let randomNum = Math.floor(100000 + Math.random() * 900000);
                        let fileName = settlementDate + '_' + randomNum + '.' + extension;
                        // Use the mv() method to place the file somewhere on your server
                        image.mv('public/assets/settlement/' + fileName, function (err) {
                            if (err) {
                                console.log("Error uploading Bills")
                            }
                        });
                        let imagePath = '/assets/settlement/' + fileName;
                        billsArray.push(imagePath);
                    }
                }

                console.log("billsArray---", billsArray);
                let formData = {
                    inAmountMetronia: inAmountMetronia || 0,
                    outAmountMetronia: outAmountMetronia || 0,
                    totalAmountMetronia: totalAmountMetronia || 0,

                    inAmountOkBingo: inAmountOkBingo || 0,
                    outAmountOkBingo: outAmountOkBingo || 0,
                    totalAmountOkBingo: totalAmountOkBingo || 0,

                    inAmountFranco: inAmountFranco || 0,
                    outAmountFranco: outAmountFranco || 0,
                    totalAmountFranco: totalAmountFranco || 0,

                    inAmountOtium: inAmountOtium || 0,
                    outAmountOtium: outAmountOtium || 0,
                    totalAmountOtium: totalAmountOtium || 0,

                    inAmountNorskTippingDag: inAmountNorskTippingDag || 0,
                    outAmountNorskTippingDag: outAmountNorskTippingDag || 0,

                    inAmountNorskTotalt: inAmountNorskTotalt || 0,
                    outAmountNorskTotalt: outAmountNorskTotalt || 0,
                    totalAmountNorskTotalt: totalAmountNorskTotalt || 0,

                    inAmountNorskRikstotoDag: inAmountNorskRikstotoDag || 0,
                    outAmountNorskRikstotoDag: outAmountNorskRikstotoDag || 0,
                    totalAmountNorskRikstotoDag: totalAmountNorskRikstotoDag || 0,

                    inAmountNorskRikstotoTotalt: inAmountNorskRikstotoTotalt || 0,
                    outAmountNorskRikstotoTotalt: outAmountNorskRikstotoTotalt || 0,
                    totalAmountNorskRikstotoTotalt: totalAmountNorskRikstotoTotalt || 0,

                    inAmountRekvisita: inAmountRekvisita || 0,
                    totalAmountRekvisita: totalAmountRekvisita || 0,

                    inAmountSellProduct: inAmountSellProduct || 0,
                    totalAmountSellProduct: totalAmountSellProduct || 0,

                    outAmountBilag: outAmountBilag || 0,
                    totalAmountBilag: totalAmountBilag || 0,

                    outAmountBank: outAmountBank || 0,
                    totalAmountBank: totalAmountBank || 0,

                    inAmountTransferredByBank: inAmountTransferredByBank || 0,
                    totalAmountTransferredByBank: totalAmountTransferredByBank || 0,

                    inAmountAnnet: inAmountAnnet || 0,
                    outAmountAnnet: outAmountAnnet || 0,
                    totalAmountAnnet: totalAmountAnnet || 0,

                    dailyBalanceAtStartShift: dailyBalanceAtStartShift || 0,
                    dailyBalanceAtEndShift: dailyBalanceAtEndShift || 0,
                    dailyBalanceDifference: dailyBalanceDifference || 0,

                    settlementToDropSafe: settlementToDropSafe || 0,
                    withdrawFromtotalBalance: withdrawFromtotalBalance || 0,
                    totalDropSafe: totalDropSafe || 0,

                    shiftDifferenceIn: shiftDifferenceIn || 0,
                    shiftDifferenceOut: shiftDifferenceOut || 0,
                    shiftDifferenceTotal: shiftDifferenceTotal || 0,

                    settlmentNote,
                    billImages: billsArray,
                    hallId: hallId,
                    agentId: agentId,
                    shiftId: agentShift, //hallsData.activeAgents[index].shiftId,
                    hall: req.session.details.hall[0],
                    groupHall: hallsData.groupHall,
                    date: moment(settlementDate, "DDMMYYYY").set({ hour: moment().hour(), minute: moment().minute(), second: moment().second(), millisecond: moment().millisecond() }).toDate(), //(hallsData.otherData?.isPreviousDaySettlementPending == true) ? hallsData.otherData.previousDaySettlementDate : moment(agentShift.createdAt),
                    //'otherData.individualSettlementProfits': individualSettlementProfits,
                    //'otherData.agentName': req.session.details.name
                }

                let insertData = await Sys.App.Services.AgentServices.updateSettlementData({ _id: settlementId }, formData, { new: true });
                console.log("insertData---", insertData);

                // Transfer daily balance to total hall cash balance

                //update daily balance, cash safe and total hall cash balance

                // firsr consider shift difference: shiftDifferenceTotal
                let originalShiftDiffTotal = originalSettlement.shiftDifferenceTotal;
                if (originalShiftDiffTotal != shiftDifferenceTotal) {
                    let shiftDifference = null;

                    if (shiftDifferenceTotal > 0) {
                        shiftDifference = "credit";
                    } else if (shiftDifferenceTotal < 0) {
                        shiftDifference = "debit";
                    }
                    if (shiftDifference) {
                        let hallTransaction = {
                            category: shiftDifference,
                            amount: Math.abs(+shiftDifferenceTotal),
                            updatedAt: Date.now(),
                        }
                        //console.log("query---", {settlementId: mongoose.Types.ObjectId(settlementId) , shiftId: hallsData.activeAgents[index].shiftId, hallId: hallId, agentId: agentId, type: "SettlementDifference"})
                        await Sys.App.Services.HallServices.updateCashSafeData({ settlementId: mongoose.Types.ObjectId(settlementId), shiftId: agentShift, hallId: hallId, agentId: agentId, type: "SettlementDifference" }, hallTransaction);
                    }
                }

                // Now we need to update Total hall cash balance whatever is provided in settlement form
                let originalDailyBalanceAtEndShift = originalSettlement.dailyBalanceAtEndShift;
                if (originalDailyBalanceAtEndShift != dailyBalanceAtEndShift) {
                    console.log("original and new hall balance", originalDailyBalanceAtEndShift, dailyBalanceAtEndShift)
                    let setHallTotalBalanceAction = null;
                    let hallCashBalanceDiff = Math.abs(+parseFloat(originalDailyBalanceAtEndShift - dailyBalanceAtEndShift).toFixed(2));

                    if (originalDailyBalanceAtEndShift > dailyBalanceAtEndShift) {
                        setHallTotalBalanceAction = "debit";
                    } else if (originalDailyBalanceAtEndShift < dailyBalanceAtEndShift) {
                        setHallTotalBalanceAction = "credit";
                    } else {
                        console.log("there is no misatch of daily balance so no need to do any thing");
                    }
                    console.log("hallCashBalanceDiff and action", hallCashBalanceDiff, setHallTotalBalanceAction)
                    if (setHallTotalBalanceAction) {
                        let updatedHall = await Sys.App.Services.HallServices.updateHall(
                            { _id: hallId },
                            { $inc: { "hallCashBalance": setHallTotalBalanceAction == "debit" ? -hallCashBalanceDiff : hallCashBalanceDiff } },
                            { new: true }
                        );

                        let hallTransaction = {
                            transactionId: 'HTRN' + await Sys.Helper.bingo.ordNumFunction(Date.now()) + '' + Math.floor(100000 + Math.random() * 900000),
                            shiftId: agentShift, //hallsData.activeAgents[index].shiftId,
                            hallId: hallId,
                            agentId: agentId,
                            type: "SettlementEdit",
                            category: setHallTotalBalanceAction,
                            amount: Math.abs(+hallCashBalanceDiff),
                            previousBalance: (setHallTotalBalanceAction == "credit") ? +parseFloat(updatedHall.hallCashBalance - (Math.abs(+hallCashBalanceDiff))).toFixed(2) : +parseFloat(updatedHall.hallCashBalance + (Math.abs(+hallCashBalanceDiff))).toFixed(2),
                            afterBalance: +parseFloat(updatedHall.hallCashBalance).toFixed(2),
                            hall: req.session.details.hall[0],
                            groupHall: hallsData.groupHall,
                            settlementId: originalSettlement.id,
                            createdAt: Date.now(),
                        }
                        await Sys.App.Services.HallServices.insertCashSafeData(hallTransaction);
                    }
                }

                // update hall and agentShift dropSafe balance
                let originalSettlementToDropSafe = originalSettlement.settlementToDropSafe;
                if (originalSettlementToDropSafe != settlementToDropSafe) {
                    let dropsafeDiff = Math.abs(+parseFloat(originalSettlementToDropSafe - settlementToDropSafe).toFixed(2));
                    let category = null;
                    if (originalSettlementToDropSafe > settlementToDropSafe) {
                        category = "debit";
                    } else if (originalSettlementToDropSafe < settlementToDropSafe) {
                        category = "credit";
                    }

                    if (dropsafeDiff && Math.abs(dropsafeDiff) > 0 && category) {
                        let hallTransaction = {
                            shiftId: agentShift, // hallsData.activeAgents[index].shiftId,
                            hallId: hallId,
                            agentId: agentId,
                            typeOfTransaction: (category == "credit") ? "Add Hall Safe Balance" : "Deduct Hall Safe Balance",
                            action: category,
                            amount: Math.abs(+dropsafeDiff),
                            hall: req.session.details.hall[0],
                            groupHall: hallsData.groupHall,
                        }
                        await Sys.Helper.gameHelper.transferToDropSafe(hallTransaction);
                    }
                }

                if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                    let finalHall = await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $set: { "isSettled": false, 'otherData.isPreviousDaySettlementPending': false, controlDailyBalance: { dailyBalanceDiff: 0, hallCashBalanceDiff: 0 } } }, { new: true });
                    await Sys.App.Services.AgentServices.updateShiftData({ _id: agentShift, hallId: hallId, agentId: agentId }, { $set: { totalDailyBalanceIn: 0, totalCashIn: 0, totalCashOut: 0, toalCardIn: 0, totalCardOut: 0, sellingByCustomerNumber: 0, hallCashBalance: finalHall.hallCashBalance, hallDropsafeBalance: finalHall.hallDropsafeBalance, previousSettlement: { dailyBalanceAtStartShift: +dailyBalanceAtStartShift, dailyBalanceAtEndShift: +dailyBalanceAtEndShift, dailyBalanceDifference: +dailyBalanceDifference, settlementToDropSafe: +settlementToDropSafe, withdrawFromtotalBalance: +withdrawFromtotalBalance, shiftDifferenceTotal: +shiftDifferenceTotal, dailyBalance: agentShift.dailyBalance, hallCashBalance: hallsData.hallCashBalance } } }, { new: true });
                    await Sys.App.Services.HallServices.updateHall({ _id: hallId, "activeAgents.id": agentId }, { $set: { "activeAgents.$.totalDailyBalanceIn": 0, "activeAgents.$.totalCashIn": 0, "activeAgents.$.totalCashOut": 0, "activeAgents.$.toalCardIn": 0, "activeAgents.$.totalCardOut": 0, "activeAgents.$.sellingByCustomerNumber": 0, "activeAgents.$.hallCashBalance": finalHall.hallCashBalance, "activeAgents.$.hallDropsafeBalance": finalHall.hallDropsafeBalance } }, { new: true });
                } else {
                    await Sys.App.Services.AgentServices.updateShiftData({ _id: agentShift, hallId: hallId, agentId: agentId }, { $set: { settlement: { dailyBalanceAtStartShift: +dailyBalanceAtStartShift, dailyBalanceAtEndShift: +dailyBalanceAtEndShift, dailyBalanceDifference: +dailyBalanceDifference, settlementToDropSafe: +settlementToDropSafe, withdrawFromtotalBalance: +withdrawFromtotalBalance, shiftDifferenceTotal: +shiftDifferenceTotal, dailyBalance: agentShift.dailyBalance, hallCashBalance: hallsData.hallCashBalance } } }, { new: true });
                    await Sys.App.Services.HallServices.updateHall({ _id: hallId }, { $set: { "isSettled": true, 'otherData.isPreviousDaySettlementPending': false, controlDailyBalance: { dailyBalanceDiff: 0, hallCashBalanceDiff: 0 } } }, { new: true });
                }
                //send broadcast to admin
                module.exports.sendHallBalanceUpdateBroadcast(agentShift, hallId);

                return res.json({ status: "success", message: translate.settlement_data_update_successfully })// "Settlement Data updated Successfully." });
            } else {
                return res.json({ status: "fail", message: translate.something_went_wrong_please_try_again_later })// 'Something went wrong, please try again later.' });
            }
        } catch (e) {
            console.log("Error while adding daily balance :", e);
            return res.json({ status: "fail", message: translate.something_went_wrong_please_try_again_later }) //'Something went wrong, please try again later.' });
        }
    },

    /**
     * Rewards the Wheel of Fortune game winners with a manually specified amount.
     * Ensures proper authorization, game state, and fair distribution of rewards among winners.
     */
    wofGameReward: async function (req, res) {
        try {
            const { details, login } = req.session || {};
            const language = details?.language || "norwegian";
            const hall = details?.hall;

            if (!details || !Array.isArray(hall)) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) });
            }

            const { gameId, amount } = req.body;
            const hallId = hall[0]?.id;
            const { id: agentId, is_admin, role } = details;

            if (!gameId || !amount) {
                return res.json({ status: "fail", message: "Missing prize amount or game ID" });
            }

            const gameData = await Sys.App.Services.GameService.getSingleGameData(
                { _id: gameId },
                {
                    gameName: 1,
                    wofWinners: 1,
                    startDate: 1,
                    'otherData.minigameManualRewardStatus': 1,
                    'otherData.masterHallId': 1,
                    'otherData.minigameManualReward': 1,
                    'otherData.isMinigameFinished': 1
                }
            );

            if (!gameData) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["game_not_found"], language) });
            }

            const { wofWinners, startDate, otherData } = gameData;

            // Permission & condition checks
            if (!login || is_admin === 'yes' && role !== "agent" || otherData.masterHallId !== hallId || !otherData.minigameManualRewardStatus) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["not_allowed_to_perform_action"], language) });
            }

            if (otherData.minigameManualRewardStatus === "Success") {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["already_cashout_for"], language) });
            }

            if (moment().isAfter(moment(startDate), 'day')) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["you_can_only_cash_out_the_same_day_game_player"], language) });
            }

            if (!wofWinners?.length || !wofWinners.every(winner => winner.playerType === "Physical")) {
                return res.json({ status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) });
            }

            const agentWinningAmount = Math.round(amount / wofWinners.length);
            const gameBulkOps = [];
            const ticketBulkOps = [];

            for (const { ticketId, playerId, WinningAmount } of wofWinners) {
                const gameActualWinningAmount = (agentWinningAmount < WinningAmount) ? -(WinningAmount - agentWinningAmount) : (agentWinningAmount - WinningAmount) 
                
                if(gameActualWinningAmount == 0) continue;

                // Prepare bulk operation for game update
                gameBulkOps.push({
                    updateOne: {
                        filter: { _id: gameId },
                        update: {
                            $set: {
                                //'winners.$[current].wonAmount': agentWinningAmount,
                                //'wofWinners.$[current].WinningAmount': agentWinningAmount
                                'winners.$[winner].wonAmount': agentWinningAmount,
                                'wofWinners.$[wof].WinningAmount': agentWinningAmount
                            },
                            $inc: {
                                totalWinning: gameActualWinningAmount,
                                finalGameProfitAmount: -(gameActualWinningAmount)
                            }
                        },
                        arrayFilters: [
                            // { 'current.ticketId': ticketId, 'current.lineType': "Full House" }
                            { 'winner.ticketId': ticketId, 'winner.lineType': 'Full House' },
                            { 'wof.ticketId': ticketId }
                        ]
                    }
                });

                // Prepare bulk operation for ticket update
                ticketBulkOps.push({
                    updateOne: {
                        filter: { _id: ticketId, gameId },
                        update: {
                            $set: {
                                wofWinners: { playerId, WinningAmount: agentWinningAmount, ticketId },
                                'winningStats.lineTypeArray.$[current].wonAmount': agentWinningAmount,
                                'otherData.winningStats.$[current].wonAmount': agentWinningAmount
                            },
                            $inc: {
                                totalWinningOfTicket: gameActualWinningAmount,
                                'winningStats.finalWonAmount': gameActualWinningAmount,
                            }
                        },
                        arrayFilters: [{ 'current.lineType': "Full House" }]
                    }
                });
            }
            gameBulkOps.push({
                updateOne: {
                    filter: { _id: gameId },
                    update: { $set: { 'otherData.minigameManualReward': +amount } }
                }
            });
            // Execute bulk operations in parallel
            await Promise.all([
                gameBulkOps.length && Sys.App.Services.GameService.bulkWriteGameData(gameBulkOps),
                ticketBulkOps.length && Sys.App.Services.GameService.bulkWriteTicketData(ticketBulkOps)
            ]);
            
            console.log("minigameManualReward, isMinigameFinished", gameData.otherData?.minigameManualReward, gameData.otherData?.isMinigameFinished);
            if(!gameData.otherData?.minigameManualReward && !gameData.otherData?.isMinigameFinished) {
                const updatedGameData = await Sys.App.Services.GameService.getSingleGameData(
                    { _id: gameId },
                    {
                        gameName: 1,
                        halls: 1,
                        parentGameId: 1,
                        winners: 1,
                        withdrawNumberArray: 1,
                    }
                );
                
                const adminResult = await sendWinnersScreenToAdmin(gameId, updatedGameData.gameName, updatedGameData.winners, updatedGameData.withdrawNumberArray.length, true, true);
                // Sys.Io.of(Sys.Config.Namespace.Game1).to(gameId).emit('stopSpinWheel', {
                //     gameId: gameId,
                //     amount: amount,
                //     miniGameType: "wheelOfFortune",
                //     winningScreen: adminResult
                // });
                setTimeout(async function () {
                    try {
                        console.log("complete wof game as winning amount added by master agent");
                        nextGameCountDownStart(updatedGameData.halls, updatedGameData.parentGameId, 0);
                        await Sys.Game.Game1.Services.GameServices.updateGame({ _id: gameId }, {
                            $set: {
                                'otherData.isMinigameFinished': true, 
                                'otherData.gameSecondaryStatus': 'finish',
                                'otherData.miniGamestartTimeMs': (new Date()).getTime(),
                            }
                        });

                        refreshGameWithoutCountDown(gameId, updatedGameData.halls, 0, updatedGameData.parentGameId);
                        Sys.Io.of('admin').emit('refreshSchedule', {scheduleId:  updatedGameData.parentGameId});
                    } catch (err) {
                        console.error("Error in setTimeout for WOF minigame finish:", err);
                    }
                },10000);
            }

            return res.json({
                status: "success",
                message: await Sys.Helper.bingo.getSingleTraslateData(["winning_amount_add_successfully"], language)
            });

        } catch (e) {
            console.error("Error in rewarding wheel of fortune winning", e);
            return res.json({
                status: "fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req?.session?.details?.language || "en")
            });
        }
    },

    agentGameStopOption: async function(req, res) {
        try {
            const { action, gameId, refundHallId } = req.body;
            const language = req.session.details?.language || "norwegian";
            const hallId = req.session.details?.hall?.[0]?.id;
            let result;
            
            switch(action) {
                case 'stop_game_without_refund':
                    result = await stopGameWithoutRefund({gameId, hallId, language});
                    break;
                    
                case 'stop_game_and_refund':
                    result = await stopGameAndRefundAllHalls({gameId, hallId, language});
                    break;
                    
                case 'stop_game_hall':
                    if (!hallId) {
                        return res.json({
                            status: 'error',
                            message: 'Hall ID is required'
                        });
                    }
                    result = await stopGameAndRefundSingleHalls({gameId, hallId, language, refundHallId });
                    break;
                    
                default:
                    return res.json({
                        status: 'error',
                        message: 'Invalid action'
                    });
            }
            
            if (result.success) {
                return res.json({
                    status: 'success',
                    message: await Sys.Helper.bingo.getSingleTraslateData([result.message], language)
                });
            } else {
                return res.json({
                    status: 'error',
                    message: result.isTranslated ? result.message : await Sys.Helper.bingo.getSingleTraslateData([result.message], language)
                });
            }
            
        } catch (error) {
            console.log("Error in stopGameOption:", error);
            return res.json({
                status: 'error',
                message: 'Internal server error'
            });
        }
    },

    getAgentsGroupHalls: async function(req, res) {
        try {
            const hallId = req.session.details?.hall?.[0]?.id;
            const startDate = new Date();
            const endDate = new Date();
            startDate.setHours(0, 0, 0);
            endDate.setHours(23, 59, 59);
            const ongoingGame = await Sys.Game.AdminEvents.Services.GameServices.getGameData(
                {
                    gameType: 'game_1',
                    $or: [{
                        "status": "running",
                    }, {
                        "status": "finish",
                        "otherData.gameSecondaryStatus": "running",
                    }],
                    halls: hallId,
                    startDate: {
                        $gte: startDate,
                        $lte: endDate
                    }
                }, {
                    select: { groupHalls: 1 }
                }
            );
            
            if(ongoingGame?.groupHalls){
                let myGroupHalls = getMyGroupHalls(ongoingGame?.groupHalls, hallId);  
                return res.json({
                    status: 'success',
                    halls:  myGroupHalls.filter(hall => hall.status === "active") // only send active hall, don't include stopped halls 
                });
            }
            return res.json({
                status: 'fail',
                halls:  []
            });
            
        } catch (error) {
            console.log("Error in getAgentsGroupHalls:", error);
            return res.json({
                status: 'error',
                message: 'Internal server error'
            });
        }
    },


}

function isObjectNonEmpty(obj) {
    if (obj && typeof obj === 'object') {
        return Object.keys(obj).length > 0;
    }
    return false;
}


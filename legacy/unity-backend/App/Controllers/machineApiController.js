const Sys = require('../../Boot/Sys');
const moment = require('moment');
const axios = require('axios');
const https = require('https');
const exactMath = require('exact-math');
const config = Sys.Config.App[Sys.Config.Database.connectionType];
const { sql, poolPromise } = require('../../Config/mssql');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { isPlayerBlockedFromGame } = require('../../gamehelper/player_common.js');
const { getPlayerIp } = require('../../gamehelper/all.js');

module.exports = {
    // New API by considering the code reusablity    
    ticketStatusMetronia: async function (data) {
        try {
            // Get the values from the request body
            const { ticketNumber, roomId, language } = data;
                 
            // Call to the third-party API
            const response = await axios.post(
                `${config.metroniaApiURL}/status-ticket`,
                { 
                    ticket: ticketNumber, 
                    room_id: roomId
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.metroniaApiToken}`, // Include the Bearer Token
                    },
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false, // Ignore SSL certificate validation
                    }),
                }
            );
            console.log("ticket status response---", response.data);
            if(response && response.data){
                 // Send the response back to the client
                if (response.data.error === 0) {
                    return {
                        status:"success",
                        result: {
                            balance: (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
                            ticketStatus: response.data.enabled,
                            isReserved: response.data.terminal
                        }
                    };
                }
                return{
                    status:"fail",
                    message: `${response.data.error_str}`,
                    stausCode: response.status || 500
                };
            }
            return {
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language),
                stausCode: 500
            };
        } catch (e) {
            console.log("error", e)
            return {
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], data.language),
                stausCode: 500
            };
        }
    },

    // get today number so far
    getNumbersOfToday: async function(req, res){
        try{
            const { machineName } = req.body;
            let keys = [
                "agent_not_found",
                "please_ensure_previous_agent_logs_out",
                "previous_day_settlement_pending",
                "something_went_wrong",
                "you_are_not_allowed_to_perform_this_operation",
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                        return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
                    }

                  
                    // Get today's start and end date
                    const startOfDay = moment().startOf('day').toDate();  // Start of today (00:00:00)
                    const endOfDay = moment().endOf('day').toDate();      // End of today (23:59:59)

                    const query = [
                        {
                            // Match documents with hallId and machineName as well as today's date range
                            $match: {
                                machineName: machineName,
                                hallId: hallId,  
                                createdAt: {      
                                    $gte: startOfDay,
                                    $lt: endOfDay
                                }
                            }
                        },
                        {
                            // Project only necessary fields to reduce document size
                            $project: {
                                totalBalanceAdded: 1,
                                balance: 1,
                                isClosed: 1
                            }
                        },
                        {
                            // Calculate inAmount and outAmount
                            $project: {
                                inAmount: "$totalBalanceAdded",  // Directly take totalBalanceAdded as inAmount
                                outAmount: {
                                    $cond: {
                                        if: { $eq: ["$isClosed", true] },
                                        then: "$balance", // If isClosed is true, consider balance as outAmount
                                        else: 0           // Otherwise, it's 0 for outAmount
                                    }
                                }
                            }
                        },
                        {
                            // Group to calculate total inAmount and outAmount
                            $group: {
                                _id: null,  // You can group by other fields if needed
                                totalIn: { $sum: "$inAmount" },
                                totalOut: { $sum: "$outAmount" }
                            }
                        }
                    ]
                    
                    let response = await Sys.App.Services.slotmachineServices.aggregateQuery(query);

                    let result = { totalIn: 0, totalOut: 0 };
                    if(response && response.length > 0){
                        result = {
                            totalIn: response[0].totalIn, 
                            totalOut: response[0].totalOut
                        }
                    }
                    return res.json({
                        status: "success",
                        //message: translate.close_all_tickets_success,
                        result: result
                    });
                    
                } else {
                    return res.json({ status: "fail", message: translate.agent_not_found });
                }
            }else{
                return res.status(500).json({
                    status:"fail",
                    message: translate.you_are_not_allowed_to_perform_this_operation
                });
            }
        }catch(e){
            console.log("Error in getting numbers of today", e)
            return res.status(500).json({
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
            });
        }
    },

    // create ticket
    createTicketDb: async function (data) {
        try {
            const { machineName, roomId, ticketNumber, balance, ticketId, playerId, username, customerNumber, agentId, hallId, hall, groupHall, agentName, playerAfterBalance, paymentType, userType, language, shiftId, uniqueTransaction } = data;
            
            // deduct player wallet
            let player = null;
            if (paymentType === "customerNumber") {
                player = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, { $inc: { walletAmount: -balance } });
            }
            

            const action = "add"; // add action is for agent and for player it is opposite
            let ticket = await Sys.App.Services.slotmachineServices.insertData({
                totalBalanceAdded: balance,
                machineName,
                roomId,
                ticketNumber,
                balance,
                ticketId,
                playerId,
                username,
                customerNumber,
                hallId,
                uniqueTransaction,
                otherData: {
                    shiftId: shiftId,
                    hall: hall,
                    groupHall: groupHall,
                    agentId: agentId,
                    agentName: agentName
                }
            });

        
            let transaction = {
                machineName: machineName,
                playerId: (userType == "Physical") ? agentId : playerId,
                username: (userType == "Physical") ? agentName : username,
                agentId: agentId,
                hallId: hallId,
                amount: +balance,
                paymentType: paymentType,
                agentName: agentName,
                operation: action,
                action: (action == "add") ? "credit" : "debit",
                typeOfTransaction: `${machineName} Ticket Purchase`,
                hall: hall,
                groupHall: groupHall,
                userType: userType,
                playerAfterBalance: player?.walletAmount || playerAfterBalance,
                machineTicketId: ticket.id,
                machineTicketNumber: ticketNumber
            };

            try {
                let trResponse = await Sys.Helper.gameHelper.machineApiTransactionsByAgent(transaction);
                console.log("trResponse of transfer money by hall", trResponse);
                if (trResponse && trResponse.status == "success") {
                    return { status: "success", dailyBalance: trResponse.dailyBalance, paymentType: paymentType, userwallet: trResponse.userwallet };
                }
                return { status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) };
            } catch (error) {
                console.error('Error during transfer:', error);
                return { status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) };
            }
        } catch (e) {
            console.log("ee---", e)
            return {
                status:"fail",
                message: 'Something Went Wrong',
            };
        }
    },

    // add balance to ticket
    addBalanceToTicketDb: async function (data) {
        try {console.log("addBalanceToTicketDb", data)
            const { machineName, roomId, ticketNumber, ticketId, balance, playerId, username, agentId, hallId, hall, groupHall, agentName, playerAfterBalance, paymentType, userType, language, addedAmount } = data;
            
            // deduct player wallet
            let player = null;
            if (paymentType === "customerNumber") {
                player = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, { $inc: { walletAmount: -addedAmount } });
            }
            
            const action = "add"; // add action is for agent and for player it is opposite
            await Sys.App.Services.slotmachineServices.updateData(
                {ticketNumber: ticketNumber, _id: ticketId, roomId: roomId, machineName: machineName},
                {
                    $inc: { totalBalanceAdded: addedAmount},
                    $set: { balance: balance }  //playerId: playerId, username: username, userType: userType
                }
            )

            let transaction = {
                machineName: machineName,
                playerId: (userType == "Physical") ? agentId : playerId,
                username: (userType == "Physical") ? agentName : username,
                agentId: agentId,
                hallId: hallId,
                //fianlTicketBalance: +balance,  //No need to pass, This is the final ticket balance
                amount: +addedAmount, 
                paymentType: paymentType,
                agentName: agentName,
                operation: action,
                action: (action == "add") ? "credit" : "debit",
                typeOfTransaction: `${machineName} Add To Ticket`,
                hall: hall,
                groupHall: groupHall,
                userType: userType,
                playerAfterBalance: player?.walletAmount || playerAfterBalance,
                machineTicketId: ticketId,
                machineTicketNumber: ticketNumber
            };

            try {
                let trResponse = await Sys.Helper.gameHelper.machineApiTransactionsByAgent(transaction);
                console.log("trResponse of transfer money by hall", trResponse);
                if (trResponse && trResponse.status == "success") {
                    return { status: "success", dailyBalance: trResponse.dailyBalance, paymentType: paymentType, userwallet: trResponse.userwallet };
                }
                return { status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) };
            } catch (error) {
                console.error('Error during transfer:', error);
                return { status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) };
            }
        } catch (e) {
            console.log("erorro---", e)
            return {
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language)
            };
        }
    },

    // cancel ticket form db
    cancelTicketDb: async function (data) {
        try {console.log("cancelTicketDb", data)
            const { machineName, roomId, ticketNumber, ticketId, balance, playerId, username, agentId, hallId, hall, groupHall, agentName, playerAfterBalance, paymentType, userType, language } = data;
            const action = "deduct";  // deduct action is for agent and for player it is opposite
            
            // deposit remaining balance of player to his account if player is registered and paymentType is customerNumber
            let player = null;
            if(playerId && paymentType == "customerNumber" && userType != "Physical"){
               player = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, { $inc: { walletAmount: balance } });
            }

            const updatedData = [
                {
                    $set: {
                        balance: balance,
                        isClosed: true,
                        profit: { $subtract: ["$totalBalanceAdded", balance] },
                    }
                }
            ];
            await Sys.App.Services.slotmachineServices.updateOneData(
                {ticketNumber: ticketNumber, _id: ticketId, roomId: roomId, machineName: machineName},
                updatedData
            )

            let transaction = {
                machineName: machineName,
                playerId: (userType == "Physical") ? agentId : playerId,
                username: (userType == "Physical") ? agentName : username,
                agentId: agentId,
                hallId: hallId,
                amount: +balance, 
                paymentType: paymentType,
                agentName: agentName,
                operation: action,
                action: (action == "add") ? "credit" : "debit",
                typeOfTransaction: `${machineName} Close Ticket`,
                hall: hall,
                groupHall: groupHall,
                userType: userType,
                playerAfterBalance: player?.walletAmount || playerAfterBalance,
                machineTicketId: ticketId,
                machineTicketNumber: ticketNumber
            };

            try {
                let trResponse = await Sys.Helper.gameHelper.machineApiTransactionsByAgent(transaction);
                console.log("trResponse of cancelTicketDb", trResponse);
                if (trResponse && trResponse.status == "success") {
                    return { status: "success", dailyBalance: trResponse.dailyBalance, paymentType: paymentType, userwallet: trResponse.userwallet };
                }
                return { status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) };
            } catch (error) {
                console.error('Error during cancelTicketDb :', error);
                return { status: "fail", message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language) };
            }
        } catch (e) {
            return {
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], language)
            };
        }
    },

    // createTicket for all the machines
    createTicketOfMachines: async function (req, res) {
        try {
            // Get the values from the request body
            let { amount, playerId, username, paymentMethod, paymentType = paymentMethod, machineName } = req.body;  // paymentType will be card/cash/customerNumber
            
            // Translation keys for dynamic messages
            let keys = [
                "agent_not_found",
                "please_ensure_previous_agent_logs_out",
                "previous_day_settlement_pending",
                "something_went_wrong",
                "Insufficient_balance",
                "invalid_input_should_be_number",
                "ticket_create_success",
                "player_not_found",
                "decimal_not_allowed",
                "amount_should_be_between_1_1000",
                "player_blocked_admin"
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            
            const ticketAmount = +amount;
            // Check if the value is a decimal
            if (ticketAmount % 1 !== 0) {
                return res.json({
                    status: "fail",
                    message: translate.decimal_not_allowed,
                });
            }
            const finalAmount = +exactMath.mul(ticketAmount, 100).toFixed(2);
            // Input validation
            if (typeof finalAmount !== 'number' || isNaN(finalAmount) || ticketAmount < 1 || ticketAmount > 1000) {
                return res.json({
                    status: "fail",
                    message: translate.amount_should_be_between_1_1000,
                });
            }
            if(!playerId){
                return res.json({
                    status: "fail",
                    message: translate.player_not_found,
                });
            }

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                        return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
                    }
                    // Get player data
                    let query = {
                        _id: playerId,
                        'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
                        userType: "Online",
                        // $or: [
                        //     { customerNumber: isNaN(Number(username)) ? null : Number(username) },
                        //     { username: username }
                        // ]
                    };
                    const player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1, customerNumber: 1, walletAmount: 1, userType: 1, hall: 1, blockRules: 1 });
                    if(!player){
                        return res.json({ status: "fail", message: translate.player_not_found });
                    }
                        
                    if(player.username != username && player.customerNumber != username){
                        return res.json({
                            status: "fail",
                            message: translate.something_went_wrong,
                        });
                    }

                    // check if player is blocked from game
                    const isPlayerBlocked = await isPlayerBlockedFromGame({
                        hallId: player.hall.id,
                        playerIp: null,
                        gameType: machineName,
                        blockRules: player?.blockRules,
                    });

                    if (isPlayerBlocked) {
                        return res.json({
                            status: "fail",
                            message: translate.player_blocked_admin,
                        });
                    }

                    if(player.walletAmount < ticketAmount){
                        return res.json({
                            status: "fail",
                            message: translate.Insufficient_balance,
                        });
                    }
                    
                    const userType = player?.userType ?? 'Physical';
                    let transaction = generateUniqueRandomNumber();  // Generate a unique transaction ID
                    
                    let response;
                    if(machineName == "Metronia"){
                        transaction = uuidv4();
                        response = await module.exports.createMetroniaAPI({finalAmount, transaction});
                    }else if(machineName == "OK Bingo"){
                        response = await module.exports.createOkBingoAPI({ticketAmount, transaction, commandId: 1});
                    }
                    console.log("create ticket response---", response);
                    // Check if ticketResponse is valid (not null, undefined, or empty)
                    if (!response || Object.keys(response).length === 0) {
                        return res.json({
                            status: "fail",
                            message: translate.something_went_wrong
                        });
                    }
                    if (response.error === 0) {
                        const dbResponse = await module.exports.createTicketDb({
                            machineName: machineName, //"Metronia",
                            roomId: response.room_id,
                            ticketNumber: response.ticket,
                            balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                            ticketId: response.ticket_id,
                            playerId: playerId,
                            username: player?.username || "",
                            customerNumber: player?.customerNumber || "",
                            playerAfterBalance: player?.walletAmount ?? 0, //player?.walletAmount || (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
                            paymentType: paymentType,
                            agentId: agentId,
                            hallId: hallId,
                            userType: userType,
                            language: req.session.details.language,
                            hall: req.session.details.hall[0],
                            groupHall: hallsData.groupHall,
                            agentName: req.session.details.name,
                            shiftId: req.session.details.shiftId,
                            uniqueTransaction: transaction
                        });
                        let result = {
                            roomId: response.room_id,
                            ticketNumber: response.ticket,
                            balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                            ticketId: response.ticket_id,
                            machineName: machineName,
                        }
                        console.log("dbResponse----", dbResponse)
                        if(dbResponse && dbResponse.status == "success"){
                            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                                type: "deposit",
                                playerId: playerId,
                                hallId: hallId,
                                deposit: ticketAmount
                            });
                            if (paymentType === "Cash") {
                                req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2)
                            }
                            result.dailyBalance =  dbResponse.dailyBalance;
                            result.paymentType = paymentType;
                        }   
                        return res.json({
                            status:"success",
                            result: result,
                            message: translate.ticket_create_success,
                        });
                    }else{
                        return res.json({
                            status:"fail",
                            message: response.error_str || translate.something_went_wrong,
                        });
                    }
                    
                } else {
                    return res.json({ status: "fail", message: translate.agent_not_found });
                }
            }
        
        } catch (e) {
            console.log("Error in createTicketOfMachines", e);
            return res.status(500).json({
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
            });
        }
    },

    createMetroniaAPI: async function(data) {
        try {
            const {finalAmount, transaction} = data;
            const response = await axios.post(
                `${config.metroniaApiURL}/create-ticket`,
                { 
                    amount: +finalAmount, 
                    transaction: transaction.toString() 
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.metroniaApiToken}`,
                    },
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false, // Ignore SSL certificate validation
                    }),
                }
            );

            // Check if the response is valid 
            if (!response || !response.data) {
                throw new Error("Empty or invalid response from API");
            }

            return response.data;
        } catch (e) {
            console.error("Error in createMetroniaAPI:", e);
            throw e; // Re-throw error to be handled by the caller
        }
    },

    createOkBingoAPI: async function(data) {
        try {
            const { roomId, ticketNumber, ticketAmount, transaction, commandId} = data;
            console.log("data---", roomId, ticketNumber, ticketAmount, transaction, commandId)
            const bingoId = (roomId) ? roomId: 247;
            const print = 0;
            let parameter = "";
            if(commandId == 1){
                parameter = `${transaction};;${ticketAmount};${print}`;
            }else if(commandId == 2){
                parameter = `${transaction};${ticketNumber};${ticketAmount};${print}`;
            }else if(commandId == 5){
                parameter = `${transaction};${ticketNumber}`;
            }else if(commandId == 3){
                parameter = `${transaction};${ticketNumber}`;
            }else if(commandId == 11){
                parameter = `NULL`;
            }
            console.log("commandID---", commandId, parameter);
           
            // Insert into COM3
            const pool = await poolPromise;
            if (!pool || !pool.connected) {
                throw new Error("Database Error: Server is Down");
            } 
            const insertQuery = `
                INSERT INTO COM3 (BingoID, FromSystemID, ToSystemID, ComandID, Parameter)
                OUTPUT INSERTED.*
                VALUES (@BingoID, @FromSystemID, @ToSystemID, @ComandID, @Parameter)
            `;
            const insertResult = await pool.request()
                .input("BingoID", sql.Int, bingoId)
                .input("FromSystemID", sql.Int, 0)
                .input("ToSystemID", sql.Int, 1)
                .input("ComandID", sql.Int, commandId)
                .input("Parameter", sql.VarChar, parameter)
                .query(insertQuery);

            if (!insertResult.recordset || insertResult.recordset.length === 0) {
                console.error("Insertion failed: No data returned from the insert query.");
                //throw new Error("Insertion failed: No data returned from the insert query");
                return null;
            }
    
            const insertedRecord = insertResult.recordset[0];
            console.log("Inserted Record:", insertedRecord);

             // Step 2: Poll the database for the new record
            const maxAttempts = 10;
            const interval = 1000; // 1 second
            let attempts = 0;
    
            const pollForRecord = async () => {
                const selectQuery = `
                    SELECT TOP 1 * FROM COM3
                    WHERE ComID > @ComID 
                    AND BingoID = @BingoID 
                    AND FromSystemID = @FromSystemID 
                    AND ToSystemID = @ToSystemID 
                    AND ComandID = @ComandID 
                    AND Parameter LIKE @Parameter
                `;
    
                const selectResult = await pool.request()
                    .input("ComID", sql.Int, insertedRecord.ComID)
                    .input("BingoID", sql.Int, bingoId)
                    .input("FromSystemID", sql.Int, 1)
                    .input("ToSystemID", sql.Int, 0)
                    .input("ComandID", sql.Int, commandId + 100)
                    .input("Parameter", sql.VarChar, `%${insertedRecord.ComID}%`)
                    .query(selectQuery);
    
                if (selectResult.recordset && selectResult.recordset.length > 0) {
                    const record = selectResult.recordset[0];
                    console.log("Record Found:", record);
                    if (record && record.Parameter) {
                        const parts = record.Parameter.split(';');
                        console.log("parts---", parts)
                        const comId = parts[0]; 
                        const ticketNumber = parts[1]; 
                        const balance = parts[2]; 
                        const newBalance = parts[3];
                        const expiryDate = parts[4];
                        const errorNumber = +parts[5];
                        const errorDescription = parts[6];
                        if(comId != insertedRecord.ComID){
                            console.error("No valid Response returned.");
                            //throw new Error("No valid Response returned");
                            return null;
                        }
                        if(errorNumber){
                            return {
                                error: (errorNumber > 0 ) ? errorNumber: 1,
                                error_str: errorDescription
                            };
                        }
                        return {
                            error: 0,
                            room_id: bingoId,
                            ticket: ticketNumber,
                            balance:(commandId == 3) ? +exactMath.mul(balance, 100).toFixed(2)  : +exactMath.mul(newBalance, 100).toFixed(2), // multily by 100 because it will be divided in response
                            ticket_id: ticketNumber,
                        };
                    } else {
                        //throw new Error("The first record is empty.");
                        return null;
                    }
                }
    
                if (attempts < maxAttempts) {
                    attempts++;
                    console.log(`Polling attempt ${attempts}...`);
                    return new Promise(resolve => {
                        setTimeout(async () => {
                            resolve(await pollForRecord()); // Wait for the next polling attempt
                        }, interval);
                    });
                } else {
                    console.warn("Polling timed out: No record found after maximum attempts.");
                    //throw new Error("Polling timed out: No record found after maximum attempts.");
                    return null;
                }
            };
    
            return await pollForRecord(); // Start and wait for polling to complete
        } catch (e) {
            console.error("Error in createOkBingoAPI:", e);
            throw e; // Re-throw error to be handled by the caller
        }
    },

    // add balance to all machine tickets
    addBalanceToMachineTickets: async function (req, res) {
        try {
            // Get the values from the request body
            let { amount, ticketNumber, paymentMethod, playerId, paymentType = paymentMethod, machineName } = { ...req.body, ticketNumber: +req.body.ticketNumber };
            
            // Translation keys for dynamic messages
            let keys = [
                "agent_not_found",
                "please_ensure_previous_agent_logs_out",
                "previous_day_settlement_pending",
                "user_not_found",
                "something_went_wrong",
                "ticket_record_not_found",
                "ticket_already_closed",
                "you_are_not_allowed_to_perform_this_operation",
                "ticket_add_balance_success",
                "ticket_not_belog_to_user",
                "provide_ticket_number",
                "Insufficient_balance",
                "decimal_not_allowed",
                "player_not_found",
                "amount_should_be_between_1_1000",
                "player_blocked_admin"
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            const ticketAmount = +amount;
            // Check if the value is a decimal
            if (ticketAmount % 1 !== 0) {
                return res.json({
                    status: "fail",
                    message: translate.decimal_not_allowed,
                });
            }
            const finalAmount = +exactMath.mul(amount, 100).toFixed(2);
            // Input validation
            if (typeof finalAmount !== 'number' || isNaN(finalAmount) || ticketAmount < 1 || ticketAmount > 1000) {
                return res.json({
                    status: "fail",
                    message: translate.amount_should_be_between_1_1000,
                });
            }

            if(!ticketNumber){
                return res.json({
                    status: "fail",
                    message: translate.provide_ticket_number,
                });
            }

            if(!playerId){
                return res.json({
                    status: "fail",
                    message: translate.player_not_found,
                });
            }

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                        return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
                    }

                    let machineTicket = await Sys.App.Services.slotmachineServices.getSingleData({machineName: machineName, hallId: hallId, ticketNumber: ticketNumber }, {playerId: 1, balance: 1, isClosed: 1, roomId: 1, uniqueTransaction: 1});
                    console.log("machineTicket---", machineTicket)
                    if(!machineTicket){
                        return res.json({
                            status: "fail",
                            message: translate.ticket_record_not_found,
                        });
                    }
                    if(machineTicket.isClosed == true){
                        return res.json({
                            status: "fail",
                            message: translate.ticket_already_closed,
                        });
                    }
                   
                    // Get player info
                    let player = null;
                    if(machineTicket.playerId && playerId && machineTicket.playerId != playerId ){ //&& paymentType == "customerNumber"
                        return res.json({
                            status: "fail",
                            message: translate.ticket_not_belog_to_user,
                        });
                    }

                    if(machineTicket.playerId || playerId){
                        playerId = machineTicket.playerId;
                        let query = {
                            'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
                            userType: "Online",
                           _id: playerId
                        };
                        player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1, customerNumber: 1, walletAmount: 1, userType: 1, hall: 1, blockRules: 1 });
                        
                        if(!player){
                            return res.json({ status: "fail", message: translate.user_not_found });
                        }
                    }

                    // check if player is blocked from game
                    const isPlayerBlocked = await isPlayerBlockedFromGame({
                        hallId: player.hall.id,
                        playerIp: null,
                        gameType: machineName,
                        blockRules: player?.blockRules,
                    });

                    if (isPlayerBlocked) {
                        return res.json({
                            status: "fail",
                            message: translate.player_blocked_admin,
                        });
                    }

                    // check for player wallet
                    if(player && paymentType == "customerNumber"){
                        if(player.walletAmount < ticketAmount){
                            return res.json({
                                status: "fail",
                                message: translate.Insufficient_balance,
                            });
                        }
                    }

                    const userType = player?.userType ?? 'Physical';
                    const roomId = machineTicket.roomId; 
                    let transaction = generateUniqueRandomNumber();  // Generate a unique transaction ID
                    let response;
                    if(machineName == "Metronia"){
                        transaction = uuidv4();
                        // fetch ticket status and if it is closed revert amount to his account for close ticket
                        const getLatestTicketStatus  = await module.exports.ticketStatusMetronia({ticketNumber, roomId, language: req.session.details.language });
                        console.log("getLatestTicketStatus---", getLatestTicketStatus)
                        if (!getLatestTicketStatus || getLatestTicketStatus.status === "fail") {
                            return res.status(getLatestTicketStatus ? 200 : 500).json({
                                status: "fail",
                                message: getLatestTicketStatus?.message || translate.something_went_wrong,
                            });
                        }
                        
                        if (getLatestTicketStatus.result?.ticketStatus === false) {
                            console.log("This ticket is closed");
                            // Need to add revert amount as ticket is already closed but we need to rever player amount
                            return res.json({
                                status: "fail",
                                message: translate.ticket_already_closed,
                            });
                        }
                        response = await module.exports.addToMetroniaAPI({ roomId, ticketNumber, finalAmount, transaction });
                    }else if(machineName == "OK Bingo"){
                        response = await module.exports.createOkBingoAPI({ roomId, ticketNumber, ticketAmount, transaction: machineTicket.uniqueTransaction, commandId: 2 });
                    }

                    console.log("add to ticket response---", response);
                    // Check if ticketResponse is valid (not null, undefined, or empty)
                    if (!response || Object.keys(response).length === 0) {
                        return res.json({
                            status: "fail",
                            message: translate.something_went_wrong
                        });
                    }
                    if (response.error === 0) {
                        const dbResponse = await module.exports.addBalanceToTicketDb({
                            machineName: machineName, //"Metronia",
                            roomId: roomId,
                            ticketNumber: ticketNumber,
                            balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                            ticketId: machineTicket._id,
                            playerId: playerId,
                            username: player?.username || "",
                            customerNumber: player?.customerNumber || "",
                            playerAfterBalance: player?.walletAmount ?? 0,
                            paymentType: paymentType,
                            agentId: agentId,
                            hallId: hallId,
                            userType: userType,
                            language: req.session.details.language,
                            hall: req.session.details.hall[0],
                            groupHall: hallsData.groupHall,
                            agentName: req.session.details.name,
                            addedAmount: ticketAmount
                        });
                        let result = {
                            roomId: roomId,
                            ticketNumber: ticketNumber,
                            balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                            ticketId: ticketNumber,
                            paymentType: paymentType,
                            ticketStatus: true
                        }
                        console.log("dbResponse----", dbResponse)
                        if(dbResponse && dbResponse.status == "success"){
                            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                                type: "deposit",
                                playerId: playerId,
                                hallId: hallId,
                                deposit: ticketAmount
                            });
                            if (paymentType === "Cash") {
                                req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2)
                            }
                            result.dailyBalance =  dbResponse.dailyBalance;
                        }   
                        return res.json({
                            status:"success",
                            result: result,
                            message: translate.ticket_add_balance_success,
                        });
                    }else{
                        return res.json({
                            status:"fail",
                            message: response.error_str || translate.something_went_wrong,
                        });
                    }
                } else {
                    return res.json({ status: "fail", message: translate.agent_not_found });
                }
            }else{
                return res.status(500).json({
                    status:"fail",
                    message: translate.you_are_not_allowed_to_perform_this_operation
                });
            }
           
        } catch (e) {
            console.log("Add balance metronia--", e)
            return res.status(500).json({
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
            });
        }
    },

    addToMetroniaAPI: async function(data) {
        try {
            const { roomId, ticketNumber, finalAmount, transaction} = data;
            const response = await axios.post(
                `${config.metroniaApiURL}/upgrade-ticket`,
                { 
                    room_id: roomId,
                    ticket: ticketNumber,
                    amount: finalAmount,
                    transaction: transaction.toString() 
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.metroniaApiToken}`,
                    },
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false, // Ignore SSL certificate validation
                    }),
                }
            );

            // Check if the response is valid 
            if (!response || !response.data) {
                throw new Error("Empty or invalid response from API");
            }

            return response.data;
        } catch (e) {
            console.error("Error in addToMetroniaAPI:", e);
            throw e; // Re-throw error to be handled by the caller
        }
    },

    // get balnce of all machine tickets
    getBalanceOfMachineTickets: async function (req, res) {
        try {
            // Get the values from the request body
            const { ticketNumber, machineName } = { ...req.body, ticketNumber: +req.body.ticketNumber };
            // Translation keys for dynamic messages
            let keys = [
                "agent_not_found",
                "please_ensure_previous_agent_logs_out",
                "previous_day_settlement_pending",
                "user_not_found",
                "something_went_wrong",
                "Insufficient_balance",
                "ticket_already_closed",
                "ticket_record_not_found",
                "you_are_not_allowed_to_perform_this_operation"
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                        return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
                    }

                    let machineTicket = await Sys.App.Services.slotmachineServices.getSingleData({machineName: machineName, hallId: hallId, ticketNumber: ticketNumber}, {playerId: 1, balance: 1, isClosed: 1, roomId: 1, uniqueTransaction: 1});
                    console.log("machineTicket---", machineTicket)
                    if(!machineTicket){
                        return res.json({
                            status: "fail",
                            message: translate.ticket_record_not_found,
                        });
                    }
                    if(machineTicket.isClosed == true){
                        return res.json({
                            status: "fail",
                            message: translate.ticket_already_closed,
                        });
                    }
                    const roomId = machineTicket.roomId; 

                    if(machineName == "Metronia"){
                        // fetch ticket status and if it is closed revert amount to his account for close ticket
                        const getLatestTicketStatus  = await module.exports.ticketStatusMetronia({ticketNumber, roomId, language: req.session.details.language });
                        console.log("getLatestTicketStatus---", getLatestTicketStatus)
                        if (!getLatestTicketStatus || getLatestTicketStatus.status === "fail") {
                            return res.status(getLatestTicketStatus ? 200 : 500).json({
                                status: "fail",
                                message: getLatestTicketStatus?.message || translate.something_went_wrong,
                            });
                        }
                        
                        if (getLatestTicketStatus.result?.ticketStatus === false) {
                            console.log("This ticket is closed");
                            // Need to add revert amount as ticket is already closed but we need to rever player amount
                            return res.json({
                                status: "fail",
                                message: translate.ticket_already_closed,
                            });
                        }
                        return res.json(getLatestTicketStatus);
                    }else if(machineName == "OK Bingo"){
                        let response = await module.exports.createOkBingoAPI({ roomId, ticketNumber, transaction: machineTicket.uniqueTransaction, commandId: 5 });
                        if (!response || Object.keys(response).length === 0) {
                            return res.json({
                                status: "fail",
                                message: translate.something_went_wrong
                            });
                        }
                        if (response.error === 0) {
                            return res.json({
                                status:"success",
                                result: {
                                    balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                                    ticketStatus: true,
                                    isReserved: false, //Not used for ok bingo
                                },
                            });
                        }else{
                            return res.json({
                                status:"fail",
                                message: response.error_str || translate.something_went_wrong,
                            });
                        }
                    }else{

                    }
                } else {
                    return res.json({ status: "fail", message: translate.agent_not_found });
                }
            }else{
                return res.status(500).json({
                    status:"fail",
                    message: translate.you_are_not_allowed_to_perform_this_operation
                });
            }
        } catch (e) {
            console.log("Error in getBalanceOfMachineTickets", e)
            return res.status(500).json({
                status:"fail",
               message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
            });
        }
    },
    // close tickets of all machine 
    closeTicketOfMachine: async function (req, res) {
        try {
            // Get the values from the request body
            const { ticketNumber, machineName } = req.body;
            const paymentType = "customerNumber";

            // Translation keys for dynamic messages
            let keys = [
                "agent_not_found",
                "please_ensure_previous_agent_logs_out",
                "previous_day_settlement_pending",
                "user_not_found",
                "something_went_wrong",
                "ticket_record_not_found",
                "ticket_already_closed",
                "you_are_not_allowed_to_perform_this_operation",
                "ticket_not_belog_to_user",
                "ticket_close_success"
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;

                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                        return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
                    }

                    let machineTicket = await Sys.App.Services.slotmachineServices.getSingleData({machineName: machineName, hallId: hallId, ticketNumber: ticketNumber}, {playerId: 1, balance: 1, isClosed: 1, roomId: 1, uniqueTransaction: 1});
                    console.log("machineTicket---", machineTicket)
                    if(!machineTicket){
                        return res.json({
                            status: "fail",
                            message: translate.ticket_record_not_found,
                        });
                    }
                    if(machineTicket.isClosed == true){
                        return res.json({
                            status: "fail",
                            message: translate.ticket_already_closed,
                        });
                    }

                    let player = null;
                    if(machineTicket.playerId && paymentType == "customerNumber"){
                        let query = {
                            'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
                            userType: "Online",
                           _id: machineTicket.playerId
                        };
                        player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1, customerNumber: 1, walletAmount: 1, userType: 1 });
                        
                        if(!player){
                            return res.json({ status: "fail", message: translate.user_not_found });
                        }
                    }
                    const userType = player?.userType ?? 'Physical';
        
                    const roomId = machineTicket.roomId; 
                    let transaction = generateUniqueRandomNumber();

                    let response;
                    if(machineName == "Metronia"){
                        transaction = uuidv4();
                        response = await module.exports.closeMetroniaAPI({ roomId: roomId, ticketNumber: +ticketNumber, transaction: transaction});
                    }else if(machineName == "OK Bingo"){
                        response = await module.exports.createOkBingoAPI({ roomId: roomId, ticketNumber: +ticketNumber, transaction: machineTicket.uniqueTransaction, commandId: 3});
                    }
                    console.log("close ticket response---", response);
                    // Check if ticketResponse is valid (not null, undefined, or empty)
                    if (!response || Object.keys(response).length === 0) {
                        return res.json({
                            status: "fail",
                            message: translate.something_went_wrong
                        });
                    }
                    if (response.error === 0) {
                        const dbResponse = await module.exports.cancelTicketDb({
                            machineName: machineName,
                            roomId: roomId,
                            ticketNumber: ticketNumber,
                            balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                            ticketId: machineTicket._id,
                            playerId: player?.id || "",
                            username: player?.username || "",
                            customerNumber: player?.customerNumber || "",
                            playerAfterBalance: player?.walletAmount ?? 0,
                            paymentType: paymentType,
                            agentId: agentId,
                            hallId: hallId,
                            userType: userType,
                            language: req.session.details.language,
                            hall: req.session.details.hall[0],
                            groupHall: hallsData.groupHall,
                            agentName: req.session.details.name,
                        });
                        let result = {
                            roomId: roomId,
                            ticketNumber: ticketNumber,
                            balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                            paymentType: paymentType,
                            ticketStatus: true,
                            machineName: machineName,
                        }
                        console.log("dbResponse----", dbResponse)
                        if(dbResponse && dbResponse.status == "success"){
                            Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                                type: "withdraw",
                                playerId: player?.id || "",
                                hallId: hallId,
                                withdraw: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0
                            });
                            if (paymentType === "Cash") {
                                req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2)
                            }
                            result.dailyBalance =  dbResponse.dailyBalance;
                            result.ticketStatus = false
                        }   
                        return res.json({
                            status:"success",
                            result: result,
                            message: translate.ticket_close_success,
                        });

                    }else{
                        return res.json({
                            status:"fail",
                            message: response.error_str || translate.something_went_wrong,
                        });
                    }
                } else {
                    return res.json({ status: "fail", message: translate.agent_not_found });
                }
            }else{
                return res.status(500).json({
                    status:"fail",
                    message: translate.you_are_not_allowed_to_perform_this_operation
                });
            }

        } catch (e) {
            console.log("Error in closeTicketOfMachine", e)
            return res.status(500).json({
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
            });
        }
    },

    closeMetroniaAPI: async function(data) {
        try {
            const {roomId, ticketNumber, transaction} = data;
            const response = await axios.post(
                `${config.metroniaApiURL}/close-ticket`,
                { 
                    ticket: +ticketNumber, 
                    room_id: roomId,
                    transaction: transaction.toString() 
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.metroniaApiToken}`,
                    },
                    httpsAgent: new https.Agent({
                        rejectUnauthorized: false, // Ignore SSL certificate validation
                    }),
                }
            );

            // Check if the response is valid 
            if (!response || !response.data) {
                throw new Error("Empty or invalid response from API");
            }

            return response.data;
        } catch (e) {
            console.error("Error in closeMetroniaAPI:", e);
            throw e; // Re-throw error to be handled by the caller
        }
    },

    // close all tickets of all machines
    closeAllTicketOfMachine: async function (req, res) {
        try {
            const { machineName } = req.body;
            // Translation keys for dynamic messages
            let keys = [
                "agent_not_found",
                "please_ensure_previous_agent_logs_out",
                "previous_day_settlement_pending",
                "user_not_found",
                "something_went_wrong",
                "ticket_already_closed",
                "you_are_not_allowed_to_perform_this_operation",
                "ticket_not_belog_to_user",
                "close_all_tickets_success"
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
    
            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;
    
                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (!hallsData.activeAgents.some(agent => agent.id == agentId)) {
                        return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending) {
                        return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
                    }

                    const startOfDay = moment().startOf('day').toDate();
                    const endOfDay = moment().endOf('day').toDate();
    
                    let allTodaysActiveTickets = await Sys.App.Services.slotmachineServices.getByData({
                        machineName: machineName, isClosed: false, hallId: hallId, createdAt: { $gte: startOfDay, $lte: endOfDay }
                    }, { playerId: 1, balance: 1, isClosed: 1, roomId: 1, ticketNumber: 1, uniqueTransaction: 1 });
                    
                    let processedTickets = [];
                    const pLimit = (await import('p-limit')).default; // Dynamically load p-limit
                    // Use pLimit as needed
                    const limit = pLimit(10);  // Adjust concurrency limit as needed
                    // Process all tickets concurrently with a limit on the number of concurrent operations
                    const ticketProcessingPromises = allTodaysActiveTickets.map(ticket => limit(async () => {
                        try {
                            let machineTicket = ticket;
                            let ticketNumber = +machineTicket.ticketNumber;
                            let paymentType = machineTicket.playerId ? "customerNumber" : "Cash";
    
                            if (machineTicket.isClosed) {
                                return;
                            }
    
                            let player = null;
                            if (machineTicket.playerId && paymentType === "customerNumber") {
                                let query = {
                                    'approvedHalls': { $elemMatch: { 'id': hallId } },
                                    userType: "Online",
                                    _id: machineTicket.playerId
                                };
                                player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, {
                                    username: 1, customerNumber: 1, walletAmount: 1, userType: 1
                                });
    
                                if (!player) {
                                    return;
                                }
                            }
    
                            const userType = player?.userType ?? 'Physical';
                            const roomId = machineTicket.roomId;
                            let transaction = generateUniqueRandomNumber();
                            let response = null;
                            if(machineName == "Metronia"){
                                transaction = uuidv4();
                                response = await module.exports.closeMetroniaAPI({ roomId: roomId, ticketNumber: +ticketNumber, transaction: transaction});
                            }else if(machineName == "OK Bingo"){
                                response = await module.exports.createOkBingoAPI({ roomId: +roomId, ticketNumber: +ticketNumber, transaction: machineTicket.uniqueTransaction, commandId: 3});
                            }
                            console.log("close ticket response---", response);
                            if (!response || Object.keys(response).length === 0) {
                                processedTickets.push({
                                    roomId,
                                    ticketNumber,
                                    balance: 0,
                                    paymentType,
                                    ticketStatus: false,
                                    error: "No response form API"
                                });
                            }
                            if (response.error === 0) {
                                const dbResponse = await module.exports.cancelTicketDb({
                                    machineName: machineName,
                                    roomId: roomId,
                                    ticketNumber: ticketNumber,
                                    balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                                    ticketId: machineTicket._id,
                                    playerId: player?.id || "",
                                    username: player?.username || "",
                                    customerNumber: player?.customerNumber || "",
                                    playerAfterBalance: player?.walletAmount ?? 0,
                                    paymentType: paymentType,
                                    agentId: agentId,
                                    hallId: hallId,
                                    userType: userType,
                                    language: req.session.details.language,
                                    hall: req.session.details.hall[0],
                                    groupHall: hallsData.groupHall,
                                    agentName: req.session.details.name,
                                });

                                processedTickets.push({
                                    roomId,
                                    ticketNumber,
                                    balance: response.balance ? +exactMath.div(response.balance, 100).toFixed(2) : 0,
                                    paymentType,
                                    ticketStatus: dbResponse?.status === "success"
                                });
    
                                if (paymentType === "Cash" && dbResponse?.status === "success") {
                                    Sys.App.Controllers.redFlagCategoryController.dailyTransctionUpdate({
                                        type: "withdraw",
                                        playerId: player?.id || "",
                                        hallId: hallId,
                                        withdraw: response.balance ? +exactMath.div(response.balance, 100).toFixed(2) : 0,
                                    });
                                    req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2);
                                }
                            }else{
                                processedTickets.push({
                                    roomId,
                                    ticketNumber,
                                    balance: 0,
                                    paymentType,
                                    ticketStatus: false,
                                    error: response?.error_str
                                });
                            }
                        } catch (error) {
                            console.error(`Error processing ticket ${ticket.ticketNumber}:`, error);
                            processedTickets.push({
                                ticketNumber: ticket?.ticketNumber || "Unknown",
                                ticketStatus: false,
                                error: error.message
                            });
                        }
                    }));
                   
                    // Wait for all ticket processing promises to resolve
                    await Promise.all(ticketProcessingPromises);
    
                    return res.json({
                        status: "success",
                        message: translate.close_all_tickets_success,
                        tickets: processedTickets
                    });
                } else {
                    return res.json({ status: "fail", message: translate.agent_not_found });
                }
            } else {
                return res.status(500).json({
                    status: "fail",
                    message: translate.you_are_not_allowed_to_perform_this_operation
                });
            }
        } catch (e) {
            console.log("Error in closeAllTicketOfMachine", e)
            return res.status(500).json({
                status: "fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
            });
        }
    },

    // Open Day Ok Bingo
    openDayOkBingo: async function (req, res) {
        try { 
            let response = await module.exports.createOkBingoAPI({ roomId: 247, commandId: 11 });
            if (!response || Object.keys(response).length === 0) {
                return res.json({
                    status: "fail",
                    message: "Something went wrong"
                });
            }
            if (response.error === 0) {
                return res.json({
                    status:"success",
                    result: result,
                    message: "Open day Successfully",
                });
            }else{
                return res.json({
                    status:"fail",
                    message: response.error_str || "Something went wrong",
                });
            }
        } catch (e) {
            console.log("error", e)
            return {
                status:"fail",
                message: "Something went wrong",
                stausCode: 500
            };
        }
    }, 

    // close reaming tickets of all halls every mid-day by cron from server.js
    autoCloseTicket: async function(data){
        try {
            const { machineName } = data;
            
            const startOfDay = moment().startOf('day').toDate();
            const endOfDay = moment().endOf('day').toDate();
            console.log("startOfDay and endOfDay---", startOfDay, endOfDay)
            let allTodaysActiveTickets = await Sys.App.Services.slotmachineServices.getByData({
                machineName: machineName, isClosed: false, createdAt: { $gte: startOfDay, $lte: endOfDay }
            }, { playerId: 1, balance: 1, isClosed: 1, roomId: 1, ticketNumber: 1, uniqueTransaction: 1, otherData: 1 });
            
            let processedTickets = [];
            const pLimit = (await import('p-limit')).default; // Dynamically load p-limit
            // Use pLimit as needed
            const limit = pLimit(10);  // Adjust concurrency limit as needed
            // Process all tickets concurrently with a limit on the number of concurrent operations
            const ticketProcessingPromises = allTodaysActiveTickets.map(ticket => limit(async () => {
                try {
                    let machineTicket = ticket;
                    let ticketNumber = +machineTicket.ticketNumber;
                    let paymentType = machineTicket.playerId ? "customerNumber" : "Cash";
                    const hallId = machineTicket.otherData.hall.id;
                    const agentId = machineTicket.otherData.hall.agentId;
                    if (machineTicket.isClosed) {
                        return;
                    }

                    let player = null;
                    if (machineTicket.playerId && paymentType === "customerNumber") {
                        let query = {
                            'approvedHalls': { $elemMatch: { 'id': hallId } },
                            userType: "Online",
                            _id: machineTicket.playerId
                        };
                        player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, {
                            username: 1, customerNumber: 1, walletAmount: 1, userType: 1
                        });

                        if (!player) {
                            return;
                        }
                    }

                    const userType = player?.userType ?? 'Physical';
                    const roomId = machineTicket.roomId;
                    let transaction = generateUniqueRandomNumber();
                    let response = null;
                    if(machineName == "Metronia"){
                        transaction = uuidv4();
                        response = await module.exports.closeMetroniaAPI({ roomId: roomId, ticketNumber: +ticketNumber, transaction: transaction});
                    }else if(machineName == "OK Bingo"){
                        response = await module.exports.createOkBingoAPI({ roomId: +roomId, ticketNumber: +ticketNumber, transaction: machineTicket.uniqueTransaction, commandId: 3});
                    }
                    console.log("close ticket response---", response);
                    if (!response || Object.keys(response).length === 0) {
                        processedTickets.push({
                            roomId,
                            ticketNumber,
                            balance: 0,
                            paymentType,
                            ticketStatus: false,
                            error: "No response form API"
                        });
                    }
                    if (response.error === 0) {
                        const dbResponse = await module.exports.cancelTicketDb({
                            machineName: machineName,
                            roomId: roomId,
                            ticketNumber: ticketNumber,
                            balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
                            ticketId: machineTicket._id,
                            playerId: player?.id || "",
                            username: player?.username || "",
                            customerNumber: player?.customerNumber || "",
                            playerAfterBalance: player?.walletAmount ?? 0,
                            paymentType: paymentType,
                            agentId: agentId,
                            hallId: hallId,
                            userType: userType,
                            language: "english",
                            hall: machineTicket.otherData.hall,
                            groupHall: machineTicket.otherData.groupHall,
                            agentName: machineTicket.otherData.agentName,
                        });

                        processedTickets.push({
                            roomId,
                            ticketNumber,
                            balance: response.balance ? +exactMath.div(response.balance, 100).toFixed(2) : 0,
                            paymentType,
                            ticketStatus: dbResponse?.status === "success"
                        });
                    }else{
                        processedTickets.push({
                            roomId,
                            ticketNumber,
                            balance: 0,
                            paymentType,
                            ticketStatus: false,
                            error: response?.error_str
                        });
                    }
                } catch (error) {
                    console.error(`Error processing ticket ${ticket.ticketNumber}:`, error);
                    processedTickets.push({
                        ticketNumber: ticket?.ticketNumber || "Unknown",
                        ticketStatus: false,
                        error: error.message
                    });
                }
            }));
           
            // Wait for all ticket processing promises to resolve
            await Promise.all(ticketProcessingPromises);

            return {
                status: "success",
                tickets: processedTickets
            };
           
        } catch (e) {
            console.log("Error in closeAllTicketOfMachine", e)
            return {
                status: "fail",
                message: "Something went wrong"
            };
        }
    },

    // get report data
    getReportData: async function(req, res){
        try{
            let keys = [
                "agent_not_found",
                "please_ensure_previous_agent_logs_out",
                "previous_day_settlement_pending",
                "something_went_wrong",
                "you_are_not_allowed_to_perform_this_operation",
            ];
            let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

            if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
                const hallId = req.session.details.hall[0].id;
                const agentId = req.session.details.id;
                
                let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
                if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
                    if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
                        return { status: "fail", message: translate.please_ensure_previous_agent_logs_out };
                    }
                    if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
                        return { status: "fail", message: translate.previous_day_settlement_pending };
                    }

                    // Get today's start and end date
                    const startOfDay = moment().startOf('day').toDate();  // Start of today (00:00:00)
                    const endOfDay = moment().endOf('day').toDate();      // End of today (23:59:59)

                    // Consider cash payment only for current shift
                    let query = {
                        shiftId:  mongoose.Types.ObjectId(req.session.details.shiftId),
                        hallId: mongoose.Types.ObjectId(hallId),
                        //paymentBy: "Cash",
                        "otherData.machineName": { $exists: true }, // Ensure the field exists
                        "createdAt": {
                            $gte: startOfDay, // Start of today
                            $lt: endOfDay // End of today
                        }
                    }
                    let aggregationPipeline = [
                        { $match: query }, // Match the documents based on the query
                        {
                          $group: {
                            _id: "$otherData.machineName", // Group by machine name
                            totalIn: {
                              $sum: { $cond: [{ $eq: ["$category", "credit"] }, "$amount", 0] } // Sum amounts where category is "credit" (in)
                            },
                            totalOut: {
                              $sum: { $cond: [{ $eq: ["$category", "debit"] }, "$amount", 0] } // Sum amounts where category is not "credit" (out)
                            }
                          }
                        }
                    ];

                    let response = await Sys.App.Services.AgentServices.aggregateQueryAgentTransaction(aggregationPipeline);
                    console.log("response---", response)
                    let result = [ { machineName: "Metronia", totalIn: 0, totalOut: 0 }, { machineName: "OK Bingo", totalIn: 0, totalOut: 0 } ];
                    if(response && response.length > 0){
                        result = result.map(item => {
                            const match = response.find(res => res._id === item.machineName);
                            return match ? { ...item, ...match } : item;
                        });
                    }
                    return {
                        status: "success",
                        result: result
                    };
                    
                } else {
                    return { status: "fail", message: translate.agent_not_found };
                }
            }else{
                return res.status(500).json({
                    status:"fail",
                    message: translate.you_are_not_allowed_to_perform_this_operation
                });
            }
        }catch(e){
            console.log("Error in getting numbers of today", e)
            return res.status(500).json({
                status:"fail",
                message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
            });
        }
    },

    // Old APIS, not using, if require we can use
    // checkConnectMetronia: async function (req, res) {
    //     try {
    //          // Call the third-party API using axios
    //         const response = await axios.post(`${config.metroniaApiURL}/check-connect`, {}, {
    //             headers: {
    //                 'Content-Type': "application/json",
    //                 'Authorization': `Bearer ${config.metroniaApiToken}`, // Include the Bearer Token
    //             },
    //             httpsAgent: new https.Agent({ rejectUnauthorized: false }) // Disable SSL verification for local testing
    //         });
    //         console.log("response.data---", response.data)
    //         // Send the response back to the client
    //         res.json({
    //             status:"success",
    //             message: "Succesfully called api",
    //             result: response.data
    //         });
    //     } catch (e) {
    //         res.status(500).json({
    //             status:"success",
    //             message: 'Something Went Wrong'
    //         });
    //     }
    // },

    // createTicketMetronia: async function (req, res) {
    //     try {
    //         // Get the values from the request body
    //         let { amount, playerId, username, paymentMethod, paymentType = paymentMethod } = req.body;  // paymentType will be card/cash/customerNumber
    //         const ticketAmount = +amount;
    //         const finalAmount = +exactMath.mul(ticketAmount, 100).toFixed(2);

    //         // Translation keys for dynamic messages
    //         let keys = [
    //             "agent_not_found",
    //             "please_ensure_previous_agent_logs_out",
    //             "previous_day_settlement_pending",
    //             "user_not_found",
    //             "something_went_wrong",
    //             "Insufficient_balance",
    //             "invalid_input_should_be_number",
    //             "ticket_create_success"
    //         ];
    //         let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

    //         // Input validation
    //         if (typeof finalAmount !== 'number' || isNaN(finalAmount)) {
    //             return res.json({
    //                 status: "fail",
    //                 message: translate.invalid_input_should_be_number,
    //             });
    //         }

    //         if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
    //             const hallId = req.session.details.hall[0].id;
    //             const agentId = req.session.details.id;

    //             let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
    //             if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
    //                 if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
    //                     return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
    //                 }
    //                 if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
    //                     return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
    //                 }
                    
    //                 let player = null;
    //                 if(playerId && paymentType == "customerNumber"){
    //                     let query = {
    //                         'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
    //                         userType: "Online",
    //                         $or: [
    //                             { customerNumber: isNaN(Number(username)) ? null : Number(username) },
    //                             { username: username }
    //                         ]
    //                     };
    //                     if (playerId && username) {
    //                         query._id = playerId;
    //                         player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1, customerNumber: 1, walletAmount: 1, userType: 1 });
    //                     } else if (username) {
    //                         player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1, customerNumber: 1, walletAmount: 1, userType: 1 });
    //                     }
                        
    //                     if(!player){
    //                         return res.json({ status: "fail", message: translate.user_not_found });
    //                     }
                        
    //                     if(player.username != username && player.customerNumber != username){
    //                         return res.json({
    //                             status: "fail",
    //                             message: translate.something_went_wrong,
    //                         });
    //                     }
    //                     if(player.walletAmount < ticketAmount){
    //                         return res.json({
    //                             status: "fail",
    //                             message: translate.Insufficient_balance,
    //                         });
    //                     }
    //                     // deduct player wallet
    //                     player = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, { $inc: { walletAmount: -ticketAmount } });
    //                 }
    //                 const userType = player?.userType ?? 'Physical';
    //                 const transaction = generateUniqueRandomNumber();  // Generate a unique transaction ID
                    
    //                 // let response = {
    //                 //    roomId: "TEST", ticketNumber: 5812444, balance: 10, ticketId: "VEVTVA==@5812444"
    //                 // }
    //                 // const dbResponse = await module.exports.createTicketDb({
    //                 //     machineName: "Metronia",
    //                 //     roomId: response.roomId,
    //                 //     ticketNumber: response.ticketNumber,
    //                 //     balance: 10,
    //                 //     ticketId: response.ticketNumber,
    //                 //     playerId: playerId,
    //                 //     username:player?.username || "",
    //                 //     customerNumber: player?.customerNumber || "",
    //                 //     playerAfterBalance: player?.walletAmount || 0,
    //                 //     paymentType: paymentType,
    //                 //     agentId: agentId,
    //                 //     hallId: hallId,
    //                 //     userType: userType,
    //                 //     language: req.session.details.language,
    //                 //     hall: req.session.details.hall[0],
    //                 //     groupHall: hallsData.groupHall,
    //                 //     agentName: req.session.details.name,
    //                 // });
    //                 // let result = {
    //                 //     roomId: response.roomId,
    //                 //     ticketNumber: response.ticketNumber,
    //                 //     balance: 10,
    //                 //     ticketId: response.ticketNumber
    //                 // }
    //                 // console.log("dbResponse----", dbResponse)
    //                 // if(dbResponse && dbResponse.status == "success"){
    //                 //     if (paymentType === "Cash") {
    //                 //         req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2)
    //                 //     }
    //                 //     result.dailyBalance =  dbResponse.dailyBalance;
    //                 //     result.paymentType = paymentType;
    //                 // }   

    //                 // return res.json({
    //                 //     status:"success",
    //                 //     message: translate.ticket_create_success,
    //                 //     result: result
    //                 // });

    //                 //Call to the third-party API
    //                 axios.post(
    //                     `${config.metroniaApiURL}/create-ticket`,
    //                     { 
    //                         amount: finalAmount, 
    //                         transaction 
    //                     },
    //                     {
    //                         headers: {
    //                             'Content-Type': 'application/json',
    //                             'Authorization': `Bearer ${config.metroniaApiToken}`, // Include the Bearer Token
    //                         },
    //                         httpsAgent: new https.Agent({
    //                             rejectUnauthorized: false, // Ignore SSL certificate validation
    //                         }),
    //                     }
    //                 )
    //                 .then(async response => {
    //                     console.log("create ticket response---", response.data);
    //                     // Handle success here, such as processing response.data
    //                     if(response && response.data){
    //                         // Send the response back to the client
    //                         if (response.data.error === 0) {
            
    //                             const dbResponse = await module.exports.createTicketDb({
    //                                 machineName: "Metronia",
    //                                 roomId: response.data.room_id,
    //                                 ticketNumber: response.data.ticket,
    //                                 balance: (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
    //                                 ticketId: response.data.ticket_id,
    //                                 playerId: playerId,
    //                                 username:player?.username || "",
    //                                 customerNumber: player?.customerNumber || "",
    //                                 playerAfterBalance: player?.walletAmount ?? 0, //player?.walletAmount || (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
    //                                 paymentType: paymentType,
    //                                 agentId: agentId,
    //                                 hallId: hallId,
    //                                 userType: userType,
    //                                 language: req.session.details.language,
    //                                 hall: req.session.details.hall[0],
    //                                 groupHall: hallsData.groupHall,
    //                                 agentName: req.session.details.name,
    //                                 shiftId: req.session.details.shiftId
    //                             });
    //                             let result = {
    //                                 roomId: response.data.room_id,
    //                                 ticketNumber: response.data.ticket,
    //                                 balance: (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
    //                                 ticketId: response.data.ticket_id
    //                             }
    //                             console.log("dbResponse----", dbResponse)
    //                             if(dbResponse && dbResponse.status == "success"){
    //                                 if (paymentType === "Cash") {
    //                                     req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2)
    //                                 }
    //                                 result.dailyBalance =  dbResponse.dailyBalance;
    //                                 result.paymentType = paymentType;
    //                             }   
            
    //                             return res.json({
    //                                 status:"success",
    //                                 result: result,
    //                                 message: translate.ticket_create_success,
    //                             });
    //                         }
    //                         return res.json({
    //                             status:"fail",
    //                             message: `${response.data.error_str}`,
    //                         });
    //                     }
    //                 })
    //                 .catch(async error => {
    //                     console.error("Error:", error);
    //                     // Revert deducted wallet amount
    //                     await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, { $inc: { walletAmount: ticketAmount } });
    //                     return res.status(500).json({
    //                         status:"fail",
    //                         message: translate.something_went_wrong
    //                     });
    //                 });
    //             } else {
    //                 return res.json({ status: "fail", message: translate.agent_not_found });
    //             }
    //         }
    //         // const response = await axios.post(
    //         //     `${config.metroniaApiURL}/create-ticket`,
    //         //     { 
    //         //         amount: finalAmount, 
    //         //         transaction 
    //         //     },
    //         //     {
    //         //         headers: {
    //         //             'Content-Type': 'application/json',
    //         //             'Authorization': `Bearer ${config.metroniaApiToken}`, // Include the Bearer Token
    //         //         },
    //         //         httpsAgent: new https.Agent({
    //         //             rejectUnauthorized: false, // Ignore SSL certificate validation
    //         //         }),
    //         //     }
    //         // );
    //         // console.log("create ticket response---", response.data);
           
    //         // return res.status(500).json({
    //         //     status:"fail",
    //         //     message: 'Something Went Wrong'
    //         // });
    //     } catch (e) {
    //         return res.status(500).json({
    //             status:"fail",
    //             message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
    //         });
    //     }
    // },

    

    // getBalanceMetronia: async function (req, res) {
    //     try {
    //         // Get the values from the request body
    //         const { ticketNumber } = { ...req.body, ticketNumber: +req.body.ticketNumber };
    //         // Translation keys for dynamic messages
    //         let keys = [
    //             "agent_not_found",
    //             "please_ensure_previous_agent_logs_out",
    //             "previous_day_settlement_pending",
    //             "user_not_found",
    //             "something_went_wrong",
    //             "Insufficient_balance",
    //             "ticket_already_closed",
    //             "ticket_record_not_found",
    //             "you_are_not_allowed_to_perform_this_operation"
    //         ];
    //         let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
    //         if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
    //             const hallId = req.session.details.hall[0].id;
    //             const agentId = req.session.details.id;

    //             let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
    //             if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
    //                 if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
    //                     return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
    //                 }
    //                 if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
    //                     return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
    //                 }

    //                 let machineTicket = await Sys.App.Services.slotmachineServices.getSingleData({ticketNumber: ticketNumber}, {playerId: 1, balance: 1, isClosed: 1, roomId: 1});
    //                 console.log("machineTicket---", machineTicket)
    //                 if(!machineTicket){
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_record_not_found,
    //                     });
    //                 }
    //                 if(machineTicket.isClosed == true){
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_already_closed,
    //                     });
    //                 }
    //                 const roomId = machineTicket.roomId; 

    //                 // fetch ticket status and if it is closed revert amount to his account for close ticket
    //                 const getLatestTicketStatus  = await module.exports.ticketStatusMetronia({ticketNumber, roomId, language: req.session.details.language });
    //                 console.log("getLatestTicketStatus---", getLatestTicketStatus)
    //                 if (!getLatestTicketStatus || getLatestTicketStatus.status === "fail") {
    //                     return res.status(getLatestTicketStatus ? 200 : 500).json({
    //                         status: "fail",
    //                         message: getLatestTicketStatus?.message || translate.something_went_wrong,
    //                     });
    //                 }
                    
    //                 if (getLatestTicketStatus.result?.ticketStatus === false) {
    //                     console.log("This ticket is closed");
    //                     // Need to add revert amount as ticket is already closed but we need to rever player amount
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_already_closed,
    //                     });
    //                 }

    //                 return res.json(getLatestTicketStatus);
    //             } else {
    //                 return res.json({ status: "fail", message: translate.agent_not_found });
    //             }
    //         }else{
    //             return res.status(500).json({
    //                 status:"fail",
    //                 message: translate.you_are_not_allowed_to_perform_this_operation
    //             });
    //         }
    //     } catch (e) {
    //         return res.status(500).json({
    //             status:"fail",
    //             message: 'Something Went Wrong'
    //         });
    //     }
    // },

    // addBalanceMetronia: async function (req, res) {
    //     try {
    //         // Get the values from the request body
    //         let { amount, ticketNumber, paymentMethod, playerId, paymentType = paymentMethod } = { ...req.body, ticketNumber: +req.body.ticketNumber };
    //         const ticketAmount = +amount;
    //         const finalAmount = +exactMath.mul(amount, 100).toFixed(2);

    //         // Translation keys for dynamic messages
    //         let keys = [
    //             "agent_not_found",
    //             "please_ensure_previous_agent_logs_out",
    //             "previous_day_settlement_pending",
    //             "user_not_found",
    //             "something_went_wrong",
    //             "ticket_record_not_found",
    //             "ticket_already_closed",
    //             "you_are_not_allowed_to_perform_this_operation",
    //             "ticket_add_balance_success",
    //             "ticket_not_belog_to_user"
    //         ];
    //         let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
            
    //         // Input validation
    //         if (typeof finalAmount !== 'number' || isNaN(finalAmount)) {
    //             return res.json({
    //                 status: "fail",
    //                 message: translate.invalid_input_should_be_number,
    //             });
    //         }

    //         if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
    //             const hallId = req.session.details.hall[0].id;
    //             const agentId = req.session.details.id;

    //             let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
    //             if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
    //                 if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
    //                     return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
    //                 }
    //                 if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
    //                     return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
    //                 }

    //                 let machineTicket = await Sys.App.Services.slotmachineServices.getSingleData({ticketNumber: ticketNumber}, {playerId: 1, balance: 1, isClosed: 1, roomId: 1});
    //                 console.log("machineTicket---", machineTicket)
    //                 if(!machineTicket){
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_record_not_found,
    //                     });
    //                 }
    //                 if(machineTicket.isClosed == true){
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_already_closed,
    //                     });
    //                 }
    //                 const roomId = machineTicket.roomId; 

    //                 // fetch ticket status and if it is closed revert amount to his account for close ticket
    //                 const getLatestTicketStatus  = await module.exports.ticketStatusMetronia({ticketNumber, roomId, language: req.session.details.language });
    //                 console.log("getLatestTicketStatus---", getLatestTicketStatus)
    //                 if (!getLatestTicketStatus || getLatestTicketStatus.status === "fail") {
    //                     return res.status(getLatestTicketStatus ? 200 : 500).json({
    //                         status: "fail",
    //                         message: getLatestTicketStatus?.message || translate.something_went_wrong,
    //                     });
    //                 }
                    
    //                 if (getLatestTicketStatus.result?.ticketStatus === false) {
    //                     console.log("This ticket is closed");
    //                     // Need to add revert amount as ticket is already closed but we need to rever player amount
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_already_closed,
    //                     });
    //                 }

    //                 let player = null;
    //                 if(machineTicket.playerId && machineTicket.playerId != playerId && paymentType == "customerNumber"){
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_not_belog_to_user,
    //                     });
    //                 }

    //                 if(machineTicket.playerId || playerId){
    //                     let query = {
    //                         'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
    //                         userType: "Online",
    //                        _id: playerId
    //                     };
    //                     player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1, customerNumber: 1, walletAmount: 1, userType: 1 });
                        
    //                     if(!player){
    //                         return res.json({ status: "fail", message: translate.user_not_found });
    //                     }
    //                 }
    //                 if(player && paymentType == "customerNumber"){
    //                     if(player.walletAmount < ticketAmount){
    //                         return res.json({
    //                             status: "fail",
    //                             message: translate.Insufficient_balance,
    //                         });
    //                     }
    //                     // deduct player wallet
    //                     player = await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: playerId }, { $inc: { walletAmount: -ticketAmount } });
    //                 }
    //                 const userType = player?.userType ?? 'Physical';
    //                 const transaction = generateUniqueRandomNumber();  // Generate a unique transaction ID
                    

    //                 // Call to the third-party API
    //                 axios.post(
    //                     `${config.metroniaApiURL}/upgrade-ticket`,
    //                     { 
    //                         room_id: roomId,
    //                         ticket: ticketNumber,
    //                         amount: finalAmount,
    //                         transaction,
    //                     },
    //                     {
    //                         headers: {
    //                             'Content-Type': 'application/json',
    //                             'Authorization': `Bearer ${config.metroniaApiToken}`, // Include the Bearer Token
    //                         },
    //                         httpsAgent: new https.Agent({
    //                             rejectUnauthorized: false, // Ignore SSL certificate validation
    //                         }),
    //                     }
    //                 )
    //                 .then(async response => {
    //                     console.log("upgrade ticket response---", response.data);
    //                     // Handle the successful response
    //                     if(response && response.data){
    //                         // Send the response back to the client
    //                         if (response.data.error === 0) {
            
    //                             const dbResponse = await module.exports.addBalanceToTicketDb({
    //                                 machineName: "Metronia",
    //                                 roomId: roomId,
    //                                 ticketNumber: ticketNumber,
    //                                 balance: (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
    //                                 ticketId: machineTicket._id,
    //                                 playerId: playerId,
    //                                 username: player?.username || "",
    //                                 customerNumber: player?.customerNumber || "",
    //                                 playerAfterBalance: player?.walletAmount ?? 0,
    //                                 paymentType: paymentType,
    //                                 agentId: agentId,
    //                                 hallId: hallId,
    //                                 userType: userType,
    //                                 language: req.session.details.language,
    //                                 hall: req.session.details.hall[0],
    //                                 groupHall: hallsData.groupHall,
    //                                 agentName: req.session.details.name,
    //                                 addedAmount: ticketAmount
    //                             });
    //                             let result = {
    //                                 roomId: roomId,
    //                                 ticketNumber: ticketNumber,
    //                                 balance: (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
    //                                 ticketId: ticketNumber,
    //                                 paymentType: paymentType,
    //                                 ticketStatus: true
    //                             }
    //                             console.log("dbResponse----", dbResponse)
    //                             if(dbResponse && dbResponse.status == "success"){
    //                                 if (paymentType === "Cash") {
    //                                     req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2)
    //                                 }
    //                                 result.dailyBalance =  dbResponse.dailyBalance;
    //                             }   
    //                             return res.json({
    //                                 status:"success",
    //                                 result: result,
    //                                 message: translate.ticket_add_balance_success,
    //                             });
    //                         }
    //                         return res.json({
    //                             status:"fail",
    //                             message: `${response.data.error_str}`,
    //                         });
    //                     }
    //                 })
    //                 .catch(async error => {
    //                     console.error("Error occurred while upgrading ticket:", error);
    //                     await Sys.Game.Common.Services.PlayerServices.FindOneUpdate({ _id: machineTicket.playerId }, { $inc: { walletAmount: ticketAmount } });
    //                     return res.status(500).json({
    //                         status:"fail",
    //                         message: translate.something_went_wrong
    //                     });
    //                 });
                    
    //             } else {
    //                 return res.json({ status: "fail", message: translate.agent_not_found });
    //             }
    //         }else{
    //             return res.status(500).json({
    //                 status:"fail",
    //                 message: translate.you_are_not_allowed_to_perform_this_operation
    //             });
    //         }
           
    //     } catch (e) {
    //         console.log("Add balance metronia--", e)
    //         return res.status(500).json({
    //             status:"fail",
    //             message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
    //         });
    //     }
    // },

    // closeTicketMetronia: async function (req, res) {
    //     try {
    //         // Get the values from the request body
    //         const { ticketNumber } = req.body;
    //         const paymentType = "customerNumber";

    //         // Translation keys for dynamic messages
    //         let keys = [
    //             "agent_not_found",
    //             "please_ensure_previous_agent_logs_out",
    //             "previous_day_settlement_pending",
    //             "user_not_found",
    //             "something_went_wrong",
    //             "ticket_record_not_found",
    //             "ticket_already_closed",
    //             "you_are_not_allowed_to_perform_this_operation",
    //             "ticket_not_belog_to_user",
    //             "ticket_close_success"
    //         ];
    //         let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

    //         if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
    //             const hallId = req.session.details.hall[0].id;
    //             const agentId = req.session.details.id;

    //             let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
    //             if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
    //                 if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
    //                     return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
    //                 }
    //                 if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
    //                     return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
    //                 }

    //                 let machineTicket = await Sys.App.Services.slotmachineServices.getSingleData({ticketNumber: ticketNumber}, {playerId: 1, balance: 1, isClosed: 1, roomId: 1});
    //                 console.log("machineTicket---", machineTicket)
    //                 if(!machineTicket){
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_record_not_found,
    //                     });
    //                 }
    //                 if(machineTicket.isClosed == true){
    //                     return res.json({
    //                         status: "fail",
    //                         message: translate.ticket_already_closed,
    //                     });
    //                 }

    //                 let player = null;
    //                 if(machineTicket.playerId && paymentType == "customerNumber"){
    //                     let query = {
    //                         'approvedHalls': { $elemMatch: { 'id': req.session.details.hall[0].id } },
    //                         userType: "Online",
    //                        _id: machineTicket.playerId
    //                     };
    //                     player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, { username: 1, customerNumber: 1, walletAmount: 1, userType: 1 });
                        
    //                     if(!player){
    //                         return res.json({ status: "fail", message: translate.user_not_found });
    //                     }
    //                 }
    //                 const userType = player?.userType ?? 'Physical';
        
    //                 const roomId = machineTicket.roomId; 
    //                 const transaction = generateUniqueRandomNumber();

                   
            
    //                 // const dbResponse = await module.exports.cancelTicketDb({
    //                 //     machineName: "Metronia",
    //                 //     roomId: roomId,
    //                 //     ticketNumber: ticketNumber,
    //                 //     balance: 10,
    //                 //     ticketId: machineTicket._id,
    //                 //     playerId: player?.id || "",
    //                 //     username: player?.username || "",
    //                 //     customerNumber: player?.customerNumber || "",
    //                 //     playerAfterBalance: player?.walletAmount ?? 0,
    //                 //     paymentType: paymentType,
    //                 //     agentId: agentId,
    //                 //     hallId: hallId,
    //                 //     userType: userType,
    //                 //     language: req.session.details.language,
    //                 //     hall: req.session.details.hall[0],
    //                 //     groupHall: hallsData.groupHall,
    //                 //     agentName: req.session.details.name,
    //                 // });
    //                 // let result = {
    //                 //     roomId: roomId,
    //                 //     ticketNumber: ticketNumber,
    //                 //     balance: 10,
    //                 //     paymentType: paymentType
    //                 // }
    //                 // console.log("dbResponse----", dbResponse)
    //                 // if(dbResponse && dbResponse.status == "success"){
    //                 //     if (paymentType === "Cash") {
    //                 //         req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2)
    //                 //     }
    //                 //     result.dailyBalance =  dbResponse.dailyBalance;
    //                 // }   
    //                 // return res.json({
    //                 //     status:"success",
    //                 //     result: result,
    //                 //     message: translate.ticket_close_success,
    //                 // });
                    
    //                 // Call to the third-party API
    //                 axios.post(
    //                     `${config.metroniaApiURL}/close-ticket`,
    //                     { 
    //                         ticket: +ticketNumber, 
    //                         room_id: roomId,
    //                         transaction
    //                     },
    //                     {
    //                         headers: {
    //                             'Content-Type': 'application/json',
    //                             'Authorization': `Bearer ${config.metroniaApiToken}`, // Include the Bearer Token
    //                         },
    //                         httpsAgent: new https.Agent({
    //                             rejectUnauthorized: false, // Ignore SSL certificate validation
    //                         }),
    //                     }
    //                 )
    //                 .then(async (response) => {
    //                     console.log("Close ticket response---", response.data);
    //                     if(response && response.data){
    //                         // Send the response back to the client
    //                         if (response.data.error === 0) {
            
    //                             const dbResponse = await module.exports.cancelTicketDb({
    //                                 machineName: "Metronia",
    //                                 roomId: roomId,
    //                                 ticketNumber: ticketNumber,
    //                                 balance: (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
    //                                 ticketId: machineTicket._id,
    //                                 playerId: player?.id || "",
    //                                 username: player?.username || "",
    //                                 customerNumber: player?.customerNumber || "",
    //                                 playerAfterBalance: player?.walletAmount ?? 0,
    //                                 paymentType: paymentType,
    //                                 agentId: agentId,
    //                                 hallId: hallId,
    //                                 userType: userType,
    //                                 language: req.session.details.language,
    //                                 hall: req.session.details.hall[0],
    //                                 groupHall: hallsData.groupHall,
    //                                 agentName: req.session.details.name,
    //                             });
    //                             let result = {
    //                                 roomId: roomId,
    //                                 ticketNumber: ticketNumber,
    //                                 balance: (response.data.balance) ?  +exactMath.div(response.data.balance, 100).toFixed(2): 0,
    //                                 paymentType: paymentType,
    //                                 ticketStatus: true
    //                             }
    //                             console.log("dbResponse----", dbResponse)
    //                             if(dbResponse && dbResponse.status == "success"){
    //                                 if (paymentType === "Cash") {
    //                                     req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2)
    //                                 }
    //                                 result.dailyBalance =  dbResponse.dailyBalance;
    //                                 result.ticketStatus = false
    //                             }   
    //                             return res.json({
    //                                 status:"success",
    //                                 result: result,
    //                                 message: translate.ticket_close_success,
    //                             });
    //                         }
    //                         return res.json({
    //                             status:"fail",
    //                             message: `${response.data.error_str}`,
    //                         });
    //                     }
    //                 })
    //                 .catch((error) => {
    //                     // Handle error
    //                     return res.status(500).json({
    //                         status:"fail",
    //                         message: translate.something_went_wrong
    //                     });
    //                 });
    //             } else {
    //                 return res.json({ status: "fail", message: translate.agent_not_found });
    //             }
    //         }else{
    //             return res.status(500).json({
    //                 status:"fail",
    //                 message: translate.you_are_not_allowed_to_perform_this_operation
    //             });
    //         }


           
    //     } catch (e) {
    //         return res.status(500).json({
    //             status:"fail",
    //             message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
    //         });
    //     }
    // },

    // close tickets one by one
    // closeAllTicketMetronia1: async function (req, res) {
    //     try {
    //         // Translation keys for dynamic messages
    //         let keys = [
    //             "agent_not_found",
    //             "please_ensure_previous_agent_logs_out",
    //             "previous_day_settlement_pending",
    //             "user_not_found",
    //             "something_went_wrong",
    //             "ticket_already_closed",
    //             "you_are_not_allowed_to_perform_this_operation",
    //             "ticket_not_belog_to_user",
    //             "close_all_tickets_success"
    //         ];
    //         let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);

    //         if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
    //             const hallId = req.session.details.hall[0].id;
    //             const agentId = req.session.details.id;

    //             let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
    //             if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
    //                 if (hallsData.activeAgents.some(agent => agent.id == agentId) == false) {
    //                     return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
    //                 }
    //                 if (hallsData.otherData?.isPreviousDaySettlementPending == true) {
    //                     return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
    //                 }

    //                 const startOfDay = moment().startOf('day').toDate();
    //                 const endOfDay = moment().endOf('day').toDate();

    //                 let allTodaysActiveTickets = await Sys.App.Services.slotmachineServices.getByData({isClosed: false, createdAt: {$gte: startOfDay, $lte: endOfDay} }, {playerId: 1, balance: 1, isClosed: 1, roomId: 1, ticketNumber: 1});
    //                 console.log("allTodaysActiveTickets---", allTodaysActiveTickets)
    //                 let processedTickets = [];

    //                 for (let t = 0; t < allTodaysActiveTickets.length; t++) {
    //                     try {
    //                         let machineTicket = allTodaysActiveTickets[t];
    //                         let ticketNumber = +machineTicket.ticketNumber;
    //                         let paymentType = machineTicket.playerId ? "customerNumber" : "Cash";

    //                         if (machineTicket.isClosed) {
    //                             continue;
    //                         }

    //                         let player = null;
    //                         if (machineTicket.playerId && paymentType === "customerNumber") {
    //                             let query = {
    //                                 'approvedHalls': { $elemMatch: { 'id': hallId } },
    //                                 userType: "Online",
    //                                 _id: machineTicket.playerId
    //                             };
    //                             player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, {
    //                                 username: 1, customerNumber: 1, walletAmount: 1, userType: 1
    //                             });

    //                             if (!player) {
    //                                 continue;
    //                             }
    //                         }

    //                         const userType = player?.userType ?? 'Physical';
    //                         const roomId = machineTicket.roomId;
    //                         const transaction = generateUniqueRandomNumber();

    //                         // Call to the third-party API
    //                         let response = await axios.post(
    //                             `${config.metroniaApiURL}/close-ticket`,
    //                             { ticket: ticketNumber, room_id: roomId, transaction },
    //                             {
    //                                 headers: {
    //                                     'Content-Type': 'application/json',
    //                                     'Authorization': `Bearer ${config.metroniaApiToken}`,
    //                                 },
    //                                 httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    //                             }
    //                         );
                            
    //                         if (response?.data?.error === 0) {
    //                             let dbResponse = await module.exports.cancelTicketDb({
    //                                 machineName: "Metronia",
    //                                 roomId: roomId,
    //                                 ticketNumber: ticketNumber,
    //                                 balance: response.data.balance ? +exactMath.div(response.data.balance, 100).toFixed(2) : 0,
    //                                 ticketId: machineTicket._id,
    //                                 playerId: player?.id || "",
    //                                 username: player?.username || "",
    //                                 customerNumber: player?.customerNumber || "",
    //                                 playerAfterBalance: player?.walletAmount ?? 0,
    //                                 paymentType: paymentType,
    //                                 agentId: agentId,
    //                                 hallId: hallId,
    //                                 userType: userType,
    //                                 language: req.session.details.language,
    //                                 hall: req.session.details.hall[0],
    //                                 groupHall: hallsData.groupHall,
    //                                 agentName: req.session.details.name,
    //                             });

    //                             processedTickets.push({
    //                                 roomId,
    //                                 ticketNumber,
    //                                 balance: response.data.balance ? +exactMath.div(response.data.balance, 100).toFixed(2) : 0,
    //                                 paymentType,
    //                                 ticketStatus: dbResponse?.status === "success"
    //                             });

    //                             if (paymentType === "Cash" && dbResponse?.status === "success") {
    //                                 req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2);
    //                             }
    //                         } else {
    //                             console.log("error from api", response?.data?.error_str)
    //                             processedTickets.push({
    //                                 roomId,
    //                                 ticketNumber,
    //                                 balance: 0,
    //                                 paymentType,
    //                                 ticketStatus: false,
    //                                 error: response?.data?.error_str
    //                             });
    //                         }
    //                     } catch (error) {
    //                         console.error(`Error processing ticket ${t}:`, error);
    //                         processedTickets.push({
    //                             ticketNumber: allTodaysActiveTickets[t]?.ticketNumber || "Unknown",
    //                             ticketStatus: false,
    //                             error: error.message
    //                         });
    //                     }
    //                 }

    //                 return res.json({
    //                     status: "success",
    //                     message: translate.close_all_tickets_success,
    //                     tickets: processedTickets
    //                 });
                    
    //             } else {
    //                 return res.json({ status: "fail", message: translate.agent_not_found });
    //             }
    //         }else{
    //             return res.status(500).json({
    //                 status:"fail",
    //                 message: translate.you_are_not_allowed_to_perform_this_operation
    //             });
    //         }


           
    //     } catch (e) {
    //         return res.status(500).json({
    //             status:"fail",
    //             message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
    //         });
    //     }
    // },

    // close all tickets using p-limit, Not using
    // closeAllTicketMetronia: async function (req, res) {
    //     try {
    //         const { machineName } = req.body;
    //         // Translation keys for dynamic messages
    //         let keys = [
    //             "agent_not_found",
    //             "please_ensure_previous_agent_logs_out",
    //             "previous_day_settlement_pending",
    //             "user_not_found",
    //             "something_went_wrong",
    //             "ticket_already_closed",
    //             "you_are_not_allowed_to_perform_this_operation",
    //             "ticket_not_belog_to_user",
    //             "close_all_tickets_success"
    //         ];
    //         let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
    
    //         if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
    //             const hallId = req.session.details.hall[0].id;
    //             const agentId = req.session.details.id;
    
    //             let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
    //             if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
    //                 if (!hallsData.activeAgents.some(agent => agent.id == agentId)) {
    //                     return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
    //                 }
    //                 if (hallsData.otherData?.isPreviousDaySettlementPending) {
    //                     return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
    //                 }
    
    //                 const startOfDay = moment().startOf('day').toDate();
    //                 const endOfDay = moment().endOf('day').toDate();
    
    //                 let allTodaysActiveTickets = await Sys.App.Services.slotmachineServices.getByData({
    //                     machineName: machineName, isClosed: false, createdAt: { $gte: startOfDay, $lte: endOfDay }
    //                 }, { playerId: 1, balance: 1, isClosed: 1, roomId: 1, ticketNumber: 1 });
                    
    //                 let processedTickets = [];
    //                 const pLimit = (await import('p-limit')).default; // Dynamically load p-limit
    //                 // Use pLimit as needed
    //                 const limit = pLimit(10);  // Adjust concurrency limit as needed
    //                 // Process all tickets concurrently with a limit on the number of concurrent operations
    //                 const ticketProcessingPromises = allTodaysActiveTickets.map(ticket => limit(async () => {
    //                     try {
    //                         let machineTicket = ticket;
    //                         let ticketNumber = +machineTicket.ticketNumber;
    //                         let paymentType = machineTicket.playerId ? "customerNumber" : "Cash";
    
    //                         if (machineTicket.isClosed) {
    //                             return;
    //                         }
    
    //                         let player = null;
    //                         if (machineTicket.playerId && paymentType === "customerNumber") {
    //                             let query = {
    //                                 'approvedHalls': { $elemMatch: { 'id': hallId } },
    //                                 userType: "Online",
    //                                 _id: machineTicket.playerId
    //                             };
    //                             player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, {
    //                                 username: 1, customerNumber: 1, walletAmount: 1, userType: 1
    //                             });
    
    //                             if (!player) {
    //                                 return;
    //                             }
    //                         }
    
    //                         const userType = player?.userType ?? 'Physical';
    //                         const roomId = machineTicket.roomId;
    //                         const transaction = generateUniqueRandomNumber();
    
    //                         // Call to the third-party API
    //                         let response = await axios.post(
    //                             `${config.metroniaApiURL}/close-ticket`,
    //                             { ticket: ticketNumber, room_id: roomId, transaction: transaction.toString() },
    //                             {
    //                                 headers: {
    //                                     'Content-Type': 'application/json',
    //                                     'Authorization': `Bearer ${config.metroniaApiToken}`,
    //                                 },
    //                                 httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    //                             }
    //                         );
                            
    //                         if (response?.data?.error === 0) {
    //                             let dbResponse = await module.exports.cancelTicketDb({
    //                                 machineName: "Metronia",
    //                                 roomId: roomId,
    //                                 ticketNumber: ticketNumber,
    //                                 balance: response.data.balance ? +exactMath.div(response.data.balance, 100).toFixed(2) : 0,
    //                                 ticketId: machineTicket._id,
    //                                 playerId: player?.id || "",
    //                                 username: player?.username || "",
    //                                 customerNumber: player?.customerNumber || "",
    //                                 playerAfterBalance: player?.walletAmount ?? 0,
    //                                 paymentType: paymentType,
    //                                 agentId: agentId,
    //                                 hallId: hallId,
    //                                 userType: userType,
    //                                 language: req.session.details.language,
    //                                 hall: req.session.details.hall[0],
    //                                 groupHall: hallsData.groupHall,
    //                                 agentName: req.session.details.name,
    //                             });
    
    //                             processedTickets.push({
    //                                 roomId,
    //                                 ticketNumber,
    //                                 balance: response.data.balance ? +exactMath.div(response.data.balance, 100).toFixed(2) : 0,
    //                                 paymentType,
    //                                 ticketStatus: dbResponse?.status === "success"
    //                             });
    
    //                             if (paymentType === "Cash" && dbResponse?.status === "success") {
    //                                 req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2);
    //                             }
    //                         } else {
    //                             processedTickets.push({
    //                                 roomId,
    //                                 ticketNumber,
    //                                 balance: 0,
    //                                 paymentType,
    //                                 ticketStatus: false,
    //                                 error: response?.data?.error_str
    //                             });
    //                         }
    //                     } catch (error) {
    //                         console.error(`Error processing ticket ${ticket.ticketNumber}:`, error);
    //                         processedTickets.push({
    //                             ticketNumber: ticket?.ticketNumber || "Unknown",
    //                             ticketStatus: false,
    //                             error: error.message
    //                         });
    //                     }
    //                 }));
                   
    //                 // Wait for all ticket processing promises to resolve
    //                 await Promise.all(ticketProcessingPromises);
    
    //                 return res.json({
    //                     status: "success",
    //                     message: translate.close_all_tickets_success,
    //                     tickets: processedTickets
    //                 });
    //             } else {
    //                 return res.json({ status: "fail", message: translate.agent_not_found });
    //             }
    //         } else {
    //             return res.status(500).json({
    //                 status: "fail",
    //                 message: translate.you_are_not_allowed_to_perform_this_operation
    //             });
    //         }
    //     } catch (e) {
    //         return res.status(500).json({
    //             status: "fail",
    //             message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
    //         });
    //     }
    // },

    // close all tickets of all machines, use for Ok Bingo, not using
    // closeAllTicketOfOKBingo: async function (req, res) {
    //     try {
    //         const { machineName } = req.body;
    //         // Translation keys for dynamic messages
    //         let keys = [
    //             "agent_not_found",
    //             "please_ensure_previous_agent_logs_out",
    //             "previous_day_settlement_pending",
    //             "user_not_found",
    //             "something_went_wrong",
    //             "ticket_already_closed",
    //             "you_are_not_allowed_to_perform_this_operation",
    //             "ticket_not_belog_to_user",
    //             "close_all_tickets_success"
    //         ];
    //         let translate = await Sys.Helper.bingo.getTraslateData(keys, req.session.details.language);
    
    //         if (req.session.login && req.session.details.is_admin != 'yes' && req.session.details.role == "agent") {
    //             const hallId = req.session.details.hall[0].id;
    //             const agentId = req.session.details.id;
    
    //             let hallsData = await Sys.App.Services.HallServices.getSingleHallData({ _id: hallId }, { activeAgents: 1, groupHall: 1, otherData: 1 });
    //             if (hallsData && hallsData.activeAgents && hallsData.activeAgents.length > 0) {
    //                 if (!hallsData.activeAgents.some(agent => agent.id == agentId)) {
    //                     return res.json({ status: "fail", message: translate.please_ensure_previous_agent_logs_out });
    //                 }
    //                 if (hallsData.otherData?.isPreviousDaySettlementPending) {
    //                     return res.json({ status: "fail", message: translate.previous_day_settlement_pending });
    //                 }

    //                 const startOfDay = moment().startOf('day').toDate();
    //                 const endOfDay = moment().endOf('day').toDate();
    
    //                 let allTodaysActiveTickets = await Sys.App.Services.slotmachineServices.getByData({
    //                     machineName: machineName, isClosed: false, createdAt: { $gte: startOfDay, $lte: endOfDay }
    //                 }, { playerId: 1, balance: 1, isClosed: 1, roomId: 1, ticketNumber: 1, uniqueTransaction: 1 });
                    
    //                 let processedTickets = [];
                    
    //                 if(allTodaysActiveTickets.length > 0){
    //                     for (let t = 0; t < allTodaysActiveTickets.length; t++) {
    //                         try {
    //                             let machineTicket = allTodaysActiveTickets[t];
    //                             let ticketNumber = +machineTicket.ticketNumber;
    //                             let paymentType = machineTicket.playerId ? "customerNumber" : "Cash";
    
    //                             if (machineTicket.isClosed) {
    //                                 continue;
    //                             }
    
    //                             let player = null;
    //                             if (machineTicket.playerId && paymentType === "customerNumber") {
    //                                 let query = {
    //                                     'approvedHalls': { $elemMatch: { 'id': hallId } },
    //                                     userType: "Online",
    //                                     _id: machineTicket.playerId
    //                                 };
    //                                 player = await Sys.App.Services.PlayerServices.getSinglePlayerData(query, {
    //                                     username: 1, customerNumber: 1, walletAmount: 1, userType: 1
    //                                 });
    
    //                                 if (!player) {
    //                                     continue;
    //                                 }
    //                             }
    
    //                             const userType = player?.userType ?? 'Physical';
    //                             const roomId = machineTicket.roomId;
                               
    //                             let response = await module.exports.createOkBingoAPI({ roomId: +roomId, ticketNumber: +ticketNumber, transaction: machineTicket.uniqueTransaction, commandId: 3});
    //                             console.log("close ticket response---", response);
    //                             if (!response || Object.keys(response).length === 0) {
    //                                 processedTickets.push({
    //                                     roomId,
    //                                     ticketNumber,
    //                                     balance: 0,
    //                                     paymentType,
    //                                     ticketStatus: false,
    //                                     error: "No response form API"
    //                                 });
    //                                 continue;
    //                             }
    //                             if (response.error === 0) {
    //                                 const dbResponse = await module.exports.cancelTicketDb({
    //                                     machineName: machineName,
    //                                     roomId: roomId,
    //                                     ticketNumber: ticketNumber,
    //                                     balance: (response.balance) ?  +exactMath.div(response.balance, 100).toFixed(2): 0,
    //                                     ticketId: machineTicket._id,
    //                                     playerId: player?.id || "",
    //                                     username: player?.username || "",
    //                                     customerNumber: player?.customerNumber || "",
    //                                     playerAfterBalance: player?.walletAmount ?? 0,
    //                                     paymentType: paymentType,
    //                                     agentId: agentId,
    //                                     hallId: hallId,
    //                                     userType: userType,
    //                                     language: req.session.details.language,
    //                                     hall: req.session.details.hall[0],
    //                                     groupHall: hallsData.groupHall,
    //                                     agentName: req.session.details.name,
    //                                 });
                        
    //                                 processedTickets.push({
    //                                     roomId,
    //                                     ticketNumber,
    //                                     balance: response.balance ? +exactMath.div(response.balance, 100).toFixed(2) : 0,
    //                                     paymentType,
    //                                     ticketStatus: dbResponse?.status === "success"
    //                                 });
                        
    //                                 if (paymentType === "Cash" && dbResponse?.status === "success") {
    //                                     req.session.details.dailyBalance = +parseFloat(dbResponse.dailyBalance).toFixed(2);
    //                                 }
    //                             }else{
    //                                 processedTickets.push({
    //                                     roomId,
    //                                     ticketNumber,
    //                                     balance: 0,
    //                                     paymentType,
    //                                     ticketStatus: false,
    //                                     error: response?.error_str
    //                                 });
    //                             }
    //                         } catch (error) {
    //                             console.error(`Error processing ticket ${allTodaysActiveTickets[t]}:`, error);
    //                             processedTickets.push({
    //                                 ticketNumber: allTodaysActiveTickets[t]?.ticketNumber || "Unknown",
    //                                 ticketStatus: false,
    //                                 error: error.message
    //                             });
    //                         }
    //                     }
    //                 }

    //                 return res.json({
    //                     status: "success",
    //                     message: translate.close_all_tickets_success,
    //                     tickets: processedTickets
    //                 });
    //             } else {
    //                 return res.json({ status: "fail", message: translate.agent_not_found });
    //             }
    //         } else {
    //             return res.status(500).json({
    //                 status: "fail",
    //                 message: translate.you_are_not_allowed_to_perform_this_operation
    //             });
    //         }
    //     } catch (e) {
    //         console.log("Error in closeAllTicketOfMachine", e)
    //         return res.status(500).json({
    //             status: "fail",
    //             message: await Sys.Helper.bingo.getSingleTraslateData(["something_went_wrong"], req.session.details.language)
    //         });
    //     }
    // },
}

// Generate a unique transaction ID
const generateUniqueRandomNumber = () => {
    return Date.now(); // + Math.floor(Math.random() * 1000); // Combining timestamp with random component
};
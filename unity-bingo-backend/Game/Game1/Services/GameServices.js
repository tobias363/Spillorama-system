'use strict';

const mongoose = require('mongoose');
var Sys = require('../../../Boot/Sys');
const gameModel = mongoose.model('game');
const hallModel = mongoose.model('hall');
const gameType = mongoose.model('gameType');
const Loyalty = mongoose.model('loyalty');
const Voucher = mongoose.model('Voucher');
const leaderboard = mongoose.model('Leaderboard');
const tickets = mongoose.model('Ticket');
const staticTicketModel = mongoose.model('staticTicket');
const TicketBallMappingsModel = mongoose.model('TicketBallMapping');
module.exports = {

    // tickets Services

    getTicketListData: async function (data, columns) {
        try {
            return await tickets.find(data).select(columns);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketData: async function (data) {
        try {
            return await tickets.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleTicketData: async function (data) {
        try {
            return await tickets.findOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateTicket: async function (id, query) {
        try {
            let player = await tickets.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            console.log("Error in Update Player : ", error);
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },

    updateManyTicketData: async function (condition, data, options = {}) {
        try {
            return await tickets.updateMany(condition, data, options);
        } catch (e) {
            console.log(" Error in updateManyData ticket", e);
            return new Error(e);
        }
    },

    aggregateQueryTickets: async function (data) {
        try {
            return await tickets.aggregate(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketDataLimited: async function (query, start, length) {
        try {
            return await tickets.find(query).skip(start).limit(length);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getTicketCount: async function (data) {
        try {
            return await tickets.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    findOneAndUpdateTicket: async function (condition, query, filter) {
        try {
            let ticket = await tickets.findOneAndUpdate(condition, query, filter);
            return ticket;
        } catch (error) {
            Sys.Log.info('Error in find and Update Ticket : ' + error);
        }
    },

    updateTicketNested: async function (condition, query, filter) {
        try {
            let player = await tickets.findOneAndUpdate(condition, query, filter);
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Ticket : ' + error);
        }
    },

    bulkWriteTicketData: async function (data,options) {
        try {
            return await tickets.bulkWrite(data, options);
        } catch (error) {
            console.log("Error in bulkWriteTicketData", error);
            return new Error(error);
        }
    },

    //*************************************************************************************************** */
    // Game Type Services
    createList: async function (data) {
        try {
            return await gameType.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getListData: async function (data) {
        try {
            return await gameType.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },


    getSingleGameTypeData: async function (data) {
        try {
            return await gameType.findOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    //*************************************************************************************************** */

    // Hall Services
    getHallData: async function (data) {
        try {
            return await hallModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleHallData: async function (data) {
        try {
            return await hallModel.findOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    //*************************************************************************************************** */

    // leaderboard Services
    getleaderboardData: async function (data, column) {
        try {
            return await leaderboard.find(data).select(column);
        } catch (e) {
            console.log("Error", e);
        }
    },

    //*************************************************************************************************** */


    // Voucher Services
    getVoucherData: async function (data) {
        try {
            return await Voucher.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    //*************************************************************************************************** */

    // Loyalty Services
    getLoyaltyData: async function (data) {
        try {
            return await Loyalty.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    //*************************************************************************************************** */

    // Game Services
    getByData: async function (data, select, setOption) {

        try {
            return await gameModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateGame: async function (id, query) {
        try {
            let player = await gameModel.updateOne({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update game : ' + error);
        }
    },

    updateManyData: async function (condition, data) {
        try {
            return await gameModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateData", e);
            return new Error(e);
        }
    },
    getGameData: async function (data) {
        try {
            return await gameModel.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameCount: async function (data) {
        try {
            return await gameModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleGameData: async function (data) {
        try {
            return await gameModel.findOne(data).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleByData: async function (data, select, setOption) {
        try {
            return await gameModel.findOne(data, select, setOption).sort({ specialGame: -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleGameByData: async function (data, select, setOption) {
        try {
            return await gameModel.findOne(data, select, setOption);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getGameDatatable: async function (query, length, start) {
        try {
            return await gameModel.find(query).skip(start).limit(length).sort({ createdAt: -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },



    getLimitedGame: async function (data) {
        try {
            return await gameModel.find(data).limit(10).sort({ createdAt: -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    aggregateQuery: async function (data) {
        try {
            return await gameModel.aggregate(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    get: async function (id) {
        try {
            console.log("get", id);
            if (Sys.Rooms[id]) {
                return Sys.Rooms[id];
            } else {
                let room = await gameModel.findOne({ _id: id });
                console.log("RoomService Get function 1", room._id, "2", room.id);
                console.log("Sys.Rooms[]", Sys.Rooms);
                console.log("Sys.Rooms[room.id]", Sys.Rooms[room.id]);
                Sys.Rooms[room.id] = new room;
                return Sys.Rooms[room.id];
            }
        } catch (error) {
            Sys.Log.info('Error in Get Room : ' + error);
        }
    },

    bulkWriteGameData: async function (data, options) {
        try {
            return await gameModel.bulkWrite(data, options);
        } catch (error) {
            console.log("Error in bulkWriteGameData", error);
            return new Error(error);
        }
    },



    getStaticByData: async function (data, select, setOption) {
        try {
            return await staticTicketModel.find(data, select, setOption);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateStaticGameCustom: async function (condition, query) {
        try {
            //let game = await staticTicketModel.updateOne(condition, query, { new: true });
            let game = await staticTicketModel.findOneAndUpdate(condition, query, { new: true });
            return game;
        } catch (error) {
            Sys.Log.info('Error in Update game : ' + error);
        }
    },

    updateManyStaticData: async function (condition, data) {
        try {
            return await staticTicketModel.updateMany(condition, data);
        } catch (e) {
            console.log(" Error in updateData", e);
            return new Error(e);
        }
    },

    getSampleStaticTicketsData: async function (query, select, count) {
        try {
            return await staticTicketModel.aggregate([
                { $match: query },
                { $sample: { size: count } },
                { $project: select },
            ]);
        } catch (e) {
            throw new Error('error in getTicketsDataTable' + e.message);
        }
    },

    updateGameNested: async function (condition, query, filter) {
        try {
            console.log("query", condition, JSON.stringify(query), JSON.stringify(filter));
            let player = await gameModel.findOneAndUpdate(condition, query, filter);
            return player;
        } catch (error) {
            console.log("Error in Update Ticket :", error);
            Sys.Log.info('Error in Update Ticket : ' + error);
        }
    },

    updateGameNew: async function (id, query) {
        try {
            let player = await gameModel.findOneAndUpdate({ _id: id }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update Player : ' + error);
        }
    },

    updateTicketPattern: async function (id, ticketId, query) {
        try {
            let player = await gameModel.updateOne({ _id: id, "purchasedTickets.ticketId": ticketId }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update game : ' + error);
        }
    },

    updateLuckyNumber: async function (id, playerId, query) {
        try {
            let player = await gameModel.updateOne({ _id: id, "players.id": playerId }, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in Update game : ' + error);
        }
    },

    customGameUpdate: async function (condition, query) {
        try {
            let player = await gameModel.updateOne(condition, query, { new: true });
            return player;
        } catch (error) {
            Sys.Log.info('Error in customGameUpdate game : ' + error);
        }
    },

    updateAllStaticTicket: async function () {
        try {
            console.log("updateAllStaticTicket----")
            let data = await staticTicketModel.updateMany(
                {},
                { $unset: { ticketTempId: "" } }
            )
            console.log("data---", data)
            // staticTicketModel.find({}).lean().cursor()
            // .on('data', async (allPurchasedTickets) => {
            //     // let ticketArray = [];
            //     // for(let t=0; t < allPurchasedTickets.tickets.length; t++){
            //     //     for(let p=0; p < allPurchasedTickets.tickets[t].length; p++){
            //     //         ticketArray.push(allPurchasedTickets.tickets[t][p].Number)
            //     //     }
            //     // }
            //     //await Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: allPurchasedTickets._id }, { ticketsArray: ticketArray  });

            //     //let string = allPurchasedTickets.ticketsArray.join("");
            //     //await Sys.Game.Game1.Services.GameServices.updateStaticGameCustom({ _id: allPurchasedTickets._id }, { ticketTempId: string  });

            // })
            // .on('end', async () => {
            //     console.log("end of stream");

            // })
            // .on('error', (error) => {
            //     console.log("error in moveDocuments", error)
            // }).on('close', () => {
            //     return true;
            // });
        } catch (e) {
            console.log("error")
        }
    },

    //*************************************************************************************************** */

    // Ticket Ball Mapping by 
    getBallMappingsByData: async function (data, select, setOption) {
        try {
            return await TicketBallMappingsModel.find(data, select, setOption).lean();
        } catch (e) {
            console.log("Error", e);
        }
    },

    bulkWriteTicketBallMappingData: async function (data,options) {
        try {
            return await TicketBallMappingsModel.bulkWrite(data, options);
        } catch (error) {
            console.log("Error in bulkWriteTicketBallMappingData", error);
            return new Error(error);
        }
    },
    
    deleteManyBallMappingsByData: async function (data) {
        try {
            return await TicketBallMappingsModel.deleteMany(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    

}
'use strict';
const mongoose = require('mongoose');
const backgroundModel = mongoose.model('background');
const themeModel = mongoose.model('theme');


module.exports = {

    getByData: async function(data) {
        try {
            return await backgroundModel.find(data);
        } catch (e) {
            console.log("BackgroundServices Error in getByData", e);
            return new Error(e);
        }
    },
    getSingleBackgroundData: async function(data) {
        try {
            return await backgroundModel.findOne(data);
        } catch (e) {
            console.log("BackgroundServices Error in getSingleBackgroundData", e);
            return new Error(e);
        }
    },
    getSingleThemeData: async function(data) {
        try {
            return await themeModel.findOne(data);
        } catch (e) {
            console.log("OtherServices Error in getSingleThemeData", e);
            return new Error(e);
        }
    },
    getAllBackgroundDataSelect: async function(data, column) {
        try {
            return await backgroundModel.find(data).select(column);
        } catch (e) {
            console.log("BackgroundServices Error in getSinglePlayerData", e);
            return new Error(e);
        }
    },
    getById: async function(id) {
        try {
            return await backgroundModel.findById(id);
        } catch (error) {
            console.log('BackgroundServices Error in getById : ', error);
        }
    },
    getBackgroundDatatable: async function(data) {
        try {
            return await backgroundModel.find(data);
        } catch (e) {
            console.log("BackgroundServices Error in getPlayerData", e);
            return new Error(e);
        }
    },

    getBackgroundCount: async function(data) {
        try {
            return await backgroundModel.countDocuments(data);
        } catch (e) {
            console.log("BackgroundServices Error in getBackgroundCount", e);
            return new Error(e);
        }
    },
    insertData: async function(data) {
        try {
            await themeModel.create(data);
            return true;
        } catch (e) {
            console.log("OtherServices Error in insertData", e);
            return new Error(e);
        }
    },
    insertBackgroundData: async function(data) {
        let session = await mongoose.startSession();
        session.startTransaction();
        try {
            await backgroundModel.create(data);
            return true;
        } catch (e) {
            console.log("BackgroundServices Error in insertBackgroundData", e);
            await session.abortTransaction();
            session.endSession();
            return new Error(e);
        }
    },

    // insertBackgroundData: async function(data){
    //   let session = await mongoose.startSession();
    //   session.startTransaction();
    //     try {
    //       let tmpData = {
    //         name: 'test',
    //         email: 'test',            
    //         phone: 77,
    //         password : 'test',
    //         hallName: 'test'
    //       };
    //       let tmpData32 = {
    //         name: 'test',
    //         email: 'test',            
    //         phone: 'sdrr',
    //         password : 'test',
    //         hallName: 'test'
    //       };
    //       tmpData.uniqId = 'Bingo'+(await backgroundModel.countDocuments({}) + 1000);
    //       tmpData32.uniqId = 'Bingo'+(await backgroundModel.countDocuments({}) + 1000);
    //       let ss = await backgroundModel.create([tmpData], { session: session });
    //       let ss32 = await backgroundModel.create([tmpData32], { session: session });
    //       await session.commitTransaction();
    //       session.endSession();
    //       return true;
    //     } catch (e) {
    //       console.log("BackgroundServices Error in insertBackgroundData",e);
    //       await session.abortTransaction();
    //       session.endSession();
    //       return new Error(e);
    //     }
    // },

    deleteBackground: async function(data) {
        try {
            return await backgroundModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("BackgroundServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    getPlayerDatatable: async function(query, length, start, column) {
        try {
            if (length == -1) {
                return await backgroundModel.find(query).lean();
            } else {
                return await backgroundModel.find(query).skip(start).limit(length).select(column).lean();
            }
        } catch (e) {
            console.log("BackgroundServices Error in getPlayerDataTable", e);
            return new Error(e);
        }
    },

    insertBackgroundData: async function(data) {
        try {
            data.uniqId = 'Bingo' + (await backgroundModel.countDocuments({}) + 1000);
            return await backgroundModel.create(data);
        } catch (e) {
            console.log("BackgroundServices Error in insertPlayerData", e);
            return new Error(e);
        }
    },

    deletePlayer: async function(data) {
        try {
            return await backgroundModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("BackgroundServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    updateBackgroundData: async function(condition, data) {
        try {
            return await backgroundModel.updateOne(condition, data);
        } catch (e) {
            console.log("BackgroundServices Error in updatePlayerData", e);
            return new Error(e);
        }
    },

    updateData: async function(condition, data) {
        try {
            return await themeModel.updateOne(condition, data);
        } catch (e) {
            console.log("BackgroundServices Error in updatePlayerData", e);
            return new Error(e);
        }
    },
    getLimitPlayer: async function(data) {
        try {
            return await backgroundModel.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("BackgroundServices Error in getLimitPlayer", e);
            return new Error(e);
        }
    },

    getLimitedPlayerWithSort: async function(data, limit, sortBy, sortOrder) {
        try {
            return await backgroundModel.find(data).sort({ chips: sortOrder }).limit(limit);
        } catch (e) {
            console.log("BackgroundServices Error in getLimitedPlayerWithSort", e);
            return new Error(e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await backgroundModel.aggregate(data);
        } catch (e) {
            console.log("BackgroundServices Error in aggregateQuery", e);
            return new Error(e);
        }
    },

    updateMultiplePlayerData: async function(condition, data) {
        try {
            await backgroundModel.updateMany(condition, data, { multi: true });
        } catch (e) {
            console.log("BackgroundServices Error in updateMultiplePlayerData", e);
            return new Error(e);
        }
    },

    getPlayerExport: async function(query, pageSize) {
        try {
            return await backgroundModel.find(query).limit(pageSize);
        } catch (e) {
            console.log("BackgroundServices Error in getPlayerExport", e);
            return new Error(e);
        }
    },

    getLoggedInTokens: async function() {
        try {
            return await backgroundModel.find({ loginToken: { $ne: null } }).select({ loginToken: 1, _id: 0 });
        } catch (e) {
            console.log("Error", e);
            return new Error(e);
        }
    },


}
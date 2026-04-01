'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const subGame1Model = mongoose.model('subGame1');


module.exports = {

    getByData: async function(data) {
        try {
            return await subGame1Model.find(data);
        } catch (e) {
            console.log("subGame1Services Error in getByData", e);
            return new Error(e);
        }
    },
    getById: async function(id) {
        try {
            return await subGame1Model.findById(id);
        } catch (error) {
            console.log('subGame1Services Error in getById : ', error);
        }
    },

    getDatatable: async function(query, length, start) {
        try {
            return await subGame1Model.find(query).skip(start).limit(length).sort({ "createdAt": -1 });
        } catch (e) {
            console.log("subGame1Services Error in getDatatable", e);
            return new Error(e);
        }
    },

    getCount: async function(data) {
        try {
            return await subGame1Model.countDocuments(data);
        } catch (e) {
            console.log("subGame1Services Error in count", e);
            return new Error(e);
        }
    },

    getSingleData: async function(data, column) {
        try {
            return await subGame1Model.findOne(data);
        } catch (e) {
            console.log("subGame1Services Error in getSinglePlayerData", e);
            return new Error(e);
        }
    },
    getSingleDatawithSelect: async function(data, column) {
        try {
            return await subGame1Model.findOne(data).select(column);
        } catch (e) {
            console.log("subGame1Services Error in getSingleDatawithSelect", e);
            return new Error(e);
        }
    },

    getAllDataSelect: async function(data, column) {
        try {
            return await subGame1Model.find(data).select(column);
        } catch (e) {
            console.log("subGame1Services Error in getSinglePlayerData", e);
            return new Error(e);
        }
    },

    getSelectDatatable: async function(query, length, start, column) {
        try {
            if (length == -1) {
                return await subGame1Model.find(query).lean();
            } else {
                return await subGame1Model.find(query).skip(start).limit(length).select(column).lean();
            }
        } catch (e) {
            console.log("subGame1Services Error in getPlayerDataTable", e);
            return new Error(e);
        }
    },

    insertData: async function(data) {
        try {

            return await subGame1Model.create(data);
        } catch (e) {
            console.log("subGame1Services Error in insertData", e);
            return new Error(e);
        }
    },

    delete: async function(data) {
        try {
            return await subGame1Model.deleteOne({ _id: data });
        } catch (e) {
            console.log("subGame1Services Error in deletePlayer", e);
            return new Error(e);
        }
    },

    updateData: async function(condition, data) {
        try {
            return await subGame1Model.updateOne(condition, data);
        } catch (e) {
            console.log("subGame1Services Error in updatePlayerData", e);
            return new Error(e);
        }
    },

    getLimit: async function(data) {
        try {
            return await subGame1Model.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("subGame1Services Error in getLimitPlayer", e);
            return new Error(e);
        }
    },

    // getLimitedPlayerWithSort: async function(data, limit, sortBy, sortOrder) {
    //     try {
    //         return await subGame1Model.find(data).sort({ chips: sortOrder }).limit(limit);
    //     } catch (e) {
    //         console.log("subGame1Services Error in getLimitedPlayerWithSort", e);
    //         return new Error(e);
    //     }
    // },

    aggregateQuery: async function(data) {
        try {
            return await subGame1Model.aggregate(data);
        } catch (e) {
            console.log("subGame1Services Error in aggregateQuery", e);
            return new Error(e);
        }
    },

    // updateMultiplePlayerData: async function(condition, data) {
    //     try {
    //         await subGame1Model.update(condition, data, { multi: true });
    //     } catch (e) {
    //         console.log("subGame1Services Error in updateMultiplePlayerData", e);
    //         return new Error(e);
    //     }
    // },

    // getPlayerExport: async function(query, pageSize) {
    //     try {
    //         return await subGame1Model.find(query).limit(pageSize);
    //     } catch (e) {
    //         console.log("subGame1Services Error in getPlayerExport", e);
    //         return new Error(e);
    //     }
    // },

    // getLoggedInTokens: async function() {
    //     try {
    //         return await subGame1Model.find({ loginToken: { $ne: null } }).select({ loginToken: 1, _id: 0 });
    //     } catch (e) {
    //         console.log("Error subGame1Services", e);
    //         return new Error(e);
    //     }
    // },


}
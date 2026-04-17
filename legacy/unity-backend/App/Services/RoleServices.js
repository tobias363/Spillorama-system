'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const roleModel = mongoose.model('role');


module.exports = {

    getByData: async function(data) {
        try {
            return await roleModel.find(data);
        } catch (e) {
            console.log("RoleServices Error in getByData", e);
            return new Error(e);
        }
    },
    getById: async function(id) {
        try {
            return await roleModel.findById(id);
        } catch (error) {
            console.log('RoleServices Error in getById : ', error);
        }
    },

    getDatatable: async function(query, length, start) {
        try {
            return await roleModel.find(query).skip(start).limit(length).sort({ "createdAt": -1 });
        } catch (e) {
            console.log("RoleServices Error in getDatatable", e);
            return new Error(e);
        }
    },

    getCount: async function(data) {
        try {
            return await roleModel.countDocuments(data);
        } catch (e) {
            console.log("RoleServices Error in getAgentCount", e);
            return new Error(e);
        }
    },

    getSingleData: async function(data, column) {
        try {
            return await roleModel.findOne(data);
        } catch (e) {
            console.log("RoleServices Error in getSinglePlayerData", e);
            return new Error(e);
        }
    },
    getSingleDatawithSelect: async function(data, column) {
        try {
            return await roleModel.findOne(data).select(column);
        } catch (e) {
            console.log("RoleServices Error in getSingleDatawithSelect", e);
            return new Error(e);
        }
    },

    getAllDataSelect: async function(data, column) {
        try {
            return await roleModel.find(data).select(column);
        } catch (e) {
            console.log("RoleServices Error in getSinglePlayerData", e);
            return new Error(e);
        }
    },

    getSelectDatatable: async function(query, length, start, column) {
        try {
            if (length == -1) {
                return await roleModel.find(query).lean();
            } else {
                return await roleModel.find(query).skip(start).limit(length).select(column).lean();
            }
        } catch (e) {
            console.log("RoleServices Error in getPlayerDataTable", e);
            return new Error(e);
        }
    },

    insertData: async function(data) {
        try {

            return await roleModel.create(data);
        } catch (e) {
            console.log("RoleServices Error in insertData", e);
            return new Error(e);
        }
    },

    deleteRole: async function(data) {
        try {
            return await roleModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("RoleServices Error in deletePlayer", e);
            return new Error(e);
        }
    },

    updateData: async function(condition, data) {
        try {
            return await roleModel.updateOne(condition, data);
        } catch (e) {
            console.log("RoleServices Error in updatePlayerData", e);
            return new Error(e);
        }
    },

    getLimit: async function(data) {
        try {
            return await roleModel.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("RoleServices Error in getLimitPlayer", e);
            return new Error(e);
        }
    },

    // getLimitedPlayerWithSort: async function(data, limit, sortBy, sortOrder) {
    //     try {
    //         return await roleModel.find(data).sort({ chips: sortOrder }).limit(limit);
    //     } catch (e) {
    //         console.log("RoleServices Error in getLimitedPlayerWithSort", e);
    //         return new Error(e);
    //     }
    // },

    aggregateQuery: async function(data) {
        try {
            return await roleModel.aggregate(data);
        } catch (e) {
            console.log("RoleServices Error in aggregateQuery", e);
            return new Error(e);
        }
    },

    // updateMultiplePlayerData: async function(condition, data) {
    //     try {
    //         await roleModel.update(condition, data, { multi: true });
    //     } catch (e) {
    //         console.log("RoleServices Error in updateMultiplePlayerData", e);
    //         return new Error(e);
    //     }
    // },

    // getPlayerExport: async function(query, pageSize) {
    //     try {
    //         return await roleModel.find(query).limit(pageSize);
    //     } catch (e) {
    //         console.log("RoleServices Error in getPlayerExport", e);
    //         return new Error(e);
    //     }
    // },

    // getLoggedInTokens: async function() {
    //     try {
    //         return await roleModel.find({ loginToken: { $ne: null } }).select({ loginToken: 1, _id: 0 });
    //     } catch (e) {
    //         console.log("Error RoleServices", e);
    //         return new Error(e);
    //     }
    // },


}
'use strict';

const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const Model = mongoose.model('Withdraw');
const withdrawEmailModel = mongoose.model('withdrawEmail');

module.exports = {

    getById: async function(id) {
        try {
            return await Model.findById(id);
        } catch (error) {
            Sys.Log.info('Error in getByData : ' + error);
        }
    },
    getByData: async function(data) {
        // console.log('Find By Data:', data)
        try {
            return await Model.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getPlayerData: async function(data) {
        try {
            return await Model.find(data);
        } catch (e) {
            console.log("Error", e);
        }
    },


    getCount: async function(data) {
        try {
            return await Model.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },



    getDatatable: async function(query, length, start, sort) {
        try {
            return await Model.find(query).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("Error", e);
        }
    },



    delete: async function(data) {
        try {
            await Model.deleteOne({ _id: data });
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateData: async function(condition, data) {
        try {
            await Model.updateOne(condition, data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getLimit: async function(data) {
        try {
            return await Model.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getLimitedWithSort: async function(data, limit, sortBy, sortOrder) {
        try {
            return await Model.find(data).sort({ chips: sortOrder }).limit(limit);
        } catch (e) {
            console.log("Error", e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await Model.aggregate(data);
        } catch (e) {
            console.log("Error", e);
        }
    },
    getSingleData: async function(data) {
        try {
            return await Model.findOne(data);
        } catch (e) {
            console.log("Error", e);
            return new Error(e);
        }
    },

    updateMultipleData: async function(condition, data) {
        try {
            await Model.updateMany(condition, data, { multi: true });
        } catch (e) {
            console.log("Error", e);
        }
    },

    getExport: async function(query, pageSize) {
        try {
            return await Model.find(query).limit(pageSize);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleByData: async function (data, select, setOption) {
        try {
            return await Model.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleByData:", e);
        }
    },

    getWithdrawByData: async function (data, select, setOption) {
        try {
            return await Model.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            throw new Error('error in getDepositsByData' + e.message);
        }
    },

    // Withdraw Emal services

    getEmailsByData: async function (data, select, setOption) {
        try {
            return await withdrawEmailModel.find(data, select, setOption);  // setOption(sort, limit,skip)
        } catch (e) {
            //console.log("Error",e);
            throw new Error('error in getEmailsByData' + e.message);
        }
    },

    getEmailById: async function (id, select) {
        try {
            return await withdrawEmailModel.findById(id, select);
        } catch (error) {
            console.log('GameServices Error in getEmailById : ', error);
        }
    },

    getEmailsCount: async function (data) {
        try {
            return await withdrawEmailModel.countDocuments(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    getSingleEmailData: async function (data, select, setOption) {
        try {
            return await withdrawEmailModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleEmailData:", e);
        }
    },

    getSingleEmailData: async function (data, select, setOption) {
        try {
            return await withdrawEmailModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("Error in getSingleEmailData:", e);
        }
    },

    getEmailsDatatable: async function (query, length, start, sort) { //sort
        try {
            return await withdrawEmailModel.find(query).sort(sort).skip(start).limit(length).lean(); //.sort(sort)
        } catch (e) {
            console.log("Error getSEmailsDatatable :", e);
        }
    },

    insertEmailData: async function (data) {
        try {
            return await withdrawEmailModel.create(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    deleteEmail: async function (data) {
        try {
            return await withdrawEmailModel.deleteOne(data);
        } catch (e) {
            console.log("Error", e);
        }
    },

    updateEmailData: async function (condition, data) {
        try {
            return await withdrawEmailModel.findOneAndUpdate(condition, data, { new: true });
        } catch (e) {
            console.log("Error in updateEmailData", e);
        }
    },


}
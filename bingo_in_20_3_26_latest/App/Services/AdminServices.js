'use strict';
const mongoose = require('mongoose');
var Sys = require('../../Boot/Sys');
const adminModel = mongoose.model('user');
module.exports = {

    getByData: async function(data) {
        try {
            return await adminModel.find(data);
        } catch (e) {
            console.log("AdminServices Error in getByData", e);
            return new Error(e);
        }
    },

    getByDataForRole: async function(data, column) {
        try {
            return await adminModel.find(data).select(column);
        } catch (e) {
            console.log("AdminServices Error in getByData", e);
            return new Error(e);
        }
    },
    getSingleAdminData: async function(data) {
        try {
            return await adminModel.findOne(data);
        } catch (e) {
            console.log("AdminServices Error in getSingleAdminData", e);
            return new Error(e);
        }
    },
    getSingleAgentByData: async function(data, select, setOption) {
        try {
            return await adminModel.findOne(data, select, setOption).lean();
        } catch (e) {
            console.log("AdminServices Error in getSingleAdminByData", e);
            return new Error(e);
        }
    },
    getSingleAdminDataForRole: async function(data, column) {
        try {
            return await adminModel.findOne(data).select(column);
        } catch (e) {
            console.log("AdminServices Error in getSingleAdminDataForRole", e);
            return new Error(e);
        }
    },
    getSingleUserData: async function(data, column) {
        try {
            return await adminModel.findOne(data).select(column).limit(1).sort({_id:-1});
        } catch (e) {
            console.log("AdminServices Error in getSingleAdminDataForRole", e);
            return new Error(e);
        }
    },
    insertPlayerData: async function(data) {
        try {
            return await adminModel.create(data);
        } catch (e) {
            console.log("AdminServices Error in insertAdminData", e);
            return new Error(e);
        }
    },
    FindOneUpdate: async function(id, query) {
        try {
            let admin = await adminModel.findOneAndUpdate({ _id: id }, query, { new: true });
            return admin;
        } catch (error) {
            Sys.Log.info('Error in Update Admin : ' + error);
        }
    },
    getAllAdminDataSelect: async function(data, column) {
        try {
            return await adminModel.find(data).select(column);
        } catch (e) {
            console.log("AdminServices Error in getSingleAdminData", e);
            return new Error(e);
        }
    },
    getById: async function(id) {
        try {
            return await adminModel.findById(id);
        } catch (error) {
            console.log('AdminServices Error in getById : ', error);
        }
    },
    getAdminDatatable: async function(data, length, start, sort) {
        try {
            return await adminModel.find(data).skip(start).limit(length).sort(sort);
        } catch (e) {
            console.log("AdminServices Error in getAdminData", e);
            return new Error(e);
        }
    },


    updateManyData: async function(data) {
        try {
            return await adminModel.updateMany({}, {
                $pull: {
                    hallName: { _id: data },
                }
            }, { multi: true });
        } catch (e) {
            console.log(" Error in updateManyData", e);
            return new Error(e);
        }
    },

    getAdminCount: async function(data) {
        try {
            return await adminModel.countDocuments(data);
        } catch (e) {
            console.log("AdminServices Error in getAdminCount", e);
            return new Error(e);
        }
    },

    insertAdminData: async function(data) {
        let session = await mongoose.startSession();
        session.startTransaction();
        try {
            data.uniqId = 'Bingo' + (await adminModel.countDocuments({}) + 1000);
            await adminModel.create(data);
            return true;
        } catch (e) {
            console.log("AdminServices Error in insertAdminData", e);
            await session.abortTransaction();
            session.endSession();
            return new Error(e);
        }
    },

    deleteAdmin: async function(data) {
        try {
            return await adminModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("AdminServices Error in deleteAdmin", e);
            return new Error(e);
        }
    },

    getAdminDatatable: async function(query, length, start, sort) {
        try {
            if (length == -1) {
                return await adminModel.find(query).lean();
            } else {
                return await adminModel.find(query).skip(start).limit(length).sort(sort).lean();
            }
        } catch (e) {
            console.log("AdminServices Error in getAdminDataTable", e);
            return new Error(e);
        }
    },

    insertAdminData: async function(data) {
        try {
            data.uniqId = 'Bingo' + (await adminModel.countDocuments({}) + 1000);
            return await adminModel.create(data);
        } catch (e) {
            console.log("AdminServices Error in insertAdminData", e);
            return new Error(e);
        }
    },

    adminCount: async function (data) {
        try {
            return await adminModel.countDocuments(data);
        } catch (e) {
            console.log("AdminServices Error in countAdmin", e);
            return new Error(e);
        }
    }, 

    deleteAdmin: async function(data) {
        try {
            return await adminModel.deleteOne({ _id: data });
        } catch (e) {
            console.log("AdminServices Error in deleteAdmin", e);
            return new Error(e);
        }
    },

    updateAdminData: async function(condition, data) {
        try {
            return await adminModel.updateOne(condition, data);
        } catch (e) {
            console.log("AdminServices Error in updateAdminData", e);
            return new Error(e);
        }
    },

    getLimitAdmin: async function(data) {
        try {
            return await adminModel.find(data).limit(8).sort({ createdAt: -1 });
        } catch (e) {
            console.log("AdminServices Error in getLimitAdmin", e);
            return new Error(e);
        }
    },

    getLimitedAdminWithSort: async function(data, limit, sortBy, sortOrder) {
        try {
            return await adminModel.find(data).sort({ chips: sortOrder }).limit(limit);
        } catch (e) {
            console.log("AdminServices Error in getLimitedAdminWithSort", e);
            return new Error(e);
        }
    },

    aggregateQuery: async function(data) {
        try {
            return await adminModel.aggregate(data);
        } catch (e) {
            console.log("AdminServices Error in aggregateQuery", e);
            return new Error(e);
        }
    },

    updateMultipleAdminData: async function(condition, data) {
        try {
            await adminModel.updateMany(condition, data, { multi: true });
        } catch (e) {
            console.log("AdminServices Error in updateMultipleAdminData", e);
            return new Error(e);
        }
    },

    getAdminExport: async function(query, pageSize) {
        try {
            return await adminModel.find(query).limit(pageSize);
        } catch (e) {
            console.log("AdminServices Error in getAdminExport", e);
            return new Error(e);
        }
    },

    getLoggedInTokens: async function() {
        try {
            return await adminModel.find({ loginToken: { $ne: null } }).select({ loginToken: 1, _id: 0 });
        } catch (e) {
            console.log("Error", e);
            return new Error(e);
        }
    },

    updateAdminNested: async function(condition, query, filter) {
        try {
            let tickets = await adminModel.findOneAndUpdate(condition, query, filter);
            return tickets;
        } catch (error) {
            console.log("Error in Update Ticket :",error);
            Sys.Log.info('Error in Update Ticket : ' + error);
        }
    }

}